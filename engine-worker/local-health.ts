import { timingSafeEqual } from 'node:crypto';

export function authorized(request: Request, secret: string) {
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return secret.length >= 32 && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function localHealthResponse(request: Request, secret: string, health: () => unknown) {
  if (!authorized(request, secret)) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if (new URL(request.url).pathname !== '/health') return new Response('Not found', { status: 404 });
  return Response.json(health(), { headers: { 'cache-control': 'no-store' } });
}