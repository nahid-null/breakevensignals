import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from '@tanstack/react-start';
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { fmtPrice, fmtTime, useMarkets, useSettings, useStatuses } from "@/lib/data";
import { fmtSignedUsd, fmtUsd, simSessionTrades, simSummary, unrealizedPnl, useSimAccount, useSimTrades } from "@/lib/simulator";
import { readSimControlAccess, closeSimTrade } from "@/lib/simulator.functions";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { TrendWatch } from '@/components/terminal/TrendWatch';
import { CstfSimulator } from '@/components/terminal/CstfSimulator';
import { SavedMarketNotice } from '@/components/terminal/SavedMarketNotice';
import { contractFeedStatus } from '@/lib/engine/market-policy';
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export const Route = createFileRoute("/simulator")({
  head: () => ({
    meta: [
      { title: "Simulator Trading — Crypto Signal Terminal" },
      { name: "description", content: "Paper-trading Simulator following the Candle Signals Trend Filter v4 Strong Trend 30-minute signals on 22 Binance Futures coins: $10 shared cross margin, 7 × $0.50 slots, 75x, $0.10 net take profit." },
      { property: "og:title", content: "Simulator Trading — Crypto Signal Terminal" },
      { property: "og:description", content: "CSTF v4 Strong Trend 30m signals, 22 coins, 7 slots of $0.50 at 75x cross, $0.10 net target after fees, no stop loss." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Simulator,
});

const REASON: Record<string, string> = { TAKE_PROFIT: 'TAKE PROFIT HIT', STOP_LOSS: 'STOP LOSS HIT', BREAKEVEN: 'BREAKEVEN', LIQUIDATED: 'LIQUIDATED', TIME_EXIT: 'CLOSED AT TIME LIMIT', MANUAL_CLOSE: 'CLOSED MANUALLY' };
/** prompt-39 trades show only the two receipt statuses; earlier trades keep their original labels. */
/** Time-limit closes are labelled by how long the trade was actually open (older trades used a 1-hour limit, current ones 24 hours). */
const timeLabel = (t: { opened_at?: string | null; closed_at?: string | null }) =>
  t.opened_at && t.closed_at && new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime() >= 23 * 3_600_000 ? 'CLOSED AFTER 24H' : 'CLOSED AFTER 1H';
const resultLabel = (t: { rule_version: string; exit_reason: string | null; opened_at?: string | null; closed_at?: string | null }) =>
  !t.exit_reason ? '—' : (t.rule_version === 'PINE5_TREND' || t.rule_version === 'PINE1_CROSS' || t.rule_version === 'OBVP5_CROSS' || t.rule_version === 'OBSTRONG5_SPOT') ? (t.exit_reason === 'TAKE_PROFIT' ? 'TAKE PROFIT HIT' : t.exit_reason === 'TIME_EXIT' ? timeLabel(t) : t.exit_reason === 'MANUAL_CLOSE' ? 'CLOSED MANUALLY' : 'STOP LOSS HIT') : REASON[t.exit_reason] ?? '—';
const pnlTone = (n: number | null | undefined) => (Number(n) > 0 ? 'text-long' : Number(n) < 0 ? 'text-short' : 'text-muted-foreground');

function Simulator() {
  const qc = useQueryClient();
  const closeTrade = useServerFn(closeSimTrade);
  const [closing, setClosing] = useState<{ id: string; symbol: string } | null>(null);
  const account = useSimAccount();
  const access = useQuery({ queryKey: ['sim_control_access'], queryFn: () => readSimControlAccess() });
  const controlsAllowed = access.data?.allowed === true;
  const trades = useSimTrades();
  const markets = useMarkets();
  const settings = useSettings();
  const status = useStatuses();
  const tz = settings.data?.display_timezone ?? "UTC";
  const [busy, setBusy] = useState(false);
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
  const session = simSessionTrades(list, account.data?.session_started_at);
  const sum = simSummary(session);
  const accountReady = account.isSuccess && account.data !== null;
  const performanceReady = accountReady && trades.isSuccess;

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
    <div className="space-y-10">
      <CstfSimulator tz={tz} />

      <section className="space-y-3 border border-border bg-card/20 p-4">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Previous Simulator account · retired OB STRONG strategy (no new trades)</h2>
        <p className="text-xs text-muted-foreground">Separate from the new $10 account. Balance {fmtUsd(account.data?.balance)} · {opens.length} trade{opens.length === 1 ? '' : 's'} still open on the old rules until they finish · {session.length} session trades, session P&L {performanceReady ? fmtSignedUsd(sum.totalPnl) : '—'}.</p>
        {open && <SavedMarketNotice />}
        {view.length > 0 && <div className="space-y-4">{view.map(({ o: open, market, feed, price, live }) => (
            <div key={open.trade_id} className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border/50 pt-3 font-mono text-sm first:border-t-0 first:pt-0 sm:grid-cols-4">
              <div><div className="text-[10px] text-muted-foreground">COIN</div>{open.symbol}</div>
              <div><div className="text-[10px] text-muted-foreground">SIDE</div><StatusBadge value={open.direction} /></div>
              <div><div className="text-[10px] text-muted-foreground">RULES</div>{open.leverage}x · {open.rule_version === 'OBSTRONG5_SPOT' ? 'OB STRONG 5M · SPOT' : 'PREVIOUS RULES'}</div>
              <div><div className="text-[10px] text-muted-foreground">MARGIN</div>{fmtUsd(open.margin)}</div>
              <div><div className="text-[10px] text-muted-foreground">ENTRY</div>{fmtPrice(open.entry_price)}</div>
              <div><div className="text-[10px] text-muted-foreground">PRICE · {feed === 'LIVE' ? 'LIVE' : 'LAST SAVED'}</div>{Number.isFinite(price) ? fmtPrice(price) : '—'}{feed !== 'LIVE' && <div className="text-[10px] text-waiting">{feed} · {fmtTime(market?.last_candle_at, tz)}</div>}</div>
              <div><div className="text-[10px] text-muted-foreground">TAKE PROFIT</div><span className="text-long">{fmtPrice(open.take_profit)}</span></div>
              <div><div className="text-[10px] text-muted-foreground">UNREALIZED</div><span className={pnlTone(live)}>{fmtSignedUsd(live)}</span></div>
              <div className="col-span-2 sm:col-span-4"><Button variant="outline" size="sm" className="border-short/50 text-short" disabled={busy || !controlsAllowed} onClick={() => setClosing({ id: open.id, symbol: open.symbol })}><X className="size-4" /> Close trade</Button></div>
            </div>
            ))}</div>}
      </section>

      <AlertDialog open={closing !== null} onOpenChange={(o) => { if (!o) setClosing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {closing?.symbol} now?</AlertDialogTitle>
            <AlertDialogDescription>The previous-account practice trade closes at the latest saved price, with fees. The result is sent to Telegram.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep open</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmClose()}>Close trade</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TrendWatch tz={tz} />

      <section className="overflow-hidden border-y border-border">
        <h2 className="border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Previous account trade history</h2>
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
                  <td className="px-3 py-2">{t.leverage}x <span className="text-muted-foreground">{t.rule_version === 'OBSTRONG5_SPOT' ? 'OB STRONG 5M · SPOT · CROSS' : t.rule_version === 'OBVP5_CROSS' ? 'OB-VP 5M · CROSS' : t.rule_version === 'PINE1_CROSS' ? '1M PINE · CROSS' : t.rule_version === 'PINE5_TREND' ? '5M PINE + TREND' : t.rule_version === 'PINE_BE_TREND' ? 'BE + TREND' : t.rule_version === 'LEGACY' ? 'PREVIOUS RULES' : 'PINE'}</span></td>
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
    </div>
  );
}
