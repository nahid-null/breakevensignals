/** Read-only experiment; not imported by the website or live worker. */
import Decimal from 'decimal.js';
import { type Direction, type Symbol } from '../config';
import { initialState, MINUTE, validateCandle, type Candle, type Signal } from './model';
import { emptyTimeframe } from './mtf-trend';
import { processCandle } from './scalper';
import { ema } from './calculations';

const D = (v: Decimal.Value) => new Decimal(v);
const sign = (s: Direction) => s === 'LONG' ? 1 : -1;
export interface ExperimentalConfig { id: string; direction: Direction; leverage: number; marginShare: number; rr: number }
export interface MarketRules { tick: number; step: number; minQuantity: number; maxQuantity: number; minNotional: number }
export interface Funding { time: number; rate: number; mark: number }
export interface Candidate { time: number; signal: Signal; trigger: number; confirmClose: number; trend15: number; ema9: number; ema21: number }
export interface ExperimentalFeed { symbol: Symbol; rules: MarketRules; candles: Candle[]; funding: Funding[]; candidates: Candidate[]; signalCount: number; rejection: Record<string, number> }
export interface CostModel { fee: number; bps: number; ticks: number; maintenance: number }
export const EXPERIMENTAL_COST: CostModel = { fee: .0005, bps: 5, ticks: 1, maintenance: .01 };
export function experimentalConfigs(): ExperimentalConfig[] {
  const out: ExperimentalConfig[] = [];
  for (const direction of ['LONG','SHORT'] as Direction[]) for (const leverage of [10,20]) for (const marginShare of [.05,.1]) for (const rr of [1,1.5,2])
    out.push({ id: `${direction}-${leverage}x-${marginShare*100}pct-netRR${rr}`, direction, leverage, marginShare, rr });
  return out;
}
export function confirmationReason(signal: Signal, candle: Candle, trend15: number | null, e9: number, e21: number) {
  const s = sign(signal.direction);
  const trigger = signal.entry_price + s * Math.abs(signal.take_profit - signal.entry_price) / 1.5;
  if (trend15 !== s) return '15M_TREND';
  if (!(s * (e9-e21) > 0)) return '5M_EMA9_21';
  if (!(s*(candle.close-candle.open)>0 && s*(candle.close-trigger)>0)) return '1M_CLOSE';
  return null;
}
export function prepareExperimentalFeed(symbol: Symbol, rules: MarketRules, bars: Candle[], funding: Funding[], from: number): ExperimentalFeed {
  const state = initialState(symbol, rules.tick);
  state.mtf = { m15: emptyTimeframe(15), m5: emptyTimeframe(5), m1: emptyTimeframe(1) };
  let e9: number | null = null; let e21: number | null = null; let pending: Signal[] = [];
  const candidates: Candidate[] = []; const rejection: Record<string, number> = {}; let signalCount = 0;
  for (const c of bars) {
    validateCandle(c);
    const r = processCandle(state,c);
    if ((c.time+MINUTE) % (5*MINUTE) === 0) { e9=ema(e9,c.close,9); e21=ema(e21,c.close,21); }
    if (c.time >= from && e9 !== null && e21 !== null) for (const signal of pending) {
      const reason = confirmationReason(signal,c,state.mtf.m15.trend,e9,e21);
      if (reason) rejection[reason]=(rejection[reason]??0)+1;
      else candidates.push({time:c.time+MINUTE,signal,trigger:signal.entry_price+sign(signal.direction)*Math.abs(signal.take_profit-signal.entry_price)/1.5,
        confirmClose:c.close,trend15:state.mtf.m15.trend ?? 0,ema9:e9,ema21:e21});
    }
    pending = r.signals.filter(e=>e.event==='breakeven_activated' && c.time>=from);
    signalCount += pending.length;
  }
  return {symbol,rules,candles:bars.filter(c=>c.time>=from),funding,candidates,signalCount,rejection};
}
export interface ExperimentalPosition {
  symbol: Symbol; direction: Direction; time: number; entry: number; stop: number; target: number; liquidation: number;
  quantity: number; margin: number; entryFee: number; funding: number; equityBefore: number; entrySlippage: number; expectedRisk: number;
  candidate: Candidate;
}
function roundTick(v: number, tick: number, upward: boolean) { return D(v).div(tick).toDecimalPlaces(0,upward?Decimal.ROUND_CEIL:Decimal.ROUND_FLOOR).mul(tick).toNumber(); }
export function adverseFill(px: number, direction: Direction, entry: boolean, rules: MarketRules, cost: CostModel) {
  const s=sign(direction)*(entry?1:-1);
  return roundTick(px*(1+s*cost.bps/10000)+s*rules.tick*cost.ticks,rules.tick,s>0);
}
export function experimentalPosition(candidate: Candidate, candle: Candle, rules: MarketRules, balance: number, cfg: ExperimentalConfig, cost=EXPERIMENTAL_COST): { position: ExperimentalPosition | null; reason: string | null } {
  const s=sign(cfg.direction); const entry=adverseFill(candle.open,cfg.direction,true,rules,cost);
  const margin=D(balance).mul(cfg.marginShare).toDecimalPlaces(8).toNumber();
  const q=D(margin).mul(cfg.leverage).div(entry).div(rules.step).floor().mul(rules.step).toNumber();
  const notional=D(q).mul(entry).toNumber();
  if(q<rules.minQuantity || q>rules.maxQuantity || notional<rules.minNotional) return {position:null,reason:'EXCHANGE_MINIMUM_OR_LOT'};
  const entryFee=notional*cost.fee;
  if(margin+entryFee>balance) return {position:null,reason:'INSUFFICIENT_AVAILABLE_BALANCE'};
  const stop=roundTick(candidate.signal.stop_loss,rules.tick,s<0);
  const liquidation=entry*(1-s*(1/cfg.leverage-cost.maintenance));
  if(s*(entry-stop)<=0 || s*(stop-liquidation)<=0) return {position:null,reason:'INVALID_OR_BEYOND_LIQUIDATION_STOP'};
  const stopFill=adverseFill(stop,cfg.direction,false,rules,cost);
  const expectedRisk=-(q*(stopFill-entry)*s-entryFee-q*stopFill*cost.fee);
  const targetFill=(s*entry+(expectedRisk*cfg.rr+entryFee)/q)/(s-cost.fee);
  const rawTarget=(targetFill+s*rules.tick*cost.ticks)/(1-s*cost.bps/10000);
  const target=roundTick(rawTarget,rules.tick,s>0);
  return {reason:null,position:{symbol:candidate.signal.symbol,direction:cfg.direction,time:candle.time,entry,stop,target,liquidation,quantity:q,margin,entryFee,funding:0,equityBefore:balance,
    entrySlippage:q*Math.abs(entry-candle.open),expectedRisk,candidate}};
}
export interface ExperimentalTrade extends ExperimentalPosition { exitTime: number; exit: number; reason: string; pricePnl: number; exitFee: number; pnl: number; balanceAfter: number; slippage: number }
export function settleExperimental(p: ExperimentalPosition, raw: number, reason: string, time: number, rules: MarketRules, balance: number, cost=EXPERIMENTAL_COST): ExperimentalTrade {
  const exit=adverseFill(raw,p.direction,false,rules,cost); const exitFee=p.quantity*exit*cost.fee;
  const pricePnl=reason==='LIQUIDATED'?-p.margin:p.quantity*(exit-p.entry)*sign(p.direction);
  const pnl=pricePnl-p.entryFee-exitFee-p.funding;
  return {...p,exitTime:time,exit,reason,pricePnl,exitFee,pnl,balanceAfter:Math.max(0,balance+pnl),slippage:p.entrySlippage+p.quantity*Math.abs(exit-raw)};
}
export function replayExperimental(feeds: ExperimentalFeed[], from: number, to: number, cfg: ExperimentalConfig, startingBalance: number, cost=EXPERIMENTAL_COST) {
  const indexed=feeds.map(f=>({...f,bars:new Map(f.candles.map(c=>[c.time,c])),events:new Map(f.candidates.filter(c=>c.signal.direction===cfg.direction).map(c=>[c.time,c])),fundingAt:new Map(f.funding.map(x=>[x.time,x]))}));
  let balance=startingBalance; let peak=balance; let maxDd=0; let open: ExperimentalPosition | null=null;
  const trades: ExperimentalTrade[]=[]; const rejected: Record<string,number>={}; let candidates=0;
  const reject=(reason:string)=>{rejected[reason]=(rejected[reason]??0)+1;};
  for(let time=from;time<to;time+=MINUTE) {
    for(const f of indexed) {
      const c=f.bars.get(time); if(!c) throw new Error(`Missing ${f.symbol} ${time}`);
      const e=f.events.get(time);
      if(e){ candidates++; if(open) reject('TRADE_ALREADY_OPEN'); else { const r=experimentalPosition(e,c,f.rules,balance,cfg,cost); open=r.position; if(r.reason) reject(r.reason); } }
      if(!open || open.symbol!==f.symbol) continue;
      const p=open; const s=sign(p.direction); const funding=f.fundingAt.get(time);
      if(funding && time>=p.time) p.funding+=p.quantity*funding.mark*funding.rate*s;
      const stopHit=s===1?c.low<=p.stop:c.high>=p.stop; const targetHit=s===1?c.high>=p.target:c.low<=p.target;
      const gapLiq=s===1?c.open<=p.liquidation:c.open>=p.liquidation;
      let raw: number | null=null; let reason='';
      if(gapLiq){raw=c.open;reason='LIQUIDATED';}
      else if(stopHit){raw=s===1?Math.min(c.open,p.stop):Math.max(c.open,p.stop);reason='STOP_LOSS';}
      else if(targetHit){raw=p.target;reason='TAKE_PROFIT';}
      else if(time===to-MINUTE){raw=c.close;reason='PARTITION_END';}
      const marked=balance+p.quantity*(c.close-p.entry)*s-p.entryFee-p.funding-p.quantity*c.close*cost.fee;
      peak=Math.max(peak,marked); maxDd=Math.max(maxDd,(peak-marked)/peak*100);
      if(raw!==null){const t=settleExperimental(p,raw,reason,time+MINUTE,f.rules,balance,cost); trades.push(t); balance=t.balanceAfter; open=null;
        peak=Math.max(peak,balance);maxDd=Math.max(maxDd,(peak-balance)/peak*100);}
    }
  }
  const wins=trades.filter(t=>t.pnl>0);const losses=trades.filter(t=>t.pnl<0);const sum=(ts:ExperimentalTrade[],key:'pnl'|'entryFee'|'exitFee'|'funding'|'slippage')=>ts.reduce((v,t)=>v+t[key],0);
  const positive=sum(wins,'pnl');const negative=-sum(losses,'pnl');
  const daily:Record<string,number>={};for(let t=from;t<to;t+=86400000)daily[new Date(t).toISOString().slice(0,10)]=0;
  for(const t of trades){const day=new Date(t.exitTime-1).toISOString().slice(0,10);daily[day]=(daily[day]??0)+t.pnl/t.equityBefore;}
  return {config:cfg,startingBalance,from,to,cost,netProfit:balance-startingBalance,returnPct:(balance/startingBalance-1)*100,endingBalance:balance,tradeCount:trades.length,wins:wins.length,losses:losses.length,
    winRate:trades.length?wins.length/trades.length*100:null,profitFactor:negative?positive/negative:null,maxDrawdownPct:maxDd,averageWin:wins.length?positive/wins.length:0,averageLoss:losses.length?-negative/losses.length:0,
    totalFees:sum(trades,'entryFee')+sum(trades,'exitFee'),fundingNetPaid:sum(trades,'funding'),slippageCost:sum(trades,'slippage'),liquidations:trades.filter(t=>t.reason==='LIQUIDATED').length,
    activeDays:new Set(trades.map(t=>new Date(t.exitTime-1).toISOString().slice(0,10))).size,candidates,rejected,daily,trades,open,
    reconciliationError:balance-startingBalance-sum(trades,'pnl')};
}