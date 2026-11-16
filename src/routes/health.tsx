import { createFileRoute } from "@tanstack/react-router";
import { fmtTime, useSettings, useStatuses, useTelegramLogs, useMarkets, useStats } from "@/lib/data";
import { formatUptime } from '@/lib/engine/health';
import { SYMBOLS } from '@/lib/config';
import { StatusBadge } from "@/components/terminal/StatusBadge";

export const Route = createFileRoute("/health")({
  head: () => ({
    meta: [
      { title: "System Health — Crypto Signal Terminal" },
      { name: "description", content: "Binance Futures, WebSocket, signal engine, database and Telegram connection health." },
      { property: "og:title", content: "System Health — Crypto Signal Terminal" },
      { property: "og:description", content: "Real connection status and candle-processing health for the independent signal engine." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Health,
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-mono text-xs">{children}</span>
    </div>
  );
}

function Health() {
  const s = useStatuses();
  const logs = useTelegramLogs();
  const tz = useSettings().data?.display_timezone ?? "UTC";
  const h = s.health;
  const markets = useMarkets();
  const stats = useStats().data;
  const lastSent = logs.data?.find((l) => l.delivery_status === "SENT");
  const lastFailed = logs.data?.find((l) => l.delivery_status === "FAILED");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">System health</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="py-4 lg:pr-8">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Signal pipeline</h2>
          <Row label="Cloud scanner (Render)"><StatusBadge value={s.cloud} /></Row>
          <Row label="Binance REST"><StatusBadge value={s.binance} /></Row>
          <Row label="Binance WebSocket"><StatusBadge value={s.websocket} /></Row>
          <Row label="Scanner Engine"><StatusBadge value={s.scanner} /></Row>
          <Row label="Service hosting">{h?.engine?.runtime_mode === 'temporary' ? 'TEMPORARY VERIFICATION' : h?.engine?.host_kind === 'hosted' ? 'RENDER CLOUD' : 'NOT CONFIRMED'}</Row>
          <Row label="Engine uptime · last reported">{formatUptime(h?.uptimeSeconds)}</Row>
          <Row label="Last successful scan">{fmtTime(h?.lastScanAt, tz)}</Row>
          <Row label="Next scan · expected candle close">{fmtTime(h?.nextScanAt, tz)}</Row>
          <Row label="Successful candle scans">{h?.successfulScans ?? '—'}</Row>
          <Row label="Total coins scanned">{h?.scannedSymbols ?? '—'} / {SYMBOLS.length}</Row>
          <Row label="Last heartbeat">{fmtTime(h?.engine?.last_heartbeat_at, tz)}</Row>
          <Row label="Last confirmed candle">{fmtTime(h?.lastCandleAt, tz)}</Row>
          <Row label="Last generated signal">{fmtTime(h?.lastSignalAt, tz)}</Row>
          <Row label="Available / configured coins">{h?.engine?.available_symbols ?? '—'} / {SYMBOLS.length}</Row>
          <Row label="Active positions">{h?.activePositions ?? '—'}</Row>
          <Row label="Active LONG signals">{stats?.activeLong ?? '—'}</Row>
          <Row label="Active SHORT signals">{stats?.activeShort ?? '—'}</Row>
          <Row label="Last error">{s.healthQuery.isError ? 'Health unavailable' : h?.engine?.error ?? '—'}</Row>
          <Row label="Database"><StatusBadge value={s.healthQuery.isError ? "ERROR" : h ? (h.databaseOk ? "CONNECTED" : "ERROR") : "WAITING"} /></Row>
        </section>
        <section className="py-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Telegram</h2>
          <Row label="Bot configuration"><StatusBadge value={h ? (h.botConfigured ? "CONNECTED" : "NOT CONFIGURED") : "WAITING"} /></Row>
          <Row label="Target chat"><StatusBadge value={h ? (h.chatConfigured ? "CONNECTED" : "NOT CONFIGURED") : "WAITING"} /></Row>
          <Row label="Latest Telegram delivery status"><StatusBadge value={s.telegram} /></Row>
          <Row label="Last successful delivery">{fmtTime(h?.lastTelegramAt ?? lastSent?.updated_at, tz)}</Row>
          <Row label="Last failed delivery">{fmtTime(lastFailed?.updated_at, tz)}</Row>
        </section>
      </div>
      {h?.engine?.error && <p className="border-l-2 border-short bg-short/10 p-3 text-sm text-short">{h.engine.error}</p>}
      {!h?.engine && <p className="border-l-2 border-waiting bg-waiting/5 p-3 text-sm text-waiting">Always-on monitoring has not started. Engine deployment is pending.</p>}
      <section className="border-t border-border pt-5"><h2 className="mb-3 text-xs uppercase text-muted-foreground">Contract feeds</h2><div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">{SYMBOLS.map((symbol) => {
        const m = markets.data?.find((row) => row.symbol === symbol);
        return <Row key={symbol} label={symbol}><StatusBadge value={m?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : !h?.heartbeatFresh || h.engine?.status === 'STOPPED' ? 'OFFLINE' : m?.status ?? 'WAITING'} /></Row>;
      })}</div></section>
    </div>
  );
}
