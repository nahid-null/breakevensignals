import { MINUTE, validateCandle, type Candle } from "../src/lib/engine/model";
import { BINANCE_ACCESS_RESTRICTED, BINANCE_IP_BANNED } from '../src/lib/engine/market-access';

export const BINANCE_REST = "https://fapi.binance.com";
export const BINANCE_WS = "wss://fstream.binance.com/market/stream?streams=";
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type FailureKind = 'restricted' | 'banned' | 'rate_limit' | 'network' | 'provider' | 'request';
const errorCode: Record<FailureKind, string> = {
  restricted: BINANCE_ACCESS_RESTRICTED, banned: BINANCE_IP_BANNED,
  rate_limit: 'BINANCE_RATE_LIMITED', network: 'BINANCE_NETWORK_ERROR',
  provider: 'BINANCE_PROVIDER_ERROR', request: 'BINANCE_REQUEST_REJECTED',
};

export class BinanceRequestError extends Error {
  readonly checkedAt = new Date().toISOString();
  readonly endpoint: string;
  constructor(readonly kind: FailureKind, readonly status: number | null, path: string, explanation: string) {
    const endpoint = new URL(path, BINANCE_REST).pathname;
    super(`${errorCode[kind]}: ${status === null ? 'Network failure' : `HTTP ${status}`} ${endpoint} — ${explanation}`);
    this.name = 'BinanceRequestError';
    this.endpoint = endpoint;
  }
  get pausesMarket() { return this.kind === 'restricted' || this.kind === 'banned'; }
}

/** Only a short JSON message from the public, unauthenticated provider request is retained. */
function providerExplanation(text: string, fallback: string) {
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || !('msg' in body) || typeof body.msg !== 'string') return fallback;
    return body.msg.replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/https?:\/\/\S+/gi, '[provider link]')
      .replace(/(?:Bearer\s+\S+|sb_(?:secret|publishable)_\S+|(?:api[_-]?key|secret|token|authorization)\s*[=:]\s*\S+)/gi, '[redacted]')
      .replace(/\s+/g, ' ').trim().slice(0, 240) || fallback;
  } catch { return fallback; }
}

export async function binanceFetch(path: string, signal?: AbortSignal): Promise<unknown> {
  let lastFailure: BinanceRequestError | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    signal?.throwIfAborted();
    let response: Response;
    try { response = await fetch(`${BINANCE_REST}${path}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) }); }
    catch {
      signal?.throwIfAborted();
      lastFailure = new BinanceRequestError('network', null, path, 'Market-data request timed out or could not connect.');
      if (attempt === 3) throw lastFailure;
      await delay(1000 * 2 ** attempt); continue;
    }
    if (response.ok) return response.json();
    const kind: FailureKind = response.status === 451 ? 'restricted' : response.status === 418 ? 'banned'
      : response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'provider' : 'request';
    const fallback = kind === 'restricted' ? 'Binance rejected this source location. Confirm permitted access with Binance before restarting.'
      : kind === 'banned' ? 'Binance banned this source IP. Resolve the ban before restarting.' : 'Binance rejected the public market-data request.';
    const explanation = providerExplanation(await response.text().catch(() => ''), fallback);
    lastFailure = new BinanceRequestError(kind, response.status, path, explanation);
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 3) throw lastFailure;
      const retryAfter = Number(response.headers.get('retry-after'));
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
      await delay(Math.max(1, seconds) * 1000);
      continue;
    }
    // 418 (IP ban), 451 (regional restriction), and other 4xx are not bypassed.
    throw lastFailure;
  }
  throw lastFailure ?? new BinanceRequestError('provider', null, path, 'Market-data retry budget exhausted.');
}

export function restCandle(row: unknown, span = MINUTE): Candle {
  if (!Array.isArray(row) || row.length < 7) throw new Error("Malformed Binance candle");
  const c = { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
    close: Number(row[4]), volume: Number(row[5]) };
  validateCandle(c);
  if (c.time % span !== 0) throw new Error('Malformed Binance candle interval');
  return c;
}

export async function history(symbol: string, start?: number, end?: number, signal?: AbortSignal, interval: '1m' | '5m' | '15m' = '1m'): Promise<Candle[]> {
  const params = new URLSearchParams({ symbol, interval, limit: '1500' });
  if (start !== undefined) params.set('startTime', String(start));
  if (end !== undefined) params.set('endTime', String(end));
  const rows = await binanceFetch(`/fapi/v1/klines?${params}`, signal);
  if (!Array.isArray(rows)) throw new Error("Malformed Binance history");
  const now = end ?? Date.now();
  const span = interval === '15m' ? 15 * MINUTE : interval === '5m' ? 5 * MINUTE : MINUTE;
  return rows.map((row) => restCandle(row, span)).filter((c) => c.time + span <= now).sort((a, b) => a.time - b.time);
}

export async function checkWebSocketAccess(streams: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${BINANCE_WS.replace('wss:', 'https:')}${streams}`, {
    headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
      'sec-websocket-key': btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))) },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 451 || response.status === 418) throw new BinanceRequestError(
    response.status === 451 ? 'restricted' : 'banned', response.status, '/market/stream',
    'Binance rejected the candle connection. Resolve permitted access before restarting.');
  if (response.status !== 101) throw new BinanceRequestError(response.status >= 500 ? 'provider' : 'request',
    response.status, '/market/stream', 'Binance did not accept the candle connection.');
}

export function backoff(attempt: number, random = Math.random()): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) + Math.round(random * 1000);
}