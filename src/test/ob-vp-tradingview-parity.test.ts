import { describe, expect, it } from 'vitest';
import { initialObvp, processObvp } from '@/lib/engine/ob-vp';
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
