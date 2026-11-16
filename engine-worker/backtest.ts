/**
 * Portfolio backtest of the paper robot on Binance's published 1m futures archives.
 * Usage: bun engine-worker/backtest.ts <data-dir> <exchangeInfo.json> <out.json>
 * No order book history exists in the archives, so spread/imbalance checks are neutral and costs use fixed slippage.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, ROBOT_SYMBOLS } from '../src/lib/robot/config';
import { SymbolState, MINUTE } from '../src/lib/robot/series';
import { abnormalMarket, evaluateBoth, exposure, pickEntry, stepSymbol } from '../src/lib/robot/engine';
import { openPosition, type Position } from '../src/lib/robot/paper';
import { portfolioGate, sizePosition, type Account } from '../src/lib/robot/risk';
import { computeMetrics, type ClosedTrade } from '../src/lib/robot/metrics';
import { TUNING, type Candidate } from '../src/lib/robot/strategy';
Object.assign(TUNING, JSON.parse(process.env['ROBOT_TUNING'] ?? '{}'));

const [dir = '/tmp/bt/data', infoPath = '/tmp/ei.json', outPath = '/tmp/bt/result.json'] = process.argv.slice(2);
const s = { ...DEFAULT_SETTINGS, ...JSON.parse(process.env['ROBOT_SETTINGS'] ?? '{}') };
const START_BALANCE = 1000;
type Series = { t: Float64Array; o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array; v: Float64Array; n: number };
const info = JSON.parse(readFileSync(infoPath, 'utf8')) as { symbols: { symbol: string; filters: { filterType: string; tickSize?: string }[] }[] };

function load(symbol: string): Series | null {
  const files = readdirSync(dir).filter((f) => f.startsWith(`${symbol}-1m-`)).sort();
  if (!files.length) return null;
  const rows: number[][] = [];
  for (const f of files) {
    const out = Bun.spawnSync(['unzip', '-p', `${dir}/${f}`]).stdout.toString();
    for (const line of out.split('\n')) {
      const p = line.split(','); const t = Number(p[0]);
      if (!Number.isFinite(t) || p.length < 6) continue;
      rows.push([t, +p[1]!, +p[2]!, +p[3]!, +p[4]!, +p[5]!]);
    }
  }
  rows.sort((a, b) => a[0]! - b[0]!);
  const n = rows.length; const mk = () => new Float64Array(n);
  const sr: Series = { t: mk(), o: mk(), h: mk(), l: mk(), c: mk(), v: mk(), n };
  rows.forEach((r, i) => { sr.t[i] = r[0]!; sr.o[i] = r[1]!; sr.h[i] = r[2]!; sr.l[i] = r[3]!; sr.c[i] = r[4]!; sr.v[i] = r[5]!; });
  return sr;
}

const series = new Map<string, Series>(); const states = new Map<string, SymbolState>(); const cursor = new Map<string, number>();
for (const sym of ROBOT_SYMBOLS) {
  const sr = load(sym); if (!sr) { console.error('missing', sym); continue; }
  const tick = Number(info.symbols.find((x) => x.symbol === sym)?.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize ?? 0.0001);
  series.set(sym, sr); states.set(sym, new SymbolState(sym, tick)); cursor.set(sym, 0);
}
let start = Infinity; let end = -Infinity;
for (const sr of series.values()) { start = Math.min(start, sr.t[0]!); end = Math.max(end, sr.t[sr.n - 1]!); }

const open: Position[] = []; const closed: (ClosedTrade & { symbol: string; setup: string; score: number; leverage: number; openedAt: number; holdMin: number; band: string })[] = [];
const acct: Account = { balance: START_BALANCE, dayStartBalance: START_BALANCE, realizedToday: 0, lossStreak: 0, lastLossAt: null };
let day = Math.floor(start / 86_400_000); let pending: Candidate | null = null; let suspendedUntil = 0;
const rejects: Record<string, number> = {}; const setups: Record<string, { found: number; qualified: number }> = {};
let maxAllocPct = 0; let maxLev = 0; let equityPeak = START_BALANCE; const daily: Record<string, number> = {};
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

for (let t = start; t <= end; t += MINUTE) {
  const d = Math.floor(t / 86_400_000);
  if (d !== day) { day = d; acct.dayStartBalance = acct.balance; acct.realizedToday = 0; }
  const evals = [];
  for (const [sym, sr] of series) {
    let i = cursor.get(sym)!;
    if (i >= sr.n || sr.t[i] !== t) continue;
    const bar = { time: t, open: sr.o[i]!, high: sr.h[i]!, low: sr.l[i]!, close: sr.c[i]!, volume: sr.v[i]! };
    cursor.set(sym, ++i);
    const st = states.get(sym)!;
    // Entry decided on the previous close fills at this bar's open plus slippage: no look-ahead.
    if (pending && pending.symbol === sym) {
      const c = pending; pending = null;
      const sign = c.direction === 'LONG' ? 1 : -1;
      const fill = bar.open * (1 + sign * s.slippage_bps / 10_000);
      const valid = (c.stop - fill) * sign < 0 && (c.tp1 - fill) * sign > 0;
      const gate = portfolioGate(c, exposure(open), acct, s, t);
      const z = valid && !gate ? sizePosition(c, acct.balance, exposure(open), s, null, fill) : { rejected: gate ?? 'Price moved past levels before fill' };
      if ('rejected' in z) rejects[`fill: ${z.rejected}`] = (rejects[`fill: ${z.rejected}`] ?? 0) + 1;
      else {
        const { position, fill: f } = openPosition(c, z, fill, t, s);
        open.push(position); acct.balance += f.pnl; acct.realizedToday += f.pnl;
        maxLev = Math.max(maxLev, z.leverage);
        const used = exposure(open).reduce((a, p) => a + p.margin, 0);
        maxAllocPct = Math.max(maxAllocPct, (used / acct.balance) * 100);
      }
    }
    const { fills } = stepSymbol(st, bar, open, s);
    for (const { position: p, fill: f } of fills) {
      acct.balance += f.pnl; acct.realizedToday += f.pnl; daily[dayKey(t)] = (daily[dayKey(t)] ?? 0) + f.pnl;
      if (p.status === 'CLOSED') {
        open.splice(open.indexOf(p), 1);
        if (p.realized <= 0) { acct.lossStreak++; acct.lastLossAt = t; } else acct.lossStreak = 0;
        closed.push({ symbol: p.symbol, direction: p.direction, netPnl: p.realized, exitReason: p.exitReason!, closedAt: p.closedAt!, riskUsdt: p.riskUsdt,
          setup: p.setup, score: p.score, leverage: p.leverage, openedAt: p.openedAt, holdMin: (p.closedAt! - p.openedAt) / MINUTE, band: p.band });
      }
    }
    if (open.length === 0) equityPeak = Math.max(equityPeak, acct.balance);
    for (const e of evaluateBoth(st, s)) {
      evals.push(e);
      if (e.candidate) { const k = `${e.direction} ${e.candidate.setup}`; setups[k] ??= { found: 0, qualified: 0 }; setups[k].found++; if (!e.rejected) setups[k].qualified++; }
      if (e.rejected && e.rejected !== 'No sweep or pullback setup') { const k = e.rejected.startsWith('Score') ? 'Score below threshold' : e.rejected; rejects[k] = (rejects[k] ?? 0) + 1; }
    }
  }
  const abnormal = abnormalMarket(states.get('BTCUSDT'));
  if (abnormal) suspendedUntil = t + 15 * MINUTE;
  if (!pending && t >= suspendedUntil) pending = pickEntry(evals, open, acct, s, t).chosen;
}

const metrics = (xs: ClosedTrade[]) => computeMetrics(xs, START_BALANCE);
const bySetup: Record<string, ReturnType<typeof metrics>> = {};
for (const k of new Set(closed.map((c) => c.setup))) bySetup[k] = metrics(closed.filter((c) => c.setup === k));
const monthly: Record<string, ReturnType<typeof metrics>> = {};
for (const k of new Set(closed.map((c) => dayKey(c.closedAt).slice(0, 7)))) monthly[k] = metrics(closed.filter((c) => dayKey(c.closedAt).startsWith(k)));
const result = {
  generated_at: new Date().toISOString(), period_start: new Date(start).toISOString(), period_end: new Date(end + MINUTE).toISOString(),
  symbols: [...series.keys()], start_balance: START_BALANCE, end_balance: acct.balance, settings: s,
  assumptions: { fee_pct_per_side: s.fee_pct, slippage_bps_per_market_fill: s.slippage_bps, order_book: 'Not available in historical archives; spread and imbalance checks neutral',
    entry_fill: 'Next 1m bar open plus slippage', intrabar: 'Stop checked before targets when both fall in one bar' },
  all: metrics(closed), long: metrics(closed.filter((c) => c.direction === 'LONG')), short: metrics(closed.filter((c) => c.direction === 'SHORT')),
  by_setup: bySetup, monthly, setups, rejects, max_allocation_pct: maxAllocPct, max_leverage_used: maxLev,
  leverage_used: closed.reduce<Record<string, number>>((a, c) => { a[c.leverage] = (a[c.leverage] ?? 0) + 1; return a; }, {}),
  avg_hold_minutes: closed.length ? closed.reduce((a, c) => a + c.holdMin, 0) / closed.length : 0,
  daily: Object.entries(daily).sort().map(([date, pnl]) => ({ date, pnl })),
  trades: closed.map((c) => ({ ...c, openedAt: new Date(c.openedAt).toISOString(), closedAt: new Date(c.closedAt).toISOString() })),
};
writeFileSync(outPath, JSON.stringify(result, null, 1));
const brief = (m: ReturnType<typeof metrics>) => `${m.trades} trades, win ${m.winRate.toFixed(1)}%, net ${m.netPnl.toFixed(2)}, PF ${m.profitFactor?.toFixed(2)}, DD ${m.maxDrawdownPct.toFixed(2)}%, SL ${m.stopLossRate.toFixed(1)}%, exp ${m.expectancyR.toFixed(3)}R`;
console.log('ALL  ', brief(result.all)); console.log('LONG ', brief(result.long)); console.log('SHORT', brief(result.short));
console.log('end balance', acct.balance.toFixed(2), 'max alloc %', maxAllocPct.toFixed(1), 'max lev', maxLev, result.leverage_used);
console.log('reasons', result.all.byReason); console.log('setups', setups); console.log('by setup', Object.fromEntries(Object.entries(bySetup).map(([k, m]) => [k, brief(m)])));
console.log('monthly', Object.fromEntries(Object.entries(monthly).map(([k, m]) => [k, brief(m)])));
console.log('rejects', Object.entries(rejects).sort((a, b) => b[1] - a[1]).slice(0, 15));
