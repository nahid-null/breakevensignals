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

/** Portfolio gates for paper mode. No daily loss shutdown, no loss-streak pause and no daily trade limit by design. */
export function portfolioGate(c: Pick<Candidate, 'symbol' | 'direction'>, open: OpenExposure[], balance: number, s: RobotSettings): string | null {
  if (s.emergency_stop) return 'Emergency stop active';
  if (!s.enabled) return 'Robot paused';
  if (balance <= 0) return 'No paper balance';
  if (open.some((p) => p.symbol === c.symbol)) return 'Already in this coin';
  if (open.length >= s.max_concurrent) return 'All position slots in use';
  if (open.filter((p) => groupOf(p.symbol) === groupOf(c.symbol)).length >= MAX_PER_GROUP) return 'Correlated exposure limit';
  if (open.filter((p) => p.direction === c.direction).length >= s.max_same_direction) return 'Too many positions in one direction';
  return null;
}
