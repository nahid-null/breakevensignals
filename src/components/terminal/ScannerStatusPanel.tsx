import { useQuery } from '@tanstack/react-query';
import { readScannerStatus } from '@/lib/dashboard.functions';
import { fmtPrice, fmtTime } from '@/lib/data';
import { cn } from '@/lib/utils';

function ago(iso: string | null | undefined) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

export function ScannerStatusPanel({ tz }: { tz: string }) {
  const q = useQuery({ queryKey: ['scanner_status'], queryFn: () => readScannerStatus(), refetchInterval: 30_000 });
  const d = q.data;
  const beat = d?.health?.last_heartbeat_at;
  const fresh = beat ? Date.now() - new Date(beat).getTime() < 3 * 60_000 : false;
  const v = d?.version ?? 'UNKNOWN';
  const vText = v === 'NEW' ? 'New code — OB STRONG rules' : v === 'OLD' ? 'Old code (OB + VP) — redeploy scanner' : 'Not known yet (no entries received)';
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Scanner status</h2>
      {q.isError ? <p className="text-sm text-destructive">Could not read scanner status.</p> : (
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Deployed version</dt>
            <dd className={cn('font-medium', v === 'NEW' ? 'text-long' : v === 'OLD' ? 'text-short' : 'text-waiting')}>{q.isLoading ? '…' : vText}</dd></div>
          <div><dt className="text-muted-foreground">Last heartbeat</dt>
            <dd className={cn('font-medium', fresh ? 'text-long' : 'text-short')}>{beat ? `${fmtTime(beat, tz)} (${ago(beat)})` : '—'}{d?.health ? ` · ${d.health.status}` : ''}</dd></div>
          <div><dt className="text-muted-foreground">Latest OB STRONG signal</dt>
            <dd className="font-medium">{d?.strong ? <><span className={d.strong.direction === 'LONG' ? 'text-long' : 'text-short'}>{d.strong.direction}</span> {d.strong.symbol.replace('USDT', '')} @ {fmtPrice(Number(d.strong.entry_price))} · {fmtTime(d.strong.created_at, tz)} · {d.strong.status === 'CONFIRMED' ? 'opened' : `skipped (${d.strong.reason})`}</> : 'None received yet'}</dd></div>
        </dl>)}
    </section>
  );
}
