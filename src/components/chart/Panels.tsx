import { cn } from '@/lib/utils';
import { px } from '@/components/robot/ui';
import type { PineBar, PineSide } from '@/lib/chart/pine-series';
import type { BreakevenBreakdown } from '@/lib/chart/breakeven';

export type Check = { component: string; status: 'MATCH' | 'MISMATCH' | 'INFO' | 'N/A'; detail: string };
const TONE: Record<Check['status'], string> = { MATCH: 'border-long/50 text-long', MISMATCH: 'border-short/50 text-short', INFO: 'border-active/50 text-active', 'N/A': 'border-border text-muted-foreground' };
export const Badge = ({ s }: { s: Check['status'] | 'PASS' | 'FAIL' }) => (
  <span className={cn('inline-block shrink-0 border px-1.5 py-0.5 font-mono text-[10px] font-semibold', s === 'PASS' ? TONE.MATCH : s === 'FAIL' ? TONE.MISMATCH : TONE[s])}>{s}</span>
);

export function ComparisonList({ checks }: { checks: Check[] }) {
  return <ul className="divide-y divide-border">
    {checks.map((c) => <li key={c.component} className="flex items-start gap-2 py-2 text-xs">
      <Badge s={c.status} />
      <div className="min-w-0"><p className="font-medium">{c.component}</p><p className="break-words text-muted-foreground">{c.detail}</p></div>
    </li>)}
  </ul>;
}

const CHECK_LABEL: Record<keyof PineSide['checks'], string> = { history: 'Enough history', trend: 'Trend (close vs EMA200, EMA9 vs EMA21)', rsi: 'RSI side of 50',
  macd: 'MACD histogram side of 0', volatility: 'ATR % within 0.02–1.20', score: 'Score ≥ 70', stop: 'Stop distance 0.4–3.0 ATR' };
export function PineConditions({ bar }: { bar: PineBar | undefined }) {
  if (!bar) return <p className="text-xs text-muted-foreground">No closed candle yet.</p>;
  const side = (name: 'LONG' | 'SHORT', s: PineSide) => (
    <div className="min-w-0">
      <p className={cn('mb-1 font-mono text-[11px] font-semibold', name === 'LONG' ? 'text-long' : 'text-short')}>{name} · score {s.score} · {s.setup ? 'SETUP' : 'no setup'}{s.entry ? ' · SIGNAL' : ''}</p>
      <ul className="space-y-1">{(Object.keys(CHECK_LABEL) as (keyof PineSide['checks'])[]).map((k) => (
        <li key={k} className="flex items-center gap-2 text-[11px]"><Badge s={s.checks[k] ? 'PASS' : 'FAIL'} /><span className="text-muted-foreground">{CHECK_LABEL[k]}</span></li>))}</ul>
      {s.setup && !s.entry && <p className="mt-1 text-[11px] text-waiting">Setup passed but no new entry: a {name} trade is already open or the 5-bar cooldown is running.</p>}
    </div>);
  return <div className="space-y-3">
    <p className="font-mono text-[11px] text-muted-foreground">{new Date(bar.time).toISOString().slice(0, 16).replace('T', ' ')} UTC · close {px(bar.close)} · EMA9 {px(bar.ema9)} · EMA21 {px(bar.ema21)} · EMA200 {px(bar.ema200)} · RSI {bar.rsi?.toFixed(2) ?? '—'} · MACD {px(bar.macd)} / {px(bar.macdSignal)} · hist {px(bar.histogram)} · ATR {px(bar.atr)}</p>
    <div className="grid gap-4 sm:grid-cols-2">{side('LONG', bar.long)}{side('SHORT', bar.short)}</div>
  </div>;
}

export function BreakevenTable({ rows }: { rows: BreakevenBreakdown[] }) {
  const line = (label: string, f: (b: BreakevenBreakdown) => string) => (
    <tr className="border-t border-border"><th className="py-1.5 pr-2 text-left align-top font-normal text-muted-foreground">{label}</th>
      {rows.map((b, i) => <td key={i} className="py-1.5 pr-2 align-top font-mono">{f(b)}</td>)}</tr>);
  return <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[11px]">
    <thead><tr><th />{rows.map((b, i) => <th key={i} className="pb-1 text-left font-semibold">{b.source === 'PINE' ? 'Pine indicator rule' : 'Paper Robot rule (actual)'}</th>)}</tr></thead>
    <tbody>
      {line('1. Activation condition', (b) => b.activation)}
      {line('2. Trigger price', (b) => px(b.trigger))}
      {line('3. Break-even stop price', (b) => px(b.stop))}
      {line('4. Fee-adjusted (net zero)', (b) => px(b.feeAdjusted))}
      {line('5. Exchange-adjusted stop (tick)', (b) => px(b.exchangeStop))}
    </tbody>
  </table>
  <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">{rows.flatMap((b) => b.notes).map((n, i) => <li key={i}>{n}</li>)}</ul></div>;
}
