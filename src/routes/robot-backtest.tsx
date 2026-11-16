import { createFileRoute } from '@tanstack/react-router';
import { useRobotBacktests } from '@/lib/robot/data';
import { MetricsTable, pct, signed, tone, usd, EXIT, SETUP } from '@/components/robot/ui';
import type { Metrics } from '@/lib/robot/metrics';
import { cn } from '@/lib/utils';

const TITLE = 'Robot Backtest — Crypto Signal Terminal';
const DESC = 'Replay of the paper robot on Binance futures 1-minute history through the live pipeline, with fees, slippage, exact 50x positions and an unseen test period.';
export const Route = createFileRoute('/robot-backtest')({
  head: () => ({ meta: [
    { title: TITLE }, { name: 'description', content: DESC }, { property: 'og:title', content: TITLE }, { property: 'og:description', content: DESC },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Backtest,
});

type Summary = { start_balance: number; end_balance: number; all: Metrics; long: Metrics; short: Metrics; exit_reasons: Record<string, number>;
  by_setup: Record<string, Partial<Metrics>>; monthly: Record<string, Partial<Metrics>>; max_allocation_pct: number; max_leverage_used: number;
  leverage_used: Record<string, number>; avg_hold_minutes: number; method: string;
  holdout?: { period: string; all: Partial<Metrics>; long: Partial<Metrics>; short: Partial<Metrics> } };

function Backtest() {
  const q = useRobotBacktests();
  const run = q.data?.[0];
  const s = run?.summary as Summary | undefined;
  if (!run || !s) return <p className="text-sm text-muted-foreground">{q.isLoading ? 'Loading…' : 'No backtest saved yet.'}</p>;
  const verdict = s.all.netPnl > 0 && (s.all.profitFactor ?? 0) > 1.1 && (s.holdout?.all.netPnl ?? 0) > 0;
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 font-mono text-[10px] text-active">PAPER ROBOT · BACKTEST</div>
        <h1 className="text-2xl font-semibold">Backtest: {run.period_start.slice(0, 10)} → {run.period_end.slice(0, 10)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{run.symbols.length} coins · start {usd(s.start_balance)} · end {usd(s.end_balance)}</p>
      </div>
      <div className={cn('border p-4 text-sm', verdict ? 'border-long/40 bg-long/5' : 'border-short/40 bg-short/5')}>
        <p className={cn('font-semibold', verdict ? 'text-long' : 'text-short')}>{verdict ? 'Positive result — still needs paper-trading confirmation.' : 'Not profitable yet — no proven edge.'}</p>
        <p className="mt-1 text-muted-foreground">{s.method} Paper trading continues so the rules can be judged on live data before any real-money step.</p>
      </div>
      <section className="border border-border bg-card/40">
        <h2 className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">Full period</h2>
        <MetricsTable rows={[{ label: 'All', m: s.all }, { label: 'Long', m: s.long }, { label: 'Short', m: s.short }]} />
      </section>
      {s.holdout && <section className="border border-border bg-card/40">
        <h2 className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">Unseen test period ({s.holdout.period})</h2>
        <MetricsTable rows={[{ label: 'All', m: s.holdout.all }, { label: 'Long', m: s.holdout.long }, { label: 'Short', m: s.holdout.short }]} />
      </section>}
      <section className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {Object.keys(s.monthly ?? {}).length > 0 && <div className="border border-border bg-card/40">
          <h2 className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">By month</h2>
          <MetricsTable rows={Object.entries(s.monthly).map(([k, m]) => ({ label: k, m }))} />
        </div>}
        <div className="border border-border bg-card/40">
          <h2 className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">By setup</h2>
          <MetricsTable rows={Object.entries(s.by_setup).map(([k, m]) => ({ label: SETUP[k] ?? k, m }))} />
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="border border-border bg-card/40 p-4 text-sm">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">How trades ended</h2>
          <ul className="space-y-1 font-mono text-xs">{Object.entries(s.exit_reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k} className="flex justify-between"><span>{EXIT[k] ?? k}</span><span>{n}</span></li>)}</ul>
        </div>
        <div className="border border-border bg-card/40 p-4 text-sm">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Leverage used</h2>
          <ul className="space-y-1 font-mono text-xs">{Object.entries(s.leverage_used).map(([k, n]) => <li key={k} className="flex justify-between"><span>{k}x</span><span>{n} trades</span></li>)}</ul>
          <p className="mt-2 text-xs text-muted-foreground">Peak margin in use: {pct(s.max_allocation_pct)} of balance.</p>
        </div>
        <div className="border border-border bg-card/40 p-4 text-sm">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Assumptions</h2>
          <p className="text-xs text-muted-foreground">{run.notes}</p>
          <p className="mt-2 text-xs">Average hold <span className="font-mono">{s.avg_hold_minutes.toFixed(0)} min</span> · net <span className={cn('font-mono', tone(s.all.netPnl))}>{signed(s.all.netPnl)}</span></p>
        </div>
      </section>
    </div>
  );
}
