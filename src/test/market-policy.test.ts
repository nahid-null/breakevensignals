import { describe, expect, it } from 'vitest';
import { contractFeedStatus, marketProcessingPaused } from '@/lib/engine/market-policy';

const now = Date.parse('2026-11-16T09:00:00Z');
const market = { status: 'LIVE', last_candle_at: '2026-11-16T08:59:00Z' };
const health = { heartbeatFresh: true, scanner: 'RUNNING', lastAccessIssue: null };
describe('consistent saved-feed policy', () => {
  it('treats recorded 451 and 418 as pauses, not a transient outage', () => {
    expect(marketProcessingPaused({ error: 'BINANCE_ACCESS_RESTRICTED: HTTP 451' })).toBe(true);
    expect(marketProcessingPaused({ error: 'BINANCE_IP_BANNED: HTTP 418' })).toBe(true);
    expect(marketProcessingPaused({ error: 'BINANCE_NETWORK_ERROR: timeout' })).toBe(false);
  });
  it('does not call a stale symbol live even when the overall scanner is running', () => {
    expect(contractFeedStatus(market, health, false, now)).toBe('LIVE');
    expect(contractFeedStatus({ ...market, last_candle_at: '2026-11-16T08:57:00Z' }, health, false, now)).toBe('STALE');
    expect(contractFeedStatus({ ...market, last_candle_at: null }, health, false, now)).toBe('STALE');
    expect(contractFeedStatus(undefined, health, false, now)).toBe('NO FEED');
  });
  it('projects the same restriction and offline states for dashboard and health feeds', () => {
    expect(contractFeedStatus(market, { ...health, scanner: 'ERROR', lastAccessIssue: 'ACCESS RESTRICTED' }, false, now)).toBe('ACCESS RESTRICTED');
    expect(contractFeedStatus(market, health, true, now)).toBe('OFFLINE');
    expect(contractFeedStatus(market, { ...health, heartbeatFresh: false }, false, now)).toBe('OFFLINE');
    expect(contractFeedStatus({ ...market, status: 'UNAVAILABLE' }, health, false, now)).toBe('UNAVAILABLE');
  });
});