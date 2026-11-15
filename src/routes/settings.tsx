import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings, useStatuses } from "@/lib/data";
import { sendTestTelegram, updateSettings } from "@/lib/ops.functions";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { WEBHOOK_URL_LIVE, WEBHOOK_URL_PREVIEW } from "@/lib/urls";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Crypto Signal Terminal" },
      { name: "description", content: "Telegram breakeven notification switches, timezone and webhook details." },
      { property: "og:title", content: "Settings — Crypto Signal Terminal" },
      { property: "og:description", content: "Notification switches and webhook details." },
    ],
  }),
  component: SettingsPage,
});

const TIMEZONES = ["UTC", "Asia/Dhaka", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];

function SettingsPage() {
  const { data: s } = useSettings();
  const st = useStatuses();
  const qc = useQueryClient();
  const [testing, setTesting] = useState(false);
  type Patch = Partial<{ telegram_enabled: boolean; long_breakeven_enabled: boolean; short_breakeven_enabled: boolean; display_timezone: string; default_fee_rate_percent: number }>;
  const save = async (patch: Patch) => {
    try {
      await updateSettings({ data: patch });
      await qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };
  const test = async () => {
    setTesting(true);
    const r = await sendTestTelegram();
    setTesting(false);
    if (r.ok) toast.success("Test message delivered to Telegram");
    else toast.error("error" in r ? String(r.error) : "Failed");
  };
  if (!s) return <div className="glass p-10 text-center text-muted-foreground">Loading settings…</div>;
  const toggle = (label: string, desc: string, key: "telegram_enabled" | "long_breakeven_enabled" | "short_breakeven_enabled") => (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <div><div className="text-sm">{label}</div><div className="text-xs text-muted-foreground">{desc}</div></div>
      <Switch checked={s[key]} onCheckedChange={(v) => save({ [key]: v })} />
    </div>
  );
  return (
    <div className="space-y-4">
      <h1 className="font-mono text-lg tracking-widest">SETTINGS</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Telegram breakeven notifications</h2>
          {toggle("Telegram notifications", "Master switch. Events are still stored when off.", "telegram_enabled")}
          {toggle("LONG breakeven", "PRO LONG SCALPER breakeven activations", "long_breakeven_enabled")}
          {toggle("SHORT breakeven", "PRO SHORT SCALPER breakeven activations", "short_breakeven_enabled")}
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={test} disabled={testing}><Send className="h-4 w-4" /> Send test notification</Button>
            <StatusBadge value={st.telegram} />
          </div>
        </section>
        <section className="glass space-y-4 p-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Display</h2>
          <label className="block text-sm">
            Timezone
            <select className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono text-sm" value={s.display_timezone} onChange={(e) => save({ display_timezone: e.target.value })}>
              {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            Default fee rate % (display only)
            <Input type="number" step="0.01" min={0} defaultValue={s.default_fee_rate_percent} className="mt-1 font-mono"
              onBlur={(e) => save({ default_fee_rate_percent: Number(e.target.value) })} />
          </label>
          <p className="text-xs text-muted-foreground">These settings never change your indicator calculations or create signals.</p>
        </section>
        <section className="glass space-y-3 p-4 lg:col-span-2">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Webhook endpoint</h2>
          <div className="flex items-center gap-2 text-sm">Status <StatusBadge value={st.webhook} /></div>
          <div className="text-xs text-muted-foreground">After publishing (use this in TradingView):</div>
          <code className="block break-all rounded bg-background/60 p-2 font-mono text-xs">{WEBHOOK_URL_LIVE}</code>
          <div className="text-xs text-muted-foreground">Preview build (for testing before publishing):</div>
          <code className="block break-all rounded bg-background/60 p-2 font-mono text-xs">{WEBHOOK_URL_PREVIEW}</code>
          <p className="text-xs text-muted-foreground">Replace YOUR_WEBHOOK_SECRET with the webhook key you saved. Never share it. See the Setup Guide for a test command.</p>
        </section>
      </div>
    </div>
  );
}
