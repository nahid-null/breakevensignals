// Verification-only (prompt-81): runs the INTACT uploaded SuperTrend Pine source in PineTS with the user's screenshot
// inputs (ATR Period 5, Source hl2, Multiplier 1.6) on the same Binance SPOT 30m candles (the user's chart) as the native port, and
// compares every Buy/Sell bar and the trend line. No database, secrets or Telegram. Usage: bun engine-worker/verify-supertrend.ts
import { readFile } from 'node:fs/promises';
import { Indicator, PineTS, type ISymbolInfo } from 'pinets';
import { ST_INTERVAL, ST_SETTINGS, ST_SYMBOLS, initialSt, processSt } from '../src/lib/engine/supertrend';

const source = await readFile(new URL('../research/prompt-81/SuperTrend.original.pine', import.meta.url), 'utf8');
// PineTS runs only Pine v5+. Apply TradingView's documented mechanical v4→v5 renames (no logic change) to a COPY;
// display-only drawing calls (plotshape/fill/alerts) are dropped because they do not affect any calculated value.
const v5 = source
  .replace('//@version=4', '//@version=5')
  .replace(/^study\((.*), resolution=""\)$/m, 'indicator($1)')
  .replace(/input\(title="ATR Period", type=input\.integer, defval=10\)/, 'input.int(title="ATR Period", defval=10)')
  .replace(/input\(hl2, title="Source"\)/, 'input.source(hl2, title="Source")')
  .replace(/input\(title="ATR Multiplier", type=input\.float, step=0\.1, defval=3\.0\)/, 'input.float(title="ATR Multiplier", step=0.1, defval=3.0)')
  .replace(/input\(title="([^"]+)", type=input\.bool, defval=(true|false)\)/g, 'input.bool(title="$1", defval=$2)')
  .replace('atr2 = sma(tr, Periods)', 'atr2 = ta.sma(ta.tr, Periods)')
  .replace('atr= changeATR ? atr(Periods) : atr2', 'atr= changeATR ? ta.atr(Periods) : atr2')
  .replace('max(up,up1)', 'math.max(up,up1)').replace('min(dn, dn1)', 'math.min(dn, dn1)')
  .split('\n').filter((l) => !/^(plotshape|fill|alertcondition|upPlot|dnPlot|mPlot|longFillColor|shortFillColor|changeCond)\b/.test(l)).join('\n');
if (/\b(study|security)\(|type=input\./.test(v5)) throw new Error('v4→v5 copy still has v4-only syntax');
const code = `${v5}\nplot(buySignal ? 1 : 0, "VERIFY_buy")\nplot(sellSignal ? 1 : 0, "VERIFY_sell")\nplot(trend == 1 ? up : dn, "VERIFY_line")\n`;
const end = Math.floor(Date.now() / ST_INTERVAL) * ST_INTERVAL; // only fully closed bars
let allOk = true;
for (const symbol of ST_SYMBOLS) {
  const rows = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=30m&limit=1000&endTime=${end - 1}`)).json() as unknown[][]; // SPOT: the user's chart
  const candles = rows.map((r) => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) })).filter((c) => c.time + ST_INTERVAL <= end);
  const st = initialSt(); const native = { LONG: new Set<number>(), SHORT: new Set<number>() }; const lines: (number | null)[] = [];
  for (const c of candles) { for (const s of processSt(st, symbol, c, c.time + ST_INTERVAL)) native[s.side].add(c.time); lines.push(st.trend === 1 ? st.up : st.dn); }
  const bars = candles.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, openTime: c.time, closeTime: c.time + ST_INTERVAL - 1,
    quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 }));
  const meta = { ticker: symbol, tickerid: `BINANCE:${symbol}`, mintick: 0.0001, pricescale: 10000, type: 'crypto', timezone: 'Etc/UTC', session: '24x7', currency: 'USDT', basecurrency: symbol.replace('USDT', '') } as unknown as ISymbolInfo;
  const provider = { async getMarketData() { return bars; }, async getSymbolInfo() { return meta; }, configure() {} };
  const runtime = new PineTS(provider, symbol, '30', bars.length, bars[0]?.openTime, bars.at(-1)?.closeTime);
  const out = await runtime.run(new Indicator(code, { 'ATR Period': ST_SETTINGS.atrPeriod, 'ATR Multiplier': ST_SETTINGS.multiplier }));
  const ref = { LONG: new Set<number>(), SHORT: new Set<number>() }; let maxLine = 0;
  bars.forEach((b, i) => {
    const at = (n: string) => out.plots[`VERIFY_${n}`]?.data[i];
    if (at('buy')?.time !== b.openTime) throw new Error(`${symbol}: misaligned bar ${i}`);
    if (at('buy')?.value === 1) ref.LONG.add(b.openTime);
    if (at('sell')?.value === 1) ref.SHORT.add(b.openTime);
    const x = Number(at('line')?.value); const y = lines[i];
    if (i > 50 && Number.isFinite(x) && y != null) maxLine = Math.max(maxLine, Math.abs(x - y) / Math.abs(x));
  });
  for (const side of ['LONG', 'SHORT'] as const) {
    const onlyPine = [...ref[side]].filter((t) => !native[side].has(t)); const onlyNative = [...native[side]].filter((t) => !ref[side].has(t));
    if (onlyPine.length || onlyNative.length) allOk = false;
    console.log(symbol, side === 'LONG' ? 'BUY ' : 'SELL', 'pine', ref[side].size, 'native', native[side].size, 'onlyPine', onlyPine.map((t) => new Date(t).toISOString()), 'onlyNative', onlyNative.map((t) => new Date(t).toISOString()));
  }
  console.log(symbol, 'bars', bars.length, `${new Date(bars[0]!.openTime).toISOString()} → ${new Date(bars.at(-1)!.openTime).toISOString()}`, 'max relative line diff', maxLine.toExponential(2));
}
console.log(allOk ? 'MATCH: every Buy/Sell bar identical' : 'MISMATCH');
if (!allOk) process.exit(1);
