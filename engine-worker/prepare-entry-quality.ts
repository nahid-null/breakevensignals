/** prompt-38: public candle download only for the untouched Oct13–Nov10 window; no evaluation, hosted database or notifications. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SYMBOLS } from '../src/lib/config';
import { MINUTE, validateCandle, type Candle } from '../src/lib/engine/model';
import { history } from './binance';
const dir = '/tmp/entry-quality-study'; await mkdir(dir, { recursive: true });
const from = Date.parse('2026-10-13T00:00:00Z'); const to = Date.parse('2026-11-10T00:00:00Z'); const warm = from - 5 * 86400000;
const meta = JSON.parse(await readFile('/tmp/profitability-study/exchange-info.json', 'utf8')) as { symbols: { symbol: string; status: string }[] };
const queue = SYMBOLS.filter(s => meta.symbols.some(m => m.symbol === s && m.status === 'TRADING'));
async function run() { while (queue.length) { const symbol = queue.shift(); if (!symbol) return;
  const file = `${dir}/${symbol}-holdout-raw.json`;
  try { await readFile(file); console.log(`${symbol}: cached`); continue; } catch { /* download */ }
  const bars: Candle[] = []; let t = warm;
  while (t < to) { const part = await history(symbol, t, to); const last = part.at(-1); if (!last) throw new Error(`Missing ${symbol} ${t}`); bars.push(...part.filter(c => c.time < to)); t = last.time + MINUTE; }
  if (bars.length !== (to - warm) / MINUTE) throw new Error(`Incomplete ${symbol} ${bars.length}`);
  bars.forEach((c, i) => { validateCandle(c); if (c.time !== warm + i * MINUTE) throw new Error(`Gap ${symbol}`); });
  await writeFile(file, JSON.stringify(bars)); console.log(`${symbol}: verified ${bars.length}`);
} }
await Promise.all([run(), run(), run(), run()]);
console.log('HOLDOUT DOWNLOAD COMPLETE');
