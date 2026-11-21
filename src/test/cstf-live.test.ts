import { describe, expect, it } from 'vitest';
import { CSTF_SYMBOLS } from '../lib/engine/cstf';
import { cstfResultMessage, frameMode, fundingByMinute, parseBrackets, signalBarFor, warmBars } from '../lib/engine/cstf-live';

const H = 1_800_000; const T = 1_795_000_000_000 - (1_795_000_000_000 % H);
describe('prompt-74 live CSTF wiring', () => {
  it('evaluates a 30m signal only at the minute its candle has closed', () => {
    expect(signalBarFor(T)).toBe(T - H); expect(signalBarFor(T + 60_000)).toBeNull();
  });
  it('warm-up excludes the bar whose signal frame is still to be processed', () => {
    const bars = [{ time: T - 2 * H }, { time: T - H }];
    expect(warmBars(bars, T).map((b) => b.time)).toEqual([T - 2 * H]);
    expect(warmBars(bars, T + 60_000).map((b) => b.time)).toEqual([T - 2 * H, T - H]);
  });
  it('only promptly processed minutes may open trades', () => {
    expect(frameMode(T, T + 61_000)).toBe('live'); expect(frameMode(T, T + 5 * 60_000)).toBe('recovery');
  });
  it('funding applies in the minute of its funding time', () => {
    expect(fundingByMinute([{ fundingTime: T + 3, fundingRate: '0.0001' }]).get(T)).toEqual([0.0001]);
  });
  it('requires maintenance tiers for all 22 coins', () => {
    const full = { data: { brackets: CSTF_SYMBOLS.map((symbol) => ({ symbol, riskBrackets: [{ bracketNotionalFloor: 0, bracketNotionalCap: 5000, bracketMaintenanceMarginRate: .005, cumFastMaintenanceAmount: 0, maxOpenPosLeverage: 75 }] })) } };
    expect(Object.keys(parseBrackets(full))).toHaveLength(22);
    expect(() => parseBrackets({ data: { brackets: full.data.brackets.slice(1) } })).toThrow();
  });
  it('the Telegram result shows net P&L and wallet', () => {
    const position = { signal: { id: 'x', symbol: 'ETHUSDT' as const, side: 'LONG' as const, pattern: 'Hammer', signalTime: T - H, confirmTime: T, close: 1, atr: 1 }, entryTime: T, entry: 100, quantity: .375, margin: .5, entryFee: .01875, funding: 0, target: 100.4, liquidationPrice: 80 };
    const m = cstfResultMessage({ position, reason: 'TAKE_PROFIT', time: T + 60_000, price: 100.38, gross: .14, exitFee: .02, net: .1, walletAfter: 10.1, notify: true }, 'live');
    expect(m).toContain('Net P&L: +$0.1000'); expect(m).toContain('Wallet: $10.1000');
  });
});
