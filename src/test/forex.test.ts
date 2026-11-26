import { describe, expect, it } from 'vitest';
import { FX_RULES, balanceAfter, canOpen, settle, tradeMoney } from '@/lib/forex/binary-account';
import { forexOpen, toM3 } from '@/lib/forex/candles';
import { runCpes } from '@/lib/forex/cpes';
import data from '@/lib/forex/data/backtest-78.json';

describe('Forex Simulator rules (prompt-78)', () => {
  it('trades only AUD/JPY on M3 signals with 1-minute expiry, $10 start and $1 fixed stake', () => {
    expect(FX_RULES.pair).toBe('AUD/JPY');
    expect(FX_RULES.signalTimeframeSec).toBe(180);
    expect(FX_RULES.expirySec).toBe(60);
    expect(FX_RULES.startBalance).toBe(10);
    expect(FX_RULES.stake).toBe(1);
  });
  it('LONG wins above entry, loses below, draws when equal', () => {
    expect(settle('LONG', 100, 100.001)).toBe('WIN');
    expect(settle('LONG', 100, 99.999)).toBe('LOSS');
    expect(settle('LONG', 100, 100)).toBe('DRAW');
  });
  it('SHORT wins below entry, loses above, draws when equal', () => {
    expect(settle('SHORT', 100, 99.999)).toBe('WIN');
    expect(settle('SHORT', 100, 100.001)).toBe('LOSS');
    expect(settle('SHORT', 100, 100)).toBe('DRAW');
  });
  it('WIN: $2 gross, 23% fee on the $1 profit only, $1.77 returned, +$0.77 net', () => {
    expect(tradeMoney('WIN')).toEqual({ netC: 77, grossProfitC: 100, feeC: 23, returnedC: 177 });
  });
  it('LOSS loses the whole $1 with no fee; DRAW refunds $1', () => {
    expect(tradeMoney('LOSS')).toEqual({ netC: -100, grossProfitC: 0, feeC: 0, returnedC: 0 });
    expect(tradeMoney('DRAW')).toEqual({ netC: 0, grossProfitC: 0, feeC: 0, returnedC: 100 });
  });
  it("matches the user's balance examples", () => {
    expect(balanceAfter(['WIN'])).toBe(10.77);
    expect(balanceAfter(['LOSS'])).toBe(9);
    expect(balanceAfter(['WIN', 'WIN'])).toBe(11.54);
    expect(balanceAfter(['WIN', 'LOSS'])).toBe(9.77);
  });
  it('never compounds: a bigger balance still risks exactly $1', () => {
    expect(balanceAfter(['WIN', 'WIN', 'WIN', 'LOSS'], 50)).toBe(51.31);
  });
  it('blocks trades when the balance is below $1', () => {
    expect(canOpen(99)).toBe(false);
    expect(canOpen(100)).toBe(true);
    expect(balanceAfter(['LOSS', 'WIN'], 0.93)).toBe(0.93);
  });
});

describe('Forex market data handling', () => {
  it('treats Friday 22:00 to Sunday 22:00 UTC as closed', () => {
    expect(forexOpen(Date.UTC(2026, 10, 20, 21, 59) / 1000)).toBe(true);
    expect(forexOpen(Date.UTC(2026, 10, 20, 22, 0) / 1000)).toBe(false);
    expect(forexOpen(Date.UTC(2026, 10, 21, 12, 0) / 1000)).toBe(false);
    expect(forexOpen(Date.UTC(2026, 10, 22, 22, 0) / 1000)).toBe(true);
  });
  it('builds M3 candles from three 1-minute candles', () => {
    const t = Date.UTC(2026, 10, 19, 10, 0) / 1000;
    const m3 = toM3([{ t, o: 1, h: 2, l: 0.5, c: 1.5 }, { t: t + 60, o: 1.5, h: 3, l: 1, c: 2 }, { t: t + 120, o: 2, h: 2.5, l: 0.2, c: 0.9 }]);
    expect(m3).toEqual([{ t, o: 1, h: 3, l: 0.2, c: 0.9, minutes: 3 }]);
  });
  it('generates no signals on flat prices (no random entries)', () => {
    const bars = Array.from({ length: 300 }, (_, i) => ({ t: i * 180, o: 100, h: 100, l: 100, c: 100 }));
    expect(runCpes(bars).signals).toEqual([]);
  });
});

describe('Frozen 7-day backtest', () => {
  it('records every trade with $1 stake, chronologically, one trade per signal', () => {
    const traded = data.trades.filter((t) => t.result === 'WIN' || t.result === 'LOSS' || t.result === 'DRAW');
    expect(traded.every((t) => t.stake === 1)).toBe(true);
    const times = data.trades.map((t) => t.entry_time);
    expect([...times].sort()).toEqual(times);
    expect(new Set(data.trades.map((t) => `${t.signal_time}-${t.side}`)).size).toBe(data.trades.length);
    let bal = 1000;
    for (const t of traded) { bal += Math.round(t.net * 100); expect(t.balance_after).toBe(bal / 100); }
    expect(data.overall.final_balance).toBe(bal / 100);
  });
  it('expires every trade exactly 1 minute after entry', () => {
    for (const t of data.trades) expect(Date.parse(t.expiry_time) - Date.parse(t.entry_time)).toBe(60_000);
  });
});
