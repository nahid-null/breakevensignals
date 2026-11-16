import { fmtTime } from '@/lib/data';
import type { RobotScanner } from '@/lib/robot/data';
import { SETUP } from '@/components/robot/ui';
import { StatusBadge } from '@/components/terminal/StatusBadge';

type QueueItem = { symbol: string; direction: string; setup: string; score: number; rank: number; expires_at: string; waiting: string | null };
const entries = (j: unknown) => Object.entries((j ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
const n = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('en-US');

/** Live pipeline diagnostics saved by the worker: what was scanned, why setups were rejected and why orders failed. */
export function ScannerPanel({ s }: { s: RobotScanner | null | undefined }) {
  if (!s) return null;
  const fresh = Date.now() - Date.parse(s.updated_at) < 90_000;
  const queue = (s.queue ?? []) as QueueItem[];
  const setups = new Map<string, { seen: number; qualified: number }>();
  for (const [k, v] of entries(s.setups)) {
    const [name = k, kind] = k.split(' '); const e = setups.get(name) ?? { seen: 0, qualified: 0 };
    if (kind === 'qualified') e.qualified = v; else e.seen = v; setups.set(name, e);
  }
  const counters: [string, number | string][] = [
    ['Coins monitored', s.monitored], ['Live feeds', s.live_feeds], ['Signals evaluated', s.evaluated], ['LONG candidates', s.long_candidates],
    ['SHORT candidates', s.short_candidates], ['Rejected', s.rejected], ['Qualified', s.qualified], ['Orders submitted', s.orders_submitted],
    ['Orders filled', s.orders_filled], ['Partial fills', s.orders_partial], ['Orders rejected', s.orders_rejected],
  ];
  return (
    <section className="space-y-4 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Scanner diagnostics</h2>
        <p className="font-mono text-[11px] text-muted-foreground">
          {fresh ? 'Live' : 'Not reporting'} · last candle {s.last_candle_at ? fmtTime(s.last_candle_at) : '—'} · counting since {fmtTime(s.counting_since)}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {counters.map(([k, v]) => <div key={k} className="border border-border/60 px-3 py-2"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="font-mono text-sm">{n(v)}</dd></div>)}
      </dl>
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div>
          <h3 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Top rejection reasons</h3>
          <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {entries(s.reasons).length === 0 && <li className="text-muted-foreground">None yet.</li>}
            {entries(s.reasons).slice(0, 15).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span className="font-sans">{k}</span><span>{n(v)}</span></li>)}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Setup families (seen / qualified)</h3>
          <ul className="space-y-1 font-mono text-xs">
            {setups.size === 0 && <li className="text-muted-foreground">None yet.</li>}
            {[...setups].map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span className="font-sans">{SETUP[k] ?? k}</span><span>{n(v.seen)} / {n(v.qualified)}</span></li>)}
          </ul>
          <h3 className="mb-2 mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">Order failures</h3>
          <ul className="space-y-1 font-mono text-xs">
            {entries(s.exec_failures).length === 0 && <li className="text-muted-foreground">None yet.</li>}
            {entries(s.exec_failures).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span className="font-sans">{k}</span><span>{n(v)}</span></li>)}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Opportunity queue (best first)</h3>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {queue.length === 0 && <li className="text-muted-foreground">Empty — no qualified setup waiting.</li>}
            {queue.map((q) => (
              <li key={`${q.symbol}-${q.direction}`} className="flex flex-wrap items-center gap-2 font-mono">
                <span>{q.symbol}</span><StatusBadge value={q.direction} /><span className="font-sans">{SETUP[q.setup] ?? q.setup}</span><span>{q.score}</span>
                {q.waiting && <span className="font-sans text-muted-foreground">· {q.waiting}</span>}
              </li>))}
          </ul>
        </div>
      </div>
    </section>
  );
}
