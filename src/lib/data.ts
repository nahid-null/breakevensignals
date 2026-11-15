import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { getSystemHealth } from "./ops.functions";

export type Position = Database["public"]["Tables"]["active_positions"]["Row"];
export type SignalEvent = Database["public"]["Tables"]["signal_events"]["Row"];
export type TelegramLog = Database["public"]["Tables"]["telegram_logs"]["Row"];
export type Settings = Database["public"]["Tables"]["app_settings"]["Row"];

const TABLES = ["active_positions", "signal_events", "telegram_logs", "app_settings"] as const;

/** Subscribe once (in the shell) and refresh every query when backend data changes. */
export function useRealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel(`terminal-${Math.random().toString(36).slice(2)}`);
    for (const table of TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        void qc.invalidateQueries({ queryKey: [table] });
        void qc.invalidateQueries({ queryKey: ["health"] });
      });
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const usePositions = () =>
  useQuery({
    queryKey: ["active_positions"],
    queryFn: () => must<Position[]>(supabase.from("active_positions").select("*").order("entry_timestamp", { ascending: false }).limit(1000)),
  });

export const useEvents = () =>
  useQuery({
    queryKey: ["signal_events"],
    queryFn: () => must<SignalEvent[]>(supabase.from("signal_events").select("*").order("timestamp", { ascending: false }).limit(1000)),
  });

export const useTelegramLogs = () =>
  useQuery({
    queryKey: ["telegram_logs"],
    queryFn: () => must<TelegramLog[]>(supabase.from("telegram_logs").select("*").order("created_at", { ascending: false }).limit(500)),
  });

export const useSettings = () =>
  useQuery({
    queryKey: ["app_settings"],
    queryFn: () => must<Settings>(supabase.from("app_settings").select("*").eq("id", 1).single()),
  });

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => getSystemHealth(), refetchInterval: 30000 });

export type Status = "ONLINE" | "OFFLINE" | "CONNECTED" | "NOT CONFIGURED" | "ERROR" | "WAITING" | "MANUAL VERIFICATION REQUIRED";

export function useStatuses() {
  const health = useHealth();
  const logs = useTelegramLogs();
  const h = health.data;
  const lastTg = logs.data?.find((l) => l.delivery_status !== "PENDING");
  const system: Status = health.isError ? "OFFLINE" : !h ? "WAITING" : h.databaseOk && h.webhookConfigured ? "ONLINE" : "OFFLINE";
  const webhook: Status = !h ? "WAITING" : !h.webhookConfigured ? "NOT CONFIGURED" : h.lastWebhookAt ? "CONNECTED" : "WAITING";
  const telegram: Status = !h ? "WAITING" : !h.botConfigured || !h.chatConfigured ? "NOT CONFIGURED" : !lastTg ? "WAITING" : lastTg.delivery_status === "SENT" ? "CONNECTED" : "ERROR";
  return { system, webhook, telegram, tradingview: "MANUAL VERIFICATION REQUIRED" as Status, health: h, healthQuery: health };
}

/** Latest position per symbol+direction. */
export function latestBySymbol(positions: Position[] | undefined) {
  const map = new Map<string, Position>();
  for (const p of positions ?? []) {
    const k = `${p.symbol}:${p.direction}`;
    const cur = map.get(k);
    if (!cur || new Date(p.entry_timestamp) > new Date(cur.entry_timestamp)) map.set(k, p);
  }
  return map;
}

export function fmtPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return Number(n).toString();
}

export function fmtTime(iso: string | null | undefined, tz = "UTC") {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}
