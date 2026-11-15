// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { engineHealth } from '@/lib/engine/health';
import { heartbeatSchema } from '@/lib/engine/protocol';
import { localHealthResponse } from '../../engine-worker/local-health';

const now = Date.parse('2026-11-15T15:30:00Z');
const windows = { host_kind: 'windows_pc', runtime_mode: 'production', status: 'RUNNING',
  last_heartbeat_at: new Date(now - 20_000).toISOString(), binance_connected: true, websocket_connected: true,
  uptime_seconds: 123, scanned_symbols: 20, last_scan_at: '2026-11-15T15:29:00Z' };

describe('truthful Windows PC health', () => {
  it('shows ONLINE only for a real recent production Windows heartbeat', () => {
    expect(engineHealth(windows, true, now)).toMatchObject({ pc: 'ONLINE', scanner: 'RUNNING', uptimeSeconds: 123, scannedSymbols: 20 });
    expect(engineHealth({ ...windows, host_kind: 'hosted' }, true, now).pc).toBe('OFFLINE');
    expect(engineHealth({ ...windows, runtime_mode: 'temporary' }, true, now).pc).toBe('OFFLINE');
  });
  it('expires online status at 90 seconds without pretending stored uptime is live', () => {
    const h = engineHealth({ ...windows, last_heartbeat_at: new Date(now - 90_000).toISOString() }, true, now);
    expect(h).toMatchObject({ pc: 'OFFLINE', scanner: 'STOPPED', binance: 'DISCONNECTED', websocket: 'DISCONNECTED', uptimeSeconds: null });
  });
  it('stays OFFLINE if the scanner stopped or database health is unavailable', () => {
    expect(engineHealth({ ...windows, status: 'STOPPED' }, true, now).pc).toBe('OFFLINE');
    expect(engineHealth(windows, false, now)).toMatchObject({ pc: 'OFFLINE', scanner: 'STOPPED', binance: 'DISCONNECTED' });
  });
  it('never accepts impossible future or invalid heartbeats as ONLINE', () => {
    expect(engineHealth({ ...windows, last_heartbeat_at: new Date(now + 60_000).toISOString() }, true, now).pc).toBe('OFFLINE');
    expect(engineHealth({ ...windows, last_heartbeat_at: 'invalid' }, true, now).pc).toBe('OFFLINE');
  });
  it('keeps all 21 configured coins and rejects inflated scanner telemetry', () => {
    const input = { instance_id: '11111111-1111-4111-8111-111111111111', available_symbols: 20, status: 'RUNNING', error: null,
      websocket_connected: true, binance_connected: true, scanned_symbols: 21, uptime_seconds: 12 };
    expect(heartbeatSchema.parse(input).scanned_symbols).toBe(21);
    expect(heartbeatSchema.safeParse({ ...input, scanned_symbols: 22 }).success).toBe(false);
    expect(heartbeatSchema.safeParse({ ...input, uptime_seconds: -1 }).success).toBe(false);
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