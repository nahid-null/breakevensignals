import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from '@tanstack/react-start';
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Wallet, Pencil, RotateCcw, X } from "lucide-react";
import { fmtPrice, fmtTime, useMarkets, useSettings, useStatuses } from "@/lib/data";
import { fmtSignedUsd, fmtUsd, SIM_RULES, simSessionTrades, simSummary, todayPnl, unrealizedPnl, useSimAccount, useSimTrades } from "@/lib/simulator";
import { addSimBalance, setSimEnabled, changeSimBalance, readSimControlAccess, closeSimTrade } from "@/lib/simulator.functions";
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
      { name: "description", content: "Practice trades on every OB + Weighted VP 5-minute signal from Binance spot candles, up to 6 at a time across 12 coins, at 75x with 5% of balance per slot, no stop loss, no time limit and a +25% margin target." },
      { property: "og:title", content: "Simulator Trading — Crypto Signal Terminal" },
      { property: "og:description", content: "Entries only from the OB + Weighted VP 5-minute indicator, 12 coins, 6 slots, 75x, 5% margin each, +25% target, no time limit, manual close, cross margin." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Simulator,
});

const REASON: Record<string, string> = { TAKE_PROFIT: 'TAKE PROFIT HIT', STOP_LOSS: 'STOP LOSS HIT', BREAKEVEN: 'BREAKEVEN', LIQUIDATED: 'LIQUIDATED', TIME_EXIT: 'CLOSED AT TIME LIMIT', MANUAL_CLOSE: 'CLOSED MANUALLY', REPLACED_BY_SIGNAL: 'REPLACED BY NEW SIGNAL (4H LOSS)' };
/** prompt-39 trades show only the two receipt statuses; earlier trades keep their original labels. */
/** Time-limit closes are labelled by how long the trade was actually open (older trades used a 1-hour limit, current ones 24 hours). */
const timeLabel = (t: { opened_at?: string | null; closed_at?: string | null }) =>
  t.opened_at && t.closed_at && new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime() >= 23 * 3_600_000 ? 'CLOSED AFTER 24H' : 'CLOSED AFTER 1H';
const resultLabel = (t: { rule_version: string; exit_reason: string | null; opened_at?: string | null; closed_at?: string | null }) =>
  !t.exit_reason ? '—' : (t.rule_version === 'PINE5_TREND' || t.rule_version === 'PINE1_CROSS' || t.rule_version === 'OBVP5_CROSS') ? (t.exit_reason === 'TAKE_PROFIT' ? 'TAKE PROFIT HIT' : t.exit_reason === 'TIME_EXIT' ? timeLabel(t) : t.exit_reason === 'MANUAL_CLOSE' ? 'CLOSED MANUALLY' : t.exit_reason === 'REPLACED_BY_SIGNAL' ? 'REPLACED BY NEW SIGNAL (4H LOSS)' : 'STOP LOSS HIT') : REASON[t.exit_reason] ?? '—';
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
  const addBalance = useServerFn(addSimBalance); const enable = useServerFn(setSimEnabled); const adjust = useServerFn(changeSimBalance); const closeTrade = useServerFn(closeSimTrade);
  const [closing, setClosing] = useState<{ id: string; symbol: string } | null>(null);
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
  const opens = list.filter((t) => t.status === 'OPEN');
  const open = opens[0];
  const closed = list.filter((t) => t.status === 'CLOSED');
  const view = opens.map((o) => {
    const market = markets.data?.find((m) => m.symbol === o.symbol);
    const feed = contractFeedStatus(market, status.health, status.healthQuery.isError || markets.isError);
    const price = Number(market?.price ?? NaN);
    return { o, market, feed, price, live: Number.isFinite(price) ? unrealizedPnl(o, price) : null };
  });
  // prompt-42: equity includes every open slot; unknown when any open price is missing.
  const live = view.length === 0 ? null : view.some((v) => v.live === null) ? null : view.reduce((a, v) => a + (v.live ?? 0), 0);
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

  async function confirmClose() {
    if (!closing) return;
    setBusy(true);
    try {
      const r = await closeTrade({ data: { id: closing.id } });
      toast.success(`${closing.symbol} closed at ${fmtPrice(r.price)}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ['sim_trades'] }), qc.invalidateQueries({ queryKey: ['sim_account'] })]);
      setClosing(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not close trade'); }
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
          {open && <p className="text-xs text-waiting">Balance changes are locked until open trades finish.</p>}
          {access.data && !controlsAllowed && <p className="text-xs text-waiting">Account controls locked: private access has not been verified.</p>}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
            <dt className="text-muted-foreground">New trade leverage</dt><dd className="font-mono">{SIM_RULES.leverage}x</dd>
            <dt className="text-muted-foreground">Allocated margin</dt><dd className="font-mono">{SIM_RULES.marginShare * 100}% of balance per trade</dd>
            <dt className="text-muted-foreground">Signals</dt><dd>OB + Weighted VP indicator on the Binance spot 5m chart only (exits use futures prices)</dd>
            <dt className="text-muted-foreground">Entry</dt><dd>Exact indicator entry price (signal candle close)</dd>
            <dt className="text-muted-foreground">Trend filter</dt><dd>None — every indicator signal is followed</dd>
            <dt className="text-muted-foreground">Max time open</dt><dd>No limit — stays open until +25% (or close manually)</dd>
            <dt className="text-muted-foreground">Same-coin replace</dt><dd>Open 3.5h+ and losing: a new signal on the same coin closes it and the new trade is taken</dd>
            <dt className="text-muted-foreground">Take profit</dt><dd>+25% of margin after fees</dd>
            <dt className="text-muted-foreground">Stop loss</dt><dd>None — cross margin (whole balance backs the trade)</dd>
            <dt className="text-muted-foreground">Telegram</dt><dd>Trade results only</dd>
            <dt className="text-muted-foreground">Costs</dt><dd>{SIM_RULES.feePercent}% per side + 1 tick per side</dd>
            <dt className="text-muted-foreground">Concurrent trades</dt><dd>Up to {SIM_RULES.slots} (one per coin), {SIM_RULES.marginShare * 100}% of balance each</dd>
          </dl>
        </div>
        <div className="space-y-3 border border-border bg-card/40 p-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Open positions · {opens.length} of {SIM_RULES.slots} slots</h2>
          {open && <SavedMarketNotice />}
          {!performanceReady ? <p className="text-sm text-muted-foreground">{account.isError || trades.isError ? 'Could not load practice account or trades.' : 'Loading practice account…'}</p> : !open ? <p className="text-sm text-muted-foreground">{!account.data?.enabled ? 'Paused — no new practice entries.' : balance > 0 ? 'Waiting for a 5-minute OB + Weighted VP signal.' : 'Practice balance is zero.'}</p> : (
            <div className="space-y-4">{view.map(({ o: open, market, feed, price, live }) => (
            <div key={open.trade_id} className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border/50 pt-3 font-mono text-sm first:border-t-0 first:pt-0 sm:grid-cols-3">
              <div><div className="text-[10px] text-muted-foreground">COIN</div>{open.symbol}</div>
              <div><div className="text-[10px] text-muted-foreground">SIDE</div><StatusBadge value={open.direction} /></div>
              <div><div className="text-[10px] text-muted-foreground">LEVERAGE</div>{open.leverage}x · {open.rule_version === 'OBVP5_CROSS' ? 'OB-VP 5M · CROSS' : open.rule_version === 'PINE1_CROSS' ? '1M PINE · CROSS' : open.rule_version === 'PINE5_TREND' ? '5M PINE + TREND' : open.rule_version === 'PINE_BE_TREND' ? 'BE + TREND' : open.rule_version === 'LEGACY' ? 'PREVIOUS RULES' : 'PINE'}</div>
              <div><div className="text-[10px] text-muted-foreground">MARGIN</div>{fmtUsd(open.margin)}</div>
              <div><div className="text-[10px] text-muted-foreground">ENTRY</div>{fmtPrice(open.entry_price)}</div>
              <div><div className="text-[10px] text-muted-foreground">PRICE · {feed === 'LIVE' ? 'LIVE' : 'LAST SAVED'}</div>{Number.isFinite(price) ? fmtPrice(price) : '—'}{feed !== 'LIVE' && <div className="text-[10px] text-waiting">{feed} · {fmtTime(market?.last_candle_at, tz)}</div>}</div>
              <div><div className="text-[10px] text-muted-foreground">STOP LOSS</div>{open.rule_version === 'PINE1_CROSS' || open.rule_version === 'OBVP5_CROSS' ? <span className="text-muted-foreground">None</span> : <span className={open.breakeven ? 'text-breakeven' : 'text-short'}>{fmtPrice(open.stop_loss)}</span>}</div>

              <div><div className="text-[10px] text-muted-foreground">TAKE PROFIT</div><span className="text-long">{fmtPrice(open.take_profit)}</span></div>
              <div><div className="text-[10px] text-muted-foreground">LIQUIDATION</div>{Number(open.liquidation_price).toPrecision(6)}</div>
              <div className="col-span-2 sm:col-span-3"><div className="text-[10px] text-muted-foreground">UNREALIZED P&L (LAST SAVED PRICE)</div><span className={cn('text-lg', pnlTone(live))}>{fmtSignedUsd(live)}</span></div>
              <div className="col-span-2 sm:col-span-3"><Button variant="outline" size="sm" className="border-short/50 text-short" disabled={busy || !controlsAllowed} onClick={() => setClosing({ id: open.id, symbol: open.symbol })}><X className="size-4" /> Close trade</Button></div>
            </div>
            ))}</div>
          )}
        </div>
      </section>

      <AlertDialog open={closing !== null} onOpenChange={(o) => { if (!o) setClosing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {closing?.symbol} now?</AlertDialogTitle>
            <AlertDialogDescription>The practice trade closes at the latest saved price, with fees. The result is sent to Telegram.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep open</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmClose()}>Close trade</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  <td className="px-3 py-2">{t.leverage}x <span className="text-muted-foreground">{t.rule_version === 'OBVP5_CROSS' ? 'OB-VP 5M · CROSS' : t.rule_version === 'PINE1_CROSS' ? '1M PINE · CROSS' : t.rule_version === 'PINE5_TREND' ? '5M PINE + TREND' : t.rule_version === 'PINE_BE_TREND' ? 'BE + TREND' : t.rule_version === 'LEGACY' ? 'PREVIOUS RULES' : 'PINE'}</span></td>
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
            <AlertDialogDescription>{edit === 'RESET' ? 'Restores $10 and enables new practice trades: 75x leverage, 5% of balance per trade (6 slots), take profit at +25% of margin, no time limit (or close manually), no stop loss (cross margin). Today’s P&L, session P&L and trade counters start at zero. Previous trades, lifetime deposits and results stay in history.' : 'This is a recorded capital adjustment, not trading profit or a deposit. Existing history stays unchanged.'}</AlertDialogDescription></AlertDialogHeader>
          {edit === 'EDIT' && <Input aria-label="New practice balance" type="number" min="0" step="0.01" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} />}
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button disabled={busy} onClick={() => void changeBalance()}>{edit === 'RESET' ? 'Restart at $10' : 'Save balance'}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
