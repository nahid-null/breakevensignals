import { type Candle, validateCandle } from './model';
import { pineGt as gt, pineLt as lt } from './pine-numbers';

/** prompt-81: exact port of the user's uploaded Pine v4 "Supertrend" (research/prompt-81/SuperTrend.original.pine)
 * with the settings from their TradingView screenshot: ATR Period 5, Source hl2, Multiplier 1.6, "Change ATR Calculation
 * Method" = true (Pine atr(), i.e. RMA of true range). Signals only on CONFIRMED 30-minute closes; no other filter. */
export const ST_INTERVAL = 30 * 60_000;
export const ST_SETTINGS = { atrPeriod: 5, multiplier: 1.6, source: 'hl2', changeATR: true } as const;
export const ST_SYMBOLS = ['NEARUSDT', 'SUIUSDT', 'TAOUSDT', 'LINKUSDT', 'WLDUSDT'] as const;
export type StSymbol = typeof ST_SYMBOLS[number];
export type StSide = 'LONG' | 'SHORT';
export interface StSignal { id: string; symbol: StSymbol; side: StSide; signalTime: number; confirmTime: number; close: number; line: number }
export interface StState {
  version: 1; count: number; lastTime: number | null; prevClose: number | null;
  /** RMA ATR state: seed of the first `atrPeriod` true ranges, then the running value. */
  atr: number | null; atrSmaSeed: number[];
  /** Final (re-assigned) up/dn of the previous bar and previous trend. */
  up: number | null; dn: number | null; trend: 1 | -1 | null;
}
export const initialSt = (): StState => ({ version: 1, count: 0, lastTime: null, prevClose: null, atr: null, atrSmaSeed: [], up: null, dn: null, trend: null });
export const stSignalId = (symbol: StSymbol, side: StSide, barTime: number) => `ST30-${symbol}-${side}-${barTime}`;

/** One confirmed 30m candle. Duplicate bars are inert; gaps require recovery. Returns at most one BUY/SELL. */
export function processSt(state: StState, symbol: StSymbol, candle: Candle, closedThrough: number): StSignal[] {
  validateCandle(candle);
  if (candle.time % ST_INTERVAL !== 0 || candle.time + ST_INTERVAL > closedThrough) throw new Error('SuperTrend needs a confirmed 30-minute candle');
  if (state.lastTime !== null && candle.time <= state.lastTime) return [];
  if (state.lastTime !== null && candle.time !== state.lastTime + ST_INTERVAL) throw new Error('SuperTrend candle gap: recover before continuing');
  const { atrPeriod: n, multiplier: m } = ST_SETTINGS;
  // Pine atr(n) = rma(tr(true), n): first bar's tr is high-low; rma seeds with sma of the first n values.
  const tr = state.prevClose === null ? candle.high - candle.low
    : Math.max(candle.high - candle.low, Math.abs(candle.high - state.prevClose), Math.abs(candle.low - state.prevClose));
  if (state.atr === null) {
    state.atrSmaSeed = [...state.atrSmaSeed, tr].slice(-n);
    if (state.atrSmaSeed.length === n) state.atr = state.atrSmaSeed.reduce((a, b) => a + b, 0) / n;
  } else state.atr = (tr + (n - 1) * state.atr) / n;
  const atr = state.atr;
  const src = (candle.high + candle.low) / 2;
  const close1 = state.prevClose;
  let up: number | null = atr === null ? null : src - m * atr;
  const up1 = state.up ?? up; // nz(up[1], up)
  if (up !== null && up1 !== null && close1 !== null && gt(close1, up1)) up = Math.max(up, up1);
  let dn: number | null = atr === null ? null : src + m * atr;
  const dn1 = state.dn ?? dn;
  if (dn !== null && dn1 !== null && close1 !== null && lt(close1, dn1)) dn = Math.min(dn, dn1);
  const prevTrend = state.trend;
  let trend: 1 | -1 = prevTrend ?? 1; // trend = 1; trend := nz(trend[1], trend)
  trend = trend === -1 && dn1 !== null && gt(candle.close, dn1) ? 1 : trend === 1 && up1 !== null && lt(candle.close, up1) ? -1 : trend;
  state.count++; state.lastTime = candle.time; state.prevClose = candle.close; state.up = up; state.dn = dn; state.trend = trend;
  const buy = trend === 1 && prevTrend === -1; const sell = trend === -1 && prevTrend === 1;
  if (!buy && !sell) return [];
  const side: StSide = buy ? 'LONG' : 'SHORT';
  return [{ id: stSignalId(symbol, side, candle.time), symbol, side, signalTime: candle.time, confirmTime: candle.time + ST_INTERVAL, close: candle.close, line: (buy ? up : dn) ?? candle.close }];
}

/** Current SuperTrend direction and line for display (after the last confirmed bar). */
export const stDirection = (s: StState) => ({ trend: s.trend === 1 ? 'UP' as const : s.trend === -1 ? 'DOWN' as const : null, line: s.trend === 1 ? s.up : s.trend === -1 ? s.dn : null });
