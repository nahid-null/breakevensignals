import { z } from "zod";
import { SYMBOLS, EVENT_TYPES, INDICATORS } from "../config";
import { ENGINE_VERSION, MINUTE } from './model';
import { feedHealthSchema } from './feed-health';

const finite = z.number().finite();
const candleTime = z.number().int().nonnegative().refine((n) => n % MINUTE === 0);
const average = z.object({ value: finite.nullable(), seed: z.array(finite).max(14) });
const trendValue = z.union([z.literal(1), z.literal(-1), z.literal(0)]).nullable();
const mtfSnapshot = z.object({ m15: trendValue, m5: trendValue, m1: trendValue });
const bar = z.object({ time: candleTime, open: finite.positive(), high: finite.positive(), low: finite.positive(), close: finite.positive(), volume: finite.nonnegative() });
const timeframe = z.object({ minutes: z.union([z.literal(15), z.literal(5), z.literal(1)]), bucket: bar.nullable(), previous: bar.nullable(),
  ema20: finite.nullable(), ema50: finite.nullable(), emaHistory: z.array(z.tuple([finite, finite])).max(6),
  tr: average, plusDM: average, minusDM: average, adx: average, plusDI: finite.nullable(), minusDI: finite.nullable(),
  window: z.array(z.object({ high: finite.positive(), low: finite.positive() })).max(7),
  pivotHighs: z.array(finite).max(2), pivotLows: z.array(finite).max(2), trend: trendValue,
  bullScore: finite.nullable().optional(), bearScore: finite.nullable().optional(), adxValue: finite.nullable().optional() });
export const mtfSchema = z.object({ m15: timeframe, m5: timeframe, m1: timeframe });
const trade = z.object({ id: z.string().min(3).max(200), direction: z.enum(['LONG','SHORT']),
  entry: finite.positive(), stop: finite.positive(), originalStop: finite.positive(), target: finite.positive(),
  risk: finite.positive(), entryTime: candleTime, breakeven: z.boolean(), breakevenTime: candleTime.nullable(), entryTrend: mtfSnapshot.optional(),
  entryStrength: z.enum(['STRONG','NORMAL']).optional() });
const side = z.object({ trade: trade.nullable(), lastExitTime: candleTime.nullable(), performance: z.object({
  total: z.number().int().nonnegative(), wins: z.number().int().nonnegative(), losses: z.number().int().nonnegative(),
  positiveNetR: finite, negativeNetR: finite, grossProfitR: finite, grossLossR: finite, netR: finite,
  peakR: finite, maxDrawdownR: finite,
}) });
const engineFields = {
  version: z.literal(ENGINE_VERSION), symbol: z.enum(SYMBOLS), tickSize: finite.positive(),
  lastTime: candleTime, count: z.number().int().positive(),
  candles: z.array(z.object({ time: candleTime, open: finite.positive(), high: finite.positive(),
    low: finite.positive(), close: finite.positive(), volume: finite.nonnegative() })).min(1).max(20),
  ema9: finite.nullable(), ema21: finite.nullable(), ema200: finite.nullable(), fast: finite.nullable(), slow: finite.nullable(),
  macdSignal: finite.nullable(), gain: average, loss: average, atr: average, rsi: finite.nullable(),
  swingLow: finite.nullable(), swingHigh: finite.nullable(), long: side, short: side,
};
type EngineShape = { candles: { time: number }[]; lastTime: number; long: { trade: { direction: string } | null }; short: { trade: { direction: string } | null } };
const consistent = (s: EngineShape) => s.candles.at(-1)?.time === s.lastTime && (!s.long.trade || s.long.trade.direction === 'LONG') && (!s.short.trade || s.short.trade.direction === 'SHORT');
/** Original Pine on 5-minute bars plus the current bucket's closed 1-minute candles. */
const fiveSchema = z.object({
  engine: z.object({ ...engineFields, interval: z.literal(5 * MINUTE) }).refine(consistent, 'Invalid 5-minute checkpoint'),
  bucket: z.array(bar).max(4),
});
export const checkpointSchema = z.object({ ...engineFields, mtf: mtfSchema.optional(), five: fiveSchema.optional() })
  .refine((s) => consistent(s) && (!s.five || s.five.bucket.every((c) => c.time <= s.lastTime)), 'Invalid checkpoint');

export const signalSchema = z.object({
  event_id: z.string().min(3).max(200), trade_id: z.string().min(3).max(200), event: z.enum(EVENT_TYPES),
  symbol: z.enum(SYMBOLS), direction: z.enum(['LONG','SHORT']), indicator: z.string(), timeframe: z.enum(['1', '5']),
  entry_price: finite.positive(), stop_loss: finite.positive(), take_profit: finite.positive(),
  exit_price: finite.positive().optional(), fee_rate_percent: finite.min(0).max(5),
  timestamp: z.string().datetime(), net_result_r: finite.optional(),
  trend_aligned: z.boolean().optional(), mtf_trend: mtfSnapshot.optional(),
  signal_strength: z.enum(['STRONG','NORMAL']).optional(), adopted: z.boolean().optional(),
}).refine((e) => e.indicator === INDICATORS[e.direction] && e.event_id === `${e.trade_id}-${e.event}` &&
  (!['stop_loss_hit','take_profit_hit'].includes(e.event) || (e.exit_price !== undefined && e.net_result_r !== undefined)), 'Invalid signal identity or exit result');

export function eventSource(mode: 'live' | 'warmup' | 'recovery') {
  return mode === 'live' ? 'native' : mode === 'warmup' ? 'historical' : 'recovery';
}

export const marketSchema = z.object({
  symbol: z.enum(SYMBOLS), price: z.number().positive().nullable(),
  trend: z.enum(["BULLISH", "BEARISH", "SIDEWAYS", "WAITING"]),
  status: z.enum(["LIVE", "RECOVERING", "WARMING UP", "UNAVAILABLE", "ERROR"]),
  last_candle_at: z.string().datetime().nullable(), long_score: z.number().min(0).max(100),
  short_score: z.number().min(0).max(100), error: z.string().max(500).nullable(),
  mtf_trend: mtfSnapshot.nullable().optional(),
});
export const heartbeatSchema = z.object({
  instance_id: z.string().uuid(), websocket_connected: z.boolean(), binance_connected: z.boolean(),
  available_symbols: z.number().int().min(0).max(21), status: z.enum(["STARTING", "RUNNING", "RECOVERING", "ERROR", "STOPPED"]),
  error: z.string().max(500).nullable(),
  runtime_mode: z.enum(['production','temporary']).default('production'),
  host_kind: z.enum(['unknown','windows_pc','hosted','temporary']).default('unknown'),
  started_at: z.string().datetime().nullable().default(null),
  uptime_seconds: z.number().int().nonnegative().default(0),
  scanned_symbols: z.number().int().min(0).max(21).default(0),
  last_scan_at: z.string().datetime().nullable().default(null),
  feed_health: feedHealthSchema.nullable().default(null),
});
/** prompt-51: OB + Weighted VP 5-minute entry for the Simulator only (never a Pine position or signal event). */
export const simulatorEntrySchema = z.object({
  trade_id: z.string().min(3).max(200), symbol: z.enum(SYMBOLS), direction: z.enum(['LONG','SHORT']),
  indicator: z.literal('OB + Weighted VP 5m'), timeframe: z.literal('5'),
  entry_price: finite.positive(), stop_loss: finite.positive(), take_profit: finite.positive(),
  score: z.number().int().min(0).max(6), rr: finite.positive(), signal_time: z.string().datetime(),
});
export const commitSchema = z.object({
  instance_id: z.string().uuid(), symbol: z.enum(SYMBOLS), expected_revision: z.number().int().min(0),
  checkpoint: checkpointSchema,
  market: marketSchema,
  mode: z.enum(["live", "warmup", "recovery"]),
  events: z.array(signalSchema).max(12),
  simulator_entries: z.array(simulatorEntrySchema).max(2).default([]),
}).refine((p) => p.market.symbol === p.symbol && p.checkpoint['symbol'] === p.symbol && p.events.every((e) => e.symbol === p.symbol)
  && p.simulator_entries.every((e) => e.symbol === p.symbol), "Symbol mismatch");