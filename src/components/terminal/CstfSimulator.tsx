import { Wallet } from 'lucide-react';
import { CSTF_SYMBOLS } from '@/lib/engine/cstf';
import { CSTF_RULES, cstfMarginFor } from '@/lib/engine/cstf-account';
import { fmtPrice, fmtTime } from '@/lib/data';
import { fmtSignedUsd, fmtUsd, useCstfSimulator } from '@/lib/simulator';
import { StatusBadge } from '@/components/terminal/StatusBadge';
import { cn } from '@/lib/utils';

const tone = (n: number | null | undefined) => (Number(n) > 0 ? 'text-long' : Number(n) < 0 ? 'text-short' : 'text-muted-foreground');
const REASON: Record<string, string> = { ALL_SLOTS_IN_USE: 'All 7 slots in use', NOT_LIVE: 'Scanner catching up (not live)', LEVERAGE_UNAVAILABLE: '75x not available', INSUFFICIENT_AVAILABLE_MARGIN: 'Not enough free margin' };
const STATUS: Record<string, { label: string; tone: string }> = {
  RUNNING: { label: 'Running live', tone: 'text-long' }, CATCHING_UP: { label: 'Catching up', tone: 'text-waiting' },
  WAITING: { label: 'Waiting for market data', tone: 'text-waiting' }, ERROR: { label: 'Problem', tone: 'text-short' },
  WAITING_FOR_WORKER: { label: 'Waiting for the scanner to start', tone: 'text-waiting' },
  STOPPED: { label: 'Stopped — no new trades', tone: 'text-muted-foreground' },
};

function Tile({ label, value, tone: t, hint }: { label: string; value: string; tone?: string | undefined; hint?: string | undefined }) {
  return <div className="border border-border bg-card/40 px-4 py-3">
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className={cn('mt-1 font-mono text-2xl font-semibold tabular-nums', t)}>{value}</div>
    {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
  </div>;
}

/** prompt-74: the active Simulator — exact CSTF v4 Strong Trend 30m system from the prompt-71 backtest. Read-only. */
export function CstfSimulator({ tz }: { tz: string }) {
  const q = useCstfSimulator();
  const a = q.data?.account; const trades = q.data?.trades ?? []; const signals = q.data?.signals ?? [];
  const open = trades.filter((t) => t.status === 'OPEN'); const closed = trades.filter((t) => t.status === 'CLOSED');
  const tps = closed.filter((t) => t.exit_reason === 'TAKE_PROFIT').length; const liqs = closed.length - tps;
  const realized = closed.reduce((s, t) => s + Number(t.net ?? 0), 0);
  const stopped = !!a?.stopped_at;
  const stale = !stopped && a?.checked_at ? Date.now() - Date.parse(a.checked_at) > 5 * 60_000 : true;
  const st = STATUS[a?.status ?? ''] ?? { label: a?.status ?? '—', tone: 'text-muted-foreground' };
  const usedMargin = open.reduce((s, t) => s + Number(t.margin), 0);
  // Main Balance = $10 + closed results: wallet with open trades' already-paid entry fees and funding added back.
  const mainBalance = a ? Number(a.wallet) + open.reduce((s, t) => s + Number(t.entry_fee) + Number(t.funding), 0) : null;
  const nextMargin = mainBalance === null ? null : cstfMarginFor(mainBalance);
  const available = a ? Number(a.equity) - usedMargin : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Wallet className="size-3" /> PRACTICE MONEY · NO REAL ORDERS</div>
          <h1 className="text-2xl font-semibold">Crypto Simulator{stopped ? ' · stopped' : ''}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Candle Signals – Trend Filter v4 Strong Trend · 30-minute Binance Futures signals · shared cross margin</p>
        </div>
        <div className="text-right text-sm">
          <div className={cn('font-medium', stale && a?.status === 'RUNNING' ? 'text-waiting' : st.tone)}>{!a ? 'Status unavailable' : stale && a.status === 'RUNNING' ? 'No update for 5+ minutes' : st.label}</div>
          <div className="text-[11px] text-muted-foreground">Last processed minute: {a?.last_minute ? fmtTime(new Date(a.last_minute + 60_000).toISOString(), tz) : '—'}</div>
          {a?.error && <div className="max-w-sm text-[11px] text-short">{a.error}</div>}
        </div>
      </div>

      {stopped && <div className="border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
        You stopped the crypto Simulator on {fmtTime(a!.stopped_at!, tz)}. It opens no new trades and sends no Telegram messages. All past trades below are kept as they were.
      </div>}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Main balance" value={fmtUsd(mainBalance)} hint={`Started with ${fmtUsd(CSTF_RULES.startingBalance)}; changes when trades close`} />
        <Tile label="Next trade margin" value={nextMargin === null ? '—' : `$${nextMargin.toFixed(4)}`} hint={`5% of main balance · TP ${nextMargin === null ? '—' : `$${(nextMargin * CSTF_RULES.targetRate).toFixed(4)}`} net`} />
        <Tile label="Available margin" value={fmtUsd(available)} hint="Equity minus margin in use" />
        <Tile label="Equity" value={fmtUsd(a?.equity)} hint="Wallet + open trades (mark price)" />
        <Tile label="Realized P&L" value={fmtSignedUsd(realized)} tone={tone(realized)} />
        <Tile label="Open slots" value={`${open.length} / ${CSTF_RULES.slots}`} hint={`${fmtUsd(usedMargin)} margin in use`} />
        <Tile label="Take profits" value={String(tps)} tone={tps ? 'text-long' : undefined} hint={`${liqs} liquidated`} />
        <Tile label="Maintenance" value={fmtUsd(a?.maintenance)} hint="Liquidation if equity falls to this" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <dl className="grid grid-cols-2 content-start gap-x-3 gap-y-2 border border-border bg-card/40 p-4 text-xs">
          <dt className="col-span-2 mb-1 text-xs uppercase tracking-widest text-muted-foreground">Active settings</dt>
          <dt className="text-muted-foreground">Signals</dt><dd>Original indicator LONG/SHORT, confirmed 30m close only</dd>
          <dt className="text-muted-foreground">Entry</dt><dd>Next 1-minute open after the 30m close</dd>
          <dt className="text-muted-foreground">Leverage</dt><dd className="font-mono">{CSTF_RULES.leverage}x cross</dd>
          <dt className="text-muted-foreground">Margin per trade</dt><dd>{CSTF_RULES.marginRate * 100}% of the current main balance at entry; open trades keep their margin</dd>
          <dt className="text-muted-foreground">Slots</dt><dd className="font-mono">{CSTF_RULES.slots} max; extra signals skipped</dd>
          <dt className="text-muted-foreground">Take profit</dt><dd>{CSTF_RULES.targetRate * 100}% of that trade's margin, net after fees & funding</dd>
          <dt className="text-muted-foreground">Stop loss / time exit</dt><dd>None</dd>
          <dt className="text-muted-foreground">Liquidation</dt><dd>Whole wallet shared; Binance maintenance tiers on mark price</dd>
          <dt className="text-muted-foreground">Costs</dt><dd>{CSTF_RULES.feeRate * 100}% fee + {CSTF_RULES.slippageRate * 100}% slippage per side, real funding</dd>
          <dt className="text-muted-foreground">Telegram</dt><dd>Every trade result</dd>
          <dt className="text-muted-foreground">Coins ({CSTF_SYMBOLS.length})</dt><dd className="font-mono text-[11px]">{CSTF_SYMBOLS.map((s) => s.replace('USDT', '')).join(' ')}</dd>
        </dl>
        <div className="space-y-3 border border-border bg-card/40 p-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Open positions · {open.length} of {CSTF_RULES.slots}</h2>
          {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : q.isError ? <p className="text-sm text-short">Could not load the Simulator.</p> : !open.length ? <p className="text-sm text-muted-foreground">Waiting for a confirmed 30-minute signal.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] font-mono text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">{['Coin', 'Side', 'Margin', 'Entry', 'Take profit', 'Liquidation', 'Mark', 'Unrealized', 'Opened'].map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{open.map((t) => <tr key={t.signal_id} className="border-b border-border/50">
                <td className="px-2 py-1.5">{t.symbol}</td><td className="px-2 py-1.5"><StatusBadge value={t.side} /></td>
                <td className="px-2 py-1.5">${Number(t.margin).toFixed(4)}</td><td className="px-2 py-1.5">{fmtPrice(t.entry_price)}</td><td className="px-2 py-1.5 text-long">{fmtPrice(t.target)}</td>
                <td className="px-2 py-1.5">{Number(t.liquidation_price) > 0 ? Number(t.liquidation_price).toPrecision(6) : '—'}</td>
                <td className="px-2 py-1.5">{t.mark_price === null ? '—' : fmtPrice(t.mark_price)}</td>
                <td className={cn('px-2 py-1.5', tone(t.unrealized))}>{fmtSignedUsd(t.unrealized === null ? null : Number(t.unrealized))}</td>
                <td className="px-2 py-1.5">{fmtTime(t.entry_time, tz)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </section>

      <section className="overflow-hidden border-y border-border">
        <h2 className="border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Trade history</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">{['Opened', 'Coin', 'Side', 'Pattern', 'Margin', 'Entry', 'Exit', 'Result', 'Fees', 'Funding', 'Net P&L', 'Wallet after', 'Closed'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead>
          <tbody>
            {!closed.length && <tr><td colSpan={13} className="px-3 py-8 text-center text-muted-foreground">No finished trades yet.</td></tr>}
            {closed.map((t) => <tr key={t.signal_id} className="border-b border-border/50 font-mono text-xs">
              <td className="px-3 py-2">{fmtTime(t.entry_time, tz)}</td><td className="px-3 py-2">{t.symbol}</td><td className="px-3 py-2"><StatusBadge value={t.side} /></td>
              <td className="px-3 py-2 text-muted-foreground">{t.pattern}</td><td className="px-3 py-2">${Number(t.margin).toFixed(4)}</td><td className="px-3 py-2">{fmtPrice(t.entry_price)}</td>
              <td className="px-3 py-2">{t.exit_price === null ? '—' : Number(t.exit_price).toPrecision(6)}</td>
              <td className="px-3 py-2"><StatusBadge value={t.exit_reason === 'TAKE_PROFIT' ? 'TAKE PROFIT HIT' : 'LIQUIDATED'} /></td>
              <td className="px-3 py-2 text-muted-foreground">{fmtUsd(Number(t.entry_fee) + Number(t.exit_fee ?? 0))}</td>
              <td className="px-3 py-2 text-muted-foreground">{Number(t.funding).toFixed(4)}</td>
              <td className={cn('px-3 py-2', tone(t.net))}>{fmtSignedUsd(t.net === null ? null : Number(t.net))}</td>
              <td className="px-3 py-2">{fmtUsd(t.wallet_after)}</td><td className="px-3 py-2">{fmtTime(t.exit_time, tz)}</td></tr>)}
          </tbody>
        </table></div>
      </section>

      <section className="overflow-hidden border-y border-border">
        <h2 className="border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Latest 30m signals</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">{['Signal candle', 'Coin', 'Side', 'Pattern', 'Decision'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead>
          <tbody>
            {!signals.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No signals since activation.</td></tr>}
            {signals.map((s) => <tr key={s.signal_id} className="border-b border-border/50 font-mono text-xs">
              <td className="px-3 py-2">{fmtTime(s.signal_time, tz)}</td><td className="px-3 py-2">{s.symbol}</td><td className="px-3 py-2"><StatusBadge value={s.side} /></td>
              <td className="px-3 py-2 text-muted-foreground">{s.pattern}</td>
              <td className={cn('px-3 py-2', s.decision === 'OPENED' ? 'text-long' : 'text-muted-foreground')}>{s.decision === 'OPENED' ? 'Trade opened' : REASON[s.reason ?? ''] ?? s.reason}</td></tr>)}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
