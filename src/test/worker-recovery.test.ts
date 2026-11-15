// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { MINUTE } from '@/lib/engine/model';
import { SignalService } from '../../engine-worker/service';

const sockets = vi.hoisted(() => [] as { emit: (event: string, data?: unknown) => void; terminate: () => void }[]);
vi.mock('ws', () => ({ default: class {
  handlers = new Map<string, ((data?: unknown) => void)[]>();
  constructor() { sockets.push(this); }
  on(event: string, fn: (data?: unknown) => void) { this.handlers.set(event, [...this.handlers.get(event) ?? [], fn]); }
  emit(event: string, data?: unknown) { for (const fn of this.handlers.get(event) ?? []) fn(data); }
  terminate() { this.emit('close'); }
} }));
vi.mock('../../engine-worker/binance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-worker/binance')>();
  return { ...actual, delay: async () => {}, binanceFetch: async () => ({ symbols: [
    { symbol: 'NEARUSDT', status: 'TRADING', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.001' }] },
  ] }), history: async (_symbol: string, start?: number, end?: number) => {
    const now = Math.floor((end ?? Date.now()) / MINUTE) * MINUTE;
    const first = start ?? now - 300 * MINUTE;
    return Array.from({ length: Math.max(0, (now - first) / MINUTE) }, (_, i) => ({ time: first + i * MINUTE,
      open: 100, high: 100.5, low: 99.5, close: 100, volume: 10 }));
  } };
});

afterEach(() => { vi.useRealTimers(); sockets.length = 0; vi.unstubAllGlobals(); });
describe('persistent worker orchestration (simulated transport)', () => {
  it('reconnects after disconnect, recovers a missed minute and ignores duplicate close messages without writes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
    const fetchSpy = vi.fn(() => { throw new Error('Observation must never write'); }); vi.stubGlobal('fetch', fetchSpy);
    const service = new SignalService('', '', true);
    try {
      await service.start();
      const first = sockets[0]; if (!first) throw new Error('Socket not created'); first.emit('open');
      expect(service.snapshot().configured).toBe(21); expect(service.snapshot().available).toBe(1);
      expect(service.snapshot().markets.filter((m) => m.status === 'UNAVAILABLE')).toHaveLength(20);
      const previous = service.snapshot().counts[0]?.lastTime; if (previous === undefined || previous === null) throw new Error('Missing checkpoint');
      first.terminate(); expect(service.snapshot().connected).toBe(false);
      await vi.advanceTimersByTimeAsync(2001);
      const second = sockets[1]; if (!second) throw new Error('No reconnect'); second.emit('open');
      vi.setSystemTime(previous + 3 * MINUTE + 5000);
      const message = JSON.stringify({ data: { s: 'NEARUSDT', k: { t: previous + 2 * MINUTE, o: '100', h: '100.5', l: '99.5', c: '100', v: '10', x: true } } });
      second.emit('message', message);
      await vi.advanceTimersByTimeAsync(0);
      expect(service.snapshot().counts[0]?.lastTime).toBe(previous + 2 * MINUTE);
      const count = service.snapshot().counts[0]?.candles;
      second.emit('message', message); await vi.advanceTimersByTimeAsync(0);
      expect(service.snapshot().counts[0]?.candles).toBe(count); expect(fetchSpy).not.toHaveBeenCalled();
    } finally { await service.stop(); }
  });
});