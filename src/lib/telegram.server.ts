import { marketProcessingPaused, PAUSED_MARKET_MESSAGE } from './engine/market-policy';

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

async function signalDeliveryPaused() {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const health = await supabaseAdmin.from('engine_health').select('error').eq('id', 1).maybeSingle();
  return Boolean(health.error) || marketProcessingPaused(health.data);
}

export async function sendTelegram(text: string): Promise<{ ok: true; messageId: number } | { ok: false; error: string; uncertain?: boolean; retryAfter?: number }> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const tgKey = process.env["TELEGRAM_API_KEY"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!lovableKey || !tgKey) return { ok: false, error: "Telegram bot is not connected" };
  if (!chatId) return { ok: false, error: "TELEGRAM_CHAT_ID is not configured" };
  try {
    const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": tgKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`Telegram request failed [${res.status}]: ${body.slice(0, 500)}`);
      return { ok: false, error: `Telegram delivery rejected (${res.status})`, uncertain: res.status >= 500, retryAfter: Number(res.headers.get('retry-after') ?? 30) };
    }
    const json = JSON.parse(body) as { ok: boolean; result?: { message_id: number }; description?: string; parameters?: { retry_after?: number } };
    if (!json.ok || !json.result) return { ok: false, error: json.description ?? "Telegram rejected message" };
    return { ok: true, messageId: json.result.message_id };
  } catch (e) {
    console.error("Telegram response unavailable", e instanceof Error ? e.name : "Unknown error");
    return { ok: false, error: "Delivery outcome unknown. Check Telegram before retrying.", uncertain: true };
  }
}

/** Atomically claims a delivery. Never blindly retries an ambiguous network outcome. */
export async function deliverLog(logId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const existing = await supabaseAdmin.from('telegram_logs').select('is_test,delivery_status').eq('id', logId).maybeSingle();
  if (existing.error || !existing.data) return { ok: false, error: 'Could not read notification' };
  if (existing.data.delivery_status === 'SENT') return { ok: false, error: 'Already sent — retry blocked to prevent duplicates' };
  if (!existing.data.is_test && await signalDeliveryPaused()) return { ok: false, error: PAUSED_MARKET_MESSAGE };
  const claim = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.rpc("claim_telegram_delivery", { log_id: logId, claim_id: claim });
  if (error) return { ok: false, error: "Could not claim notification" };
  const log = data?.[0];
  if (!log) return { ok: false, error: "Already sent, claimed, waiting for retry, or delivery requires review" };
  const r = await sendTelegram(log.message);
  const saved = await supabaseAdmin
    .from("telegram_logs")
    .update(
      r.ok
        ? { delivery_status: "SENT", telegram_message_id: r.messageId, error_message: null, delivery_claim: null, claimed_at: null, next_retry_at: null, updated_at: new Date().toISOString() }
        : { delivery_status: "FAILED", error_message: r.error, delivery_claim: null, claimed_at: null, delivery_uncertain: r.uncertain ?? false,
          next_retry_at: new Date(Date.now() + Math.max(r.retryAfter ?? 30, Math.min(3600, 30 * 2 ** log.retry_count)) * 1000).toISOString(), updated_at: new Date().toISOString() },
    )
    .eq("id", logId).eq("delivery_claim", claim);
  return saved.error ? { ok: false, error: "Delivery outcome needs review: confirmation could not be stored" } : r;
}

export async function drainTelegram() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (await signalDeliveryPaused()) return;
  // A crashed sender might have delivered successfully. Flag, never auto-resend.
  await supabaseAdmin.from('telegram_logs').update({ delivery_status: 'FAILED', delivery_uncertain: true,
    error_message: 'Delivery interrupted; check Telegram before retrying.', delivery_claim: null, claimed_at: null })
    .in('delivery_status', ['PENDING', 'FAILED']).not('delivery_claim', 'is', null).lt('claimed_at', new Date(Date.now() - 120_000).toISOString());
  const { data } = await supabaseAdmin.from('telegram_logs').select('id').in('delivery_status', ['PENDING', 'FAILED'])
    .eq('delivery_uncertain', false).is('delivery_claim', null).lt('retry_count', 5)
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`).order('created_at').limit(3);
  for (const row of data ?? []) await deliverLog(row.id);
}
