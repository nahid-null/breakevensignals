/**
 * prompt-47/48 RESEARCH comparison backtest (read-only: no database, no Telegram, live Simulator untouched).
 * Entries: six independent setups + 0-100 score (src/lib/engine/multi-setup.ts) and the existing Trend Identify gate
 * (15m = 5m = side, 1m sideways/same). No LONG/SHORT Pine indicators.
 * Settlement: unchanged PINE1 rules (50x, 10% per slot, 3 slots, one per coin, cross margin, no stop, +25% net target, 24h close).
 * When several coins qualify on the same minute, the highest score takes the free slot first.
 * Costs: 0.05% fee per side, slippage max(1 tick, 0.02% of price) per side.
 * Main window = last 7 full days; check window = the 7 days before it (configs are chosen on the main window only).
 * Usage: bun engine-worker/report-multi-setup.ts [outDir=/tmp/ms-report]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { SYMBOLS } from '../src/lib/config';
import { MINUTE, type Candle, type Signal } from '../src/lib/engine/model';
import { initMtf, updateMtf, snapshot, type MtfSnapshot } from '../src/lib/engine/mtf-trend';
import { trendSkip } from '../src/lib/engine/simulator-replay';
import { PINE1, closePine1, openPine1, pine1Exit, pine1Skip, type Pine1Position, type Pine1Trade } from '../src/lib/engine/pine1-cross';
import { MultiSetup, MS, SETUPS, SETUP_NAMES, type Candidate, type SetupId } from '../src/lib/engine/multi-setup';
import { binanceFetch, history } from './binance';

const outDir = process.argv[2] ?? '/tmp/ms-report'; const cacheDir = '/tmp/ms-cache';
const Q = 15 * MINUTE; const DAY = 86_400_000;
const now = Number(process.env.MS_NOW ?? Math.floor(Date.now() / Q) * Q);
const main = { from: now - 7 * DAY, to: now }; const check = { from: now - 14 * DAY, to: now - 7 * DAY }; const start = check.from - DAY;
mkdirSync(cacheDir, { recursive: true });
async function range(symbol: string, a: number, b: number) {
  const f = `${cacheDir}/${symbol}-${a}-${b}.json`; if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Candle[];
  const all: Candle[] = []; let t = a;
  while (t < b) { const part = (await history(symbol, t, b)).filter((c) => c.time < b); if (!part.length) break; all.push(...part); t = part.at(-1)!.time + MINUTE; }
  const out = all.filter((c, i, x) => i === 0 || c.time > x[i - 1]!.time); writeFileSync(f, JSON.stringify(out)); return out;
}
const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
interface Cand { symbol: string; time: number; c: Candidate; trend: MtfSnapshot; id: string }
const candles = new Map<string, Map<number, Candle>>(); const ticks = new Map<string, number>(); const missing: string[] = [];
const byTime = new Map<number, Cand[]>(); const rejects: Record<string, Record<string, number>> = { main: {}, check: {} };
const raw = { main: 0, check: 0 }; const hashes: Record<string, string> = {};
const win = (t: number) => t >= main.from && t < main.to ? 'main' : t >= check.from && t < check.to ? 'check' : null;
for (const symbol of SYMBOLS) {
  const meta = info.symbols.find((s) => s.symbol === symbol && s.status === 'TRADING'); if (!meta) { missing.push(symbol); continue; }
  const tick = Number(meta.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize); ticks.set(symbol, tick);
  const f15 = await history(symbol, undefined, start, undefined, '15m'); const f5 = await history(symbol, undefined, start, undefined, '5m');
  const mtf = initMtf(start - MINUTE, await history(symbol, undefined, start), f5, f15);
  const det = new MultiSetup(tick); det.seed(f15, f5);
  const bars = await range(symbol, start, now);
  if (bars[0]?.time !== start || bars.length !== (now - start) / MINUTE) throw new Error(`${symbol}: incomplete 1-minute candles`);
  hashes[symbol] = new Bun.CryptoHasher('sha256').update(JSON.stringify(bars)).digest('hex');
  const map = new Map<number, Candle>();
  for (const c of bars) {
    map.set(c.time, c); updateMtf(mtf, c); const trend = snapshot(mtf); const w = win(c.time);
    for (const r of det.step(c)) {
      if (r === null || !w) continue;
      if (typeof r === 'string') { rejects[w]![r] = (rejects[w]![r] ?? 0) + 1; continue; }
      const why = trendSkip(trend, r.side); if (why) { const k = `TREND_FILTER_${why}`; rejects[w]![k] = (rejects[w]![k] ?? 0) + 1; continue; }
      raw[w]++; byTime.set(c.time, [...(byTime.get(c.time) ?? []), { symbol, time: c.time, c: r, trend, id: `${symbol}-${r.side}-${c.time}` }]);
    }
  }
  candles.set(symbol, map); console.error(`${symbol}: ${bars.length} candles`);
}
const syms = SYMBOLS.filter((s) => candles.has(s));
interface Cfg { name: string; setups: SetupId[]; minScore: number }
type Trade = Pine1Trade & { setups: SetupId[]; score: number };
function run(cfg: Cfg, w: { from: number; to: number }) {
  let balance = new Decimal(PINE1.startBalance); let eqPeak = balance; let maxDd = new Decimal(0);
  let opens: (Pine1Position & { setups: SetupId[]; score: number })[] = []; const trades: Trade[] = []; let skippedBusy = 0;
  const reserved = (ex?: Pine1Position) => opens.filter((o) => o !== ex).reduce((a, o) => a.plus(o.margin), new Decimal(0));
  for (let t = w.from; t < w.to; t += MINUTE) {
    for (const open of [...opens]) { const c = candles.get(open.symbol)!.get(t)!; if (t <= open.openedCandle) continue; const r = pine1Exit(open, c);
      if (r) { const done = closePine1(open, r, t, balance, c.close, reserved(open)); trades.push({ ...done, setups: open.setups, score: open.score }); balance = new Decimal(done.balanceAfter); opens = opens.filter((o) => o !== open); } }
    const list = (byTime.get(t) ?? []).filter((k) => k.c.score >= cfg.minScore && k.c.setups.some((s) => cfg.setups.includes(s))).sort((a, b) => b.c.score - a.c.score);
    for (const k of list) {
      const e = { trade_id: k.id, symbol: k.symbol, direction: k.c.side, entry_price: k.c.entry, mtf_trend: k.trend } as unknown as Signal;
      if (pine1Skip(e, balance, opens)) { skippedBusy++; continue; }
      opens.push({ ...openPine1(e, t, Math.max(ticks.get(k.symbol)!, k.c.entry * 0.0002), balance, reserved()), setups: k.c.setups, score: k.c.score });
    }
    const eq = opens.reduce((a, o) => a.plus(new Decimal(o.quantity).mul(new Decimal(candles.get(o.symbol)!.get(t)!.close).minus(o.entry)).mul(o.direction === 'LONG' ? 1 : -1)), balance);
    eqPeak = Decimal.max(eqPeak, eq); if (eqPeak.gt(0)) maxDd = Decimal.max(maxDd, eqPeak.minus(eq).div(eqPeak).mul(100));
  }
  const last = w.to - MINUTE;
  const unreal = opens.reduce((a, o) => a.plus(new Decimal(o.quantity).mul(new Decimal(candles.get(o.symbol)!.get(last)!.close).minus(o.entry)).mul(o.direction === 'LONG' ? 1 : -1).minus(o.entryFee)), new Decimal(0));
  return { trades, opens, balance, maxDd, unreal, skippedBusy };
}
const n = (x: Decimal.Value, d = 2) => Number(new Decimal(x).toFixed(d));
const avg = (v: number[]) => v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
function stats(r: ReturnType<typeof run>) { const xs = r.trades; const tp = xs.filter((t) => t.reason === 'TAKE_PROFIT');
  return { tradesClosed: xs.length, tpCount: tp.length, tpRatePct: xs.length ? n(tp.length / xs.length * 100, 1) : 0,
    closed24h: xs.filter((t) => t.reason === 'TIME_EXIT').length, liquidated: xs.filter((t) => t.reason === 'LIQUIDATED').length,
    avgHoldMin: avg(xs.map((t) => (t.closedCandle - t.openedCandle) / MINUTE)), avgMinToTp: avg(tp.map((t) => (t.closedCandle - t.openedCandle) / MINUTE)),
    feesUsdt: n(xs.reduce((a, t) => a.plus(t.entryFee).plus(t.exitFee), new Decimal(0))), netPnlUsdt: n(r.balance.minus(PINE1.startBalance)),
    maxDrawdownPct: n(r.maxDd, 1), finalBalance: n(r.balance), stillOpen: r.opens.length, stillOpenUnrealizedUsdt: n(r.unreal) }; }
const cfgs: Cfg[] = [];
for (const m of [0, 40, 50, 60, 65, 70, 75, 80]) cfgs.push({ name: `All setups, score >= ${m}`, setups: [...SETUPS], minScore: m });
for (const s of SETUPS) for (const m of [0, 60, 70]) cfgs.push({ name: `Setup ${s} only, score >= ${m}`, setups: [s], minScore: m });
for (const m of [50, 60, 70]) { cfgs.push({ name: `Trend setups B+C+D+E, score >= ${m}`, setups: ['B', 'C', 'D', 'E'], minScore: m });
  cfgs.push({ name: `Reversal setups A+F, score >= ${m}`, setups: ['A', 'F'], minScore: m }); }
const rows = cfgs.map((cfg) => { const r = run(cfg, main); return { cfg, r, s: stats(r) }; });
const eligible = rows.filter((x) => x.s.netPnlUsdt > 0 && x.s.maxDrawdownPct <= 40 && x.s.liquidated === 0);
const best = [...eligible].sort((a, b) => b.s.tradesClosed - a.s.tradesClosed || b.s.netPnlUsdt - a.s.netPnlUsdt)[0] ?? null;
const meets100 = eligible.filter((x) => x.s.tradesClosed >= 100);
const checkRows = [...new Set([best, ...[...rows].sort((a, b) => b.s.netPnlUsdt - a.s.netPnlUsdt).slice(0, 3), ...rows.filter((x) => x.cfg.setups.length === 6)])]
  .filter(Boolean).map((x) => ({ name: x!.cfg.name, check: stats(run(x!.cfg, check)) }));
const perSetup = best ? SETUPS.map((s) => { const xs = best.r.trades.filter((t) => t.setups.includes(s)); const tp = xs.filter((t) => t.reason === 'TAKE_PROFIT').length;
  return { setup: s, name: SETUP_NAMES[s], trades: xs.length, tp, tpRatePct: xs.length ? n(tp / xs.length * 100, 1) : 0, netPnlUsdt: n(xs.reduce((a, t) => a.plus(t.pnl), new Decimal(0))) }; }) : [];
const summary = {
  windows: { main: { from: new Date(main.from).toISOString(), to: new Date(main.to).toISOString() }, check: { from: new Date(check.from).toISOString(), to: new Date(check.to).toISOString() } },
  coinsTested: syms.length, missing, parameters: MS, setups: SETUP_NAMES, candleSha256: hashes,
  candidatesPassingTrendFilter: raw, rejected: rejects,
  selectionRule: 'Highest closed-trade count among main-window configs with net profit > 0 after fees/slippage, max mark-to-market drawdown <= 40% and zero liquidations.',
  selected: best ? { name: best.cfg.name, ...best.s } : null, configsReaching100ProfitablyOnMain: meets100.map((x) => x.cfg.name),
  selectedPerSetup: perSetup,
  comparisonMain: rows.map((x) => ({ name: x.cfg.name, ...x.s })), checkWindow: checkRows,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
const cols = Object.keys(rows[0]!.s);
writeFileSync(`${outDir}/comparison.csv`, ['config,' + cols.join(','), ...rows.map((x) => [`"${x.cfg.name}"`, ...cols.map((k) => (x.s as Record<string, unknown>)[k])].join(','))].join('\n') + '\n');
const label = (r: string) => r === 'TAKE_PROFIT' ? 'Take profit hit' : r === 'TIME_EXIT' ? 'Closed after 24 hours' : 'Liquidated';
const tradesOf = (r: ReturnType<typeof run> | undefined) => ['opened_utc,closed_utc,coin,side,setups,score,entry,take_profit,exit,result,minutes_open,fees_usdt,net_pnl_usdt,balance_after_usdt',
  ...(r?.trades ?? []).map((t) => [new Date(t.openedCandle + MINUTE).toISOString(), new Date(t.closedCandle + MINUTE).toISOString(), t.symbol, t.direction, t.setups.join('+'), t.score,
    t.entry, n(t.target, 8), t.exit, label(t.reason), (t.closedCandle - t.openedCandle) / MINUTE, n(new Decimal(t.entryFee).plus(t.exitFee), 4), n(t.pnl, 4), n(t.balanceAfter, 4)].join(','))].join('\n') + '\n';
const allBest = rows.find((x) => x.cfg.name === 'All setups, score >= 0');
writeFileSync(`${outDir}/selected-trades.csv`, tradesOf(best?.r));
writeFileSync(`${outDir}/all-setups-no-threshold-trades.csv`, tradesOf(allBest?.r));
console.log(JSON.stringify({ ...summary, candleSha256: undefined, parameters: undefined }, null, 2));
