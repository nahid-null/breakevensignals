/**
 * Simulator 2 backtest on real Binance USD-M 1m candles (read-only public market data).
 * Compares Training 1 rules against Training 3 (trend + realistic-target filters).
 * Pure replay: never writes to the database or sends Telegram.
 * Usage: bun engine-worker/backtest-sim2.ts [days=3]
 */
import { SYMBOLS } from '../src/lib/symbols';
import { simulate2, type Candle, type Rules } from '../src/lib/engine/sim2-backtest';

const days = Number(process.argv[2] ?? 3);
const BASE = 'https://fapi.binance.com';
const info = await (await fetch(`${BASE}/fapi/v1/exchangeInfo`)).json() as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const end = Math.floor(Date.now() / 60000) * 60000 - 60000;
const start = end - days * 1440 * 60000;
const data: Record<string, { tick: number; candles: Candle[] }> = {};
for (const s of SYMBOLS) {
  const meta = info.symbols.find(x => x.symbol === s && x.status === 'TRADING');
  if (!meta) { console.log(`${s}: unavailable on Binance USD-M, skipped`); continue; }
  const tick = Number(meta.filters.find(f => f.filterType === 'PRICE_FILTER')!.tickSize);
  const candles: Candle[] = [];
  for (let t = start - 30 * 60000; t < end; ) {
    const rows = await (await fetch(`${BASE}/fapi/v1/klines?symbol=${s}&interval=1m&startTime=${t}&endTime=${end - 1}&limit=1500`)).json() as (string | number)[][];
    if (!rows.length) break;
    for (const r of rows) if (Number(r[6]) < end) candles.push({ time: Number(r[0]), open: +r[1], high: +r[2], low: +r[3], close: +r[4] });
    t = Number(rows[rows.length - 1][0]) + 60000;
  }
  data[s] = { tick, candles };
}
const report = (name: string, rules: Rules) => {
  const r = simulate2(data, rules, start);
  const by = (k: string) => r.trades.filter(t => t.reason === k).length;
  console.log(`\n== ${name} ==`);
  console.log(`trades ${r.trades.length} | wins ${r.trades.filter(t => t.pnl > 0).length} | losses ${r.trades.filter(t => t.pnl <= 0).length} | TP ${by('TAKE_PROFIT')} SL ${by('STOP_LOSS')} ONE_CANDLE ${by('ONE_CANDLE')} LIQ ${by('LIQUIDATED')}`);
  console.log(`balance $5.00 -> $${r.balance.toFixed(2)} | max drawdown ${(r.maxDrawdown * 100).toFixed(1)}% | skipped by trend ${r.skippedTrend} | skipped as unrealistic ${r.skippedRange}`);
  return r;
};
console.log(`Window ${new Date(start).toISOString()} -> ${new Date(end).toISOString()} (${days} days, ${Object.keys(data).length} coins)`);
report('Training 1 (current live rules)', { trend: false, realistic: false });
report('Training 3 (trend + realistic target)', { trend: true, realistic: true });
