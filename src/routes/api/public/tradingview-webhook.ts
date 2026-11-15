import { createFileRoute } from "@tanstack/react-router";
import { webhookSchema } from "@/lib/webhook-schema";
import { formatBreakevenMessage } from "@/lib/telegram-format";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const Route = createFileRoute("/api/public/tradingview-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["WEBHOOK_SECRET"];
        if (!secret) return new Response("Webhook not configured", { status: 503 });
        const token = new URL(request.url).searchParams.get("token") ?? "";
        if (!safeEqual(token, secret)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const text = await request.text();
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          await supabaseAdmin.from("webhook_receipts").insert({ accepted: false, reason: "Invalid JSON", raw_payload: { text: text.slice(0, 2000) } });
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = webhookSchema.safeParse(raw);
        if (!parsed.success) {
          const reason = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          await supabaseAdmin.from("webhook_receipts").insert({ accepted: false, reason, raw_payload: raw as never });
          return Response.json({ error: reason }, { status: 422 });
        }
        const p = parsed.data;
        const tgMessage = p.event === "breakeven_activated"
          ? formatBreakevenMessage({ ...p, fee_rate_percent: p.fee_rate_percent ?? null })
          : "";
        const { data: result, error } = await supabaseAdmin.rpc("process_signal_event", { p: p as never, tg_message: tgMessage });
        await supabaseAdmin.from("webhook_receipts").insert({
          event_id: p.event_id,
          accepted: !error,
          reason: error ? error.message : null,
          raw_payload: raw as never,
        });
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const r = result as { duplicate: boolean; status?: string; telegram_log_id?: string | null };
        if (r.telegram_log_id) {
          const { deliverLog } = await import("@/lib/telegram.server");
          await deliverLog(r.telegram_log_id);
        }
        return Response.json({ ok: true, ...r });
      },
    },
  },
});
