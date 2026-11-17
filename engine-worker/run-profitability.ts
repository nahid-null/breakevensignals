/** Chronological offline experiment; selection is persisted before later periods are evaluated. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { experimentalConfigs, EXPERIMENTAL_COST, replayExperimental, type ExperimentalFeed } from '../src/lib/engine/profitability-replay';
import protocol from './profitability-protocol.json';
const dir='/tmp/profitability-study';await mkdir(`${dir}/ledgers`,{recursive:true});
const source=JSON.parse(await readFile(`${dir}/sources.json`,'utf8')) as {sources:{symbol:string}[]};
const feeds:ExperimentalFeed[]=[];for(const s of source.sources)feeds.push(JSON.parse(await readFile(`${dir}/${s.symbol}-feed.json`,'utf8')));
// Restore configured symbol order rather than nondeterministic download completion order.
const { SYMBOLS }=await import('../src/lib/config');feeds.sort((a,b)=>SYMBOLS.indexOf(a.symbol)-SYMBOLS.indexOf(b.symbol));
const configs=experimentalConfigs();const from=Date.parse(protocol.from);const devEnd=Date.parse(protocol.developmentEnd);const valEnd=Date.parse(protocol.validationEnd);const to=Date.parse(protocol.to);
type Result=ReturnType<typeof replayExperimental>;
function compact(r:Result){const {trades,open,...rest}=r;return {...rest,openCount:open?1:0};}
function bootstrap(r:Result){let seed=protocol.bootstrap.seed;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const days=Object.values(r.daily);const samples:number[]=[];
  for(let i=0;i<protocol.bootstrap.resamples;i++){let sum=0;for(let j=0;j<days.length;j++)sum+=days[Math.floor(rand()*days.length)]??0;samples.push(sum/(r.tradeCount||1));}
  samples.sort((a,b)=>a-b);return {lower95:samples[Math.floor(samples.length*.025)]??0,upper95:samples[Math.floor(samples.length*.975)]??0,mean:days.reduce((a,b)=>a+b,0)/(r.tradeCount||1)};}
function developmentEligible(r:Result){return r.tradeCount>=100 && r.activeDays>=10 && r.netProfit>0 && (r.profitFactor??0)>=1.1;}
const development:ReturnType<typeof compact>[]=[];
for(const balance of protocol.startingBalances)for(const cfg of configs){const r=replayExperimental(feeds,from,devEnd,cfg,balance);await writeFile(`${dir}/ledgers/development-${balance}-${cfg.id}.json`,JSON.stringify(r));development.push(compact(r));}
const selection=protocol.directions.map(direction=>{const all=development.filter(r=>r.startingBalance===1000 && r.config.direction===direction);const eligible=all.filter(developmentEligible);const rank=(rs:typeof all)=>[...rs].sort((a,b)=>b.netProfit-a.netProfit || a.maxDrawdownPct-b.maxDrawdownPct);const picked=rank(eligible.length?eligible:all)[0];if(!picked)throw new Error('Empty development');return {direction,config:picked.config,eligible:eligible.length>0,development:picked,diagnosticOnly:eligible.length===0};});
const freeze={createdAt:new Date().toISOString(),protocolSha256:createHash('sha256').update(JSON.stringify(protocol)).digest('hex'),selection,development};
await writeFile(`${dir}/frozen-selection.json`,JSON.stringify(freeze,null,2));console.log('DEVELOPMENT SELECTION FROZEN',selection.map(s=>({side:s.direction,id:s.config.id,eligible:s.eligible,net:s.development.netProfit,trades:s.development.tradeCount})));
const later:unknown[]=[];const chosen:unknown[]=[];
for(const [phase,a,b] of [['validation',devEnd,valEnd],['holdout',valEnd,to]] as const){
  for(const balance of protocol.startingBalances)for(const cfg of configs){const r=replayExperimental(feeds,a,b,cfg,balance);const ci=bootstrap(r);await writeFile(`${dir}/ledgers/${phase}-${balance}-${cfg.id}.json`,JSON.stringify(r));later.push({phase,...compact(r),bootstrap:ci});
    const selected=selection.find(s=>s.config.id===cfg.id);if(balance===1000 && selected){const stress=replayExperimental(feeds,a,b,cfg,balance,{...EXPERIMENTAL_COST,bps:protocol.stressSlippageBps,ticks:protocol.stressSlippageTicks});await writeFile(`${dir}/ledgers/${phase}-stress-${cfg.id}.json`,JSON.stringify(stress));
      const failures:string[]=[];if(!selected.eligible)failures.push('Development did not qualify');if(r.tradeCount<50)failures.push('Fewer than 50 trades');if(r.activeDays<5)failures.push('Fewer than 5 active days');if(r.netProfit<=0)failures.push('Non-positive net profit');if((r.profitFactor??0)<1.1)failures.push('Profit factor below 1.10');if(ci.lower95<=0)failures.push('Day-block confidence lower bound not positive');if(stress.netProfit<=0)failures.push('Stress slippage not profitable');
      chosen.push({phase,selection:selected,...compact(r),bootstrap:ci,stress:compact(stress),accepted:failures.length===0,failures});console.log(phase,cfg.id,'net',r.netProfit,'trades',r.tradeCount,'failures',failures);
    }
  }
}
const output={generatedAt:new Date().toISOString(),source,protocol,freeze,later,chosen};await writeFile(`${dir}/results.json`,JSON.stringify(output,null,2));console.log('STUDY COMPLETE');