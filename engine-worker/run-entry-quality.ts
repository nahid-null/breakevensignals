/** prompt-38: evaluate the single registered entry-quality rule offline. No hosted database, worker startup or Telegram. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SYMBOLS, type Direction } from '../src/lib/config';
import { initialState, MINUTE, type Candle } from '../src/lib/engine/model';
import { emptyTimeframe } from '../src/lib/engine/mtf-trend';
import { processCandle } from '../src/lib/engine/scalper';
import { ema } from '../src/lib/engine/calculations';
import { costedOutcome, newSetup, stepSetup, type Setup, type Outcome } from '../src/lib/engine/entry-quality';
import protocol from './entry-quality-protocol.json';

const mode = process.argv[2] as 'development' | 'holdout';
const period = protocol[mode]; const from = Date.parse(period.from); const to = Date.parse(period.to);
const protocolSha = createHash('sha256').update(await readFile('engine-worker/entry-quality-protocol.json')).digest('hex');
const meta = JSON.parse(await readFile('/tmp/profitability-study/exchange-info.json', 'utf8')) as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string }[] }[] };
interface Cand { symbol: string; direction: Direction; signalTime: number; confirmTime: number; entryTime: number; exitTime: number; stop: number; stopPct: number; outcome: Outcome; minNotional: number; minQty: number }
const cands: Cand[] = []; const funnel: Record<string, number> = {}; const bump = (k: string) => { funnel[k] = (funnel[k] ?? 0) + 1; };
for (const symbol of SYMBOLS) {
  const m = meta.symbols.find(x => x.symbol === symbol && x.status === 'TRADING'); if (!m) continue;
  const tick = Number(m.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize);
  const lot = m.filters.find(f => f.filterType === 'MARKET_LOT_SIZE'); const minNotional = Number(m.filters.find(f => f.filterType === 'MIN_NOTIONAL')?.notional);
  const all: Candle[] = mode === 'development' ? JSON.parse(await readFile(`/tmp/profitability-study/${symbol}-raw.json`, 'utf8')).bars : JSON.parse(await readFile(`/tmp/entry-quality-study/${symbol}-holdout-raw.json`, 'utf8'));
  const bars = all.filter(c => c.time < to);
  const st = initialState(symbol, tick); st.mtf = { m15: emptyTimeframe(15), m5: emptyTimeframe(5), m1: emptyTimeframe(1) };
  let e9: number | null = null, e21: number | null = null; const active = new Map<Direction, Setup>();
  for (let i = 0; i < bars.length; i++) { const c = bars[i]!;
    // Completed-candle readings only: trend/EMA states are read before this candle updates them.
    const trend15 = st.mtf.m15.trend; const ema5Side = e9 !== null && e21 !== null ? Math.sign(e9 - e21) : 0;
    const r = processCandle(st, c); const a = r.analysis;
    if ((c.time + MINUTE) % (5 * MINUTE) === 0) { e9 = ema(e9, c.close, 9); e21 = ema(e21, c.close, 21); }
    if (!a || a.atr === null) continue;
    for (const [dir, u] of [...active]) {
      const w = bars.slice(Math.max(0, i - 240), i);
      const step = stepSetup(u, c, { atr: a.atr, ema9: a.ema9, ema21: a.ema21, ema200: a.ema200, rsi: a.rsi, histogram: a.histogram, volumeSMA: a.volumeSMA,
        trend15: trend15 === null ? null : (dir === 'LONG' ? trend15 : trend15), ema5Side, high240: Math.max(...w.map(b => b.high)), low240: Math.min(...w.map(b => b.low)) });
      if (step.status === 'WAIT') continue;
      active.delete(dir);
      if (step.status !== 'CONFIRMED') { bump(step.reason); continue; }
      if (i + 1 >= bars.length) { bump('NO_NEXT_CANDLE_IN_PERIOD'); continue; }
      const o = costedOutcome(bars, i + 1, dir, step.stop, tick); if (!o) continue;
      bump('CONFIRMED');
      cands.push({ symbol, direction: dir, signalTime: u.signalTime, confirmTime: c.time, entryTime: bars[i + 1]!.time, exitTime: bars[o.exitIndex]!.time + MINUTE,
        stop: step.stop, stopPct: Math.abs(c.close - step.stop) / c.close * 100, outcome: o, minNotional, minQty: Number(lot?.minQty) });
    }
    if (c.time >= from) for (const e of r.signals) if (e.event === 'entry_confirmed') { bump('PINE_SIGNAL'); if (active.has(e.direction)) bump('REPLACED_OLDER_SETUP'); active.set(e.direction, newSetup(e, c)); }
  }
  console.log(symbol, cands.length);
}
cands.sort((a, b) => a.entryTime - b.entryTime || SYMBOLS.indexOf(a.symbol as never) - SYMBOLS.indexOf(b.symbol as never));
let equity = 1000; let openUntil = -Infinity; const trades: (Cand & { equityBefore: number; pnl: number })[] = []; let busy = 0;
let peak = equity, maxDd = 0;
for (const c of cands) { if (c.entryTime < openUntil) { busy++; continue; }
  const pnl = c.outcome.netR * .01 * equity; trades.push({ ...c, equityBefore: equity, pnl }); equity += pnl; openUntil = c.exitTime;
  peak = Math.max(peak, equity); maxDd = Math.max(maxDd, (peak - equity) / peak * 100); }
const days: Record<string, { r: number; n: number }> = {}; for (let t = from; t < to; t += 86400000) days[new Date(t).toISOString().slice(0, 10)] = { r: 0, n: 0 };
for (const t of trades) { const d = days[new Date(t.exitTime - 1).toISOString().slice(0, 10)]; if (d) { d.r += t.outcome.netR; d.n++; } }
let seed = 3817; const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const dv = Object.values(days); const boots: number[] = [];
for (let k = 0; k < 2000; k++) { let r = 0, n = 0; for (let j = 0; j < dv.length; j++) { const d = dv[Math.floor(rand() * dv.length)]!; r += d.r; n += d.n; } boots.push(n ? r / n : 0); }
boots.sort((a, b) => a - b);
const stats = (ts: typeof trades) => { const w = ts.filter(t => t.outcome.netR > 0), l = ts.filter(t => t.outcome.netR < 0);
  const gp = w.reduce((a, t) => a + t.outcome.netR, 0), gl = -l.reduce((a, t) => a + t.outcome.netR, 0);
  return { trades: ts.length, wins: w.length, losses: l.length, winRatePct: ts.length ? w.length / ts.length * 100 : 0,
    coinFlipWinRatePct: ts.length ? ts.reduce((a, t) => a + t.outcome.pRandom, 0) / ts.length * 100 : 0,
    meanNetR: ts.length ? ts.reduce((a, t) => a + t.outcome.netR, 0) / ts.length : 0, profitFactor: gl ? gp / gl : null,
    targets: ts.filter(t => t.outcome.result === 'TARGET').length, stops: ts.filter(t => t.outcome.result === 'STOP').length, timeouts: ts.filter(t => t.outcome.result === 'TIMEOUT').length,
    fastStopsWithin5: ts.filter(t => t.outcome.result === 'STOP' && t.outcome.bars <= 5).length, medianStopPct: [...ts.map(t => t.stopPct)].sort((a, b) => a - b)[Math.floor(ts.length / 2)] ?? null }; };
const five = trades.map(t => { const notional = .01 * 5 / (t.outcome.riskPerUnit / t.outcome.entry); return notional >= t.minNotional && notional / t.outcome.entry >= t.minQty && notional <= 5 * 20; });
const all = stats(trades);
const accepted = mode === 'holdout' ? all.meanNetR > 0 && all.trades >= 100 && (all.profitFactor ?? 0) >= 1.1 && (boots[50] ?? 0) > 0 : all.meanNetR > 0;
const out = { mode, protocolSha256: protocolSha, period, funnel, candidatesConfirmed: cands.length, skippedTradeAlreadyOpen: busy, all, long: stats(trades.filter(t => t.direction === 'LONG')), short: stats(trades.filter(t => t.direction === 'SHORT')),
  bootstrapMeanNetR95: [boots[50], boots[1949]], account1000: { start: 1000, end: equity, netPct: (equity / 1000 - 1) * 100, maxDrawdownPct: maxDd, riskPerTradePct: 1 },
  fiveDollarFeasibleTradesPct: five.length ? five.filter(Boolean).length / five.length * 100 : 0, passes: accepted,
  perCoin: Object.fromEntries(SYMBOLS.map(s => [s, stats(trades.filter(t => t.symbol === s))]).filter(([, v]) => (v as { trades: number }).trades > 0)), trades };
await writeFile(`/tmp/entry-quality-study/result-${mode}.json`, JSON.stringify(out, null, 2));
const { trades: _t, perCoin: _p, ...summary } = out; console.log(JSON.stringify(summary, null, 1));
