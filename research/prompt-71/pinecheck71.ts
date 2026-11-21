// prompt-71 verification only: run the INTACT uploaded Pine through PineTS (project-corrected runtime) on the same
// Binance futures 30m candles and write its LONG/SHORT signal bars for comparison with cstf71.py. No app imports.
import { readFile, writeFile } from 'node:fs/promises';
import { PineTS } from 'pinets';
import { runCorrectedPine } from '../../engine-worker/pine-runtime';
const syms = (process.argv[2] ?? 'ETH').split(',');
const src = await readFile(new URL('./Candle_Signals_Trend_Filter_v4_Strong_Trend.pine', import.meta.url), 'utf8');
const code = `${src}\nplot(longSig ? 1 : 0, "VERIFY_long")\nplot(shortSig ? 1 : 0, "VERIFY_short")\nplot(atr, "VERIFY_atr")\nplot(emaS, "VERIFY_emaS")\n`;
const out: Record<string, { long: number[]; short: number[]; atr: (number|null)[]; emaS: (number|null)[] }> = {};
for (const c of syms) {
  const s = `${c}USDT`;
  const d = JSON.parse(await readFile(`/tmp/r71/raw/${s}.json`, 'utf8'));
  const bars = d.m30.map((k: number[]) => ({ openTime: k[0], closeTime: k[0] + 1800000, open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5],
    quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 }));
  const meta: any = { ticker: s, tickerid: `BINANCE:${s}.P`, mintick: 0.0001, timezone: 'Etc/UTC', session: '24x7', type: 'crypto', currency: 'USDT', pricescale: 10000, minmove: 1, pointvalue: 1 };
  const provider = { async getMarketData() { return bars; }, async getSymbolInfo() { return meta; }, configure() {} };
  const rt = new PineTS(provider as any, s, '30', bars.length, bars[0].openTime, bars.at(-1).closeTime);
  const o: any = await runCorrectedPine(rt, code);
  const L = o.plots['VERIFY_long'].data, S = o.plots['VERIFY_short'].data;
  out[s] = { long: L.filter((p: any) => p.value === 1).map((p: any) => p.time), short: S.filter((p: any) => p.value === 1).map((p: any) => p.time),
    atr: o.plots['VERIFY_atr'].data.slice(-3).map((p: any) => p.value), emaS: o.plots['VERIFY_emaS'].data.slice(-3).map((p: any) => p.value) };
  console.log(s, out[s].long.length, out[s].short.length);
}
await writeFile(`/tmp/r71/pinets_${syms.join('_')}.json`, JSON.stringify(out));
