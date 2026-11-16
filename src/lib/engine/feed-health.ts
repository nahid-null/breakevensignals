import { z } from 'zod';
import { SYMBOLS } from '../config';

export const MESSAGE_MAX_AGE_MS = 60_000;
export const SCAN_MAX_AGE_MS = 180_000;
const time = z.string().datetime().nullable();
export const feedHealthSchema = z.object({
  version: z.literal(1), initialized: z.boolean(), rest_at: time,
  recovery_symbol: z.enum(SYMBOLS).nullable(),
  feeds: z.array(z.object({ symbol: z.enum(SYMBOLS), message_at: time, event_at: time,
    closed_at: time, live_commit_at: time })).max(21),
}).strict().refine((h) => new Set(h.feeds.map((f) => f.symbol)).size === h.feeds.length, 'Duplicate feed');
export type FeedHealth = z.infer<typeof feedHealthSchema>;

export function freshTime(value: string | null | undefined, maxAge: number, now = Date.now()) {
  const age = now - Date.parse(value ?? '');
  return Number.isFinite(age) && age >= -5000 && age < maxAge;
}

export function parseFeedHealth(value: unknown): FeedHealth | null {
  const result = feedHealthSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function feedHasLiveEvidence(feed: FeedHealth['feeds'][number], now = Date.now()) {
  return freshTime(feed.message_at, MESSAGE_MAX_AGE_MS, now) && freshTime(feed.event_at, MESSAGE_MAX_AGE_MS, now)
    && freshTime(feed.closed_at, SCAN_MAX_AGE_MS, now) && freshTime(feed.live_commit_at, SCAN_MAX_AGE_MS, now);
}