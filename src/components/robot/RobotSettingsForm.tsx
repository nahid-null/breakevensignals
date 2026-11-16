import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RobotSettingsRow } from '@/lib/robot/data';
import type { z } from 'zod';
import { robotSaveSettings, robotSettingsSchema } from '@/lib/robot/robot.functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ROBOT_SYMBOLS } from '@/lib/robot/config';

const FIELDS: { key: Exclude<keyof z.infer<typeof robotSettingsSchema>, 'enabled' | 'symbols'>; label: string; unit: string; step: string }[] = [
  { key: 'min_score', label: 'Minimum score to trade', unit: '/100', step: '1' },
  { key: 'high_score', label: 'High-quality score', unit: '/100', step: '1' },
  { key: 'max_concurrent', label: 'Max open positions', unit: '(max 10)', step: '1' },
  { key: 'max_same_direction', label: 'Max in one direction', unit: '', step: '1' },
  { key: 'max_allocation_pct', label: 'Max total margin', unit: '% of balance (max 70)', step: '1' },
  { key: 'max_hold_minutes', label: 'Max holding time', unit: 'minutes', step: '10' },
  { key: 'fee_pct', label: 'Taker fee', unit: '%', step: '0.01' },
  { key: 'maker_fee_pct', label: 'Maker fee (take-profit fill)', unit: '%', step: '0.01' },
  { key: 'slippage_bps', label: 'Extra slippage per market fill', unit: 'bps', step: '0.5' },
  { key: 'max_spread_bps', label: 'Max spread', unit: 'bps', step: '0.5' },
  { key: 'min_quote_volume_musd', label: 'Min 24h volume', unit: 'million USDT', step: '1' },
  { key: 'entry_max_age_ms', label: 'Maximum signal age', unit: 'ms after candle close', step: '1000' },
  { key: 'quote_max_age_ms', label: 'Maximum order-book age', unit: 'ms', step: '500' },
  { key: 'max_entry_drift_atr', label: 'Maximum fill drift', unit: '× 5m ATR', step: '0.05' },
  { key: 'min_sweep_atr', label: 'Minimum sweep depth', unit: '× ATR (also ≥2 ticks)', step: '0.05' },
  { key: 'max_sweep_atr', label: 'Maximum sweep depth', unit: '× ATR', step: '0.1' },
  { key: 'min_rejection_wick', label: 'Sweep rejection wick', unit: 'fraction of range', step: '0.05' },
  { key: 'min_volume_ratio', label: 'Minimum confirmation volume', unit: '× prior 20-bar mean', step: '0.1' },
  { key: 'min_reward_risk', label: 'Minimum net reward / total stop risk', unit: 'including costs', step: '0.05' },
  { key: 'max_candle_atr', label: 'Maximum confirmation candle range', unit: '× ATR', step: '0.1' },
  { key: 'sweep_max_age_minutes', label: 'Maximum sweep age', unit: 'minutes', step: '1' },
];

export function RobotSettingsForm({ settings }: { settings: RobotSettingsRow }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])) as Record<string, string>);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [busy, setBusy] = useState(false);
  const [symbols, setSymbols] = useState((settings.symbols ?? [...ROBOT_SYMBOLS]).join(', '));
  async function save() {
    const parsed = robotSettingsSchema.safeParse({ enabled, symbols: symbols.toUpperCase().split(/[\s,]+/).filter(Boolean), ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(draft[f.key])])) });
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
        <label className="space-y-1 text-xs sm:col-span-2 lg:col-span-3"><span className="text-muted-foreground">40 Binance USDT-M symbols · coin-list changes take effect on scanner restart; open positions stay protected</span><Textarea aria-label="40 Binance USDT-M symbols" className="min-h-24 font-mono" value={symbols} onChange={(e) => setSymbols(e.target.value)} /></label>
        <div className="flex items-end sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={busy}>Save settings</Button></div>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">Leverage is fixed at 50x on every paper trade. Take profit is fixed at 10% net ROI on margin after fees. There is no daily loss limit, loss-streak pause or daily trade cap in paper mode.</p>
      {settings.emergency_stop && <p className="mt-3 text-xs text-short">Emergency stop is active. Press Resume at the top to allow new entries again.</p>}
    </section>
  );
}
