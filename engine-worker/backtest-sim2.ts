/**
 * Simulator 2 backtest on real Binance USD-M 1m candles (read-only public market data).
 * Compares Training 1 rules against Training 3 (trend + realistic-target filters).
 * Pure replay: never writes to the database or sends Telegram.
 * Usage: bun engine-worker/backtest-sim2.ts [days=3]
 */
import { SYMBOLS } from '../src/lib/config';
import { simulate2, type Candle, type Rules } from '../src/lib/engine/sim2-backtest';

const days = Number(process.argv[2] ?? 3);
const BASE = 'https://fapi.binance.com';
const info = await (await fetch(`${BASE}/fapi/v1/exchangeInfo`)).json() as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const end = process.env.BT_END ? Date.parse(process.env.BT_END) : Math.floor(Date.now() / 60000) * 60000 - 60000;
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
  console.log(`balance $5.00 -> $${r.balance.toFixed(2)} | max drawdown ${(r.maxDrawdown * 100).toFixed(1)}% | skipped by trend ${r.skippedTrend} | skipped as unrealistic ${r.skippedRange} | skipped (stop not possible after costs) ${r.skippedCost}`);
  const tp=r.trades.filter(t=>t.reason==='TAKE_PROFIT'),sl=r.trades.filter(t=>t.reason==='STOP_LOSS'),oc=r.trades.filter(t=>t.reason==='ONE_CANDLE');
  const avg=(a:{pnl:number}[])=>a.length?(a.reduce((x,t)=>x+t.pnl,0)/a.length).toFixed(3):'-';
  const pct=(a:{entry:number,sl:number,tp:number}[],k:'sl'|'tp')=>a.length?(a.reduce((x,t)=>x+Math.abs(t[k]-t.entry)/t.entry,0)/a.length*100).toFixed(3)+'%':'-';
  console.log(`avg net: TP ${avg(tp)} SL ${avg(sl)} 1-candle ${avg(oc)} | avg distance to TP ${pct(r.trades,'tp')} SL ${pct(r.trades,'sl')} | net P&L ${(r.balance-5).toFixed(2)}`);
  const bys:Record<string,number[]>={};for(const t of r.trades){(bys[t.symbol]??=[0,0])[t.pnl>0?0:1]++;}console.log('per coin W/L:',Object.entries(bys).map(([k,v])=>`${k.replace('USDT','')} ${v[0]}/${v[1]}`).join(', '));
  for(const t of r.trades.slice(0,10)) console.log(`  ${new Date(t.signalTime).toISOString().slice(5,16)} ${t.symbol} ${t.direction} ${t.reason} ${t.pnl.toFixed(3)} -> $${t.balanceAfter.toFixed(2)}`);
  return r;
};
console.log(`Window ${new Date(start).toISOString()} -> ${new Date(end).toISOString()} (${days} days, ${Object.keys(data).length} coins)`);
const sh = Number(process.argv[3] ?? 0.2), lv = Number(process.argv[4] ?? 20);
const variants: [string, Rules['extra']][] = [['Training 3 (baseline)', undefined], ['A stronger 20-candle trend', 'trend20'], ['B breakout + retest', 'retest'], ['C not overextended', 'noExtend'], ['D minimum volatility (20 candles)', 'vol'], ['E room to target (reward check)', 'room']];
for (const [name, extra] of variants) {
  const r = simulate2(data, { trend: true, realistic: true, share: sh, base: 'margin', lev: lv, hold: 1, extra }, start);
  const n = r.trades.length, h = (k: string) => r.trades.filter(t => t.reason === k).length, w = r.trades.filter(t => t.pnl > 0).length;
  const cost = r.trades.reduce((a, t) => a + t.cost, 0), gross = r.balance - 5 + cost;
  console.log(`VAR ${name}: trades ${n} | wins ${w} losses ${n - w} | win rate ${n ? (w / n * 100).toFixed(1) : '-'}% | net ${(r.balance - 5).toFixed(2)} | before costs ${gross.toFixed(2)} | costs $${cost.toFixed(2)} | maxDD ${(r.maxDrawdown * 100).toFixed(1)}% | final $${r.balance.toFixed(2)} | TP ${h('TAKE_PROFIT')} SL ${h('STOP_LOSS')} TIME ${h('ONE_CANDLE')}`);
  if (!extra) {
    let early = 0, adverse = 0; const pend = r.trades.filter(t => t.reason === 'STOP_LOSS');
    for (const t of r.trades) { const sd = Math.abs(t.entry - t.sl) / t.entry, td = Math.abs(t.tp - t.entry) / t.entry; adverse += sd; early += td; }
    console.log(`  analysis: avg stop distance ${(adverse / Math.max(n,1) * 100).toFixed(3)}% vs avg target distance ${(early / Math.max(n,1) * 100).toFixed(3)}% | stops ${pend.length}/${n} | needed break-even win rate ${(0.05/(0.10+0.05)*100).toFixed(1)}%`);
  }
}
if (process.env.BT_HOLDS) for (const hold of [1, 3, 5]) {
  const r = simulate2(data, { trend: true, realistic: true, share: sh, base: 'margin', lev: lv, hold }, start);
  const n = r.trades.length, h = (k: string) => r.trades.filter(t => t.reason === k).length, w = r.trades.filter(t => t.pnl > 0).length;
  const time = h('TIME_EXIT') + h('ONE_CANDLE'), cost = r.trades.reduce((a, t) => a + t.cost, 0), worst = Math.min(0, ...r.trades.map(t => t.pnl));
  console.log(`HOLD ${hold}: trades ${n} | wins ${w} losses ${n - w} | win rate ${n ? (w / n * 100).toFixed(1) : '-'}% | net ${(r.balance - 5).toFixed(2)} | final $${r.balance.toFixed(2)} | maxDD ${(r.maxDrawdown * 100).toFixed(1)}% | TP ${h('TAKE_PROFIT')} SL ${h('STOP_LOSS')} TIME ${time} LIQ ${h('LIQUIDATED')} | costs $${cost.toFixed(2)} | worst trade ${worst.toFixed(3)} | avg hold ${n ? (r.trades.reduce((a, t) => a + t.held, 0) / n).toFixed(2) : '-'}`);
}
