/** Flat Binance-like closed candles for isolated worker tests, aligned to the requested interval. */
const MINUTE = 60_000;
export function mockHistory(_symbol: string, start?: number, end?: number, _signal?: unknown, interval: '1m' | '5m' | '15m' = '1m', high = 100.5, low = 99.5) {
  const span = interval === '15m' ? 15 * MINUTE : interval === '5m' ? 5 * MINUTE : MINUTE;
  const limit = Math.floor((end ?? Date.now()) / span) * span;
  const first = start !== undefined ? Math.ceil(start / span) * span : limit - 300 * span;
  return Array.from({ length: Math.max(0, (limit - first) / span) }, (_, i) => ({ time: first + i * span, open: 100, high, low, close: 100, volume: 10 }));
}
