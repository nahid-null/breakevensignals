export const RULES = {
  startingBalance: 10,
  maxSlots: 6,
  marginRate: 0.05,
  leverage: 75,
  targetMarginMultiple: 2,
  syntheticMaintenanceRate: 0.005,
  baselineSpotFeeRate: 0.001,
} as const;

export type Side = 'LONG' | 'SHORT';

export interface PositionRisk {
  symbol: string;
  side: Side;
  entry: number;
  quantity: number;
  margin: number;
}

export interface PortfolioMetrics {
  unrealizedPnl: number;
  equity: number;
  maintenanceMargin: number;
  initialMarginReserved: number;
  sharedAvailableCollateral: number;
  maintenanceHeadroom: number;
  availableForNewInitialMargin: number;
}

export interface AggregateTrade {
  time: number;
  price: number;
  quantity: number;
  isBuyerMaker: boolean;
}

export function marginFor(currentMainBalance: number): number {
  if (!Number.isFinite(currentMainBalance) || currentMainBalance <= 0) return 0;
  return currentMainBalance * RULES.marginRate;
}

export function hasFreeSlot(openPositionCount: number): boolean {
  return Number.isInteger(openPositionCount) && openPositionCount >= 0 && openPositionCount < RULES.maxSlots;
}

export function positionQuantity(margin: number, entry: number): number {
  if (!(margin > 0) || !(entry > 0)) throw new Error('Margin and entry must be positive');
  return (margin * RULES.leverage) / entry;
}

export function targetPrice(side: Side, entry: number, margin: number, quantity: number): number {
  if (!(entry > 0) || !(margin > 0) || !(quantity > 0)) throw new Error('Invalid target inputs');
  const direction = side === 'LONG' ? 1 : -1;
  return entry + (direction * RULES.targetMarginMultiple * margin) / quantity;
}

export function grossPnl(side: Side, entry: number, mark: number, quantity: number): number {
  return (side === 'LONG' ? 1 : -1) * quantity * (mark - entry);
}

export function fee(notional: number): number {
  if (!Number.isFinite(notional) || notional < 0) throw new Error('Notional must be a non-negative number');
  return notional * RULES.baselineSpotFeeRate;
}

export function portfolioMetrics(
  balance: number,
  positions: readonly PositionRisk[],
  prices: ReadonlyMap<string, number>,
): PortfolioMetrics {
  let unrealizedPnl = 0;
  let maintenanceMargin = 0;
  let initialMarginReserved = 0;

  for (const position of positions) {
    const mark = prices.get(position.symbol);
    if (mark === undefined || !(mark > 0)) throw new Error(`Missing positive mark price for ${position.symbol}`);
    unrealizedPnl += grossPnl(position.side, position.entry, mark, position.quantity);
    maintenanceMargin += position.quantity * mark * RULES.syntheticMaintenanceRate;
    initialMarginReserved += position.margin;
  }

  const equity = balance + unrealizedPnl;
  const sharedAvailableCollateral = equity - initialMarginReserved;
  return {
    unrealizedPnl,
    equity,
    maintenanceMargin,
    initialMarginReserved,
    sharedAvailableCollateral,
    maintenanceHeadroom: equity - maintenanceMargin,
    availableForNewInitialMargin: sharedAvailableCollateral,
  };
}

export function isCrossLiquidated(metrics: PortfolioMetrics): boolean {
  return metrics.equity <= metrics.maintenanceMargin;
}

export function targetTradeEligible(side: Side, target: number, trade: AggregateTrade): boolean {
  const isCorrectAggressor = side === 'LONG' ? !trade.isBuyerMaker : trade.isBuyerMaker;
  const reachesTarget = side === 'LONG' ? trade.price >= target : trade.price <= target;
  return isCorrectAggressor && reachesTarget && trade.quantity > 0;
}

export function normalizeAggregateTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Aggregate-trade timestamp must be non-negative');
  return timestamp >= 100_000_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
}

export function parseBuyerMakerFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') throw new Error(`Invalid buyer-maker flag: ${value}`);
  return normalized === 'true';
}