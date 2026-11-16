/** Plain, bounded evidence captured at signal and paper execution; never reconstructed as live telemetry. */
export type EntryAudit = {
  strategy: string; source: 'LIVE_BINANCE' | 'CANDLE_REPLAY'; explanation: string;
  signal_open_at: number; signal_close_at: number; signal_price: number;
  body_pct: number; lower_wick_pct: number; upper_wick_pct: number; volume: number; volume_ratio: number; atr: number;
  pool_price: number; pool_time: number; pool_tf: number; pool_touches: number; sweep_at: number; sweep_extreme: number;
  reclaim_at: number; confirmation_at: number; opposing_level: number | null; reward_risk: number;
  bid?: number; ask?: number; spread_bps?: number; quote_received_at?: number; fill_at?: number; delay_ms?: number;
  fill_price?: number; slippage_bps?: number; signal_drift_bps?: number; entry_fee?: number; estimated_exit_fee?: number;
  initial_net_roi_pct?: number; requested_quantity?: number; filled_quantity?: number; depth_levels?: number;
};