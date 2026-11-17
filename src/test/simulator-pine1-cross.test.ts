import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { closePine1, openPine1, pine1Exit } from '@/lib/engine/pine1-cross';
import type { Signal } from '@/lib/engine/model';

const sig = (direction: 'LONG' | 'SHORT') => ({ trade_id: 'x', symbol: 'LINKUSDT', direction, entry_price: 100, stop_loss: 99, take_profit: 101,
  mtf_trend: { m15: 1, m5: 1, m1: 0 } }) as unknown as Signal;

describe('prompt-40 Simulator: 1m Pine, 50x, 20% margin, no stop, +25% target, cross margin', () => {
  it('uses 20% of balance at 50x', () => {
    const p = openPine1(sig('LONG'), 0, 0, 10);
    expect(Number(p.margin)).toBe(2);
    expect(Number(p.quantity) * 100).toBeCloseTo(100, 8);
  });
  it('take profit nets exactly +25% of margin after fees', () => {
    const p = openPine1(sig('LONG'), 0, 0, 10);
    const t = closePine1(p, 'TAKE_PROFIT', 60_000, 10);
    expect(Number(t.pnl)).toBeCloseTo(0.5, 8);
    const sp = openPine1(sig('SHORT'), 0, 0, 10);
    expect(Number(closePine1(sp, 'TAKE_PROFIT', 60_000, 10).pnl)).toBeCloseTo(0.5, 8);
  });
  it('has no stop loss: a 5% drop keeps the trade open; liquidation uses whole balance', () => {
    const p = openPine1(sig('LONG'), 0, 0, 10);
    expect(pine1Exit(p, { time: 60_000, open: 100, high: 100, low: 95, close: 96, volume: 1 })).toBeNull();
    expect(Number(p.liquidation)).toBeLessThan(91);
    const t = closePine1(p, 'LIQUIDATED', 60_000, 10);
    expect(new Decimal(t.balanceAfter).toNumber()).toBe(0);
  });
});
