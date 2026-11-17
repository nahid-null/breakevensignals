import { describe, expect, it } from 'vitest';
import { emptyTimeframe, signalStrength, type MtfState } from '@/lib/engine/mtf-trend';
import { sentSignalSummary } from '@/lib/signal-summary';
import { SIM_RULES, simSessionTrades, simSummary, todayPnl, unrealizedPnl } from '@/lib/simulator';
import { simulatorControlsAllowed } from '@/lib/simulator-control-policy';

const tf = (minutes: number, bull: number, bear: number, adx: number) => ({ ...emptyTimeframe(minutes), bullScore: bull, bearScore: bear, adxValue: adx });
const mtf = (bull: number, adx: number, bear = 0): MtfState => ({ m15: tf(15, bull, bear, adx), m5: tf(5, bull, bear, adx), m1: tf(1, bull, bear, adx) });

describe('retained legacy strength calculation (not a simulator leverage gate)', () => {
  it('is STRONG only when all three timeframes score 7 and ADX is at least 25', () => {
    expect(signalStrength(mtf(7, 25), 'LONG')).toBe('STRONG');
    expect(signalStrength(mtf(7, 24.9), 'LONG')).toBe('NORMAL');
    expect(signalStrength(mtf(6, 40), 'LONG')).toBe('NORMAL');
  });
  it('uses the bearish score for SHORT', () => {
    expect(signalStrength(mtf(0, 30, 7), 'SHORT')).toBe('STRONG');
    expect(signalStrength(mtf(7, 30, 0), 'SHORT')).toBe('NORMAL');
  });
  it('is NORMAL when one timeframe is weaker', () => {
    const m = mtf(7, 30); m.m5 = tf(5, 7, 0, 20);
    expect(signalStrength(m, 'LONG')).toBe('NORMAL');
  });
  it('is NORMAL when scores are not yet known', () => {
    expect(signalStrength({ m15: emptyTimeframe(15), m5: emptyTimeframe(5), m1: emptyTimeframe(1) }, 'LONG')).toBe('NORMAL');
  });
});

describe('simulator display numbers', () => {
  it('shows the prompt-43 rule: 50x, 10% margin per slot, $10 default', () => {
    expect(SIM_RULES).toMatchObject({ leverage: 50, marginShare: 0.1, defaultBalance: 10 });
  });
  it('blocks hosted balance controls until the privacy gate is verified', () => {
    expect(simulatorControlsAllowed('http://localhost:8080/simulator')).toBe(true);
    expect(simulatorControlsAllowed('https://breakevensignals.lovable.app/simulator')).toBe(false);
    expect(simulatorControlsAllowed('https://localhost.attacker.test/simulator')).toBe(false);
  });
  it('computes unrealized P&L after entry fee and estimated 0.05% exit fee', () => {
    // 160 units long from 100 at 101: +160 gross, -8 entry fee, -8.08 exit fee
    expect(unrealizedPnl({ direction: 'LONG', quantity: 160, entry_price: 100, entry_fee: 8, margin: 800 }, 101)).toBeCloseTo(143.92, 8);
  });
  it('includes one tick per side when estimating new-rule profit', () => {
    expect(unrealizedPnl({ direction: 'LONG', quantity: 2, entry_price: 100, entry_fee: 0.1, margin: 4, slippage_price: 0.01 }, 100)).toBeCloseTo(-0.24, 9);
  });
  it('counts only trades closed today in the chosen time zone', () => {
    const trades = [
      { status: 'CLOSED', pnl: 10, closed_at: '2026-11-16T17:30:00Z' }, // 23:30 Dhaka on 16th
      { status: 'CLOSED', pnl: 5, closed_at: '2026-11-16T18:30:00Z' }, // 00:30 Dhaka on 17th
    ];
    expect(todayPnl(trades, new Date('2026-11-16T12:00:00Z'), 'Asia/Dhaka')).toBe(10);
  });
  it('starts performance anew at the reset time while retaining earlier trade history', () => {
    const history = [{ opened_at: '2026-11-17T04:59:59Z' }, { opened_at: '2026-11-17T05:00:00Z' }, { opened_at: '2026-11-17T05:01:00Z' }];
    expect(simSessionTrades(history, '2026-11-17T05:00:00Z')).toEqual(history.slice(1));
    expect(history).toHaveLength(3);
  });
  it('zeros today’s P&L and all performance counters on restart, retaining same-day results in history', () => {
    const history = [
      { opened_at: '2026-11-17T04:00:00Z', closed_at: '2026-11-17T04:30:00Z', status: 'CLOSED', pnl: 0.4 },
      { opened_at: '2026-11-17T04:40:00Z', closed_at: '2026-11-17T04:50:00Z', status: 'CLOSED', pnl: -0.2 },
    ];
    const session = simSessionTrades(history, '2026-11-17T05:00:00Z');
    expect(todayPnl(history, new Date('2026-11-17T05:01:00Z'), 'UTC')).toBeCloseTo(0.2);
    expect(todayPnl(session, new Date('2026-11-17T05:01:00Z'), 'UTC')).toBe(0);
    expect(simSummary(session)).toEqual({ closed: 0, wins: 0, losses: 0, winRate: null, totalPnl: 0 });
    expect(history).toHaveLength(2);
  });
  it('counts a genuine new result after restart without carrying over the earlier same-day profit', () => {
    const history = [
      { opened_at: '2026-11-17T04:00:00Z', closed_at: '2026-11-17T04:30:00Z', status: 'CLOSED', pnl: 1 },
      { opened_at: '2026-11-17T05:00:00Z', closed_at: '2026-11-17T05:01:00Z', status: 'CLOSED', pnl: 0.4 },
    ];
    expect(todayPnl(simSessionTrades(history, '2026-11-17T05:00:00Z'), new Date('2026-11-17T05:02:00Z'), 'Asia/Dhaka')).toBe(0.4);
  });
});

describe('Telegram signal summary', () => {
  it('counts only delivered non-test breakeven signals and their outcomes', () => {
    const log = (trade: string, extra = {}) => ({ trade_id: trade, event_id: `${trade}-breakeven_activated`, delivery_status: 'SENT', is_test: false, ...extra });
    const s = sentSignalSummary(
      [log('a'), log('b'), log('c'), log('d'), log('x', { is_test: true }), log('y', { delivery_status: 'FAILED' })],
      [{ trade_id: 'a', event_type: 'take_profit_hit' }, { trade_id: 'b', event_type: 'stop_loss_hit' },
       { trade_id: 'c', event_type: 'breakeven_activated' }, { trade_id: 'c', event_type: 'stop_loss_hit' }],
    );
    expect({ ...s, successRate: undefined }).toEqual({ sent: 4, open: 1, takeProfit: 1, stopLoss: 1, breakeven: 1, closed: 3, successRate: undefined });
    expect(s.successRate).toBeCloseTo(33.333, 2);
  });
});
