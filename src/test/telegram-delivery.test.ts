// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelegram, deliverLog, drainTelegram } from '@/lib/telegram.server';

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: db }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function configure() {
  // Local transport fixture values, never real credentials.
  vi.stubEnv('LOVABLE_API_KEY', 'fixture'); vi.stubEnv('TELEGRAM_API_KEY', 'fixture'); vi.stubEnv('TELEGRAM_CHAT_ID', 'fixture');
}
function reads(isTest = false, status = 'PENDING', healthError: string | null = null, unavailable = false) {
  const read = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  read.select.mockReturnValue(read); read.eq.mockReturnValue(read);
  read.maybeSingle.mockResolvedValueOnce({ data: { is_test: isTest, delivery_status: status }, error: null })
    .mockResolvedValueOnce({ data: { error: healthError }, error: unavailable ? { message: 'offline' } : null });
  db.from.mockReturnValueOnce(read);
  if (!isTest && status !== 'SENT') db.from.mockReturnValueOnce(read);
}
describe('Telegram delivery safety (simulated transport)', () => {
  it('does not send when the atomic claim was already consumed', async () => {
    reads();
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    db.rpc.mockResolvedValue({ data: [], error: null });
    expect((await deliverLog('11111111-1111-4111-8111-111111111111')).ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
  it('records a successful response with its message identity under the matching claim', async () => {
    configure();
    reads();
    db.rpc.mockResolvedValue({ data: [{ message: 'fixture notification', retry_count: 1 }], error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 321 } }))));
    const saved = vi.fn();
    const query = { update: saved, eq: vi.fn() }; saved.mockReturnValue(query);
    query.eq.mockReturnValueOnce(query).mockResolvedValueOnce({ error: null }); db.from.mockReturnValue(query);
    expect(await deliverLog('11111111-1111-4111-8111-111111111111')).toEqual({ ok: true, messageId: 321 });
    expect(saved.mock.calls[0]?.[0]).toMatchObject({ delivery_status: 'SENT', telegram_message_id: 321, delivery_claim: null });
    expect(query.eq.mock.calls[1]?.[0]).toBe('delivery_claim');
  });
  it('flags an ambiguous interrupted response rather than blindly resending', async () => {
    configure(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture lost response')));
    expect(await sendTelegram('fixture')).toMatchObject({ ok: false, uncertain: true });
  });
  it('preserves retry delay on a confirmed rate-limit rejection', async () => {
    configure(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '45' } })));
    expect(await sendTelegram('fixture')).toMatchObject({ ok: false, uncertain: false, retryAfter: 45 });
  });
  it.each(['BINANCE_ACCESS_RESTRICTED: HTTP 451', 'BINANCE_IP_BANNED: HTTP 418'])('blocks manual signal delivery for %s without changing its log', async (error) => {
    reads(false, 'FAILED', error);
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    expect((await deliverLog('11111111-1111-4111-8111-111111111111')).ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('fails closed for signal delivery if health cannot be read', async () => {
    reads(false, 'FAILED', null, true);
    expect((await deliverLog('11111111-1111-4111-8111-111111111111')).ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('leaves SENT logs unchanged before any claim or transport', async () => {
    reads(false, 'SENT');
    expect((await deliverLog('11111111-1111-4111-8111-111111111111')).ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('allows a separately labelled test notification despite blocked market access', async () => {
    reads(true); configure();
    db.rpc.mockResolvedValue({ data: [{ is_test: true, message: 'TEST NOT A SIGNAL', retry_count: 1 }], error: null });
    const query = { update: vi.fn(), eq: vi.fn() }; query.update.mockReturnValue(query);
    query.eq.mockReturnValueOnce(query).mockResolvedValueOnce({ error: null }); db.from.mockReturnValue(query);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { message_id: 123 } })));
    expect(await deliverLog('11111111-1111-4111-8111-111111111111')).toEqual({ ok: true, messageId: 123 });
  });
  it('halts background delivery before claim cleanup while access is blocked', async () => {
    const read = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    read.select.mockReturnValue(read); read.eq.mockReturnValue(read);
    read.maybeSingle.mockResolvedValue({ data: { error: 'BINANCE_ACCESS_RESTRICTED: HTTP 451' }, error: null });
    db.from.mockReturnValue(read);
    await drainTelegram(); expect(db.from).toHaveBeenCalledTimes(1); expect(db.rpc).not.toHaveBeenCalled();
  });
});