/**
 * prompt-51 previous-N-day offline replay of the live Simulator rule: entries ONLY from the OB + Weighted VP indicator on
 * Binance SPOT 5-minute bars (prompt-52, same advanceObvp path as the worker; trades settle on futures 1m prices), 50x, 5% of balance per slot, 6 slots (prompt-52), one per coin, no stop loss,
 * no time limit, +25% net of margin target, cross-margin liquidation (mirrors public.simulate_engine_candle OBVP5_CROSS).
 * Read-only: no database, no Telegram. Usage: bun engine-worker/report-obvp5.ts [days=7] [outDir=/tmp/obvp5-report]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { SYMBOLS } from '../src/lib/config';
import { initialState, MINUTE, type Candle, type Signal } from '../src/lib/engine/model';
import { advanceObvp, buildFive, bucketStart, processMinute } from '../src/lib/engine/five-minute';
import { PINE1, closePine1, openPine1, type Pine1Position, type Pine1Trade } from '../src/lib/engine/pine1-cross';
import { OBVP_SIM, type SimulatorEntry } from '../src/lib/engine/ob-vp';
import { binanceFetch, history, spotHistory } from './binance';

const days = Number(process.argv[2] ?? 7); const outDir = process.argv[3] ?? '/tmp/obvp5-report';
const now = bucketStart(Date.now()); const from = now - days * 86_400_000; const start = from;
async function range(symbol: string, a: number, b: number) {
  const all: Candle[] = []; let t = a;
  while (t < b) { const part = (await history(symbol, t, b)).filter((c) => c.time < b); if (!part.length) break; all.push(...part); t = part.at(-1)!.time + MINUTE; }
  return all.filter((c, i, x) => i === 0 || c.time > x[i - 1]!.time);
}
const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const candles = new Map<string, Map<number, Candle>>(); const ticks = new Map<string, number>();
const entries = new Map<string, Map<number, SimulatorEntry[]>>(); const missing: string[] = [];
let signals = 0; const perCoin: Record<string, number> = {};
for (const symbol of SYMBOLS) {
  const meta = info.symbols.find((s) => s.symbol === symbol && s.status === 'TRADING');
  if (!meta) { missing.push(symbol); continue; }
  const tick = Number(meta.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize); ticks.set(symbol, tick);
  const state = initialState(symbol, tick);
  const spot: Candle[] = await spotHistory(symbol, undefined, start);
  for (let t = start; t < now;) { const part = await spotHistory(symbol, t, now); if (!part.length) break; spot.push(...part); t = part.at(-1)!.time + 5 * MINUTE; }
  const built = buildFive(symbol, tick, start - MINUTE, await history(symbol, undefined, start, undefined, '5m'), [], spot);
  state.five = built.five; state.obvp = built.obvp;
  const bars = await range(symbol, start, now);
  if (bars[0]?.time !== start || bars.length !== (now - start) / MINUTE) throw new Error(`${symbol}: incomplete 1-minute candles`);
  const map = new Map<number, Candle>(); const ev = new Map<number, SimulatorEntry[]>();
  for (const c of bars) {
    const r = processMinute(state, c); map.set(c.time, c);
    const e = r.fiveClosed === null ? [] : advanceObvp(state, spot, r.fiveClosed).entries;
    if (e.length) { ev.set(c.time, e); signals += e.length; perCoin[symbol] = (perCoin[symbol] ?? 0) + e.length; }
  }
  candles.set(symbol, map); entries.set(symbol, ev);
  console.error(`${symbol}: ${bars.length} candles, ${perCoin[symbol] ?? 0} indicator signals`);
}
let balance = new Decimal(PINE1.startBalance); let peak = balance; let maxDd = new Decimal(0); let opens: Pine1Position[] = [];
const trades: Pine1Trade[] = []; const skips: Record<string, number> = {};
const reserved = () => opens.reduce((a, o) => a.plus(o.margin), new Decimal(0));
for (let t = from; t < now; t += MINUTE) for (const symbol of SYMBOLS) {
  const c = candles.get(symbol)?.get(t); if (!c) continue;
  const open = opens.find((o) => o.symbol === symbol);
  if (open && t > open.openedCandle) {
    const L = open.direction === 'LONG';
    const reason = (L ? c.low <= Number(open.liquidation) : c.high >= Number(open.liquidation)) ? 'LIQUIDATED'
      : (L ? c.high >= Number(open.target) : c.low <= Number(open.target)) ? 'TAKE_PROFIT' : null;
    if (reason) {
      const other = opens.filter((o) => o !== open).reduce((a, o) => a.plus(o.margin), new Decimal(0));
      const done = closePine1(open, reason, t, balance, undefined, other); trades.push(done); balance = new Decimal(done.balanceAfter);
      peak = Decimal.max(peak, balance); maxDd = Decimal.max(maxDd, peak.minus(balance).div(peak).mul(100)); opens = opens.filter((o) => o !== open);
    }
  }
  for (const e of entries.get(symbol)?.get(t) ?? []) {
    const m = balance.mul(OBVP_SIM.marginShare).toDecimalPlaces(8);
    const why = m.lte(0) || balance.minus(reserved()).lt(m) ? 'NO_BALANCE' : opens.some((o) => o.symbol === symbol) ? 'COIN_ALREADY_OPEN'
      : opens.length >= OBVP_SIM.slots ? 'ALL_SLOTS_IN_USE' : null;
    if (why) { skips[why] = (skips[why] ?? 0) + 1; continue; }
    opens.push(openPine1({ trade_id: e.trade_id, symbol, direction: e.direction, entry_price: e.entry_price } as unknown as Signal, t, ticks.get(symbol)!, balance, reserved(), OBVP_SIM.marginShare));
  }
}
const lastPx = (s: string) => candles.get(s)?.get(now - MINUTE)?.close ?? 0;
const unrealized = opens.reduce((a, o) => a + (o.direction === 'LONG' ? 1 : -1) * Number(o.quantity) * (lastPx(o.symbol) - Number(o.entry)), 0);
const summary = { window: { from: new Date(from).toISOString(), to: new Date(now).toISOString() }, coins: SYMBOLS.length - missing.length, missing,
  indicatorSignals: signals, signalsPerCoin: perCoin, tradesOpened: trades.length + opens.length, closed: trades.length,
  takeProfit: trades.filter((t) => t.reason === 'TAKE_PROFIT').length, liquidated: trades.filter((t) => t.reason === 'LIQUIDATED').length,
  stillOpen: opens.map((o) => ({ symbol: o.symbol, side: o.direction, entry: o.entry, liquidation: o.liquidation, margin: o.margin, opened: new Date(o.openedCandle + MINUTE).toISOString(), lastPrice: lastPx(o.symbol) })),
  skipped: skips, startBalance: PINE1.startBalance, endBalance: balance.toNumber(), unrealizedOnOpen: unrealized, maxDrawdownPct: maxDd.toNumber() };
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/obvp5-summary.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${outDir}/obvp5-trades.csv`, ['symbol,side,opened_utc,closed_utc,entry,exit,result,margin,net_pnl,balance_after',
  ...trades.map((t) => [t.symbol, t.direction, new Date(t.openedCandle + MINUTE).toISOString(), new Date(t.closedCandle + MINUTE).toISOString(), t.entry, t.exit,
    t.reason === 'TAKE_PROFIT' ? 'Take profit hit' : 'Liquidated (cross margin)', t.margin, Number(t.pnl).toFixed(6), Number(t.balanceAfter).toFixed(6)].join(','))].join('\n'));
console.log(JSON.stringify(summary, null, 2));
