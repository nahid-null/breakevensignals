import { createFileRoute } from "@tanstack/react-router";
import { fmtTime, useSettings, useStatuses, useTelegramLogs } from "@/lib/data";
import { StatusBadge } from "@/components/terminal/StatusBadge";

export const Route = createFileRoute("/health")({
  head: () => ({
    meta: [
      { title: "System Health — Crypto Signal Terminal" },
      { name: "description", content: "Webhook, database and Telegram connection status." },
      { property: "og:title", content: "System Health — Crypto Signal Terminal" },
      { property: "og:description", content: "Webhook, database and Telegram connection status." },
    ],
  }),
  component: Health,
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-sm">{children}</span>
    </div>
  );
}

function Health() {
  const s = useStatuses();
  const logs = useTelegramLogs();
  const tz = useSettings().data?.display_timezone ?? "UTC";
  const h = s.health;
  const lastSent = logs.data?.find((l) => l.delivery_status === "SENT");
  const lastFailed = logs.data?.find((l) => l.delivery_status === "FAILED");
  return (
    <div className="space-y-4">
      <h1 className="font-mono text-lg tracking-widest">SYSTEM HEALTH</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Signal pipeline</h2>
          <Row label="TradingView alerts (42)"><StatusBadge value="MANUAL VERIFICATION REQUIRED" /></Row>
          <Row label="Webhook endpoint"><StatusBadge value={s.webhook} /></Row>
          <Row label="Last received webhook">{fmtTime(h?.lastWebhookAt, tz)}</Row>
          <Row label="Last processed event">{fmtTime(h?.lastProcessedAt, tz)}</Row>
          <Row label="Rejected / failed webhooks"><span className={h?.failedWebhooks ? "text-short" : ""}>{h?.failedWebhooks ?? "—"}</span></Row>
          <Row label="Database"><StatusBadge value={s.healthQuery.isError ? "ERROR" : h ? (h.databaseOk ? "CONNECTED" : "ERROR") : "WAITING"} /></Row>
        </section>
        <section className="glass p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Telegram</h2>
          <Row label="Bot configuration"><StatusBadge value={h ? (h.botConfigured ? "CONNECTED" : "NOT CONFIGURED") : "WAITING"} /></Row>
          <Row label="Target chat"><StatusBadge value={h ? (h.chatConfigured ? "CONNECTED" : "NOT CONFIGURED") : "WAITING"} /></Row>
          <Row label="Telegram API status"><StatusBadge value={s.telegram} /></Row>
          <Row label="Last successful delivery">{fmtTime(lastSent?.created_at, tz)}</Row>
          <Row label="Last failed delivery">{fmtTime(lastFailed?.created_at, tz)}</Row>
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        TradingView does not share alert status with outside apps, so check in TradingView that all 42 alerts are active. Statuses here only turn green after real data arrives.
      </p>
    </div>
  );
}
