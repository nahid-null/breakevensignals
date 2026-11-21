import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { commitSchema, heartbeatSchema, marketSchema, eventSource } from "@/lib/engine/protocol";
import type { Json } from "@/integrations/supabase/types";
import { robotCommitSchema } from "@/lib/robot/protocol";
import { robotFillMessages, robotOpenMessage } from "@/lib/robot/telegram-format";

export const Route = createFileRoute("/api/public/engine")({
  server: { handlers: { POST: async ({ request }) => {
    const { authenticateEngine } = await import("@/lib/engine/auth.server");
    const denied = await authenticateEngine(request);
    if (denied) return denied;
    if (Number(request.headers.get('content-length') ?? 0) > 150_000) return new Response('Too large', { status: 413 });
    let input: unknown;
    try { const text = await request.text(); if (text.length > 150_000) return new Response('Too large', { status: 413 }); input = JSON.parse(text); }
    catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    const base = z.object({ action: z.enum(["heartbeat", "state", "commit", "market", "deliveries", 'stop', 'market-state', 'robot-state', 'robot-commit', 'cstf-state', 'cstf-commit', 'cstf-status']), data: z.unknown() }).safeParse(input);
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
      if (base.data.action === 'market-state') {
        const { data, error } = await supabaseAdmin.from('market_state').select('*');
        if (error) throw error;
        return Response.json({ markets: data });
      }
      // prompt-74: CSTF 30m Simulator — one shared cross account, committed atomically under the worker lease.
      if (base.data.action === 'cstf-state') {
        const { data, error } = await supabaseAdmin.from('cstf_account').select('revision, state').eq('id', 1).single();
        if (error) throw error;
        return Response.json({ revision: Number(data.revision), state: data.state });
      }
      if (base.data.action === 'cstf-commit') {
        const { cstfCommitSchema } = await import('@/lib/engine/cstf-live');
        const data = cstfCommitSchema.parse(base.data.data);
        const { data: result, error } = await supabaseAdmin.rpc('cstf_commit', { p: data as unknown as Json });
        if (error) throw error;
        return Response.json(result);
      }
      if (base.data.action === 'cstf-status') {
        const data = z.object({ instance_id: z.string().uuid(), status: z.enum(['WAITING', 'ERROR']), error: z.string().max(400).nullable() }).parse(base.data.data);
        const { data: ok, error } = await supabaseAdmin.rpc('cstf_report_status', { p: data as unknown as Json });
        if (error) throw error;
        return Response.json({ ok });
      }
      if (base.data.action === "commit") {
        const data = commitSchema.parse(base.data.data);
        // Telegram now carries only Simulator trade results; signal events never queue a message.
        const events = data.events.map((e) => ({ ...e,
          source: e.adopted ? 'historical' : eventSource(data.mode), telegram_message: '' }));
        // prompt-74: OB STRONG / OB + VP no longer open Simulator trades (legacy open trades still settle via spot_candle).
        const { data: result, error } = await supabaseAdmin.rpc("commit_engine_candle", { p: { ...data, events, simulator_entries: [] } as Json });
        if (error) throw error;
        return Response.json(result);
      }
      if (base.data.action === 'robot-state') {
        const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
        const [settings, account, open, closed] = await Promise.all([
          supabaseAdmin.from('robot_settings').select('*').eq('id', 1).single(),
          supabaseAdmin.from('robot_account').select('*').eq('id', 1).single(),
          supabaseAdmin.from('robot_positions').select('*').eq('status', 'OPEN'),
          supabaseAdmin.from('robot_positions').select('realized_pnl, closed_at').eq('status', 'CLOSED').gte('closed_at', since).order('closed_at', { ascending: false }).limit(200),
        ]);
        for (const r of [settings, account, open, closed]) if (r.error) throw r.error;
        return Response.json({ settings: settings.data, account: account.data, open: open.data, closed: closed.data });
      }
      if (base.data.action === 'robot-commit') {
        const data = robotCommitSchema.parse(base.data.data);
        const p = {
          instance_id: data.instance_id, markets: data.markets, signals: data.signals, ...(data.scanner ? { scanner: data.scanner } : {}),
          ...(data.runtime ? {runtime:data.runtime} : {}), decisions:data.decisions,
          opens: data.opens.map((o) => ({ ...o, message: robotOpenMessage(o) })),
          // Recovery fills after a restart are applied but never announced as live events.
          updates: data.updates.map(({ fills, notify, ...u }) => ({ ...u, messages: notify ? robotFillMessages({ ...u, fills, notify }) : [] })),
        };
        const { data: result, error } = await supabaseAdmin.rpc('robot_commit_verified', { p: p as unknown as Json });
        if (error) throw error;
        return Response.json(result);
      }
      const instance = z.object({ instance_id: z.string().uuid() }).parse(base.data.data);
      if (base.data.action === 'stop') {
        const result = await supabaseAdmin.rpc('stop_engine', { p_instance: instance.instance_id });
        if (result.error) throw result.error;
        return Response.json({ stopped: result.data });
      }
      const lease = await supabaseAdmin.from('engine_control').select('instance_id').eq('id', 1)
        .eq('instance_id', instance.instance_id).gt('lease_until', new Date().toISOString()).maybeSingle();
      if (!lease.data) return Response.json({ error: "Engine lease expired" }, { status: 409 });
      if (base.data.action === "market") {
        const data = z.object({ market: marketSchema }).parse(base.data.data);
        const update = { price: data.market.price, updated_at: new Date().toISOString() };
        const { error } = data.market.status === 'UNAVAILABLE'
          ? await supabaseAdmin.from('market_state').upsert({ ...data.market, mtf_trend: data.market.mtf_trend ?? null, ...update })
          : await supabaseAdmin.from('market_state').update(update).eq('symbol', data.market.symbol);
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