import { useRobotAccount, useRobotDecisions, useRobotPositions, useRobotRuntime, useRobotScanner, useRobotSignals } from '@/lib/robot/data';
import { deploymentState, sweepPerformance, REQUIRED_PAPER_TRADES } from '@/lib/robot/deployment';
import expected from '@/lib/robot/expected-release.json';
import { MetricsTable, pct, px, signed } from './ui';
import { fmtTime } from '@/lib/data';
import { StatusBadge } from '@/components/terminal/StatusBadge';

export function DeploymentEvidence() {
  const runtime=useRobotRuntime();const scanner=useRobotScanner();const positions=useRobotPositions();const account=useRobotAccount();const decisions=useRobotDecisions();const signals=useRobotSignals();
  // Never present loading/failed data as a zero-trade result or a zero margin allocation.
  const pending=[runtime,scanner,positions,account,decisions].some((q)=>q.isPending);
  const failed=[runtime,scanner,positions,account,decisions].some((q)=>q.isError);
  if(pending||failed) return <section className="min-w-0 space-y-3 border-y border-border py-5">
    <h3 className="font-semibold">Deployment evidence &amp; live sweep validation</h3>
    <p className={failed?'text-sm text-short':'text-sm text-muted-foreground'}>{failed?'Live evidence could not be read. Version, trade count and margin remain unverified.':'Reading the running version, genuine trades and paper margin…'}</p>
  </section>;
  const state=deploymentState(runtime.data,expected.source_hash);
  const p=sweepPerformance(positions.data??[],Number(account.data?.start_balance??10));
  const legacy=(signals.data??[]).filter((s)=>s.setup!=='SWEEP_RECLAIM');
  const newest=legacy[0];
  const margin=(positions.data??[]).filter((p)=>p.status==='OPEN').reduce((a,p)=>a+Number(p.margin),0);
  const balance=Number(account.data?.balance??0);
  return <section className="min-w-0 space-y-4 border-y border-border py-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Deployment evidence &amp; live sweep validation</h3><StatusBadge value={state.status} /></header>
    <p className="text-sm text-waiting">{state.reason}</p>
    {runtime.isError&&<p className="text-short">The running-version evidence could not be read; deployment is unverified.</p>}
    {!runtime.data&&newest&&<p className="text-sm text-muted-foreground">Latest saved non-sweep decision: {newest.symbol} {newest.direction} · {newest.setup} · {fmtTime(newest.candle_time)}. A green scanner badge proves fresh market activity, not the corrected entry version.</p>}
    <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-2">
      <div className="min-w-0"><dt className="text-muted-foreground">Expected tested worker fingerprint</dt><dd className="mt-1 break-all font-mono">{expected.source_hash}</dd></div>
      <div className="min-w-0"><dt className="text-muted-foreground">Running worker fingerprint</dt><dd className="mt-1 break-all font-mono">{runtime.data?.source_hash??'Not received'}</dd></div>
      <div><dt className="text-muted-foreground">Reported strategy / Railway commit</dt><dd className="mt-1 break-all font-mono">{runtime.data?.strategy??'Unverified'} / {runtime.data?.git_commit??'Not independently available'}</dd></div>
      <div><dt className="text-muted-foreground">Latest server-received version receipt</dt><dd className="mt-1 font-mono">{runtime.data?fmtTime(runtime.data.reported_at):'Not received'}</dd></div>
      <div><dt className="text-muted-foreground">Last reported scanner feeds</dt><dd className="mt-1 font-mono">{scanner.data?.live_feeds??0}/{scanner.data?.monitored??40} · {scanner.data?fmtTime(scanner.data.updated_at):'Not reported'}</dd></div>
      <div><dt className="text-muted-foreground">Saved combined paper margin / cash balance</dt><dd className="mt-1 font-mono">{pct(balance>0?margin/balance*100:0)} · ceiling70% · fixed50x · target+10% net margin ROI</dd></div>
    </dl>
    <p className="text-xs leading-relaxed text-muted-foreground">Fingerprint comparison covers the running source files, feed, entry, risk, execution, protocol, package lock and Dockerfile; it is worker-reported through the owning authenticated connection. It cannot independently verify Railway’s deployment panel, Git identity, network permissions or hosting costs. Historical entries and older missing evidence stay separate.</p>
    <div className="space-y-3 border-t border-border pt-4"><h4 className="text-sm font-semibold">Genuine completed new-strategy paper trades: {p.completed}/{REQUIRED_PAPER_TRADES}</h4>
      <progress className="h-2 w-full accent-primary" value={Math.min(p.completed,REQUIRED_PAPER_TRADES)} max={REQUIRED_PAPER_TRADES} aria-label="Completed new-strategy paper trades" />
      <p className="text-xs text-waiting">{p.sufficient?'Minimum sample reached; review these results and separate LONG/SHORT evidence, never assume guaranteed profits.':`${p.remaining} more valid completed trades required before any profitability conclusion. No forced trades or weaker safeguards.`}</p>
      {p.completed>0?<><MetricsTable rows={[{label:'New sweep · all',m:p.all},{label:'LONG',m:p.long},{label:'SHORT',m:p.short}]} /><p className="text-xs text-muted-foreground">Mean observed MAE {pct(p.mae,2)} / MFE {pct(p.mfe,2)} net margin ROI. Drawdown above is closed-trade cash drawdown from recorded starting funds; it excludes deposits, legacy trades and open-equity excursions. Net PnL includes recorded fees, fill slippage and funding. Results use the latest1,000 recorded positions.</p></>:<p className="text-sm text-muted-foreground">No completed LIVE_BINANCE entry with LIQUIDITY_SWEEP_V1 evidence yet. Old pullbacks, historical replays and temporary tests do not count toward30.</p>}
    </div>
    <div className="space-y-3 border-t border-border pt-4"><h4 className="text-sm font-semibold">Actual hosted liquidity-sweep decision receipts</h4>
      {decisions.isError?<p className="text-short">Decision receipts could not be read.</p>:!(decisions.data??[]).length?<p className="text-sm text-muted-foreground">No corrected-worker decision receipts have arrived. Deployment and first new paper execution remain unverified.</p>:<div className="max-h-96 overflow-auto"><table className="w-full min-w-[900px] text-xs"><thead className="text-left text-muted-foreground"><tr>{['Candle close','Coin','Side','Stage','Decision','Score','Exact reason','Signal price'].map((h)=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{decisions.data?.map((d)=>{
        const e=d.evidence; const price=typeof e==='object'&&e!==null&&!Array.isArray(e)&&'signal_price' in e&&typeof e['signal_price']==='number'?e['signal_price']:null;
        return <tr key={d.event_id} className="border-b border-border/50"><td className="p-2 font-mono">{fmtTime(d.candle_time)}</td><td className="p-2">{d.symbol}</td><td className={d.direction==='LONG'?'p-2 text-long':'p-2 text-short'}>{d.direction}</td><td className="p-2">{d.phase}</td><td className="p-2">{d.decision}</td><td className="p-2">{d.score??'—'}</td><td className="p-2 text-muted-foreground">{d.reason}</td><td className="p-2 font-mono">{px(price)}</td></tr>;
      })}</tbody></table></div>}
    </div>
    <p className="text-xs text-muted-foreground">Current new-strategy net paper PnL: {p.completed?signed(p.all.netPnl):'Unavailable — no completed qualifying trades'}. Scanning runs only in the separately deployed worker, never this browser; there is no background task running in this chat after it ends.</p>
  </section>;
}