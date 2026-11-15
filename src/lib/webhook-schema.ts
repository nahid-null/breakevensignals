import { z } from "zod";
import { EVENT_TYPES, INDICATORS, SYMBOLS, normalizeSymbol } from "./config";

const price = z.coerce.number().finite().positive();

export const webhookSchema = z
  .object({
    event_id: z.string().min(3).max(200),
    trade_id: z.string().min(3).max(200),
    event: z.enum(EVENT_TYPES),
    symbol: z.string().transform(normalizeSymbol).pipe(z.enum(SYMBOLS)),
    direction: z.enum(["LONG", "SHORT"]),
    indicator: z.string(),
    timeframe: z.string().min(1).max(10),
    entry_price: price,
    stop_loss: price,
    take_profit: price,
    exit_price: price.optional(),
    fee_rate_percent: z.coerce.number().finite().min(0).max(5).optional(),
    timestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid timestamp"),
  })
  .refine((p) => p.indicator === INDICATORS[p.direction], { message: "Indicator does not match direction" });

export type WebhookPayload = z.infer<typeof webhookSchema>;
