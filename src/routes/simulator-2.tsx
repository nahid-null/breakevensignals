import { createFileRoute, Link, useHydrated } from '@tanstack/react-router';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Clock3, RotateCcw, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { simulator2Options } from '@/lib/simulator2';
import { enableSimulator2, resetSimulator2 } from '@/lib/simulator2.functions';
import { readSimControlAccess } from '@/lib/simulator.functions';
import { fmtUsd, fmtSignedUsd, simSummary, todayPnl } from '@/lib/simulator';
import { fmtTime, useMarkets, useSettings, useStatuses } from '@/lib/data';
import { StatusBadge } from '@/components/terminal/StatusBadge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/simulator-2')({
  head: () => ({ meta: [
    { title: 'Simulator 2 — Candle Breakout Practice | Crypto Signal Terminal' },
    { name: 'description', content: 'Independent one-minute LONG and SHORT candle-breakout practice account with fixed 50x, net balance targets and separate session history.' },
    { property: 'og:title', content: 'Simulator 2 — Candle Breakout Practice' },
    { property: 'og:description', content: 'Separate candle-only practice trading: 50x, one-minute exits and independent reset history.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(simulator2Options),
  component: Simulator2,
  pendingComponent: () => <div className="py-8 text-muted-foreground">Loading Simulator 2…</div>,
  errorComponent: ({ reset }) => <div className="space-y-4 py-8"><h1 className="text-2xl">Simulator 2 unavailable</h1><p className="text-muted-foreground">Could not load the practice account.</p><Button onClick={reset}>Try again</Button></div>,
});

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="min-w-0 border-l border-border pl-4 py-2"><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className={cn('mt-2 font-mono text-xl tabular-nums break-words', tone)}>{value}</div></div>;
}

const fmtPrice = (value: number) => Number(value).toLocaleString('en-US', { maximumSignificantDigits: 9 });

function CandleExample({ short = false }: { short?: boolean }) {
  return <svg role="img" aria-label={short ? 'Bearish previous-candle breakout' : 'Bullish previous-candle breakout'} viewBox="0 0 220 96" className={cn('h-24 w-full max-w-56', short ? 'text-short' : 'text-long')}>
    <path d="M12 68H207M12 28H207" className="stroke-border" fill="none" />
    <g transform={short ? 'translate(0 96) scale(1 -1)' : undefined} fill="currentColor" stroke="currentColor">
      <path d="M32 49V81M68 40V76M104 27V72M142 13V62M182 7V40" strokeWidth="2" />
      <rect x="26" y="61" width="12" height="12" /><rect x="62" y="52" width="12" height="15" />
      <rect x="98" y="45" width="12" height="19" /><rect x="134" y="20" width="16" height="35" />
      <rect x="176" y="15" width="12" height="18" />
      <path d="M80 27H155" strokeDasharray="4 4" fill="none" />
    </g>
  </svg>;
}

function Simulator2() {
  const hydrated = useHydrated();
  const { data, isRefetchError } = useSuspenseQuery(simulator2Options);
  const { account, trades } = data;
  const qc = useQueryClient();
  const reset = useServerFn(resetSimulator2); const enable = useServerFn(enableSimulator2);
  const access = useQuery({ queryKey: ['sim_control_access'], queryFn: () => readSimControlAccess() });
  const allowed = access.data?.allowed === true;
  const settings = useSettings(); const status = useStatuses(); const markets = useMarkets();
  const tz = settings.data?.display_timezone ?? 'UTC';
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const sum = simSummary(trades.map(t => ({ status: 'CLOSED', pnl: t.pnl })));
  const today = todayPnl(trades.map(t => ({ ...t, status: 'CLOSED' })), new Date(), tz);
  const tone = (value: number) => value > 0 ? 'text-long' : value < 0 ? 'text-short' : 'text-foreground';
  async function change(enabled?: boolean) {
    setBusy(true);
    try {
      if (enabled === undefined) { await reset(); toast.success('Simulator 2 reset to $5; current history cleared'); setConfirm(false); }
      else await enable({ data: { enabled } });
      await qc.invalidateQueries({ queryKey: ['simulator2'] });
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update Simulator 2'); }
    finally { setBusy(false); }
  }
  const activity = !hydrated ? 'Loading live status…' : !account.enabled ? 'Paused' : status.scanner !== 'RUNNING' ? 'Waiting for live candles'
    : account.pending_symbol ? `${account.pending_symbol} · ${account.pending_direction} · next candle` : 'Watching for a breakout';
  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Wallet className="size-3" /> PRACTICE MONEY · TRAINING 1</div><h1 className="text-2xl font-semibold">Simulator 2</h1><div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3" /> {activity}</div></div>
      <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-xs">{account.enabled ? 'Enabled' : 'Paused'}<Switch aria-label="Simulator 2 enabled" checked={account.enabled} disabled={!allowed || busy} onCheckedChange={v => void change(v)} /></label><Button variant="outline" disabled={!allowed || busy} onClick={() => setConfirm(true)}><RotateCcw /> Reset</Button></div>
    </div>
    {isRefetchError && <p role="alert" className="text-sm text-waiting">Refresh failed — last saved account values shown.</p>}
    <section className="grid grid-cols-2 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="Balance" value={fmtUsd(account.balance)} /><Metric label="Today's P&L" value={fmtSignedUsd(today)} tone={tone(today)} />
      <Metric label="Session P&L" value={fmtSignedUsd(sum.totalPnl)} tone={tone(sum.totalPnl)} /><Metric label="Trades" value={String(trades.length)} />
      <Metric label="Win rate" value={sum.winRate === null ? '—' : `${sum.winRate.toFixed(1)}%`} /><Metric label="Leverage" value="50x" />
    </section>
    <section aria-label="Open trade" className="border-y border-border py-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Open trade</h2>{account.pending_symbol && <span className="font-mono text-[10px] text-active">ACTIVE</span>}</div>
      {!account.pending_symbol || !account.pending_time ? <p className="mt-3 text-xs text-muted-foreground">No open trade. Waiting for the next strong breakout candle.</p> : (() => {
        const st = account.pending_time; const live = markets.data?.find(m => m.symbol === account.pending_symbol)?.price ?? null;
        return <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
          <div><dt className="text-[10px] text-muted-foreground">COIN</dt><dd className="mt-1 font-mono">{account.pending_symbol}</dd></div>
          <div><dt className="text-[10px] text-muted-foreground">SIDE</dt><dd className="mt-1">{account.pending_direction && <StatusBadge value={account.pending_direction} />}</dd></div>
          <div><dt className="text-[10px] text-muted-foreground">SIGNAL CANDLE</dt><dd className="mt-1 font-mono">{fmtTime(new Date(st).toISOString(), tz)}</dd></div>
          <div><dt className="text-[10px] text-muted-foreground">ENTRY → CLOSE</dt><dd className="mt-1 font-mono">{fmtTime(new Date(st + 60000).toISOString(), tz)} → {fmtTime(new Date(st + 120000).toISOString(), tz)}</dd></div>
          <div><dt className="text-[10px] text-muted-foreground">MARGIN · LEVERAGE</dt><dd className="mt-1 font-mono">{fmtUsd(account.balance * 0.8)} · 50x</dd></div>
          <div><dt className="text-[10px] text-muted-foreground">TAKE PROFIT</dt><dd className="mt-1 font-mono text-long">+{fmtUsd(account.balance * 0.10)}</dd></div>
          <div><dt className="text-[10px] text-muted-foreground">STOP LOSS</dt><dd className="mt-1 font-mono text-short">−{fmtUsd(account.balance * 0.05)}</dd></div>
          <div><dt className="text-[10px] text-muted-foreground">LAST SAVED PRICE</dt><dd className="mt-1 font-mono">{live === null ? '—' : fmtPrice(live)}</dd></div>
        </dl>;
      })()}
    </section>
    <section className="border-y border-border py-5">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="text-sm font-semibold">Previous-candle breakout</h2><span className="font-mono text-xs text-muted-foreground">1 MIN · LONG + SHORT</span></div>
      <div className="mt-4 grid gap-5 md:grid-cols-3">
        <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-long text-xs"><ArrowUpRight className="size-4" /> LONG</div><div className="mt-1 text-xs text-muted-foreground">Close above previous high</div></div><CandleExample /></div>
        <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-short text-xs"><ArrowDownRight className="size-4" /> SHORT</div><div className="mt-1 text-xs text-muted-foreground">Close below previous low</div></div><CandleExample short /></div>
        <dl className="grid grid-cols-2 gap-2 text-xs"><dt className="text-muted-foreground">Candle body</dt><dd>≥60% of range</dd><dt className="text-muted-foreground">Entry</dt><dd>Next candle open</dd><dt className="text-muted-foreground">Margin</dt><dd>80% of balance</dd><dt className="text-muted-foreground">Concurrent trades</dt><dd>1</dd></dl>
      </div>
      <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3"><div><span className="text-[10px] text-muted-foreground">NET BALANCE TARGET</span><div className="mt-1 font-mono text-long">+10% · {fmtUsd(account.balance * 0.10)}</div></div><div><span className="text-[10px] text-muted-foreground">MODELED BALANCE RISK</span><div className="mt-1 font-mono text-short">−5% · {fmtUsd(account.balance * 0.05)}</div></div><div><span className="text-[10px] text-muted-foreground">EXIT DEADLINE</span><div className="mt-1 font-mono text-sm">End of entry candle</div></div></div>
      <p className="mt-4 text-xs text-muted-foreground">0.05% fees per side + 1 tick per side. Closed-candle fills are modeled; gaps and liquidation can exceed the planned loss.</p>
    </section>
    {!allowed && access.isSuccess && <p className="text-xs text-waiting">Reset and pause are locked until private access is verified.</p>}
    <section className="border-y border-border"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3"><h2 className="text-sm font-semibold">Current-session history</h2><span className="text-xs text-muted-foreground">{sum.wins} won · {sum.losses} lost</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-xs"><thead className="text-[10px] uppercase text-muted-foreground"><tr>{['Opened', 'Coin', 'Side', 'Margin', 'Entry', 'Target', 'Stop', 'Exit', 'Result', 'Costs', 'Net P&L', 'Balance after'].map(h => <th key={h} className="px-3 py-3 font-normal">{h}</th>)}</tr></thead>
        <tbody>{trades.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-muted-foreground">No completed trades in this session.</td></tr>}{trades.map(t => <tr key={t.id} className="border-t border-border font-mono"><td className="px-3 py-3">{fmtTime(t.opened_at, tz)}</td><td className="px-3 py-3">{t.symbol}</td><td className="px-3 py-3"><StatusBadge value={t.direction} /></td><td className="px-3 py-3">{fmtUsd(t.margin)}</td><td className="px-3 py-3">{fmtPrice(t.entry_price)}</td><td className="px-3 py-3 text-long">{fmtPrice(t.take_profit)}</td><td className="px-3 py-3 text-short">{fmtPrice(t.stop_loss)}</td><td className="px-3 py-3">{fmtPrice(t.exit_price)}</td><td className="px-3 py-3">{t.exit_reason.replaceAll('_', ' ')}</td><td className="px-3 py-3 text-muted-foreground">{fmtUsd(t.entry_fee + t.exit_fee + t.slippage_cost)}</td><td className={cn('px-3 py-3', tone(t.pnl))}>{fmtSignedUsd(t.pnl)}</td><td className="px-3 py-3">{fmtUsd(t.balance_after)}</td></tr>)}</tbody>
      </table></div>
    </section>
    <Button variant="link" className="px-0" asChild><Link to="/simulator">Simulator</Link></Button>
    <AlertDialog open={confirm} onOpenChange={v => { if (!busy) setConfirm(v); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Reset Simulator 2 to $5?</AlertDialogTitle><AlertDialogDescription>Today’s P&L, session totals and visible history return to zero. Previous sessions remain archived. Any pending entry is canceled. The original Simulator is unchanged.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button disabled={busy} onClick={() => void change()}>Reset to $5</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}