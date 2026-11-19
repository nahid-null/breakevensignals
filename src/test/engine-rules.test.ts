import { describe, expect, it } from 'vitest';
import { SYMBOLS } from '@/lib/config';
import { ema, rma, confirmedPivot } from '@/lib/engine/calculations';
import { initialState, MINUTE, PARAMETERS as P, type Candle, type Trade } from '@/lib/engine/model';
import { manageTrade, processCandle, cooldownFinished } from '@/lib/engine/scalper';
import { commitSchema, eventSource, signalSchema } from '@/lib/engine/protocol';
import { winRate } from '@/lib/engine/stats';
import { breakevenTriggerPrice, lastSignalTime } from '@/lib/engine/position-values';
import { pineGt, pineLt, pineGe, pineLe } from '@/lib/engine/pine-numbers';

const candle = (index: number, close = 100): Candle => ({ time: index * MINUTE, open: close, high: close + 0.5, low: close - 0.5, close, volume: 100 });
const trade = (direction: 'LONG' | 'SHORT'): Trade => ({ id: 'native-NEARUSDT-test', direction, entry: 100,
  stop: direction === 'LONG' ? 99 : 101, originalStop: direction === 'LONG' ? 99 : 101,
  target: direction === 'LONG' ? 101.5 : 98.5, risk: 1, entryTime: 0, breakeven: false, breakevenTime: null });

describe('original Pine calculation rules', () => {
  it('keeps exactly the 6 approved contracts (prompt-56)', () => {
    expect([...SYMBOLS]).toEqual(['XRPUSDT','DOGEUSDT','LINKUSDT','NEARUSDT','BCHUSDT','LTCUSDT']);
  });
  it('uses source score 70 and 1:1.5 reward', () => {
    expect(P.scoreThreshold).toBe(70); expect(P.rrMultiplier).toBe(1.5);
  });
  it('seeds EMA from first close and Wilder RMA from SMA', () => {
    expect(ema(null, 10, 9)).toBe(10); expect(ema(10, 20, 9)).toBe(12);
    const avg = { value: null as number | null, seed: [] as number[] };
    expect(rma(avg, 1, 3)).toBeNull(); expect(rma(avg, 2, 3)).toBeNull();
    expect(rma(avg, 3, 3)).toBe(2); expect(rma(avg, 5, 3)).toBe(3);
  });
  it('waits for three right candles to confirm a pivot without lookahead', () => {
    const cs = [4,3,2,1,2,3,4].map((low, i) => ({ ...candle(i), low }));
    expect(confirmedPivot(cs.slice(0, 6), 'low')).toBeNull();
    expect(confirmedPivot(cs, 'low')).toBe(1);
    expect(confirmedPivot(cs.map((c, i) => ({ ...c, low: i === 5 ? 1 : c.low })), 'low')).toBeNull();
  });
  it('requires strictly more than five completed bars after exit', () => {
    expect(cooldownFinished(0, 5 * MINUTE)).toBe(false);
    expect(cooldownFinished(0, 6 * MINUTE)).toBe(true);
  });
  it('preserves Pine nine-fractional-digit float comparison without inventing RSI momentum on flat closes', () => {
    expect(pineLt(38.493122993105565, 38.49312299310558)).toBe(false);
    expect(pineGt(52.0000000001, 52)).toBe(false);
    expect(pineGt(52.000000001, 52)).toBe(true);
    expect(pineGe(100.0000000001, 100)).toBe(true);
    expect(pineLe(100.0000000001, 100)).toBe(true);
  });
  it('uses the available swing window once ATR has its SMA seed, not an extra startup filter', () => {
    const state = initialState('NEARUSDT', 0.001);
    for (let i = 0; i < 19; i++) {
      const result = processCandle(state, candle(i));
      if (i === 13) { expect(result.analysis?.longStop).toBeCloseTo(98.5, 12); expect(result.analysis?.shortStop).toBeCloseTo(101.5, 12); }
    }
    const result = processCandle(state, candle(19));
    expect(result.analysis?.longStop).toBeCloseTo(98.5, 12);
    expect(result.analysis?.shortStop).toBeCloseTo(101.5, 12);
  });
  for (const direction of ['LONG', 'SHORT'] as const) {
    it(`${direction}: stop wins when SL and TP are both touched`, () => {
      const s = initialState('NEARUSDT', 0.01); const side = direction === 'LONG' ? s.long : s.short;
      side.trade = trade(direction);
      const result = manageTrade(s, side, { ...candle(1), low: 98, high: 102 });
      expect(result?.event).toBe('stop_loss_hit');
      expect(result?.exit_price).toBe(direction === 'LONG' ? 99 : 101);
      expect(side.trade).toBeNull();
      expect(direction === 'LONG' ? s.short.performance.total : s.long.performance.total).toBe(0);
    });
    it(`${direction}: breakeven moves only once and applies on the next candle`, () => {
      const s = initialState('NEARUSDT', 0.01); const side = direction === 'LONG' ? s.long : s.short;
      side.trade = trade(direction);
      const activation = { ...candle(1), low: direction === 'LONG' ? 99.5 : 98.9, high: direction === 'LONG' ? 101.1 : 100.5 };
      expect(manageTrade(s, side, activation)?.event).toBe('breakeven_activated');
      expect(side.trade?.stop).toBe(100); expect(side.trade?.breakevenTime).toBe(MINUTE);
      const next = { ...candle(2), low: 99.9, high: 100.1 };
      const exit = manageTrade(s, side, next);
      expect(exit?.event).toBe('stop_loss_hit'); expect(exit?.exit_price).toBe(100);
      expect(exit?.net_result_r).toBeCloseTo(-0.1, 10);
      expect(side.performance.losses).toBe(1);
    });
    it(`${direction}: original target exits at 1.5R less 0.04% each-side fee and one tick per side`, () => {
      const s = initialState('NEARUSDT', 0.01); const side = direction === 'LONG' ? s.long : s.short;
      side.trade = trade(direction);
      const result = manageTrade(s, side, { ...candle(1), low: direction === 'LONG' ? 99.5 : 98.5, high: direction === 'LONG' ? 101.5 : 100.5 });
      expect(result?.event).toBe('take_profit_hit');
      expect(result?.net_result_r).toBeCloseTo(direction === 'LONG' ? 1.3994 : 1.4006, 10);
      expect(side.performance.wins).toBe(1);
    });
    it(`${direction}: full score, stop and target are produced from the same confirmed candle`, () => {
      const s = initialState('NEARUSDT', 0.001);
      for (let i = 0; i < 60; i++) processCandle(s, candle(i, 100 + Math.sin(i) * 0.2), false);
      const close = direction === 'LONG' ? 101 : 99;
      const c = { ...candle(60, close), open: 100, high: direction === 'LONG' ? 101.1 : 100.1,
        low: direction === 'LONG' ? 99.9 : 98.9, volume: 500 };
      const result = processCandle(s, c);
      const entry = result.signals.find((e) => e.direction === direction);
      expect(entry?.event).toBe('entry_confirmed');
      expect(direction === 'LONG' ? result.analysis?.longScore : result.analysis?.shortScore).toBe(100);
      expect(entry?.entry_price).toBe(close);
      const stop = direction === 'LONG' ? result.analysis?.longStop : result.analysis?.shortStop;
      expect(entry?.stop_loss).toBe(stop);
      if (!entry || stop === null || stop === undefined) throw new Error('Missing entry');
      expect(entry.take_profit).toBeCloseTo(close + (direction === 'LONG' ? 1 : -1) * Math.abs(close - stop) * 1.5, 12);
      expect(signalSchema.safeParse(entry).success).toBe(true);
    });
  }
  it('rejects candle gaps and invalid values, and ignores duplicate closed candles', () => {
    const s = initialState('NEARUSDT', 0.01); processCandle(s, candle(0));
    const before = structuredClone(s);
    expect(processCandle(s, candle(0)).duplicate).toBe(true); expect(s).toEqual(before);
    expect(() => processCandle(s, candle(2))).toThrow('Missing candles');
    expect(() => processCandle(s, { ...candle(1), close: Number.NaN })).toThrow('Invalid');
  });
  it('resumes serializable incremental state without indicator, event or trade drift', () => {
    const a = initialState('NEARUSDT', 0.001);
    for (let i = 0; i < 250; i++) processCandle(a, candle(i, 100 + Math.sin(i / 5) * 0.4));
    const b = JSON.parse(JSON.stringify(a));
    for (let i = 250; i < 400; i++) {
      expect(processCandle(a, candle(i, 100 + Math.sin(i / 5) * 0.4))).toEqual(processCandle(b, candle(i, 100 + Math.sin(i / 5) * 0.4)));
    }
    expect(a).toEqual(b);
  });
  it('validates checkpoint identity and explicitly labels historical adoption versus live processing', () => {
    const state = initialState('NEARUSDT', 0.01); processCandle(state, candle(0));
    const payload = { instance_id: '11111111-1111-4111-8111-111111111111', symbol: 'NEARUSDT', expected_revision: 0,
      checkpoint: state, market: { symbol: 'NEARUSDT', price: 100, trend: 'SIDEWAYS', status: 'LIVE', last_candle_at: new Date(MINUTE).toISOString(), long_score: 0, short_score: 0, error: null }, events: [], mode: 'live' };
    expect(commitSchema.safeParse(payload).success).toBe(true);
    expect(commitSchema.safeParse({ ...payload, symbol: 'LINKUSDT' }).success).toBe(false);
    expect(commitSchema.safeParse({ ...payload, checkpoint: { symbol: 'NEARUSDT' } }).success).toBe(false);
    expect(eventSource('warmup')).toBe('historical'); expect(eventSource('recovery')).toBe('recovery'); expect(eventSource('live')).toBe('native');
  });
  it('calculates win rate from every positive/negative net result and leaves an empty ledger undefined', () => {
    expect(winRate({ wins: 3, losses: 1 })).toBe(75); expect(winRate({ wins: 0, losses: 0 })).toBeNull();
  });
  it('shows the original 1R breakeven trigger separately from the moved stop', () => {
    expect(breakevenTriggerPrice({ direction: 'LONG', entry_price: 100, original_stop_loss: 99 })).toBe(101);
    expect(breakevenTriggerPrice({ direction: 'SHORT', entry_price: 100, original_stop_loss: 101 })).toBe(99);
  });
  it('uses actual signal time rather than historical record processing time', () => {
    expect(lastSignalTime({ entry_timestamp: '2026-11-15T12:00:00Z', breakeven_timestamp: '2026-11-15T12:03:00Z', exit_timestamp: '2026-11-15T12:04:00Z' })).toBe('2026-11-15T12:04:00Z');
  });
});