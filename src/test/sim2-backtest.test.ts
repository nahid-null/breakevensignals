import { describe, expect, it } from 'vitest';
import { sim2Signal, sim2Levels, type Candle } from '@/lib/engine/sim2-backtest';

const flat = (n: number, start: number, step: number): Candle[] => Array.from({ length: n }, (_, i) => {
  const o = start + i * step, c = o + step; return { time: i * 60000, open: o, high: Math.max(o, c) + 0.01, low: Math.min(o, c) - 0.01, close: c };
});
const breakout = (c: Candle[], up: boolean): Candle[] => {
  const p = c[c.length - 1]!, o = p.close, cl = up ? p.high + 0.5 : p.low - 0.5;
  return [...c, { time: p.time + 60000, open: o, close: cl, high: Math.max(o, cl) + 0.05, low: Math.min(o, cl) - 0.05 }];
};
const loose = { trend: false, realistic: false }, trend = { trend: true, realistic: false };

describe('Simulator 2 Training 3 filters', () => {
  it('takes LONG breakout only in an uptrend (close above rising 20-close average)', () => {
    const up = breakout(flat(25, 100, 0.1), true);
    expect(sim2Signal(up, up.length - 1, 0.01, 5, trend).dir).toBe('LONG');
    const down = breakout(flat(25, 110, -0.1), true);
    expect(sim2Signal(down, down.length - 1, 0.01, 5, loose).dir).toBe('LONG');
    expect(sim2Signal(down, down.length - 1, 0.01, 5, trend)).toEqual({ dir: null, skip: 'trend' });
  });
  it('takes SHORT breakout only in a downtrend', () => {
    const down = breakout(flat(25, 110, -0.1), false);
    expect(sim2Signal(down, down.length - 1, 0.01, 5, trend).dir).toBe('SHORT');
    const up = breakout(flat(25, 100, 0.1), false);
    expect(sim2Signal(up, up.length - 1, 0.01, 5, trend)).toEqual({ dir: null, skip: 'trend' });
  });
  it('skips when the last 5 candle ranges average below the move the +10% net target needs', () => {
    const c = breakout(flat(25, 1000, 0.01), true);
    expect(sim2Signal(c, c.length - 1, 0.01, 5, { trend: false, realistic: true })).toEqual({ dir: null, skip: 'range' });
  });
  it('+10% balance target needs about 0.35% price move at 50x with 80% margin', () => {
    const l = sim2Levels(5, 100, 1, 0.0001);
    expect((l.tp - 100) / 100).toBeGreaterThan(0.0034);
    expect((l.tp - 100) / 100).toBeLessThan(0.0036);
  });
});

describe('Simulator 2 holding period', () => {
  it('stays open up to 5 candles, exits at TP when reached, and never loses more than 5% of margin', async () => {
    const { sim2Settle, sim2Levels } = await import('@/lib/engine/sim2-backtest');
    const L = sim2Levels(5, 100, 1, 0.0001, 0.2, 'margin', 20);
    const bar = (t: number, lo: number, hi: number, cl: number): Candle => ({ time: t, open: 100, low: lo, high: hi, close: cl });
    const tp = sim2Settle(5, [bar(0, 99.99, 100.1, 100.05), bar(1, 100, 100.2, 100.1), bar(2, 100, L.tp + 0.01, L.tp)], 'LONG', 0.0001, 0.2, 'margin', 20)!;
    expect(tp.reason).toBe('TAKE_PROFIT'); expect(tp.held).toBe(3); expect(tp.pnl).toBeCloseTo(0.10, 6);
    const sl = sim2Settle(5, [bar(0, 99.99, 100.01, 100), bar(1, L.sl - 1, 100, 99)], 'LONG', 0.0001, 0.2, 'margin', 20)!;
    expect(sl.reason).toBe('STOP_LOSS'); expect(sl.pnl).toBeCloseTo(-0.05, 6);
    const time = sim2Settle(5, Array.from({ length: 5 }, (_, i) => bar(i, 99.99, 100.02, 100.01)), 'LONG', 0.0001, 0.2, 'margin', 20)!;
    expect(time.reason).toBe('TIME_EXIT'); expect(time.held).toBe(5);
  });
});
