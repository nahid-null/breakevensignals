import { useQuery } from '@tanstack/react-query';
import * as R from '../dashboard.functions';
import type { Database } from '@/integrations/supabase/types';
import { computeMetrics, type Metrics } from './metrics';

type T = Database['public']['Tables'];
export type RobotPosition = T['robot_positions']['Row'];
export type RobotMarket = T['robot_market']['Row'];
export type RobotSignal = T['robot_signals']['Row'];
export type RobotAccount = T['robot_account']['Row'];
export type RobotSettingsRow = T['robot_settings']['Row'];
export type RobotBacktest = T['robot_backtests']['Row'];
export type RobotScanner = T['robot_scanner']['Row'];


export const useRobotAccount = () => useQuery({ queryKey: ['robot_account'], refetchInterval: 10_000, queryFn: () => R.readRobotAccount() as Promise<RobotAccount> });
export const useRobotSettings = () => useQuery({ queryKey: ['robot_settings'], refetchInterval: 10_000, queryFn: () => R.readRobotSettings() as Promise<RobotSettingsRow> });
export const useRobotPositions = () => useQuery({ queryKey: ['robot_positions'], refetchInterval: 10_000, queryFn: () => R.readRobotPositions() as Promise<RobotPosition[]> });
export const useRobotMarkets = () => useQuery({ queryKey: ['robot_market'], refetchInterval: 10_000, queryFn: () => R.readRobotMarkets() as Promise<RobotMarket[]> });
export const useRobotSignals = () => useQuery({ queryKey: ['robot_signals'], refetchInterval: 10_000, queryFn: () => R.readRobotSignals() as Promise<RobotSignal[]> });
export const useRobotScanner = () => useQuery({ queryKey: ['robot_scanner'], refetchInterval: 10_000, queryFn: () => R.readRobotScanner() as Promise<RobotScanner | null> });
export const useRobotRuntime = () => useQuery({ queryKey:['robot_runtime'],refetchInterval:10_000,queryFn:()=>R.readRobotRuntime() as Promise<T['robot_runtime']['Row']|null> });
export const useRobotDecisions = () => useQuery({ queryKey:['robot_decisions'],refetchInterval:10_000,queryFn:()=>R.readRobotDecisions() as Promise<T['robot_decisions']['Row'][]> });
export const useRobotBacktests = () => useQuery({ queryKey: ['robot_backtests'], queryFn: () => R.readRobotBacktests() as Promise<RobotBacktest[]> });

const asClosed = (p: RobotPosition) => ({ direction: p.direction, netPnl: Number(p.realized_pnl), exitReason: p.exit_reason ?? '', closedAt: Date.parse(p.closed_at ?? p.updated_at), riskUsdt: Number(p.risk_usdt) });
export function robotStats(positions: RobotPosition[], startBalance: number): { all: Metrics; long: Metrics; short: Metrics } {
  const closed = positions.filter((p) => p.status === 'CLOSED').map(asClosed);
  return { all: computeMetrics(closed, startBalance), long: computeMetrics(closed.filter((c) => c.direction === 'LONG'), startBalance),
    short: computeMetrics(closed.filter((c) => c.direction === 'SHORT'), startBalance) };
}
/** Net realized P&L by UTC day, newest first. */
export function dailyPnl(positions: RobotPosition[]) {
  const by = new Map<string, { pnl: number; trades: number }>();
  for (const p of positions) if (p.status === 'CLOSED' && p.closed_at) {
    const d = p.closed_at.slice(0, 10); const e = by.get(d) ?? { pnl: 0, trades: 0 };
    e.pnl += Number(p.realized_pnl); e.trades++; by.set(d, e);
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, v]) => ({ date, ...v }));
}
/** Robot status from the freshness of the worker's saved coin rows. */
export function robotStatus(markets: RobotMarket[], settings: RobotSettingsRow | undefined, now = Date.now()) {
  if (settings?.emergency_stop) return 'EMERGENCY STOP';
  const fresh = markets.filter((m) => now - Date.parse(m.updated_at) < 90_000);
  if (!markets.length || !fresh.length) return 'OFFLINE';
  if (fresh.some((m) => m.status === 'PAUSED')) return 'PAUSED';
  if (!settings?.enabled) return 'PAUSED';
  const live = fresh.filter((m) => m.status === 'LIVE').length;
  return live === 0 ? 'WARMING UP' : 'RUNNING';
}
