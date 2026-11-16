/** Paper-trading robot universe and default settings. Pure module, safe for browser and worker. */
export const DEFAULT_PAPER_BALANCE = 10;
export const ROBOT_SYMBOLS = [
  'NEARUSDT', 'LINKUSDT', 'SUIUSDT', 'INJUSDT', 'TAOUSDT', 'UNIUSDT', 'ONDOUSDT', 'BOMEUSDT', 'BCHUSDT', 'BERAUSDT',
  'ZROUSDT', 'POLUSDT', 'LTCUSDT', 'XRPUSDT', 'FILUSDT', 'TIAUSDT', 'WIFUSDT', 'ENAUSDT', 'RENDERUSDT', 'HBARUSDT',
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ZECUSDT', 'HYPEUSDT', 'ASTERUSDT', 'DOGEUSDT', 'BNBUSDT', '1000PEPEUSDT', 'ADAUSDT',
  'WLDUSDT', 'AAVEUSDT', 'AVAXUSDT', 'XMRUSDT', 'TRXUSDT', 'ARBUSDT', 'TRUMPUSDT', 'XLMUSDT', 'DOTUSDT', 'APTUSDT',
] as const;
export const ROBOT_SYMBOL_PATTERN = /^[A-Z0-9]{2,20}USDT$/;
export const MAX_ROBOT_SYMBOLS = 60;
/** Paper requirement: every simulated position uses exactly this leverage. Never reduced automatically. */
export const PAPER_LEVERAGE = 50;
/** Kept for the database/protocol ceiling checks. */
export const ABSOLUTE_MAX_LEVERAGE = PAPER_LEVERAGE;
/** Take profit when NET ROI on allocated margin (after fees, slippage and funding) reaches this. */
export const TARGET_NET_ROI_PCT = 10;
/** Hard ceiling of combined margin as a share of the main balance; at least 30% stays in reserve. */
export const ABSOLUTE_MAX_ALLOCATION_PCT = 70;

/** Coarse correlation groups, used for ranking and a per-group cap. */
export const CORRELATION_GROUPS: Record<string, string> = {
  BTCUSDT: 'majors', ETHUSDT: 'majors', BNBUSDT: 'majors', BCHUSDT: 'payments', LTCUSDT: 'payments', XRPUSDT: 'payments',
  XLMUSDT: 'payments', TRXUSDT: 'payments', HBARUSDT: 'payments', ZECUSDT: 'privacy', XMRUSDT: 'privacy',
  SOLUSDT: 'l1', SUIUSDT: 'l1', NEARUSDT: 'l1', AVAXUSDT: 'l1', ADAUSDT: 'l1', DOTUSDT: 'l1', APTUSDT: 'l1', INJUSDT: 'l1',
  BERAUSDT: 'l1', TIAUSDT: 'l1', HYPEUSDT: 'perp-dex', ASTERUSDT: 'perp-dex', ARBUSDT: 'l2', POLUSDT: 'l2', ZROUSDT: 'l2',
  DOGEUSDT: 'meme', '1000PEPEUSDT': 'meme', WIFUSDT: 'meme', BOMEUSDT: 'meme', TRUMPUSDT: 'meme',
  LINKUSDT: 'defi', UNIUSDT: 'defi', AAVEUSDT: 'defi', ONDOUSDT: 'defi', ENAUSDT: 'defi',
  TAOUSDT: 'ai', RENDERUSDT: 'ai', WLDUSDT: 'ai', FILUSDT: 'ai',
};
export const groupOf = (symbol: string) => CORRELATION_GROUPS[symbol] ?? symbol;
export const MAX_PER_GROUP = 2;

export type RobotSettings = {
  enabled: boolean; emergency_stop: boolean;
  min_score: number; high_score: number;
  max_concurrent: number; max_same_direction: number; max_allocation_pct: number; max_leverage: number;
  max_hold_minutes: number; fee_pct: number; maker_fee_pct: number; slippage_bps: number; max_spread_bps: number; min_quote_volume_musd: number;
};
export const DEFAULT_SETTINGS: RobotSettings = {
  enabled: true, emergency_stop: false, min_score: 75, high_score: 85,
  max_concurrent: 5, max_same_direction: 5, max_allocation_pct: 70, max_leverage: PAPER_LEVERAGE,
  max_hold_minutes: 90, fee_pct: 0.05, maker_fee_pct: 0.02, slippage_bps: 2, max_spread_bps: 8, min_quote_volume_musd: 5,
};
