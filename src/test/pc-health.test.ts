// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { engineHealth } from '@/lib/engine/health';
import { heartbeatSchema } from '@/lib/engine/protocol';
import { localHealthResponse } from '../../engine-worker/local-health';

const now = Date.parse('2026-11-15T15:30:00Z');
const windows = { host_kind: 'hosted', runtime_mode: 'production', status: 'RUNNING',
  last_heartbeat_at: new Date(now - 20_000).toISOString(), binance_connected: true, websocket_connected: true,
  uptime_seconds: 123, scanned_symbols: 20, last_scan_at: '2026-11-15T15:29:00Z', available_symbols: 1,
  feed_health: { version: 1, initialized: true, rest_at: '2026-11-15T15:29:40Z', recovery_symbol: null,
    feeds: [{ symbol: 'NEARUSDT', message_at: '2026-11-15T15:29:59Z', event_at: '2026-11-15T15:29:59Z', closed_at: '2026-11-15T15:29:00Z', live_commit_at: '2026-11-15T15:29:00Z' }] } };

describe('truthful cloud scanner health', () => {
  it('shows ONLINE only for a real recent production cloud heartbeat', () => {
    expect(engineHealth(windows, true, now)).toMatchObject({ cloud: 'ONLINE', scanner: 'RUNNING', uptimeSeconds: 123, scannedSymbols: 20 });
    expect(engineHealth({ ...windows, host_kind: 'windows_pc' }, true, now).cloud).toBe('OFFLINE');
    expect(engineHealth({ ...windows, runtime_mode: 'temporary' }, true, now).cloud).toBe('OFFLINE');
  });
  it('expires online status at 90 seconds without pretending stored uptime is live', () => {
    const h = engineHealth({ ...windows, last_heartbeat_at: new Date(now - 90_000).toISOString() }, true, now);
    expect(h).toMatchObject({ cloud: 'OFFLINE', scanner: 'STOPPED', binance: 'DISCONNECTED', websocket: 'DISCONNECTED', uptimeSeconds: null });
  });
  it('stays OFFLINE if the scanner stopped or database health is unavailable', () => {
    expect(engineHealth({ ...windows, status: 'STOPPED' }, true, now).cloud).toBe('OFFLINE');
    expect(engineHealth(windows, false, now)).toMatchObject({ cloud: 'OFFLINE', scanner: 'STOPPED', binance: 'DISCONNECTED' });
  });
  it('never accepts impossible future or invalid heartbeats as ONLINE', () => {
    expect(engineHealth({ ...windows, last_heartbeat_at: new Date(now + 60_000).toISOString() }, true, now).cloud).toBe('OFFLINE');
    expect(engineHealth({ ...windows, last_heartbeat_at: 'invalid' }, true, now).cloud).toBe('OFFLINE');
  });
  it('keeps all 21 configured coins and rejects inflated scanner telemetry', () => {
    const input = { instance_id: '11111111-1111-4111-8111-111111111111', available_symbols: 20, status: 'RUNNING', error: null,
      websocket_connected: true, binance_connected: true, scanned_symbols: 21, uptime_seconds: 12 };
    expect(heartbeatSchema.parse(input).scanned_symbols).toBe(21);
    expect(heartbeatSchema.safeParse({ ...input, scanned_symbols: 22 }).success).toBe(false);
    expect(heartbeatSchema.safeParse({ ...input, uptime_seconds: -1 }).success).toBe(false);
  });
  it('does not report RUNNING when fresh heartbeats hide stopped candle progress', () => {
    expect(engineHealth({ ...windows, last_scan_at: new Date(now - 180_000).toISOString() }, true, now).scanner).toBe('RECOVERING');
    expect(engineHealth({ ...windows, websocket_connected: false }, true, now).scanner).toBe('RECOVERING');
    expect(engineHealth({ ...windows, last_scan_at: null }, true, now).scanner).toBe('RECOVERING');
  });
  it('schedules the next one-minute candle only while real scanning is healthy', () => {
    expect(engineHealth(windows, true, now).nextScanAt).toBe('2026-11-15T15:31:00.000Z');
    expect(engineHealth({ ...windows, status: 'STOPPED' }, true, now).nextScanAt).toBeNull();
    expect(engineHealth(windows, false, now).nextScanAt).toBeNull();
  });
  it('requires fresh valid messages and live commits for every available coin, not socket-open', () => {
    expect(engineHealth({ ...windows, feed_health: null }, true, now).scanner).toBe('RECOVERING');
    expect(engineHealth({ ...windows, available_symbols: 20 }, true, now).scanner).toBe('RECOVERING');
    const feed = windows.feed_health.feeds[0];
    if (!feed) throw new Error('Missing feed');
    for (const patch of [{ message_at: null }, { event_at: '2026-11-15T15:29:00Z' }, { live_commit_at: null }, { closed_at: null }]) {
      expect(engineHealth({ ...windows, feed_health: { ...windows.feed_health, feeds: [{ ...feed, ...patch }] } }, true, now).scanner).toBe('RECOVERING');
    }
  });
  it('shows an online cloud with a restricted scanner, never connected data or a next scan', () => {
    const restricted = { ...windows, status: 'ERROR', error: 'BINANCE_ACCESS_RESTRICTED: HTTP 451 /fapi/v1/exchangeInfo — Restricted location' };
    expect(engineHealth(restricted, true, now)).toMatchObject({ cloud: 'ONLINE', scanner: 'ERROR', binance: 'ACCESS RESTRICTED', websocket: 'DISCONNECTED', nextScanAt: null });
  });
  it('retains a recorded access issue but expires its cloud liveness at 90 seconds', () => {
    const restricted = { ...windows, status: 'ERROR', error: 'BINANCE_ACCESS_RESTRICTED: HTTP 451', last_heartbeat_at: new Date(now - 90_000).toISOString() };
    expect(engineHealth(restricted, true, now)).toMatchObject({ cloud: 'OFFLINE', scanner: 'STOPPED', binance: 'DISCONNECTED', lastAccessIssue: 'ACCESS RESTRICTED' });
  });
  it('distinguishes an IP ban from a regional restriction and transient errors', () => {
    expect(engineHealth({ ...windows, status: 'ERROR', error: 'BINANCE_IP_BANNED: HTTP 418' }, true, now).binance).toBe('IP BANNED');
    expect(engineHealth({ ...windows, status: 'ERROR', binance_connected: false, error: 'BINANCE_NETWORK_ERROR: timeout' }, true, now).binance).toBe('DISCONNECTED');
  });
});

describe('private read-only local health', () => {
  const secret = 'isolated-local-health-key-with-32-characters';
  const request = (path: string, key?: string, method = 'GET') => new Request(`http://localhost:8787${path}`, {
    method, headers: key ? { authorization: `Bearer ${key}` } : {},
  });
  it('does not reveal scanner data to unauthenticated or wrong-key requests', () => {
    expect(localHealthResponse(request('/health'), secret, () => ({ private: true })).status).toBe(401);
    expect(localHealthResponse(request('/health', 'wrong-key'), secret, () => ({})).status).toBe(401);
  });
  it('allows only health reads; no control, history or secret API', async () => {
    expect(localHealthResponse(request('/stop', secret), secret, () => ({})).status).toBe(404);
    expect(localHealthResponse(request('/health', secret, 'POST'), secret, () => ({})).status).toBe(405);
    const result = localHealthResponse(request('/health', secret), secret, () => ({ running: false }));
    expect(await result.json()).toEqual({ running: false });
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
});