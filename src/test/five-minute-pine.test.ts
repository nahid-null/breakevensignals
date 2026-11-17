import { describe, expect, it } from 'vitest';
import { aggregateFive, buildFive, fiveEngine, processMinute } from '@/lib/engine/five-minute';
import { processCandle } from '@/lib/engine/scalper';
import { initialState, MINUTE, FIVE_MINUTES, type Candle } from '@/lib/engine/model';
import { PINE5, closePine5, openPine5, receiptStatus } from '@/lib/engine/pine5-sim';
import type { Signal } from '@/lib/engine/model';

const T0 = Date.parse('2026-11-01T00:00:00Z');
function minutes(n: number, from = T0): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + 3 * Math.sin(i / 37) + 1.5 * Math.sin(i / 11) + i * 0.002;
    const open = base; const close = base + 0.25 * Math.sin(i / 3);
    return { time: from + i * MINUTE, open, close, high: Math.max(open, close) + 0.08, low: Math.min(open, close) - 0.08, volume: 10 + 6 * Math.abs(Math.sin(i / 5)) };
  });
}
const fives = (m: Candle[]) => Array.from({ length: Math.floor(m.length / 5) }, (_, i) => aggregateFive(m.slice(i * 5, i * 5 + 5)));

describe('original Pine on 5-minute bars', () => {
  it('builds a 5-minute bar from five closed 1-minute candles', () => {
    const b = aggregateFive(minutes(5));
    const m = minutes(5);
    expect(b.time).toBe(T0); expect(b.open).toBe(m[0]!.open); expect(b.close).toBe(m[4]!.close);
    expect(b.high).toBe(Math.max(...m.map((x) => x.high))); expect(b.volume).toBeCloseTo(m.reduce((a, x) => a + x.volume, 0));
  });
  it('the live 1-minute path gives exactly the same Pine signals as running Pine on the 5-minute chart', () => {
    const all = minutes(5 * 2400);
    const warm = all.slice(0, 5 * 300); const live = all.slice(5 * 300);
    const direct = fiveEngine('NEARUSDT', 0.001); const expected: Signal[] = [];
    for (const c of fives(all)) { const r = processCandle(direct, c); if (c.time >= live[0]!.time) expected.push(...r.signals); }
    const state = initialState('NEARUSDT', 0.001);
    state.five = buildFive('NEARUSDT', 0.001, warm.at(-1)!.time, fives(warm), []).five;
    const got: Signal[] = [];
    for (const c of live) got.push(...processMinute(state, c).signals.filter((s) => s.timeframe === '5'));
    expect(got.length).toBeGreaterThan(0);
    expect(got.map(({ mtf_trend: _m, ...s }) => s)).toEqual(expected);
  });
  it('labels 5-minute signals with their own trade ids and the bar close time', () => {
    const all = minutes(5 * 2400); const direct = fiveEngine('NEARUSDT', 0.001);
    const entry = fives(all).flatMap((c) => processCandle(direct, c).signals).find((s) => s.event === 'entry_confirmed')!;
    expect(entry.timeframe).toBe('5'); expect(entry.trade_id.startsWith('native5m-NEARUSDT-')).toBe(true);
    expect(Date.parse(entry.timestamp) % FIVE_MINUTES).toBe(0);
  });
  it('the one-minute engine no longer opens Pine entries', () => {
    const state = initialState('NEARUSDT', 0.001);
    const out = minutes(3000).flatMap((c) => processMinute(state, c).signals);
    expect(out.filter((s) => s.event === 'entry_confirmed')).toHaveLength(0);
  });
  it('resumes mid-bar from saved 1-minute candles', () => {
    const all = minutes(5 * 400 + 3);
    const built = buildFive('NEARUSDT', 0.001, all.at(-1)!.time, fives(all.slice(0, 5 * 400)), all.slice(5 * 400));
    expect(built.five.bucket).toHaveLength(3);
    expect(() => buildFive('NEARUSDT', 0.001, all.at(-1)!.time, fives(all.slice(0, 5 * 400)), all.slice(5 * 400 + 1))).toThrow(/incomplete/);
  });
});

describe('prompt-39 practice money', () => {
  const e = { trade_id: 'x', symbol: 'NEARUSDT', direction: 'LONG', entry_price: 100, stop_loss: 99, take_profit: 101.5 } as Signal;
  it('uses 25x and half of the balance', () => {
    const p = openPine5(e, 0, 0.01, 10);
    expect(PINE5.leverage).toBe(25); expect(Number(p.margin)).toBe(5); expect(Number(p.quantity)).toBe(1.25);
    expect(Number(p.liquidation)).toBe(96.5); expect(Number(p.entryFee)).toBe(0.0625);
  });
  it('take profit pays the indicator target minus fees and slippage', () => {
    const t = closePine5(openPine5(e, 0, 0.01, 10), 101.5, 'TAKE_PROFIT', 1, 10);
    // 1.25 * 1.5 - 2*1.25*0.01 - 0.0625 - 1.25*101.5*0.0005
    expect(Number(t.pnl)).toBeCloseTo(1.875 - 0.025 - 0.0625 - 0.0634375, 10);
  });
  it('receipts say only Take profit hit or Stop loss hit', () => {
    expect(receiptStatus('TAKE_PROFIT')).toBe('Take profit hit');
    for (const r of ['STOP_LOSS', 'BREAKEVEN', 'LIQUIDATED']) expect(receiptStatus(r)).toBe('Stop loss hit');
  });
});
