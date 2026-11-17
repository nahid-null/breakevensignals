import { useQuery } from '@tanstack/react-query';
import { fmtTime, fmtPrice } from '@/lib/data';
import { readSimDecisions } from '@/lib/dashboard.functions';
import { DECISION_TEXT } from '@/lib/sim-trend';
import { StatusBadge } from './StatusBadge';
import { cn } from '@/lib/utils';

export function TrendWatch({ tz }: { tz: string }) {
  const decisions = useQuery({ queryKey: ['sim_decisions'], refetchInterval: 15000, queryFn: () => readSimDecisions() });
  return (
    <section className="grid gap-4">
      {/* prompt-41: trend filter removed — the special-watch trend table is no longer shown. */}
      <div className="min-w-0 border border-border bg-card/40">
        <h2 className="border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Signal decisions</h2>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">{['Time', 'Coin', 'Side', 'Price', 'Decision'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {decisions.isLoading ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
                : decisions.isError ? <tr><td colSpan={5} className="px-3 py-6 text-center text-short">Could not load decisions.</td></tr>
                : (decisions.data ?? []).length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No signals yet.</td></tr>}
              {(decisions.data ?? []).map((d) => (
                <tr key={d.trade_id} className="border-b border-border/50 font-mono">
                  <td className="px-3 py-1.5">{fmtTime(new Date(Number(d.breakeven_candle_time) + 60_000).toISOString(), tz)}</td>
                  <td className="px-3 py-1.5">{d.symbol}</td>
                  <td className="px-3 py-1.5"><StatusBadge value={d.direction} /></td>
                  <td className="px-3 py-1.5">{fmtPrice(d.entry_price ?? d.reference_price)}</td>
                  <td className={cn('px-3 py-1.5', d.status === 'CONFIRMED' ? 'text-long' : 'text-muted-foreground')}>{d.status === 'CONFIRMED' ? 'TRADED' : DECISION_TEXT[d.reason ?? ''] ?? d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
