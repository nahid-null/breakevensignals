import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/robot/config';
import { RobotCore, type Queued } from '@/lib/robot/engine';
import { confirmedSweep } from '@/lib/robot/liquidity-sweep';
import { SymbolState, MINUTE } from '@/lib/robot/series';
import { manageTick, netRoi, openPosition } from '@/lib/robot/paper';
import { DEFAULT_RULES } from '@/lib/robot/risk';
import type { Candidate, Direction } from '@/lib/robot/strategy';

const s = { ...DEFAULT_SETTINGS };
const candle = (time: number, open: number, high: number, low: number, close: number) => ({ time, open, high, low, close, volume: 100 });
function state(direction: Direction) {
  const st = new SymbolState('NEARUSDT', 0.001); const long = direction === 'LONG';
  st.m5.atr.value = 1; st.m1.ema9.value = 100; st.m1.prevVol = 100;
  const level = long ? 99.8 : 100.2;
  st.levels.push({ side: long ? 'low' : 'high', price: level, tf: 5, time: -10 * MINUTE, touches: 2,
    sweptAt: 0, sweepExtreme: long ? 99.5 : 100.5, sweepBar: long ? candle(0, 100, 100.1, 99.5, 100) : candle(0, 100, 100.5, 99.9, 100) });
  st.m1.bars = long ? [candle(0, 100, 100.1, 99.5, 100), candle(MINUTE, 100, 100.3, 99.9, 100.25)] : [candle(0, 100, 100.5, 99.9, 100), candle(MINUTE, 100, 100.1, 99.7, 99.75)];
  return st;
}
const candidate = (): Candidate => ({ symbol: 'NEARUSDT', direction: 'LONG', time: 0, setup: 'SWEEP_RECLAIM', score: 90, tier: 'STRONG',
  parts: { trend: 20, structure: 10, setup: 25, trigger: 15, momentum: 10, volume: 10, execution: 10 }, entry: 100, stop: 99.5, tp: 100.3, atr: 1, atrPct: 1, stopPct: 0.005, tpPct: 0.3, liquidity: 'test' });
const queued = (): Queued => ({ c: candidate(), rank: 90, expires: 3 * MINUTE, spreadBps: 1, lastReason: null });
const core = () => { const c = new RobotCore(s); c.addSymbol('NEARUSDT', { ...DEFAULT_RULES, tickSize: 0.001 }); return c; };
const depth = (now = MINUTE) => ({ bids: [[99.99, 1000]] as [number,number][], asks: [[100, 1000]] as [number,number][], receivedAt: now });

describe('liquidity sweep entries and execution accounting', () => {
  it('LONG requires a meaningful low sweep, reclaim and a later bullish closed confirmation', () => {
    const result = confirmedSweep(state('LONG'), 'LONG', s);
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) throw new Error(result.rejected);
    expect(result.level.price).toBe(99.8); expect(result.level.sweepExtreme).toBe(99.5);
  });
  it('SHORT mirrors high sweep, reclaim and later bearish confirmation', () => {
    const result = confirmedSweep(state('SHORT'), 'SHORT', s);
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) throw new Error(result.rejected);
    expect(result.level.price).toBe(100.2); expect(result.level.sweepExtreme).toBe(100.5);
  });
  it('never enters on a touch or a break without reclaim', () => {
    const st = state('LONG'); st.levels[0].sweptAt = null;
    expect(confirmedSweep(st, 'LONG', s)).toEqual({ rejected: 'No recent meaningful liquidity sweep' });
    st.levels[0].sweptAt = 0; st.m1.bars[1].close = 99.7;
    expect(confirmedSweep(st, 'LONG', s)).toEqual({ rejected: 'Swept level not reclaimed on two closes' });
  });
  it('rejects a weak sweep and insufficient current volume', () => {
    const st = state('LONG'); st.levels[0].sweepExtreme = 99.79;
    expect(confirmedSweep(st, 'LONG', s)).toEqual({ rejected: 'Sweep too weak or too deep' });
    st.levels[0].sweepExtreme = 99.5; st.m1.bars[1].volume = 5;
    expect(confirmedSweep(st, 'LONG', s)).toEqual({ rejected: 'Confirmation volume below threshold' });
  });
  it('rejects stale signals after30 seconds even if they remain in the older queue TTL', () => {
    expect(core().execute(queued(), depth(MINUTE + 30001), 20, MINUTE + 30001)).toEqual({ rejected: 'Stale entry signal' });
  });
  it('checks fresh executable spread rather than spread saved when the signal qualified', () => {
    const book = depth(); book.asks = [[100.2, 1000]];
    expect(core().execute(queued(), book, 20, MINUTE)).toEqual({ rejected: 'Abnormal spread at execution' });
  });
  it('rejects an order-book snapshot older than5 seconds', () => {
    expect(core().execute(queued(), depth(0), 20, MINUTE)).toEqual({ rejected: 'Stale or unverified order book' });
  });
  it('checks final depth-walk fill drift including simulated slippage', () => {
    const q = queued(); q.c.atr = 0.1;
    const book = depth(); book.asks = [[100, 0.001], [100.05, 1000]];
    expect(core().execute(q, book, 20, MINUTE)).toEqual({ rejected: 'Final fill would chase signal' });
  });
  it('rechecks one position per coin at execution, not just queue selection', () => {
    const c = core(); const r = c.execute(queued(), depth(), 20, MINUTE);
    if ('rejected' in r) throw new Error(r.rejected); c.confirmOpen(r, candidate(), true);
    expect(c.execute(queued(), depth(), 20, MINUTE)).toEqual({ rejected: 'Already in this coin' });
  });
  it('uses executable bid for LONG valuation, not an optimistic midpoint', () => {
    const r = openPosition({ id: 'a', symbol: 'NEARUSDT', direction: 'LONG', setup: 'SWEEP_RECLAIM', score: 90, tier: 'STRONG', stop: 99.5, liquidity: '' }, { qty: 1, avg: 100, requested: 1, partial: false }, DEFAULT_RULES, 0, s);
    if ('rejected' in r) throw new Error(r.rejected);
    manageTick(r.position, 100, 100.1, 1000, s);
    expect((r.position.unrealized + r.position.realized) / r.position.margin * 100).toBeCloseTo(netRoi(r.position, 100, s), 9);
    expect(r.position.maeRoi).toBeLessThan(0);
  });
  it('entry and estimated exit fees at50x cost approximately5% margin ROI at unchanged price', () => {
    const noSlip = { ...s, slippage_bps: 0 };
    const r = openPosition({ id: 'a', symbol: 'NEARUSDT', direction: 'SHORT', setup: 'SWEEP_RECLAIM', score: 90, tier: 'STRONG', stop: 100.5, liquidity: '' }, { qty: 1, avg: 100, requested: 1, partial: false }, DEFAULT_RULES, 0, noSlip);
    if ('rejected' in r) throw new Error(r.rejected);
    expect(r.position.entryFee).toBe(0.05); expect(netRoi(r.position,100,noSlip)).toBeCloseTo(-5,9);
    expect(netRoi(r.position,99.8,noSlip)).toBeGreaterThan(netRoi(r.position,100,noSlip));
  });
  it('does not form a5m candle from a partial or gapped1m seed', () => {
    const st = new SymbolState('NEARUSDT',0.001);
    st.update(candle(3*MINUTE,100,101,99,100)); st.update(candle(4*MINUTE,100,101,99,100));
    expect(st.m5.bars).toHaveLength(0);
    for(let t=5;t<10;t++) st.update(candle(t*MINUTE,100,101,99,100));
    expect(st.m5.bars).toHaveLength(1); expect(st.m5.bars[0].volume).toBe(500);
  });
});