/**
 * prompt-57 research only: replays the live OB + Weighted VP indicator (src/lib/engine/ob-vp.ts, unchanged) over
 * Binance SPOT 5m candles and writes its raw signals for the offline Python portfolio study. No database, no network.
 * Usage: bun research/prompt-57/obvp-signals.ts <spot5m.json> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { initialObvp, processObvp } from '../../src/lib/engine/ob-vp';

const [inp, out] = process.argv.slice(2) as [string, string];
const data = JSON.parse(readFileSync(inp, 'utf8')) as Record<string, number[][]>;
const res: { symbol: string; time: number; direction: string; entry: number; score: number }[] = [];
for (const [symbol, rows] of Object.entries(data)) {
  const s = initialObvp();
  for (const [time, open, high, low, close, volume] of rows) {
    for (const x of processObvp(s, { time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume! }))
      res.push({ symbol, time: x.time, direction: x.direction, entry: x.entry, score: x.score });
  }
}
writeFileSync(out, JSON.stringify(res));
console.log('signals', res.length);
