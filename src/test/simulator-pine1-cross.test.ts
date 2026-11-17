import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { closePine1, openPine1, pine1Exit, pine1Skip, PINE1 } from '@/lib/engine/pine1-cross';
import type { Signal } from '@/lib/engine/model';

const sig = (direction: 'LONG' | 'SHORT', symbol = 'LINKUSDT', trend = { m15: 1, m5: 1, m1: 0 }) => ({ trade_id: 'x', symbol, direction, entry_price: 100, stop_loss: 99, take_profit: 101,
  mtf_trend: trend }) as unknown as Signal;
const bar = (time: number, low: number, high: number, close: number) => ({ time, open: 100, high, low, close, volume: 1 });

describe('prompt-43 Simulator: 1m Pine + trend, 2 slots x 10%, 50x, no stop, +25% target, 1h close', () => {
  it('uses 10% of balance per slot at 50x', () => {
    const p = openPine1(sig('LONG'), 0, 0, 10);
    expect(Number(p.margin)).toBe(1);
    expect(Number(p.quantity) * 100).toBeCloseTo(50, 8);
    expect(PINE1.leverage).toBe(50);
  });
  it('take profit nets exactly +25% of margin after fees', () => {
    const p = openPine1(sig('LONG'), 0, 0, 10);
    expect(Number(closePine1(p, 'TAKE_PROFIT', 60_000, 10).pnl)).toBeCloseTo(0.25, 8);
    const sp = openPine1(sig('SHORT'), 0, 0, 10);
    expect(Number(closePine1(sp, 'TAKE_PROFIT', 60_000, 10).pnl)).toBeCloseTo(0.25, 8);
  });
  it('has no stop loss: a 5% drop keeps the trade open', () => {
    const p = openPine1(sig('LONG'), 0, 0, 10);
    expect(pine1Exit(p, bar(60_000, 95, 100, 96))).toBeNull();
  });
  it('closes at market after 1 hour, not before', () => {
    const p = openPine1(sig('LONG'), 0, 0, 10);
    expect(pine1Exit(p, bar(58 * 60_000, 99, 100.1, 100))).toBeNull();
    expect(pine1Exit(p, bar(59 * 60_000, 99, 100.1, 100))).toBe('TIME_EXIT');
  });
  it('allows 2 slots, never the same coin twice', () => {
    const open = openPine1(sig('LONG'), 0, 0, 10);
    expect(pine1Skip(sig('LONG', 'XRPUSDT'), 10, [open])).toBeNull();
    expect(pine1Skip(sig('LONG'), 10, [open])).toBe('COIN_ALREADY_OPEN');
    const second = openPine1(sig('LONG', 'XRPUSDT'), 0, 0, 10);
    expect(pine1Skip(sig('LONG', 'SUIUSDT'), 10, [open, second])).toBe('BOTH_SLOTS_IN_USE');
  });
  it('needs 15m and 5m on the signal side, 1m sideways or same', () => {
    expect(pine1Skip(sig('LONG', 'A', { m15: 1, m5: 1, m1: 1 }), 10, [])).toBeNull();
    expect(pine1Skip(sig('LONG', 'A', { m15: 1, m5: -1, m1: 0 }), 10, [])).not.toBeNull();
    expect(pine1Skip(sig('LONG', 'A', { m15: 1, m5: 1, m1: -1 }), 10, [])).not.toBeNull();
    expect(pine1Skip(sig('SHORT', 'A', { m15: 1, m5: 1, m1: 0 }), 10, [])).not.toBeNull();
    expect(pine1Skip(sig('SHORT', 'A', { m15: -1, m5: -1, m1: 0 }), 10, [])).toBeNull();
  });
});
