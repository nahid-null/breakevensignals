// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deploymentState, REQUIRED_PAPER_TRADES, sweepPerformance } from '@/lib/robot/deployment';
import { DEFAULT_SETTINGS } from '@/lib/robot/config';
import { RobotCore, WARMUP_BARS } from '@/lib/robot/engine';
import { sourceFingerprint } from '../../engine-worker/release-fingerprint';
import expected from '@/lib/robot/expected-release.json';

const hash='a'.repeat(64); const at=Date.parse('2026-11-16T18:00:00Z');
const runtime={source_hash:hash,strategy:'SMC_V1',reported_at:new Date(at).toISOString(),started_at:new Date(at-60000).toISOString(),host_kind:'hosted',runtime_mode:'production',git_commit:null};
const trade=(source='LIVE_BINANCE')=>({direction:'LONG',status:'CLOSED',setup:'SMC_SWEEP_MSS',entry_audit:{strategy:'SMC_V1',source},realized_pnl:0.1,closed_at:new Date(at).toISOString(),updated_at:new Date(at).toISOString(),risk_usdt:0.2,mae_roi_pct:-8,mfe_roi_pct:10});
describe('deployment evidence and 30-trade paper validation',()=>{
  it('requires a fresh matching hosted source fingerprint, not a socket or old trade',()=>{
    expect(deploymentState(null,hash,at).status).toBe('UNVERIFIED');
    expect(deploymentState(runtime,hash,at).status).toBe('MATCHED');
    expect(deploymentState(runtime,'b'.repeat(64),at).status).toBe('MISMATCH');
    expect(deploymentState(runtime,hash,at+90001).status).toBe('STALE');
    expect(deploymentState({...runtime,runtime_mode:'temporary'},hash,at).status).toBe('TEMPORARY');
  });
  it('requires at least30 completed genuine new-strategy trades and excludes replays and legacy entries',()=>{
    expect(REQUIRED_PAPER_TRADES).toBe(30);
    const rows=Array.from({length:29},()=>trade());
    const insufficient=sweepPerformance([...rows,trade('CANDLE_REPLAY'),{...trade(),setup:'TREND_PULLBACK'},{...trade(),setup:'SWEEP_RECLAIM',entry_audit:{strategy:'LIQUIDITY_SWEEP_V1',source:'LIVE_BINANCE'}},{...trade(),status:'OPEN'}],20);
    expect(insufficient.completed).toBe(29);expect(insufficient.sufficient).toBe(false);expect(insufficient.remaining).toBe(1);
    expect(sweepPerformance([...rows,trade()],20).sufficient).toBe(true);
    expect(sweepPerformance([...rows,trade()],20).all.netPnl).toBeCloseTo(3,9);
  });
  it('does not invent MAE/MFE when no qualifying paper evidence exists',()=>{
    const result=sweepPerformance([],20);expect(result.completed).toBe(0);expect(result.mae).toBeNull();expect(result.mfe).toBeNull();
  });
  it('produces a deterministic64-digit fingerprint from the runtime source files',()=>{
    expect(sourceFingerprint()).toMatch(/^[a-f0-9]{64}$/);expect(sourceFingerprint()).toBe(sourceFingerprint());
    expect(sourceFingerprint()).toBe(expected.source_hash);
  });
  it('records both rejected LONG and SHORT closed-candle evaluations even without candidate scores',()=>{
    const core=new RobotCore({...DEFAULT_SETTINGS});core.addSymbol('NEARUSDT');
    const st=core.states.get('NEARUSDT');if(!st)throw new Error('Missing fixture state');st.count=WARMUP_BARS;
    core.onBar('NEARUSDT',{time:at,open:100,high:101,low:99,close:100,volume:100},true);
    const decisions=core.takeDecisions();expect(decisions).toHaveLength(2);
    expect(decisions.map((d)=>d.direction)).toEqual(['LONG','SHORT']);
    expect(decisions.map((d)=>d.reason)).toEqual(['Warming up indicators','Warming up indicators']);
  });
});