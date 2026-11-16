import { ROBOT_STRATEGY_VERSION } from './release-files';
import { computeMetrics } from './metrics';

export const REQUIRED_PAPER_TRADES = 30;
export type RuntimeEvidence = { source_hash: string; strategy: string; reported_at: string; started_at: string; host_kind: string; runtime_mode: string; git_commit: string | null };
export function deploymentState(runtime: RuntimeEvidence | null | undefined, expected: string, now = Date.now()) {
  if (!runtime) return { status: 'UNVERIFIED', reason: 'No owning scanner source fingerprint received. Older signals do not certify the new strategy.' };
  if (now-Date.parse(runtime.reported_at)>90_000 || Date.parse(runtime.reported_at)>now+5000) return { status: 'STALE', reason: 'Version receipt is not fresh; current execution is unverified.' };
  if (runtime.runtime_mode!=='production'||runtime.host_kind!=='hosted') return {status:'TEMPORARY',reason:'Temporary or non-hosted verification is not a Railway production deployment.'};
  if (runtime.strategy!==ROBOT_STRATEGY_VERSION||runtime.source_hash!==expected) return { status:'MISMATCH',reason:'Reported strategy or source fingerprint differs from this tested worker release.' };
  return { status:'MATCHED',reason:'Fresh owning hosted worker reports the same covered source bytes. Railway Git commit is self-reported, not independently read from Railway.' };
}
type PaperRow = { direction:string; status:string; setup:string; entry_audit:unknown; realized_pnl:number; closed_at:string|null; updated_at:string; risk_usdt:number; mae_roi_pct:number|null; mfe_roi_pct:number|null };
export function sweepPerformance(rows: PaperRow[], startingBalance:number) {
  const closed=rows.filter((p)=>{
    const a=p.entry_audit;return p.status==='CLOSED'&&typeof a==='object'&&a!==null&&'strategy' in a&&a.strategy===ROBOT_STRATEGY_VERSION&&'source' in a&&a.source==='LIVE_BINANCE';
  });
  const metric=(xs:PaperRow[])=>computeMetrics(xs.map((p)=>({direction:p.direction,netPnl:Number(p.realized_pnl),exitReason:'',closedAt:Date.parse(p.closed_at??p.updated_at),riskUsdt:p.risk_usdt})),startingBalance);
  const avg=(key:'mae_roi_pct'|'mfe_roi_pct')=>{const xs=closed.map((p)=>p[key]).filter((x):x is number=>x!==null);return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;};
  return { completed:closed.length, remaining:Math.max(0,REQUIRED_PAPER_TRADES-closed.length), sufficient:closed.length>=REQUIRED_PAPER_TRADES,
    all:metric(closed),long:metric(closed.filter((p)=>p.direction==='LONG')),short:metric(closed.filter((p)=>p.direction==='SHORT')),mae:avg('mae_roi_pct'),mfe:avg('mfe_roi_pct') };
}