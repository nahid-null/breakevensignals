import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Wallet } from "lucide-react";
import { fmtTime, useEvents, useSettings, useStatuses, useTelegramLogs } from "@/lib/data";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { sentResultSummary, sentSignalSummary } from "@/lib/signal-summary";
import { fmtSignedUsd, fmtUsd, useCstfSimulator, useSimTrades, useStSimulator } from "@/lib/simulator";
import { ST_RULES, stMarginFor } from "@/lib/engine/st-account";
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
  const trades = useSimTrades();
  const cstf = useCstfSimulator();
  const stq = useStSimulator();
  const tz = settings.data?.display_timezone ?? "UTC";
  const sig = sentSignalSummary(logs.data ?? [], events.data ?? []);
  const signalsReady = logs.isSuccess && events.isSuccess;
  // Results from the old accounts (kept history) and the active SuperTrend account all count.
  const results = sentResultSummary(logs.data ?? [], [...(trades.data ?? []), ...(cstf.data?.trades ?? []).map((t) => ({ trade_id: t.signal_id, exit_reason: t.exit_reason })),
    ...(stq.data?.trades ?? []).filter((t) => t.status === 'CLOSED').map((t) => ({ trade_id: t.trade_id, exit_reason: t.exit_reason, won: Number(t.net) > 0 }))]);
  const resultsReady = logs.isSuccess && trades.isSuccess && cstf.isSuccess && stq.isSuccess;
  // prompt-81: the dashboard Simulator card shows the active SuperTrend Simulator.
  const acc = stq.data?.account; const simReady = stq.isSuccess && !!acc;
  const stClosed = (stq.data?.trades ?? []).filter((t) => t.status === 'CLOSED');
  const realized = stClosed.reduce((a, t) => a + Number(t.net ?? 0), 0);
  const wins = stClosed.filter((t) => Number(t.net) > 0).length;
  const openList = (stq.data?.trades ?? []).filter((t) => t.status === 'OPEN');
  const mainBalance = acc ? Number(acc.main_balance) : null;
  const statuses: [string, string][] = [["System", s.system], ["Cloud", s.cloud], ["Scanner", s.scanner], ["Binance", s.binance], ["WebSocket", s.websocket], ["Telegram", s.telegram]];

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Activity className="size-3" /> BINANCE FUTURES · SUPERTREND 30-MINUTE SIMULATOR</div>
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
          <Tile label="Profitable / take profit" value={resultsReady ? results.takeProfit : '—'} tone="text-long" />
          <Tile label="Loss / liquidated" value={resultsReady ? results.stopLoss : '—'} tone="text-short" />
          <Tile label="Success rate" value={!resultsReady || results.successRate === null ? '—' : `${results.successRate.toFixed(1)}%`} tone="text-long" hint="Profitable results ÷ results sent" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><Wallet className="size-3.5" /> SuperTrend Simulator</h2>
          <Link to="/simulator" className="flex items-center gap-1 text-xs text-primary hover:underline">Open simulator <ArrowRight className="size-3" /></Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Tile label="Main balance" value={simReady && mainBalance !== null ? fmtUsd(mainBalance) : '—'} hint={simReady && mainBalance !== null ? `Next trade margin $${stMarginFor(mainBalance).toFixed(4)} (5%)` : `Started with ${fmtUsd(ST_RULES.startingBalance)}`} />
          <Tile label="Equity" value={simReady ? fmtUsd(acc?.equity) : '—'} />
          <Tile label="Realized P&L" value={simReady ? fmtSignedUsd(realized) : '—'} tone={realized > 0 ? 'text-long' : realized < 0 ? 'text-short' : undefined} />
          <Tile label="Completed trades" value={simReady ? stClosed.length : '—'} hint={simReady && stClosed.length ? `Win rate ${(wins / stClosed.length * 100).toFixed(1)}%` : undefined} />
          <Tile label={`Open trades (${openList.length}/${ST_RULES.slots})`} value={!simReady ? '—' : openList.length ? openList.map((t) => `${t.symbol.replace('USDT', '')} ${t.side}`).join(' · ') : 'None yet'} tone={openList.length ? undefined : 'text-muted-foreground'} hint="SuperTrend 5 · hl2 · 1.6 · 30m · 75x cross" />
        </div>
      </section>
    </div>
  );
}
