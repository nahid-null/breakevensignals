import { describe, expect, it } from 'bun:test';
import { firstTargetFill, grossAtPrice, hasFreeSlot, marginFor, RULES, targetPrice } from './rules';

describe('Q-Trend research account rules', () => {
  it('recalculates the 5% margin from the current main balance', () => {
    expect(marginFor(10)).toBe(0.5);
    expect(marginFor(12)).toBeCloseTo(0.6, 12);
  });

  it('allows at most six simultaneous trades', () => {
    expect(hasFreeSlot(5)).toBe(true);
    expect(hasFreeSlot(6)).toBe(false);
  });

  it('sets the target at 200% gross profit on allocated margin', () => {
    const margin = 0.5;
    const quantity = (margin * RULES.leverage) / 100;
    const longTarget = targetPrice('LONG', 100, margin, quantity, 0.01);
    const shortTarget = targetPrice('SHORT', 100, margin, quantity, 0.01);
    expect(grossAtPrice('LONG', 100, longTarget, quantity)).toBeGreaterThanOrEqual(2 * margin);
    expect(grossAtPrice('SHORT', 100, shortTarget, quantity)).toBeGreaterThanOrEqual(2 * margin);
  });

  it('uses the first correctly directed trade volume that fully reaches the target', () => {
    const long = firstTargetFill('LONG', 102, 1, 100, [
      { time: 101, price: 102, quantity: 5, isBuyerMaker: true },
      { time: 110, price: 102, quantity: 0.4, isBuyerMaker: false },
      { time: 120, price: 102, quantity: 0.6, isBuyerMaker: false },
    ]);
    const short = firstTargetFill('SHORT', 98, 1, 100, [
      { time: 101, price: 98, quantity: 5, isBuyerMaker: false },
      { time: 110, price: 98, quantity: 0.4, isBuyerMaker: true },
      { time: 120, price: 98, quantity: 0.6, isBuyerMaker: true },
    ]);
    expect(long?.time).toBe(120);
    expect(short?.time).toBe(120);
  });
});