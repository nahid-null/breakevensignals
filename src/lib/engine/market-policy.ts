import { marketAccessCode } from './market-access';

export const PAUSED_MARKET_MESSAGE = 'Signal delivery paused: resolve Binance access and restart the scanner.';

/** A recorded restriction remains a safety latch even after its heartbeat expires. */
export function marketProcessingPaused(engine: { error?: string | null } | null | undefined) {
  return marketAccessCode(engine?.error) !== null;
}

export function contractFeedStatus(market: { status: string; last_candle_at: string | null } | undefined,
  health: { heartbeatFresh: boolean; scanner: string; lastAccessIssue?: string | null } | undefined,
  readFailed = false, now = Date.now()) {
  if (market?.status === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (readFailed || !health?.heartbeatFresh || health.scanner === 'STOPPED') return 'OFFLINE';
  if (health.lastAccessIssue) return health.lastAccessIssue;
  if (!market) return 'NO FEED';
  const age = now - Date.parse(market.last_candle_at ?? '');
  if (health.scanner !== 'RUNNING' || !Number.isFinite(age) || age < -5000 || age >= 180_000) return 'STALE';
  return market.status;
}