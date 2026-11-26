import { describe, expect, it } from 'vitest';
import { sliceCausalBars } from '@/lib/forex/ai-prompt';
import { tradeMoney, canOpen } from '@/lib/forex/binary-account';
import data from '@/lib/forex/data/backtest-80-ai.json';

describe('AI Forex decisions and account audit', () => {
  it('uses only fully closed past candles for AI decisions, not future expiry candles', () => {
    const bars = Array.from({ length: 40 }, (_, i) => ({ t: i * 60, o: 100, h: 101, l: 99, c: 100 + i }));
    const result = sliceCausalBars(bars, bars, 600);
    expect(result.m1.at(-1)?.t).toBe(540);
    expect(result.m3.at(-1)?.t).toBe(420);
    expect(result.m1.some(b => b.t >= 600)).toBe(false);
  });
  it('audits every AI trade with the unchanged $1 stake and 1-minute expiry', () => {
    let cents = 1000;
    for (const trade of data.trades) {
      expect(trade.stake).toBe(1);
      expect(Date.parse(trade.expiry_time) - Date.parse(trade.entry_time)).toBe(60000);
      if (trade.result === 'SKIPPED') expect(canOpen(cents)).toBe(false);
      else if (trade.result === 'WIN' || trade.result === 'LOSS' || trade.result === 'DRAW') {
        expect(canOpen(cents)).toBe(true);
        const money = tradeMoney(trade.result);
        expect(trade.fee).toBe(money.feeC / 100);
        cents += money.netC;
      }
      expect(trade.balance_after).toBe(cents / 100);
    }
    expect(cents).toBe(47);
    expect(data.overall.net).toBe(-9.53);
  });
  it('preserves seven calendar days and distinguishes funded trades from hypothetical calls', () => {
    expect(data.days.length).toBe(7);
    expect(data.overall.total).toBe(29);
    expect(data.overall.wins).toBe(11);
    expect(data.overall.losses).toBe(18);
    expect(data.overall.skipped).toBe(35);
    expect(data.overall.ai_passed + data.overall.signals).toBe(230);
  });
});