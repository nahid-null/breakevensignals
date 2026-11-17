import Decimal from 'decimal.js';
import type { Candle, Signal } from './model';
import type { MtfSnapshot } from './mtf-trend';
import { trendSkip } from './simulator-replay';

/**
 * prompt-39 Simulator rule, mirroring public.simulate_engine_candle / sim_finish_trade (PINE5_TREND):
 * original Pine entries from 5-minute bars, traded only with the Trend Identify bias (15m = 5m = side,
 * 1m sideways or same), Pine's own entry/take profit/stop (stop follows Pine breakeven), 25x,
 * 50% of balance, 0.05% fees per side, one tick slippage per side, one open trade at a time.
 */
export const PINE5 = { leverage: 25, marginShare: 0.5, feeRate: 0.0005, maintenance: 0.005, startBalance: 10 } as const;
const dec = (n: Decimal.Value) => new Decimal(n);
const sign = (d: string) => d === 'LONG' ? 1 : -1;

export interface Pine5Position { tradeId: string; symbol: string; direction: 'LONG' | 'SHORT'; openedCandle: number;
  entry: string; stop: string; target: string; liquidation: string; margin: string; quantity: string; entryFee: string;
  slippage: string; balanceBefore: string; breakeven: boolean; trend: MtfSnapshot | null }
export interface Pine5Trade extends Pine5Position { closedCandle: number; exit: string; reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'BREAKEVEN' | 'LIQUIDATED';
  grossPnl: string; exitFee: string; pnl: string; balanceAfter: string }

/** Skip reason for a 5-minute Pine entry, or null when the Simulator trades it. */
export function pine5Skip(e: Pick<Signal, 'direction' | 'mtf_trend'>, balance: Decimal.Value, enabled: boolean, open: boolean, live = true): string | null {
  if (!live) return 'NOT_LIVE';
  const trend = trendSkip(e.mtf_trend ?? null, e.direction);
  if (trend) return trend;
  if (!enabled) return 'SIMULATOR_OFF';
  if (dec(balance).mul(PINE5.marginShare).toDecimalPlaces(8).lte(0)) return 'NO_BALANCE';
  return open ? 'TRADE_ALREADY_OPEN' : null;
}

export function openPine5(e: Signal, candleTime: number, tick: number, balance: Decimal.Value): Pine5Position {
  const s = sign(e.direction); const entry = dec(e.entry_price);
  const margin = dec(balance).mul(PINE5.marginShare).toDecimalPlaces(8);
  const notional = margin.mul(PINE5.leverage);
  return { tradeId: e.trade_id, symbol: e.symbol, direction: e.direction, openedCandle: candleTime,
    entry: entry.toString(), stop: dec(e.stop_loss).toString(), target: dec(e.take_profit).toString(),
    liquidation: entry.mul(dec(1).minus(dec(s).mul(dec(1).div(PINE5.leverage).minus(PINE5.maintenance)))).toString(),
    margin: margin.toString(), quantity: notional.div(entry).toString(), entryFee: notional.mul(PINE5.feeRate).toString(),
    slippage: String(tick), balanceBefore: dec(balance).toString(), breakeven: false, trend: e.mtf_trend ?? null };
}

/** Liquidation applies only when Pine's stop lies beyond the liquidation price (a nearer stop is reached first). */
export function pine5Liquidated(p: Pine5Position, c: Candle): boolean {
  const liq = dec(p.liquidation); const stop = dec(p.stop);
  return p.direction === 'LONG' ? dec(c.low).lte(liq) && stop.lt(liq) : dec(c.high).gte(liq) && stop.gt(liq);
}

export function closePine5(p: Pine5Position, exit: Decimal.Value, reason: Pine5Trade['reason'], candleTime: number, balance: Decimal.Value): Pine5Trade {
  const s = sign(p.direction); const q = dec(p.quantity); const px = dec(exit);
  const gross = reason === 'LIQUIDATED' ? dec(p.margin).neg()
    : Decimal.max(q.mul(px.minus(p.entry)).mul(s).minus(q.mul(p.slippage).mul(2)), dec(p.margin).neg());
  const exitFee = reason === 'LIQUIDATED' ? dec(0) : q.mul(px).mul(PINE5.feeRate);
  const after = Decimal.max(dec(balance).plus(gross).minus(p.entryFee).minus(exitFee), 0);
  return { ...p, closedCandle: candleTime, exit: px.toString(), reason, grossPnl: gross.toString(), exitFee: exitFee.toString(),
    pnl: after.minus(balance).toString(), balanceAfter: after.toString() };
}

/** Telegram receipt status: exactly one of the two the user asked for. */
export const receiptStatus = (reason: string) => reason === 'TAKE_PROFIT' ? 'Take profit hit' : 'Stop loss hit';
