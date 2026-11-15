import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getSystemHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [last, failed, lastOk] = await Promise.all([
    supabaseAdmin.from("webhook_receipts").select("received_at, accepted").order("received_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("webhook_receipts").select("id", { count: "exact", head: true }).eq("accepted", false),
    supabaseAdmin.from("webhook_receipts").select("received_at").eq("accepted", true).order("received_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    databaseOk: !last.error,
    lastWebhookAt: last.data?.received_at ?? null,
    lastProcessedAt: lastOk.data?.received_at ?? null,
    failedWebhooks: failed.count ?? 0,
    webhookConfigured: Boolean(process.env["WEBHOOK_SECRET"]),
    botConfigured: Boolean(process.env["TELEGRAM_API_KEY"] && process.env["LOVABLE_API_KEY"]),
    chatConfigured: Boolean(process.env["TELEGRAM_CHAT_ID"]),
  };
});

export const sendTestTelegram = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();
  const message = `🧪 TEST NOTIFICATION — NOT A TRADING SIGNAL\n━━━━━━━━━━━━━━━━\nCrypto Signal Terminal can reach this chat.\n🕒 ${now.replace("T", " ").slice(0, 19)} UTC`;
  const { data: log, error } = await supabaseAdmin
    .from("telegram_logs")
    .insert({ event_id: `test-${crypto.randomUUID()}`, is_test: true, message })
    .select("id")
    .single();
  if (error || !log) return { ok: false, error: error?.message ?? "Could not create log" };
  const { deliverLog } = await import("@/lib/telegram.server");
  return deliverLog(log.id);
});

export const retryTelegram = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: log } = await supabaseAdmin.from("telegram_logs").select("delivery_status, retry_count").eq("id", data.id).single();
    if (!log) return { ok: false, error: "Not found" };
    if (log.delivery_status === "SENT") return { ok: false, error: "Already sent — retry blocked to prevent duplicates" };
    await supabaseAdmin.from("telegram_logs").update({ retry_count: log.retry_count + 1 }).eq("id", data.id);
    const { deliverLog } = await import("@/lib/telegram.server");
    return deliverLog(data.id);
  });

export const updateSettings = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        telegram_enabled: z.boolean(),
        long_breakeven_enabled: z.boolean(),
        short_breakeven_enabled: z.boolean(),
        display_timezone: z.string().min(1).max(64),
        default_fee_rate_percent: z.number().min(0).max(5),
      })
      .partial()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").update({ ...data, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
