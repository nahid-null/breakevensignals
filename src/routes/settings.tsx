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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Settings } from '@/lib/data';

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Crypto Signal Terminal" },
      { name: "description", content: "Separate LONG and SHORT Telegram notification controls and display preferences." },
      { property: "og:title", content: "Settings — Crypto Signal Terminal" },
      { property: "og:description", content: "Telegram Simulator trade results for LONG and SHORT, and display preferences." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: SettingsPage,
});

const TIMEZONES = ["UTC", "Asia/Dhaka", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];

function SettingsPage() {
  const settings = useSettings();
  const s = settings.data;
  const st = useStatuses();
  const qc = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  type NotificationKey = 'telegram_enabled' | 'long_notifications_enabled' | 'short_notifications_enabled' | 'long_entry_enabled' | 'short_entry_enabled' | 'long_breakeven_enabled' | 'short_breakeven_enabled' | 'long_stop_loss_enabled' | 'short_stop_loss_enabled' | 'long_take_profit_enabled' | 'short_take_profit_enabled';
  type Patch = Partial<Pick<Settings, NotificationKey | 'display_timezone' | 'default_fee_rate_percent'>>;
  const save = async (patch: Patch) => {
    setSaving(true);
    try {
      await updateSettings({ data: patch });
      await qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      const r = await sendTestTelegram();
      await qc.invalidateQueries({ queryKey: ['telegram_logs'] });
      if (r.ok) toast.success("Test message delivered to Telegram");
      else toast.error("error" in r ? String(r.error) : "Failed");
    } catch { toast.error('Telegram test failed'); }
    finally { setTesting(false); }
  };
  if (settings.isError) return <p className="text-short">Could not load settings.</p>;
  if (!s) return <div className="p-10 text-center text-muted-foreground">Loading settings…</div>;
  const toggle = (label: string, key: NotificationKey) => (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <div className="text-sm">{label}</div>
      <Switch aria-label={label} checked={s[key]} disabled={saving} onCheckedChange={(v) => save({ [key]: v })} />
    </div>
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="border-y border-border py-3">{toggle('Telegram notifications', 'telegram_enabled')}</section>
      <div className="grid gap-4 lg:grid-cols-2">
        {(['long', 'short'] as const).map((side) => <section key={side} className="border-b border-border py-4 lg:pr-8">
          <h2 className={`mb-2 font-mono text-sm ${side === 'long' ? 'text-long' : 'text-short'}`}>{side.toUpperCase()} NOTIFICATIONS</h2>
          {toggle(`${side.toUpperCase()} notifications`, `${side}_notifications_enabled`)}
          <p className="mt-2 text-xs text-muted-foreground">Sends only Simulator trade results: Take profit hit or Stop loss hit.</p>
        </section>)}
        <section className="space-y-4 py-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Display</h2>
          <label className="block text-sm">
            Timezone
            <Select value={s.display_timezone} onValueChange={(v) => save({ display_timezone: v })} disabled={saving}><SelectTrigger className="mt-2" aria-label="Timezone"><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
          </label>
          <label className="block text-sm">
            Default fee rate % (display only)
            <Input type="number" step="0.01" min={0} defaultValue={s.default_fee_rate_percent} className="mt-1 font-mono"
              onBlur={(e) => save({ default_fee_rate_percent: Number(e.target.value) })} />
          </label>
        </section>
        <section className="space-y-3 py-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Telegram connection</h2>
          <div className="flex flex-wrap items-center gap-3"><Button onClick={test} disabled={testing}><Send className="h-4 w-4" /> Send test notification</Button><StatusBadge value={st.telegram} /></div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">Private engine credential <StatusBadge value={st.health?.engineConfigured ? 'CONNECTED' : 'NOT CONFIGURED'} /></div>
        </section>
      </div>
    </div>
  );
}
