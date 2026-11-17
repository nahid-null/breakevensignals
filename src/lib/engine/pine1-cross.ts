import Decimal from 'decimal.js';
import type { Candle, Signal } from './model';
import type { MtfSnapshot } from './mtf-trend';
import { trendSkip } from './simulator-replay';

/**
 * prompt-40 Simulator rule, mirroring public.simulate_engine_candle / sim_finish_trade (PINE1_CROSS):
 * every original Pine entry from 1-minute bars (prompt-44: trend gate, three slots, no time limit), 50x, 10% of balance per slot as margin,
 * no stop loss, take profit at +25% net of margin, cross-margin liquidation against the whole balance.
 */
export const PINE1 = { leverage: 50, marginShare: 0.1, targetRoe: 0.25, feeRate: 0.0005, maintenance: 0.005, startBalance: 10, maxHoldMs: Infinity, slots: 3 } as const;
const dec = (n: Decimal.Value) => new Decimal(n);

export interface Pine1Position { tradeId: string; symbol: string; direction: 'LONG' | 'SHORT'; openedCandle: number; entry: string;
  target: string; liquidation: string; margin: string; quantity: string; entryFee: string; slippage: string; balanceBefore: string; trend: MtfSnapshot | null }
export interface Pine1Trade extends Pine1Position { closedCandle: number; exit: string; reason: 'TAKE_PROFIT' | 'LIQUIDATED' | 'TIME_EXIT'; exitFee: string; pnl: string; balanceAfter: string }

/** prompt-42: trend gate restored; up to two open trades, never two on the same coin. */
export function pine1Skip(e: Signal, balance: Decimal.Value, open: { symbol: string }[]): string | null {
  return trendSkip(e.mtf_trend ?? null, e.direction)
    ?? (dec(balance).mul(PINE1.marginShare).toDecimalPlaces(8).lte(0) ? 'NO_BALANCE'
    : open.reduce((a, o) => a.minus((o as { margin?: string }).margin ?? 0), dec(balance)).lt(dec(balance).mul(PINE1.marginShare).toDecimalPlaces(8)) ? 'NO_BALANCE'
    : open.some((o) => o.symbol === e.symbol) ? 'COIN_ALREADY_OPEN' : open.length >= PINE1.slots ? 'ALL_SLOTS_IN_USE' : null);
}

export function openPine1(e: Signal, candleTime: number, tick: number, balance: Decimal.Value, reserved: Decimal.Value = 0): Pine1Position {
  const s = e.direction === 'LONG' ? 1 : -1; const pe = dec(e.entry_price); const slip = dec(tick);
  const margin = dec(balance).mul(PINE1.marginShare).toDecimalPlaces(8); const notional = margin.mul(PINE1.leverage);
  const q = notional.div(pe); const fee = notional.mul(PINE1.feeRate);
  const target = s === 1 ? pe.mul(1.0055).plus(slip.mul(2)).div(0.9995) : pe.mul(0.9945).minus(slip.mul(2)).div(1.0005);
  const liq = Decimal.max(pe.minus(dec(balance).minus(reserved).minus(fee).minus(notional.mul(PINE1.maintenance)).div(q).mul(s)), 0);
  return { tradeId: e.trade_id, symbol: e.symbol, direction: e.direction, openedCandle: candleTime, entry: pe.toString(), target: target.toString(),
    liquidation: liq.toString(), margin: margin.toString(), quantity: q.toString(), entryFee: fee.toString(), slippage: slip.toString(),
    balanceBefore: dec(balance).toString(), trend: e.mtf_trend ?? null };
}

/** Liquidation is checked before the target inside one candle (worst case). */
export function pine1Exit(p: Pine1Position, c: Candle): Pine1Trade['reason'] | null {
  const L = p.direction === 'LONG';
  if (L ? dec(c.low).lte(p.liquidation) : dec(c.high).gte(p.liquidation)) return 'LIQUIDATED';
  if (L ? dec(c.high).gte(p.target) : dec(c.low).lte(p.target)) return 'TAKE_PROFIT';
  if (c.time + 60_000 - p.openedCandle >= PINE1.maxHoldMs) return 'TIME_EXIT';
  return null;
}

export function closePine1(p: Pine1Position, reason: Pine1Trade['reason'], candleTime: number, balance: Decimal.Value, close?: Decimal.Value, other: Decimal.Value = 0): Pine1Trade {
  const s = p.direction === 'LONG' ? 1 : -1; const q = dec(p.quantity);
  const px = dec(reason === 'LIQUIDATED' ? p.liquidation : reason === 'TIME_EXIT' ? close! : p.target);
  const cap = dec(balance).minus(other).minus(p.entryFee).neg();
  const gross = reason === 'LIQUIDATED' ? cap : Decimal.max(q.mul(px.minus(p.entry)).mul(s).minus(q.mul(p.slippage).mul(2)), cap);
  const exitFee = reason === 'LIQUIDATED' ? dec(0) : q.mul(px).mul(PINE1.feeRate);
  const after = Decimal.max(dec(balance).plus(gross).minus(p.entryFee).minus(exitFee), 0);
  return { ...p, closedCandle: candleTime, exit: px.toString(), reason, exitFee: exitFee.toString(), pnl: after.minus(balance).toString(), balanceAfter: after.toString() };
}
