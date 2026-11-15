import { readFile, writeFile } from 'node:fs/promises';
import { PineTS, type ISymbolInfo } from 'pinets';
import { z } from 'zod';
import { initialState, MINUTE, validateCandle } from '../src/lib/engine/model';
import { processCandle } from '../src/lib/engine/scalper';
import { comparePineRows, type ParityRow, type ParityValue } from '../src/lib/engine/parity';

// Verification-only: no engine API, secrets, database or notification imports.
const fixtureSchema = z.object({ symbol: z.literal('NEARUSDT'), tickSize: z.number().positive(),
  candles: z.array(z.object({ time: z.number().int(), open: z.number(), high: z.number(), low: z.number(), close: z.number(), volume: z.number() })).min(200) });
const fixture = fixtureSchema.parse(JSON.parse(await readFile(new URL('../src/test/fixtures/binance-near-1m.json', import.meta.url), 'utf8')));
const state = initialState(fixture.symbol, fixture.tickSize);
const native: Record<'LONG' | 'SHORT', ParityRow[]> = { LONG: [], SHORT: [] };
for (const c of fixture.candles) {
  validateCandle(c);
  const { analysis: a, signals } = processCandle(state, c);
  if (!a) throw new Error('Fixture contains duplicate candles');
  for (const direction of ['LONG', 'SHORT'] as const) {
    const side = direction === 'LONG' ? state.long : state.short;
    const events = signals.filter((s) => s.direction === direction);
    native[direction].push({ time: c.time, values: {
      ema9: a.ema9, ema21: a.ema21, ema200: a.ema200, rsi: a.rsi, atr: a.atr, macd: a.macd,
      histogram: a.histogram, volumeSMA: a.volumeSMA,
      score: direction === 'LONG' ? a.longScore : a.shortScore,
      calculatedStop: direction === 'LONG' ? a.longStop : a.shortStop,
      setup: direction === 'LONG' ? a.longSetup : a.shortSetup,
      swing: direction === 'LONG' ? state.swingLow : state.swingHigh,
      entryEvent: events.some((e) => e.event === 'entry_confirmed'),
      stopEvent: events.some((e) => e.event === 'stop_loss_hit'),
      targetEvent: events.some((e) => e.event === 'take_profit_hit'),
      breakevenEvent: events.some((e) => e.event === 'breakeven_activated'),
      active: side.trade !== null, breakevenActive: side.trade?.breakeven ?? false,
      activeEntry: side.trade?.entry ?? null, activeStop: side.trade?.stop ?? null,
      activeTarget: side.trade?.target ?? null, total: side.performance.total, wins: side.performance.wins,
      losses: side.performance.losses, netR: side.performance.netR, drawdown: side.performance.maxDrawdownR,
    } });
  }
}
const metadata: ISymbolInfo = {
  current_contract: fixture.symbol, description: 'Binance USD-M Futures historical verification', isin: '',
  main_tickerid: `BINANCE:${fixture.symbol}.P`, prefix: 'BINANCE', root: fixture.symbol,
  ticker: fixture.symbol, tickerid: `BINANCE:${fixture.symbol}.P`, type: 'crypto', basecurrency: 'NEAR',
  country: '', currency: 'USDT', timezone: 'Etc/UTC', employees: 0, industry: '', sector: '',
  shareholders: 0, shares_outstanding_float: 0, shares_outstanding_total: 0, expiration_date: 0,
  session: '24x7', volumetype: 'base', mincontract: 1, minmove: 1, mintick: fixture.tickSize,
  pointvalue: 1, pricescale: 1 / fixture.tickSize, recommendations_buy: 0, recommendations_buy_strong: 0,
  recommendations_date: 0, recommendations_hold: 0, recommendations_sell: 0, recommendations_sell_strong: 0,
  recommendations_total: 0, target_price_average: 0, target_price_date: 0, target_price_estimates: 0,
  target_price_high: 0, target_price_low: 0, target_price_median: 0,
};
const bars = fixture.candles.map((c) => ({ ...c, openTime: c.time, closeTime: c.time + MINUTE,
  quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 }));
const provider = { async getMarketData() { return bars; }, async getSymbolInfo() { return metadata; }, configure() {} };
const report = { status: 'BLOCKED: experimental interpreter is not a validated Pine oracle',
  reference: 'PineTS 0.13.1, original uploads executed intact with observation plots only',
  limitation: 'PineTS SMA-seeds EMA; source Pine EMA first-value seeding differs. Do not change native logic to force a match.',
  symbol: fixture.symbol, tickSize: fixture.tickSize, bars: bars.length,
  firstCandle: new Date(bars[0]?.openTime ?? 0).toISOString(), lastCandle: new Date(bars.at(-1)?.openTime ?? 0).toISOString(),
  comparisons: [] as { direction: string; matches: boolean; byField: Record<string, number>; firstDifferences: unknown[] }[] };
for (const direction of ['LONG', 'SHORT'] as const) {
  const lower = direction.toLowerCase();
  const source = await readFile(new URL(`../src/test/fixtures/pine-${lower}.original.pine`, import.meta.url), 'utf8');
  const fields: Record<string, string> = {
    ema9: 'ema9', ema21: 'ema21', ema200: 'ema200', rsi: 'rsi', atr: 'atr', macd: 'macdLine', histogram: 'macdHistogram',
    volumeSMA: 'volumeSMA', score: 'confirmationScore', calculatedStop: 'calculatedSL', setup: `${lower}Setup ? 1 : 0`,
    swing: direction === 'LONG' ? 'lastSwingLow' : 'lastSwingHigh', entryEvent: `${lower}Signal ? 1 : 0`,
    stopEvent: 'stopLossEvent ? 1 : 0', targetEvent: 'takeProfitEvent ? 1 : 0', breakevenEvent: 'breakevenEvent ? 1 : 0',
    active: 'activeTrade ? 1 : 0', breakevenActive: 'breakevenActive ? 1 : 0',
    activeEntry: 'activeTrade ? tradeEntry : na', activeStop: 'activeTrade ? tradeSL : na', activeTarget: 'activeTrade ? tradeTP : na',
    total: 'totalTrades', wins: 'winningTrades', losses: 'losingTrades', netR: 'netResultR', drawdown: 'maxDrawdownR',
  };
  const observation = Object.entries(fields).map(([name, expr]) => `plot(${expr}, "VERIFY_${name}")`).join('\n');
  const runtime = new PineTS(provider, fixture.symbol, '1', bars.length, bars[0]?.openTime, bars.at(-1)?.closeTime);
  const output = await runtime.run(`${source}\n${observation}\n`);
  const reference: ParityRow[] = bars.map((bar, i) => {
    const values: Record<string, ParityValue> = {};
    for (const name of Object.keys(fields)) {
      const point = output.plots[`VERIFY_${name}`]?.data[i];
      if (!point || point.time !== bar.openTime) throw new Error(`Reference missing/misaligned ${name} bar ${i}`);
      const value = point.value;
      values[name] = typeof native[direction][i]?.values[name] === 'boolean' ? value === 1
        : typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
    return { time: bar.openTime, values };
  });
  const result = comparePineRows(native[direction], reference);
  const byField: Record<string, number> = {};
  for (const difference of result.differences) byField[difference.field] = (byField[difference.field] ?? 0) + 1;
  report.comparisons.push({ direction, matches: result.matches, byField, firstDifferences: result.differences.slice(0, 15) });
}
const path = process.argv[2] ?? '/tmp/pine-parity-report.json';
await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Candidate comparison report saved to ${path}. NOT a passed deployment gate.`);
process.exitCode = 2;