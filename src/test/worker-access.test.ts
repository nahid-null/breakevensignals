// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINUTE } from '@/lib/engine/model';
import { engineHealth } from '@/lib/engine/health';
import { SignalService } from '../../engine-worker/service';
import { BinanceRequestError, binanceFetch } from '../../engine-worker/binance';

type FakeSocket = { emit: (event: string, data?: unknown, response?: unknown) => void; terminate: () => void };
const sockets = vi.hoisted(() => [] as FakeSocket[]);
vi.mock('ws', () => ({ default: class {
  handlers = new Map<string, ((...data: unknown[]) => void)[]>();
  constructor() { sockets.push(this); }
  on(event: string, fn: (...data: unknown[]) => void) { this.handlers.set(event, [...this.handlers.get(event) ?? [], fn]); }
  emit(event: string, ...data: unknown[]) { for (const fn of this.handlers.get(event) ?? []) fn(...data); }
  terminate() { this.emit('close'); }
} }));
vi.mock('../../engine-worker/binance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-worker/binance')>();
  return { ...actual, delay: async () => {}, binanceFetch: vi.fn(), history: async () => Array.from({ length: 300 }, (_, i) => ({
    time: Math.floor(Date.now() / MINUTE) * MINUTE - (300 - i) * MINUTE, open: 100, high: 100.5, low: 99.5, close: 100, volume: 10,
  })) };
});

type AppCall = { action: string; data: Record<string, unknown> };
const calls: AppCall[] = [];
let service: SignalService | null = null;
const exchange = { symbols: [{ symbol: 'NEARUSDT', status: 'TRADING', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.001' }] }] };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); calls.length = 0;
  vi.mocked(binanceFetch).mockReset().mockResolvedValue(exchange);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)) as AppCall;
    calls.push(input);
    if (input.action === 'state') return Response.json({ checkpoints: [] });
    if (input.action === 'market-state') return Response.json({ markets: [] });
    if (input.action === 'commit') return Response.json({ conflict: false, revision: Number(input.data['expected_revision']) + 1 });
    return Response.json({ acquired: true, stopped: true });
  }));
  service = new SignalService('https://isolated.invalid', 'isolated-key', false, 'production', 'hosted');
});
afterEach(async () => { await service?.stop(); service = null; vi.useRealTimers(); sockets.length = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('restriction-aware worker lifecycle (isolated transport)', () => {
  it('reports cloud liveness before startup 451 and remains paused without market retries or writes', async () => {
    if (!service) throw new Error('Missing service');
    vi.mocked(binanceFetch).mockRejectedValue(new BinanceRequestError('restricted', 451, '/fapi/v1/exchangeInfo', 'Restricted location'));
    await service.start();
    expect(calls[0]?.action).toBe('heartbeat');
    expect(calls[0]?.data['status']).toBe('STARTING');
    expect(service.snapshot()).toMatchObject({ process_alive: true, running: false, market_paused: true, connected: false });
    const restricted = calls.find((c) => c.action === 'heartbeat' && c.data['status'] === 'ERROR');
    expect(restricted?.data['error']).toContain('BINANCE_ACCESS_RESTRICTED: HTTP 451');
    expect(restricted?.data['binance_connected']).toBe(false);
    expect(restricted?.data['websocket_connected']).toBe(false);
    const publicHealth = engineHealth({ status: 'ERROR', error: String(restricted?.data['error']), host_kind: 'hosted', runtime_mode: 'production',
      last_heartbeat_at: new Date().toISOString(), binance_connected: false, websocket_connected: false }, true);
    expect(publicHealth).toMatchObject({ cloud: 'ONLINE', scanner: 'ERROR', binance: 'ACCESS RESTRICTED', nextScanAt: null });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(binanceFetch).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(0);
    expect(calls.every((c) => c.action === 'heartbeat')).toBe(true);
    expect(calls.filter((c) => c.action === 'heartbeat')).toHaveLength(9);
  });
  it('pauses on a later REST 451, cancels reconnect and ignores subsequent candle messages', async () => {
    if (!service) throw new Error('Missing service');
    await service.start();
    const socket = sockets[0]; if (!socket) throw new Error('Missing socket'); socket.emit('open');
    vi.mocked(binanceFetch).mockRejectedValue(new BinanceRequestError('restricted', 451, '/fapi/v1/time', 'Restricted location'));
    const commits = calls.filter((c) => c.action === 'commit').length;
    const time = Date.now();
    socket.emit('message', JSON.stringify({ data: { s: 'NEARUSDT', k: { t: time, o: '100', h: '100.5', l: '99.5', c: '100', v: '10', x: true } } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(service.snapshot()).toMatchObject({ process_alive: true, running: false, market_paused: true, connected: false });
    const callsAtPause = calls.length;
    const requestsAtPause = vi.mocked(binanceFetch).mock.calls.length;
    socket.emit('message', JSON.stringify({ data: { s: 'NEARUSDT', k: { t: time + MINUTE, o: '100', h: '101', l: '99', c: '100', v: '10', x: true } } }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(binanceFetch).toHaveBeenCalledTimes(requestsAtPause);
    expect(sockets).toHaveLength(1);
    expect(calls.filter((c) => c.action === 'commit')).toHaveLength(commits);
    expect(calls.slice(callsAtPause).every((c) => c.action === 'heartbeat')).toBe(true);
  });
  it('also pauses an explicit 451 from the WebSocket handshake', async () => {
    if (!service) throw new Error('Missing service');
    await service.start();
    const socket = sockets[0]; if (!socket) throw new Error('Missing socket');
    socket.emit('unexpected-response', {}, { statusCode: 451, resume: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.snapshot().error).toContain('BINANCE_ACCESS_RESTRICTED: HTTP 451 /stream');
    expect(service.snapshot().market_paused).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });
  it('retries a transient startup outage and resumes healthy candle processing', async () => {
    if (!service) throw new Error('Missing service');
    vi.mocked(binanceFetch).mockRejectedValueOnce(new BinanceRequestError('provider', 503, '/fapi/v1/exchangeInfo', 'Temporary outage'));
    await service.start();
    expect(service.snapshot().market_paused).toBe(false);
    await vi.advanceTimersByTimeAsync(2001);
    expect(service.snapshot()).toMatchObject({ process_alive: true, initialized: true, running: true });
    const socket = sockets[0]; if (!socket) throw new Error('Missing socket'); socket.emit('open');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.snapshot().error).toBeNull();
    expect(calls.some((c) => c.action === 'commit')).toBe(true);
    expect(calls.some((c) => c.action === 'deliveries')).toBe(true);
  });
  it('does not begin market startup if another worker owns the lease', async () => {
    if (!service) throw new Error('Missing service');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ acquired: false })));
    await expect(service.start()).rejects.toThrow('Another engine instance owns the lease');
    expect(binanceFetch).not.toHaveBeenCalled();
    expect(service.snapshot().process_alive).toBe(false);
  });
});