import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { commitSchema, heartbeatSchema, marketSchema } from "@/lib/engine/protocol";
import { formatSignalMessage } from "@/lib/telegram-format";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/public/engine")({
  server: { handlers: { POST: async ({ request }) => {
    const { authenticateEngine } = await import("@/lib/engine/auth.server");
    const denied = await authenticateEngine(request);
    if (denied) return denied;
    if (Number(request.headers.get('content-length') ?? 0) > 150_000) return new Response('Too large', { status: 413 });
    let input: unknown;
    try { const text = await request.text(); if (text.length > 150_000) return new Response('Too large', { status: 413 }); input = JSON.parse(text); }
    catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    const base = z.object({ action: z.enum(["heartbeat", "state", "commit", "market", "deliveries"]), data: z.unknown() }).safeParse(input);
    if (!base.success) return Response.json({ error: "Invalid request" }, { status: 422 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      if (base.data.action === "heartbeat") {
        const data = heartbeatSchema.parse(base.data.data);
        const result = await supabaseAdmin.rpc("engine_heartbeat", { p: data });
        if (result.error) throw result.error;
        return Response.json({ acquired: result.data });
      }
      if (base.data.action === "state") {
        const { data, error } = await supabaseAdmin.from("engine_checkpoints").select("symbol, revision, state");
        if (error) throw error;
        return Response.json({ checkpoints: data });
      }
      if (base.data.action === "commit") {
        const data = commitSchema.parse(base.data.data);
        const events = data.events.map((e) => ({ ...e,
          source: data.mode === 'live' ? 'native' : data.mode === 'warmup' ? 'historical' : 'recovery',
          telegram_message: data.mode === 'live' ? formatSignalMessage({ ...e, fee_rate_percent: e.fee_rate_percent ?? null }) : '' }));
        const { data: result, error } = await supabaseAdmin.rpc("commit_engine_candle", { p: { ...data, events } as Json });
        if (error) throw error;
        return Response.json(result);
      }
      const instance = z.object({ instance_id: z.string().uuid() }).parse(base.data.data);
      const lease = await supabaseAdmin.from('engine_control').select('instance_id').eq('id', 1)
        .eq('instance_id', instance.instance_id).gt('lease_until', new Date().toISOString()).maybeSingle();
      if (!lease.data) return Response.json({ error: "Engine lease expired" }, { status: 409 });
      if (base.data.action === "market") {
        const data = z.object({ market: marketSchema }).parse(base.data.data);
        const { error } = await supabaseAdmin.from('market_state').upsert({ ...data.market, updated_at: new Date().toISOString() });
        if (error) throw error;
      } else {
        const { drainTelegram } = await import('@/lib/telegram.server');
        await drainTelegram();
      }
      return Response.json({ ok: true });
    } catch (e) {
      if (e instanceof z.ZodError) return Response.json({ error: "Invalid engine data" }, { status: 422 });
      console.error("Engine processing failed", e);
      return Response.json({ error: "Engine processing failed; checkpoint not accepted" }, { status: 500 });
    }
  } } },
});