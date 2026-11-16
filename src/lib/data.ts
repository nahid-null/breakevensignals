import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as D from "./dashboard.functions";
import type { Database } from "@/integrations/supabase/types";
import { getSystemHealth } from "./ops.functions";
import type { TerminalStats } from './engine/stats';
import { engineHealth } from './engine/health';

export type Position = Database["public"]["Tables"]["active_positions"]["Row"];
export type SignalEvent = Database["public"]["Tables"]["signal_events"]["Row"];
export type TelegramLog = Database["public"]["Tables"]["telegram_logs"]["Row"];
export type Settings = Database["public"]["Tables"]["app_settings"]["Row"];
export type MarketState = Database["public"]["Tables"]["market_state"]["Row"];

const KEYS = ["active_positions", "signal_events", "telegram_logs", "app_settings", "market_state", "health", "terminal_statistics",
  "robot_positions", "robot_signals", "robot_account", "robot_settings", "sim_account", "sim_trades"] as const;

/** Refresh every dashboard query when the tab becomes visible again or the connection returns (queries also poll). */
export function useRealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      for (const key of KEYS) void qc.invalidateQueries({ queryKey: [key] });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [qc]);
}

export const usePositions = () =>
  useQuery({
    queryKey: ["active_positions"],
    queryFn: () => D.readPositions() as Promise<Position[]>,
    refetchInterval: 10000,
  });

export const useEvents = () =>
  useQuery({
    queryKey: ["signal_events"],
    queryFn: () => D.readEvents() as Promise<SignalEvent[]>,
    refetchInterval: 10000,
  });

export const useTelegramLogs = () =>
  useQuery({
    queryKey: ["telegram_logs"],
    queryFn: () => D.readTelegramLogs() as Promise<TelegramLog[]>,
    refetchInterval: 15000,
  });

export const useSettings = () =>
  useQuery({
    queryKey: ["app_settings"],
    queryFn: () => D.readSettings() as Promise<Settings>,
    refetchInterval: 30000,
  });

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => getSystemHealth(), refetchInterval: 15000 });

export const useMarkets = () => useQuery({ queryKey: ['market_state'], queryFn: () =>
  D.readMarkets() as Promise<MarketState[]>, refetchInterval: 15000 });

export const useStats = () => useQuery({ queryKey: ['terminal_statistics'], queryFn: () => D.readStats(), refetchInterval: 15000 });

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
