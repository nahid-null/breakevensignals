export const RULES = {
  startingBalance: 10,
  maxSlots: 6,
  marginRate: 0.05,
  leverage: 75,
  targetMarginMultiple: 2,
} as const;

export type Side = 'LONG' | 'SHORT';
export interface AggregateTrade { time: number; price: number; quantity: number; isBuyerMaker: boolean }
export interface TargetFill { time: number; price: number; cumulativeQuantity: number }

export function marginFor(currentMainBalance: number): number {
  if (!Number.isFinite(currentMainBalance) || currentMainBalance <= 0) return 0;
  return currentMainBalance * RULES.marginRate;
}

export function hasFreeSlot(openPositionCount: number): boolean {
  return Number.isInteger(openPositionCount) && openPositionCount >= 0 && openPositionCount < RULES.maxSlots;
}

export function targetPrice(side: Side, entry: number, margin: number, quantity: number, tickSize: number): number {
  if (!(entry > 0) || !(margin > 0) || !(quantity > 0) || !(tickSize > 0)) throw new Error('Invalid target inputs');
  const direction = side === 'LONG' ? 1 : -1;
  const raw = entry + direction * (RULES.targetMarginMultiple * margin) / quantity;
  const ticks = side === 'LONG'
    ? Math.ceil(raw / tickSize - 1e-10)
    : Math.floor(raw / tickSize + 1e-10);
  return Number((ticks * tickSize).toPrecision(14));
}

export function grossAtPrice(side: Side, entry: number, exit: number, quantity: number): number {
  return (side === 'LONG' ? 1 : -1) * quantity * (exit - entry);
}

export function firstTargetFill(side: Side, target: number, quantity: number, notBefore: number, trades: AggregateTrade[]): TargetFill | null {
  let cumulativeQuantity = 0;
  for (const trade of [...trades].sort((a, b) => a.time - b.time)) {
    if (trade.time < notBefore) continue;
    const correctAggressor = side === 'LONG' ? !trade.isBuyerMaker : trade.isBuyerMaker;
    const reachesTarget = side === 'LONG' ? trade.price >= target : trade.price <= target;
    if (!correctAggressor || !reachesTarget) continue;
    cumulativeQuantity += trade.quantity;
    if (cumulativeQuantity + 1e-12 >= quantity) return { time: trade.time, price: trade.price, cumulativeQuantity };
  }
  return null;
}