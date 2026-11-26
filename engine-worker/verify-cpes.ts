// Verification-only: runs the INTACT uploaded CPES Pine source in PineTS on the same AUD/JPY M3 candles
// and compares LONG/SHORT entries bar-by-bar with the native TypeScript port. No database, secrets or Telegram.
import { readFile } from 'node:fs/promises';
import { PineTS, type ISymbolInfo } from 'pinets';
import { runCorrectedPine } from './pine-runtime';
import { runCpes } from '../src/lib/forex/cpes';
import { cleanMinutes, toM3, type RawRow } from '../src/lib/forex/candles';

const raw = JSON.parse(await readFile(new URL('../research/prompt-78/data/audjpy-1m-yahoo.json', import.meta.url), 'utf8')) as { rows: RawRow[] };
const m3 = toM3(cleanMinutes(raw.rows));
const native = runCpes(m3);
const source = await readFile(new URL('../research/prompt-78/Candle_Pattern_Signals_1m_3-2.original.pine', import.meta.url), 'utf8');
const code = `${source}\nplot(longEntry ? 1 : 0, "VERIFY_long")\nplot(shortEntry ? 1 : 0, "VERIFY_short")\nplot(adxV, "VERIFY_adx")\nplot(rsiV, "VERIFY_rsi")\nplot(emaT, "VERIFY_ema")\n`;
const bars = m3.map((b) => ({ open: b.o, high: b.h, low: b.l, close: b.c, volume: 0, openTime: b.t * 1000, closeTime: b.t * 1000 + 180000,
  quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 }));
const meta = { ticker: 'AUDJPY', tickerid: 'FX:AUDJPY', mintick: 0.001, pricescale: 1000, type: 'forex', timezone: 'Etc/UTC', session: '24x5', currency: 'JPY', basecurrency: 'AUD' } as unknown as ISymbolInfo;
const provider = { async getMarketData() { return bars; }, async getSymbolInfo() { return meta; }, configure() {} };
const runtime = new PineTS(provider, 'AUDJPY', '3', bars.length, bars[0]?.openTime, bars.at(-1)?.closeTime);
const out = process.argv.includes('--uncorrected') ? await runtime.run(code) : await runCorrectedPine(runtime, code);
const ref = { LONG: new Set<number>(), SHORT: new Set<number>() };
let maxAdx = 0, maxRsi = 0, maxEma = 0;
bars.forEach((b, i) => {
  const at = (n: string) => out.plots[`VERIFY_${n}`]?.data[i];
  if (at('long')?.time !== b.openTime) throw new Error(`misaligned bar ${i}`);
  if (at('long')?.value === 1) ref.LONG.add(b.openTime / 1000);
  if (at('short')?.value === 1) ref.SHORT.add(b.openTime / 1000);
  if (i > 300) {
    const d = (n: string, v: number) => { const x = Number(at(n)?.value); return Number.isFinite(x) && Number.isFinite(v) ? Math.abs(x - v) : 0; };
    maxAdx = Math.max(maxAdx, d('adx', native.series.adx[i]!)); maxRsi = Math.max(maxRsi, d('rsi', native.series.rsi[i]!)); maxEma = Math.max(maxEma, d('ema', native.series.ema[i]!));
  }
});
const nat = { LONG: new Set(native.signals.filter((s) => s.side === 'LONG').map((s) => s.t)), SHORT: new Set(native.signals.filter((s) => s.side === 'SHORT').map((s) => s.t)) };
for (const side of ['LONG', 'SHORT'] as const) {
  const onlyPine = [...ref[side]].filter((t) => !nat[side].has(t)), onlyNative = [...nat[side]].filter((t) => !ref[side].has(t));
  console.log(side, 'pine', ref[side].size, 'native', nat[side].size, 'onlyPine', onlyPine.map((t) => new Date(t * 1000).toISOString()), 'onlyNative', onlyNative.map((t) => new Date(t * 1000).toISOString()));
}
console.log('bars', bars.length, 'max |diff| after warmup adx', maxAdx, 'rsi', maxRsi, 'ema', maxEma);
