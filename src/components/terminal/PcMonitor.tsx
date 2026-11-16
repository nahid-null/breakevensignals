import { useSettings, useStatuses } from '@/lib/data';
import { fmtTime } from '@/lib/data';
import { formatUptime } from '@/lib/engine/health';
import { StatusBadge } from './StatusBadge';

export function PcMonitor() {
  const s = useStatuses();
  const timezone = useSettings().data?.display_timezone ?? 'UTC';
  return <section aria-label="Scanner status" className="grid gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-4">
    <div><div className="mb-2 text-[10px] uppercase text-muted-foreground">Local PC Server</div><StatusBadge value={s.pc} /></div>
    <div><div className="mb-2 text-[10px] uppercase text-muted-foreground">Scanner Engine</div><StatusBadge value={s.scanner} /></div>
    <div><div className="mb-2 text-[10px] uppercase text-muted-foreground">Engine uptime · last reported</div><span className="font-mono text-xs">{formatUptime(s.health?.uptimeSeconds)}</span></div>
    <div><div className="mb-2 text-[10px] uppercase text-muted-foreground">Last successful scan</div><span className="font-mono text-xs">{fmtTime(s.health?.lastScanAt, timezone)}</span></div>
    <div><div className="mb-2 text-[10px] uppercase text-muted-foreground">Binance connection</div><StatusBadge value={s.binance} /></div>
    <div><div className="mb-2 text-[10px] uppercase text-muted-foreground">Next scan · expected candle close</div><span className="font-mono text-xs">{fmtTime(s.health?.nextScanAt, timezone)}</span></div>
    <div><div className="mb-2 text-[10px] uppercase text-muted-foreground">Successful candle scans</div><span className="font-mono text-xs">{s.health?.successfulScans ?? '—'}</span></div>
    <div><div className="mb-2 text-[10px] uppercase text-muted-foreground">Last successful Telegram notification</div><span className="font-mono text-xs">{fmtTime(s.health?.lastTelegramAt, timezone)}</span></div>
    <div className="text-xs sm:col-span-2 lg:col-span-4"><span className="text-muted-foreground">TOTAL COINS SCANNED </span><span className="mr-6 font-mono">{s.health?.scannedSymbols ?? '—'} / 21</span><span className="text-muted-foreground">LAST ERROR </span><span className="break-words font-mono text-short">{s.healthQuery.isError ? 'Health unavailable; connection cannot be confirmed.' : s.health?.engine?.error ?? '—'}</span></div>
  </section>;
}