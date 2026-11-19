import { describe, expect, it } from 'vitest';
import { initialObvp, processObvp, type SimulatorEntry } from '@/lib/engine/ob-vp';
import { advanceObvp } from '@/lib/engine/five-minute';
import { initialState } from '@/lib/engine/model';
import fixture from './fixtures/binance-spot-uniusdt-5m.json';

// prompt-52: the user's TradingView screenshot (UNI / TetherUS · 5 · Binance = SPOT chart, 19 Nov 2026, Dhaka time)
// shows these four indicator signals. Running the ported indicator on the same Binance SPOT 5m candles must reproduce them.
const r3 = (n: number) => Math.round(n * 1000) / 1000;
describe('OB + Weighted VP port vs TradingView screenshot (same Binance spot candles)', () => {
  const s = initialObvp(); const got: { side: string; entry: number; score: number; risk: number; reward: number }[] = [];
  for (const [time, open, high, low, close, volume] of fixture.candles as number[][])
    for (const x of processObvp(s, { time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume! }))
      if (time! >= Date.UTC(2026, 10, 18, 15)) got.push({ side: x.direction, entry: x.entry, score: x.score, risk: r3(Math.abs(x.entry - x.stopLoss)), reward: r3(Math.abs(x.takeProfit - x.entry)) });
  it('LONG ENTRY PRICE 5.114 and SHORT ENTRY PRICE 5.204', () => {
    expect(got[0]).toMatchObject({ side: 'LONG', entry: 5.114 });
    expect(got[1]).toMatchObject({ side: 'SHORT', entry: 5.204 });
  });
  it('★ SHORT Score 5/6, Risk 0.030, Reward 0.150, entry 5.155', () => {
    expect(got[2]).toEqual({ side: 'SHORT', entry: 5.155, score: 5, risk: 0.03, reward: 0.15 });
  });
  it('★ SHORT Score 4/6, Risk 0.048, Reward 0.193, entry 5.167', () => {
    expect(got[3]).toEqual({ side: 'SHORT', entry: 5.167, score: 4, risk: 0.048, reward: 0.193 });
  });
});

describe('worker path: indicator fed from spot bars via advanceObvp after each futures 5-minute close', () => {
  const bars = (fixture.candles as number[][]).map(([time, open, high, low, close, volume]) => ({ time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume! }));
  const from = Date.UTC(2026, 10, 18, 15);
  const run = (skip?: number) => {
    // Same warm-up depth as the worker: the latest 1000 spot bars before the start.
    const state = initialState('UNIUSDT' as never, 0.001); state.obvp = initialObvp();
    const before = bars.filter((b) => b.time < from).slice(-1000); for (const b of before) processObvp(state.obvp, b);
    const out: SimulatorEntry[] = [];
    for (const b of bars.filter((x) => x.time >= from)) {
      if (b.time === skip) continue; // spot fetch failed for this close
      out.push(...advanceObvp(state, bars.filter((x) => x.time <= b.time), b.time).entries);
    }
    return out;
  };
  it('with 1000 warm-up bars it still gives exactly the four TradingView entries, at spot prices', () => {
    expect(run().map((e) => [e.direction, e.entry_price, e.timeframe])).toEqual([['LONG', 5.114, '5'], ['SHORT', 5.204, '5'], ['SHORT', 5.155, '5'], ['SHORT', 5.167, '5']]);
  });
  it('a signal bar whose spot fetch failed is caught up later but never traded late', () => {
    const signalBar = run()[2]!; const t = Date.parse(signalBar.signal_time) - 5 * 60_000;
    expect(run(t).map((e) => e.entry_price)).toEqual([5.114, 5.204, 5.167]);
  });
});
