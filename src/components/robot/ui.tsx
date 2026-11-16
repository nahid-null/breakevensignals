import { cn } from '@/lib/utils';
import type { Metrics } from '@/lib/robot/metrics';

export const tone = (n: number | null | undefined) => (Number(n) > 0 ? 'text-long' : Number(n) < 0 ? 'text-short' : 'text-muted-foreground');
export const usd = (n: number | null | undefined) => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—'
  : `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
export const signed = (n: number | null | undefined) => n === null || n === undefined ? '—' : `${Number(n) > 0 ? '+' : ''}${usd(n)}`;
export const pct = (n: number | null | undefined, d = 1) => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(d)}%`;
export const px = (n: number | null | undefined) => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(Number(n).toPrecision(7)).toString();

export const EXIT: Record<string, string> = { TAKE_PROFIT: 'Take profit', STOP_LOSS: 'Stop loss', BREAKEVEN_STOP: 'Breakeven stop', EARLY_EXIT: 'Early exit',
  PROFIT_EXIT: 'Profit protection', TIME_EXIT: 'Time exit', LIQUIDATION: 'Liquidation', EMERGENCY_STOP: 'Emergency stop' };
export const SETUP: Record<string, string> = { SWEEP_RECLAIM: 'Sweep + reclaim', PULLBACK_RECLAIM: 'Pullback reclaim' };

export function Tile({ label, value, tone: t, hint }: { label: string; value: string; tone?: string | undefined; hint?: string | undefined }) {
  return (
    <div className="border border-border bg-card/40 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-mono text-xl font-semibold tabular-nums', t)}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function MetricsTable({ rows }: { rows: { label: string; m: Metrics | Partial<Metrics> }[] }) {
  const cols: [string, (m: Partial<Metrics>) => string, ((m: Partial<Metrics>) => string)?][] = [
    ['Trades', (m) => String(m.trades ?? 0)],
    ['Win rate', (m) => pct(m.winRate)],
    ['Net P&L', (m) => signed(m.netPnl), (m) => tone(m.netPnl)],
    ['Profit factor', (m) => m.profitFactor === null ? '∞' : m.profitFactor === undefined ? '—' : m.profitFactor.toFixed(2)],
    ['Avg win', (m) => m.avgWin === undefined ? '—' : usd(m.avgWin)],
    ['Avg loss', (m) => m.avgLoss === undefined ? '—' : usd(m.avgLoss)],
    ['Expectancy', (m) => m.expectancyR === undefined ? '—' : `${m.expectancyR.toFixed(3)}R`, (m) => tone(m.expectancyR)],
    ['Max drawdown', (m) => pct(m.maxDrawdownPct, 2)],
    ['Stop-loss rate', (m) => pct(m.stopLossRate)],
    ['Liquidations', (m) => m.liquidations === undefined ? '—' : String(m.liquidations)],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr className="border-b border-border"><th className="px-3 py-2 text-left" />{cols.map(([h]) => <th key={h} className="px-3 py-2 text-right">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(({ label, m }) => (
            <tr key={label} className="border-b border-border/50 font-mono text-xs">
              <td className="px-3 py-2 text-left font-sans text-[11px] uppercase tracking-wider text-muted-foreground">{label}</td>
              {cols.map(([h, f, t]) => <td key={h} className={cn('px-3 py-2 text-right tabular-nums', t?.(m))}>{f(m)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
