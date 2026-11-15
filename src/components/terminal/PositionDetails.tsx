import { fmtPrice, fmtTime, type Position } from '@/lib/data';
import { StatusBadge, positionLabel } from './StatusBadge';

export function PositionDetails({ p, timezone }: { p: Position; timezone: string }) {
  return <div className="grid gap-x-6 gap-y-2 border-b border-border py-4 sm:grid-cols-2 lg:grid-cols-4">
    <div className="flex flex-wrap items-center gap-2 font-mono text-sm font-semibold">{p.symbol}<StatusBadge value={p.direction} /><StatusBadge value={positionLabel(p.status)} /></div>
    <div className="font-mono text-xs text-muted-foreground">ENTRY <span className="text-foreground">{fmtPrice(p.entry_price)}</span> · SL {fmtPrice(p.current_stop_loss)} · TP {fmtPrice(p.take_profit)}</div>
    <div className="font-mono text-xs text-muted-foreground">{fmtTime(p.entry_timestamp, timezone)} · {p.source.toUpperCase()}</div>
    <div className="font-mono text-xs text-muted-foreground">EXIT {fmtPrice(p.exit_price)} · NET {p.net_result_r === null ? '—' : `${Number(p.net_result_r).toFixed(3)}R`}</div>
    <div className="break-all font-mono text-[10px] text-muted-foreground sm:col-span-2 lg:col-span-4">{p.trade_id}</div>
  </div>;
}