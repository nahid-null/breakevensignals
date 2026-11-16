import { z } from 'zod';
import { ABSOLUTE_MAX_LEVERAGE, ROBOT_SYMBOL_PATTERN } from './config';

const symbol = z.string().regex(ROBOT_SYMBOL_PATTERN);
const direction = z.enum(['LONG', 'SHORT']);
const price = z.number().finite().positive();
const money = z.number().finite();
const time = z.string().datetime();
const exitReason = z.enum(['TAKE_PROFIT', 'STOP_LOSS', 'BREAKEVEN_STOP', 'EARLY_EXIT', 'PROFIT_EXIT', 'TIME_EXIT', 'LIQUIDATION', 'EMERGENCY_STOP']);

export const robotMarketSchema = z.object({
  symbol, price: price.nullable(), spread_bps: z.number().finite().min(0).nullable(), depth_usd: z.number().finite().min(0).nullable(),
  imbalance: z.number().finite().min(-1).max(1).nullable(), quote_volume_24h: z.number().finite().min(0).nullable(),
  trend_1h: z.number().int().min(-1).max(1).nullable(), trend_15m: z.number().int().min(-1).max(1).nullable(),
  status: z.enum(['LIVE', 'WARMING UP', 'RECOVERING', 'UNAVAILABLE', 'PAUSED']), liquidity: z.string().max(160).nullable(),
  best_direction: direction.nullable(), best_score: z.number().int().min(0).max(100).nullable(), note: z.string().max(160).nullable(),
  last_candle_at: time.nullable(),
}).strict();

/** Fills are re-described by the app so Telegram text is built server-side from validated numbers only. */
export const robotFillSchema = z.object({
  kind: z.enum(['PARTIAL', 'CLOSE']), price, qty: z.number().finite().positive(), pnl: money, fee: z.number().finite().min(0),
  reason: z.union([exitReason, z.literal('TP1')]), time: z.number().int().positive(),
}).strict();

export const robotUpdateSchema = z.object({
  id: z.string().min(5).max(80), symbol, direction, expected_version: z.number().int().min(1), version: z.number().int().min(2),
  status: z.enum(['OPEN', 'CLOSED']), quantity_open: z.number().finite().min(0), margin: z.number().finite().min(0), stop_loss: price,
  tp1_done: z.boolean(), fees: z.number().finite().min(0), realized_pnl: money, unrealized_pnl: money, last_price: price,
  closed_at: time.nullable(), exit_price: price.nullable(), exit_reason: exitReason.nullable(), last_candle_time: z.number().int().min(0),
  pnl_delta: money, entry_price: price, leverage: z.number().int().min(1).max(ABSOLUTE_MAX_LEVERAGE), opened_at: time,
  fills: z.array(robotFillSchema).max(5), notify: z.boolean(),
}).strict();

export const robotOpenSchema = z.object({
  id: z.string().min(5).max(80), symbol, direction, setup: z.enum(['SWEEP_RECLAIM', 'PULLBACK_RECLAIM']),
  score: z.number().int().min(0).max(100), leverage: z.number().int().min(1).max(ABSOLUTE_MAX_LEVERAGE), band: z.string().max(60),
  entry_price: price, quantity: z.number().finite().positive(), margin: z.number().finite().positive(), notional: z.number().finite().positive(),
  stop_loss: price, tp1: price, tp2: price, liquidation_price: price, risk_usdt: z.number().finite().positive(),
  fees: z.number().finite().min(0), realized_pnl: money, liquidity: z.string().max(160), opened_at: time,
  last_candle_time: z.number().int().min(0), balance_before: z.number().finite().min(0),
}).strict().refine((o) => o.direction === 'LONG' ? o.stop_loss < o.entry_price && o.tp1 > o.entry_price : o.stop_loss > o.entry_price && o.tp1 < o.entry_price,
  { message: 'Stop and target must sit on the correct side of entry' });

export const robotSignalSchema = z.object({
  id: z.string().min(5).max(80), symbol, direction, setup: z.enum(['SWEEP_RECLAIM', 'PULLBACK_RECLAIM']), score: z.number().int().min(0).max(100),
  parts: z.record(z.string(), z.number().finite()), entry_price: price, stop_loss: price, tp1: price, tp2: price,
  liquidity: z.string().max(160).nullable(), decision: z.enum(['TAKEN', 'SKIPPED', 'REJECTED']), reason: z.string().max(160).nullable(),
  candle_time: time,
}).strict();

export const robotCommitSchema = z.object({
  instance_id: z.string().uuid(),
  markets: z.array(robotMarketSchema).max(60).default([]),
  updates: z.array(robotUpdateSchema).max(20).default([]),
  opens: z.array(robotOpenSchema).max(5).default([]),
  signals: z.array(robotSignalSchema).max(120).default([]),
}).strict();
export type RobotCommit = z.infer<typeof robotCommitSchema>;
export type RobotCommitResult = { paused: boolean; applied?: string[]; conflicts?: string[]; opened?: string[]; rejected?: { id: string; reason: string }[] };
