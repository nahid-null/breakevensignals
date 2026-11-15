import { MINUTE, validateCandle, type Candle } from "../src/lib/engine/model";

export const BINANCE_REST = "https://fapi.binance.com";
export const BINANCE_WS = "wss://fstream.binance.com/stream?streams=";
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function binanceFetch(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try { response = await fetch(`${BINANCE_REST}${path}`, { signal: AbortSignal.timeout(20_000) }); }
    catch (e) { if (attempt === 3) throw e; await delay(1000 * 2 ** attempt); continue; }
    if (response.ok) return response.json();
    if (response.status === 429 || response.status >= 500) {
      const seconds = Number(response.headers.get('retry-after') ?? 2 ** attempt);
      await delay(Math.max(1, seconds) * 1000);
      continue;
    }
    // 418 (IP ban), 451 (regional restriction), and other 4xx are not bypassed.
    throw new Error(`Binance Futures rejected market request (${response.status})`);
  }
  throw new Error("Binance rate limit or service outage; retry budget exhausted");
}

export function restCandle(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 7) throw new Error("Malformed Binance candle");
  const c = { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
    close: Number(row[4]), volume: Number(row[5]) };
  validateCandle(c);
  return c;
}

export async function history(symbol: string, start?: number, end?: number): Promise<Candle[]> {
  const params = new URLSearchParams({ symbol, interval: '1m', limit: '1500' });
  if (start !== undefined) params.set('startTime', String(start));
  if (end !== undefined) params.set('endTime', String(end));
  const rows = await binanceFetch(`/fapi/v1/klines?${params}`);
  if (!Array.isArray(rows)) throw new Error("Malformed Binance history");
  const now = end ?? Date.now();
  return rows.map(restCandle).filter((c) => c.time + MINUTE <= now).sort((a, b) => a.time - b.time);
}

export function backoff(attempt: number, random = Math.random()): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) + Math.round(random * 1000);
}