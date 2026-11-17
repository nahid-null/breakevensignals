/** Offline read-only analysis; never imports hosted APIs, Telegram or worker startup. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SYMBOLS } from '../src/lib/config';
import { initialState, MINUTE, type Candle } from '../src/lib/engine/model';
import { processCandle } from '../src/lib/engine/scalper';
import { initMtf } from '../src/lib/engine/mtf-trend';
import { comparisonConfigs, CURRENT_REPLAY, replaySimulator, type ReplayFeed } from '../src/lib/engine/simulator-replay';
import { binanceFetch, history } from './binance';

const old = JSON.parse(await readFile('/tmp/sim-trend-report.json','utf8')) as { window: { from: string; to: string } };
const from = Date.parse(old.window.from); const to = Date.parse(old.window.to); const warm = from - 86_400_000;
const dir = '/tmp/simulator-audit'; await mkdir(dir, { recursive: true });
const meta = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const missing: string[] = []; const feeds: ReplayFeed[] = []; const sources: unknown[] = [];
for (const symbol of SYMBOLS) {
  const m = meta.symbols.find(s => s.symbol === symbol && s.status === 'TRADING');
  if (!m) { missing.push(symbol); continue; }
  const tick = Number(m.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize);
  if (!(tick > 0)) throw new Error(`Missing tick ${symbol}`);
  const cache = `${dir}/${symbol}.json`;
  let data: { bars: Candle[]; minutes: Candle[]; fives: Candle[]; fifteens: Candle[] };
  try { data = JSON.parse(await readFile(cache,'utf8')); }
  catch {
    const bars: Candle[] = []; let t = warm;
    while(t < to) {
      const part = await history(symbol,t,to); const last = part.at(-1);
      if (!last) throw new Error(`Missing candles ${symbol} at ${t}`);
      bars.push(...part); t = last.time + MINUTE;
    }
    const end = warm;
    data = { bars, minutes: await history(symbol,undefined,end), fives: await history(symbol,undefined,end,undefined,'5m'), fifteens: await history(symbol,undefined,end,undefined,'15m') };
    await writeFile(cache,JSON.stringify(data));
  }
  if(data.bars.length !== (to-warm)/MINUTE || data.bars[0]?.time !== warm || data.bars.at(-1)?.time !== to-MINUTE) throw new Error(`Incomplete ${symbol} coverage`);
  if(Math.min(data.minutes.length,data.fives.length,data.fifteens.length) < 200) throw new Error(`Insufficient seed ${symbol}`);
  const state = initialState(symbol,tick); state.mtf = initMtf(warm-MINUTE,data.minutes,data.fives,data.fifteens);
  const events: ReplayFeed['events'] = [];
  for(const c of data.bars) {
    const r = processCandle(state,c);
    if(c.time >= from) for(const e of r.signals) if(e.event === 'breakeven_activated') events.push({ time: c.time, signal: e });
  }
  const candles = data.bars.filter(c => c.time >= from); feeds.push({symbol,tick,candles,events});
  sources.push({symbol,tick,windowCandles:candles.length,warmupCandles:data.bars.length-candles.length,seed1m:data.minutes.length,seed5m:data.fives.length,seed15m:data.fifteens.length,
    sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),first:candles[0]?.time,last:candles.at(-1)?.time});
  console.log(`${symbol}: ${candles.length} verified window candles; ${events.length} breakevens`);
}
await writeFile(`${dir}/feeds.json`,JSON.stringify(feeds));
const baseline = replaySimulator(feeds,from,to,CURRENT_REPLAY);
const configs = comparisonConfigs(); const comparisons = configs.map(cfg => {
  const r = replaySimulator(feeds,from,to,cfg); const { trades, decisions, ...summary } = r;
  return { ...summary, tradesFile: `${cfg.id}.json`, averageNetMarginRoi: trades.length ? trades.reduce((s,t) => s + Number(t.pnl)/Number(t.margin)*100,0)/trades.length : null };
});
// Detailed ledger for every experimental run, kept read-only and separate from hosted history.
for(const cfg of configs) await writeFile(`${dir}/${cfg.id}.json`,JSON.stringify(replaySimulator(feeds,from,to,cfg)));
const result = { generatedAt:new Date().toISOString(),window:old.window,missing,sources,baseline,comparisons,
  assumptions:['Original processCandle with unchanged Pine logic and previous-closed Trend Identify readings.','One-day Pine warmup plus 1500-bar independent 1m/5m/15m trend seeds.','Configured symbol order per minute; historical socket arrival order unknown.','Stop-first if stop and target touched in the same candle; fills at modeled levels, not executable quotes.','0.05% entry and exit fees; one tick per side; no exit fee on modeled liquidation.','Funding, bid/ask spread, minimum notional, lot-size rules and variable market impact unavailable/not modeled.','One open trade, $5 initial balance, no deposits/resets; open positions not forced closed.','Round margin to eight decimal places, stop replay on SQL-equivalent zero-quantity division instead of inventing trades.'] };
await writeFile(`${dir}/analysis.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({signals:baseline.signals,executed:baseline.executed,closed:baseline.closed,skipped:baseline.skipped,errors:baseline.errors,notProcessed:baseline.notProcessed,endingBalance:baseline.endingBalance,failure:baseline.failure,comparisons:comparisons.length},null,2));