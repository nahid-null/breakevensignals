import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { SYMBOLS } from "@/lib/config";
import { fmtPrice, fmtTime, latestBySymbol, useEvents, usePositions, useSettings, useStatuses, useTelegramLogs, type Position } from "@/lib/data";
import { StatusBadge, positionLabel } from "@/components/terminal/StatusBadge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Crypto Signal Terminal" },
      { name: "description", content: "Live LONG and SHORT positions for 21 Binance USDT futures pairs." },
      { property: "og:title", content: "Dashboard — Crypto Signal Terminal" },
      { property: "og:description", content: "Live LONG and SHORT positions for 21 Binance USDT futures pairs." },
    ],
  }),
  component: Dashboard,
});

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string | undefined }) {
  return (
    <div className="glass p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

type Filter = "ALL" | "LONG" | "SHORT" | "ACTIVE" | "BREAKEVEN" | "COMPLETED";
const COMPLETED = ["STOP_LOSS_HIT", "TAKE_PROFIT_HIT"];

function Cells({ p }: { p: Position | undefined }) {
  const tone = p?.direction === "LONG" ? "text-long" : "text-short";
  return (
    <>
      <td className="px-3 py-2.5"><StatusBadge value={positionLabel(p?.status)} /></td>
      <td className={cn("px-3 py-2.5 font-mono tabular-nums", p ? tone : "text-muted-foreground")}>{fmtPrice(p?.entry_price)}</td>
      <td className={cn("px-3 py-2.5 font-mono tabular-nums", p?.status === "BREAKEVEN" ? "text-breakeven" : "text-muted-foreground")}>{fmtPrice(p?.current_stop_loss)}</td>
      <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">{fmtPrice(p?.take_profit)}</td>
    </>
  );
}

function Dashboard() {
  const positions = usePositions();
  const events = useEvents();
  const logs = useTelegramLogs();
  const settings = useSettings();
  const { health } = useStatuses();
  const tz = settings.data?.display_timezone ?? "UTC";
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<"latest" | "symbol">("symbol");

  const latest = useMemo(() => latestBySymbol(positions.data), [positions.data]);
  const all = positions.data ?? [];
  const stats = {
    activeLong: all.filter((p) => p.direction === "LONG" && p.status === "ACTIVE").length,
    activeShort: all.filter((p) => p.direction === "SHORT" && p.status === "ACTIVE").length,
    be: all.filter((p) => p.status === "BREAKEVEN").length,
    done: all.filter((p) => COMPLETED.includes(p.status)).length,
    entries: (events.data ?? []).filter((e) => e.event_type === "entry_confirmed").length,
    beEvents: (events.data ?? []).filter((e) => e.event_type === "breakeven_activated").length,
    sent: (logs.data ?? []).filter((l) => !l.is_test && l.delivery_status === "SENT").length,
  };

  const rows = useMemo(() => {
    let r = SYMBOLS.map((s) => ({ symbol: s, long: latest.get(`${s}:LONG`), short: latest.get(`${s}:SHORT`) }));
    if (q) r = r.filter((x) => x.symbol.includes(q.toUpperCase()));
    const has = (p: Position | undefined, f: (p: Position) => boolean) => !!p && f(p);
    if (filter === "LONG") r = r.filter((x) => x.long);
    if (filter === "SHORT") r = r.filter((x) => x.short);
    if (filter === "ACTIVE") r = r.filter((x) => has(x.long, (p) => p.status === "ACTIVE") || has(x.short, (p) => p.status === "ACTIVE"));
    if (filter === "BREAKEVEN") r = r.filter((x) => has(x.long, (p) => p.status === "BREAKEVEN") || has(x.short, (p) => p.status === "BREAKEVEN"));
    if (filter === "COMPLETED") r = r.filter((x) => has(x.long, (p) => COMPLETED.includes(p.status)) || has(x.short, (p) => COMPLETED.includes(p.status)));
    const ts = (x: (typeof r)[number]) => Math.max(new Date(x.long?.updated_at ?? 0).getTime(), new Date(x.short?.updated_at ?? 0).getTime());
    if (sort === "latest") r = [...r].sort((a, b) => ts(b) - ts(a));
    return r;
  }, [latest, q, filter, sort]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Monitored coins" value={SYMBOLS.length} />
        <Stat label="LONG systems" value={SYMBOLS.length} tone="text-long" />
        <Stat label="SHORT systems" value={SYMBOLS.length} tone="text-short" />
        <Stat label="Active LONG" value={stats.activeLong} tone="text-long" />
        <Stat label="Active SHORT" value={stats.activeShort} tone="text-short" />
        <Stat label="Breakeven active" value={stats.be} tone="text-breakeven" />
        <Stat label="Completed" value={stats.done} />
        <Stat label="Entry signals" value={stats.entries} />
        <Stat label="Breakeven events" value={stats.beEvents} tone="text-breakeven" />
        <Stat label="Telegram sent" value={stats.sent} />
        <Stat label="Failed webhooks" value={health?.failedWebhooks ?? "—"} tone={health?.failedWebhooks ? "text-short" : undefined} />
        <Stat label="Last webhook" value={health?.lastWebhookAt ? fmtTime(health.lastWebhookAt, tz).split(" ")[1] ?? "—" : "—"} />
      </section>

      <section className="glass overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coin" className="h-9 w-48 pl-8 font-mono" />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["ALL", "LONG", "SHORT", "ACTIVE", "BREAKEVEN", "COMPLETED"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn("rounded px-2.5 py-1 font-mono text-[11px] transition-colors", filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1 text-[11px]">
            <span className="self-center text-muted-foreground">SORT</span>
            {(["symbol", "latest"] as const).map((s) => (
              <button key={s} onClick={() => setSort(s)} className={cn("rounded px-2.5 py-1 font-mono", sort === s ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent")}>
                {s === "symbol" ? "COIN" : "LATEST SIGNAL"}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left">Coin</th>
                <th className="px-3 py-2 text-left text-long">Long status</th>
                <th className="px-3 py-2 text-left">Long entry</th>
                <th className="px-3 py-2 text-left">Long SL</th>
                <th className="px-3 py-2 text-left">Long TP</th>
                <th className="px-3 py-2 text-left text-short">Short status</th>
                <th className="px-3 py-2 text-left">Short entry</th>
                <th className="px-3 py-2 text-left">Short SL</th>
                <th className="px-3 py-2 text-left">Short TP</th>
                <th className="px-3 py-2 text-left">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {positions.isLoading && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">Loading positions…</td></tr>
              )}
              {positions.isError && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-short">Could not load positions: {positions.error.message}</td></tr>
              )}
              {!positions.isLoading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">No coins match this filter.</td></tr>
              )}
              {!positions.isLoading && rows.map((r) => {
                const upd = [r.long?.updated_at, r.short?.updated_at].filter(Boolean).sort().pop();
                return (
                  <tr key={r.symbol} className="border-b border-border/60 transition-colors hover:bg-accent/40">
                    <td className="px-3 py-2.5 font-mono font-semibold">{r.symbol}</td>
                    <Cells p={r.long} />
                    <Cells p={r.short} />
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{fmtTime(upd, tz)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        Every coin shows WAITING until a real alert arrives from your TradingView indicators. Values update automatically.
      </p>
    </div>
  );
}
