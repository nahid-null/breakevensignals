import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { engineHealth } from './engine/health';

export const getSystemHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const [engine, markets, lastSignal, positions, lastDelivery] = await Promise.all([
    db.from("engine_health").select("*").eq('id',1).maybeSingle(),
    db.from("market_state").select("symbol, status, last_candle_at, successful_scans"),
    db.from("signal_events").select("timestamp").order("timestamp", { ascending: false }).limit(1).maybeSingle(),
    db.from("active_positions").select("id", { count: 'exact', head: true }).in('status', ['ACTIVE', 'BREAKEVEN']),
    db.from('telegram_logs').select('updated_at').eq('delivery_status', 'SENT').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const databaseOk = !engine.error && !markets.error && !lastSignal.error && !positions.error && !lastDelivery.error;
  const candleTimes = (markets.data ?? []).flatMap((m) => m.last_candle_at ? [m.last_candle_at] : []).sort();
  return {
    databaseOk,
    engine: engine.data,
    ...engineHealth(engine.data, databaseOk),
    lastCandleAt: candleTimes.at(-1) ?? null,
    oldestSavedCandleAt: (markets.data ?? []).filter((m) => m.status !== 'UNAVAILABLE').length === engine.data?.available_symbols
      && (markets.data ?? []).filter((m) => m.status !== 'UNAVAILABLE').every((m) => m.last_candle_at)
      ? (markets.data ?? []).filter((m) => m.status !== 'UNAVAILABLE').flatMap((m) => m.last_candle_at ? [m.last_candle_at] : []).sort().at(0) ?? null : null,
    recoveredSymbols: (markets.data ?? []).filter((m) => m.status !== 'UNAVAILABLE' && m.successful_scans > 0).length,
    successfulScans: markets.error ? null : (markets.data ?? []).reduce((total, m) => total + m.successful_scans, 0),
    lastTelegramAt: lastDelivery.data?.updated_at ?? null,
    lastSignalAt: lastSignal.data?.timestamp ?? null,
    activePositions: positions.count ?? 0,
    engineConfigured: Boolean(process.env["ENGINE_SHARED_SECRET"]),
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
        long_notifications_enabled: z.boolean(),
        short_notifications_enabled: z.boolean(),
        long_entry_enabled: z.boolean(),
        short_entry_enabled: z.boolean(),
        long_stop_loss_enabled: z.boolean(),
        short_stop_loss_enabled: z.boolean(),
        long_take_profit_enabled: z.boolean(),
        short_take_profit_enabled: z.boolean(),
        display_timezone: z.string().min(1).max(64),
        default_fee_rate_percent: z.number().min(0).max(5),
      })
      .partial()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").update({ ...(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Record<string, never>), long_entry_enabled: false, short_entry_enabled: false, long_stop_loss_enabled: false, short_stop_loss_enabled: false, long_take_profit_enabled: false, short_take_profit_enabled: false, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
