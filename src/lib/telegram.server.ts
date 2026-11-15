const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export async function sendTelegram(text: string): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
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
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `Telegram [${res.status}]: ${body.slice(0, 500)}` };
    const json = JSON.parse(body) as { ok: boolean; result?: { message_id: number }; description?: string };
    if (!json.ok || !json.result) return { ok: false, error: json.description ?? "Telegram rejected message" };
    return { ok: true, messageId: json.result.message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Sends a pending/failed log row. Never re-sends a row already SENT. */
export async function deliverLog(logId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: log } = await supabaseAdmin.from("telegram_logs").select("*").eq("id", logId).single();
  if (!log) return { ok: false, error: "Log not found" };
  if (log.delivery_status === "SENT") return { ok: true, alreadySent: true };
  const r = await sendTelegram(log.message);
  await supabaseAdmin
    .from("telegram_logs")
    .update(
      r.ok
        ? { delivery_status: "SENT", telegram_message_id: r.messageId, error_message: null, updated_at: new Date().toISOString() }
        : { delivery_status: "FAILED", error_message: r.error, updated_at: new Date().toISOString() },
    )
    .eq("id", logId);
  return r;
}
