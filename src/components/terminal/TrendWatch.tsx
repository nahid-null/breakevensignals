import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { useMarkets, fmtTime, fmtPrice } from '@/lib/data';
import { readSimDecisions } from '@/lib/dashboard.functions';
import { trendName, type MtfSnapshot } from '@/lib/engine/mtf-trend';
import { DECISION_TEXT, watchSide } from '@/lib/sim-trend';
import { StatusBadge } from './StatusBadge';
import { cn } from '@/lib/utils';

const tone = (v: number | null | undefined) => v === 1 ? 'text-long' : v === -1 ? 'text-short' : 'text-waiting';

export function TrendWatch({ tz }: { tz: string }) {
  const markets = useMarkets();
  const decisions = useQuery({ queryKey: ['sim_decisions'], refetchInterval: 15000, queryFn: () => readSimDecisions() });
  const rows = (markets.data ?? []).filter((m) => m.status !== 'UNAVAILABLE').map((m) => {
    const t = (m.mtf_trend ?? null) as MtfSnapshot | null;
    return { symbol: m.symbol, t, side: watchSide(t) };
  }).sort((a, b) => Number(!!b.side) - Number(!!a.side) || a.symbol.localeCompare(b.symbol));
  const watched = rows.filter((r) => r.side);
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="border border-border bg-card/40">
        <h2 className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Eye className="size-3" /> Special watch · {watched.length} of {rows.length} coins
        </h2>
        <p className="px-3 pt-2 text-[11px] text-muted-foreground">Watched when 15m and 5m agree and 1m is sideways or the same. Only that side's breakeven is traded.</p>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">{['Coin', '15m', '5m', '1m', 'Watch'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {markets.isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading trends…</td></tr>}
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-border/50 font-mono">
                  <td className="px-3 py-1.5">{r.symbol}</td>
                  {(['m15', 'm5', 'm1'] as const).map((k) => <td key={k} className={cn('px-3 py-1.5', tone(r.t?.[k]))}>{trendName(r.t?.[k])}</td>)}
                  <td className="px-3 py-1.5">{r.side ? <StatusBadge value={r.side} /> : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="border border-border bg-card/40">
        <h2 className="border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Breakeven decisions</h2>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">{['Time', 'Coin', 'Side', 'Price', 'Decision'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {decisions.isLoading ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
                : decisions.isError ? <tr><td colSpan={5} className="px-3 py-6 text-center text-short">Could not load decisions.</td></tr>
                : (decisions.data ?? []).length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No breakeven signals yet.</td></tr>}
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
