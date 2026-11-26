import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Wallet } from "lucide-react";
import { fmtTime, useEvents, useSettings, useStatuses, useTelegramLogs } from "@/lib/data";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { sentResultSummary, sentSignalSummary } from "@/lib/signal-summary";
import { fmtSignedUsd, fmtUsd, useCstfSimulator, useSimTrades } from "@/lib/simulator";
import { CSTF_RULES, cstfMarginFor } from "@/lib/engine/cstf-account";
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
  const tz = settings.data?.display_timezone ?? "UTC";
  const sig = sentSignalSummary(logs.data ?? [], events.data ?? []);
  const signalsReady = logs.isSuccess && events.isSuccess;
  // prompt-74: results from the old account and the active CSTF account both count.
  const results = sentResultSummary(logs.data ?? [], [...(trades.data ?? []), ...(cstf.data?.trades ?? []).map((t) => ({ trade_id: t.signal_id, exit_reason: t.exit_reason }))]);
  const resultsReady = logs.isSuccess && trades.isSuccess && cstf.isSuccess;
  const acc = cstf.data?.account; const simReady = cstf.isSuccess && !!acc;
  const cstfClosed = (cstf.data?.trades ?? []).filter((t) => t.status === 'CLOSED');
  const realized = cstfClosed.reduce((a, t) => a + Number(t.net ?? 0), 0);
  const tps = cstfClosed.filter((t) => t.exit_reason === 'TAKE_PROFIT').length;
  const openList = (cstf.data?.trades ?? []).filter((t) => t.status === 'OPEN');
  const mainBalance = acc ? Number(acc.wallet) + openList.reduce((v, t) => v + Number(t.entry_fee) + Number(t.funding), 0) : null;
  const statuses: [string, string][] = [["System", s.system], ["Cloud", s.cloud], ["Scanner", s.scanner], ["Binance", s.binance], ["WebSocket", s.websocket], ["Telegram", s.telegram]];

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Activity className="size-3" /> BINANCE USD-M FUTURES · CSTF 30-MINUTE SIMULATOR</div>
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
          <Tile label="Stop loss / liquidated" value={resultsReady ? results.stopLoss : '—'} tone="text-short" />
          <Tile label="Success rate" value={!resultsReady || results.successRate === null ? '—' : `${results.successRate.toFixed(1)}%`} tone="text-long" hint="Take profit hits ÷ results sent" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><Wallet className="size-3.5" /> Crypto Simulator{acc?.stopped_at ? ' · stopped, no new trades' : ''}</h2>
          <Link to="/simulator" className="flex items-center gap-1 text-xs text-primary hover:underline">Open simulator <ArrowRight className="size-3" /></Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Tile label="Main balance" value={simReady && mainBalance !== null ? fmtUsd(mainBalance) : '—'} hint={acc?.stopped_at ? 'Stopped by you · history kept' : simReady && mainBalance !== null ? `Next trade margin $${cstfMarginFor(mainBalance).toFixed(2)} (5%)` : `Started with ${fmtUsd(CSTF_RULES.startingBalance)}`} />
          <Tile label="Equity" value={simReady ? fmtUsd(acc?.equity) : '—'} />
          <Tile label="Realized P&L" value={simReady ? fmtSignedUsd(realized) : '—'} tone={realized > 0 ? 'text-long' : realized < 0 ? 'text-short' : undefined} />
          <Tile label="Take profits" value={simReady ? tps : '—'} hint={simReady ? `${cstfClosed.length - tps} liquidated` : undefined} />
          <Tile label={`Open trades (${openList.length}/${CSTF_RULES.slots})`} value={!simReady ? '—' : openList.length ? openList.map((t) => `${t.symbol.replace('USDT', '')} ${t.side}`).join(' · ') : 'None'} tone={openList.length ? undefined : 'text-muted-foreground'} hint="CSTF v4 Strong Trend 30m · 75x cross" />
        </div>
      </section>
    </div>
  );
}
