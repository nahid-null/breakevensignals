import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Wallet } from "lucide-react";
import { fmtPrice, fmtTime, useMarkets, useSettings } from "@/lib/data";
import { fmtSignedUsd, fmtUsd, SIM_RULES, simSummary, todayPnl, unrealizedPnl, useSimAccount, useSimTrades } from "@/lib/simulator";
import { addSimBalance, setSimEnabled } from "@/lib/simulator.functions";
import { StatusBadge } from "@/components/terminal/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/simulator")({
  head: () => ({
    meta: [
      { title: "Simulator Trading — Crypto Signal Terminal" },
      { name: "description", content: "Practice balance that automatically trades every trend-approved Telegram signal, with P&L and trade history." },
      { property: "og:title", content: "Simulator Trading — Crypto Signal Terminal" },
      { property: "og:description", content: "Practice balance that automatically trades every trend-approved Telegram signal, with P&L and trade history." },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: Simulator,
});

const REASON: Record<string, string> = { TAKE_PROFIT: 'TAKE PROFIT HIT', STOP_LOSS: 'STOP LOSS HIT', BREAKEVEN: 'BREAKEVEN', LIQUIDATED: 'LIQUIDATED' };
const pnlTone = (n: number | null | undefined) => (Number(n) > 0 ? 'text-long' : Number(n) < 0 ? 'text-short' : 'text-muted-foreground');

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
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
  const account = useSimAccount();
  const trades = useSimTrades();
  const markets = useMarkets();
  const settings = useSettings();
  const tz = settings.data?.display_timezone ?? "UTC";
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const list = trades.data ?? [];
  const open = list.find((t) => t.status === 'OPEN');
  const closed = list.filter((t) => t.status === 'CLOSED');
  const price = open ? Number(markets.data?.find((m) => m.symbol === open.symbol)?.price ?? NaN) : NaN;
  const live = open && Number.isFinite(price) ? unrealizedPnl(open, price) : null;
  const sum = simSummary(list);
  const today = todayPnl(list, new Date(), tz);
  const balance = Number(account.data?.balance ?? 0);

  async function deposit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { toast.error("Enter an amount above 0"); return; }
    setBusy(true);
    try {
      await addSimBalance({ data: { amount: n } });
      setAmount("");
      toast.success(`${fmtUsd(n)} added to the simulator`);
      await qc.invalidateQueries({ queryKey: ['sim_account'] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not add balance"); }
    finally { setBusy(false); }
  }
  async function toggle(enabled: boolean) {
    try { await setSimEnabled({ data: { enabled } }); await qc.invalidateQueries({ queryKey: ['sim_account'] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not change the simulator"); }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Wallet className="size-3" /> PRACTICE MONEY · NO REAL ORDERS</div>
          <h1 className="text-2xl font-semibold">Simulator trading</h1>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className={account.data?.enabled ? 'text-long' : 'text-waiting'}>{account.data?.enabled ? 'Taking new trades' : 'Paused'}</span>
          <Switch checked={!!account.data?.enabled} disabled={!account.data} onCheckedChange={(v) => void toggle(v)} aria-label="Simulator on or off" />
        </label>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Balance" value={fmtUsd(account.data?.balance)} hint={`Added in total ${fmtUsd(account.data?.total_deposited)}`} />
        <Tile label="Equity" value={fmtUsd(balance + (live ?? 0))} hint={open ? 'Includes open trade' : undefined} />
        <Tile label="Today's P&L" value={fmtSignedUsd(today)} tone={pnlTone(today)} />
        <Tile label="Total P&L" value={fmtSignedUsd(sum.totalPnl)} tone={pnlTone(sum.totalPnl)} />
        <Tile label="Win rate" value={sum.winRate === null ? '—' : `${sum.winRate.toFixed(1)}%`} hint={`${sum.wins} won · ${sum.losses} lost`} />
        <Tile label="Trades" value={String(list.length)} hint={`${sum.closed} closed`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3 border border-border bg-card/40 p-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Add trading balance</h2>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void deposit(); }}>
            <Input type="number" inputMode="decimal" min="1" step="0.01" placeholder="Amount in USDT" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" aria-label="Amount in USDT" />
            <Button type="submit" disabled={busy}><Plus className="size-4" /> Add</Button>
          </form>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Uses {SIM_RULES.marginShare * 100}% of the balance on every trade.</li>
            <li>• Strong signal: {SIM_RULES.strongLeverage}x. Normal signal: {SIM_RULES.normalLeverage}x.</li>
            <li>• Strong = 15M, 5M and 1M trend all at full score with ADX {SIM_RULES.strongAdx} or higher.</li>
            <li>• {SIM_RULES.feePercent}% fee on entry and exit; liquidation is included.</li>
            <li>• Only one trade at a time; signals during an open trade are skipped.</li>
            <li>• Trades only the live, trend-approved signals sent to Telegram.</li>
          </ul>
        </div>
        <div className="space-y-3 border border-border bg-card/40 p-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Open position</h2>
          {!open ? <p className="text-sm text-muted-foreground">{balance > 0 ? 'Waiting for the next trend-approved signal.' : 'Add a balance to start simulating.'}</p> : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm sm:grid-cols-3">
              <div><div className="text-[10px] text-muted-foreground">COIN</div>{open.symbol}</div>
              <div><div className="text-[10px] text-muted-foreground">SIDE</div><StatusBadge value={open.direction} /></div>
              <div><div className="text-[10px] text-muted-foreground">LEVERAGE</div>{open.leverage}x · {open.strength}</div>
              <div><div className="text-[10px] text-muted-foreground">MARGIN</div>{fmtUsd(open.margin)}</div>
              <div><div className="text-[10px] text-muted-foreground">ENTRY</div>{fmtPrice(open.entry_price)}</div>
              <div><div className="text-[10px] text-muted-foreground">PRICE</div>{Number.isFinite(price) ? fmtPrice(price) : '—'}</div>
              <div><div className="text-[10px] text-muted-foreground">STOP LOSS</div><span className={open.breakeven ? 'text-breakeven' : 'text-short'}>{fmtPrice(open.stop_loss)}</span></div>
              <div><div className="text-[10px] text-muted-foreground">TAKE PROFIT</div><span className="text-long">{fmtPrice(open.take_profit)}</span></div>
              <div><div className="text-[10px] text-muted-foreground">LIQUIDATION</div>{Number(open.liquidation_price).toPrecision(6)}</div>
              <div className="col-span-2 sm:col-span-3"><div className="text-[10px] text-muted-foreground">UNREALIZED P&L (LAST SAVED PRICE)</div><span className={cn('text-lg', pnlTone(live))}>{fmtSignedUsd(live)}</span></div>
            </div>
          )}
        </div>
      </section>

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
              {closed.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">No finished simulator trades yet.</td></tr>}
              {closed.map((t) => (
                <tr key={t.id} className="border-b border-border/50 font-mono text-xs">
                  <td className="px-3 py-2">{fmtTime(t.opened_at, tz)}</td>
                  <td className="px-3 py-2">{t.symbol}</td>
                  <td className="px-3 py-2"><StatusBadge value={t.direction} /></td>
                  <td className="px-3 py-2">{t.leverage}x <span className="text-muted-foreground">{t.strength}</span></td>
                  <td className="px-3 py-2">{fmtUsd(t.margin)}</td>
                  <td className="px-3 py-2">{fmtPrice(t.entry_price)}</td>
                  <td className="px-3 py-2">{t.exit_price === null ? '—' : Number(t.exit_price).toPrecision(6)}</td>
                  <td className="px-3 py-2"><StatusBadge value={REASON[t.exit_reason ?? ''] ?? '—'} /></td>
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
