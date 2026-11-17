import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Activity, ArrowDownWideNarrow } from "lucide-react";
import { SYMBOLS } from "@/lib/config";
import { fmtPrice, fmtTime, latestBySymbol, usePositions, useSettings, useStatuses, useMarkets, useStats, type Position } from "@/lib/data";
import { StatusBadge, positionLabel } from "@/components/terminal/StatusBadge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';
import { winRate } from '@/lib/engine/stats';
import { lastSignalTime } from '@/lib/engine/position-values';
import { ScannerMonitor } from '@/components/terminal/ScannerMonitor';
import { contractFeedStatus } from '@/lib/engine/market-policy';

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Coin Monitor — Crypto Signal Terminal" },
      { name: "description", content: "Per-coin prices and original Pine LONG/SHORT positions for 21 Binance USDT futures pairs." },
      { property: "og:title", content: "Coin Monitor — Crypto Signal Terminal" },
      { property: "og:description", content: "Per-coin prices and original Pine LONG/SHORT positions for 21 Binance USDT futures pairs." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Markets,
});

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string | undefined }) {
  return (
    <div className="border-l border-border px-4 py-2 first:border-0">
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
      <td className="px-3 py-2.5 font-mono text-xs"><span className={p?.breakeven_timestamp ? 'text-breakeven' : 'text-muted-foreground'}>{p?.breakeven_timestamp ? 'ACTIVATED' : '—'}</span></td>
    </>
  );
}

function Markets() {
  const positions = usePositions();
  const markets = useMarkets();
  const statsQuery = useStats();
  const settings = useSettings();
  const { health, system, scanner, healthQuery } = useStatuses();
  const tz = settings.data?.display_timezone ?? "UTC";
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<"latest" | "symbol">("symbol");
  const [view, setView] = useState<'BOTH' | 'LONG' | 'SHORT'>('BOTH');
  const marketMap = new Map(markets.data?.map((m) => [m.symbol, m]));

  const latest = useMemo(() => latestBySymbol(positions.data), [positions.data]);
  const stats = statsQuery.data;
  const rate = stats ? winRate(stats) : null;

  const rows = useMemo(() => {
    let r = SYMBOLS.map((s) => ({ symbol: s, long: latest.get(`${s}:LONG`), short: latest.get(`${s}:SHORT`) }));
    if (q) r = r.filter((x) => x.symbol.includes(q.toUpperCase()));
    const has = (p: Position | undefined, f: (p: Position) => boolean) => !!p && f(p);
    if (filter === "LONG") r = r.filter((x) => x.long);
    if (filter === "SHORT") r = r.filter((x) => x.short);
    if (filter === "ACTIVE") r = r.filter((x) => has(x.long, (p) => ['ACTIVE','BREAKEVEN'].includes(p.status)) || has(x.short, (p) => ['ACTIVE','BREAKEVEN'].includes(p.status)));
    if (filter === "BREAKEVEN") r = r.filter((x) => has(x.long, (p) => p.status === "BREAKEVEN") || has(x.short, (p) => p.status === "BREAKEVEN"));
    if (filter === "COMPLETED") r = r.filter((x) => has(x.long, (p) => COMPLETED.includes(p.status)) || has(x.short, (p) => COMPLETED.includes(p.status)));
    const ts = (x: (typeof r)[number]) => Math.max(x.long ? Date.parse(lastSignalTime(x.long)) : 0, x.short ? Date.parse(lastSignalTime(x.short)) : 0);
    if (sort === "latest") r = [...r].sort((a, b) => ts(b) - ts(a));
    else r = [...r].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return r;
  }, [latest, q, filter, sort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Activity className="size-3" /> BINANCE USD-M FUTURES · 1 MINUTE</div><h1 className="text-2xl font-semibold">Market terminal</h1></div>
        <div className="text-right font-mono text-xs text-muted-foreground">21 PAIRS · 42 INDEPENDENT SYSTEMS<br /><span className={system === 'ONLINE' ? 'text-long' : 'text-waiting'}>{scanner}</span></div>
      </div>
      {(system !== 'ONLINE' || health?.engine?.runtime_mode === 'temporary') && <div className="border-l-2 border-waiting bg-waiting/5 px-4 py-3 text-sm text-waiting">{health?.engine?.runtime_mode === 'temporary'
        ? system === 'ONLINE' ? 'Temporary real-market verification is running. Permanent monitoring is not deployed.' : 'Temporary verification stopped. Prices are last saved values; permanent monitoring is not deployed.'
        : health?.engine?.error ?? (health?.engine ? 'Signal monitoring is not confirmed online. Check System Health.' : 'Always-on engine not deployed. Live monitoring has not started.')}</div>}
      <ScannerMonitor />
      <section className="grid grid-cols-2 gap-y-4 border-y border-border py-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Available / configured" value={`${health?.engine?.available_symbols ?? '—'} / 21`} />
        <Stat label="Active LONG" value={stats?.activeLong ?? '—'} tone="text-long" />
        <Stat label="Active SHORT" value={stats?.activeShort ?? '—'} tone="text-short" />
        <Stat label="Breakeven active" value={stats?.breakeven ?? '—'} tone="text-breakeven" />
        <Stat label="Completed" value={stats?.completed ?? '—'} />
        <Stat label="Win rate · net costs" value={rate === null ? '—' : `${rate.toFixed(1)}%`} />
      </section>

      <section className="overflow-hidden border-y border-border">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coin" className="h-9 w-48 pl-8 font-mono" />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["ALL", "LONG", "SHORT", "ACTIVE", "BREAKEVEN", "COMPLETED"] as Filter[]).map((f) => (
              <Button variant="ghost" size="sm"
                key={f}
                onClick={() => setFilter(f)}
                className={cn("rounded px-2.5 py-1 font-mono text-[11px] transition-colors", filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
              >
                {f}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-1 text-[11px]">
            {(['BOTH','LONG','SHORT'] as const).map((v) => <Button key={v} size="sm" variant="ghost" onClick={() => setView(v)} className={cn('font-mono text-[11px]', view === v && 'bg-accent')}>{v}</Button>)}
            <ArrowDownWideNarrow className="mx-1 size-4 self-center text-muted-foreground" />
            <span className="self-center text-muted-foreground">SORT</span>
            {(["symbol", "latest"] as const).map((s) => (
              <Button variant="ghost" size="sm" key={s} onClick={() => setSort(s)} className={cn("rounded px-2.5 py-1 font-mono text-[11px]", sort === s ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent")}>
                {s === "symbol" ? "COIN" : "LATEST SIGNAL"}
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left">Coin</th>
                <th className="px-3 py-2 text-left">Price</th>
                <th className="px-3 py-2 text-left">Pine trend / feed</th>
                {view !== 'SHORT' && <>
                <th className="px-3 py-2 text-left text-long">Long status</th>
                <th className="px-3 py-2 text-left">Long entry</th>
                <th className="px-3 py-2 text-left">Long SL</th>
                <th className="px-3 py-2 text-left">Long TP</th>
                <th className="px-3 py-2 text-left">Long BE</th></>}
                {view !== 'LONG' && <>
                <th className="px-3 py-2 text-left text-short">Short status</th>
                <th className="px-3 py-2 text-left">Short entry</th>
                <th className="px-3 py-2 text-left">Short SL</th>
                <th className="px-3 py-2 text-left">Short TP</th>
                <th className="px-3 py-2 text-left">Short BE</th></>}
                <th className="px-3 py-2 text-left">Last signal</th>
              </tr>
            </thead>
            <tbody>
              {positions.isLoading && (
                <tr><td colSpan={14} className="px-3 py-10 text-center text-muted-foreground">Loading positions…</td></tr>
              )}
              {positions.isError && (
                <tr><td colSpan={14} className="px-3 py-10 text-center text-short">Could not load positions.</td></tr>
              )}
              {!positions.isLoading && rows.length === 0 && (
                <tr><td colSpan={14} className="px-3 py-10 text-center text-muted-foreground">No coins match this filter.</td></tr>
              )}
              {!positions.isLoading && rows.map((r) => {
                const upd = [r.long ? lastSignalTime(r.long) : null, r.short ? lastSignalTime(r.short) : null]
                  .filter((time): time is string => time !== null).sort((a, b) => Date.parse(a) - Date.parse(b)).pop();
                const m = marketMap.get(r.symbol);
                const feed = contractFeedStatus(m, health, healthQuery.isError || markets.isError);
                return (
                  <tr key={r.symbol} className="border-b border-border/60 transition-colors hover:bg-accent/40">
                    <td className="px-3 py-2.5 font-mono font-semibold">{r.symbol}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">{fmtPrice(m?.price)}{m && feed !== 'LIVE' && <div className="mt-1 text-[9px] text-muted-foreground">LAST SAVED · {fmtTime(m.last_candle_at, tz)}</div>}</td>
                    <td className="px-3 py-2.5"><div className="flex flex-col items-start gap-1"><StatusBadge value={m?.trend ?? 'WAITING'} /><span title={m?.error ?? ''} className="font-mono text-[9px] text-muted-foreground">{feed}</span></div></td>
                    {view !== 'SHORT' && <Cells p={r.long} />}
                    {view !== 'LONG' && <Cells p={r.short} />}
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{fmtTime(upd, tz)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-3 font-mono text-[10px] text-muted-foreground"><span>ENTRIES {stats?.entries ?? '—'}</span><span>BREAKEVEN EVENTS {stats?.breakevenEvents ?? '—'}</span><span>TELEGRAM SENT {stats?.telegramSent ?? '—'}</span><span>NET RESULT {stats ? Number(stats.netR).toFixed(3) : '—'}R</span><span>LAST CANDLE {fmtTime(health?.lastCandleAt, tz)}</span></div>
    </div>
  );
}
