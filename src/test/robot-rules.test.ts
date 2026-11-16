import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ROBOT_SYMBOLS } from '@/lib/robot/config';
import { allocationLimits, leverageBand, liquidationPrice, portfolioGate, sizePosition, type Account } from '@/lib/robot/risk';
import { robotFillMessages, robotOpenMessage } from '@/lib/robot/telegram-format';
import { robotCommitSchema } from '@/lib/robot/protocol';
import type { Candidate } from '@/lib/robot/strategy';

const s = { ...DEFAULT_SETTINGS };
const cand = (o: Partial<Candidate> = {}): Candidate => ({ symbol: 'NEARUSDT', direction: 'LONG', time: 0, setup: 'SWEEP_RECLAIM', score: 80,
  parts: { trend: 0, structure: 0, liquidity: 0, confirmation: 0, volume: 0, momentum: 0, volatility: 0, spread: 0, room: 0 },
  entry: 100, stop: 99, tp1: 101, tp2: 102, atr: 0.2, atrPct: 0.2, sweptLevel: null, liquidity: 'x', ...o });
const acct: Account = { balance: 1000, dayStartBalance: 1000, realizedToday: 0, lossStreak: 0, lastLossAt: null };

describe('paper robot rules', () => {
  it('scans 40 coins and excludes the unavailable WILDUSDT', () => {
    expect(ROBOT_SYMBOLS).toHaveLength(40);
    expect(ROBOT_SYMBOLS).not.toContain('WILDUSDT');
  });
  it('never budgets more than 70% of the balance for margin, even if settings ask for more', () => {
    expect(allocationLimits(1000, [], { ...s, max_allocation_pct: 95 }).budget).toBe(700);
  });
  it('sizes a trade so the stop-out loss equals the 0.5% risk per trade', () => {
    const z = sizePosition(cand(), 1000, [], s, 1);
    if ('rejected' in z) throw new Error(z.rejected);
    expect(z.riskUsdt).toBeCloseTo(5, 6);
  });
  it('never uses more than 50x leverage', () => {
    expect(leverageBand(cand({ score: 99, atrPct: 0.05 }), 0.5, { ...s, max_leverage: 500 }).max).toBe(50);
  });
  it('keeps liquidation at least twice the stop distance away', () => {
    const z = sizePosition(cand({ stop: 99.5 }), 1000, [], s, 1);
    if ('rejected' in z) throw new Error(z.rejected);
    expect(Math.abs(100 - z.liquidation)).toBeGreaterThanOrEqual(2 * 0.5);
    expect(liquidationPrice(100, 10, 'LONG')).toBeCloseTo(90.5, 6);
  });
  it('stops entries after the 3% daily loss limit and during the loss-streak pause', () => {
    expect(portfolioGate(cand(), [], { ...acct, realizedToday: -30 }, s, 0)).toBe('Daily loss limit reached');
    expect(portfolioGate(cand(), [], { ...acct, lossStreak: 2, lastLossAt: 0 }, s, 59 * 60_000)).toBe('Cooling down after consecutive losses');
    expect(portfolioGate(cand(), [], { ...acct, lossStreak: 2, lastLossAt: 0 }, s, 61 * 60_000)).toBeNull();
  });
  it('allows at most 3 open positions and one per correlated group', () => {
    const p = (symbol: string) => ({ symbol, direction: 'SHORT' as const, margin: 1, riskUsdt: 1, notional: 1 });
    expect(portfolioGate(cand(), [p('BTCUSDT'), p('DOGEUSDT'), p('LINKUSDT')], acct, s, 0)).toBe('Maximum open positions');
    expect(portfolioGate(cand({ symbol: 'SOLUSDT' }), [p('SUIUSDT')], acct, s, 0)).toBe('Correlated position already open');
  });
  it('labels every Telegram receipt PAPER ROBOT and as simulated', () => {
    const o = robotCommitSchema.parse({ instance_id: '22222222-2222-4222-8222-222222222222', opens: [{ id: 'NEARUSDT-LONG-0', symbol: 'NEARUSDT', direction: 'LONG',
      setup: 'SWEEP_RECLAIM', score: 80, leverage: 3, band: 'Normal conditions', entry_price: 100, quantity: 1, margin: 33, notional: 100, stop_loss: 99, tp1: 101,
      tp2: 102, liquidation_price: 67, risk_usdt: 1, fees: 0.05, realized_pnl: -0.05, liquidity: 'x', opened_at: '2026-11-16T12:00:00Z', last_candle_time: 0, balance_before: 1000 }] }).opens[0]!;
    const msg = robotOpenMessage(o);
    expect(msg).toMatch(/^🤖 PAPER ROBOT/);
    expect(msg).toContain('no real order was placed');
    const close = robotFillMessages({ id: o.id, symbol: o.symbol, direction: 'LONG', expected_version: 1, version: 2, status: 'CLOSED', quantity_open: 0, margin: 0,
      stop_loss: 99, tp1_done: false, fees: 0.1, realized_pnl: -1.1, unrealized_pnl: 0, last_price: 99, closed_at: '2026-11-16T12:10:00Z', exit_price: 99,
      exit_reason: 'STOP_LOSS', last_candle_time: 0, pnl_delta: -1.05, entry_price: 100, leverage: 3, opened_at: '2026-11-16T12:00:00Z', notify: true,
      fills: [{ kind: 'CLOSE', price: 99, qty: 1, pnl: -1.05, fee: 0.05, reason: 'STOP_LOSS', time: Date.parse('2026-11-16T12:10:00Z') }] });
    expect(close[0]?.message).toMatch(/^🤖 PAPER ROBOT — ❌ TRADE CLOSED \(STOP LOSS\)/);
  });
  it('rejects a worker report with a stop on the wrong side of entry', () => {
    expect(() => robotCommitSchema.parse({ instance_id: '22222222-2222-4222-8222-222222222222', opens: [{ id: 'NEARUSDT-LONG-0', symbol: 'NEARUSDT', direction: 'LONG',
      setup: 'SWEEP_RECLAIM', score: 80, leverage: 3, band: 'n', entry_price: 100, quantity: 1, margin: 33, notional: 100, stop_loss: 101, tp1: 102, tp2: 103,
      liquidation_price: 67, risk_usdt: 1, fees: 0, realized_pnl: 0, liquidity: 'x', opened_at: '2026-11-16T12:00:00Z', last_candle_time: 0, balance_before: 1000 }] })).toThrow();
  });
});
