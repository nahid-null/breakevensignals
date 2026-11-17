// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adverseFill, confirmationReason, experimentalConfigs, experimentalPosition, settleExperimental, type Candidate, type MarketRules } from '../lib/engine/profitability-replay';
const rules:MarketRules={tick:.001,step:.001,minQuantity:.001,maxQuantity:100000,minNotional:5};
const bar={time:120000,open:101.5,high:102,low:101.4,close:101.8,volume:1};
const candidate:Candidate={time:120000,trigger:101,confirmClose:101.8,trend15:1,ema9:101,ema21:100,signal:{symbol:'NEARUSDT',direction:'LONG',event:'breakeven_activated',event_id:'b',trade_id:'t',indicator:'PINE',timeframe:'1',entry_price:100,stop_loss:100,take_profit:101.5,fee_rate_percent:.04,timestamp:'2026-09-01T00:01:00Z'}};
describe('independent prompt-37 profitability rules',()=>{
  it('tests only 10x and 20x',()=>{expect([...new Set(experimentalConfigs().map(c=>c.leverage))]).toEqual([10,20]);});
  it('tests only 5% and 10% margin',()=>{expect([...new Set(experimentalConfigs().map(c=>c.marginShare))]).toEqual([.05,.1]);});
  it('tests net risk/reward 1:1, 1:1.5 and 1:2',()=>{expect([...new Set(experimentalConfigs().map(c=>c.rr))]).toEqual([1,1.5,2]);});
  it('separates LONG and SHORT',()=>{expect(experimentalConfigs().filter(c=>c.direction==='LONG')).toHaveLength(12);expect(experimentalConfigs().filter(c=>c.direction==='SHORT')).toHaveLength(12);});
  it('rejects opposite 15m trend',()=>{expect(confirmationReason(candidate.signal,bar,-1,101,100)).toBe('15M_TREND');});
  it('requires directional 5m EMA9/21',()=>{expect(confirmationReason(candidate.signal,bar,1,99,100)).toBe('5M_EMA9_21');});
  it('requires closed 1m confirmation beyond trigger',()=>{expect(confirmationReason(candidate.signal,{...bar,close:100.9},1,101,100)).toBe('1M_CLOSE');expect(confirmationReason(candidate.signal,bar,1,101,100)).toBeNull();});
  it('charges adverse 5bps plus tick instead of favorable fills',()=>{expect(adverseFill(100,'LONG',true,rules,{fee:.0005,bps:5,ticks:1,maintenance:.01})).toBe(100.051);});
  it('does not invent tradable $2.50 notional orders below the $5 minimum',()=>{const r=experimentalPosition(candidate,bar,rules,5,{id:'x',direction:'LONG',leverage:10,marginShare:.05,rr:1});expect(r.reason).toBe('EXCHANGE_MINIMUM_OR_LOT');});
  it('uses exactly 10% of available $1000 as margin',()=>{const p=experimentalPosition(candidate,bar,rules,1000,{id:'x',direction:'LONG',leverage:20,marginShare:.1,rr:2}).position;expect(p?.margin).toBe(100);});
  it('net target earns twice net stop risk after 0.05% per-side fees and slippage',()=>{const p=experimentalPosition(candidate,bar,rules,1000,{id:'x',direction:'LONG',leverage:20,marginShare:.1,rr:2}).position;if(!p)throw new Error('Missing position');const tp=settleExperimental(p,p.target,'TAKE_PROFIT',180000,rules,1000);const sl=settleExperimental(p,p.stop,'STOP_LOSS',180000,rules,1000);expect(tp.pnl/-sl.pnl).toBeGreaterThanOrEqual(2);expect(tp.pnl/-sl.pnl).toBeLessThan(2.01);});
  it('funding payments lower net profit dollar for dollar',()=>{const p=experimentalPosition(candidate,bar,rules,1000,{id:'x',direction:'LONG',leverage:10,marginShare:.1,rr:1}).position;if(!p)throw new Error('Missing position');const a=settleExperimental(p,p.target,'TAKE_PROFIT',180000,rules,1000);const b=settleExperimental({...p,funding:.25},p.target,'TAKE_PROFIT',180000,rules,1000);expect(a.pnl-b.pnl).toBeCloseTo(.25,10);});
});