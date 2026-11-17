/**
 * 7-day replay of the live Simulator rule on real Binance USD-M 1m/5m/15m candles:
 * original Pine scalper (processCandle) + Trend Identify (mtf-trend) -> breakeven_activated events,
 * then the same decision and settlement formulas as public.simulate_engine_candle / sim_finish_trade.
 * Usage: bun engine-worker/report-sim-trend.ts [days=7] [out=/tmp/sim-trend-report.json]
 * Read-only: no database, no Telegram. Closed-candle modeled fills, stop-first on ambiguous candles.
 */
import { writeFileSync } from 'node:fs';
import { SYMBOLS } from '../src/lib/config';
import { initialState, MINUTE, type Candle } from '../src/lib/engine/model';
import { processCandle } from '../src/lib/engine/scalper';
import { initMtf, type MtfSnapshot } from '../src/lib/engine/mtf-trend';
import { binanceFetch, history } from './binance';
import { watchSide } from '../src/lib/sim-trend';

const days = Number(process.argv[2] ?? 7); const out = process.argv[3] ?? '/tmp/sim-trend-report.json';
const now = Math.floor(Date.now() / MINUTE) * MINUTE; const from = now - days * 86_400_000; const warm = from - 86_400_000;

async function range(symbol: string, start: number, end: number) {
  const all: Candle[] = []; let t = start;
  while (t < end) { const part = await history(symbol, t, end); if (!part.length) break; all.push(...part); t = part.at(-1)!.time + MINUTE; }
  return all.filter((c, i, a) => i === 0 || c.time > a[i - 1]!.time);
}
type Be = { time: number; symbol: string; dir: 'LONG' | 'SHORT'; pe: number; ptp: number; stop: number; trend: MtfSnapshot | null; id: string };
const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const candles = new Map<string, Map<number, Candle>>(); const ticks = new Map<string, number>(); const bes: Be[] = []; const missing: string[] = [];
for (const symbol of SYMBOLS) {
  const meta = info.symbols.find((s) => s.symbol === symbol && s.status === 'TRADING');
  if (!meta) { missing.push(symbol); continue; }
  const tick = Number(meta.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize); ticks.set(symbol, tick);
  const bars = await range(symbol, warm, now);
  const first = bars[0]!; const start = first.time - MINUTE;
  const state = initialState(symbol, tick);
  state.mtf = initMtf(start, await history(symbol, undefined, start + MINUTE), await history(symbol, undefined, start + MINUTE, undefined, '5m'), await history(symbol, undefined, start + MINUTE, undefined, '15m'));
  const map = new Map<number, Candle>();
  for (const c of bars) {
    if (state.lastTime !== null && c.time !== state.lastTime + MINUTE) throw new Error(`${symbol}: gap at ${c.time}`);
    const r = processCandle(state, c); map.set(c.time, c);
    for (const e of r.signals) if (e.event === 'breakeven_activated' && c.time >= from)
      bes.push({ time: c.time, symbol, dir: e.direction, pe: e.entry_price, ptp: e.take_profit, stop: e.stop_loss, trend: e.mtf_trend ?? null, id: e.trade_id });
  }
  candles.set(symbol, map); console.error(`${symbol}: ${bars.length} candles, ${bes.filter((b) => b.symbol === symbol).length} breakevens`);
}
bes.sort((a, b) => a.time - b.time || a.symbol.localeCompare(b.symbol));

type T = { symbol: string; dir: 'LONG' | 'SHORT'; entry: number; stop: number; tp: number; liq: number; q: number; m: number; fee: number; slip: number; t0: number; bal0: number; trend: MtfSnapshot | null };
let balance = 5; let peak = 5; let maxDd = 0; let open: T | null = null;
const trades: (T & { exit: number; reason: string; pnl: number; bal1: number; t1: number })[] = []; const skipped: Record<string, number> = {};
function settle(t: T, px: number, reason: string, time: number) {
  const s = t.dir === 'LONG' ? 1 : -1;
  const gross = reason === 'LIQUIDATED' ? -t.m : Math.max(t.q * (px - t.entry) * s - 2 * t.q * t.slip, -t.m);
  const ef = reason === 'LIQUIDATED' ? 0 : t.q * px * 0.0005;
  const nb = Math.max(balance + gross - t.fee - ef, 0);
  trades.push({ ...t, exit: px, reason, pnl: nb - balance, bal1: nb, t1: time }); balance = nb;
  peak = Math.max(peak, balance); maxDd = Math.max(maxDd, (peak - balance) / peak * 100); open = null;
}
let bi = 0;
for (let time = from; time < now; time += MINUTE) {
  if (open && time > open.t0) {
    const c = candles.get(open.symbol)?.get(time);
    if (c) {
      const s = open.dir === 'LONG' ? 1 : -1;
      const stopHit = s === 1 ? c.low <= open.stop : c.high >= open.stop;
      const liqHit = s === 1 ? c.low <= open.liq : c.high >= open.liq;
      const tpHit = s === 1 ? c.high >= open.tp : c.low <= open.tp;
      if (liqHit && (!stopHit || (s === 1 && open.stop < open.liq) || (s === -1 && open.stop > open.liq))) settle(open, open.liq, 'LIQUIDATED', time);
      else if (stopHit) settle(open, open.stop, 'STOP_LOSS', time);
      else if (tpHit) settle(open, open.tp, 'TAKE_PROFIT', time);
    }
  }
  for (; bi < bes.length && bes[bi]!.time === time; bi++) {
    const b = bes[bi]!; const s = b.dir === 'LONG' ? 1 : -1; const side = watchSide(b.trend);
    const t = b.trend;
    const why = !t || t.m15 == null || t.m5 == null || t.m1 == null ? 'TREND_UNKNOWN' : t.m15 === 0 || t.m15 !== t.m5 ? 'NO_15M_5M_BIAS'
      : t.m15 !== s ? 'BIAS_OPPOSITE_SIGNAL' : t.m1 === -s ? 'ONE_MINUTE_OPPOSITE' : balance <= 0 ? 'NO_BALANCE' : open ? 'TRADE_ALREADY_OPEN' : null;
    if (why !== null || side !== b.dir) { skipped[why ?? 'MISMATCH'] = (skipped[why ?? 'MISMATCH'] ?? 0) + 1; continue; }
    const entry = b.pe + s * Math.abs(b.ptp - b.pe) / 1.5;
    const m = Math.round(balance * 0.8 * 1e8) / 1e8; const q = m * 50 / entry; const fee = m * 50 * 0.0005; const slip = ticks.get(b.symbol) ?? 0;
    const tp = (entry * s + (m * 0.10 + fee) / q + 2 * slip) / (s - 0.0005);
    open = { symbol: b.symbol, dir: b.dir, entry, stop: b.stop, tp, liq: entry * (1 - s * (1 / 50 - 0.005)), q, m, fee, slip, t0: time, bal0: balance, trend: t };
  }
}
const wins = trades.filter((t) => t.pnl > 0).length;
const by = (k: string) => trades.filter((t) => t.reason === k).length;
const perCoin: Record<string, { trades: number; wins: number; pnl: number }> = {};
for (const t of trades) { const p = perCoin[t.symbol] ??= { trades: 0, wins: 0, pnl: 0 }; p.trades++; if (t.pnl > 0) p.wins++; p.pnl += t.pnl; }
const report = {
  window: { from: new Date(from).toISOString(), to: new Date(now).toISOString() }, coins: SYMBOLS.length - missing.length, missing,
  breakevens: bes.length, breakevensLong: bes.filter((b) => b.dir === 'LONG').length, breakevensShort: bes.filter((b) => b.dir === 'SHORT').length,
  skipped, trades: trades.length, wins, losses: trades.length - wins, winRate: trades.length ? wins / trades.length * 100 : null,
  takeProfit: by('TAKE_PROFIT'), stopLoss: by('STOP_LOSS'), liquidated: by('LIQUIDATED'), stillOpen: open ? 1 : 0,
  startBalance: 5, endBalance: balance, netPnl: balance - 5, maxDrawdownPct: maxDd,
  fees: trades.reduce((s, t) => s + t.fee + t.q * t.exit * 0.0005, 0), perCoin,
  list: trades.map((t) => ({ opened: new Date(t.t0 + MINUTE).toISOString(), closed: new Date(t.t1 + MINUTE).toISOString(), symbol: t.symbol, side: t.dir,
    trend: t.trend, entry: t.entry, stop: t.stop, tp: t.tp, exit: t.exit, result: t.reason, pnl: t.pnl, balance: t.bal1 })),
};
writeFileSync(out, JSON.stringify(report, null, 2));
const { list: _l, ...summary } = report; console.log(JSON.stringify(summary, null, 2));
