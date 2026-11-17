/**
 * Independent-language reference: the intact original Pine uploads interpreted by PineTS on identical candles.
 * Loaded on demand in the browser only. This is NOT TradingView; TradingView values come only from an export.
 */
import type { Candle } from '@/lib/engine/model';
import type { Direction } from '@/lib/config';
import type { ParityRow, ParityValue } from '@/lib/engine/parity';
import { PARITY_FIELDS, plotTitle } from './fields';
import longSource from '@/test/fixtures/pine-long.original.pine?raw';
import shortSource from '@/test/fixtures/pine-short.original.pine?raw';

export const ORIGINAL_PINE: Record<Direction, string> = { LONG: longSource, SHORT: shortSource };

export async function runPineReference(candles: Candle[], symbol: string, tick: number, d: Direction, tfMs: number, corrected: boolean): Promise<ParityRow[]> {
  const [{ PineTS }, { runCorrectedPine }] = await Promise.all([import('pinets'), import('../../../engine-worker/pine-runtime')]);
  const bars = candles.map((c) => ({ ...c, openTime: c.time, closeTime: c.time + tfMs, quoteAssetVolume: 0, numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 }));
  const metadata = { current_contract: symbol, description: 'Binance USD-M Futures parity', isin: '', main_tickerid: `BINANCE:${symbol}.P`, prefix: 'BINANCE',
    root: symbol, ticker: symbol, tickerid: `BINANCE:${symbol}.P`, type: 'crypto', basecurrency: symbol.replace('USDT', ''), country: '', currency: 'USDT',
    timezone: 'Etc/UTC', employees: 0, industry: '', sector: '', shareholders: 0, shares_outstanding_float: 0, shares_outstanding_total: 0, expiration_date: 0,
    session: '24x7', volumetype: 'base', mincontract: 1, minmove: 1, mintick: tick, pointvalue: 1, pricescale: 1 / tick, recommendations_buy: 0,
    recommendations_buy_strong: 0, recommendations_date: 0, recommendations_hold: 0, recommendations_sell: 0, recommendations_sell_strong: 0,
    recommendations_total: 0, target_price_average: 0, target_price_date: 0, target_price_estimates: 0, target_price_high: 0, target_price_low: 0, target_price_median: 0 };
  const provider = { async getMarketData() { return bars; }, async getSymbolInfo() { return metadata; }, configure() {} };
  const tf = String(Math.round(tfMs / 60_000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = new PineTS(provider as any, symbol, tf, bars.length, bars[0]?.openTime, bars.at(-1)?.closeTime);
  const plots = PARITY_FIELDS.map((f) => `plot(${f.expr(d)}, "${plotTitle(f.field)}")`).join('\n');
  const code = `${ORIGINAL_PINE[d]}\n${plots}\n`;
  const out = corrected ? await runCorrectedPine(runtime, code) : await runtime.run(code);
  return bars.map((bar, i) => {
    const values: Record<string, ParityValue> = {};
    for (const f of PARITY_FIELDS) {
      const point = out.plots[plotTitle(f.field)]?.data[i];
      if (!point || point.time !== bar.openTime) continue;
      const v = point.value;
      values[f.field] = f.kind === 'bool' ? v === 1 : typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    return { time: bar.openTime, values };
  });
}
