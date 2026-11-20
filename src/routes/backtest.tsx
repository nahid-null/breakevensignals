import type * as React from 'react';
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { readFilterBacktest } from '@/lib/dashboard.functions';

export const Route = createFileRoute('/backtest')({
  head: () => ({
    meta: [
      { title: 'Smart Filter 7-Day Backtest — Crypto Signal Terminal' },
      { name: 'description', content: 'Historical-only test of the Smart Signal Filter on OB STRONG 5-minute signals: accepted trades, rejected signals and reports.' },
      { property: 'og:title', content: 'Smart Filter 7-Day Backtest — Crypto Signal Terminal' },
      { property: 'og:description', content: 'Accepted vs rejected OB STRONG signals, success rate, hourly analysis and downloadable reports.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Backtest,
});

type Side = { trades: number; success: number; resolved: number; success_rate: number | null; profit: number; original: number; accepted: number };
type Hour = { hour: string; original: number; accepted: number; rejected: number; success: number; unsuccessful: number; success_rate: number | null; profit: number };
type Ref = { reference: string; decision: string; continuation_score: number; final_score: number; reasons: string[]; continuation_reasons: string[]; reached_070_before_sl: boolean; minutes_to_070: number | null };
type Summary = {
  start: string; end: string; original: number; accepted: number; rejected: number; traded: number; success: number; unsuccessful: number; unresolved: number; ambiguous: number;
  success_rate: number | null; start_balance: number; final_balance: number; total_profit: number; highest_activity_hour: string; lowest_activity_hour: string;
  best_hour: string | null; worst_hour: string | null; best_hour_rate: number | null; worst_hour_rate: number | null; long: Side; short: Side;
  rejection_breakdown: Record<string, number>; missed_by_filter: Record<string, number>; strong_continuation_total: number; strong_continuation_preserved: number;
  strong_continuation_preservation_rate: number | null; rejected_reached_070_before_sl: number; rejected_reached_070_24h: number; all_signals_rate_070_before_sl: number | null;
  hours: Hour[]; references: Ref[]; recommendations: string[]; sizing: string; fee: string;
};
type After = { reached_070: boolean; reached_070_before_sl: boolean; minutes_to_070: number | null; mfe_pct: number; mae_pct: number; horizon_complete: boolean };
type Trade = { status?: string; t0?: number; entry_price?: number; pnl?: number; minutes_open?: number | null; exit_reason?: string };

const FILES = [
  ['7_Day_Filter_Backtest_Report.pdf', 'Main report (PDF)'], ['7_Day_Filter_Backtest_Report.csv', 'Main report (CSV)'],
  ['7_Day_Rejected_Signals_History.pdf', 'Rejected signals (PDF)'], ['7_Day_Rejected_Signals_History.csv', 'Rejected signals (CSV)'],
] as const;
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const utc = (iso: string) => new Date(iso).toISOString().slice(5, 16).replace('T', ' ');

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

function Backtest() {
  const q = useQuery({ queryKey: ['filter_backtest'], queryFn: () => readFilterBacktest() });
  const [show, setShow] = useState<'ALL' | 'MISSED' | 'ACCEPTED'>('ALL');
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading backtest…</p>;
  if (q.error) return <p className="text-sm text-short">Could not load the backtest: {String(q.error)}</p>;
  const run = q.data?.run;
  if (!run) return <p className="text-sm text-muted-foreground">No backtest has been stored yet.</p>;
  const s = run.summary as unknown as Summary;
  const sigs = (q.data?.signals ?? []).filter((x) => {
    const a = x.after_signal as unknown as After;
    return show === 'ALL' ? true : show === 'ACCEPTED' ? x.decision === 'ACCEPTED' : x.decision === 'REJECTED' && a.reached_070_before_sl;
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Smart Filter · 7-day backtest</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Historical test only — no live trades, no orders, the indicator is unchanged. {s.start} → {s.end} (UTC). {s.sizing}; {s.fee}.
        </p>
        <p className="mt-1 text-xs text-waiting">Live trading is not enabled. Nothing changes until you approve it.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILES.map(([f, label]) => (
          <a key={f} href={`/reports/prompt-68/${f}`} download className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent">
            <Download className="h-4 w-4" /> {label}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Original signals" value={s.original} />
        <Tile label="Accepted" value={s.accepted} tone="text-long" />
        <Tile label="Rejected" value={s.rejected} tone="text-short" />
        <Tile label="Simulated trades" value={s.traded} />
        <Tile label="Success rate" value={pct(s.success_rate)} />
        <Tile label="Successful" value={s.success} tone="text-long" />
        <Tile label="Unsuccessful" value={s.unsuccessful} tone="text-short" />
        <Tile label="Unresolved · ambiguous" value={`${s.unresolved} · ${s.ambiguous}`} tone="text-waiting" />
        <Tile label="Starting balance" value={`$${s.start_balance.toFixed(4)}`} />
        <Tile label="Final balance" value={`$${s.final_balance.toFixed(4)}`} tone={s.total_profit >= 0 ? 'text-long' : 'text-short'} />
        <Tile label="Highest activity hour" value={s.highest_activity_hour} />
        <Tile label="Lowest activity hour" value={s.lowest_activity_hour} />
        <Tile label="Best hour" value={`${s.best_hour ?? '—'} (${pct(s.best_hour_rate)})`} />
        <Tile label="Worst hour" value={`${s.worst_hour ?? '—'} (${pct(s.worst_hour_rate)})`} />
        <Tile label="Strong continuation kept" value={`${s.strong_continuation_preserved}/${s.strong_continuation_total} (${pct(s.strong_continuation_preservation_rate)})`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">LONG vs SHORT</h2>
          {(['long', 'short'] as const).map((k) => (
            <div key={k} className="flex justify-between border-b border-border/60 py-2 text-sm last:border-0">
              <span className={k === 'long' ? 'text-long' : 'text-short'}>{k.toUpperCase()}</span>
              <span className="font-mono text-xs">{s[k].original} signals · {s[k].trades} trades · {pct(s[k].success_rate)} · ${s[k].profit.toFixed(4)}</span>
            </div>
          ))}
        </section>
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Why signals were rejected</h2>
          {Object.entries(s.rejection_breakdown).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 text-sm"><span>{k}</span><span className="font-mono">{v}</span></div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">A signal can fail several rules.</p>
        </section>
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Missed opportunities</h2>
          <p className="text-sm">
            <span className="font-mono text-waiting">{s.rejected_reached_070_before_sl}</span> of {s.rejected} rejected signals later moved +0.70% before their stop loss
            ({s.rejected_reached_070_24h} reached +0.70% at some point within 24 h).
          </p>
          <p className="mt-2 text-sm text-muted-foreground">Without any filter, {pct(s.all_signals_rate_070_before_sl)} of all signals reached +0.70% before the stop.</p>
          {Object.entries(s.missed_by_filter).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 text-xs"><span>{k}</span><span className="font-mono">{v}</span></div>
          ))}
        </section>
      </div>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Your reference screenshots</h2>
        <div className="space-y-2">
          {s.references.map((r) => (
            <div key={r.reference} className="text-sm">
              <span className="font-medium">{r.reference}:</span>{' '}
              <span className={r.decision === 'ACCEPTED' ? 'text-long' : 'text-short'}>{r.decision}</span>{' '}
              <span className="text-muted-foreground">
                (score {r.continuation_score} → {r.final_score}) · {(r.reasons.length ? r.reasons : ['—']).join('; ')} · later +0.70% before stop: {r.reached_070_before_sl ? `yes, ${r.minutes_to_070} min` : 'no'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Recommendations for a second test</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">{s.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
      </section>

      <section className="overflow-x-auto rounded-md border border-border bg-card p-4">
        <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Hourly analysis (UTC)</h2>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr>{['Hour', 'Signals', 'Accepted', 'Rejected', 'Success', 'Fail', 'Rate', 'Profit $'].map((h) => <th key={h} className="px-2 py-1 text-left font-normal">{h}</th>)}</tr></thead>
          <tbody className="font-mono">
            {s.hours.map((h) => (
              <tr key={h.hour} className="border-t border-border/50">
                <td className="px-2 py-1">{h.hour}</td><td className="px-2 py-1">{h.original}</td><td className="px-2 py-1">{h.accepted}</td><td className="px-2 py-1">{h.rejected}</td>
                <td className="px-2 py-1">{h.success}</td><td className="px-2 py-1">{h.unsuccessful}</td><td className="px-2 py-1">{pct(h.success_rate)}</td><td className="px-2 py-1">{h.profit.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-md border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">All signals</h2>
          <div className="flex gap-1 text-xs">
            {(['ALL', 'ACCEPTED', 'MISSED'] as const).map((k) => (
              <button key={k} onClick={() => setShow(k)} className={`rounded border px-2 py-1 ${show === k ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                {k === 'MISSED' ? 'Rejected but reached +0.70%' : k === 'ALL' ? 'All' : 'Accepted'}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr>{['#', 'Time UTC', 'Coin', 'Side', 'Entry', 'Score', 'Decision', 'Reason / result', 'After signal'].map((h) => <th key={h} className="px-2 py-1 text-left font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {sigs.map((x) => {
              const a = x.after_signal as unknown as After; const t = x.trade as unknown as Trade | null;
              return (
                <tr key={x.signal_no} className="border-t border-border/50 align-top">
                  <td className="px-2 py-1 font-mono">{x.signal_no}</td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap">{utc(x.signal_time)}</td>
                  <td className="px-2 py-1">{x.symbol.replace('USDT', '')}</td>
                  <td className={`px-2 py-1 ${x.direction === 'LONG' ? 'text-long' : 'text-short'}`}>{x.direction}</td>
                  <td className="px-2 py-1 font-mono">{x.indicator_entry}</td>
                  <td className="px-2 py-1 font-mono">{x.score}{x.strong_continuation ? ' ★' : ''}</td>
                  <td className={`px-2 py-1 ${x.decision === 'ACCEPTED' ? 'text-long' : 'text-short'}`}>{x.decision}{x.path ? ` · ${x.path}` : ''}</td>
                  <td className="px-2 py-1 text-muted-foreground">{x.decision === 'ACCEPTED' ? `${t?.status ?? ''} · ${t?.exit_reason ?? ''} · $${(t?.pnl ?? 0).toFixed(4)} · ${t?.minutes_open ?? '—'} min` : x.reasons.join(' | ')}</td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap">
                    {a.reached_070_before_sl ? <span className="text-long">+0.70% in {a.minutes_to_070} min</span> : a.reached_070 ? <span className="text-waiting">stop first</span> : <span className="text-short">not reached</span>}
                    <span className="text-muted-foreground"> · {a.mfe_pct}% / {a.mae_pct}%{a.horizon_complete ? '' : ' · <24h'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">★ = strong continuation pattern. After signal = max favourable / max adverse move in 24 h from the indicator entry.</p>
      </section>
    </div>
  );
}
