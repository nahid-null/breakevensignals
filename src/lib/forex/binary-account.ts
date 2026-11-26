/**
 * Quotex-style binary-option account rules for the Forex Simulator (prompt-78).
 * Fixed $1 stake, 1-minute expiry, no leverage/SL/TP. WIN returns $1.77 (gross $2 minus 23% of the $1 profit),
 * LOSS loses the $1 stake, DRAW refunds it. Money is tracked in integer cents to avoid float drift.
 */
export const FX_RULES = {
  pair: 'AUD/JPY',
  signalTimeframeSec: 180,
  expirySec: 60,
  startBalance: 10,
  stake: 1,
  grossPayout: 2,
  profitFeeRate: 0.23,
} as const;

export type FxSide = 'LONG' | 'SHORT';
export type FxResult = 'WIN' | 'LOSS' | 'DRAW';

const cents = (x: number) => Math.round(x * 100);
export const STAKE_C = cents(FX_RULES.stake);
export const GROSS_PROFIT_C = cents(FX_RULES.grossPayout - FX_RULES.stake); // 100
export const FEE_C = Math.round(GROSS_PROFIT_C * FX_RULES.profitFeeRate); // 23
export const NET_WIN_C = GROSS_PROFIT_C - FEE_C; // 77

export function settle(side: FxSide, entry: number, expiry: number): FxResult {
  if (expiry === entry) return 'DRAW';
  const up = expiry > entry;
  return (side === 'LONG') === up ? 'WIN' : 'LOSS';
}

/** Net change to the balance and the money parts of one trade, in cents. */
export function tradeMoney(result: FxResult) {
  if (result === 'WIN') return { netC: NET_WIN_C, grossProfitC: GROSS_PROFIT_C, feeC: FEE_C, returnedC: STAKE_C + NET_WIN_C };
  if (result === 'LOSS') return { netC: -STAKE_C, grossProfitC: 0, feeC: 0, returnedC: 0 };
  return { netC: 0, grossProfitC: 0, feeC: 0, returnedC: STAKE_C };
}

export const canOpen = (balanceC: number) => balanceC >= STAKE_C;

/** Apply results in order from a starting balance; returns the balance in dollars. */
export function balanceAfter(results: FxResult[], startBalance: number = FX_RULES.startBalance): number {
  let b = cents(startBalance);
  for (const r of results) { if (!canOpen(b)) break; b += tradeMoney(r).netC; }
  return b / 100;
}
