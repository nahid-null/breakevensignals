// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/cstf-eth-30m.json';
import { CSTF_INTERVAL, CSTF_SYMBOLS, initialCstf, processCstf, type CstfSignal, type CstfSymbol } from '../lib/engine/cstf';
import { CSTF_RULES, cstfMarginFor, cstfLiquidationPrice, cstfMaintenance, cstfTarget, initialCstfAccount, processCstfAccount, type Brackets, type CstfPosition, type MinuteFrame } from '../lib/engine/cstf-account';
import { MINUTE, type Candle } from '../lib/engine/model';
const time=30*MINUTE;
function candle(time:number,open=100,high=100.01,low=99.99,close=100):Candle { return {time,open,high,low,close,volume:1}; }
const signal=(symbol:CstfSymbol='ETHUSDT',side:'LONG'|'SHORT'='LONG',confirmTime=time):CstfSignal=>({id:`CSTF30-${symbol}-${side}-${confirmTime-CSTF_INTERVAL}`,symbol,side,pattern:'Hammer',signalTime:confirmTime-CSTF_INTERVAL,confirmTime,close:100,atr:1});
function frame(t=time, signals:CstfSignal[]=[]):MinuteFrame { return {time:t,last:Object.fromEntries(CSTF_SYMBOLS.map(s=>[s,candle(t)])) as Record<CstfSymbol,Candle>,mark:Object.fromEntries(CSTF_SYMBOLS.map(s=>[s,candle(t)])) as Record<CstfSymbol,Candle>,funding:{},signals,mode:'live'}; }
const brackets=Object.fromEntries(CSTF_SYMBOLS.map(s=>[s,[{floor:0,cap:100000,rate:.004,cumulative:0,maxLeverage:150},{floor:100000,cap:1000000,rate:.005,cumulative:100,maxLeverage:100}]])) as Brackets;
const first=(positions:CstfPosition[])=>{const p=positions[0];if(!p)throw new Error('Expected open position');return p;};

describe('prompt-72 original CSTF default signal rules',()=>{
 for (const side of ['LONG', 'SHORT'] as const) it(`prompt-76: every genuine fixture ${side} signal enters in its first eligible minute without another confirmation`, () => {
  const indicator = initialCstf(); const signals: CstfSignal[] = [];
  for (const row of fixture.bars) {
   const [t, o, h, l, c, v] = row;
   if (t === undefined || o === undefined || h === undefined || l === undefined || c === undefined || v === undefined) throw new Error('Incomplete fixture');
   signals.push(...processCstf(indicator, 'ETHUSDT', { time: t, open: o, high: h, low: l, close: c, volume: v }, t + CSTF_INTERVAL));
  }
  const selected = signals.filter(s => s.side === side);
  expect(selected).toHaveLength(7);
  for (const s of selected) {
   const execution = frame(s.confirmTime, [s]);
   execution.last.ETHUSDT = candle(s.confirmTime, s.close, s.close * 1.00001, s.close * .99999, s.close);
   execution.mark.ETHUSDT = { ...execution.last.ETHUSDT };
   const result = processCstfAccount(initialCstfAccount(), execution, brackets);
   expect(result.skipped).toEqual([]);
   expect(result.opened).toHaveLength(1);
   expect(result.opened[0]?.signal).toEqual(s);
   expect(result.opened[0]?.entryTime).toBe(s.signalTime + CSTF_INTERVAL);
   expect(result.opened[0]?.margin).toBeCloseTo(.50, 12);
  }
 });
 it('matches every original backtest signal on 400 real ETHUSDT 30m candles',()=>{
  const state=initialCstf();const actual:CstfSignal[]=[];
  for(const x of fixture.bars){const [t,o,h,l,c,v]=x;if(t===undefined||o===undefined||h===undefined||l===undefined||c===undefined||v===undefined)throw new Error('Incomplete fixture'); actual.push(...processCstf(state,'ETHUSDT',{time:t,open:o,high:h,low:l,close:c,volume:v},t+CSTF_INTERVAL));}
  expect(actual.map(s=>({time:s.signalTime,side:s.side,pattern:s.pattern,close:s.close}))).toEqual(fixture.signals);
  expect(actual.filter(s=>s.side==='LONG')).toHaveLength(7);expect(actual.filter(s=>s.side==='SHORT')).toHaveLength(7);
 });
 it('refuses unconfirmed 30m candles without altering indicator state',()=>{
  const state=initialCstf(); expect(()=>processCstf(state,'ETHUSDT',candle(0),CSTF_INTERVAL-1)).toThrow('confirmed');expect(state.count).toBe(0);
 });
 it('deduplicates confirmed signal candles',()=>{
  const state=initialCstf();processCstf(state,'ETHUSDT',candle(0),CSTF_INTERVAL);const saved=structuredClone(state);
  expect(processCstf(state,'ETHUSDT',candle(0),CSTF_INTERVAL)).toEqual([]);expect(state).toEqual(saved);
 });
 it('requires gap recovery and rejects other timeframes',()=>{
  const state=initialCstf();processCstf(state,'ETHUSDT',candle(0),CSTF_INTERVAL);
  expect(()=>processCstf(state,'ETHUSDT',candle(2*CSTF_INTERVAL),3*CSTF_INTERVAL)).toThrow('gap');
  expect(()=>processCstf(initialCstf(),'ETHUSDT',candle(MINUTE),2*CSTF_INTERVAL)).toThrow('30-minute');
 });
 it('contains exactly the requested 22 trading pairs and no BTC or DOGE',()=>{
  expect(CSTF_SYMBOLS).toEqual(['ZENUSDT','GALAUSDT','SUSDT','ETHUSDT','SOLUSDT','XRPUSDT','LINKUSDT','NEARUSDT','BCHUSDT','LTCUSDT','ADAUSDT','AVAXUSDT','TRXUSDT','BNBUSDT','UNIUSDT','WLDUSDT','WIFUSDT','CRVUSDT','EGLDUSDT','FILUSDT','SANDUSDT','HBARUSDT']);
 });
});
describe('prompt-72 exact prompt-71 shared-cross paper accounting',()=>{
 it('starts at $10 and enters at next-minute OPEN with 75x and $0.50 (5% of $10)',()=>{
  const f=frame(time,[signal()]);f.last.ETHUSDT=candle(time,101,101.1,100.9,101);
  const original=initialCstfAccount();const r=processCstfAccount(original,f,brackets);const p=first(r.state.positions);
  expect(original.wallet).toBe(10);expect(original.positions).toHaveLength(0);expect(p.entry).toBeCloseTo(101*1.0002,12);
  expect(p.margin).toBeCloseTo(.50,12);expect(p.quantity*p.entry/p.margin).toBeCloseTo(75,12);expect(p.entryTime).toBe(time);expect(p.entryFee).toBeCloseTo(.01875,12);expect(r.state.wallet).toBeCloseTo(9.98125,12);
 });
 // prompt-75: margin per new trade is 5% of the CURRENT main balance (user's own table)
 for(const [wallet,margin] of [[10,.50],[11,.55],[12,.60],[15,.75],[20,1.00],[25,1.25],[30,1.50],[50,2.50],[8,.40]] as const)it(`opens with $${margin.toFixed(2)} margin when the balance is $${wallet.toFixed(2)}`,()=>{
  const state=initialCstfAccount();state.wallet=wallet;const p=first(processCstfAccount(state,frame(time,[signal()]),brackets).state.positions);
  expect(p.margin).toBeCloseTo(margin,12);expect(p.quantity*p.entry/p.margin).toBeCloseTo(75,12);
 });
 it('after a win the next trade uses the larger balance, and the open trade keeps its original margin',()=>{
  const a=processCstfAccount(initialCstfAccount(),frame(time,[signal('ETHUSDT')]),brackets);const ethMargin=first(a.state.positions).margin;expect(ethMargin).toBeCloseTo(.50,12);
  const s=structuredClone(a.state);s.wallet=12-first(a.state.positions).entryFee;const t=time+CSTF_INTERVAL;s.lastMinute=t-MINUTE;
  const b=processCstfAccount(s,frame(t,[signal('SOLUSDT','LONG',t)]),brackets);
  const eth=b.state.positions.find(p=>p.signal.symbol==='ETHUSDT');const sol=b.state.positions.find(p=>p.signal.symbol==='SOLUSDT');
  expect(eth?.margin).toBeCloseTo(.50,12);expect(sol?.margin).toBeCloseTo(.60,12);
 });
 it('take profit is 20% of that trade\'s own margin, net: $0.60 margin closes at exactly +$0.12',()=>{
  const s=initialCstfAccount();s.wallet=12;const start=processCstfAccount(s,frame(time,[signal()]),brackets);const p=first(start.state.positions);
  const next=frame(time+MINUTE);next.last.ETHUSDT=candle(next.time,100,p.target,99.99,100);const r=processCstfAccount(start.state,next,brackets);
  expect(r.closed[0]?.net).toBeCloseTo(.12,12);expect(r.state.wallet).toBeCloseTo(12.12,12);
 });
 it('a liquidation that empties the balance means no further trade can open',()=>{
  expect(cstfMarginFor(0)).toBe(0);const s=initialCstfAccount();s.wallet=0;expect(processCstfAccount(s,frame(time,[signal()]),brackets).skipped[0]?.reason).toBe('INSUFFICIENT_AVAILABLE_MARGIN');
 });
 it('fixed-initial sizing reproduces the prompt-71 backtest only for parity checks',()=>{
  const s=initialCstfAccount();s.wallet=30;expect(first(processCstfAccount(s,frame(time,[signal()]),brackets,'fixed-initial').state.positions).margin).toBeCloseTo(.50,12);
 });
 for(const side of ['LONG','SHORT'] as const)it(`${side} closes at exactly $0.10 NET, not $0.10 plus another fee-adjusted target`,()=>{
  const start=processCstfAccount(initialCstfAccount(),frame(time,[signal('ETHUSDT',side)]),brackets);const p=first(start.state.positions);const next=frame(time+MINUTE);
  next.last.ETHUSDT=candle(next.time,100,Math.max(100.01,p.target),Math.min(99.99,p.target),100);
  const result=processCstfAccount(start.state,next,brackets);expect(result.closed).toHaveLength(1);const close=result.closed[0];if(!close)throw new Error('Missing close');
  expect(close.reason).toBe('TAKE_PROFIT');expect(close.net).toBeCloseTo(.10,12);expect(result.state.wallet).toBeCloseTo(10.10,12);expect(close.exitFee).toBeGreaterThan(0);expect(result.state.positions).toHaveLength(0);
 });
 it('includes real funding in wallet and re-solves target to preserve $0.10 net',()=>{
  const start=processCstfAccount(initialCstfAccount(),frame(time,[signal()]),brackets);const p=first(start.state.positions);const f=frame(time+MINUTE);f.funding.ETHUSDT=[.001];
  const pending=processCstfAccount(start.state,f,brackets);const funded=first(pending.state.positions);expect(funded.funding).toBeCloseTo(p.quantity*100*.001,12);expect(funded.target).toBeGreaterThan(p.target);
  const last=frame(time+2*MINUTE);last.last.ETHUSDT=candle(last.time,100,funded.target,99.99,100);const r=processCstfAccount(pending.state,last,brackets);
  expect(r.closed[0]?.net).toBeCloseTo(.10,12);expect(r.state.wallet).toBeCloseTo(10.10,12);
 });
 it('allows seven simultaneous same-coin slots and skips the eighth without replacement',()=>{
  let state=initialCstfAccount();for(let i=0;i<8;i++){const t=time+i*CSTF_INTERVAL;state.lastMinute=t-MINUTE;const r=processCstfAccount(state,frame(t,[signal('ETHUSDT','LONG',t)]),brackets);state=r.state;if(i===7)expect(r.skipped[0]?.reason).toBe('ALL_SLOTS_IN_USE');}
  expect(state.positions).toHaveLength(7);for(const p of state.positions)expect(p.margin).toBeCloseTo(.50,12);
 });
 it('uses whole wallet plus other slots unrealized P&L, not isolated $0.50 collateral',()=>{
  const r=processCstfAccount(initialCstfAccount(),frame(time,[signal()]),brackets);const p=first(r.state.positions);const marks=Object.fromEntries(CSTF_SYMBOLS.map(s=>[s,100])) as Record<CstfSymbol,number>;
  const expected=Math.max((r.state.wallet-p.quantity*p.entry)/(p.quantity*.004-p.quantity),0);
  expect(cstfLiquidationPrice(p,r.state,marks,brackets)).toBeCloseTo(expected,12);expect(p.liquidationPrice).toBeLessThan(80);
  const f=frame(time+MINUTE);f.mark.ETHUSDT=candle(f.time,100,100,90,100);expect(processCstfAccount(r.state,f,brackets).state.positions).toHaveLength(1);
 });
 it('applies Binance maintenance rate and cumulative deduction at the active notional tier',()=>{
  const p=first(processCstfAccount(initialCstfAccount(),frame(time,[signal()]),brackets).state.positions);
  expect(cstfMaintenance(p,100,brackets)).toBeCloseTo(p.quantity*100*.004,12);
  const high=200000/p.quantity;expect(cstfMaintenance(p,high,brackets)).toBeCloseTo(200000*.005-100,10);
 });
 it('liquidates every shared slot before TP when worst MARK equity breaches maintenance',()=>{
  const r=processCstfAccount(initialCstfAccount(),frame(time,[signal(),signal('SOLUSDT','SHORT')]),brackets);const f=frame(time+MINUTE);
  f.mark.ETHUSDT=candle(f.time,100,100,50,100);f.mark.SOLUSDT=candle(f.time,100,150,100,100);f.last.ETHUSDT=candle(f.time,100,105,99.99,100);
  const out=processCstfAccount(r.state,f,brackets);expect(out.closed).toHaveLength(2);expect(out.closed.map(x=>x.reason)).toEqual(['LIQUIDATED','LIQUIDATED']);expect(out.state.wallet).toBe(0);expect(out.state.positions).toHaveLength(0);
 });
 it('last-price TP and mark-price liquidation are distinct sources',()=>{
  const r=processCstfAccount(initialCstfAccount(),frame(time,[signal()]),brackets);const p=first(r.state.positions);const f=frame(time+MINUTE);f.mark.ETHUSDT=candle(f.time,100,p.target+1,99.99,100);
  expect(processCstfAccount(r.state,f,brackets).closed).toHaveLength(0);
 });
 it('deduplicates whole-account minute retries including funding and trade entries',()=>{
  const f=frame(time,[signal()]);const r=processCstfAccount(initialCstfAccount(),f,brackets);const retry=processCstfAccount(r.state,f,brackets);expect(retry.duplicate).toBe(true);expect(retry.state).toEqual(r.state);expect(retry.opened).toEqual([]);
 });
 it('rejects incomplete cross-account feeds before mutating the wallet',()=>{
  const f=frame();f.mark.ETHUSDT=candle(f.time-MINUTE);const state=initialCstfAccount();expect(()=>processCstfAccount(state,f,brackets)).toThrow('Incomplete');expect(state.wallet).toBe(10);
 });
 it('suppresses recovery entries and marks recovered exits as non-live',()=>{
  const f=frame(time,[signal()]);f.mode='recovery';expect(processCstfAccount(initialCstfAccount(),f,brackets).skipped[0]?.reason).toBe('NOT_LIVE');
  const r=processCstfAccount(initialCstfAccount(),frame(time,[signal()]),brackets);const p=first(r.state.positions);const next=frame(time+MINUTE);next.mode='recovery';next.last.ETHUSDT=candle(next.time,100,p.target,99.99,100);expect(processCstfAccount(r.state,next,brackets).closed[0]?.notify).toBe(false);
 });
 it('skips insufficient available cross margin including the entry fee',()=>{
  const state=initialCstfAccount();state.wallet=.51;const r=processCstfAccount(state,frame(time,[signal()]),brackets,'fixed-initial');expect(r.skipped[0]?.reason).toBe('INSUFFICIENT_AVAILABLE_MARGIN');expect(r.state.wallet).toBe(.51);
 });
 it('keeps positions indefinitely without adding a stop or time exit',()=>{
  let state=processCstfAccount(initialCstfAccount(),frame(time,[signal()]),brackets).state;
  for(let i=1;i<=1500;i++)state=processCstfAccount(state,frame(time+i*MINUTE),brackets).state;
  expect(state.positions).toHaveLength(1);expect(first(state.positions).entryTime).toBe(time);
 });
 it('keeps backtest entry-before-exit ordering when all seven slots are occupied',()=>{
  let state=initialCstfAccount();for(let i=0;i<7;i++){const t=time+i*CSTF_INTERVAL;state.lastMinute=t-MINUTE;state=processCstfAccount(state,frame(t,[signal('ETHUSDT','LONG',t)]),brackets).state;}
  const t=time+7*CSTF_INTERVAL;state.lastMinute=t-MINUTE;const f=frame(t,[signal('SOLUSDT','LONG',t)]);f.last.ETHUSDT=candle(t,100,101,99.99,100);const r=processCstfAccount(state,f,brackets);
  expect(r.skipped[0]?.reason).toBe('ALL_SLOTS_IN_USE');expect(r.closed).toHaveLength(7);expect(r.opened).toHaveLength(0);
 });
 it('enforces 75x availability instead of silently lowering leverage',()=>{
  const tiers=structuredClone(brackets);tiers.ETHUSDT[0]={floor:0,cap:100000,rate:.004,cumulative:0,maxLeverage:50};
  expect(processCstfAccount(initialCstfAccount(),frame(time,[signal()]),tiers).skipped[0]?.reason).toBe('LEVERAGE_UNAVAILABLE');
 });
 it('includes $0.10 exactly once in the TP formula',()=>{
  const p=first(processCstfAccount(initialCstfAccount(),frame(time,[signal()]),brackets).state.positions);
  expect(cstfTarget(p)).toBeCloseTo((.10+.01875+p.quantity*p.entry)/(p.quantity*.9995)/.9998,12);expect(CSTF_RULES.targetRate*p.margin).toBeCloseTo(.10,12);
 });
});