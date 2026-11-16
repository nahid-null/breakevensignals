import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/robot/config';
import { portfolioGate, riskMarginCap } from '@/lib/robot/risk';
import { findFvg, findOrderBlock, lastSwing, SMC_WEIGHTS } from '@/lib/robot/smc';
import type { Bar } from '@/lib/robot/series';

const s = { ...DEFAULT_SETTINGS, enabled: true, emergency_stop: false };
const bar = (i: number, open: number, high: number, low: number, close: number): Bar => ({ time: i * 60_000, open, high, low, close, volume: 1 });
const at = Date.parse('2026-11-16T12:00:00Z');
const loss = (minAgo: number, pnl = -1) => ({ closedAt: at - minAgo * 60_000, pnl });

describe('SMC_V1 entry building blocks', () => {
  it('weights add to 100 with the user-specified points', () => {
    expect(SMC_WEIGHTS).toEqual({ sweep: 20, mss: 20, fvg: 15, order_block: 10, htf: 15, displacement: 10, premium_discount: 5, volume: 5 });
    expect(Object.values(SMC_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('finds a confirmed swing high and the mirrored swing low', () => {
    const b = [bar(0, 10, 10.2, 9.9, 10), bar(1, 10, 10.3, 9.9, 10.1), bar(2, 10.1, 10.8, 10, 10.5), bar(3, 10.5, 10.4, 9.8, 10), bar(4, 10, 10.1, 9.5, 9.7), bar(5, 9.7, 10, 9.6, 9.9), bar(6, 9.9, 10.1, 9.8, 10)];
    expect(lastSwing(b, b.length, 'high')).toEqual({ price: 10.8, index: 2 });
    expect(lastSwing(b, b.length, 'low')).toEqual({ price: 9.5, index: 4 });
  });
  it('keeps a bullish FVG until a close fills it, and mirrors it for SHORT', () => {
    const up = [bar(0, 10, 10.1, 9.9, 10), bar(1, 10, 10.6, 10, 10.6), bar(2, 10.6, 10.8, 10.3, 10.7), bar(3, 10.7, 10.8, 10.4, 10.5)];
    expect(findFvg(up, 0, 2, 1, 0.01)).toMatchObject({ kind: 'FVG', low: 10.1, high: 10.3 });
    expect(findFvg([...up, bar(4, 10.5, 10.5, 10, 10.05)], 0, 2, 1, 0.01)).toBeNull();
    const down = up.map((x) => ({ ...x, open: 20 - x.open, close: 20 - x.close, high: 20 - x.low, low: 20 - x.high }));
    const z = findFvg(down, 0, 2, -1, 0.01);
    expect(z?.low).toBeCloseTo(9.7, 9); expect(z?.high).toBeCloseTo(9.9, 9);
  });
  it('uses the last opposite candle before the structure break as the order block, and drops it once closed through', () => {
    const b = [bar(0, 10, 10.1, 9.9, 10.05), bar(1, 10.05, 10.1, 9.8, 9.85), bar(2, 9.85, 10.6, 9.85, 10.55), bar(3, 10.55, 10.7, 10.4, 10.6)];
    expect(findOrderBlock(b, 0, 2, 1)).toMatchObject({ kind: 'OB', low: 9.8, high: 10.1 });
    expect(findOrderBlock([...b, bar(4, 10.6, 10.6, 9.7, 9.75)], 0, 2, 1)).toBeNull();
  });
});

describe('SMC_V1 risk controls', () => {
  it('caps margin so a stop-out loses at most the configured % of balance', () => {
    const m = riskMarginCap(100, 100, 99.5, { ...s, risk_per_trade_pct: 0.5, fee_pct: 0, slippage_bps: 0 });
    expect(m * 50 * 0.005).toBeCloseTo(0.5, 9);
  });
  it('daily loss limit and loss-streak cooldown are OFF by default', () => {
    expect(DEFAULT_SETTINGS.daily_loss_limit_enabled).toBe(false);
    expect(DEFAULT_SETTINGS.loss_streak_enabled).toBe(false);
    expect(portfolioGate({ symbol: 'NEARUSDT', direction: 'LONG' }, [], 20, s, [loss(5, -5), loss(3), loss(1)], at)).toBeNull();
  });
  it('when switched on, a 3% day loss pauses new entries', () => {
    const on = { ...s, daily_loss_limit_enabled: true, daily_loss_limit_pct: 3 };
    expect(portfolioGate({ symbol: 'NEARUSDT', direction: 'LONG' }, [], 97, on, [loss(10, -3)], at)).toBe('Daily loss limit reached');
    expect(portfolioGate({ symbol: 'NEARUSDT', direction: 'LONG' }, [], 98, on, [loss(10, -2)], at)).toBeNull();
  });
  it('when switched on, 2 losses in a row pause entries for 60 minutes', () => {
    const on = { ...s, loss_streak_enabled: true, loss_streak_cooldown: 2, cooldown_minutes: 60 };
    expect(portfolioGate({ symbol: 'NEARUSDT', direction: 'LONG' }, [], 20, on, [loss(30), loss(10)], at)).toBe('Loss-streak cooldown');
    expect(portfolioGate({ symbol: 'NEARUSDT', direction: 'LONG' }, [], 20, on, [loss(90), loss(61)], at)).toBeNull();
  });
});
