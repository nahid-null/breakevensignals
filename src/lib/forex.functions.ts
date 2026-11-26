import { createServerFn } from '@tanstack/react-start';

/** Read-only frozen AI test; original CPES history remains archived unchanged. */
export const readForexBacktest = createServerFn({ method: 'GET' }).handler(async () => {
  const mod = await import('@/lib/forex/data/backtest-80-ai.json');
  return JSON.parse(JSON.stringify(mod.default)) as ForexBacktest;
});

export type FxTrade = {
  n: number; signal_time: string; entry_time: string; expiry_time: string; side: 'LONG' | 'SHORT'; patterns: string[];
  entry: number; expiry: number | null; stake: number; result: 'WIN' | 'LOSS' | 'DRAW' | 'VOID' | 'SKIPPED'; void_reason?: string;
  would_have?: 'WIN' | 'LOSS' | 'DRAW' | null; gross_profit: number; fee: number; net: number; balance_after: number;
  confidence?: number; reason?: string;
};
export type FxDay = {
  date: string; market_open: boolean; total: number; long: number; short: number; wins: number; losses: number; draws: number; win_rate: number | null;
  gross_profit: number; fees: number; net: number; start_balance: number; end_balance: number; signals: number; skipped: number; voided: number;
};
export type ForexBacktest = {
  meta: { title: string; mode: string; window_utc: [string, string]; data_source: string; downloaded_at: string; indicator: string; method: string; disclosures: string[]; rules: Record<string, number | string> };
  overall: { total: number; wins: number; losses: number; draws: number; voided: number; skipped: number; signals: number; win_rate: number | null; long_trades: number; short_trades: number;
    long_win_rate: number | null; short_win_rate: number | null; gross_profit: number; fees: number; net: number; start_balance: number; final_balance: number;
    max_consecutive_wins: number; max_consecutive_losses: number; best_day: string | null; worst_day: string | null };
  info_all_signals: { note: string; signals: number; wins: number; losses: number; draws: number; skipped_wins: number; skipped_losses: number };
  days: FxDay[]; trades: FxTrade[]; chart: [number, number, number, number, number][]; ema: [number, number][]; signals_total: number;
};
