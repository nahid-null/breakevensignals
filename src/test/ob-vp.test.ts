import { describe, expect, it } from 'vitest';
import { initialObvp, processObvp, toSimulatorEntry, OBVP, type ObvpSignal } from '@/lib/engine/ob-vp';
import { simulatorEntrySchema } from '@/lib/engine/protocol';
import type { Candle } from '@/lib/engine/model';

const FIVE = 300_000;
const flat = (i: number): Candle => ({ time: i * FIVE, open: 100, close: i % 2 ? 99.9 : 100.1, high: 100.3, low: 99.7, volume: 1 });
/** Swing high at bar 30, a red dip at 35 (the order block), break of structure at 42, bullish rejection retest at 43. */
function bullishStory(): Candle[] {
  const bars = Array.from({ length: 45 }, (_, i) => flat(i));
  bars[30] = { ...bars[30]!, high: 101 };
  bars[35] = { time: 35 * FIVE, open: 100, close: 99.5, high: 100, low: 99.2, volume: 1 };
  bars[42] = { time: 42 * FIVE, open: 100, close: 101.2, high: 101.3, low: 99.9, volume: 10 };
  bars[43] = { time: 43 * FIVE, open: 100.2, close: 100.4, high: 100.45, low: 99.9, volume: 1 };
  bars[44] = { ...bars[43]!, time: 44 * FIVE };
  return bars;
}
const run = (bars: Candle[]) => { const s = initialObvp(); const out: ObvpSignal[][] = bars.map((b) => processObvp(s, b)); return { s, out }; };

describe('prompt-51 OB + Weighted VP 5m indicator (default inputs)', () => {
  it('uses the indicator defaults', () => {
    expect(OBVP.swingLen).toBe(10); expect(OBVP.maxZones).toBe(8); expect(OBVP.slBuf).toBe(0.2); expect(OBVP.minScore).toBe(0);
  });
  it('break of structure creates a bullish order block; the retest candle gives LONG at its close', () => {
    const { out } = run(bullishStory());
    expect(out.slice(0, 43).flat()).toHaveLength(0);
    const sig = out[43]!;
    expect(sig).toHaveLength(1);
    expect(sig[0]!.direction).toBe('LONG');
    expect(sig[0]!.entry).toBe(100.4);
    expect(sig[0]!.stopLoss).toBeLessThan(99.2);
    expect(sig[0]!.takeProfit).toBeCloseTo(100.4 + (100.4 - sig[0]!.stopLoss) * sig[0]!.rr, 10);
  });
  it('one signal per zone: the same retest again gives nothing', () => {
    expect(run(bullishStory()).out[44]).toHaveLength(0);
  });
  it('a close below the zone removes it, so a later retest gives nothing', () => {
    const bars = bullishStory();
    bars[43] = { time: 43 * FIVE, open: 99.3, close: 99.0, high: 99.4, low: 98.9, volume: 1 };
    bars[44] = { time: 44 * FIVE, open: 100.2, close: 100.4, high: 100.45, low: 99.9, volume: 1 };
    const { out } = run(bars);
    expect(out[44]!.filter((x) => x.direction === 'LONG')).toHaveLength(0);
  });
  it('a retest without a bullish trigger candle (red close) gives no LONG', () => {
    const bars = bullishStory();
    bars[43] = { time: 43 * FIVE, open: 100.4, close: 100.2, high: 100.45, low: 99.9, volume: 1 };
    expect(run(bars).out[43]!.filter((x) => x.direction === 'LONG')).toHaveLength(0);
  });
  it('the Simulator entry keeps the exact side and entry price and passes the engine API check', () => {
    const sig = run(bullishStory()).out[43]![0]!;
    const e = toSimulatorEntry('NEARUSDT', sig);
    expect(simulatorEntrySchema.parse(e)).toMatchObject({ direction: 'LONG', entry_price: 100.4, timeframe: '5' });
    expect(e.signal_time).toBe(new Date(44 * FIVE).toISOString());
  });
});
