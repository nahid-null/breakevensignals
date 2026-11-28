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

export interface TimestampTrade extends AggregateTrade {
  symbol: string;
}

export interface CrossPosition extends PositionRisk {
  id: string;
  target: number;
  entryTime: number;
}

export interface TimestampResolution {
  liquidated: boolean;
  targetTradeIds: string[];
  prices: Map<string, number>;
  metrics: PortfolioMetrics;
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

export function targetReachedAtPrice(side: Side, target: number, trade: AggregateTrade): boolean {
  if (!(target > 0) || !(trade.price > 0) || !(trade.quantity > 0)) return false;
  return side === 'LONG' ? trade.price >= target : trade.price <= target;
}

export function resolveTimestampBatch(
  balance: number,
  positions: readonly CrossPosition[],
  currentPrices: ReadonlyMap<string, number>,
  trades: readonly TimestampTrade[],
): TimestampResolution {
  if (trades.length === 0) throw new Error('Cannot resolve a market timestamp without Spot trades');
  const prices = new Map(currentPrices);
  for (const trade of trades) {
    if (!(trade.price > 0) || !(trade.quantity > 0)) throw new Error('Spot aggregate trades must have positive prices and quantities');
    prices.set(trade.symbol, trade.price);
  }

  const metrics = portfolioMetrics(balance, positions, prices);
  const targetTradeIds: string[] = [];
  for (const position of positions) {
    const reached = trades.some((trade) => trade.symbol === position.symbol
      && trade.time >= position.entryTime
      && targetReachedAtPrice(position.side, position.target, trade));
    if (reached) targetTradeIds.push(position.id);
  }

  return { liquidated: isCrossLiquidated(metrics), targetTradeIds, prices, metrics };
}

export function normalizeAggregateTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Aggregate-trade timestamp must be non-negative');
  return timestamp >= 100_000_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
}

export function displayedSignalSide(labelText: string): Side {
  const name = labelText.trim().split(/\r?\n/)[0]?.toUpperCase() ?? '';
  if (name.includes('BUY')) return 'LONG';
  if (name.includes('SELL')) return 'SHORT';
  throw new Error(`Unrecognized Q-Trend label: ${labelText}`);
}

export function displayedSignalPrice(labelText: string): number {
  const priceText = labelText.trim().split(/\r?\n/).at(-1)?.trim();
  const price = Number(priceText);
  if (!priceText || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Q-Trend label does not contain a positive displayed price: ${labelText}`);
  }
  return price;
}

export function parseBuyerMakerFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') throw new Error(`Invalid buyer-maker flag: ${value}`);
  return normalized === 'true';
}