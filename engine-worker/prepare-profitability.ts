/** Public candle downloads only; no hosted database, service startup or notifications. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SYMBOLS } from '../src/lib/config';
import { MINUTE, validateCandle, type Candle } from '../src/lib/engine/model';
import { prepareExperimentalFeed, type Funding, type MarketRules } from '../src/lib/engine/profitability-replay';
import { binanceFetch, history } from './binance';
import protocol from './profitability-protocol.json';

const dir='/tmp/profitability-study';await mkdir(dir,{recursive:true});
const from=Date.parse(protocol.from);const to=Date.parse(protocol.to);const warm=from-protocol.warmupDays*86400000;
const meta=JSON.parse(await readFile(`${dir}/exchange-info.json`,'utf8')) as {symbols:{symbol:string;status:string;filters:{filterType:string;tickSize?:string;stepSize?:string;minQty?:string;maxQty?:string;notional?:string}[]}[]};
const available=SYMBOLS.filter(s=>meta.symbols.some(m=>m.symbol===s && m.status==='TRADING'));
const queue=[...available];const sources:unknown[]=[];
async function run(){while(queue.length){const symbol=queue.shift();if(!symbol) return; const m=meta.symbols.find(m=>m.symbol===symbol);if(!m)throw new Error(symbol);
  const price=m.filters.find(f=>f.filterType==='PRICE_FILTER');const lot=m.filters.find(f=>f.filterType==='MARKET_LOT_SIZE');
  const rules:MarketRules={tick:Number(price?.tickSize),step:Number(lot?.stepSize),minQuantity:Number(lot?.minQty),maxQuantity:Number(lot?.maxQty),minNotional:Number(m.filters.find(f=>f.filterType==='MIN_NOTIONAL')?.notional)};
  if(Object.values(rules).some(x=>!(x>0)))throw new Error(`Invalid filters ${symbol}`);
  const file=`${dir}/${symbol}-raw.json`;let raw:{bars:Candle[];funding:Funding[]};
  try{raw=JSON.parse(await readFile(file,'utf8'));}catch{
    const bars:Candle[]=[];let t=warm;
    while(t<to){const part=await history(symbol,t,to);const last=part.at(-1);if(!last)throw new Error(`Missing ${symbol} ${t}`);bars.push(...part);t=last.time+MINUTE;}
    const fr=await binanceFetch(`/fapi/v1/fundingRate?symbol=${symbol}&startTime=${from}&endTime=${to-1}&limit=1000`);
    if(!Array.isArray(fr))throw new Error('Invalid funding');
    const funding=fr.map(r=>({time:Number(r.fundingTime),rate:Number(r.fundingRate),mark:Number(r.markPrice)}));
    if(funding.some(r=>!Number.isFinite(r.rate)||!(r.mark>0)))throw new Error(`Invalid funding ${symbol}`);
    raw={bars,funding};await writeFile(file,JSON.stringify(raw));
  }
  if(raw.bars.length!==(to-warm)/MINUTE)throw new Error(`Incomplete ${symbol}`);
  raw.bars.forEach((c,i)=>{validateCandle(c);if(c.time!==warm+i*MINUTE)throw new Error(`Gap ${symbol}`);});
  const f=prepareExperimentalFeed(symbol,rules,raw.bars,raw.funding,from);await writeFile(`${dir}/${symbol}-feed.json`,JSON.stringify(f));
  sources.push({symbol,rules,candles:raw.bars.length,windowCandles:f.candles.length,fundingRecords:raw.funding.length,rawSha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),signalCount:f.signalCount,candidates:f.candidates.length,rejected:f.rejection});
  console.log(`${symbol}: verified ${raw.bars.length} candles; ${f.signalCount} breakevens; ${f.candidates.length} confirmed candidates`);
}}
await Promise.all([run(),run(),run(),run()]);
await writeFile(`${dir}/sources.json`,JSON.stringify({protocol,missing:SYMBOLS.filter(s=>!available.includes(s)),sources},null,2));
console.log('PREPARATION COMPLETE');