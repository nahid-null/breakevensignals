import { PARAMETERS as P, type Average, type Candle } from "./model";

// Pine ta.ema starts at the first non-na observation, not at an SMA seed.
export function ema(previous: number | null, value: number, length: number): number {
  return previous === null ? value : (2 / (length + 1)) * value + (1 - 2 / (length + 1)) * previous;
}
// Pine ta.rma uses an SMA seed followed by Wilder smoothing; all state is serializable.
export function rma(state: Average, value: number, length: number): number | null {
  if (state.value !== null) state.value = (value + (length - 1) * state.value) / length;
  else {
    state.seed.push(value);
    if (state.seed.length === length) {
      state.value = state.seed.reduce((a, b) => a + b, 0) / length;
      state.seed = [];
    }
  }
  return state.value;
}
export function relativeStrength(gain: number | null, loss: number | null): number | null {
  if (gain === null || loss === null) return null;
  if (loss === 0) return gain === 0 ? null : 100;
  return 100 - 100 / (1 + gain / loss);
}
export function trueRange(c: Candle, previous: Candle | undefined): number {
  return previous ? Math.max(c.high - c.low, Math.abs(c.high - previous.close), Math.abs(c.low - previous.close)) : c.high - c.low;
}
export function confirmedPivot(candles: Candle[], kind: "low" | "high"): number | null {
  const width = P.pivotLeft + P.pivotRight + 1;
  if (candles.length < width) return null;
  const window = candles.slice(-width);
  const center = window[P.pivotLeft];
  if (!center) return null;
  const value = center[kind];
  // Pine selects the latest extremum on ties: equal values to the left are allowed,
  // equal values to the right invalidate the older candidate.
  const valid = window.every((c, i) => i === P.pivotLeft || (kind === "low"
    ? i < P.pivotLeft ? c.low >= value : c.low > value
    : i < P.pivotLeft ? c.high <= value : c.high < value));
  return valid ? value : null;
}