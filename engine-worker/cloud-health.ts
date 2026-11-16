import { localHealthResponse } from './local-health';

export const KEEP_AWAKE_INTERVAL_MS = 10 * 60_000;

/** Public liveness only reveals that the process is up; detailed state still needs the private key. */
export function cloudHealthResponse(request: Request, secret: string, health: () => unknown) {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && (path === '/healthz' || path === '/')) return new Response('ok', { headers: { 'cache-control': 'no-store' } });
  return localHealthResponse(request, secret, health);
}

/** Free web hosts sleep without inbound traffic, so the worker requests its own public address. */
export function keepAwakeUrl(externalUrl: string | undefined) {
  if (!externalUrl || !externalUrl.startsWith('https://')) return null;
  return `${externalUrl.replace(/\/$/, '')}/healthz`;
}
