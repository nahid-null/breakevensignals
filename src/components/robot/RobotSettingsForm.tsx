import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RobotSettingsRow } from '@/lib/robot/data';
import { robotSaveSettings, robotSettingsSchema } from '@/lib/robot/robot.functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

const FIELDS: { key: Exclude<keyof RobotSettingsRow, 'id' | 'updated_at' | 'enabled' | 'emergency_stop'>; label: string; unit: string; step: string }[] = [
  { key: 'min_score', label: 'Minimum score to trade', unit: '/100', step: '1' },
  { key: 'high_score', label: 'High-quality score', unit: '/100', step: '1' },
  { key: 'risk_per_trade_pct', label: 'Risk per trade', unit: '% of balance (max 2)', step: '0.05' },
  { key: 'max_concurrent', label: 'Max open positions', unit: '(max 5)', step: '1' },
  { key: 'max_same_direction', label: 'Max in one direction', unit: '', step: '1' },
  { key: 'max_allocation_pct', label: 'Max total margin', unit: '% of balance (max 70)', step: '1' },
  { key: 'max_leverage', label: 'Leverage ceiling', unit: 'x (max 50)', step: '1' },
  { key: 'daily_loss_limit_pct', label: 'Daily loss limit', unit: '% of balance', step: '0.5' },
  { key: 'loss_streak_cooldown', label: 'Pause after losses in a row', unit: 'trades', step: '1' },
  { key: 'cooldown_minutes', label: 'Pause length', unit: 'minutes', step: '5' },
  { key: 'max_hold_minutes', label: 'Max holding time', unit: 'minutes', step: '10' },
  { key: 'fee_pct', label: 'Fee per side', unit: '%', step: '0.01' },
  { key: 'slippage_bps', label: 'Slippage per market fill', unit: 'bps', step: '0.5' },
  { key: 'max_spread_bps', label: 'Max spread', unit: 'bps', step: '0.5' },
  { key: 'min_quote_volume_musd', label: 'Min 24h volume', unit: 'million USDT', step: '1' },
];

export function RobotSettingsForm({ settings }: { settings: RobotSettingsRow }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])) as Record<string, string>);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [busy, setBusy] = useState(false);
  async function save() {
    const parsed = robotSettingsSchema.safeParse({ enabled, ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(draft[f.key])])) });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Check the values'); return; }
    setBusy(true);
    try { await robotSaveSettings({ data: parsed.data }); toast.success('Robot settings saved'); await qc.invalidateQueries({ queryKey: ['robot_settings'] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }
  return (
    <section className="border border-border bg-card/40 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Robot settings</h2>
        <label className="flex items-center gap-3 text-sm">
          <span className={enabled ? 'text-long' : 'text-waiting'}>{enabled ? 'New entries allowed' : 'New entries paused'}</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Allow new robot entries" disabled={settings.emergency_stop} />
        </label>
      </div>
      <form className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {FIELDS.map((f) => (
          <label key={f.key} className="space-y-1 text-xs">
            <span className="text-muted-foreground">{f.label} <span className="opacity-60">{f.unit}</span></span>
            <Input type="number" step={f.step} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} className="font-mono" />
          </label>
        ))}
        <div className="flex items-end sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={busy}>Save settings</Button></div>
      </form>
      {settings.emergency_stop && <p className="mt-3 text-xs text-short">Emergency stop is active. Press Resume at the top to allow new entries again.</p>}
    </section>
  );
}
