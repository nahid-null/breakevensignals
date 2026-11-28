import { describe, expect, it } from 'bun:test';
import {
  displayedSignalPrice,
  displayedSignalSide,
  fee,
  grossPnl,
  hasFreeSlot,
  isCrossLiquidated,
  marginFor,
  normalizeAggregateTimestamp,
  parseBuyerMakerFlag,
  portfolioMetrics,
  positionQuantity,
  RULES,
  targetPrice,
  targetTradeEligible,
  type PositionRisk,
} from './rules';

describe('prompt-83 Spot research account rules', () => {
  it('recalculates the 5% allocation from the current main balance', () => {
    expect(marginFor(10)).toBe(0.5);
    expect(marginFor(12)).toBeCloseTo(0.6, 12);
  });

  it('allows at most six simultaneous positions', () => {
    expect(hasFreeSlot(5)).toBe(true);
    expect(hasFreeSlot(6)).toBe(false);
  });

  it('sizes notional at exactly 75x and sets a $1 gross target on $0.50 margin', () => {
    const quantity = positionQuantity(0.5, 100);
    expect(quantity * 100).toBe(37.5);
    expect(RULES.leverage).toBe(75);
    const longTarget = targetPrice('LONG', 100, 0.5, quantity);
    const shortTarget = targetPrice('SHORT', 100, 0.5, quantity);
    expect(grossPnl('LONG', 100, longTarget, quantity)).toBeCloseTo(1, 12);
    expect(grossPnl('SHORT', 100, shortTarget, quantity)).toBeCloseTo(1, 12);
  });

  it('uses the entire wallet as shared collateral rather than liquidating at one position margin', () => {
    const position: PositionRisk = { symbol: 'ETHUSDT', side: 'LONG', entry: 100, quantity: 0.375, margin: 0.5 };
    const metrics = portfolioMetrics(10, [position], new Map([['ETHUSDT', 95]]));
    expect(metrics.equity).toBeCloseTo(8.125, 12);
    expect(metrics.maintenanceMargin).toBeCloseTo(0.178125, 12);
    expect(metrics.sharedAvailableCollateral).toBeCloseTo(7.625, 12);
    expect(metrics.maintenanceHeadroom).toBeCloseTo(7.946875, 12);
    expect(metrics.availableForNewInitialMargin).toBeCloseTo(7.625, 12);
    expect(isCrossLiquidated(metrics)).toBe(false);
  });

  it('liquidates the shared portfolio when combined marked losses exhaust account equity', () => {
    const positions = Array.from({ length: 6 }, (_, index): PositionRisk => ({
      symbol: `PAIR${index}`,
      side: 'LONG',
      entry: 100,
      quantity: 0.375,
      margin: 0.5,
    }));
    const prices = new Map(positions.map((position) => [position.symbol, 80]));
    const metrics = portfolioMetrics(10, positions, prices);
    expect(metrics.equity).toBe(-35);
    expect(metrics.maintenanceMargin).toBeCloseTo(0.9, 12);
    expect(isCrossLiquidated(metrics)).toBe(true);
  });

  it('uses the public baseline fee assumption and checks target-side aggressor direction', () => {
    expect(fee(37.5)).toBeCloseTo(0.0375, 12);
    expect(targetTradeEligible('LONG', 102, { time: 1, price: 102, quantity: 1, isBuyerMaker: false })).toBe(true);
    expect(targetTradeEligible('LONG', 102, { time: 1, price: 102, quantity: 1, isBuyerMaker: true })).toBe(false);
    expect(targetTradeEligible('SHORT', 98, { time: 1, price: 98, quantity: 1, isBuyerMaker: true })).toBe(true);
  });

  it('normalizes Binance archive microsecond timestamps and mixed-case flags', () => {
    expect(normalizeAggregateTimestamp(1_793_232_000_119_237)).toBe(1_793_232_000_119);
    expect(normalizeAggregateTimestamp(1_793_232_000_119)).toBe(1_793_232_000_119);
    expect(parseBuyerMakerFlag('False')).toBe(false);
    expect(parseBuyerMakerFlag('TRUE')).toBe(true);
  });

  it('preserves the visible label direction and price as separate indicator evidence', () => {
    expect(displayedSignalSide('STRONG BUY\n10.811')).toBe('LONG');
    expect(displayedSignalPrice('STRONG BUY\n10.811')).toBe(10.811);
    expect(displayedSignalSide('SELL\n4.441')).toBe('SHORT');
    expect(displayedSignalPrice('SELL\n4.441')).toBe(4.441);
    expect(() => displayedSignalPrice('SELL')).toThrow('does not contain a positive displayed price');
  });
});