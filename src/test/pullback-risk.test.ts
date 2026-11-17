import { describe, expect, it } from 'vitest';
import { MINUTE, type Candle } from '@/lib/engine/model';
import { simulate, type Entry, type Market } from '@/lib/engine/pullback-risk';

const T0 = 1_800_000_000_000 - (1_800_000_000_000 % MINUTE);
function market(path: Partial<Candle>[], lows: { known: number; price: number }[] = []): Market {
  const m = new Map<number, Candle>();
  path.forEach((c, i) => m.set(T0 + i * MINUTE, { time: T0 + i * MINUTE, open: 100, high: 100, low: 100, close: 100, volume: 1, ...c }));
  return { last: new Map([['XUSDT', m]]), mark: new Map(), funding: new Map(), lows: new Map([['XUSDT', lows]]), highs: new Map() };
}
const long: Entry = { id: 'X-LONG', symbol: 'XUSDT', side: 'LONG', time: T0, price: 100, score: 70, tick: 0.01 };
const entries = new Map([[T0, [long]]]);
const flat = (n: number) => Array.from({ length: n }, () => ({}));

describe('prompt-49 pullback risk replay', () => {
  it('100% threshold closes at the exact threshold price minus slippage', () => {
    const r = simulate(market([{}, { open: 99.5, high: 99.8, low: 97.9, close: 98.5 }, {}]), entries, { from: T0, to: T0 + 3 * MINUTE, rule: { kind: 'fixed', pct: 100 } });
    const t = r.trades[0]!;
    expect(t.reason).toBe('RISK_THRESHOLD');
    expect(t.exitPrice).toBeCloseTo(98.0, 9); // fill 100.02 - $1 margin / 0.5 qty = 98.02, minus 0.02 slippage
    expect(t.pnl).toBeCloseTo(-1.0595, 9);
  });

  it('a 951% margin loss is not liquidation, but account equity below maintenance is, and it zeroes the account', () => {
    const survive = simulate(market([{}, { low: 81, close: 90 }, {}]), entries, { from: T0, to: T0 + 3 * MINUTE, rule: { kind: 'none' } });
    expect(survive.liquidationEvents).toHaveLength(0);
    expect(survive.trades[0]!.maePct).toBeCloseTo(951, 0);
    const liq = simulate(market([{}, { low: 80, close: 90 }, {}]), entries, { from: T0, to: T0 + 3 * MINUTE, rule: { kind: 'none' } });
    expect(liq.trades[0]!.reason).toBe('ACCOUNT_LIQUIDATION');
    expect(liq.wallet).toBe(0);
  });

  it('never closes by time and reports a trade that missed TP as unresolved, not TP', () => {
    const r = simulate(market(flat(3000)), entries, { from: T0, to: T0 + 3000 * MINUTE, rule: { kind: 'none' } });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.reason).toBe('UNRESOLVED');
    expect(r.trades[0]!.exitTime).toBeNull();
  });

  it('dynamic protection arms only at a candle close past the pool and exits later at the recorded max loss', () => {
    const r = simulate(market([{}, { open: 99, high: 99.2, low: 97.9, close: 97.95 }, { open: 98, high: 98.1, low: 97.85, close: 98 }, {}], [{ known: T0 - MINUTE, price: 99 }]),
      entries, { from: T0, to: T0 + 4 * MINUTE, rule: { kind: 'dynamic' } });
    const t = r.trades[0]!;
    expect(t.dynamic!.armedTime).toBe(T0 + MINUTE);
    expect(t.dynamic!.stopPrice).toBeCloseTo(97.9, 9);
    expect(t.reason).toBe('DYNAMIC_LIQUIDITY_PROTECTION');
    expect(t.exitTime).toBe(T0 + 3 * MINUTE);
    expect(t.exitPrice).toBeCloseTo(97.88, 9);
  });
});
