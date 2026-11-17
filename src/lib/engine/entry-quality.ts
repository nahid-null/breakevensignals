/** prompt-38 offline entry-quality rule (registered in engine-worker/entry-quality-protocol.json). Not imported by the website or live worker. */
import type { Direction } from '../config';
import type { Candle, Signal } from './model';

export const EQ = { fee: .0005, bps: 5, ticks: 1, rr: 1.5, maxHold: 240, window: 15, chaseR: 1, retestAtr: .1, stopBufferAtr: .15,
  maxExtensionAtr: 1.5, minStopPct: .4, roomR: 1 } as const;
const sgn = (d: Direction) => d === 'LONG' ? 1 : -1;

export interface BarContext { atr: number; ema9: number; ema21: number; ema200: number; rsi: number | null; histogram: number; volumeSMA: number | null;
  trend15: number | null; ema5Side: number; /** Opposing extreme of the 240 candles before this one: highest high for LONG, lowest low for SHORT. */ high240: number; low240: number }
export interface Setup { direction: Direction; symbol: string; signalTime: number; level: number; pineStop: number; pineRisk: number; extreme: number; bars: number; retested: boolean }
export type Step = { status: 'WAIT' } | { status: 'ABANDON' | 'SKIP'; reason: string } | { status: 'CONFIRMED'; stop: number; time: number };

export function newSetup(signal: Signal, candle: Candle): Setup {
  const s = sgn(signal.direction);
  return { direction: signal.direction, symbol: signal.symbol, signalTime: candle.time, level: candle.close, pineStop: signal.stop_loss,
    pineRisk: Math.abs(candle.close - signal.stop_loss), extreme: s === 1 ? candle.low : candle.high, bars: 0, retested: false };
}

/** Advance a setup by one closed candle after the signal candle. Mutates the setup. */
export function stepSetup(u: Setup, c: Candle, x: BarContext): Step {
  const s = sgn(u.direction); u.bars += 1;
  const adverse = s === 1 ? c.low : c.high; const favourable = s === 1 ? c.high : c.low;
  u.extreme = s === 1 ? Math.min(u.extreme, adverse) : Math.max(u.extreme, adverse);
  if (s * (c.close - u.pineStop) <= 0) return { status: 'ABANDON', reason: 'CLOSED_BEYOND_PINE_STOP' };
  if (!u.retested && s * (favourable - u.level) > EQ.chaseR * u.pineRisk) return { status: 'ABANDON', reason: 'MOVED_WITHOUT_RETEST_NO_CHASE' };
  if (s * (adverse - u.level) <= EQ.retestAtr * x.atr) u.retested = true;
  const rejection = u.retested && s * (c.close - c.open) > 0 && s * (c.close - u.level) > 0 && s * (c.close - x.ema9) > 0;
  if (!rejection) return u.bars >= EQ.window ? { status: 'ABANDON', reason: 'NO_CONFIRMATION_IN_WINDOW' } : { status: 'WAIT' };
  const reason = gateReason(u, c, x);
  if (reason) return { status: 'SKIP', reason };
  return { status: 'CONFIRMED', stop: structureStop(u, x), time: c.time };
}
export function structureStop(u: Setup, x: BarContext) { return u.extreme - sgn(u.direction) * EQ.stopBufferAtr * x.atr; }
export function gateReason(u: Setup, c: Candle, x: BarContext): string | null {
  const s = sgn(u.direction);
  if (x.trend15 !== s) return '15M_TREND_NOT_ALIGNED';
  if (x.ema5Side !== s) return '5M_EMA9_21_CONFLICT';
  if (!(s * (c.close - x.ema200) > 0)) return 'AGAINST_EMA200';
  if (x.rsi === null || (s === 1 ? !(x.rsi >= 50 && x.rsi <= 70) : !(x.rsi >= 30 && x.rsi <= 50))) return 'RSI_OUTSIDE_MOMENTUM_ZONE';
  if (!(s * x.histogram > 0)) return 'MACD_AGAINST';
  if (x.volumeSMA === null || c.volume < x.volumeSMA) return 'WEAK_VOLUME';
  if (s * (c.close - x.ema21) / x.atr > EQ.maxExtensionAtr) return 'TOO_EXTENDED_LATE';
  const stop = structureStop(u, x); const risk = s * (c.close - stop);
  if (!(risk > 0)) return 'INVALID_STOP';
  if (risk / c.close * 100 < EQ.minStopPct) return 'STOP_TOO_TIGHT_FOR_COSTS';
  const opposing = s === 1 ? x.high240 : x.low240;
  if (s * (opposing - c.close) > 0 && s * (opposing - c.close) < EQ.roomR * risk) return 'TOO_CLOSE_TO_SUPPORT_RESISTANCE';
  return null;
}

export interface Outcome { result: 'TARGET' | 'STOP' | 'TIMEOUT' | 'INVALID'; netR: number; bars: number; exitIndex: number; pRandom: number; riskPerUnit: number; entry: number }
/** Costed first-touch outcome entering at bars[i].open; stop first on ambiguous candles; gaps fill at open. */
export function costedOutcome(bars: Candle[], i: number, d: Direction, stop: number, tick: number, rr: number = EQ.rr, maxHold: number = EQ.maxHold): Outcome | null {
  const s = sgn(d); const c = bars[i]; if (!c) return null;
  const entry = c.open * (1 + s * EQ.bps / 1e4) + s * tick * EQ.ticks;
  if (s * (entry - stop) <= 0) return { result: 'INVALID', netR: 0, bars: 0, exitIndex: i, pRandom: 0, riskPerUnit: 0, entry };
  const stopFill = stop * (1 - s * EQ.bps / 1e4) - s * tick * EQ.ticks;
  const risk = s * (entry - stopFill) + EQ.fee * (entry + stopFill);
  const tf = (s * entry + rr * risk + EQ.fee * entry) / (s - EQ.fee);
  const target = (tf + s * tick * EQ.ticks) / (1 - s * EQ.bps / 1e4);
  const pRandom = s * (entry - stop) / (s * (target - stop));
  const net = (raw: number) => { const xf = raw * (1 - s * EQ.bps / 1e4) - s * tick * EQ.ticks; return (s * (xf - entry) - EQ.fee * (entry + xf)) / risk; };
  const end = Math.min(bars.length, i + maxHold);
  for (let k = i; k < end; k++) { const b = bars[k]!;
    if (s * ((s === 1 ? b.low : b.high) - stop) <= 0) return { result: 'STOP', netR: net(s === 1 ? Math.min(b.open, stop) : Math.max(b.open, stop)), bars: k - i + 1, exitIndex: k, pRandom, riskPerUnit: risk, entry };
    if (s * ((s === 1 ? b.high : b.low) - target) >= 0) return { result: 'TARGET', netR: net(target), bars: k - i + 1, exitIndex: k, pRandom, riskPerUnit: risk, entry };
  }
  return { result: 'TIMEOUT', netR: net(bars[end - 1]!.close), bars: end - i, exitIndex: end - 1, pRandom, riskPerUnit: risk, entry };
}
