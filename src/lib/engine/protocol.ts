import { z } from "zod";
import { SYMBOLS, EVENT_TYPES, INDICATORS } from "../config";
import { ENGINE_VERSION, MINUTE } from './model';

const finite = z.number().finite();
const candleTime = z.number().int().nonnegative().refine((n) => n % MINUTE === 0);
const average = z.object({ value: finite.nullable(), seed: z.array(finite).max(14) });
const trade = z.object({ id: z.string().min(3).max(200), direction: z.enum(['LONG','SHORT']),
  entry: finite.positive(), stop: finite.positive(), originalStop: finite.positive(), target: finite.positive(),
  risk: finite.positive(), entryTime: candleTime, breakeven: z.boolean(), breakevenTime: candleTime.nullable() });
const side = z.object({ trade: trade.nullable(), lastExitTime: candleTime.nullable(), performance: z.object({
  total: z.number().int().nonnegative(), wins: z.number().int().nonnegative(), losses: z.number().int().nonnegative(),
  positiveNetR: finite, negativeNetR: finite, grossProfitR: finite, grossLossR: finite, netR: finite,
  peakR: finite, maxDrawdownR: finite,
}) });
export const checkpointSchema = z.object({
  version: z.literal(ENGINE_VERSION), symbol: z.enum(SYMBOLS), tickSize: finite.positive(),
  lastTime: candleTime, count: z.number().int().positive(),
  candles: z.array(z.object({ time: candleTime, open: finite.positive(), high: finite.positive(),
    low: finite.positive(), close: finite.positive(), volume: finite.nonnegative() })).min(1).max(20),
  ema9: finite.nullable(), ema21: finite.nullable(), ema200: finite.nullable(), fast: finite.nullable(), slow: finite.nullable(),
  macdSignal: finite.nullable(), gain: average, loss: average, atr: average, rsi: finite.nullable(),
  swingLow: finite.nullable(), swingHigh: finite.nullable(), long: side, short: side,
}).refine((s) => s.candles.at(-1)?.time === s.lastTime && (!s.long.trade || s.long.trade.direction === 'LONG') && (!s.short.trade || s.short.trade.direction === 'SHORT'), 'Invalid checkpoint');

export const signalSchema = z.object({
  event_id: z.string().min(3).max(200), trade_id: z.string().min(3).max(200), event: z.enum(EVENT_TYPES),
  symbol: z.enum(SYMBOLS), direction: z.enum(['LONG','SHORT']), indicator: z.string(), timeframe: z.literal('1'),
  entry_price: finite.positive(), stop_loss: finite.positive(), take_profit: finite.positive(),
  exit_price: finite.positive().optional(), fee_rate_percent: finite.min(0).max(5),
  timestamp: z.string().datetime(), net_result_r: finite.optional(),
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
});
export const heartbeatSchema = z.object({
  instance_id: z.string().uuid(), websocket_connected: z.boolean(), binance_connected: z.boolean(),
  available_symbols: z.number().int().min(0).max(21), status: z.enum(["STARTING", "RUNNING", "RECOVERING", "ERROR", "STOPPED"]),
  error: z.string().max(500).nullable(),
});
export const commitSchema = z.object({
  instance_id: z.string().uuid(), symbol: z.enum(SYMBOLS), expected_revision: z.number().int().min(0),
  checkpoint: checkpointSchema,
  market: marketSchema,
  mode: z.enum(["live", "warmup", "recovery"]),
  events: z.array(signalSchema).max(4),
}).refine((p) => p.market.symbol === p.symbol && p.checkpoint['symbol'] === p.symbol && p.events.every((e) => e.symbol === p.symbol), "Symbol mismatch");