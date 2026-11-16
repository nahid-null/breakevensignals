import { createFileRoute } from '@tanstack/react-router';
import { fmtTime } from '@/lib/data';
import { useRobotMarkets } from '@/lib/robot/data';
import { StatusBadge } from '@/components/terminal/StatusBadge';
import { px } from '@/components/robot/ui';
import { cn } from '@/lib/utils';

const TITLE = 'Robot Coin Monitor — Crypto Signal Terminal';
const DESC = 'Live spread, trend, liquidity pools and separate LONG and SHORT setup scores with reasons for each of the 40 coins the paper robot scans.';
export const Route = createFileRoute('/robot-coins')({
  head: () => ({ meta: [
    { title: TITLE }, { name: 'description', content: DESC }, { property: 'og:title', content: TITLE }, { property: 'og:description', content: DESC },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: RobotCoins,
});

const trend = (t: number | null) => t === 1 ? 'BULLISH' : t === -1 ? 'BEARISH' : t === 0 ? 'SIDEWAYS' : '—';

function RobotCoins() {
  const markets = useRobotMarkets();
  const rows = markets.data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 font-mono text-[10px] text-active">PAPER ROBOT · 40 COINS</div>
        <h1 className="text-2xl font-semibold">Robot coin monitor</h1>
        <p className="mt-1 text-sm text-muted-foreground">Saved by the worker every few seconds. Each side shows its current setup score and why it is or isn't tradeable. A row older than 90 seconds is shown as stale.</p>
      </div>
      <div className="overflow-x-auto border-y border-border">
        <table className="w-full min-w-[1150px] text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">
            {['Coin', 'Status', 'Price', 'Spread', 'Book tilt', '24h volume', '1H trend', '15M trend', 'Nearest liquidity', 'LONG', 'SHORT', 'Saved'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">The robot has not reported yet. It starts with the worker after the next redeploy.</td></tr>}
            {rows.map((m) => {
              const stale = Date.now() - Date.parse(m.updated_at) > 90_000;
              return (
                <tr key={m.symbol} className={cn('border-b border-border/50 font-mono', stale && 'opacity-60')}>
                  <td className="px-3 py-2">{m.symbol}</td>
                  <td className="px-3 py-2"><StatusBadge value={stale && m.status !== 'UNAVAILABLE' ? 'stale' : m.status} /></td>
                  <td className="px-3 py-2">{px(m.price)}</td>
                  <td className="px-3 py-2">{m.spread_bps === null ? '—' : `${Number(m.spread_bps).toFixed(2)} bps`}</td>
                  <td className={cn('px-3 py-2', Number(m.imbalance) > 0.2 ? 'text-long' : Number(m.imbalance) < -0.2 ? 'text-short' : '')}>{m.imbalance === null ? '—' : Number(m.imbalance).toFixed(2)}</td>
                  <td className="px-3 py-2">{m.quote_volume_24h === null ? '—' : `${(Number(m.quote_volume_24h) / 1e6).toFixed(0)}M`}</td>
                  <td className="px-3 py-2"><StatusBadge value={trend(m.trend_1h)} /></td>
                  <td className="px-3 py-2"><StatusBadge value={trend(m.trend_15m)} /></td>
                  <td className="px-3 py-2 font-sans text-muted-foreground">{m.liquidity ?? '—'}</td>
                  <td className="max-w-56 px-3 py-2 font-sans"><span className="font-mono text-long">{m.score_long ?? '—'}</span> <span className="text-muted-foreground">{m.note_long ?? (m.status === 'UNAVAILABLE' ? m.note : '—')}</span></td>
                  <td className="max-w-56 px-3 py-2 font-sans"><span className="font-mono text-short">{m.score_short ?? '—'}</span> <span className="text-muted-foreground">{m.note_short ?? '—'}</span></td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtTime(m.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
