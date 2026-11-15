import { z } from "zod";
import { SYMBOLS } from "../config";
import { webhookSchema } from "../webhook-schema";

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
  checkpoint: z.record(z.unknown()).refine((s) => JSON.stringify(s).length < 100_000, "Checkpoint too large"),
  market: marketSchema,
  events: z.array(webhookSchema.and(z.object({ net_result_r: z.number().finite().optional() }))).max(4),
}).refine((p) => p.market.symbol === p.symbol && p.checkpoint['symbol'] === p.symbol && p.events.every((e) => e.symbol === p.symbol), "Symbol mismatch");