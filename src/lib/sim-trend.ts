import type { MtfSnapshot } from './engine/mtf-trend';

/**
 * Simulator trend rule from the Trend Identify indicator: 15M and 5M must agree (the indicator's
 * OVERALL bias) and 1M must be sideways or the same direction. Returns the only side the Simulator
 * may trade on that coin, or null. Mirrors the decision in the database settlement function.
 */
export function watchSide(t: Partial<MtfSnapshot> | null | undefined): 'LONG' | 'SHORT' | null {
  if (!t || t.m15 == null || t.m5 == null || t.m1 == null) return null;
  if (t.m15 === 0 || t.m15 !== t.m5) return null;
  if (t.m1 === -t.m15) return null;
  return t.m15 === 1 ? 'LONG' : 'SHORT';
}

export const DECISION_TEXT: Record<string, string> = {
  TREND_UNKNOWN: 'Trend not ready', NO_15M_5M_BIAS: '15m and 5m disagree', BIAS_OPPOSITE_SIGNAL: 'Against 15m/5m trend',
  ONE_MINUTE_OPPOSITE: '1m against trend', SIMULATOR_OFF: 'Simulator paused', NO_BALANCE: 'No balance',
  TRADE_ALREADY_OPEN: 'Another trade open', RULE_REPLACED: 'Old rule retired', CANDLE_NOT_CONFIRMED: 'Candle not confirmed (old rule)',
  NOT_LIVE: 'Not live', PINE_TRADE_CLOSED: 'Pine trade closed (old rule)',
};
