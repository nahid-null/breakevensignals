import { describe, expect, it } from 'vitest';
import { ST_INTERVAL, ST_SETTINGS, ST_SYMBOLS, initialSt, processSt, stSignalId, type StSide, type StSymbol } from '../lib/engine/supertrend';
import { ST_RULES, initialStAccount, processStAccount, stMainBalance, type StAccountState, type StBrackets, type StMinuteFrame } from '../lib/engine/st-account';
import { StBatch } from '../lib/engine/st-live';

// prompt-81 user rules for the SuperTrend continuous-reversal Simulator.
const brackets = Object.fromEntries(ST_SYMBOLS.map((s) => [s, [{ floor: 0, cap: 1e9, rate: .01, cumulative: 0, maxLeverage: 75 }]])) as StBrackets;
const T0 = 1_795_000_000_000 - (1_795_000_000_000 % ST_INTERVAL);
const c = (time: number, o: number, h = o, l = o, cl = o) => ({ time, open: o, high: h, low: l, close: cl, volume: 1 });
function frame(time: number, prices: Partial<Record<StSymbol, number>> = {}, signals: { symbol: StSymbol; side: StSide }[] = [], range = 0): StMinuteFrame {
  const f: StMinuteFrame = { time, last: {} as StMinuteFrame['last'], mark: {} as StMinuteFrame['mark'], funding: {}, signals: [], mode: 'live' };
  for (const s of ST_SYMBOLS) { const p = prices[s] ?? 100; f.last[s] = c(time, p, p * (1 + range), p * (1 - range), p); f.mark[s] = c(time, p, p * (1 + range), p * (1 - range), p); }
  f.signals = signals.map(({ symbol, side }) => ({ id: stSignalId(symbol, side, time - ST_INTERVAL), symbol, side, signalTime: time - ST_INTERVAL, confirmTime: time, close: 100, line: 100 }));
  return f;
}
const run = (frames: StMinuteFrame[], start: StAccountState = initialStAccount()) => {
  let s = start; const all = { closed: [] as ReturnType<typeof processStAccount>['closed'], opened: [] as ReturnType<typeof processStAccount>['opened'], skipped: [] as ReturnType<typeof processStAccount>['skipped'] };
  for (const f of frames) { const r = processStAccount(s, f, brackets); s = r.state; all.closed.push(...r.closed); all.opened.push(...r.opened); all.skipped.push(...r.skipped); }
  return { state: s, ...all };
};

describe('prompt-81 SuperTrend settings', () => {
  it('uses ATR length 5, hl2 source, multiplier 1.6 on 30-minute candles', () => {
    expect(ST_SETTINGS).toEqual({ atrPeriod: 5, multiplier: 1.6, source: 'hl2', changeATR: true });
    expect(ST_INTERVAL).toBe(30 * 60_000);
  });
  it('trades only the five specified coins, one slot each', () => {
    expect([...ST_SYMBOLS]).toEqual(['NEARUSDT', 'SUIUSDT', 'TAOUSDT', 'LINKUSDT', 'WLDUSDT']);
    expect(ST_RULES.slots).toBe(5);
  });
  it('$10 start, 5% margin, 75x', () => {
    expect(ST_RULES.startingBalance).toBe(10); expect(ST_RULES.marginRate).toBe(.05); expect(ST_RULES.leverage).toBe(75);
  });
  it('rejects an unconfirmed (still forming) 30m candle', () => {
    expect(() => processSt(initialSt(), 'NEARUSDT', c(T0, 1), T0 + ST_INTERVAL - 1)).toThrow();
  });
  it('flips to SELL when price breaks below the up line, then BUY when it breaks above the down line', () => {
    const st = initialSt(); const out: StSide[] = [];
    const prices = [...Array(20).fill(100).map((p, i) => p + i), 60, 55, 50, 45, 40, 80, 120, 160];
    prices.forEach((p, i) => out.push(...processSt(st, 'NEARUSDT', c(T0 + i * ST_INTERVAL, p, p + 1, p - 1, p), T0 + (i + 1) * ST_INTERVAL).map((s) => s.side)));
    expect(out).toEqual(['SHORT', 'LONG']);
  });
});

describe('prompt-81 continuous reversal account', () => {
  it('BUY opens LONG with 5% of the $10 main balance ($0.50) at 75x', () => {
    const r = run([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]);
    expect(r.opened).toHaveLength(1);
    expect(r.opened[0]!.side).toBe('LONG');
    expect(r.opened[0]!.margin).toBeCloseTo(.5, 10);
    expect(r.opened[0]!.quantity * r.opened[0]!.entry / r.opened[0]!.margin).toBeCloseTo(75, 8);
  });
  it('SELL opens SHORT', () => {
    expect(run([frame(T0, {}, [{ symbol: 'SUIUSDT', side: 'SHORT' }])]).opened[0]!.side).toBe('SHORT');
  });
  it('a large loss does not close the trade (no stop loss)', () => {
    const r = run([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }]), frame(T0 + 60_000, { NEARUSDT: 98.5 })]);
    expect(r.closed).toHaveLength(0); expect(r.state.positions).toHaveLength(1);
  });
  it('a large profit does not close the trade (no take profit)', () => {
    const r = run([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }]), frame(T0 + 60_000, { NEARUSDT: 120 })]);
    expect(r.closed).toHaveLength(0); expect(r.state.positions).toHaveLength(1);
  });
  it('no time exit: still open after 30 days', () => {
    const r = run([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]);
    const later = processStAccount({ ...r.state, lastMinute: T0 + 30 * 86_400_000 - 60_000 }, frame(T0 + 30 * 86_400_000), brackets);
    expect(later.closed).toHaveLength(0); expect(later.state.positions).toHaveLength(1);
  });
  it('BUY while LONG does nothing', () => {
    const start = run([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]).state;
    const r = processStAccount({ ...start, lastMinute: T0 + ST_INTERVAL - 60_000 }, frame(T0 + ST_INTERVAL, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }]), brackets);
    expect(r.opened).toHaveLength(0); expect(r.closed).toHaveLength(0); expect(r.skipped[0]!.reason).toBe('ALREADY_IN_DIRECTION');
    expect(r.state.positions).toHaveLength(1);
  });
  it('SELL while LONG closes the LONG and opens a SHORT in the same slot with 5% of the UPDATED main balance', () => {
    const start = run([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]).state;
    const r = processStAccount({ ...start, lastMinute: T0 + ST_INTERVAL - 60_000 }, frame(T0 + ST_INTERVAL, { NEARUSDT: 102 }, [{ symbol: 'NEARUSDT', side: 'SHORT' }]), brackets);
    expect(r.closed).toHaveLength(1); expect(r.closed[0]!.reason).toBe('OPPOSITE_SIGNAL'); expect(r.closed[0]!.net).toBeGreaterThan(0);
    expect(r.opened).toHaveLength(1); expect(r.opened[0]!.side).toBe('SHORT'); expect(r.opened[0]!.symbol).toBe('NEARUSDT');
    expect(r.closed[0]!.reversedTo).toBe(r.opened[0]!.id);
    expect(r.opened[0]!.margin).toBeCloseTo(.05 * r.closed[0]!.mainAfter, 10);
    expect(r.opened[0]!.margin).toBeGreaterThan(.5); // balance grew, so margin grew
    expect(r.state.positions.map((p) => `${p.symbol}:${p.side}`)).toEqual(['NEARUSDT:SHORT']);
  });
  it('BUY while SHORT closes the SHORT and opens a LONG; a loss lowers the next margin', () => {
    const start = run([frame(T0, {}, [{ symbol: 'TAOUSDT', side: 'SHORT' }])]).state;
    const r = processStAccount({ ...start, lastMinute: T0 + ST_INTERVAL - 60_000 }, frame(T0 + ST_INTERVAL, { TAOUSDT: 101 }, [{ symbol: 'TAOUSDT', side: 'LONG' }]), brackets);
    expect(r.closed[0]!.net).toBeLessThan(0); expect(r.opened[0]!.side).toBe('LONG');
    expect(r.opened[0]!.margin).toBeCloseTo(.05 * stMainBalance({ wallet: r.closed[0]!.walletAfter, positions: [] }), 10);
    expect(r.opened[0]!.margin).toBeLessThan(.5);
  });
  it("one coin's signal never closes or changes another coin's position", () => {
    const start = run([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }, { symbol: 'SUIUSDT', side: 'LONG' }])]).state;
    const r = processStAccount({ ...start, lastMinute: T0 + ST_INTERVAL - 60_000 }, frame(T0 + ST_INTERVAL, {}, [{ symbol: 'NEARUSDT', side: 'SHORT' }]), brackets);
    expect(r.closed.map((x) => x.position.symbol)).toEqual(['NEARUSDT']);
    const sui = r.state.positions.find((p) => p.symbol === 'SUIUSDT');
    const before = start.positions.find((p) => p.symbol === 'SUIUSDT')!;
    // Only the shared cross-margin liquidation estimate may move; side, entry, size and margin are untouched.
    expect({ ...sui, liquidationPrice: 0 }).toEqual({ ...before, liquidationPrice: 0 });
  });
  it('all five coins can be open at once; one position per coin', () => {
    const r = run([frame(T0, {}, ST_SYMBOLS.map((symbol) => ({ symbol, side: 'LONG' as const })))]);
    expect(r.state.positions).toHaveLength(5); expect(new Set(r.state.positions.map((p) => p.symbol)).size).toBe(5);
  });
  it('a slot without a signal stays waiting (nothing manufactured)', () => {
    const r = run([frame(T0), frame(T0 + 60_000)]);
    expect(r.state.positions).toHaveLength(0);
  });
  it('cross margin: a crash liquidates the whole shared account', () => {
    const start = run([frame(T0, {}, ST_SYMBOLS.map((symbol) => ({ symbol, side: 'LONG' as const })))]).state;
    const r = processStAccount(start, { ...frame(T0 + 60_000, Object.fromEntries(ST_SYMBOLS.map((s) => [s, 94])) as Record<StSymbol, number>, [], .001) }, brackets);
    expect(r.closed).toHaveLength(5); expect(r.closed.every((x) => x.reason === 'LIQUIDATED')).toBe(true);
    expect(r.state.wallet).toBe(0); expect(r.state.liquidations).toBe(1);
  });
  it('commit payload marks reversal decisions and carries Telegram messages for open and close', () => {
    const start = run([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]).state;
    const f = frame(T0 + ST_INTERVAL, { NEARUSDT: 99 }, [{ symbol: 'NEARUSDT', side: 'SHORT' }]);
    const r = processStAccount({ ...start, lastMinute: T0 + ST_INTERVAL - 60_000 }, f, brackets);
    const b = new StBatch(f.time); b.add(r, 'live', Object.fromEntries(ST_SYMBOLS.map((s) => [s, 99])) as Record<StSymbol, number>);
    expect(b.signals[0]!.decision).toBe('REVERSED');
    expect(b.closed[0]!.message).toContain('Opposite SuperTrend signal');
    expect(b.closed[0]!.message).toContain('CLOSED IN LOSS');
    expect(b.opened[0]!.message).toContain('REVERSAL OPENED');
    expect(b.opened[0]!.reversed_from).toBe(start.positions[0]!.id);
  });
});

describe('prompt-81 Telegram result counting', () => {
  it('counts a sent SuperTrend result as successful only when it closed with a net profit', async () => {
    const { sentResultSummary } = await import('../lib/signal-summary');
    const log = (id: string) => ({ event_id: `${id}-st-result`, trade_id: id, is_test: false, delivery_status: 'SENT' });
    const r = sentResultSummary([log('a'), log('b')] as Parameters<typeof sentResultSummary>[0], [{ trade_id: 'a', exit_reason: 'OPPOSITE_SIGNAL', won: true }, { trade_id: 'b', exit_reason: 'OPPOSITE_SIGNAL', won: false }]);
    expect(r).toEqual({ sent: 2, takeProfit: 1, stopLoss: 1, successRate: 50 });
  });
});
