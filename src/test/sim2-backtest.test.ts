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
