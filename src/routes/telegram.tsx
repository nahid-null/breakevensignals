import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import { fmtTime, useSettings, useTelegramLogs } from "@/lib/data";
import { retryTelegram } from "@/lib/ops.functions";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/telegram")({
  head: () => ({
    meta: [
      { title: "Telegram History — Crypto Signal Terminal" },
      { name: "description", content: "Breakeven notifications sent to Telegram with delivery status." },
      { property: "og:title", content: "Telegram History — Crypto Signal Terminal" },
      { property: "og:description", content: "Breakeven notifications sent to Telegram." },
    ],
  }),
  component: TelegramPage,
});

function TelegramPage() {
  const logs = useTelegramLogs();
  const tz = useSettings().data?.display_timezone ?? "UTC";
  const [busy, setBusy] = useState<string | null>(null);
  const retry = async (id: string) => {
    setBusy(id);
    const r = await retryTelegram({ data: { id } });
    setBusy(null);
    if (r.ok) toast.success("Delivered");
    else toast.error("error" in r ? r.error : "Failed");
  };
  return (
    <div className="space-y-4">
      <h1 className="font-mono text-lg tracking-widest">TELEGRAM HISTORY</h1>
      <p className="text-sm text-muted-foreground">Only Breakeven activations send Telegram messages. Test messages are marked TEST.</p>
      {logs.isLoading && <div className="glass p-10 text-center text-muted-foreground">Loading…</div>}
      {!logs.isLoading && (logs.data ?? []).length === 0 && (
        <div className="glass p-10 text-center text-muted-foreground">No notifications yet.</div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(logs.data ?? []).map((l) => (
          <article key={l.id} className="glass flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {l.is_test ? <StatusBadge value="TEST" /> : <><span className="font-mono font-semibold">{l.symbol}</span>{l.direction && <StatusBadge value={l.direction} />}</>}
              <StatusBadge value={l.delivery_status} className="ml-auto" />
            </div>
            <pre className="whitespace-pre-wrap rounded bg-background/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground">{l.message}</pre>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>{fmtTime(l.created_at, tz)}</span>
              <span>MSG ID: <span className="font-mono">{l.telegram_message_id ?? "—"}</span></span>
              {l.retry_count > 0 && <span>Retries: {l.retry_count}</span>}
            </div>
            {l.error_message && <p className="rounded border border-short/30 bg-short/10 p-2 font-mono text-[11px] text-short">{l.error_message}</p>}
            {l.delivery_status === "FAILED" && (
              <Button size="sm" variant="outline" disabled={busy === l.id} onClick={() => retry(l.id)}>
                <RotateCw className="h-3.5 w-3.5" /> Retry delivery
              </Button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
