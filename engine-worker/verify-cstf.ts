/** Offline verification only. Reads prompt-71 cached public data; never sends hosted writes or Telegram. */
import { readFile, writeFile } from 'node:fs/promises';
import { CSTF_INTERVAL, CSTF_SYMBOLS, initialCstf, processCstf, type CstfSignal, type CstfSymbol } from '../src/lib/engine/cstf';
import { initialCstfAccount, processCstfAccount, type Brackets, type MinuteFrame, type CstfClose } from '../src/lib/engine/cstf-account';
import { MINUTE, type Candle } from '../src/lib/engine/model';

const root=process.argv[2]??'/tmp/r71';
type Raw={m30:number[][];m1:number[][];funding:{fundingTime:number;fundingRate:string}[]};
type RawBracket={bracketNotionalFloor:number;bracketNotionalCap:number;bracketMaintenanceMarginRate:number;cumFastMaintenanceAmount:number;maxOpenPosLeverage:number};
const read=async<T>(path:string):Promise<T>=>JSON.parse(await readFile(path,'utf8')) as T;
const meta=await read<{start:number;end:number}>(`${root}/raw/meta.json`);
const rawBrackets=await read<Record<CstfSymbol,RawBracket[]>>(`${root}/raw/brackets.json`);
const expected=await read<{events:{coin:string;side:string;signal_time:number;pattern:string}[];wallet:number;final_equity:number;curve:number[][];trades:{seq:number;coin:string;side:string;entry_time:number;entry:number;result:string;pnl:number;exit_time:number|null;exit_price:number}[]}>(`${root}/outMAIN.json`);
const pine=await read<Record<CstfSymbol,{long:number[];short:number[]}>>(`${root}/pinets_all.json`);
const brackets=Object.fromEntries(CSTF_SYMBOLS.map(s=>[s,rawBrackets[s].map(b=>({floor:b.bracketNotionalFloor,cap:b.bracketNotionalCap,rate:b.bracketMaintenanceMarginRate,cumulative:b.cumFastMaintenanceAmount,maxLeverage:b.maxOpenPosLeverage}))])) as Brackets;
function candle(row:number[]):Candle {
 const [time,open,high,low,close,volume=0]=row;
 if(time===undefined||open===undefined||high===undefined||low===undefined||close===undefined)throw new Error('Incomplete raw candle');
 return {time,open,high,low,close,volume};
}
const data=new Map<CstfSymbol,{last:Map<number,Candle>;mark:Map<number,Candle>;funding:Map<number,number[]>}>();
const allSignals:CstfSignal[]=[];
for(const symbol of CSTF_SYMBOLS){
 const raw=await read<Raw>(`${root}/raw/${symbol}.json`); const marks=await read<number[][]>(`${root}/raw/${symbol}.mark.json`);
 const state=initialCstf();
 for(const row of raw.m30){const c=candle(row);const signals=processCstf(state,symbol,c,c.time+CSTF_INTERVAL);allSignals.push(...signals.filter(s=>s.confirmTime>=meta.start&&s.confirmTime<meta.end));}
 const funding=new Map<number,number[]>();for(const f of raw.funding){const t=Math.floor(f.fundingTime/MINUTE)*MINUTE;funding.set(t,[...(funding.get(t)??[]),Number(f.fundingRate)]);}
 data.set(symbol,{last:new Map(raw.m1.map(r=>{const c=candle(r);return[c.time,c];})),mark:new Map(marks.map(r=>{const c=candle(r);return[c.time,c];})),funding});
}
allSignals.sort((a,b)=>a.confirmTime-b.confirmTime||a.symbol.localeCompare(b.symbol));
const keys=allSignals.map(s=>`${s.symbol}|${s.side}|${s.signalTime}|${s.pattern}`);
const expectedKeys=expected.events.map(s=>`${s.coin}|${s.side}|${s.signal_time}|${s.pattern}`);
if(JSON.stringify(keys)!==JSON.stringify(expectedKeys))throw new Error('Signal parity failure against prompt-71 Python');
const pineKeys=CSTF_SYMBOLS.flatMap(s=>['LONG','SHORT'].flatMap(side=>pine[s][side==='LONG'?'long':'short'].filter(t=>t+CSTF_INTERVAL>=meta.start&&t+CSTF_INTERVAL<meta.end).map(t=>`${s}|${side}|${t}`))).sort();
if(JSON.stringify(allSignals.map(s=>`${s.symbol}|${s.side}|${s.signalTime}`).sort())!==JSON.stringify(pineKeys))throw new Error('Signal parity failure against intact Pine interpreter');
const byMinute=new Map<number,CstfSignal[]>();for(const s of allSignals)byMinute.set(s.confirmTime,[...(byMinute.get(s.confirmTime)??[]),s]);
let state=initialCstfAccount();let equity=10;const closed:CstfClose[]=[];let skipped=0;let maxSlots=0;
for(let time=meta.start;time<meta.end;time+=MINUTE){
 const frame:MinuteFrame={time,last:{} as Record<CstfSymbol,Candle>,mark:{} as Record<CstfSymbol,Candle>,funding:{},signals:byMinute.get(time)??[],mode:'live'};
 for(const s of CSTF_SYMBOLS){const d=data.get(s);const last=d?.last.get(time);const mark=d?.mark.get(time);if(!last||!mark)throw new Error(`Missing ${s} at ${time}`);frame.last[s]=last;frame.mark[s]=mark;frame.funding[s]=d?.funding.get(time)??[];}
 const result=processCstfAccount(state,frame,brackets);state=result.state;equity=result.equity;closed.push(...result.closed);skipped+=result.skipped.length;maxSlots=Math.max(maxSlots,state.positions.length+result.closed.length);
 const curve=expected.curve[(time-meta.start)/MINUTE];
 if(!curve||curve[0]!==time+MINUTE||curve[1]===undefined||curve[3]===undefined||Math.abs(curve[1]-equity)>1e-8||curve[2]!==state.positions.length||Math.abs(curve[3]-state.wallet)>1e-8)throw new Error(`Minute equity/wallet mismatch at ${time}`);
}
if(Math.abs(state.wallet-expected.wallet)>1e-8||Math.abs(equity-expected.final_equity)>1e-8)throw new Error('Wallet/equity replay mismatch');
const replayTrades=[...closed.map(c=>({symbol:c.position.signal.symbol,side:c.position.signal.side,time:c.position.entryTime,entry:c.position.entry,net:c.net,exitTime:c.time,exitPrice:c.price})),...state.positions.map(p=>({symbol:p.signal.symbol,side:p.signal.side,time:p.entryTime,entry:p.entry,net:null,exitTime:null,exitPrice:null}))].sort((a,b)=>a.time-b.time||a.symbol.localeCompare(b.symbol));
const originalTrades=[...expected.trades].sort((a,b)=>a.entry_time-b.entry_time||a.coin.localeCompare(b.coin));
if(replayTrades.length!==originalTrades.length)throw new Error('Trade count mismatch');
for(const [i,t] of replayTrades.entries()){const old=originalTrades[i];if(!old||old.coin!==t.symbol||old.side!==t.side||old.entry_time!==t.time||Math.abs(old.entry-t.entry)>1e-9||old.exit_time!==t.exitTime||(t.exitPrice!==null&&Math.abs(old.exit_price-t.exitPrice)>1e-9)||(t.net!==null&&Math.abs(old.pnl-t.net)>1e-8))throw new Error(`Trade mismatch at ${i}`);}
const result={signals:allSignals.length,pythonSignalMismatch:0,intactPineWindowMismatch:0,trades:replayTrades.length,closed:closed.length,open:state.positions.length,skipped,wallet:state.wallet,equity,maxSlots,fees:state.fees,funding:state.funding,tradeMismatch:0,minuteAccountChecks:expected.curve.length,scope:'Offline only; not a deployed-worker, database-transaction, or Telegram check'};
await writeFile(`${root}/native-verification.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));