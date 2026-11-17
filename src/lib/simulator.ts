import { useQuery } from '@tanstack/react-query';
import { readSimAccount, readSimTrades } from './dashboard.functions';
import type { Database } from '@/integrations/supabase/types';

export type SimAccount = Database['public']['Tables']['sim_account']['Row'];
export type SimTrade = Database['public']['Tables']['sim_trades']['Row'];
/** New practice trades use original Pine entries; the signal engine's targets stay unchanged. */
/** prompt-44: 1-minute Pine entries, 3 slots x 10% margin, no stop loss, +25% margin target or manual close, cross margin. */
export const SIM_RULES = { marginShare: 0.1, leverage: 50, defaultBalance: 10, slots: 3, feePercent: 0.05 } as const;

export const useSimAccount = () => useQuery({ queryKey: ['sim_account'], refetchInterval: 15000, queryFn: () => readSimAccount() as Promise<SimAccount | null> });
export const useSimTrades = () => useQuery({ queryKey: ['sim_trades'], refetchInterval: 15000, queryFn: () => readSimTrades() as Promise<SimTrade[]> });

/** Matches settlement accounting: both modeled tick costs, entry and estimated exit fees. */
export function unrealizedPnl(t: Pick<SimTrade, 'direction' | 'quantity' | 'entry_price' | 'entry_fee' | 'margin'> & Partial<Pick<SimTrade, 'slippage_price'>>, price: number) {
  const gross = Math.max(Number(t.quantity) * (price - Number(t.entry_price)) * (t.direction === 'LONG' ? 1 : -1) - 2 * Number(t.quantity) * Number(t.slippage_price ?? 0), -Number(t.margin));
  return gross - Number(t.entry_fee) - Number(t.quantity) * price * (SIM_RULES.feePercent / 100);
}

/** Sum of closed-trade results whose close falls on the same calendar day as `now` in `timeZone`. */
export function todayPnl(trades: Pick<SimTrade, 'closed_at' | 'pnl' | 'status'>[], now: Date, timeZone: string) {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = day(now);
  return trades.filter((t) => t.status === 'CLOSED' && t.closed_at && day(new Date(t.closed_at)) === today).reduce((s, t) => s + Number(t.pnl ?? 0), 0);
}

export function simSummary(trades: Pick<SimTrade, 'status' | 'pnl'>[]) {
  const closed = trades.filter((t) => t.status === 'CLOSED');
  const wins = closed.filter((t) => Number(t.pnl) > 0).length;
  return { closed: closed.length, wins, losses: closed.length - wins, winRate: closed.length ? (wins / closed.length) * 100 : null,
    totalPnl: closed.reduce((s, t) => s + Number(t.pnl ?? 0), 0) };
}

/** A restart begins a new performance session without deleting previous trades. */
export function simSessionTrades<T extends Pick<SimTrade, 'opened_at'>>(trades: T[], startedAt: string | null | undefined): T[] {
  if (!startedAt) return trades;
  const start = Date.parse(startedAt);
  return trades.filter((t) => Date.parse(t.opened_at) >= start);
}

export const fmtUsd = (n: number | null | undefined) => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—'
  : `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtSignedUsd = (n: number | null | undefined) => n === null || n === undefined ? '—' : `${Number(n) > 0 ? '+' : ''}${fmtUsd(n)}`;
