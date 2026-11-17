import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from '@tanstack/react-start';
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Wallet, Pencil, RotateCcw } from "lucide-react";
import { fmtPrice, fmtTime, useMarkets, useSettings, useStatuses } from "@/lib/data";
import { fmtSignedUsd, fmtUsd, SIM_RULES, simSessionTrades, simSummary, todayPnl, unrealizedPnl, useSimAccount, useSimTrades } from "@/lib/simulator";
import { addSimBalance, setSimEnabled, changeSimBalance, readSimControlAccess } from "@/lib/simulator.functions";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { TrendWatch } from '@/components/terminal/TrendWatch';
import { SavedMarketNotice } from '@/components/terminal/SavedMarketNotice';
import { contractFeedStatus } from '@/lib/engine/market-policy';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export const Route = createFileRoute("/simulator")({
  head: () => ({
    meta: [
      { title: "Simulator Trading — Crypto Signal Terminal" },
      { name: "description", content: "Practice trades on original 1-minute Pine LONG/SHORT entries with no trend filter, at 50x with 20% of balance, no stop loss and a +25% margin target." },
      { property: "og:title", content: "Simulator Trading — Crypto Signal Terminal" },
      { property: "og:description", content: "1-minute Pine entries with no trend filter, 50x, 20% margin, +25% target or 24h close, cross margin." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Simulator,
});

const REASON: Record<string, string> = { TAKE_PROFIT: 'TAKE PROFIT HIT', STOP_LOSS: 'STOP LOSS HIT', BREAKEVEN: 'BREAKEVEN', LIQUIDATED: 'LIQUIDATED', TIME_EXIT: 'CLOSED AFTER 24H' };
/** prompt-39 trades show only the two receipt statuses; earlier trades keep their original labels. */
const resultLabel = (t: { rule_version: string; exit_reason: string | null }) =>
  !t.exit_reason ? '—' : (t.rule_version === 'PINE5_TREND' || t.rule_version === 'PINE1_CROSS') ? (t.exit_reason === 'TAKE_PROFIT' ? 'TAKE PROFIT HIT' : t.exit_reason === 'TIME_EXIT' ? 'CLOSED AFTER 24H' : 'STOP LOSS HIT') : REASON[t.exit_reason] ?? '—';
const pnlTone = (n: number | null | undefined) => (Number(n) > 0 ? 'text-long' : Number(n) < 0 ? 'text-short' : 'text-muted-foreground');

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string | undefined; hint?: string | undefined }) {
  return (
    <div className="border border-border bg-card/40 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Simulator() {
  const qc = useQueryClient();
  const addBalance = useServerFn(addSimBalance); const enable = useServerFn(setSimEnabled); const adjust = useServerFn(changeSimBalance);
  const account = useSimAccount();
  const access = useQuery({ queryKey: ['sim_control_access'], queryFn: () => readSimControlAccess() });
  const controlsAllowed = access.data?.allowed === true;
  const trades = useSimTrades();
  const markets = useMarkets();
  const settings = useSettings();
  const status = useStatuses();
  const tz = settings.data?.display_timezone ?? "UTC";
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<'EDIT' | 'RESET' | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const list = trades.data ?? [];
  const open = list.find((t) => t.status === 'OPEN');
  const closed = list.filter((t) => t.status === 'CLOSED');
  const market = open ? markets.data?.find((m) => m.symbol === open.symbol) : undefined;
  const feed = contractFeedStatus(market, status.health, status.healthQuery.isError || markets.isError);
  const price = Number(market?.price ?? NaN);
  const live = open && Number.isFinite(price) ? unrealizedPnl(open, price) : null;
  const session = simSessionTrades(list, account.data?.session_started_at);
  const sum = simSummary(session);
  const today = todayPnl(session, new Date(), tz);
  const balance = Number(account.data?.balance ?? 0);
  const accountReady = account.isSuccess && account.data !== null;
  const performanceReady = accountReady && trades.isSuccess;

  async function deposit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { toast.error("Enter an amount above 0"); return; }
    setBusy(true);
    try {
      await addBalance({ data: { amount: n } });
      setAmount("");
      toast.success(`${fmtUsd(n)} added to the simulator`);
      await qc.invalidateQueries({ queryKey: ['sim_account'] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not add balance"); }
    finally { setBusy(false); }
  }
  async function toggle(enabled: boolean) {
    try { await enable({ data: { enabled } }); await qc.invalidateQueries({ queryKey: ['sim_account'] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not change the simulator"); }
  }

  async function changeBalance() {
    const n = edit === 'RESET' ? SIM_RULES.defaultBalance : Number(newBalance);
    if (edit === null || !Number.isFinite(n) || n < 0 || (edit === 'EDIT' && newBalance.trim() === '')) { toast.error('Enter a valid balance'); return; }
    setBusy(true);
    try {
      await adjust({ data: { balance: n, restart: edit === 'RESET' } });
      await qc.invalidateQueries({ queryKey: ['sim_account'] });
      toast.success(edit === 'RESET' ? 'Simulator restarted at $10; session totals cleared, history retained' : 'Practice balance updated'); setAmount(''); setEdit(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not change balance'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Wallet className="size-3" /> PRACTICE MONEY · NO REAL ORDERS</div>
          <h1 className="text-2xl font-semibold">Simulator trading</h1>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className={account.data?.enabled ? 'text-long' : 'text-waiting'}>{!accountReady ? 'Status unavailable' : account.data?.enabled ? 'Taking new trades' : 'Paused'}</span>
          <Switch checked={!!account.data?.enabled} disabled={!account.data || !controlsAllowed} onCheckedChange={(v) => void toggle(v)} aria-label="Simulator on or off" />
        </label>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Balance" value={fmtUsd(account.data?.balance)} hint={`Lifetime added ${fmtUsd(account.data?.total_deposited)}`} />
        <Tile label="Equity" value={performanceReady && (!open || live !== null) ? fmtUsd(balance + (live ?? 0)) : '—'} hint={open ? 'Includes open trade' : undefined} />
        <Tile label="Today's P&L" value={performanceReady ? fmtSignedUsd(today) : '—'} tone={pnlTone(today)} />
        <Tile label="Session P&L" value={performanceReady ? fmtSignedUsd(sum.totalPnl) : '—'} tone={pnlTone(sum.totalPnl)} />
        <Tile label="Win rate" value={!performanceReady || sum.winRate === null ? '—' : `${sum.winRate.toFixed(1)}%`} hint={performanceReady ? `${sum.wins} won · ${sum.losses} lost` : undefined} />
        <Tile label="Session trades" value={performanceReady ? String(session.length) : '—'} hint={performanceReady ? `${sum.closed} closed` : undefined} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3 border border-border bg-card/40 p-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Add trading balance</h2>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void deposit(); }}>
            <Input type="number" inputMode="decimal" min="0.01" step="0.01" max="1000000000" placeholder="Amount in USDT" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" aria-label="Amount in USDT" disabled={busy || !controlsAllowed || !!open || !accountReady} />
            <Button type="submit" disabled={busy || !controlsAllowed || !!open || !accountReady}><Plus className="size-4" /> Add</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !!open || !account.data || !controlsAllowed} onClick={() => { setNewBalance(balance.toFixed(2)); setEdit('EDIT'); }}><Pencil className="size-4" /> Edit balance</Button>
            <Button variant="outline" disabled={busy || !!open || !account.data || !controlsAllowed} onClick={() => setEdit('RESET')}><RotateCcw className="size-4" /> Restart simulator</Button>
          </div>
          {open && <p className="text-xs text-waiting">Balance changes are locked until the open trade finishes.</p>}
          {access.data && !controlsAllowed && <p className="text-xs text-waiting">Account controls locked: private access has not been verified.</p>}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
            <dt className="text-muted-foreground">New trade leverage</dt><dd className="font-mono">{SIM_RULES.leverage}x</dd>
            <dt className="text-muted-foreground">Allocated margin</dt><dd className="font-mono">{SIM_RULES.marginShare * 100}% of balance</dd>
            <dt className="text-muted-foreground">Signals</dt><dd>LONG/SHORT indicators on 1m chart</dd>
            <dt className="text-muted-foreground">Entry</dt><dd>Indicator entry price</dd>
            <dt className="text-muted-foreground">Trend filter</dt><dd>None — every signal is used</dd>
            <dt className="text-muted-foreground">Max time open</dt><dd>24 hours, then closed at market</dd>
            <dt className="text-muted-foreground">Take profit</dt><dd>+25% of margin after fees</dd>
            <dt className="text-muted-foreground">Stop loss</dt><dd>None — cross margin (whole balance backs the trade)</dd>
            <dt className="text-muted-foreground">Telegram</dt><dd>Trade results only</dd>
            <dt className="text-muted-foreground">Costs</dt><dd>{SIM_RULES.feePercent}% per side + 1 tick per side</dd>
            <dt className="text-muted-foreground">Concurrent trades</dt><dd>1</dd>
          </dl>
        </div>
        <div className="space-y-3 border border-border bg-card/40 p-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Open position</h2>
          {open && <SavedMarketNotice />}
          {!performanceReady ? <p className="text-sm text-muted-foreground">{account.isError || trades.isError ? 'Could not load practice account or trades.' : 'Loading practice account…'}</p> : !open ? <p className="text-sm text-muted-foreground">{!account.data?.enabled ? 'Paused — no new practice entries.' : balance > 0 ? 'Waiting for a 1-minute indicator signal on a specially watched coin.' : 'Practice balance is zero.'}</p> : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm sm:grid-cols-3">
              <div><div className="text-[10px] text-muted-foreground">COIN</div>{open.symbol}</div>
              <div><div className="text-[10px] text-muted-foreground">SIDE</div><StatusBadge value={open.direction} /></div>
              <div><div className="text-[10px] text-muted-foreground">LEVERAGE</div>{open.leverage}x · {open.rule_version === 'PINE1_CROSS' ? '1M PINE · CROSS' : open.rule_version === 'PINE5_TREND' ? '5M PINE + TREND' : open.rule_version === 'PINE_BE_TREND' ? 'BE + TREND' : open.rule_version === 'LEGACY' ? 'PREVIOUS RULES' : 'PINE'}</div>
              <div><div className="text-[10px] text-muted-foreground">MARGIN</div>{fmtUsd(open.margin)}</div>
              <div><div className="text-[10px] text-muted-foreground">ENTRY</div>{fmtPrice(open.entry_price)}</div>
              <div><div className="text-[10px] text-muted-foreground">PRICE · {feed === 'LIVE' ? 'LIVE' : 'LAST SAVED'}</div>{Number.isFinite(price) ? fmtPrice(price) : '—'}{feed !== 'LIVE' && <div className="text-[10px] text-waiting">{feed} · {fmtTime(market?.last_candle_at, tz)}</div>}</div>
              <div><div className="text-[10px] text-muted-foreground">STOP LOSS</div><span className={open.breakeven ? 'text-breakeven' : 'text-short'}>{fmtPrice(open.stop_loss)}</span></div>
              <div><div className="text-[10px] text-muted-foreground">TAKE PROFIT</div><span className="text-long">{fmtPrice(open.take_profit)}</span></div>
              <div><div className="text-[10px] text-muted-foreground">LIQUIDATION</div>{Number(open.liquidation_price).toPrecision(6)}</div>
              <div className="col-span-2 sm:col-span-3"><div className="text-[10px] text-muted-foreground">UNREALIZED P&L (LAST SAVED PRICE)</div><span className={cn('text-lg', pnlTone(live))}>{fmtSignedUsd(live)}</span></div>
            </div>
          )}
        </div>
      </section>

      <TrendWatch tz={tz} />

      <section className="overflow-hidden border-y border-border">
        <h2 className="border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Trade history</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                {['Opened', 'Coin', 'Side', 'Leverage', 'Margin', 'Entry', 'Exit', 'Result', 'Fees', 'P&L', 'Balance after', 'Closed'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {trades.isLoading ? <tr><td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">Loading trade history…</td></tr> : trades.isError ? <tr><td colSpan={12} className="px-3 py-8 text-center text-short">Could not load trade history.</td></tr> : closed.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">No finished simulator trades yet.</td></tr>}
              {closed.map((t) => (
                <tr key={t.id} className="border-b border-border/50 font-mono text-xs">
                  <td className="px-3 py-2">{fmtTime(t.opened_at, tz)}</td>
                  <td className="px-3 py-2">{t.symbol}</td>
                  <td className="px-3 py-2"><StatusBadge value={t.direction} /></td>
                  <td className="px-3 py-2">{t.leverage}x <span className="text-muted-foreground">{t.rule_version === 'PINE1_CROSS' ? '1M PINE · CROSS' : t.rule_version === 'PINE5_TREND' ? '5M PINE + TREND' : t.rule_version === 'PINE_BE_TREND' ? 'BE + TREND' : t.rule_version === 'LEGACY' ? 'PREVIOUS RULES' : 'PINE'}</span></td>
                  <td className="px-3 py-2">{fmtUsd(t.margin)}</td>
                  <td className="px-3 py-2">{fmtPrice(t.entry_price)}</td>
                  <td className="px-3 py-2">{t.exit_price === null ? '—' : Number(t.exit_price).toPrecision(6)}</td>
                  <td className="px-3 py-2"><StatusBadge value={resultLabel(t)} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtUsd(Number(t.entry_fee) + Number(t.exit_fee))}</td>
                  <td className={cn('px-3 py-2', pnlTone(t.pnl))}>{fmtSignedUsd(t.pnl)}</td>
                  <td className="px-3 py-2">{fmtUsd(t.balance_after)}</td>
                  <td className="px-3 py-2">{fmtTime(t.closed_at, tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <AlertDialog open={edit !== null} onOpenChange={(v) => { if (!v && !busy) setEdit(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{edit === 'RESET' ? 'Restart simulator at $10?' : 'Edit practice balance?'}</AlertDialogTitle>
            <AlertDialogDescription>{edit === 'RESET' ? 'Restores $10 and enables new practice trades: 50x leverage, 20% of balance as margin, take profit at +25% of margin or close after 24 hours, no stop loss (cross margin). Today’s P&L, session P&L and trade counters start at zero. Previous trades, lifetime deposits and results stay in history.' : 'This is a recorded capital adjustment, not trading profit or a deposit. Existing history stays unchanged.'}</AlertDialogDescription></AlertDialogHeader>
          {edit === 'EDIT' && <Input aria-label="New practice balance" type="number" min="0" step="0.01" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} />}
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button disabled={busy} onClick={() => void changeBalance()}>{edit === 'RESET' ? 'Restart at $10' : 'Save balance'}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
