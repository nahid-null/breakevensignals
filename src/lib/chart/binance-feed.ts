/**
 * Browser market data for the chart: the same Binance USD-M Futures REST klines and documented
 * `/market` WebSocket path the worker uses, so chart candles and robot candles share one source.
 */
import type { Candle } from '@/lib/engine/model';
import type { TimeframeId } from './timeframes';
import { tfMs } from './timeframes';

export const BINANCE_REST = 'https://fapi.binance.com';
export const BINANCE_WS = 'wss://fstream.binance.com/market/stream?streams=';
const MAX = 1500;

export class MarketDataError extends Error {}

export function parseKline(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const c = { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
  if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) || c.low <= 0 || c.high < c.low) return null;
  return c;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, signal ? { signal } : {});
  if (res.status === 451 || res.status === 403) throw new MarketDataError('Binance refused market data from this location (HTTP ' + res.status + ').');
  if (res.status === 418 || res.status === 429) throw new MarketDataError('Binance rate limit reached. Wait a minute and try again.');
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new MarketDataError(`Binance error ${res.status}: ${(body as { msg?: string } | null)?.msg ?? 'unknown'}`);
  return body;
}

export async function fetchKlines(symbol: string, interval: TimeframeId, o: { startTime?: number; endTime?: number; limit?: number }, signal?: AbortSignal): Promise<Candle[]> {
  const q = new URLSearchParams({ symbol, interval, limit: String(Math.min(o.limit ?? MAX, MAX)) });
  if (o.startTime !== undefined) q.set('startTime', String(o.startTime));
  if (o.endTime !== undefined) q.set('endTime', String(o.endTime));
  const rows = await getJson(`${BINANCE_REST}/fapi/v1/klines?${q}`, signal);
  if (!Array.isArray(rows)) throw new MarketDataError('Unexpected Binance candle response');
  return rows.map(parseKline).filter((c): c is Candle => c !== null);
}

/** Only fully closed bars (close time already passed): the engines never see a forming candle. */
export const closedOnly = (bars: Candle[], interval: TimeframeId, now = Date.now()) => bars.filter((b) => b.time + tfMs(interval) <= now);

/** Closed bars in [start, end), paginated in Binance's 1500-bar pages, de-duplicated and gap-checked. */
export async function fetchRange(symbol: string, interval: TimeframeId, start: number, end: number, signal?: AbortSignal): Promise<Candle[]> {
  const ms = tfMs(interval); const out: Candle[] = []; let from = start;
  for (let page = 0; page < 20 && from < end; page++) {
    const rows = await fetchKlines(symbol, interval, { startTime: from, endTime: end - 1, limit: MAX }, signal);
    for (const r of rows) if (r.time < end && (out.length === 0 || r.time > out.at(-1)!.time)) out.push(r);
    if (rows.length < MAX) break;
    from = rows.at(-1)!.time + ms;
  }
  return closedOnly(out, interval);
}

/** Latest `count` closed bars ending at `endTime` (default now). */
export async function fetchLatest(symbol: string, interval: TimeframeId, count: number, endTime?: number, signal?: AbortSignal): Promise<Candle[]> {
  const ms = tfMs(interval); const end = endTime ?? Date.now();
  return fetchRange(symbol, interval, Math.floor(end / ms) * ms - count * ms, end, signal);
}

export function gaps(bars: Candle[], interval: TimeframeId): number {
  const ms = tfMs(interval); let n = 0;
  for (let i = 1; i < bars.length; i++) if (bars[i]!.time - bars[i - 1]!.time !== ms) n++;
  return n;
}

const tickCache = new Map<string, number>();
export async function fetchTickSize(symbol: string, signal?: AbortSignal): Promise<number> {
  const hit = tickCache.get(symbol); if (hit) return hit;
  const info = await getJson(`${BINANCE_REST}/fapi/v1/exchangeInfo`, signal) as { symbols?: { symbol: string; filters: { filterType: string; tickSize?: string }[] }[] };
  for (const s of info.symbols ?? []) {
    const t = Number(s.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize);
    if (t > 0) tickCache.set(s.symbol, t);
  }
  const t = tickCache.get(symbol);
  if (!t) throw new MarketDataError(`${symbol} is not listed on Binance USD-M Futures`);
  return t;
}

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';
/** Live kline stream with capped exponential reconnect. Returns an unsubscribe function. */
export function subscribeKlines(symbol: string, interval: TimeframeId, onBar: (c: Candle, closed: boolean) => void, onStatus: (s: FeedStatus) => void): () => void {
  let ws: WebSocket | null = null; let stopped = false; let attempt = 0; let timer: ReturnType<typeof setTimeout> | null = null;
  const open = () => {
    onStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    ws = new WebSocket(`${BINANCE_WS}${symbol.toLowerCase()}@kline_${interval}`);
    ws.onmessage = (e) => {
      try {
        const k = (JSON.parse(String(e.data)) as { data?: { k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean } } }).data?.k;
        if (!k) return;
        const c = parseKline([k.t, k.o, k.h, k.l, k.c, k.v]);
        if (c) { attempt = 0; onStatus('live'); onBar(c, k.x); }
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      if (stopped) { onStatus('closed'); return; }
      attempt++; onStatus('reconnecting');
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    };
  };
  open();
  return () => { stopped = true; if (timer) clearTimeout(timer); ws?.close(); };
}
