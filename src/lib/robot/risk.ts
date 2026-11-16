import { ABSOLUTE_MAX_ALLOCATION_PCT, ABSOLUTE_MAX_LEVERAGE, groupOf, type RobotSettings } from './config';
import type { Candidate, Direction } from './strategy';

export const MAINTENANCE_MARGIN = 0.005;
export const MIN_NOTIONAL_USDT = 5;
export type OpenExposure = { symbol: string; direction: Direction; margin: number; riskUsdt: number; notional: number };
export type Account = { balance: number; dayStartBalance: number; realizedToday: number; lossStreak: number; lastLossAt: number | null };
export type Sizing = { leverage: number; qty: number; notional: number; margin: number; riskUsdt: number;
  liquidation: number; band: string; bandMax: number };

/** Maximum leverage for the current conditions. Bands are ceilings; lower is chosen when it fits. */
export function leverageBand(c: Pick<Candidate, 'atrPct' | 'score'>, spreadBps: number | null, s: RobotSettings): { band: string; max: number } {
  const cap = Math.min(ABSOLUTE_MAX_LEVERAGE, Math.max(1, Math.floor(s.max_leverage)));
  let band: string; let max: number;
  if (c.atrPct > 0.5) { band = 'Extreme volatility'; max = 3; }
  else if (c.atrPct > 0.3) { band = 'High volatility'; max = 5; }
  else if (c.score >= 95 && c.atrPct <= 0.12 && spreadBps !== null && spreadBps <= 2) { band = 'Extremely favorable'; max = 50; }
  else if (c.score >= 92 && c.atrPct <= 0.2) { band = 'Exceptional setup'; max = 30; }
  else if (c.score >= s.high_score) { band = 'Strong confirmed setup'; max = 20; }
  else { band = 'Normal conditions'; max = 10; }
  return { band, max: Math.min(max, cap) };
}

export function liquidationPrice(entry: number, leverage: number, direction: Direction) {
  return direction === 'LONG' ? entry * (1 - 1 / leverage + MAINTENANCE_MARGIN) : entry * (1 + 1 / leverage - MAINTENANCE_MARGIN);
}

/** Margin budget: total open margin never exceeds the allocation cap of the main balance. */
export function allocationLimits(balance: number, open: OpenExposure[], s: RobotSettings) {
  const pct = Math.min(ABSOLUTE_MAX_ALLOCATION_PCT, Math.max(0, s.max_allocation_pct));
  const budget = Math.max(0, balance) * pct / 100;
  const used = open.reduce((a, p) => a + p.margin, 0);
  const available = Math.max(0, budget - used);
  // Never hand the whole budget to one trade.
  const perTrade = Math.min(available, budget / Math.max(1, s.max_concurrent));
  return { budget, used, available, perTrade, reserve: Math.max(0, balance) - used };
}

/**
 * Size from the permitted monetary loss and actual stop distance, then pick the lowest leverage
 * that fits the margin budget while keeping liquidation at least twice the stop distance away.
 */
export function sizePosition(c: Candidate, balance: number, open: OpenExposure[], s: RobotSettings, spreadBps: number | null, entry = c.entry): Sizing | { rejected: string } {
  const stopDist = Math.abs(entry - c.stop);
  if (!(stopDist > 0) || (c.direction === 'LONG' ? c.stop >= entry : c.stop <= entry)) return { rejected: 'No valid protective stop' };
  const costPerUnit = entry * 2 * (s.fee_pct / 100 + s.slippage_bps / 10_000);
  const maxLoss = balance * s.risk_per_trade_pct / 100;
  let qty = maxLoss / (stopDist + costPerUnit);
  const { perTrade } = allocationLimits(balance, open, s);
  if (perTrade <= 0) return { rejected: 'Margin allocation exhausted' };
  const { band, max } = leverageBand(c, spreadBps, s);
  const stopPct = stopDist / entry;
  const safeMax = Math.floor(1 / (2 * stopPct + MAINTENANCE_MARGIN));
  const bandMax = Math.min(max, safeMax);
  if (bandMax < 1) return { rejected: 'No leverage keeps liquidation safely beyond the stop' };
  let leverage = Math.max(1, Math.ceil((qty * entry) / perTrade));
  if (leverage > bandMax) { leverage = bandMax; qty = Math.min(qty, (perTrade * leverage) / entry); }
  const notional = qty * entry;
  if (notional < MIN_NOTIONAL_USDT) return { rejected: 'Position below exchange minimum size' };
  const margin = notional / leverage;
  const liquidation = liquidationPrice(entry, leverage, c.direction);
  if (Math.abs(entry - liquidation) < 2 * stopDist) return { rejected: 'Liquidation too close to stop' };
  return { leverage, qty, notional, margin, riskUsdt: qty * (stopDist + costPerUnit), liquidation, band, bandMax };
}

/** Portfolio gates that apply before any entry. Returns a reason when trading must be skipped. */
export function portfolioGate(c: Candidate, open: OpenExposure[], acct: Account, s: RobotSettings, now: number): string | null {
  if (s.emergency_stop) return 'Emergency stop active';
  if (!s.enabled) return 'Robot paused';
  if (acct.balance <= 0) return 'No paper balance';
  if (acct.realizedToday <= -(acct.dayStartBalance * s.daily_loss_limit_pct / 100)) return 'Daily loss limit reached';
  if (acct.lossStreak >= s.loss_streak_cooldown && acct.lastLossAt !== null && now - acct.lastLossAt < s.cooldown_minutes * 60_000) return 'Cooling down after consecutive losses';
  if (open.length >= s.max_concurrent) return 'Maximum open positions';
  if (open.some((p) => p.symbol === c.symbol)) return 'Already in this coin';
  if (open.some((p) => groupOf(p.symbol) === groupOf(c.symbol))) return 'Correlated position already open';
  if (open.filter((p) => p.direction === c.direction).length >= s.max_same_direction) return 'Too many positions in one direction';
  return null;
}
