/**
 * prompt-46 RESEARCH backtest (read-only: no database, no Telegram, live Simulator untouched).
 * Entries: liquidity sweep -> market structure shift -> retrace -> closed rejection candle (src/lib/engine/liquidity-sweep.ts),
 * plus the existing Trend Identify gate (15m = 5m = side, 1m sideways/same). No LONG/SHORT Pine indicators.
 * Settlement: unchanged PINE1 rules (50x, 10% per slot, 3 slots, one per coin, cross margin, no stop, +25% net target, 24h close).
 * Costs: 0.05% fee per side, slippage max(1 tick, 0.02% of price) per side.
 * Usage: bun engine-worker/report-liquidity-sweep.ts [days=7] [outDir=/tmp/ls-report]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { SYMBOLS } from '../src/lib/config';
import { MINUTE, type Candle, type Signal } from '../src/lib/engine/model';
import { initMtf, updateMtf, snapshot } from '../src/lib/engine/mtf-trend';
import { trendSkip } from '../src/lib/engine/simulator-replay';
import { PINE1, closePine1, openPine1, pine1Exit, pine1Skip, type Pine1Position, type Pine1Trade } from '../src/lib/engine/pine1-cross';
import { LiquiditySweep, LS, type Setup } from '../src/lib/engine/liquidity-sweep';
import { binanceFetch, history } from './binance';

const days = Number(process.argv[2] ?? 7); const outDir = process.argv[3] ?? '/tmp/ls-report';
const Q = 15 * MINUTE; const now = Math.floor(Date.now() / Q) * Q; const from = now - days * 86_400_000; const start = from - 86_400_000;
async function range(symbol: string, a: number, b: number) {
  const all: Candle[] = []; let t = a;
  while (t < b) { const part = (await history(symbol, t, b)).filter((c) => c.time < b); if (!part.length) break; all.push(...part); t = part.at(-1)!.time + MINUTE; }
  return all.filter((c, i, x) => i === 0 || c.time > x[i - 1]!.time);
}
const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const candles = new Map<string, Map<number, Candle>>(); const ticks = new Map<string, number>();
const entries = new Map<string, Map<number, Signal[]>>(); const missing: string[] = [];
const rejected: Record<string, number> = {}; let setups = 0; const setupMeta = new Map<string, Setup>();
for (const symbol of SYMBOLS) {
  const meta = info.symbols.find((s) => s.symbol === symbol && s.status === 'TRADING'); if (!meta) { missing.push(symbol); continue; }
  const tick = Number(meta.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize); ticks.set(symbol, tick);
  const f15 = await history(symbol, undefined, start, undefined, '15m'); const f5 = await history(symbol, undefined, start, undefined, '5m');
  const mtf = initMtf(start - MINUTE, await history(symbol, undefined, start), f5, f15);
  const det = new LiquiditySweep(); det.seedHtf(f15, f5);
  const bars = await range(symbol, start, now);
  if (bars[0]?.time !== start || bars.length !== (now - start) / MINUTE) throw new Error(`${symbol}: incomplete 1-minute candles`);
  const map = new Map<number, Candle>(); const ev = new Map<number, Signal[]>();
  for (const c of bars) {
    map.set(c.time, c); updateMtf(mtf, c); const trend = snapshot(mtf);
    for (const r of det.step(c)) {
      if (r === null || c.time < from) continue;
      if (typeof r === 'string') { rejected[r] = (rejected[r] ?? 0) + 1; continue; }
      const why = trendSkip(trend, r.side); if (why) { rejected[`TREND_IDENTIFY_${why}`] = (rejected[`TREND_IDENTIFY_${why}`] ?? 0) + 1; continue; }
      setups++; const id = `${symbol}-${r.side}-${c.time}`; setupMeta.set(id, r);
      const sig = { trade_id: id, symbol, direction: r.side, entry_price: r.entry, mtf_trend: trend, event: 'entry_confirmed' } as unknown as Signal;
      ev.set(c.time, [...(ev.get(c.time) ?? []), sig]);
    }
  }
  candles.set(symbol, map); entries.set(symbol, ev); console.error(`${symbol}: ${bars.length} candles`);
}
let balance = new Decimal(PINE1.startBalance); let peak = balance; let maxDd = new Decimal(0); let eqPeak = balance; let maxEqDd = new Decimal(0);
let opens: Pine1Position[] = []; const trades: Pine1Trade[] = []; const skipped: Record<string, number> = {};
const reserved = (ex?: Pine1Position) => opens.filter((o) => o !== ex).reduce((a, o) => a.plus(o.margin), new Decimal(0));
for (let t = from; t < now; t += MINUTE) {
  for (const symbol of SYMBOLS) {
    const open = opens.find((o) => o.symbol === symbol); const c = candles.get(symbol)?.get(t); if (!c) continue;
    if (open && t > open.openedCandle) { const r = pine1Exit(open, c);
      if (r) { const done = closePine1(open, r, t, balance, c.close, reserved(open)); trades.push(done); balance = new Decimal(done.balanceAfter); opens = opens.filter((o) => o !== open);
        peak = Decimal.max(peak, balance); maxDd = Decimal.max(maxDd, peak.minus(balance).div(peak).mul(100)); } }
    for (const e of entries.get(symbol)?.get(t) ?? []) {
      const why = pine1Skip(e, balance, opens); if (why) { skipped[why] = (skipped[why] ?? 0) + 1; continue; }
      opens.push(openPine1(e, t, Math.max(ticks.get(symbol)!, e.entry_price * 0.0002), balance, reserved()));
    }
  }
  const eq = opens.reduce((a, o) => { const px = candles.get(o.symbol)!.get(t)!.close; return a.plus(new Decimal(o.quantity).mul(new Decimal(px).minus(o.entry)).mul(o.direction === 'LONG' ? 1 : -1)); }, balance);
  eqPeak = Decimal.max(eqPeak, eq); if (eqPeak.gt(0)) maxEqDd = Decimal.max(maxEqDd, eqPeak.minus(eq).div(eqPeak).mul(100));
}
const n = (x: Decimal.Value, d = 4) => Number(new Decimal(x).toFixed(d));
const stats = (xs: Pine1Trade[]) => { const tp = xs.filter((t) => t.reason === 'TAKE_PROFIT');
  const avg = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  return { closed: xs.length, takeProfit: tp.length, tpPct: xs.length ? n(tp.length / xs.length * 100, 1) : null,
    closedAfter24h: xs.filter((t) => t.reason === 'TIME_EXIT').length, liquidated: xs.filter((t) => t.reason === 'LIQUIDATED').length,
    avgMinutesToTp: avg(tp.map((t) => (t.closedCandle - t.openedCandle) / MINUTE)), avgEntryToTpMovePct: avg(tp.map((t) => Math.abs(Number(t.target) / Number(t.entry) - 1) * 100)),
    netPnl: n(xs.reduce((a, t) => a.plus(t.pnl), new Decimal(0))), fees: n(xs.reduce((a, t) => a.plus(t.entryFee).plus(t.exitFee), new Decimal(0))) }; };
const lastPx = (s: string) => candles.get(s)!.get(now - MINUTE)!.close;
const summary = {
  window: { from: new Date(from).toISOString(), to: new Date(now).toISOString() }, coinsTested: SYMBOLS.length - missing.length, missing, parameters: LS,
  qualifiedSetups: setups, rejectedByQualityFilters: rejected, skippedBySlotsOrBalance: skipped,
  all: stats(trades), long: stats(trades.filter((t) => t.direction === 'LONG')), short: stats(trades.filter((t) => t.direction === 'SHORT')),
  stillOpen: opens.map((o) => ({ symbol: o.symbol, side: o.direction, opened: new Date(o.openedCandle + MINUTE).toISOString(), entry: o.entry, lastPrice: lastPx(o.symbol),
    unrealized: n(new Decimal(o.quantity).mul(new Decimal(lastPx(o.symbol)).minus(o.entry)).mul(o.direction === 'LONG' ? 1 : -1).minus(o.entryFee)) })),
  startBalance: PINE1.startBalance, endBalance: n(balance), netProfitAfterFees: n(balance.minus(PINE1.startBalance)),
  maxDrawdownClosedPct: n(maxDd, 2), maxDrawdownMarkToMarketPct: n(maxEqDd, 2),
};
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
const head = 'opened_utc,closed_utc,coin,side,swept_level,sweep_extreme,mss_level,liquidity_target,entry,take_profit,exit,result,minutes_open,fees_usdt,net_pnl_usdt,balance_after_usdt';
const label = (r: string) => r === 'TAKE_PROFIT' ? 'Take profit hit' : r === 'TIME_EXIT' ? 'Closed after 24 hours' : 'Liquidated';
writeFileSync(`${outDir}/trades.csv`, [head, ...trades.map((t) => { const m = setupMeta.get(t.tradeId)!; return [new Date(t.openedCandle + MINUTE).toISOString(), new Date(t.closedCandle + MINUTE).toISOString(),
  t.symbol, t.direction, m.sweptLevel, m.sweepExtreme, m.mssLevel, m.drawLevel, t.entry, n(t.target, 8), t.exit, label(t.reason), (t.closedCandle - t.openedCandle) / MINUTE,
  n(new Decimal(t.entryFee).plus(t.exitFee)), n(t.pnl), n(t.balanceAfter)].join(','); })].join('\n') + '\n');
console.log(JSON.stringify(summary, null, 2));
