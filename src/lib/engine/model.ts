import type { Direction, EventType, Symbol } from "../config";
import type { MtfState, MtfSnapshot, SignalStrength } from "./mtf-trend";

export const MINUTE = 60_000;
export const FIVE_MINUTES = 5 * MINUTE;
export const ENGINE_VERSION = 1;
export const PARAMETERS = {
  scoreThreshold: 70, rsiLength: 14, macdFast: 12, macdSlow: 26, macdSignal: 9,
  atrLength: 14, atrStopMult: 1.5, swingBuffer: 0.15, swingLookback: 20,
  minStopATR: 0.4, maxStopATR: 3, rrMultiplier: 1.5, enableBreakeven: true,
  breakevenTrigger: 1, cooldownBars: 5, volumeLength: 20, volumeMultiplier: 1,
  structureLength: 10, pivotLeft: 3, pivotRight: 3, minAtrPercent: 0.02,
  maxAtrPercent: 1.2, feePercent: 0.04, slippageTicks: 1,
} as const;
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface Average { value: number | null; seed: number[] }
export interface Trade {
  id: string; direction: Direction; entry: number; stop: number; originalStop: number;
  target: number; risk: number; entryTime: number; breakeven: boolean; breakevenTime: number | null;
  /** 15M/5M/1M trend that approved the entry; absent for trades opened before the trend filter. */
  entryTrend?: MtfSnapshot;
  /** Simulator leverage tier decided at entry from the trend scores and ADX. */
  entryStrength?: SignalStrength;
}
export interface Performance {
  total: number; wins: number; losses: number; positiveNetR: number; negativeNetR: number;
  grossProfitR: number; grossLossR: number; netR: number; peakR: number; maxDrawdownR: number;
}
export interface SideState { trade: Trade | null; lastExitTime: number | null; performance: Performance }
export interface EngineState {
  version: number; symbol: Symbol; tickSize: number; lastTime: number | null; count: number;
  candles: Candle[]; ema9: number | null; ema21: number | null; ema200: number | null;
  fast: number | null; slow: number | null; macdSignal: number | null;
  gain: Average; loss: Average; atr: Average; rsi: number | null;
  swingLow: number | null; swingHigh: number | null; long: SideState; short: SideState;
  /** Multi-timeframe trend filter state. The live worker always sets it before processing. */
  mtf?: MtfState;
  /** Bar length in ms; absent means one minute. The 5-minute Pine engine sets FIVE_MINUTES. */
  interval?: number;
  /** Original Pine LONG/SHORT running on 5-minute bars built from this feed's closed 1-minute candles. */
  five?: { engine: EngineState; bucket: Candle[] };
}
export interface Signal {
  event_id: string; trade_id: string; event: EventType; symbol: Symbol; direction: Direction;
  indicator: string; timeframe: string; entry_price: number; stop_loss: number;
  take_profit: number; fee_rate_percent: number; timestamp: string;
  exit_price?: number; net_result_r?: number;
  trend_aligned?: boolean; mtf_trend?: MtfSnapshot; signal_strength?: SignalStrength;
  /** Open Pine trade adopted from history at startup: stored as historical, never traded or notified. */
  adopted?: boolean;
}
export interface Analysis {
  ema9: number; ema21: number; ema200: number; rsi: number | null; atr: number | null;
  macd: number; histogram: number; volumeSMA: number | null;
  trend: "BULLISH" | "BEARISH" | "SIDEWAYS";
  longScore: number; shortScore: number; longSetup: boolean; shortSetup: boolean;
  longStop: number | null; shortStop: number | null;
}
export function initialState(symbol: Symbol, tickSize: number): EngineState {
  const avg = (): Average => ({ value: null, seed: [] });
  const side = (): SideState => ({ trade: null, lastExitTime: null, performance: {
    total: 0, wins: 0, losses: 0, positiveNetR: 0, negativeNetR: 0,
    grossProfitR: 0, grossLossR: 0, netR: 0, peakR: 0, maxDrawdownR: 0,
  } });
  return { version: ENGINE_VERSION, symbol, tickSize, lastTime: null, count: 0, candles: [],
    ema9: null, ema21: null, ema200: null, fast: null, slow: null, macdSignal: null,
    gain: avg(), loss: avg(), atr: avg(), rsi: null, swingLow: null, swingHigh: null,
    long: side(), short: side() };
}

export function validateCandle(c: Candle) {
  if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
    c.time % MINUTE !== 0 || c.time < 0 || c.low <= 0 || c.volume < 0 ||
    c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close)) {
    throw new Error("Invalid one-minute candle");
  }
}