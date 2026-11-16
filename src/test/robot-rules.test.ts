import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PAPER_LEVERAGE, ROBOT_SYMBOLS } from '@/lib/robot/config';
import { allocationLimits, liquidationPrice, planMargin, portfolioGate, sizeOrder, DEFAULT_RULES, type OpenExposure } from '@/lib/robot/risk';
import { manageTick, netRoi, openPosition, simulateMarketFill } from '@/lib/robot/paper';
import { robotFillMessages, robotOpenMessage } from '@/lib/robot/telegram-format';
import { robotCommitSchema } from '@/lib/robot/protocol';
import { RobotCore } from '@/lib/robot/engine';
import type { Candidate } from '@/lib/robot/strategy';

const s = { ...DEFAULT_SETTINGS };
const rules = { ...DEFAULT_RULES, tickSize: 0.0001, stepSize: 0.1, minQty: 0.1, minNotional: 5 };
const deepBook = (bid: number, ask: number) => ({ bids: [[bid, 1e6]] as const, asks: [[ask, 1e6]] as const }) as never;
const exp = (symbol: string, margin = 1, direction: 'LONG' | 'SHORT' = 'SHORT'): OpenExposure => ({ symbol, direction, margin, notional: margin * 50 });
const order = { id: 'NEARUSDT-LONG-1', symbol: 'NEARUSDT', direction: 'LONG' as const, setup: 'TREND_PULLBACK' as const, score: 80, tier: 'QUALIFIED', stop: 99.5, liquidity: 'x' };
const openAt100 = (qty = 10) => { const r = openPosition(order, { qty, avg: 100, requested: qty, partial: false }, rules, 0, s); if ('rejected' in r) throw new Error(r.rejected); return r; };

describe('paper robot rules', () => {
  it('scans 40 coins and excludes the unavailable WILDUSDT', () => {
    expect(ROBOT_SYMBOLS).toHaveLength(40);
    expect(ROBOT_SYMBOLS).not.toContain('WILDUSDT');
  });
  it('opens every simulated position at exactly 50x', () => {
    expect(PAPER_LEVERAGE).toBe(50);
    expect(openAt100().position.leverage).toBe(50);
    const z = sizeOrder(10, 2, rules); if ('rejected' in z) throw new Error(z.rejected);
    expect(z.notional / z.margin).toBeCloseTo(50, 9);
  });
  it('never budgets more than 70% of the balance as combined margin, even if settings ask for more', () => {
    expect(allocationLimits(1000, [], { ...s, max_allocation_pct: 95 }).budget).toBe(700);
    expect(allocationLimits(20, [exp('BTCUSDT', 10)], s).available).toBeCloseTo(4, 9);
    expect(planMargin({ score: 90 }, 20, [exp('BTCUSDT', 14)], s)).toEqual({ rejected: 'Margin budget full (70% cap)' });
  });
  it('splits the 70% budget across slots instead of using 70% on one trade', () => {
    expect(planMargin({ score: 90 }, 20, [], s)).toBeCloseTo(14 / s.max_concurrent, 9);
  });
  it('takes profit at 10% net ROI on margin after fees', () => {
    const { position: p } = openAt100();
    expect(netRoi(p, p.tp / (1 - s.slippage_bps / 10_000), { ...s, fee_pct: s.maker_fee_pct })).toBeGreaterThanOrEqual(10 - 1e-6);
    const f = manageTick(p, p.tp, p.tp + 0.01, 1, s);
    expect(f[0]?.reason).toBe('TAKE_PROFIT');
    const margin = (p.qty * p.entry) / 50;
    expect((p.realized / margin) * 100).toBeGreaterThanOrEqual(10 - 1e-6);
    expect((p.realized / margin) * 100).toBeLessThan(10.2);
  });
  it('estimates 50x isolated liquidation 1.5% from entry', () => {
    expect(liquidationPrice(100, 'LONG')).toBeCloseTo(98.5, 9);
    expect(liquidationPrice(100, 'SHORT')).toBeCloseTo(101.5, 9);
  });
  it('has no daily loss limit, loss-streak pause or daily trade cap; only safety gates stop entries', () => {
    expect(portfolioGate({ symbol: 'NEARUSDT', direction: 'LONG' }, [], 3, s)).toBeNull();
    expect(portfolioGate({ symbol: 'NEARUSDT', direction: 'LONG' }, [], 20, { ...s, emergency_stop: true })).toBe('Emergency stop active');
    expect(portfolioGate({ symbol: 'NEARUSDT', direction: 'LONG' }, [exp('NEARUSDT')], 20, s)).toBe('Already in this coin');
  });
  it('allows several positions at once up to the slot limit', () => {
    const four = ['BTCUSDT', 'DOGEUSDT', 'LINKUSDT', 'TAOUSDT'].map((x) => exp(x));
    expect(portfolioGate({ symbol: 'SOLUSDT', direction: 'LONG' }, four, 20, s)).toBeNull();
    expect(portfolioGate({ symbol: 'SOLUSDT', direction: 'LONG' }, [...four, exp('XRPUSDT')], 20, s)).toBe('All position slots in use');
  });
  it('fills partially when the book is thin and rejects fills under half', () => {
    const thin = { bids: [[99.9, 5]], asks: [[100, 3], [100.1, 2]] } as never;
    const f = simulateMarketFill('LONG', 8, thin, s, rules);
    if ('rejected' in f) throw new Error(f.rejected);
    expect(f.partial).toBe(true); expect(f.qty).toBeCloseTo(5, 9);
    expect(simulateMarketFill('LONG', 20, thin, s, rules)).toEqual({ rejected: 'Insufficient order book depth (under half filled)' });
  });
  it('refills the slot after a close: a closed position frees margin for the next queued setup', () => {
    const core = new RobotCore({ ...s }); core.addSymbol('NEARUSDT', rules); core.addSymbol('SOLUSDT', rules);
    const cand = (symbol: string): Candidate => ({ symbol, direction: 'LONG', time: -60000, setup: 'TREND_PULLBACK', score: 90, tier: 'STRONG',
      parts: { trend: 0, structure: 0, setup: 0, trigger: 0, momentum: 0, volume: 0, execution: 0 }, entry: 100, stop: 99.5, tp: 100.3, atr: 0.5, atrPct: 0.5, stopPct: 0.005, tpPct: 0.3, liquidity: 'x' });
    core.queue.set('SOLUSDT|LONG', { c: cand('SOLUSDT'), rank: 1, expires: 1e15, spreadBps: 1, lastReason: null });
    const next = core.nextCandidate(1, 20); if (!next) throw new Error('Missing queued test entry');
    const r = core.execute(next, { bids: [[99.99, 1e6]], asks: [[100, 1e6]], receivedAt: 1 }, 20, 1);
    if ('rejected' in r) throw new Error(r.rejected);
    core.confirmOpen(r, cand('SOLUSDT'), true);
    expect(core.open).toHaveLength(1);
    expect(r.position.leverage).toBe(50);
    expect(r.position.margin).toBeLessThanOrEqual(14 + 1e-9);
  });
  it('labels every Telegram receipt PAPER ROBOT and as simulated', () => {
    const o = robotCommitSchema.parse({ instance_id: '22222222-2222-4222-8222-222222222222', opens: [{ id: 'NEARUSDT-LONG-0', symbol: 'NEARUSDT', direction: 'LONG',
      setup: 'TREND_PULLBACK', score: 80, leverage: 50, band: 'QUALIFIED', entry_price: 100, quantity: 1, requested_quantity: 1, fill_status: 'FILLED', margin: 2, notional: 100,
      stop_loss: 99.5, tp1: 100.25, tp2: 100.25, liquidation_price: 98.5, risk_usdt: 0.6, fees: 0.05, entry_fee: 0.05, realized_pnl: -0.05, liquidity: 'x',
      opened_at: '2026-11-16T12:00:00Z', last_candle_time: 0, balance_before: 20, target_roi_pct: 10, tick_size: 0.0001 }] }).opens[0]!;
    const msg = robotOpenMessage(o);
    expect(msg).toMatch(/^🤖 PAPER ROBOT/);
    expect(msg).toContain('no real order was placed');
    expect(msg).toContain('Leverage: 50x');
    const close = robotFillMessages({ id: o.id, symbol: o.symbol, direction: 'LONG', expected_version: 1, version: 2, status: 'CLOSED', quantity_open: 0, margin: 0,
      stop_loss: 99.5, tp: 100.25, funding: 0, net_roi_pct: -30, tp1_done: false, fees: 0.1, realized_pnl: -0.6, unrealized_pnl: 0, last_price: 99.5,
      closed_at: '2026-11-16T12:10:00Z', exit_price: 99.5, exit_reason: 'STOP_LOSS', last_candle_time: 0, pnl_delta: -0.55, entry_price: 100, leverage: 50,
      opened_at: '2026-11-16T12:00:00Z', notify: true, fills: [{ kind: 'CLOSE', price: 99.5, qty: 1, pnl: -0.55, fee: 0.05, reason: 'STOP_LOSS', time: Date.parse('2026-11-16T12:10:00Z') }] });
    expect(close[0]?.message).toMatch(/^🤖 PAPER ROBOT — ❌ TRADE CLOSED \(STOP LOSS\)/);
  });
  it('rejects a worker report that is not exactly 50x or has a stop on the wrong side', () => {
    const base = { id: 'NEARUSDT-LONG-0', symbol: 'NEARUSDT', direction: 'LONG', setup: 'TREND_PULLBACK', score: 80, leverage: 50, band: 'n', entry_price: 100, quantity: 1,
      requested_quantity: 1, fill_status: 'FILLED', margin: 2, notional: 100, stop_loss: 99.5, tp1: 100.25, tp2: 100.25, liquidation_price: 98.5, risk_usdt: 1, fees: 0,
      entry_fee: 0, realized_pnl: 0, liquidity: 'x', opened_at: '2026-11-16T12:00:00Z', last_candle_time: 0, balance_before: 20, target_roi_pct: 10, tick_size: 0.0001 };
    const parse = (o: object) => robotCommitSchema.parse({ instance_id: '22222222-2222-4222-8222-222222222222', opens: [{ ...base, ...o }] });
    expect(() => parse({})).not.toThrow();
    expect(() => parse({ leverage: 20, margin: 5 })).toThrow();
    expect(() => parse({ stop_loss: 101 })).toThrow();
  });
});
