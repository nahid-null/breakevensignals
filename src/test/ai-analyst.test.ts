import { describe, expect, it } from 'vitest';
import { MINUTE } from '@/lib/engine/model';
import { AA, aggregate, buildSeries, lastIdx, prepare, run, type Bar, type Decision, type Plan } from '@/lib/engine/ai-analyst';

const T0 = Date.UTC(2026, 9, 1);
const bar = (i: number, p: Partial<Bar> = {}): Bar => ({ time: T0 + i * MINUTE, open: 100, high: 100.05, low: 99.95, close: 100, volume: 10, takerBuy: 5, ...p });
const ctxOf = (m1: Bar[]) => prepare({ symbol: 'XUSDT', tick: 0.01, step: 0.001, minNotional: 5, m1, mark: new Map(), depth: new Map(), oi: new Map(), funding: new Map() });
const ENTRY_T = T0 + 200 * MINUTE;
const plan: Plan = { symbol: 'XUSDT', side: 'LONG', T: ENTRY_T, score: 7, available: 10, refPrice: 100, tp: 102, invalidation: 99.3, emergency: 99, etaMin: 60, rr: 1.96, evidence: [], missing: [], context: '' };
const once = (_c: unknown, _b: unknown, T: number, side: string): Decision => (T === ENTRY_T && side === 'LONG' ? { ok: true, plan } : { ok: false, gate: 'TEST' });
const opts = { from: ENTRY_T, to: ENTRY_T + 5 * MINUTE, end: T0 + 400 * MINUTE, profile: 'standard' as const, startBalance: 1000 };

describe('prompt-50 AI analyst research engine', () => {
  it('reads only bars that have closed at decision time (no look-ahead)', () => {
    const m1 = Array.from({ length: 60 }, (_, i) => bar(i, { close: 100 + i }));
    const s15 = buildSeries(m1, 15);
    expect(s15.bars[lastIdx(s15, T0 + 29 * MINUTE)]!.time).toBe(T0);
    expect(s15.bars[lastIdx(s15, T0 + 30 * MINUTE)]!.time).toBe(T0 + 15 * MINUTE);
    expect(aggregate(m1, 15)[0]!.close).toBe(114);
  });

  it('caps the emergency loss at 0.5% of equity including fees and slippage', () => {
    const m1 = Array.from({ length: 400 }, (_, i) => bar(i));
    m1[203] = bar(203, { high: 100.1, low: 98.5, close: 99 });
    const r = run([ctxOf(m1)], null, opts, once);
    const t = r.trades[0]!;
    expect(t.exitReason).toBe('EMERGENCY_EXIT');
    expect(t.exitPrice).toBeCloseTo(99 * (1 - AA.exitSlip), 9);
    expect(t.pnl).toBeLessThan(0);
    expect(-t.pnl).toBeLessThanOrEqual(1000 * 0.005);
    expect(t.emergency).toBeGreaterThan(t.liqPrice);
  });

  it('assumes the emergency level fills first when TP and emergency are in the same candle', () => {
    const m1 = Array.from({ length: 400 }, (_, i) => bar(i));
    m1[203] = bar(203, { high: 102.5, low: 98.5 });
    expect(run([ctxOf(m1)], null, opts, once).trades[0]!.exitReason).toBe('EMERGENCY_EXIT');
  });

  it('exits on a closed 15m candle beyond the invalidation level, not on a wick or a timer', () => {
    const m1 = Array.from({ length: 400 }, (_, i) => bar(i));
    m1[202] = bar(202, { low: 99.1, close: 100 }); // wick below invalidation, closes back: no exit
    m1[209] = bar(209, { low: 99.15, close: 99.2 }); // the 15m bar 195-209 closes 99.2 < 99.3
    const t = run([ctxOf(m1)], null, opts, once).trades[0]!;
    expect(t.exitReason).toBe('THESIS_INVALID');
    expect(t.exitTime).toBe(T0 + 210 * MINUTE);
  });

  it('keeps a valid losing-but-intact trade open with no time limit', () => {
    const m1 = Array.from({ length: 400 }, (_, i) => bar(i, { close: 99.9, low: 99.85 }));
    const t = run([ctxOf(m1)], null, opts, once).trades[0]!;
    expect(t.exitReason).toBe('UNRESOLVED');
  });
});
