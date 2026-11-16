/**
 * Native translation of the user's "Professional MTF Trend Detector [15M/5M/1M]" Pine indicator.
 * Each timeframe runs f_trend() on its own closed candles; the 1-minute scalper reads the value of the
 * previous completed bar of every timeframe, matching request.security(..., f_trend()[1], lookahead_on).
 */
import { ema, rma, trueRange } from './calculations';
import { pineGt as gt, pineLt as lt, pineGe as ge } from './pine-numbers';
import { MINUTE, type Average, type Candle } from './model';

export const TREND_PARAMETERS = {
  emaFastLen: 20, emaSlowLen: 50, slopeLookback: 5, pivotLen: 3, diLength: 14, adxSmoothing: 14, minADX: 20,
  wAlignment: 2, wSlope: 1, wStructure: 2, wDI: 1, wPrice: 1, minScore: 5,
} as const;
const T = TREND_PARAMETERS;
export type TrendValue = 1 | -1 | 0;
export const TIMEFRAMES = [15, 5, 1] as const;
export interface TimeframeTrend {
  minutes: number; bucket: Candle | null; previous: Candle | null;
  ema20: number | null; ema50: number | null; emaHistory: [number, number][];
  tr: Average; plusDM: Average; minusDM: Average; adx: Average; plusDI: number | null; minusDI: number | null;
  window: { high: number; low: number }[]; pivotHighs: number[]; pivotLows: number[];
  trend: TrendValue | null;
  /** f_trend() bull/bear scores and ADX at the last closed bar; absent until the next close after upgrade. */
  bullScore?: number | null; bearScore?: number | null; adxValue?: number | null;
}
export interface MtfState { m15: TimeframeTrend; m5: TimeframeTrend; m1: TimeframeTrend }
export interface MtfSnapshot { m15: TrendValue | null; m5: TrendValue | null; m1: TrendValue | null }

export function emptyTimeframe(minutes: number): TimeframeTrend {
  const avg = (): Average => ({ value: null, seed: [] });
  return { minutes, bucket: null, previous: null, ema20: null, ema50: null, emaHistory: [],
    tr: avg(), plusDM: avg(), minusDM: avg(), adx: avg(), plusDI: null, minusDI: null,
    window: [], pivotHighs: [], pivotLows: [], trend: null };
}

function pivot(window: { high: number; low: number }[], kind: 'high' | 'low'): number | null {
  const n = T.pivotLen;
  if (window.length < 2 * n + 1) return null;
  const value = window[n]![kind];
  // Same tie rule as the scalper's confirmed pivots: equal left values allowed, equal right values reject.
  const ok = window.every((b, i) => i === n || (kind === 'high'
    ? i < n ? b.high <= value : b.high < value
    : i < n ? b.low >= value : b.low > value));
  return ok ? value : null;
}

/** f_trend() evaluated on one closed bar of the timeframe. Mutates the timeframe state. */
export function closeBar(s: TimeframeTrend, c: Candle): TrendValue {
  const prev = s.previous;
  const e20 = ema(s.ema20, c.close, T.emaFastLen);
  const e50 = ema(s.ema50, c.close, T.emaSlowLen);
  s.ema20 = e20; s.ema50 = e50;
  s.emaHistory.push([e20, e50]);
  if (s.emaHistory.length > T.slopeLookback + 1) s.emaHistory.shift();
  // ta.dmi: ta.change and ta.tr are na on the first bar, so smoothing starts on the second bar.
  if (prev) {
    const up = c.high - prev.high; const down = prev.low - c.low;
    const plus = gt(up, down) && gt(up, 0) ? up : 0;
    const minus = gt(down, up) && gt(down, 0) ? down : 0;
    const tr = rma(s.tr, trueRange(c, prev), T.diLength);
    const p = rma(s.plusDM, plus, T.diLength); const m = rma(s.minusDM, minus, T.diLength);
    // fixnan(): a zero true range divides to na and keeps the previous DI value.
    if (tr !== null && p !== null && m !== null && tr !== 0) { s.plusDI = 100 * p / tr; s.minusDI = 100 * m / tr; }
    if (s.plusDI !== null && s.minusDI !== null) {
      const sum = s.plusDI + s.minusDI;
      rma(s.adx, Math.abs(s.plusDI - s.minusDI) / (sum === 0 ? 1 : sum), T.adxSmoothing);
    }
  }
  s.previous = c;
  s.window.push({ high: c.high, low: c.low });
  if (s.window.length > 2 * T.pivotLen + 1) s.window.shift();
  const ph = pivot(s.window, 'high'); const pl = pivot(s.window, 'low');
  if (ph !== null) { s.pivotHighs.push(ph); if (s.pivotHighs.length > 2) s.pivotHighs.shift(); }
  if (pl !== null) { s.pivotLows.push(pl); if (s.pivotLows.length > 2) s.pivotLows.shift(); }

  const ago = s.emaHistory.length > T.slopeLookback ? s.emaHistory[0]! : null;
  const adx = s.adx.value === null ? null : 100 * s.adx.value;
  const strong = adx !== null && ge(adx, T.minADX);
  const di = s.plusDI !== null && s.minusDI !== null;
  const [h0, h1] = [s.pivotHighs.at(-1), s.pivotHighs.at(-2)]; const [l0, l1] = [s.pivotLows.at(-1), s.pivotLows.at(-2)];
  const full = s.pivotHighs.length === 2 && s.pivotLows.length === 2;
  const bull = (gt(e20, e50) ? T.wAlignment : 0)
    + (ago && gt(e20, ago[0]) && gt(e50, ago[1]) ? T.wSlope : 0)
    + (full && gt(h0!, h1!) && gt(l0!, l1!) ? T.wStructure : 0)
    + (di && gt(s.plusDI!, s.minusDI!) && strong ? T.wDI : 0)
    + (gt(c.close, e20) && gt(c.close, e50) ? T.wPrice : 0);
  const bear = (lt(e20, e50) ? T.wAlignment : 0)
    + (ago && lt(e20, ago[0]) && lt(e50, ago[1]) ? T.wSlope : 0)
    + (full && lt(h0!, h1!) && lt(l0!, l1!) ? T.wStructure : 0)
    + (di && gt(s.minusDI!, s.plusDI!) && strong ? T.wDI : 0)
    + (lt(c.close, e20) && lt(c.close, e50) ? T.wPrice : 0);
  s.bullScore = bull; s.bearScore = bear; s.adxValue = adx;
  s.trend = strong && bull >= T.minScore && bull > bear ? 1 : strong && bear >= T.minScore && bear > bull ? -1 : 0;
  return s.trend;
}

/** Feeds one closed 1-minute candle; higher timeframes close when their final minute arrives. */
export function addMinute(s: TimeframeTrend, c: Candle) {
  if (s.minutes === 1) { closeBar(s, c); return; }
  const span = s.minutes * MINUTE;
  const start = Math.floor(c.time / span) * span;
  if (!s.bucket || s.bucket.time !== start) s.bucket = { ...c, time: start };
  else s.bucket = { time: start, open: s.bucket.open, high: Math.max(s.bucket.high, c.high),
    low: Math.min(s.bucket.low, c.low), close: c.close, volume: s.bucket.volume + c.volume };
  if (c.time + MINUTE === start + span) { const bar = s.bucket; s.bucket = null; closeBar(s, bar); }
}

export function snapshot(m: MtfState): MtfSnapshot { return { m15: m.m15.trend, m5: m.m5.trend, m1: m.m1.trend }; }
/** allBullish / allBearish from the indicator's alert section; anything else is mixed/sideways. */
export function alignment(s: MtfSnapshot): TrendValue {
  if (s.m15 === 1 && s.m5 === 1 && s.m1 === 1) return 1;
  if (s.m15 === -1 && s.m5 === -1 && s.m1 === -1) return -1;
  return 0;
}
/** Highest possible f_trend score (alignment + slope + structure + DI + price). */
export const MAX_TREND_SCORE = 7;
/** Simulator-only strength rule chosen by the user: full score on all three timeframes plus ADX >= 25. */
export const STRONG_ADX = 25;
export type SignalStrength = 'STRONG' | 'NORMAL';
export function signalStrength(m: MtfState, direction: 'LONG' | 'SHORT'): SignalStrength {
  const ok = (t: TimeframeTrend) => {
    const score = direction === 'LONG' ? t.bullScore : t.bearScore;
    return score === MAX_TREND_SCORE && t.adxValue != null && ge(t.adxValue, STRONG_ADX);
  };
  return ok(m.m15) && ok(m.m5) && ok(m.m1) ? 'STRONG' : 'NORMAL';
}
export function updateMtf(m: MtfState, c: Candle) { addMinute(m.m15, c); addMinute(m.m5, c); addMinute(m.m1, c); }

/**
 * Builds the state as of the close of the 1-minute candle at `lastTime`, from Binance's own closed
 * 15m/5m/1m candles. `minutes` must include the current partial higher-timeframe buckets.
 */
export function initMtf(lastTime: number, minutes: Candle[], fives: Candle[], fifteens: Candle[]): MtfState {
  const end = lastTime + MINUTE;
  const build = (size: number, bars: Candle[]) => {
    const s = emptyTimeframe(size);
    const span = size * MINUTE;
    for (const b of bars) if (b.time + span <= end) closeBar(s, b);
    const start = Math.floor(lastTime / span) * span;
    if (size > 1 && start + span > end) for (const c of minutes) if (c.time >= start && c.time <= lastTime) addMinute(s, c);
    return s;
  };
  return { m15: build(15, fifteens), m5: build(5, fives), m1: build(1, minutes.filter((c) => c.time <= lastTime)) };
}

export const trendName = (v: TrendValue | null | undefined) => v === 1 ? 'BULLISH' : v === -1 ? 'BEARISH' : v === 0 ? 'SIDEWAYS' : 'WAITING';
