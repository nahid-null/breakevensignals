import { describe, expect, it } from 'vitest';
import { alignment, closeBar, emptyTimeframe, initMtf, updateMtf, type MtfState } from '@/lib/engine/mtf-trend';
import { initialState, MINUTE, type Candle } from '@/lib/engine/model';
import { processCandle } from '@/lib/engine/scalper';
import { formatSignalMessage } from '@/lib/telegram-format';

const minute = (i: number, close: number): Candle => ({ time: i * MINUTE, open: close, high: close * 1.0005, low: close * 0.9995, close, volume: 10 });
const aggregate = (cs: Candle[], size: number): Candle[] => {
  const out: Candle[] = [];
  for (let i = 0; i + size <= cs.length; i += size) {
    const g = cs.slice(i, i + size);
    out.push({ time: g[0]!.time, open: g[0]!.open, high: Math.max(...g.map((c) => c.high)), low: Math.min(...g.map((c) => c.low)), close: g.at(-1)!.close, volume: g.reduce((a, c) => a + c.volume, 0) });
  }
  return out;
};
const fixed = (m15: 1 | -1 | 0, m5: 1 | -1 | 0, m1: 1 | -1 | 0): MtfState => {
  const t = (v: 1 | -1 | 0, minutes: number) => ({ ...emptyTimeframe(minutes), trend: v });
  return { m15: t(m15, 15), m5: t(m5, 5), m1: t(m1, 1) };
};

describe('15M/5M/1M trend filter', () => {
  it('only all three BULLISH is bullish, all three BEARISH is bearish, anything else is mixed', () => {
    expect(alignment({ m15: 1, m5: 1, m1: 1 })).toBe(1);
    expect(alignment({ m15: -1, m5: -1, m1: -1 })).toBe(-1);
    expect(alignment({ m15: 1, m5: -1, m1: 1 })).toBe(0);
    expect(alignment({ m15: 1, m5: 1, m1: 0 })).toBe(0);
    expect(alignment({ m15: 1, m5: 1, m1: null })).toBe(0);
  });

  it('detects a steady uptrend as BULLISH and a downtrend as BEARISH', () => {
    const up = emptyTimeframe(1); const down = emptyTimeframe(1);
    let u = 0, d = 0;
    for (let i = 0; i < 300; i++) {
      const wave = Math.sin(i / 3) * 0.3;
      u = closeBar(up, { time: i * MINUTE, open: 100 + i * 0.1, high: 100 + i * 0.1 + 0.4 + wave, low: 100 + i * 0.1 - 0.4 + wave, close: 100 + i * 0.1 + wave, volume: 1 });
      d = closeBar(down, { time: i * MINUTE, open: 200 - i * 0.1, high: 200 - i * 0.1 + 0.4 + wave, low: 200 - i * 0.1 - 0.4 + wave, close: 200 - i * 0.1 + wave, volume: 1 });
    }
    expect(u).toBe(1); expect(d).toBe(-1);
  });

  it('builds 5M/15M bars from 1M candles exactly like closed higher-timeframe candles', () => {
    const cs = Array.from({ length: 3000 }, (_, i) => minute(i, 100 + Math.sin(i / 40) * 3 + i * 0.001));
    const live = initMtf(-MINUTE, [], [], []);
    for (const c of cs.slice(0, 2003)) updateMtf(live, c);
    const restored = initMtf(cs[2002]!.time, cs.slice(0, 2003), aggregate(cs, 5), aggregate(cs, 15));
    expect(restored).toEqual(live);
  });

  it('does not gate original Pine LONG or SHORT entries on legacy MTF trends', () => {
    const entries = (direction: 'LONG' | 'SHORT', mtf: MtfState | undefined) => {
      const s = initialState('NEARUSDT', 0.001);
      const flat = (i: number): Candle => { const close = 100 + Math.sin(i) * 0.2; return { time: i * MINUTE, open: close, high: close + 0.5, low: close - 0.5, close, volume: 100 }; };
      for (let i = 0; i < 60; i++) processCandle(s, flat(i), false);
      if (mtf) s.mtf = structuredClone(mtf);
      const close = direction === 'LONG' ? 101 : 99;
      const c = { time: 60 * MINUTE, open: 100, close, high: direction === 'LONG' ? 101.1 : 100.1, low: direction === 'LONG' ? 99.9 : 98.9, volume: 500 };
      return processCandle(s, c).signals.filter((x) => x.event === 'entry_confirmed');
    };
    for (const direction of ['LONG', 'SHORT'] as const) {
      const v = direction === 'LONG' ? 1 : -1;
      expect(entries(direction, undefined)).toHaveLength(1); // original scalper setup exists
      expect(entries(direction, fixed(1, -1, 1))).toHaveLength(1);
      expect(entries(direction, fixed(-1, 1, -1))).toHaveLength(1);
      expect(entries(direction, fixed(0, 0, 0))).toHaveLength(1);
      expect(entries(direction, fixed(-v as 1 | -1, -v as 1 | -1, -v as 1 | -1))).toHaveLength(1);
      const ok = entries(direction, fixed(v, v, v));
      expect(ok).toHaveLength(1);
      expect(ok[0]?.direction).toBe(direction);
      expect(ok[0]?.trend_aligned).toBeUndefined();
      expect(ok[0]?.mtf_trend).toBeDefined(); // prompt-40: reading attached for the Simulator gate, entry itself not gated
    }
  });

  it('labels entries NORMAL SIGNAL and breakeven BREAKEVEN with the approving trend', () => {
    const base = { symbol: 'NEARUSDT', direction: 'LONG' as const, timeframe: '1', entry_price: 1, stop_loss: 0.9, take_profit: 1.15,
      fee_rate_percent: 0.04, indicator: 'PRO LONG SCALPER', timestamp: '2026-11-16T10:00:00.000Z', mtf_trend: { m15: 1, m5: 1, m1: 1 } };
    const entry = formatSignalMessage({ ...base, event: 'entry_confirmed' });
    expect(entry).toContain('LONG NORMAL SIGNAL');
    expect(entry).toContain('15M BULLISH | 5M BULLISH | 1M BULLISH');
    expect(formatSignalMessage({ ...base, event: 'breakeven_activated' })).toContain('BREAKEVEN ACTIVATED');
  });
});
