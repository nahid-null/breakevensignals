// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { binanceFetch, BinanceRequestError } from '../../engine-worker/binance';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('public Binance request failure classification', () => {
  it('identifies 451, retains its public reason and does not retry', async () => {
    const fetch = vi.fn(async () => Response.json({ msg: "Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms." }, { status: 451 }));
    vi.stubGlobal('fetch', fetch);
    const error = await binanceFetch('/fapi/v1/exchangeInfo?token=do-not-retain').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BinanceRequestError);
    if (!(error instanceof BinanceRequestError)) throw new Error('Wrong failure type');
    expect(error).toMatchObject({ kind: 'restricted', status: 451, endpoint: '/fapi/v1/exchangeInfo', pausesMarket: true });
    expect(error.message).toContain('BINANCE_ACCESS_RESTRICTED: HTTP 451');
    expect(error.message).toContain('restricted location');
    expect(error.message).not.toContain('do-not-retain');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('distinguishes an IP ban and never routes around or retries 418', async () => {
    const fetch = vi.fn(async () => new Response('blocked', { status: 418 }));
    vi.stubGlobal('fetch', fetch);
    await expect(binanceFetch('/fapi/v1/time')).rejects.toMatchObject({ kind: 'banned', status: 418, pausesMarket: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not echo HTML, query parameters or credential-shaped provider text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ msg: 'token=private-value\nBearer other-private https://example.com/?secret=private-value' }, { status: 451 })));
    const error = await binanceFetch('/fapi/v1/time').catch((e: unknown) => e);
    if (!(error instanceof BinanceRequestError)) throw new Error('Wrong failure type');
    expect(error.message).not.toContain('private-value');
    expect(error.message).not.toContain('other-private');
    expect(error.message).not.toContain('\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>private page content</html>', { status: 451 })));
    await expect(binanceFetch('/fapi/v1/time')).rejects.toThrow('Confirm permitted access');
  });
  it('honors Retry-After for 429 and succeeds without changing the endpoint', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(Response.json({ serverTime: 123 }));
    vi.stubGlobal('fetch', fetch);
    const result = binanceFetch('/fapi/v1/time');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ serverTime: 123 });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://fapi.binance.com/fapi/v1/time', 'https://fapi.binance.com/fapi/v1/time']);
  });
  it.each([['provider', 503], ['network', null]] as const)('bounds %s failures to four attempts', async (kind, status) => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { if (status === null) throw new Error('network details'); return new Response('{}', { status }); });
    vi.stubGlobal('fetch', fetch);
    const outcome = binanceFetch('/fapi/v1/time').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await outcome).toMatchObject({ kind, status, pausesMarket: false });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});