import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { ST_SETTINGS, ST_SYMBOLS } from '@/lib/engine/supertrend';
import { ST_RULES, stMarginFor } from '@/lib/engine/st-account';
import { stDuration } from '@/lib/engine/st-live';
import { fmtPrice, fmtTime } from '@/lib/data';
import { fmtSignedUsd, fmtUsd, useStBacktest, useStSimulator } from '@/lib/simulator';
import { StatusBadge } from '@/components/terminal/StatusBadge';
import { cn } from '@/lib/utils';

const tone = (n: number | null | undefined) => (Number(n) > 0 ? 'text-long' : Number(n) < 0 ? 'text-short' : 'text-muted-foreground');
const STATUS: Record<string, { label: string; tone: string }> = {
  RUNNING: { label: 'Running live', tone: 'text-long' }, CATCHING_UP: { label: 'Catching up', tone: 'text-waiting' },
  WAITING: { label: 'Waiting for market data', tone: 'text-waiting' }, ERROR: { label: 'Problem', tone: 'text-short' },
  WAITING_FOR_WORKER: { label: 'Waiting for the scanner to start', tone: 'text-waiting' },
};
const DECISION: Record<string, string> = { OPENED: 'Trade opened', REVERSED: 'Closed old trade, opened reverse', IGNORED: 'No change', CLOSED_ONLY: 'Closed old trade only' };
const REASON: Record<string, string> = { ALREADY_IN_DIRECTION: 'already in this direction', NOT_LIVE: 'scanner was catching up (not live)', LEVERAGE_UNAVAILABLE: '75x not available', INSUFFICIENT_AVAILABLE_MARGIN: 'not enough free margin' };

function Tile({ label, value, tone: t, hint }: { label: string; value: string; tone?: string | undefined; hint?: string | undefined }) {
  return <div className="border border-border bg-card/40 px-4 py-3">
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className={cn('mt-1 font-mono text-2xl font-semibold tabular-nums', t)}>{value}</div>
    {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
  </div>;
}
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** prompt-81: the active Simulator — SuperTrend 5 / hl2 / 1.6 on 30m, five dedicated coin slots, opposite-signal reversal only. */
export function StSimulator({ tz }: { tz: string }) {
  const q = useStSimulator();
  const a = q.data?.account; const trades = q.data?.trades ?? []; const signals = q.data?.signals ?? [];
  const [coinFilter, setCoinFilter] = useState<string>('ALL');
  const open = trades.filter((t) => t.status === 'OPEN'); const closed = trades.filter((t) => t.status === 'CLOSED');
  const wins = closed.filter((t) => Number(t.net) > 0).length;
  const realized = closed.reduce((s, t) => s + Number(t.net ?? 0), 0);
  const unrealized = open.reduce((s, t) => s + Number(t.unrealized ?? 0), 0);
  const usedMargin = open.reduce((s, t) => s + Number(t.margin), 0);
  const stale = a?.checked_at ? Date.now() - Date.parse(a.checked_at) > 5 * 60_000 : true;
  const st = STATUS[a?.status ?? ''] ?? { label: a?.status ?? '—', tone: 'text-muted-foreground' };
  const mainBalance = a ? Number(a.main_balance) : null;
  const available = a ? Number(a.equity) - usedMargin : null;
  const coins = a?.coins ?? [];
  const history = coinFilter === 'ALL' ? closed : closed.filter((t) => t.symbol === coinFilter);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-primary"><Wallet className="size-3" /> PRACTICE MONEY · NO REAL ORDERS</div>
          <h1 className="text-2xl font-semibold">Simulator</h1>
          <p className="mt-1 text-sm text-muted-foreground">SuperTrend {ST_SETTINGS.atrPeriod} · hl2 · {ST_SETTINGS.multiplier} · 30-minute Binance Spot signals (your TradingView chart) · trades on Binance Futures prices · each trade stays open until the opposite signal</p>
        </div>
        <div className="text-right text-sm">
          <div className={cn('font-medium', stale && a?.status === 'RUNNING' ? 'text-waiting' : st.tone)}>{!a ? 'Status unavailable' : stale && a.status === 'RUNNING' ? 'No update for 5+ minutes' : st.label}</div>
          <div className="text-[11px] text-muted-foreground">Last processed minute: {a?.last_minute ? fmtTime(new Date(a.last_minute + 60_000).toISOString(), tz) : '—'}</div>
          {a?.error && <div className="max-w-sm text-[11px] text-short">{a.error}</div>}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Main balance" value={fmtUsd(mainBalance)} hint={`Started with ${fmtUsd(ST_RULES.startingBalance)}; changes when trades close`} />
        <Tile label="Next trade margin" value={mainBalance === null ? '—' : `$${stMarginFor(mainBalance).toFixed(4)}`} hint="5% of main balance" />
        <Tile label="Margin in use" value={fmtUsd(usedMargin)} hint={`${open.length} of ${ST_RULES.slots} slots active`} />
        <Tile label="Available balance" value={fmtUsd(available)} hint="Equity minus margin in use" />
        <Tile label="Unrealized P&L" value={fmtSignedUsd(open.length ? unrealized : 0)} tone={tone(unrealized)} hint="Open trades at mark price" />
        <Tile label="Realized P&L" value={fmtSignedUsd(realized)} tone={tone(realized)} hint="After fees and funding" />
        <Tile label="Completed trades" value={String(closed.length)} hint={closed.length ? `Win rate ${(wins / closed.length * 100).toFixed(1)}% (${wins} won)` : 'Win rate —'} />
        <Tile label="Liquidation" value={a?.liquidations ? `${a.liquidations}×` : 'None'} tone={a?.liquidations ? 'text-short' : 'text-long'} hint={`Cross margin · liquidates at ${fmtUsd(a?.maintenance)} equity`} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Coin slots</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {ST_SYMBOLS.map((s, i) => {
            const t = open.find((x) => x.symbol === s); const c = coins.find((x) => x.symbol === s);
            const price = t?.mark_price ?? c?.price ?? null;
            return <div key={s} className={cn('space-y-2 border bg-card/40 p-3 font-mono text-xs', t ? (t.side === 'LONG' ? 'border-long/50' : 'border-short/50') : 'border-border')}>
              <div className="flex items-center justify-between"><span className="text-[10px] text-muted-foreground">SLOT {i + 1}</span><StatusBadge value={t ? t.side : 'WAITING'} /></div>
              <div className="text-base font-semibold">{s}</div>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">Entry</dt><dd>{t ? fmtPrice(t.entry_price) : '—'}</dd>
                <dt className="text-muted-foreground">Price</dt><dd>{price === null ? '—' : fmtPrice(price)}</dd>
                <dt className="text-muted-foreground">Margin</dt><dd>{t ? `$${Number(t.margin).toFixed(4)} · ${t.leverage}x` : '—'}</dd>
                <dt className="text-muted-foreground">Unrealized</dt><dd className={tone(t?.unrealized)}>{t ? fmtSignedUsd(t.unrealized === null ? null : Number(t.unrealized)) : '—'}</dd>
                <dt className="text-muted-foreground">Realized</dt><dd className={tone(closed.filter((x) => x.symbol === s).reduce((v, x) => v + Number(x.net ?? 0), 0))}>{fmtSignedUsd(closed.filter((x) => x.symbol === s).reduce((v, x) => v + Number(x.net ?? 0), 0))}</dd>
                <dt className="text-muted-foreground">Open for</dt><dd>{t ? stDuration(Date.now() - ms(t.entry_time)) : '—'}</dd>
                <dt className="text-muted-foreground">SuperTrend</dt><dd className={c?.trend === 'UP' ? 'text-long' : c?.trend === 'DOWN' ? 'text-short' : ''}>{c?.trend ?? '—'}{c?.line != null ? ` · ${fmtPrice(c.line)}` : ''}</dd>
                <dt className="text-muted-foreground">Last signal</dt><dd className={c?.last_signal_side === 'LONG' ? 'text-long' : c?.last_signal_side === 'SHORT' ? 'text-short' : ''}>{c?.last_signal_side ? (c.last_signal_side === 'LONG' ? 'BUY' : 'SELL') : '—'}</dd>
                <dt className="text-muted-foreground">Signal time</dt><dd>{c?.last_signal_time ? fmtTime(new Date(c.last_signal_time).toISOString(), tz) : '—'}</dd>
                <dt className="text-muted-foreground">Liq. price</dt><dd>{t && Number(t.liquidation_price) > 0 ? Number(t.liquidation_price).toPrecision(6) : '—'}</dd>
              </dl>
              {!t && <p className="text-[11px] text-muted-foreground">Waiting for this coin's next confirmed Buy/Sell.</p>}
            </div>;
          })}
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border border-border bg-card/40 p-4 text-xs sm:grid-cols-4">
        <dt className="text-muted-foreground">Signals</dt><dd>SuperTrend Buy/Sell on the confirmed 30m close only</dd>
        <dt className="text-muted-foreground">Entry</dt><dd>Next 1-minute open after the 30m close</dd>
        <dt className="text-muted-foreground">Exit</dt><dd>Only the opposite signal (then reverse in the same slot)</dd>
        <dt className="text-muted-foreground">Stop loss / take profit / time exit</dt><dd>None</dd>
        <dt className="text-muted-foreground">Size</dt><dd>{ST_RULES.marginRate * 100}% of current main balance · {ST_RULES.leverage}x cross</dd>
        <dt className="text-muted-foreground">Costs</dt><dd>{ST_RULES.feeRate * 100}% fee + {ST_RULES.slippageRate * 100}% slippage per side, real funding</dd>
        <dt className="text-muted-foreground">Liquidation</dt><dd>Whole shared wallet; Binance maintenance tiers on mark price</dd>
        <dt className="text-muted-foreground">Telegram</dt><dd>Every open, reversal, close and liquidation</dd>
      </dl>

      <section className="overflow-hidden border-y border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Trade history</h2>
          <div className="flex flex-wrap gap-1">{['ALL', ...ST_SYMBOLS].map((s) => <button key={s} type="button" onClick={() => setCoinFilter(s)} className={cn('border px-2 py-0.5 font-mono text-[10px]', coinFilter === s ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>{s.replace('USDT', '')}</button>)}</div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">{['Opened', 'Coin', 'Side', 'Margin', 'Entry', 'Exit', 'Result', 'Duration', 'Fees', 'Funding', 'Net P&L', 'Balance after', 'Closed'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead>
          <tbody>
            {q.isLoading ? <tr><td colSpan={13} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr> : q.isError ? <tr><td colSpan={13} className="px-3 py-8 text-center text-short">Could not load the Simulator.</td></tr> : !history.length && <tr><td colSpan={13} className="px-3 py-8 text-center text-muted-foreground">No finished trades yet.</td></tr>}
            {history.map((t) => <tr key={t.trade_id} className="border-b border-border/50 font-mono text-xs">
              <td className="px-3 py-2">{fmtTime(t.entry_time, tz)}</td><td className="px-3 py-2">{t.symbol}</td><td className="px-3 py-2"><StatusBadge value={t.side} /></td>
              <td className="px-3 py-2">${Number(t.margin).toFixed(4)}</td><td className="px-3 py-2">{fmtPrice(t.entry_price)}</td>
              <td className="px-3 py-2">{t.exit_price === null ? '—' : fmtPrice(t.exit_price)}</td>
              <td className="px-3 py-2">{t.exit_reason === 'LIQUIDATED' ? <StatusBadge value="LIQUIDATED" /> : <span className="text-muted-foreground">Opposite signal{t.closed_mode === 'recovery' ? ' (catch-up)' : ''}</span>}</td>
              <td className="px-3 py-2">{t.exit_time ? stDuration(ms(t.exit_time) - ms(t.entry_time)) : '—'}</td>
              <td className="px-3 py-2 text-muted-foreground">{fmtUsd(Number(t.entry_fee) + Number(t.exit_fee ?? 0))}</td>
              <td className="px-3 py-2 text-muted-foreground">{Number(t.funding).toFixed(4)}</td>
              <td className={cn('px-3 py-2', tone(t.net))}>{fmtSignedUsd(t.net === null ? null : Number(t.net))}</td>
              <td className="px-3 py-2">{fmtUsd(t.main_after)}</td><td className="px-3 py-2">{fmtTime(t.exit_time, tz)}</td></tr>)}
          </tbody>
        </table></div>
      </section>

      <section className="overflow-hidden border-y border-border">
        <h2 className="border-b border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground">Latest SuperTrend signals</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">{['Signal candle', 'Coin', 'Signal', 'What happened'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead>
          <tbody>
            {!signals.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No signals since activation.</td></tr>}
            {signals.map((s) => <tr key={s.signal_id} className="border-b border-border/50 font-mono text-xs">
              <td className="px-3 py-2">{fmtTime(s.signal_time, tz)}</td><td className="px-3 py-2">{s.symbol}</td><td className={cn('px-3 py-2', s.side === 'LONG' ? 'text-long' : 'text-short')}>{s.side === 'LONG' ? 'BUY' : 'SELL'}</td>
              <td className="px-3 py-2">{DECISION[s.decision] ?? s.decision}{s.reason ? ` — ${REASON[s.reason] ?? s.reason}` : ''}</td></tr>)}
          </tbody>
        </table></div>
      </section>

      <StBacktest tz={tz} />
    </div>
  );
}

function StBacktest({ tz }: { tz: string }) {
  const q = useStBacktest(); const r = q.data;
  const [showAll, setShowAll] = useState(false);
  if (!r) return null;
  const s = r.summary;
  const list = showAll ? r.trades : r.trades.slice(-20);
  return <section className="space-y-3 border border-border bg-card/20 p-4">
    <h2 className="text-xs uppercase tracking-widest text-muted-foreground">7-day historical backtest · {fmtTime(r.window.start, tz)} → {fmtTime(r.window.end, tz)} · not live trades</h2>
    <p className="text-xs text-muted-foreground">Same rules and calculations on saved Binance data: Spot 30-minute candles for signals; Futures 1-minute prices, mark prices and real funding for trades. {r.missingData.length ? `Missing data: ${r.missingData.join('; ')}` : 'No missing data.'}</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Final main balance" value={fmtUsd(s.finalMainBalance)} hint={`From ${fmtUsd(s.startingBalance)} · equity ${fmtUsd(s.finalEquity)}`} />
      <Tile label="Net realized" value={fmtSignedUsd(s.netRealized)} tone={tone(s.netRealized)} hint={`Profit ${fmtUsd(s.realizedProfit)} · loss ${fmtSignedUsd(s.realizedLoss)}`} />
      <Tile label="Win rate" value={s.winRate === null ? '—' : `${(s.winRate * 100).toFixed(1)}%`} hint={`${s.wins} won · ${s.losses} lost of ${s.completed}`} />
      <Tile label="Max drawdown" value={`${(s.maxDrawdownPct * 100).toFixed(1)}%`} tone="text-short" hint={`${fmtUsd(s.maxDrawdownUsd)} · ${s.liquidations} liquidations`} />
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] font-mono text-xs">
      <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">{['Coin', 'Buy', 'Sell', 'Completed', 'Won', 'Lost', 'Net', 'Open at end', 'Unrealized'].map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
      <tbody>{r.perCoin.map((c) => <tr key={c.symbol} className="border-b border-border/50"><td className="px-2 py-1.5">{c.symbol}</td><td className="px-2 py-1.5">{c.buy}</td><td className="px-2 py-1.5">{c.sell}</td><td className="px-2 py-1.5">{c.completed}</td><td className="px-2 py-1.5">{c.wins}</td><td className="px-2 py-1.5">{c.losses}</td>
        <td className={cn('px-2 py-1.5', tone(c.net))}>{fmtSignedUsd(c.net)}</td><td className="px-2 py-1.5">{c.open}</td><td className={cn('px-2 py-1.5', tone(c.unrealized))}>{fmtSignedUsd(c.unrealized)}</td></tr>)}</tbody>
    </table></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[900px] font-mono text-xs">
      <thead className="text-[10px] uppercase tracking-widest text-muted-foreground"><tr className="border-b border-border">{['Opened', 'Coin', 'Side', 'Entry', 'Exit', 'Margin', 'Duration', 'Net', 'Balance after'].map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
      <tbody>{list.map((t) => <tr key={t.id} className="border-b border-border/50"><td className="px-2 py-1.5">{fmtTime(t.entryTime, tz)}</td><td className="px-2 py-1.5">{t.symbol}</td><td className="px-2 py-1.5"><StatusBadge value={t.side} /></td>
        <td className="px-2 py-1.5">{fmtPrice(t.entry)}</td><td className="px-2 py-1.5">{fmtPrice(t.exit)}</td><td className="px-2 py-1.5">${t.margin.toFixed(4)}</td><td className="px-2 py-1.5">{stDuration(t.durationMs)}</td>
        <td className={cn('px-2 py-1.5', tone(t.net))}>{fmtSignedUsd(t.net)}</td><td className="px-2 py-1.5">{fmtUsd(t.mainAfter)}</td></tr>)}</tbody>
    </table></div>
    {r.trades.length > 20 && <button type="button" className="text-xs text-primary" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show latest 20' : `Show all ${r.trades.length} completed trades`}</button>}
    {r.open.length > 0 && <p className="text-xs text-muted-foreground">Still open at the end (not closed artificially): {r.open.map((o) => `${o.symbol} ${o.side} @ ${fmtPrice(o.entry)} (${fmtSignedUsd(o.unrealized)})`).join(' · ')}</p>}
  </section>;
}
