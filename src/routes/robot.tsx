import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, OctagonX, Play, Plus } from 'lucide-react';
import { fmtTime } from '@/lib/data';
import { dailyPnl, robotStats, robotStatus, useRobotAccount, useRobotMarkets, useRobotPositions, useRobotScanner, useRobotSettings, useRobotSignals } from '@/lib/robot/data';
import { ScannerPanel } from '@/components/robot/ScannerPanel';
import { EntryAuditReport } from '@/components/robot/EntryAuditReport';
import { robotDeposit, robotResume, robotStopAll } from '@/lib/robot/robot.functions';
import { DEFAULT_PAPER_BALANCE, PAPER_LEVERAGE, ROBOT_SYMBOLS, TARGET_NET_ROI_PCT } from '@/lib/robot/config';
import { StatusBadge } from '@/components/terminal/StatusBadge';
import { EXIT, MetricsTable, SETUP, Tile, pct, px, signed, tone, usd } from '@/components/robot/ui';
import { RobotSettingsForm } from '@/components/robot/RobotSettingsForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const TITLE = 'Paper Robot — Crypto Signal Terminal';
const DESC = 'Independent Binance futures paper robot with confirmed liquidity sweeps, fixed 50x leverage, 10% net margin ROI targets, entry audit and preserved trade history.';
export const Route = createFileRoute('/robot')({
  head: () => ({ meta: [
    { title: TITLE }, { name: 'description', content: DESC }, { property: 'og:title', content: TITLE }, { property: 'og:description', content: DESC },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: RobotPage,
});

function RobotPage() {
  const qc = useQueryClient();
  const account = useRobotAccount(); const settings = useRobotSettings(); const positions = useRobotPositions();
  const markets = useRobotMarkets(); const signals = useRobotSignals(); const scanner = useRobotScanner();
  const [amount, setAmount] = useState(''); const [busy, setBusy] = useState(false);
  const list = positions.data ?? [];
  const open = list.filter((p) => p.status === 'OPEN'); const closed = list.filter((p) => p.status === 'CLOSED');
  const balance = Number(account.data?.balance ?? 0);
  const unrealized = open.reduce((a, p) => a + Number(p.unrealized_pnl), 0);
  const margin = open.reduce((a, p) => a + Number(p.margin), 0);
  const stats = robotStats(list, Number(account.data?.start_balance ?? DEFAULT_PAPER_BALANCE));
  const days = dailyPnl(list);
  const today = days.find((d) => d.date === new Date().toISOString().slice(0, 10))?.pnl ?? 0;
  const status = robotStatus(markets.data ?? [], settings.data);
  const live = (markets.data ?? []).filter((m) => m.status === 'LIVE' && Date.now() - Date.parse(m.updated_at) < 90_000).length;
  const refresh = () => Promise.all(['robot_account', 'robot_positions', 'robot_settings'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); await refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  }
  async function deposit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { toast.error('Enter an amount above 0'); return; }
    await run(() => robotDeposit({ data: { amount: n } }), `${usd(n)} added to the robot balance`); setAmount('');
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-active"><Bot className="size-3" /> PAPER TRADING · SIMULATED FILLS · NO REAL ORDERS</div>
          <h1 className="text-2xl font-semibold">Paper robot</h1>
          <p className="mt-1 text-sm text-muted-foreground">Runs alongside your existing signals and Simulator with its own balance. {live}/{ROBOT_SYMBOLS.length} coins live.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge value={status} />
          {settings.data?.emergency_stop || !settings.data?.enabled ? (
            <Button variant="outline" disabled={busy || !settings.data} onClick={() => void run(() => robotResume(), 'Robot resumed — new entries allowed')}><Play className="size-4" /> Resume</Button>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive" disabled={busy}><OctagonX className="size-4" /> STOP ALL</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close every paper position now?</AlertDialogTitle>
                <AlertDialogDescription>All {open.length} open paper positions close at the last saved price, with fees and slippage. New entries stay blocked until you press Resume.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void run(() => robotStopAll(), 'Emergency stop: all paper positions closed')}>Stop all</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Main balance" value={usd(balance)} hint={`Start ${usd(account.data?.start_balance ?? DEFAULT_PAPER_BALANCE)} · added ${usd(Number(account.data?.total_deposited ?? DEFAULT_PAPER_BALANCE) - Number(account.data?.start_balance ?? DEFAULT_PAPER_BALANCE))}`} />
        <Tile label="Equity" value={usd(balance + unrealized)} hint="Balance + open P&L" />
        <Tile label="Margin in use" value={usd(margin)} hint={`${pct(balance > 0 ? (margin / balance) * 100 : 0)} of balance · cap ${pct(Number(settings.data?.max_allocation_pct ?? 70), 0)}`} />
        <Tile label="Open P&L" value={signed(unrealized)} tone={tone(unrealized)} />
        <Tile label="Today's P&L" value={signed(today)} tone={tone(today)} />
        <Tile label="Total P&L" value={signed(stats.all.netPnl)} tone={tone(stats.all.netPnl)} hint={`${stats.all.trades} closed · win ${pct(stats.all.winRate)}`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_2fr] [&>*]:min-w-0">
        <div className="space-y-3 border border-border bg-card/40 p-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Add paper balance</h2>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void deposit(); }}>
            <Input type="number" inputMode="decimal" min="1" step="0.01" placeholder="Amount in USDT" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" aria-label="Amount in USDT" />
            <Button type="submit" disabled={busy}><Plus className="size-4" /> Add</Button>
          </form>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Every paper position uses exactly {PAPER_LEVERAGE}x leverage.</li>
            <li>• Take profit closes the whole position at {TARGET_NET_ROI_PCT}% net ROI on its margin, after fees and funding.</li>
            <li>• Combined margin never above {pct(Number(settings.data?.max_allocation_pct ?? 70), 0)} of the balance, split across up to {settings.data?.max_concurrent ?? 5} positions; the rest stays in reserve.</li>
            <li>• Score {settings.data?.min_score ?? 75}+ to trade; {settings.data?.high_score ?? 85}+ counts as high quality and gets a full margin slot.</li>
            <li>• Every stop is set from market structure before entry and is never widened.</li>
            <li>• No daily loss limit, loss-streak pause or daily trade cap; when a trade closes the best waiting setup can take its slot.</li>
            <li>• Telegram receipts are marked PAPER ROBOT.</li>
          </ul>
          <p className="text-[11px] text-muted-foreground">See the <Link to="/robot-backtest" className="text-primary underline">backtest</Link> and the <Link to="/robot-coins" className="text-primary underline">40-coin monitor</Link>.</p>
        </div>
        <div className="border border-border bg-card/40">
          <h2 className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">Open positions ({open.length}/{settings.data?.max_concurrent ?? 5})</h2>
          {open.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{balance > 0 ? 'No open position. Waiting for a qualified setup.' : 'Add a balance to start.'}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">
                  {['Coin', 'Side', 'Setup', 'Score', 'Lev', 'Margin', 'Entry', 'Price', 'Stop', `TP (${TARGET_NET_ROI_PCT}% net)`, 'Liq.', 'Net ROI', 'P&L'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
                </tr></thead>
                <tbody>{open.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 font-mono">
                    <td className="px-3 py-2">{p.symbol}</td><td className="px-3 py-2"><StatusBadge value={p.direction} /></td>
                    <td className="px-3 py-2 font-sans">{SETUP[p.setup] ?? p.setup}</td><td className="px-3 py-2">{p.score}</td>
                    <td className="px-3 py-2">{p.leverage}x</td><td className="px-3 py-2">{usd(p.margin)}{p.fill_status === 'PARTIAL' ? <span className="block text-[10px] text-waiting">partial fill</span> : null}</td>
                    <td className="px-3 py-2">{px(p.entry_price)}</td><td className="px-3 py-2">{px(p.last_price)}</td>
                    <td className={cn('px-3 py-2', Number(p.stop_loss) !== Number(p.initial_stop) ? 'text-breakeven' : 'text-short')}>{px(p.stop_loss)}{Number(p.stop_loss) !== Number(p.initial_stop) ? ' lock' : ''}</td>
                    <td className="px-3 py-2 text-long">{px(p.tp1)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{px(p.liquidation_price)}</td>
                    <td className={cn('px-3 py-2', tone(Number(p.net_roi_pct ?? 0)))}>{p.net_roi_pct === null ? '—' : pct(Number(p.net_roi_pct), 1)}</td>
                    <td className={cn('px-3 py-2', tone(Number(p.unrealized_pnl) + Number(p.realized_pnl)))}>{signed(Number(p.unrealized_pnl) + Number(p.realized_pnl))}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <ScannerPanel s={scanner.data} />
      <EntryAuditReport />

      <section className="border border-border bg-card/40">
        <h2 className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">Performance (paper)</h2>
        <MetricsTable rows={[{ label: 'All', m: stats.all }, { label: 'Long', m: stats.long }, { label: 'Short', m: stats.short }]} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_2fr] [&>*]:min-w-0">
        <div className="border border-border bg-card/40">
          <h2 className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">Daily P&L</h2>
          {days.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No closed trades yet.</p> : (
            <ul className="max-h-80 divide-y divide-border/50 overflow-y-auto font-mono text-xs">
              {days.map((d) => <li key={d.date} className="flex justify-between px-4 py-2"><span>{d.date} <span className="text-muted-foreground">· {d.trades}</span></span><span className={tone(d.pnl)}>{signed(d.pnl)}</span></li>)}
            </ul>
          )}
        </div>
        <div className="border border-border bg-card/40">
          <h2 className="border-b border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground">Latest setups and decisions</h2>
          <div className="max-h-80 overflow-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">
                {['Time', 'Coin', 'Side', 'Setup', 'Score', 'Decision', 'Reason'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {(signals.data ?? []).length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No setups logged yet.</td></tr>}
                {(signals.data ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-border/50 font-mono">
                    <td className="px-3 py-2">{fmtTime(s.candle_time)}</td><td className="px-3 py-2">{s.symbol}</td><td className="px-3 py-2"><StatusBadge value={s.direction} /></td>
                    <td className="px-3 py-2 font-sans">{SETUP[s.setup] ?? s.setup}</td><td className="px-3 py-2">{s.score}</td>
                    <td className="px-3 py-2"><StatusBadge value={s.decision} /></td><td className="px-3 py-2 font-sans text-muted-foreground">{s.reason ?? '—'}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="overflow-hidden border-y border-border">
        <h2 className="border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Trade history</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">
              {['Opened', 'Coin', 'Side', 'Setup', 'Score', 'Lev', 'Entry', 'Exit', 'Result', 'Fees', 'Funding', 'Net ROI', 'Net P&L', 'Closed'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
            </tr></thead>
            <tbody>
              {closed.length === 0 && <tr><td colSpan={14} className="px-3 py-8 text-center text-muted-foreground">No finished paper trades yet.</td></tr>}
              {closed.map((p) => (
                <tr key={p.id} className="border-b border-border/50 font-mono">
                  <td className="px-3 py-2">{fmtTime(p.opened_at)}</td><td className="px-3 py-2">{p.symbol}</td><td className="px-3 py-2"><StatusBadge value={p.direction} /></td>
                  <td className="px-3 py-2 font-sans">{SETUP[p.setup] ?? p.setup}</td><td className="px-3 py-2">{p.score}</td><td className="px-3 py-2">{p.leverage}x</td>
                  <td className="px-3 py-2">{px(p.entry_price)}</td><td className="px-3 py-2">{px(p.exit_price)}</td>
                  <td className="px-3 py-2 font-sans">{EXIT[p.exit_reason ?? ''] ?? p.exit_reason}</td><td className="px-3 py-2">{usd(p.fees)}</td>
                  <td className="px-3 py-2">{signed(Number(p.funding ?? 0))}</td>
                  <td className={cn('px-3 py-2', tone(Number(p.net_roi_pct ?? 0)))}>{p.net_roi_pct === null ? '—' : pct(Number(p.net_roi_pct), 1)}</td>
                  <td className={cn('px-3 py-2', tone(Number(p.realized_pnl)))}>{signed(Number(p.realized_pnl))}</td><td className="px-3 py-2">{fmtTime(p.closed_at)}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </section>

      {settings.data && <RobotSettingsForm settings={settings.data} />}
    </div>
  );
}
