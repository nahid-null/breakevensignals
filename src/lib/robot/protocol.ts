import { z } from 'zod';
import { PAPER_LEVERAGE, ROBOT_SYMBOL_PATTERN } from './config';
import { SETUPS } from './strategy';

const symbol = z.string().regex(ROBOT_SYMBOL_PATTERN);
const direction = z.enum(['LONG', 'SHORT']);
const price = z.number().finite().positive();
const money = z.number().finite();
const time = z.string().datetime();
const setup = z.enum(SETUPS);
const exitReason = z.enum(['TAKE_PROFIT', 'STOP_LOSS', 'BREAKEVEN_STOP', 'EARLY_EXIT', 'PROFIT_EXIT', 'TIME_EXIT', 'LIQUIDATION', 'EMERGENCY_STOP']);
const note = z.string().max(160).nullable();
const score = z.number().int().min(0).max(100).nullable();

export const robotMarketSchema = z.object({
  symbol, price: price.nullable(), spread_bps: z.number().finite().min(0).nullable(), depth_usd: z.number().finite().min(0).nullable(),
  imbalance: z.number().finite().min(-1).max(1).nullable(), quote_volume_24h: z.number().finite().min(0).nullable(),
  trend_1h: z.number().int().min(-1).max(1).nullable(), trend_15m: z.number().int().min(-1).max(1).nullable(),
  status: z.enum(['LIVE', 'WARMING UP', 'RECOVERING', 'UNAVAILABLE', 'PAUSED']), liquidity: z.string().max(160).nullable(),
  best_direction: direction.nullable(), best_score: score, note, note_long: note, note_short: note, score_long: score, score_short: score,
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
  tp: price, funding: money, net_roi_pct: money,
  tp1_done: z.boolean(), fees: z.number().finite().min(0), realized_pnl: money, unrealized_pnl: money, last_price: price,
  closed_at: time.nullable(), exit_price: price.nullable(), exit_reason: exitReason.nullable(), last_candle_time: z.number().int().min(0),
  pnl_delta: money, entry_price: price, leverage: z.literal(PAPER_LEVERAGE), opened_at: time,
  fills: z.array(robotFillSchema).max(5), notify: z.boolean(),
}).strict();

export const robotOpenSchema = z.object({
  id: z.string().min(5).max(80), symbol, direction, setup, score: z.number().int().min(0).max(100), leverage: z.literal(PAPER_LEVERAGE), band: z.string().max(60),
  entry_price: price, quantity: z.number().finite().positive(), requested_quantity: z.number().finite().positive(), fill_status: z.enum(['FILLED', 'PARTIAL']),
  margin: z.number().finite().positive(), notional: z.number().finite().positive(),
  stop_loss: price, tp1: price, tp2: price, liquidation_price: price, risk_usdt: z.number().finite().positive(),
  fees: z.number().finite().min(0), entry_fee: z.number().finite().min(0), realized_pnl: money, liquidity: z.string().max(160), opened_at: time,
  last_candle_time: z.number().int().min(0), balance_before: z.number().finite().min(0), target_roi_pct: z.number().finite().positive(), tick_size: price,
}).strict().refine((o) => o.direction === 'LONG' ? o.stop_loss < o.entry_price && o.tp1 > o.entry_price : o.stop_loss > o.entry_price && o.tp1 < o.entry_price,
  { message: 'Stop and target must sit on the correct side of entry' })
  .refine((o) => Math.abs(o.notional / o.margin - PAPER_LEVERAGE) < 1e-6, { message: 'Notional must equal margin × 50' });

export const robotSignalSchema = z.object({
  id: z.string().min(5).max(80), symbol, direction, setup, score: z.number().int().min(0).max(100),
  parts: z.record(z.string(), z.number().finite()), entry_price: price, stop_loss: price, tp1: price, tp2: price,
  liquidity: z.string().max(160).nullable(), decision: z.enum(['TAKEN', 'SKIPPED', 'REJECTED']), reason: z.string().max(160).nullable(),
  candle_time: time,
}).strict();

const counts = z.record(z.string().max(120), z.number().int().min(0)).refine((r) => Object.keys(r).length <= 80, 'Too many keys');
export const robotScannerSchema = z.object({
  monitored: z.number().int().min(0).max(60), live_feeds: z.number().int().min(0).max(60), last_candle_at: time.nullable(),
  queue: z.array(z.object({ symbol, direction, setup, score: z.number().int(), rank: z.number().finite(), expires_at: time, waiting: z.string().max(120).nullable() }).strict()).max(40),
  counts: z.object({ evaluated: z.number().int().min(0), long_candidates: z.number().int().min(0), short_candidates: z.number().int().min(0),
    rejected: z.number().int().min(0), qualified: z.number().int().min(0), orders_submitted: z.number().int().min(0),
    orders_partial: z.number().int().min(0), orders_rejected: z.number().int().min(0) }).strict(),
  reasons: counts, exec_failures: counts, setups: counts,
}).strict();

export const robotCommitSchema = z.object({
  instance_id: z.string().uuid(),
  markets: z.array(robotMarketSchema).max(60).default([]),
  updates: z.array(robotUpdateSchema).max(20).default([]),
  opens: z.array(robotOpenSchema).max(5).default([]),
  signals: z.array(robotSignalSchema).max(120).default([]),
  scanner: robotScannerSchema.optional(),
}).strict();
export type RobotCommit = z.infer<typeof robotCommitSchema>;
export type RobotCommitResult = { paused: boolean; applied?: string[]; conflicts?: string[]; opened?: string[]; rejected?: { id: string; reason: string }[] };
