// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelegram, deliverLog } from '@/lib/telegram.server';

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: db }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function configure() {
  // Local transport fixture values, never real credentials.
  vi.stubEnv('LOVABLE_API_KEY', 'fixture'); vi.stubEnv('TELEGRAM_API_KEY', 'fixture'); vi.stubEnv('TELEGRAM_CHAT_ID', 'fixture');
}
describe('Telegram delivery safety (simulated transport)', () => {
  it('does not send when the atomic claim was already consumed', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    db.rpc.mockResolvedValue({ data: [], error: null });
    expect((await deliverLog('11111111-1111-4111-8111-111111111111')).ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
  it('records a successful response with its message identity under the matching claim', async () => {
    configure();
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
});