// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MINUTE } from '@/lib/engine/model';
import { heartbeatSchema } from '@/lib/engine/protocol';
import { SignalService } from '../../engine-worker/service';
import { BINANCE_WS, history } from '../../engine-worker/binance';

const sockets = vi.hoisted(() => [] as { url: string; emit: (event: string, data?: unknown) => void }[]);
vi.mock('../../engine-worker/websocket', () => ({ default: class {
  handlers = new Map<string, ((data?: unknown) => void)[]>();
  constructor(readonly url: string) { sockets.push(this); }
  on(event: string, handler: (data?: unknown) => void) { this.handlers.set(event, [...this.handlers.get(event) ?? [], handler]); }
  emit(event: string, data?: unknown) { for (const handler of this.handlers.get(event) ?? []) handler(data); }
  terminate() { this.emit('close'); }
} }));
vi.mock('../../engine-worker/binance', async (original) => {
  const actual = await original<typeof import('../../engine-worker/binance')>();
  return { ...actual, delay: async () => {}, binanceFetch: async () => ({ symbols: [
    { symbol: 'NEARUSDT', status: 'TRADING', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.001' }] },
  ] }), history: vi.fn(async () => Array.from({ length: 300 }, (_, i) => ({ time: Math.floor(Date.now() / MINUTE) * MINUTE - (300 - i) * MINUTE,
    open: 100, high: 101, low: 99, close: 100, volume: 10 }))) };
});
let service: SignalService | null = null;
afterEach(async () => { await service?.stop(); service = null; sockets.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(history).mockReset(); });
const candles = () => Array.from({ length: 300 }, (_, i) => ({ time: Math.floor(Date.now() / MINUTE) * MINUTE - (300 - i) * MINUTE,
  open: 100, high: 101, low: 99, close: 100, volume: 10 }));
async function start() {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-11-16T09:20:00Z'));
  vi.mocked(history).mockImplementation(async (_symbol, first, end) => {
    const now = Math.floor((end ?? Date.now()) / MINUTE) * MINUTE;
    return first === undefined ? candles() : Array.from({ length: Math.max(0, (now - first) / MINUTE) }, (_, i) => ({ time: first + i * MINUTE, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
  });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Observation must not write'); }));
  service = new SignalService('', '', true);
  await service.start();
  const socket = sockets[0]; if (!socket) throw new Error('No socket');
  socket.emit('open');
  return { scanner: service, socket };
}
describe('validated live feed and startup monitoring', () => {
  it('uses the documented same-host Futures market candle path', async () => {
    const { socket } = await start();
    expect(BINANCE_WS).toBe('wss://fstream.binance.com/market/stream?streams=');
    expect(socket.url).toBe('wss://fstream.binance.com/market/stream?streams=nearusdt@kline_1m');
  });
  it('does not count socket-open or stale/invalid payloads as live data', async () => {
    const { scanner, socket } = await start();
    expect(scanner.snapshot()).toMatchObject({ connected: true, running: false, receivedAt: 0, last_scan_at: null });
    socket.emit('message', JSON.stringify({ data: { s: 'NEARUSDT', E: Date.now() - 60_000, k: { t: Date.now() - MINUTE, o: '100', h: '101', l: '99', c: '100', v: '10', x: false } } }));
    socket.emit('message', JSON.stringify({ data: { s: 'NEARUSDT', E: Date.now(), k: { t: Date.now(), o: '100', h: '101', l: '99', c: '-1', v: '10', x: false } } }));
    expect(scanner.snapshot().receivedAt).toBe(0);
  });
  it('requires a newly validated closed candle and successful live commit before RUNNING', async () => {
    const { scanner, socket } = await start();
    const first = scanner.snapshot().counts[0]?.lastTime;
    if (first === undefined || first === null) throw new Error('No checkpoint');
    socket.emit('message', JSON.stringify({ data: { s: 'NEARUSDT', E: Date.now(), k: { t: first + MINUTE, o: '100', h: '101', l: '99', c: '100', v: '10', x: false } } }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(scanner.snapshot().running).toBe(false);
    vi.setSystemTime(first + 2 * MINUTE + 1000);
    socket.emit('message', JSON.stringify({ data: { s: 'NEARUSDT', E: Date.now(), k: { t: first + MINUTE, o: '100', h: '101', l: '99', c: '100', v: '10', x: true } } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(scanner.snapshot().running).toBe(true);
    expect(scanner.snapshot().last_scan_at).toBe(new Date(first + 2 * MINUTE).toISOString());
  });
  it('refreshes REST success during slow history while keeping the startup no-data watchdog active', async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-11-16T09:20:00Z'));
    const rows = candles();
    vi.mocked(history).mockImplementationOnce(async () => { await new Promise((resolve) => setTimeout(resolve, 100_000)); return rows; });
    const reports: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      if (input.action === 'heartbeat') reports.push(input.data);
      if (input.action === 'state') return Response.json({ checkpoints: [] });
      if (input.action === 'market-state') return Response.json({ markets: [] });
      return Response.json({ acquired: true, conflict: false, revision: 1, stopped: true });
    }));
    service = new SignalService('https://isolated.invalid', 'isolated-key', false);
    const starting = service.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = sockets[0]; if (!first) throw new Error('No startup socket'); first.emit('open');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.snapshot().initialized).toBe(false);
    expect(service.snapshot().connected).toBe(false);
    expect(sockets.length).toBe(1);
    await vi.advanceTimersByTimeAsync(2001);
    expect(sockets.length).toBe(2);
    await vi.advanceTimersByTimeAsync(38_000);
    await starting;
    expect(service.snapshot().feed_health.rest_at).toBe(new Date(Date.parse('2026-11-16T09:20:00Z') + 100_000).toISOString());
    expect(reports.at(-1)?.['binance_connected']).toBe(true);
  });
  it('rejects duplicate symbols and unknown private fields in heartbeat evidence', () => {
    const feed = { symbol: 'NEARUSDT', message_at: null, event_at: null, closed_at: null, live_commit_at: null };
    const input = { instance_id: '11111111-1111-4111-8111-111111111111', available_symbols: 1, status: 'RECOVERING', error: null,
      websocket_connected: true, binance_connected: true, feed_health: { version: 1, initialized: false, rest_at: null, recovery_symbol: null, feeds: [feed, feed] } };
    expect(heartbeatSchema.safeParse(input).success).toBe(false);
    expect(heartbeatSchema.safeParse({ ...input, feed_health: { ...input.feed_health, feeds: [feed], secret: 'must-reject' } }).success).toBe(false);
  });
});