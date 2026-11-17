// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { costedOutcome, gateReason, newSetup, stepSetup, type BarContext } from '../lib/engine/entry-quality';
import type { Signal } from '../lib/engine/model';
const sig: Signal = { symbol: 'NEARUSDT', direction: 'LONG', event: 'entry_confirmed', event_id: 'e', trade_id: 't', indicator: 'PINE', timeframe: '1', entry_price: 100, stop_loss: 99, take_profit: 101.5, fee_rate_percent: .04, timestamp: '2026-10-13T00:01:00Z' };
const signalBar = { time: 0, open: 99.6, high: 100.1, low: 99.5, close: 100, volume: 10 };
const ctx: BarContext = { atr: .4, ema9: 99.9, ema21: 99.8, ema200: 98, rsi: 60, histogram: .01, volumeSMA: 5, trend15: 1, ema5Side: 1, high240: 110, low240: 90 };
const retest = { time: 60000, open: 100.05, high: 100.3, low: 99.98, close: 100.25, volume: 10 };
describe('prompt-38 entry-quality rule', () => {
  it('never enters on the Pine signal candle itself', () => { const u = newSetup(sig, signalBar); expect(u.bars).toBe(0); expect(u.retested).toBe(false); });
  it('enters only after a retest of the breakout level and a directional close back above it', () => {
    const u = newSetup(sig, signalBar); const s = stepSetup(u, retest, ctx); expect(s.status).toBe('CONFIRMED'); });
  it('does not chase when price runs more than 1R before retesting', () => {
    const u = newSetup(sig, signalBar); const s = stepSetup(u, { time: 60000, open: 100.2, high: 101.2, low: 100.2, close: 101.1, volume: 10 }, ctx);
    expect(s).toEqual({ status: 'ABANDON', reason: 'MOVED_WITHOUT_RETEST_NO_CHASE' }); });
  it('abandons the setup when a candle closes beyond the original Pine stop', () => {
    const u = newSetup(sig, signalBar); expect(stepSetup(u, { time: 60000, open: 99.5, high: 99.6, low: 98.8, close: 98.9, volume: 1 }, ctx)).toEqual({ status: 'ABANDON', reason: 'CLOSED_BEYOND_PINE_STOP' }); });
  it('gives up after 15 candles without confirmation', () => {
    const u = newSetup(sig, signalBar); let s; for (let i = 1; i <= 15; i++) s = stepSetup(u, { time: i * 60000, open: 100.4, high: 100.5, low: 100.3, close: 100.35, volume: 1 }, ctx);
    expect(s).toEqual({ status: 'ABANDON', reason: 'NO_CONFIRMATION_IN_WINDOW' }); });
  it('skips when the completed 15m trend is sideways', () => { expect(gateReason(newSetup(sig, signalBar), retest, { ...ctx, trend15: 0 })).toBe('15M_TREND_NOT_ALIGNED'); });
  it('skips when 5m EMA9/21 conflicts', () => { expect(gateReason(newSetup(sig, signalBar), retest, { ...ctx, ema5Side: -1 })).toBe('5M_EMA9_21_CONFLICT'); });
  it('skips weak volume below the 20-candle average', () => { expect(gateReason(newSetup(sig, signalBar), retest, { ...ctx, volumeSMA: 11 })).toBe('WEAK_VOLUME'); });
  it('skips late entries more than 1.5 ATR beyond EMA21', () => { expect(gateReason(newSetup(sig, signalBar), retest, { ...ctx, ema21: 99.6 })).toBe('TOO_EXTENDED_LATE'); });
  it('skips structure stops tighter than 0.40% of price', () => { expect(gateReason(newSetup(sig, { ...signalBar, low: 99.95 }), retest, { ...ctx, atr: .1, ema21: 100.2 })).toBe('STOP_TOO_TIGHT_FOR_COSTS'); });
  it('skips when resistance sits within 1R above entry', () => { expect(gateReason(newSetup(sig, signalBar), retest, { ...ctx, high240: 100.5 })).toBe('TOO_CLOSE_TO_SUPPORT_RESISTANCE'); });
  it('places the stop beyond the lowest low since the signal, buffered 0.15 ATR', () => {
    const u = newSetup(sig, signalBar); const s = stepSetup(u, retest, ctx); expect(s.status === 'CONFIRMED' && s.stop).toBeCloseTo(99.5 - .06, 10); });
  it('target pays 1.5R net after fees and slippage; same-candle stop and target counts as a loss', () => {
    const bars = [{ time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 }, { time: 60000, open: 100, high: 105, low: 100, close: 104, volume: 1 }];
    expect(costedOutcome(bars, 0, 'LONG', 99, .01)?.netR).toBeCloseTo(1.5, 6);
    const both = [{ time: 0, open: 100, high: 105, low: 98, close: 100, volume: 1 }];
    const o = costedOutcome(both, 0, 'LONG', 99, .01); expect(o?.result).toBe('STOP'); expect(o?.netR).toBeCloseTo(-1, 6);
  });
});
