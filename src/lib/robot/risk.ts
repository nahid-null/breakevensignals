import { ABSOLUTE_MAX_ALLOCATION_PCT, MAX_PER_GROUP, PAPER_LEVERAGE, groupOf, type RobotSettings } from './config';
import type { Candidate, Direction } from './strategy';

export const MAINTENANCE_MARGIN = 0.005;
export type OpenExposure = { symbol: string; direction: Direction; margin: number; notional: number };
/** Binance contract filters used to simulate exchange precision and order rejections. */
export type SymbolRules = { tickSize: number; stepSize: number; minQty: number; maxQty: number; minNotional: number };
export const DEFAULT_RULES: SymbolRules = { tickSize: 0.0001, stepSize: 0.001, minQty: 0.001, maxQty: 1e12, minNotional: 5 };

/** Isolated-margin liquidation estimate at the fixed paper leverage. */
export function liquidationPrice(entry: number, direction: Direction, leverage = PAPER_LEVERAGE) {
  return direction === 'LONG' ? entry * (1 - 1 / leverage + MAINTENANCE_MARGIN) : entry * (1 + 1 / leverage - MAINTENANCE_MARGIN);
}

/** Combined margin budget: never more than 70% of the main balance; split across slots, never 70% per trade. */
export function allocationLimits(balance: number, open: OpenExposure[], s: RobotSettings) {
  const pct = Math.min(ABSOLUTE_MAX_ALLOCATION_PCT, Math.max(0, s.max_allocation_pct));
  const budget = Math.max(0, balance) * pct / 100;
  const used = open.reduce((a, p) => a + p.margin, 0);
  const available = Math.max(0, budget - used);
  const slot = budget / Math.max(1, s.max_concurrent);
  return { budget, used, available, slot, reserve: Math.max(0, balance) - used };
}

/** Margin for a new trade: a full slot for strong setups, three quarters for qualified ones, capped by what is left. */
export function planMargin(c: Pick<Candidate, 'score'>, balance: number, open: OpenExposure[], s: RobotSettings): number | { rejected: string } {
  const { available, slot } = allocationLimits(balance, open, s);
  if (available <= 1e-9) return { rejected: 'Margin budget full (70% cap)' };
  return Math.min(available, slot * (c.score >= s.high_score ? 1 : 0.75));
}

export const floorStep = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;
export const roundTick = (x: number, tick: number, mode: 'up' | 'down') => (mode === 'up' ? Math.ceil(x / tick - 1e-9) : Math.floor(x / tick + 1e-9)) * tick;

/** Quantity at exactly 50x from margin and the actual simulated price, rounded down to the contract step. */
export function sizeOrder(margin: number, price: number, rules: SymbolRules): { qty: number; notional: number; margin: number } | { rejected: string } {
  if (!(margin > 0) || !(price > 0)) return { rejected: 'Invalid order size' };
  const qty = Math.min(rules.maxQty, floorStep((margin * PAPER_LEVERAGE) / price, rules.stepSize));
  if (qty < rules.minQty) return { rejected: 'Order rejected: below minimum quantity' };
  if (qty * price < rules.minNotional) return { rejected: `Order rejected: below ${rules.minNotional} USDT minimum notional` };
  return { qty, notional: qty * price, margin: (qty * price) / PAPER_LEVERAGE };
}

export type ClosedResult = { closedAt: number; pnl: number };
const DAY = 86_400_000;
/** Optional daily loss limit (off by default): realized loss since 00:00 UTC as % of the balance at the start of the day. */
export function dailyLossHit(history: ClosedResult[], balance: number, now: number, s: Pick<RobotSettings, 'daily_loss_limit_enabled' | 'daily_loss_limit_pct'>) {
  if (!s.daily_loss_limit_enabled) return false;
  const day = Math.floor(now / DAY) * DAY;
  const today = history.filter((h) => h.closedAt >= day && h.closedAt <= now).reduce((a, h) => a + h.pnl, 0);
  const startOfDay = balance - today;
  return today < 0 && startOfDay > 0 && -today / startOfDay * 100 >= s.daily_loss_limit_pct;
}
/** Optional loss-streak cooldown (off by default): N losses in a row pause new entries for the cooldown after the last loss. */
export function lossStreakCooling(history: ClosedResult[], now: number, s: Pick<RobotSettings, 'loss_streak_enabled' | 'loss_streak_cooldown' | 'cooldown_minutes'>) {
  if (!s.loss_streak_enabled) return false;
  const last = [...history].filter((h) => h.closedAt <= now).sort((a, b) => b.closedAt - a.closedAt).slice(0, s.loss_streak_cooldown);
  return last.length >= s.loss_streak_cooldown && last.every((h) => h.pnl < 0) && now - last[0]!.closedAt < s.cooldown_minutes * 60_000;
}
/** Largest margin whose loss at the structural stop (plus round-trip costs) stays within risk_per_trade_pct of the balance at 50x. */
export function riskMarginCap(balance: number, entry: number, stop: number, s: Pick<RobotSettings, 'risk_per_trade_pct' | 'fee_pct' | 'slippage_bps'>) {
  const lossFraction = Math.abs(entry - stop) / entry + 2 * s.fee_pct / 100 + 2 * s.slippage_bps / 10_000;
  return lossFraction > 0 ? (Math.max(0, balance) * s.risk_per_trade_pct / 100) / (lossFraction * PAPER_LEVERAGE) : 0;
}

/** Portfolio gates for paper mode. The daily loss limit and loss-streak cooldown apply only when switched on; no daily trade limit. */
export function portfolioGate(c: Pick<Candidate, 'symbol' | 'direction'>, open: OpenExposure[], balance: number, s: RobotSettings,
  history: ClosedResult[] = [], now = Date.now()): string | null {
  if (s.emergency_stop) return 'Emergency stop active';
  if (!s.enabled) return 'Robot paused';
  if (balance <= 0) return 'No paper balance';
  if (dailyLossHit(history, balance, now, s)) return 'Daily loss limit reached';
  if (lossStreakCooling(history, now, s)) return 'Loss-streak cooldown';
  if (open.some((p) => p.symbol === c.symbol)) return 'Already in this coin';
  if (open.length >= s.max_concurrent) return 'All position slots in use';
  if (open.filter((p) => groupOf(p.symbol) === groupOf(c.symbol)).length >= MAX_PER_GROUP) return 'Correlated exposure limit';
  if (open.filter((p) => p.direction === c.direction).length >= s.max_same_direction) return 'Too many positions in one direction';
  return null;
}

type ExchangeFilter = { filterType: string; tickSize?: string; stepSize?: string; minQty?: string; maxQty?: string; notional?: string };
/** Contract precision and minimums from Binance exchangeInfo filters. */
export function rulesFromFilters(filters: ExchangeFilter[]): SymbolRules {
  const f = (t: string) => filters.find((x) => x.filterType === t);
  const n = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);
  return { tickSize: n(f('PRICE_FILTER')?.tickSize, DEFAULT_RULES.tickSize), stepSize: n(f('LOT_SIZE')?.stepSize, DEFAULT_RULES.stepSize),
    minQty: n(f('LOT_SIZE')?.minQty, DEFAULT_RULES.minQty), maxQty: n(f('MARKET_LOT_SIZE')?.maxQty, DEFAULT_RULES.maxQty),
    minNotional: n(f('MIN_NOTIONAL')?.notional, DEFAULT_RULES.minNotional) };
}
