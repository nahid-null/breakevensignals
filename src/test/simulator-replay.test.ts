// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { closeReplayPosition, createReplayPosition, CURRENT_REPLAY, replaySimulator, trendSkip, type ReplayEvent, type ReplayFeed } from '../lib/engine/simulator-replay';
const event: ReplayEvent = { time: 0, signal: { event_id:'be',trade_id:'t',symbol:'NEARUSDT',direction:'LONG',indicator:'PRO SCALPER',timeframe:'1',event:'breakeven_activated',entry_price:100,stop_loss:100,take_profit:101.5,timestamp:'2026-11-10T00:01:00Z',fee_rate_percent:.04,mtf_trend:{m15:1,m5:1,m1:0} } };
describe('read-only Simulator report accounting',() => {
  it('uses exactly 50x and 80% of $5 at the current breakeven trigger, not Pine entry',() => {
    const t=createReplayPosition(event,.01,'5',CURRENT_REPLAY);
    expect(t?.margin).toBe('4'); expect(t?.entry).toBe('101'); expect(t?.stop).toBe('100'); expect(Number(t?.quantity)*101).toBeCloseTo(200,10);
  });
  it('take profit earns 10% NET on margin after both fees and slippage',() => {
    const t=createReplayPosition(event,.01,'5',CURRENT_REPLAY); if(!t) throw new Error('Missing position');
    const r=closeReplayPosition(t,t.target,'TAKE_PROFIT',60000,'5');
    expect(Number(r.pnl)).toBeCloseTo(.4,12); expect(Number(r.balanceAfter)).toBeCloseTo(5.4,12);
  });
  it('liquidation charges entry fee but no invented exit fee',() => {
    const t=createReplayPosition(event,.01,'5',CURRENT_REPLAY); if(!t) throw new Error('Missing position');
    const r=closeReplayPosition(t,t.liquidation,'LIQUIDATED',60000,'5');
    expect(r.exitFee).toBe('0'); expect(r.grossPnl).toBe('-4'); expect(r.pnl).toBe('-4.1');
  });
  it('reports the division-by-zero boundary rather than 26 synthetic zero-margin trades',() => {
    expect(createReplayPosition(event,.01,'0.000000005462295425681328',CURRENT_REPLAY)).toBeNull();
  });
  it('requires matching 15m/5m but accepts sideways 1m',() => {
    expect(trendSkip({m15:1,m5:1,m1:0},'LONG')).toBeNull();
    expect(trendSkip({m15:1,m5:1,m1:-1},'LONG')).toBe('ONE_MINUTE_OPPOSITE');
    expect(trendSkip({m15:1,m5:-1,m1:0},'LONG')).toBe('NO_15M_5M_BIAS');
  });
  it('reconciles every signal into closed, open, skipped, failed or unprocessed',() => {
    const candles=[0,60000].map(time=>({time,open:101,high:101.1,low:100.9,close:101,volume:1}));
    const next={time:60000,signal:{...event.signal,event_id:'be2',trade_id:'t2'}};
    const feeds:ReplayFeed[]=[{symbol:'NEARUSDT',tick:.01,candles,events:[event,next]}];
    const r=replaySimulator(feeds,0,120000,CURRENT_REPLAY);
    expect(r.signals).toBe(2); expect(r.executed).toBe(1); expect(r.open?.tradeId).toBe('t');
    expect(r.skipped['TRADE_ALREADY_OPEN']).toBe(1);
    expect(r.closed+(r.open?1:0)+r.skippedTotal+r.errors+r.notProcessed).toBe(2);
  });
});