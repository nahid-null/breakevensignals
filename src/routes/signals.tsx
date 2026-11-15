import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { EVENT_TYPES, SYMBOLS } from "@/lib/config";
import { fmtPrice, fmtTime, useEvents, useSettings } from "@/lib/data";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/signals")({
  head: () => ({
    meta: [
      { title: "Signal History — Crypto Signal Terminal" },
      { name: "description", content: "Independent Binance Futures entry, breakeven, stop loss and take profit history." },
      { property: "og:title", content: "Signal History — Crypto Signal Terminal" },
      { property: "og:description", content: "Live, recovered and historical signal events from the independent engine." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Signals,
});

const sel = "h-9 rounded-md border border-input bg-transparent px-2 font-mono text-xs";

function Signals() {
  const events = useEvents();
  const tz = useSettings().data?.display_timezone ?? "UTC";
  const [coin, setCoin] = useState("");
  const [dir, setDir] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rows = useMemo(
    () =>
      (events.data ?? []).filter(
        (e) =>
          (!coin || e.symbol === coin) &&
          (!dir || e.direction === dir) &&
          (!type || e.event_type === type) &&
          (!from || e.timestamp >= new Date(from).toISOString()) &&
          (!to || e.timestamp <= new Date(`${to}T23:59:59Z`).toISOString()),
      ),
    [events.data, coin, dir, type, from, to],
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Signal history</h1>
      <div className="flex flex-wrap gap-2 border-y border-border py-3">
        <select className={sel} value={coin} onChange={(e) => setCoin(e.target.value)}>
          <option value="">All coins</option>
          {SYMBOLS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className={sel} value={dir} onChange={(e) => setDir(e.target.value)}>
          <option value="">Both directions</option><option>LONG</option><option>SHORT</option>
        </select>
        <select className={sel} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All events</option>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 font-mono text-xs" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 font-mono text-xs" aria-label="To date" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr className="border-b border-border">
              {["Time", "Coin", "Side", "Event", "Source", "TF", "Entry", "Stop loss", "Take profit", "Processing"].map((h) => (
                <th key={h} className="px-3 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.isLoading && <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!events.isLoading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">No events received yet.</td></tr>
            )}
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-border/60 hover:bg-accent/40">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{fmtTime(e.timestamp, tz)}</td>
                <td className="px-3 py-2 font-mono font-semibold">{e.symbol}</td>
                <td className="px-3 py-2"><StatusBadge value={e.direction} /></td>
                <td className="px-3 py-2 font-mono text-xs">{e.event_type}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground" title={e.trade_id}>{e.source.toUpperCase()}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.timeframe}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{fmtPrice(e.entry_price)}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{fmtPrice(e.stop_loss)}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{fmtPrice(e.take_profit)}</td>
                <td className="px-3 py-2" title={e.processing_note ?? ""}><StatusBadge value={e.processed_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
