import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Wallet } from "lucide-react";
import { fmtTime, useEvents, useSettings, useStatuses, useTelegramLogs } from "@/lib/data";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { sentResultSummary, sentSignalSummary } from "@/lib/signal-summary";
import { fmtSignedUsd, fmtUsd, simSessionTrades, simSummary, todayPnl, useSimAccount, useSimTrades } from "@/lib/simulator";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Crypto Signal Terminal" },
      { name: "description", content: "System status, Telegram signal results and simulator balance at a glance." },
      { property: "og:title", content: "Dashboard — Crypto Signal Terminal" },
      { property: "og:description", content: "System status, Telegram signal results and simulator balance at a glance." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Dashboard,
});

function Tile({ label, value, tone, hint }: { label: string; value: string | number; tone?: string | undefined; hint?: string | undefined }) {
  return (
    <div className="border border-border bg-card/40 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Dashboard() {
  const s = useStatuses();
  const logs = useTelegramLogs();
  const events = useEvents();
  const settings = useSettings();
  const account = useSimAccount();
  const trades = useSimTrades();
  const tz = settings.data?.display_timezone ?? "UTC";
  const sig = sentSignalSummary(logs.data ?? [], events.data ?? []);
  const session = simSessionTrades(trades.data ?? [], account.data?.session_started_at);
  const sim = simSummary(session);
  const signalsReady = logs.isSuccess && events.isSuccess;
  const results = sentResultSummary(logs.data ?? [], trades.data ?? []);
  const resultsReady = logs.isSuccess && trades.isSuccess;
  const simReady = trades.isSuccess && account.isSuccess && account.data !== null;
  const today = todayPnl(session, new Date(), tz);
  const openList = trades.data?.filter((t) => t.status === 'OPEN') ?? [];
  const open = openList[0];
  const statuses: [string, string][] = [["System", s.system], ["Cloud", s.cloud], ["Scanner", s.scanner], ["Binance", s.binance], ["WebSocket", s.websocket], ["Telegram", s.telegram]];

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Activity className="size-3" /> BINANCE USD-M FUTURES · PINE 5-MINUTE SIGNALS</div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">System</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {statuses.map(([label, value]) => (
            <div key={label} className="border border-border bg-card/40 px-3 py-3">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
              <StatusBadge value={value} />
            </div>
          ))}
          <div className="border border-border bg-card/40 px-3 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Last candle</div>
            <div className="font-mono text-xs">{fmtTime(s.health?.lastCandleAt, tz)}</div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Trade results sent to Telegram</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Results sent" value={resultsReady ? results.sent : '—'} hint={signalsReady ? `Earlier breakeven alerts: ${sig.sent}` : undefined} />
          <Tile label="Take profit hit" value={resultsReady ? results.takeProfit : '—'} tone="text-long" />
          <Tile label="Stop loss hit" value={resultsReady ? results.stopLoss : '—'} tone="text-short" />
          <Tile label="Success rate" value={!resultsReady || results.successRate === null ? '—' : `${results.successRate.toFixed(1)}%`} tone="text-long" hint="Take profit hits ÷ results sent" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><Wallet className="size-3.5" /> Simulator</h2>
          <Link to="/simulator" className="flex items-center gap-1 text-xs text-primary hover:underline">Open simulator <ArrowRight className="size-3" /></Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Tile label="Balance" value={fmtUsd(account.data?.balance)} />
          <Tile label="Today's P&L" value={simReady ? fmtSignedUsd(today) : '—'} tone={today > 0 ? 'text-long' : today < 0 ? 'text-short' : undefined} />
          <Tile label="Session P&L" value={simReady ? fmtSignedUsd(sim.totalPnl) : '—'} tone={sim.totalPnl > 0 ? 'text-long' : sim.totalPnl < 0 ? 'text-short' : undefined} />
          <Tile label="Win rate" value={!simReady || sim.winRate === null ? '—' : `${sim.winRate.toFixed(1)}%`} hint={simReady ? `${sim.closed} closed session trades` : undefined} />
          <Tile label={openList.length > 1 ? `Open trades (${openList.length})` : "Open trade"} value={!simReady ? '—' : open ? openList.map((t) => `${t.symbol.replace('USDT', '')} ${t.direction}`).join(' · ') : 'None'} tone={open ? (open.direction === 'LONG' ? 'text-long' : 'text-short') : 'text-muted-foreground'} hint={open ? `${open.leverage}x · ${open.rule_version === 'LEGACY' ? 'previous rules' : open.rule_version === 'PINE1_CROSS' ? '1m Pine · cross margin' : open.rule_version === 'PINE5_TREND' ? '5m Pine + trend' : 'Pine'}` : undefined} />
        </div>
      </section>
    </div>
  );
}
