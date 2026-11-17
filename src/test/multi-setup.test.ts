import { describe, expect, it } from 'vitest';
import { MultiSetup } from '@/lib/engine/multi-setup';
import type { Candle } from '@/lib/engine/model';

/** Deterministic wavy candles so every setup detector gets exercised. */
function series(n: number, sign = 1): Candle[] {
  const out: Candle[] = []; let px = 100;
  for (let i = 0; i < n; i++) { const o = px; px = 100 + 3 * Math.sin(i / 37) + 1.2 * Math.sin(i / 7) + 0.3 * Math.sin(i * 1.7);
    const hi = Math.max(o, px) + 0.15 + 0.1 * Math.abs(Math.sin(i)); const lo = Math.min(o, px) - 0.15 - 0.1 * Math.abs(Math.cos(i));
    out.push(sign === 1 ? { time: i * 60_000, open: o, high: hi, low: lo, close: px, volume: 100 + 50 * Math.abs(Math.sin(i / 3)) }
      : { time: i * 60_000, open: 200 - o, high: 200 - lo, low: 200 - hi, close: 200 - px, volume: 100 + 50 * Math.abs(Math.sin(i / 3)) }); }
  return out;
}

describe('multi-setup research finder', () => {
  it('never scores outside 0-100', () => {
    const m = new MultiSetup(0.001);
    for (const c of series(6000)) for (const r of m.step(c)) if (r && typeof r !== 'string') { expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100); }
  });
  it('SHORT rules are the exact mirror of LONG rules', () => {
    const up = new MultiSetup(0.001); const down = new MultiSetup(0.001);
    const a = series(6000).map((c) => up.step(c)[0]); const b = series(6000, -1).map((c) => down.step(c)[1]);
    const norm = (r: unknown) => r && typeof r === 'object' ? { ...(r as object), side: 'X', entry: 0 } : r;
    expect(a.filter((r) => r && typeof r === 'object').length).toBeGreaterThan(0);
    expect(a.map(norm)).toEqual(b.map(norm));
  });
});
