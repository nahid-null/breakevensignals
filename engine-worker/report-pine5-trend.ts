/**
 * Previous-N-day offline replay of the prompt-39 Simulator rule on real Binance USD-M candles.
 * Same pure code as the live worker (processMinute + Trend Identify) and the same settlement as
 * public.simulate_engine_candle (src/lib/engine/pine5-sim.ts). Read-only: no database, no Telegram.
 * Usage: bun engine-worker/report-pine5-trend.ts [days=7] [outDir=/tmp/pine5-report]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { SYMBOLS } from '../src/lib/config';
import { initialState, MINUTE, FIVE_MINUTES, type Candle, type Signal } from '../src/lib/engine/model';
import { initMtf } from '../src/lib/engine/mtf-trend';
import { buildFive, bucketStart, processMinute } from '../src/lib/engine/five-minute';
import { PINE5, closePine5, openPine5, pine5Liquidated, pine5Skip, receiptStatus, type Pine5Position, type Pine5Trade } from '../src/lib/engine/pine5-sim';
import { binanceFetch, history } from './binance';

const days = Number(process.argv[2] ?? 7); const outDir = process.argv[3] ?? '/tmp/pine5-report';
const now = bucketStart(Date.now()); const from = now - days * 86_400_000; const start = bucketStart(from - 86_400_000);
async function range(symbol: string, a: number, b: number) {
  const all: Candle[] = []; let t = a;
  while (t < b) { const part = (await history(symbol, t, b)).filter((c) => c.time < b); if (!part.length) break; all.push(...part); t = part.at(-1)!.time + MINUTE; }
  return all.filter((c, i, x) => i === 0 || c.time > x[i - 1]!.time);
}
const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const candles = new Map<string, Map<number, Candle>>(); const ticks = new Map<string, number>();
const events = new Map<string, Map<number, Signal[]>>(); const missing: string[] = []; const hashes: Record<string, string> = {};
let pineEntries = 0;
for (const symbol of SYMBOLS) {
  const meta = info.symbols.find((s) => s.symbol === symbol && s.status === 'TRADING');
  if (!meta) { missing.push(symbol); continue; }
  const tick = Number(meta.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize); ticks.set(symbol, tick);
  const last = start - MINUTE;
  const state = initialState(symbol, tick);
  state.mtf = initMtf(last, await history(symbol, undefined, start), await history(symbol, undefined, start, undefined, '5m'), await history(symbol, undefined, start, undefined, '15m'));
  state.five = buildFive(symbol, tick, last, await history(symbol, undefined, start, undefined, '5m'), []).five;
  const bars = await range(symbol, start, now);
  if (bars[0]?.time !== start || bars.length !== (now - start) / MINUTE) throw new Error(`${symbol}: incomplete 1-minute candles`);
  hashes[symbol] = createHash('sha256').update(JSON.stringify(bars)).digest('hex');
  const map = new Map<number, Candle>(); const ev = new Map<number, Signal[]>();
  for (const c of bars) {
    const r = processMinute(state, c); map.set(c.time, c);
    const five = r.signals.filter((s) => s.timeframe === '5');
    if (five.length) ev.set(c.time, five);
    if (c.time >= from) pineEntries += five.filter((s) => s.event === 'entry_confirmed').length;
  }
  candles.set(symbol, map); events.set(symbol, ev);
  console.error(`${symbol}: ${bars.length} candles`);
}
let balance = new Decimal(PINE5.startBalance); let peak = balance; let maxDd = new Decimal(0); let open: Pine5Position | null = null;
const trades: Pine5Trade[] = []; const decisions: { time: string; symbol: string; side: string; trend: unknown; decision: string }[] = [];
const close = (px: Decimal.Value, reason: Pine5Trade['reason'], t: number) => {
  const done = closePine5(open!, px, reason, t, balance); trades.push(done); balance = new Decimal(done.balanceAfter);
  peak = Decimal.max(peak, balance); maxDd = Decimal.max(maxDd, peak.minus(balance).div(peak).mul(100)); open = null;
};
for (let t = from; t < now; t += MINUTE) for (const symbol of SYMBOLS) {
  const ev = events.get(symbol)?.get(t) ?? [];
  if (open && open.symbol === symbol && t > open.openedCandle) {
    const c = candles.get(symbol)!.get(t)!;
    const exit = ev.find((e) => e.trade_id === open!.tradeId && (e.event === 'stop_loss_hit' || e.event === 'take_profit_hit'));
    if (pine5Liquidated(open, c)) close(open.liquidation, 'LIQUIDATED', t);
    else if (exit) close(exit.exit_price!, exit.event === 'take_profit_hit' ? 'TAKE_PROFIT' : open.breakeven ? 'BREAKEVEN' : 'STOP_LOSS', t);
  }
  for (const e of ev) {
    if (e.event === 'breakeven_activated' && open?.tradeId === e.trade_id) {
      open.breakeven = true; open.stop = Decimal[open.direction === 'LONG' ? 'max' : 'min'](open.stop, e.stop_loss).toString();
    }
    if (e.event !== 'entry_confirmed') continue;
    const why = pine5Skip(e, balance, true, open !== null);
    decisions.push({ time: new Date(t + MINUTE).toISOString(), symbol, side: e.direction, trend: e.mtf_trend, decision: why ?? 'TRADED' });
    if (!why) open = openPine5(e, t, ticks.get(symbol)!, balance);
  }
}
const n = (x: Decimal.Value) => Number(new Decimal(x).toFixed(8));
const wins = trades.filter((t) => new Decimal(t.pnl).gt(0));
const sum = (xs: Pine5Trade[], f: (t: Pine5Trade) => Decimal.Value) => xs.reduce((a, t) => a.plus(f(t)), new Decimal(0));
const skipped: Record<string, number> = {}; for (const d of decisions) if (d.decision !== 'TRADED') skipped[d.decision] = (skipped[d.decision] ?? 0) + 1;
const perCoin: Record<string, { trades: number; wins: number; pnl: number }> = {};
for (const t of trades) { const p = perCoin[t.symbol] ??= { trades: 0, wins: 0, pnl: 0 }; p.trades++; if (new Decimal(t.pnl).gt(0)) p.wins++; p.pnl = n(new Decimal(p.pnl).plus(t.pnl)); }
const status = (r: string) => trades.filter((t) => receiptStatus(t.reason) === r).length;
const summary = {
  window: { from: new Date(from).toISOString(), to: new Date(now).toISOString() }, coinsTested: SYMBOLS.length - missing.length, missing,
  rule: 'Original LONG/SHORT Pine on 5m; trade only when Trend Identify 15m=5m=side and 1m sideways/same; Pine entry/TP/SL; 25x; 50% of balance; one trade; 0.05% fee/side; 1 tick slippage/side',
  pineEntries, traded: trades.length + (open ? 1 : 0), skipped, closedTrades: trades.length, stillOpen: open ? 1 : 0,
  wins: wins.length, losses: trades.length - wins.length, winRate: trades.length ? wins.length / trades.length * 100 : null,
  takeProfitHit: status('Take profit hit'), stopLossHit: status('Stop loss hit'),
  breakevenStops: trades.filter((t) => t.reason === 'BREAKEVEN').length, liquidated: trades.filter((t) => t.reason === 'LIQUIDATED').length,
  startBalance: PINE5.startBalance, endBalance: n(balance), netPnl: n(balance.minus(PINE5.startBalance)),
  grossProfit: n(sum(wins, (t) => t.pnl)), grossLoss: n(sum(trades.filter((t) => new Decimal(t.pnl).lte(0)), (t) => t.pnl)),
  fees: n(sum(trades, (t) => new Decimal(t.entryFee).plus(t.exitFee))), maxDrawdownPct: n(maxDd), perCoin, candleHashes: hashes,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${outDir}/decisions.json`, JSON.stringify(decisions, null, 2));
const head = 'opened_utc,closed_utc,coin,side,trend_15m,trend_5m,trend_1m,entry,take_profit,stop_loss,exit,status,detail,margin_usdt,fees_usdt,net_pnl_usdt,balance_after_usdt';
const rows = trades.map((t) => [new Date(t.openedCandle + MINUTE).toISOString(), new Date(t.closedCandle + MINUTE).toISOString(), t.symbol, t.direction,
  t.trend?.m15, t.trend?.m5, t.trend?.m1, t.entry, t.target, t.stop, t.exit, receiptStatus(t.reason),
  t.reason === 'BREAKEVEN' ? 'stop at breakeven line' : t.reason === 'LIQUIDATED' ? 'liquidated first' : '',
  t.margin, n(new Decimal(t.entryFee).plus(t.exitFee)), n(t.pnl), n(t.balanceAfter)].join(','));
writeFileSync(`${outDir}/trades.csv`, [head, ...rows].join('\n') + '\n');
console.log(JSON.stringify({ ...summary, candleHashes: undefined }, null, 2));
void FIVE_MINUTES;
