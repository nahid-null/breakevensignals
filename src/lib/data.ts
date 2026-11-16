import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { getSystemHealth } from "./ops.functions";
import type { TerminalStats } from './engine/stats';
import { engineHealth } from './engine/health';

export type Position = Database["public"]["Tables"]["active_positions"]["Row"];
export type SignalEvent = Database["public"]["Tables"]["signal_events"]["Row"];
export type TelegramLog = Database["public"]["Tables"]["telegram_logs"]["Row"];
export type Settings = Database["public"]["Tables"]["app_settings"]["Row"];
export type MarketState = Database["public"]["Tables"]["market_state"]["Row"];

const TABLES = ["active_positions", "signal_events", "telegram_logs", "app_settings", "market_state", "engine_health"] as const;

/** Subscribe once (in the shell) and refresh every query when backend data changes. */
export function useRealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel(`terminal-${Math.random().toString(36).slice(2)}`);
    for (const table of TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
         void qc.invalidateQueries({ queryKey: [table] });
         if (table !== 'market_state') void qc.invalidateQueries({ queryKey: ["health"] });
         if (table !== 'market_state' && table !== 'engine_health') void qc.invalidateQueries({ queryKey: ['terminal_statistics'] });
      });
    }
    channel.subscribe();
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      for (const table of TABLES) void qc.invalidateQueries({ queryKey: [table] });
      void qc.invalidateQueries({ queryKey: ['health'] });
      void qc.invalidateQueries({ queryKey: ['terminal_statistics'] });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
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
    refetchInterval: 15000,
  });

export const useSettings = () =>
  useQuery({
    queryKey: ["app_settings"],
    queryFn: () => must<Settings>(supabase.from("app_settings").select("*").eq("id", 1).single()),
  });

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => getSystemHealth(), refetchInterval: 15000 });

export const useMarkets = () => useQuery({ queryKey: ['market_state'], queryFn: () =>
  must<MarketState[]>(supabase.from('market_state').select('*')), refetchInterval: 15000 });

export const useStats = () => useQuery({ queryKey: ['terminal_statistics'], queryFn: async () => {
  const { data, error } = await supabase.rpc('terminal_statistics');
  if (error) throw error;
  return data as unknown as TerminalStats;
}, refetchInterval: 15000 });

export type Status = "ONLINE" | "OFFLINE" | "CONNECTED" | "DISCONNECTED" | "ACCESS RESTRICTED" | "IP BANNED" | "NOT CONFIGURED" | "ERROR" | "WAITING" | "MANUAL VERIFICATION REQUIRED";

export function useStatuses() {
  const health = useHealth();
  const logs = useTelegramLogs();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Expire cached status even if the next read fails or is still pending.
  const h = health.data && now !== null ? { ...health.data, ...engineHealth(health.data.engine, health.data.databaseOk && !health.isError, now) } : health.data;
  const lastTg = logs.data?.find((l) => l.delivery_status !== "PENDING");
  const system: Status = health.isError ? "OFFLINE" : !h ? "WAITING" : h.databaseOk && h.scanner === 'RUNNING' ? "ONLINE" : "OFFLINE";
  const binance: Status = health.isError ? 'DISCONNECTED' : !h ? 'WAITING' : h.binance === 'ACCESS RESTRICTED' ? 'ACCESS RESTRICTED' : h.binance === 'IP BANNED' ? 'IP BANNED' : h.binance === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED';
  const websocket: Status = health.isError ? 'DISCONNECTED' : !h ? 'WAITING' : h.websocket === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED';
  const telegram: Status = health.isError || logs.isError ? 'ERROR' : !h ? "WAITING" : !h.botConfigured || !h.chatConfigured ? "NOT CONFIGURED" : !lastTg ? "WAITING" : lastTg.delivery_status === "SENT" ? "CONNECTED" : "ERROR";
  return { system, cloud: health.isError ? 'OFFLINE' : h?.cloud ?? 'OFFLINE', scanner: health.isError ? 'STOPPED' : h?.scanner ?? 'STOPPED', binance, websocket, telegram, health: h, healthQuery: health };
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
