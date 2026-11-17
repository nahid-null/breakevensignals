/** prompt-38 offline diagnosis: features and costed first-touch outcomes for original Pine events. Never touches hosted data or Telegram. */
import { readFile, writeFile } from 'node:fs/promises';
import { SYMBOLS, type Direction } from '../src/lib/config';
import { initialState, MINUTE, type Candle } from '../src/lib/engine/model';
import { emptyTimeframe } from '../src/lib/engine/mtf-trend';
import { processCandle } from '../src/lib/engine/scalper';
import { ema } from '../src/lib/engine/calculations';

const [mode, outFile] = process.argv.slice(2); // mode: development | holdout
const dev = mode === 'development';
const from = Date.parse(dev ? '2026-09-01T00:00:00Z' : '2026-10-13T00:00:00Z');
const to = Date.parse(dev ? '2026-10-13T00:00:00Z' : '2026-11-10T00:00:00Z');
const FEE = .0005, BPS = 5, TICKS = 1, RR = 1.5, MAX_BARS = 240;
const meta = JSON.parse(await readFile('/tmp/profitability-study/exchange-info.json', 'utf8')) as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const sgn = (d: Direction) => d === 'LONG' ? 1 : -1;
export function costedOutcome(bars: Candle[], i: number, d: Direction, stop: number, tick: number, rr = RR) {
  const s = sgn(d); const c = bars[i]; if (!c) return null;
  const entry = c.open * (1 + s * BPS / 1e4) + s * tick * TICKS;
  if (s * (entry - stop) <= 0) return { result: 'INVALID' as const, netR: 0, bars: 0, mfeR: 0 };
  const stopFill = stop * (1 - s * BPS / 1e4) - s * tick * TICKS;
  const risk = s * (entry - stopFill) + FEE * (entry + stopFill);
  const tf = (s * entry + rr * risk + FEE * entry) / (s - FEE);
  const target = (tf + s * tick * TICKS) / (1 - s * BPS / 1e4);
  const net = (exitRaw: number) => { const x = exitRaw * (1 - s * BPS / 1e4) - s * tick * TICKS; return (s * (x - entry) - FEE * (entry + x)) / risk; };
  const pRandom = s * (entry - stop) / (s * (target - stop));
  let mfe = 0;
  for (let k = i; k < Math.min(bars.length, i + MAX_BARS); k++) { const b = bars[k]!;
    const fav = s === 1 ? b.high : b.low; const adv = s === 1 ? b.low : b.high;
    if (s * (adv - stop) <= 0) return { result: 'STOP' as const, netR: net(s === 1 ? Math.min(b.open, stop) : Math.max(b.open, stop)), bars: k - i + 1, mfeR: mfe, pRandom, costShare: (risk - s*(entry - stopFill)) / risk + (entry - c.open) * s / risk };
    mfe = Math.max(mfe, s * (fav - entry) / (s * (entry - stop)));
    if (s * (fav - target) >= 0) return { result: 'TARGET' as const, netR: rr, bars: k - i + 1, mfeR: mfe, pRandom, costShare: (risk - s*(entry - stopFill)) / risk };
  }
  const last = bars[Math.min(bars.length, i + MAX_BARS) - 1]!;
  return { result: 'TIMEOUT' as const, netR: net(last.close), bars: MAX_BARS, mfeR: mfe, pRandom };
}
const rows: unknown[] = [];
for (const symbol of SYMBOLS) {
  const m = meta.symbols.find(x => x.symbol === symbol && x.status === 'TRADING'); if (!m) continue;
  const tick = Number(m.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize);
  const bars: Candle[] = dev ? JSON.parse(await readFile(`/tmp/profitability-study/${symbol}-raw.json`, 'utf8')).bars : JSON.parse(await readFile(`/tmp/entry-quality-study/${symbol}-holdout-raw.json`, 'utf8'));
  const st = initialState(symbol, tick); st.mtf = { m15: emptyTimeframe(15), m5: emptyTimeframe(5), m1: emptyTimeframe(1) };
  let e9: number | null = null, e21: number | null = null, e9_15: number | null = null, e21_15: number | null = null;
  for (let i = 0; i < bars.length; i++) { const c = bars[i]!;
    const r = processCandle(st, c); const a = r.analysis;
    if ((c.time + MINUTE) % (5 * MINUTE) === 0) { e9 = ema(e9, c.close, 9); e21 = ema(e21, c.close, 21); }
    if ((c.time + MINUTE) % (15 * MINUTE) === 0) { e9_15 = ema(e9_15, c.close, 9); e21_15 = ema(e21_15, c.close, 21); }
    if (c.time < from || c.time >= to || !a || a.atr === null) continue;
    for (const e of r.signals) { if (e.event !== 'entry_confirmed' && e.event !== 'breakeven_activated') continue;
      const s = sgn(e.direction); const atr = a.atr;
      const back = (n: number) => bars[i - n]!;
      const hi60 = Math.max(...bars.slice(i - 60, i).map(b => b.high)); const lo60 = Math.min(...bars.slice(i - 60, i).map(b => b.low));
      const swingHigh = st.swingHigh, swingLow = st.swingLow;
      // Structure stop: last confirmed opposing 1m swing pivot beyond close, buffered 0.15 ATR (same buffer as Pine).
      const structStop = s === 1 ? (swingLow !== null && swingLow < c.close ? swingLow - .15 * atr : null) : (swingHigh !== null && swingHigh > c.close ? swingHigh + .15 * atr : null);
      const pineStop = e.stop_loss; // entry event: original stop; breakeven event: breakeven line
      const feat = { symbol, event: e.event, direction: e.direction, time: c.time, close: c.close, atrPct: atr / c.close * 100,
        extEma21Atr: s * (c.close - a.ema21) / atr, move15Atr: s * (c.close - back(15).close) / atr, move60Atr: s * (c.close - back(60).close) / atr,
        pastEntryAtr: s * (c.close - e.entry_price) / atr, stopAtr: s * (c.close - pineStop) / atr, stopPct: s * (c.close - pineStop) / c.close * 100,
        structStopAtr: structStop === null ? null : s * (c.close - structStop) / atr,
        roomAtr: s === 1 ? (hi60 > c.close ? (hi60 - c.close) / atr : null) : (lo60 < c.close ? (c.close - lo60) / atr : null),
        rsi: a.rsi, hist: s * a.histogram / atr, volRatio: a.volumeSMA ? c.volume / a.volumeSMA : null,
        ema200Side: s * Math.sign(c.close - a.ema200), ema5Side: e9 !== null && e21 !== null ? s * Math.sign(e9 - e21) : 0,
        ema15Side: e9_15 !== null && e21_15 !== null ? s * Math.sign(e9_15 - e21_15) : 0,
        trend15: st.mtf.m15.trend === null ? null : s * st.mtf.m15.trend, trend5: st.mtf.m5.trend === null ? null : s * st.mtf.m5.trend,
        bodyAtr: s * (c.close - c.open) / atr };
      rows.push({ ...feat, pine: costedOutcome(bars, i + 1, e.direction, pineStop, tick), structure: structStop === null ? null : costedOutcome(bars, i + 1, e.direction, structStop, tick) });
    }
  }
  console.log(symbol, rows.length);
}
await writeFile(outFile!, JSON.stringify(rows));
