/**
 * Break-even, kept as five separate concepts (never assumed identical):
 *  1. activation condition  2. trigger price  3. break-even stop price  4. fee-adjusted (net zero) price
 *  5. exchange-adjusted price (rounded to the tick a real stop order must use)
 *
 * Pine (original indicator): trigger = entry ± 1.0R (R = |entry − original stop|), activated when the bar's
 * high (LONG) / low (SHORT) reaches it, evaluated after stop/target; the stop becomes exactly the entry
 * (gross, no fees) from the next bar. Paper Robot: a completely different rule — when a 1m close shows
 * NET ROI on margin ≥ the trigger % (default 6%), the stop is tightened to the price that locks +2% net ROI
 * after taker fee and slippage, rounded to tick.
 */
import { PARAMETERS as P } from '@/lib/engine/model';
import type { Direction } from '@/lib/config';

export const roundToTick = (price: number, tick: number, mode: 'up' | 'down' | 'nearest' = 'nearest') => {
  if (!(tick > 0)) return price;
  const n = price / tick; const k = mode === 'up' ? Math.ceil(n - 1e-9) : mode === 'down' ? Math.floor(n + 1e-9) : Math.round(n);
  return Number((k * tick).toFixed(Math.max(0, Math.ceil(-Math.log10(tick)) + 2)));
};

export type BreakevenBreakdown = {
  source: 'PINE' | 'ROBOT'; direction: Direction; entry: number;
  activation: string; trigger: number; stop: number; feeAdjusted: number; exchangeStop: number;
  notes: string[];
};

/** Pine break-even for a trade, with the engine's own cost model (fee % per side, slippage ticks per side). */
export function pineBreakeven(t: { direction: Direction; entry: number; originalStop: number }, tick: number, feePct: number = P.feePercent, slipTicks: number = P.slippageTicks): BreakevenBreakdown {
  const L = t.direction === 'LONG'; const risk = Math.abs(t.entry - t.originalStop); const f = feePct / 100; const s = slipTicks * tick;
  const trigger = t.entry + (L ? 1 : -1) * risk * P.breakevenTrigger;
  // Net-zero exit: (exit − entry)·dir = (entry + exit)·fee + 2·slippage
  const feeAdjusted = L ? (t.entry * (1 + f) + 2 * s) / (1 - f) : (t.entry * (1 - f) - 2 * s) / (1 + f);
  return { source: 'PINE', direction: t.direction, entry: t.entry,
    activation: `${L ? 'High' : 'Low'} reaches entry ${L ? '+' : '−'} ${P.breakevenTrigger.toFixed(1)}R, checked after stop/target on the same bar; new stop applies from the next bar.`,
    trigger, stop: t.entry, feeAdjusted, exchangeStop: roundToTick(t.entry, tick, L ? 'up' : 'down'),
    notes: ['Pine moves the stop to the exact entry price (gross break-even). It is not fee-adjusted.',
      `A stop-out at the entry still loses fees and slippage; net zero needs ${L ? 'above' : 'below'} the fee-adjusted price.`,
      `Fee-adjusted price uses the Pine engine's own costs: ${feePct}% fee per side and ${slipTicks} tick slippage.`] };
}

export type RobotCostSettings = { fee_pct: number; slippage_bps: number; breakeven_trigger_roi_pct: number };
export type RobotPositionLike = { direction: string; entry_price: number; quantity: number; leverage: number; entry_fee: number; funding: number; tick_size: number | null; initial_stop: number; stop_loss: number };

/** Robot profit-lock, mirroring src/lib/robot/paper.ts (netRoi / lockPrice) for a stored position. */
export function robotBreakeven(p: RobotPositionLike, s: RobotCostSettings): BreakevenBreakdown & { margin: number; lockRoiPct: number; storedStop: number; moved: boolean } {
  const L = p.direction === 'LONG'; const q = p.quantity; const t = s.fee_pct / 100; const slip = s.slippage_bps / 10_000;
  const margin = (p.entry_price * q) / (p.leverage || 50); const tick = p.tick_size ?? 0;
  const realized = -p.entry_fee + p.funding; const sunk = p.entry_fee - p.funding;
  const roiPrice = (roi: number) => { const T = roi / 100 * margin;
    return L ? (T - realized + p.entry_price * q) / (q * (1 - t)) / (1 - slip) : (p.entry_price * q + realized - T) / (q * (1 + t)) / (1 + slip); };
  const lock = (roi: number) => { const T = roi / 100 * margin;
    const raw = L ? (T + sunk + p.entry_price * q) / (q * (1 - t)) / (1 - slip) : (p.entry_price * q - sunk - T) / (q * (1 + t)) / (1 + slip);
    return roundToTick(raw, tick, L ? 'up' : 'down'); };
  const trigger = roiPrice(s.breakeven_trigger_roi_pct);
  const lockStop = lock(2);
  return { source: 'ROBOT', direction: L ? 'LONG' : 'SHORT', entry: p.entry_price, margin, lockRoiPct: 2,
    activation: `A 1m close at NET ${s.breakeven_trigger_roi_pct}% ROI on margin (after taker fee ${s.fee_pct}% and ${s.slippage_bps} bps slippage), and that close is beyond the lock price.`,
    trigger, stop: lockStop, feeAdjusted: lock(0), exchangeStop: lockStop, storedStop: p.stop_loss,
    moved: (p.stop_loss - p.initial_stop) * (L ? 1 : -1) > 0,
    notes: ['The robot does not use the Pine 1R rule. It locks +2% net ROI, so its stop sits beyond the entry, not at it.',
      'Trigger and lock are computed from the actual simulated fill price and filled quantity, not the signal price.'] };
}
