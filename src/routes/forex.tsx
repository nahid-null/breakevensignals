import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Clock, Play, Square } from 'lucide-react';
import { readForexBacktest, type FxTrade } from '@/lib/forex.functions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const FxChart = lazy(() => import('@/components/forex/FxChart'));
const backtestQuery = queryOptions({ queryKey: ['forex-backtest-80-ai'], queryFn: () => readForexBacktest(), staleTime: Infinity });

export const Route = createFileRoute('/forex')({
  head: () => ({
    meta: [
      { title: 'AI Forex Simulator AUD/JPY — 7-Day Price-Action Results' },
      { name: 'description', content: 'AUD/JPY AI price-action backtest without indicators: $1 trades, 1-minute expiry, 23% profit fee and seven-day results.' },
      { property: 'og:title', content: 'AI Forex Simulator AUD/JPY — 7-Day Price-Action Results' },
      { property: 'og:description', content: 'Real AI LONG, SHORT and SKIP decisions from historical raw candles, with daily results and trade reasons.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(backtestQuery),
  component: ForexSimulator,
});

const usd = (n: number) => `$${n.toFixed(2)}`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`;
const tone = (n: number) => (n > 0 ? 'text-long' : n < 0 ? 'text-short' : 'text-muted-foreground');
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const when = (iso: string) => iso.slice(5, 16).replace('T', ' ');
const RESULT_TONE: Record<FxTrade['result'], string> = {
  WIN: 'border-long/40 bg-long/15 text-long', LOSS: 'border-short/40 bg-short/15 text-short', DRAW: 'border-waiting/40 bg-waiting/15 text-waiting',
  SKIPPED: 'border-border bg-muted/30 text-muted-foreground', VOID: 'border-border bg-muted/30 text-muted-foreground',
};

function Tile({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-mono text-lg tabular-nums', className)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
function ResultPill({ r }: { r: FxTrade['result'] }) {
  return <span className={cn('inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold', RESULT_TONE[r])}>{r}</span>;
}
function SidePill({ side }: { side: FxTrade['side'] }) {
  return side === 'LONG'
    ? <span className="inline-flex items-center gap-1 font-mono text-xs text-long"><ArrowUp className="h-3 w-3" />LONG</span>
    : <span className="inline-flex items-center gap-1 font-mono text-xs text-short"><ArrowDown className="h-3 w-3" />SHORT</span>;
}

/** Replays a historical trade's 1-minute expiry as a countdown, then reveals the recorded result. */
function ExpiryReplay({ trade }: { trade: FxTrade }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => { setLeft(null); }, [trade.n]);
  useEffect(() => {
    if (left == null || left <= 0) return;
    const id = setTimeout(() => setLeft((s) => (s == null ? s : s - 1)), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const done = left === 0;
  const shown = left == null ? 60 : left;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Trade #{trade.n} · replay</div>
        <SidePill side={trade.side} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><div className="text-[10px] uppercase text-muted-foreground">Entry price</div><div className="font-mono">{trade.entry.toFixed(3)}</div></div>
        <div><div className="text-[10px] uppercase text-muted-foreground">Investment</div><div className="font-mono">$1.00</div></div>
        <div><div className="text-[10px] uppercase text-muted-foreground">Entry (UTC)</div><div className="font-mono">{when(trade.entry_time)}</div></div>
        <div><div className="text-[10px] uppercase text-muted-foreground">Expiry price</div><div className="font-mono">{done || left == null ? (trade.expiry?.toFixed(3) ?? '—') : '…'}</div></div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Clock className="h-4 w-4 text-active" />
        <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
          <div className="h-full bg-active transition-all duration-1000 ease-linear" style={{ width: `${((60 - shown) / 60) * 100}%` }} />
        </div>
        <span className="w-12 text-right font-mono text-sm tabular-nums">0:{String(shown).padStart(2, '0')}</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {left != null && left > 0
          ? <Button variant="outline" size="sm" onClick={() => setLeft(0)}><Square className="h-3 w-3" /> Skip to expiry</Button>
          : <Button variant="outline" size="sm" onClick={() => setLeft(60)}><Play className="h-3 w-3" /> Replay 1-minute expiry</Button>}
        {(done || left == null) && <div className="flex items-center gap-2"><ResultPill r={trade.result} /><span className={cn('font-mono text-sm', tone(trade.net))}>{signed(trade.net)}</span></div>}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">AI confidence: {trade.confidence ?? 0}% · {trade.reason}{trade.result === 'SKIPPED' && trade.would_have ? ` · not traded (balance below $1); would have been ${trade.would_have}` : ''}</p>
    </div>
  );
}

function ForexSimulator() {
  const { data } = useSuspenseQuery(backtestQuery);
  const { overall: o, days, trades, meta } = data;
  const [day, setDay] = useState<string>('ALL');
  const [sel, setSel] = useState<number | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'TRADED' | 'SKIPPED'>('ALL');
  const range = useMemo<[number, number]>(() => {
    if (day === 'ALL') return [Date.parse(meta.window_utc[0]) / 1000, Date.parse(meta.window_utc[1]) / 1000];
    const s = Date.parse(`${day}T00:00:00Z`) / 1000; return [s, s + 86400];
  }, [day, meta.window_utc]);
  const selected = trades.find((t) => t.n === sel) ?? trades.find((t) => t.result !== 'SKIPPED' && t.result !== 'VOID') ?? null;
  const rows = trades.filter((t) => (day === 'ALL' || t.entry_time.startsWith(day)) && (filter === 'ALL' || (filter === 'SKIPPED' ? t.result === 'SKIPPED' || t.result === 'VOID' : t.result !== 'SKIPPED' && t.result !== 'VOID')));
  const info = data.info_all_signals;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AI Forex Simulator · AUD/JPY</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI price-action decisions · no indicators · $1 per trade · 1-minute expiry.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-mono">
          <span className="rounded border border-waiting/40 bg-waiting/10 px-2 py-1 text-waiting">HISTORICAL BACKTEST · {meta.window_utc[0].slice(0, 10)} → {days.at(-1)?.date}</span>
          <span className="rounded border border-border px-2 py-1 text-muted-foreground">LIVE TRADING: NOT STARTED</span>
        </div>
      </div>

      <div className="border-l-2 border-short pl-3 text-sm">
        <p className="font-semibold text-short">Not profitable in this test: 37.9% wins · −$9.53 net · $10 → $0.47</p>
        <p className="mt-1 text-muted-foreground">230 AI reviews every 30 minutes; 166 passes, 64 trade calls, 29 funded trades. Historical simulation only; live Forex requires a reliable free price feed. AI response time and usage costs are not included.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Tile label="Starting balance" value={usd(o.start_balance)} />
        <Tile label="Current balance" value={usd(o.final_balance)} className={tone(o.final_balance - o.start_balance)} sub={o.final_balance < 1 ? 'Below $1 — trading stopped' : undefined} />
        <Tile label="Investment" value="$1.00" sub="Fixed, never compounds" />
        <Tile label="Expiry" value="1 min" sub="Signals on M3" />
        <Tile label="Total trades" value={o.total} sub={`${o.long_trades} long · ${o.short_trades} short`} />
        <Tile label="Win rate" value={pct(o.win_rate)} sub="Draws excluded" className={o.win_rate != null && o.win_rate >= 56.5 ? 'text-long' : 'text-short'} />
        <Tile label="Wins / Losses" value={<><span className="text-long">{o.wins}</span> / <span className="text-short">{o.losses}</span></>} sub={`${o.draws} draws`} />
        <Tile label="Net profit / loss" value={signed(o.net)} className={tone(o.net)} sub={`Fees ${usd(o.fees)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-border bg-card p-2">
          <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
            <span className="mr-2 font-mono text-xs text-muted-foreground">AUD/JPY · M3</span>
            {['ALL', ...days.map((d) => d.date)].map((d) => (
              <Button key={d} variant="ghost" size="sm" onClick={() => { setDay(d); setSel(null); }}
                className={cn('rounded px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-accent', day === d && 'bg-accent text-foreground')}>
                {d === 'ALL' ? '7 days' : d.slice(5)}
              </Button>
            ))}
          </div>
          <ClientOnly fallback={<div className="h-[340px] sm:h-[440px]" />}>
            <Suspense fallback={<div className="h-[340px] sm:h-[440px]" />}>
              <FxChart bars={data.chart} ema={data.ema} trades={trades} range={range} focus={sel != null ? selected : null} />
            </Suspense>
          </ClientOnly>
          <div className="flex flex-wrap gap-3 px-2 pt-2 text-[11px] text-muted-foreground">
            <span className="text-long">▲ LONG entry</span><span className="text-short">▼ SHORT entry</span>
            <span className="text-long">● WIN</span><span className="text-short">■ LOSS</span><span className="text-waiting">■ DRAW</span><span>■ SKIP (balance below $1)</span>
          </div>
        </div>
        {selected ? <ExpiryReplay trade={selected} /> : <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No trades.</div>}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Daily report</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>{['Date', 'Trades', 'Long', 'Short', 'Wins', 'Losses', 'Draws', 'Win rate', 'Gross profit', 'Fees', 'Net P/L', 'Start', 'End', 'Not traded'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="font-mono">
              {days.map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="px-3 py-2">{d.date}{!d.market_open && <span className="ml-2 font-sans text-[11px] text-muted-foreground">market closed</span>}</td>
                  <td className="px-3 py-2">{d.total}</td><td className="px-3 py-2 text-long">{d.long}</td><td className="px-3 py-2 text-short">{d.short}</td>
                  <td className="px-3 py-2 text-long">{d.wins}</td><td className="px-3 py-2 text-short">{d.losses}</td><td className="px-3 py-2 text-waiting">{d.draws}</td>
                  <td className="px-3 py-2">{pct(d.win_rate)}</td><td className="px-3 py-2">{usd(d.gross_profit)}</td><td className="px-3 py-2">{usd(d.fees)}</td>
                  <td className={cn('px-3 py-2', tone(d.net))}>{signed(d.net)}</td><td className="px-3 py-2">{usd(d.start_balance)}</td><td className="px-3 py-2">{usd(d.end_balance)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.skipped + d.voided || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7-day summary</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Tile label="Total trades" value={o.total} /><Tile label="Wins" value={o.wins} className="text-long" /><Tile label="Losses" value={o.losses} className="text-short" />
          <Tile label="Draws" value={o.draws} className="text-waiting" /><Tile label="Win rate" value={pct(o.win_rate)} sub="Break-even ≈ 56.5%" />
          <Tile label="LONG win rate" value={pct(o.long_win_rate)} /><Tile label="SHORT win rate" value={pct(o.short_win_rate)} />
          <Tile label="Gross profit" value={usd(o.gross_profit)} /><Tile label="Fees deducted" value={usd(o.fees)} />
          <Tile label="Net P/L" value={signed(o.net)} className={tone(o.net)} /><Tile label="Final balance" value={usd(o.final_balance)} />
          <Tile label="Max wins in a row" value={o.max_consecutive_wins} /><Tile label="Max losses in a row" value={o.max_consecutive_losses} />
          <Tile label="Best day" value={o.best_day ?? '—'} /><Tile label="Worst day" value={o.worst_day ?? '—'} />
        </div>
        <p className="text-xs text-muted-foreground">
          {o.skipped} later AI trade calls could not be funded because the balance was below $1. Hypothetically, all {info.signals} calls scored {info.wins} wins, {info.losses} losses and {info.draws} draws; these are not funded trades.
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Trade history</h2>
          <div className="flex gap-1">
            {(['ALL', 'TRADED', 'SKIPPED'] as const).map((f) => (
              <Button key={f} variant="ghost" size="sm" onClick={() => setFilter(f)} className={cn('text-xs text-muted-foreground', filter === f && 'bg-accent text-foreground')}>
                {f === 'ALL' ? 'All AI calls' : f === 'TRADED' ? 'Traded' : 'Not traded'}
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>{['Trade', 'Date/Time (UTC)', 'Direction', 'Entry price', 'Expiry price', 'Investment', 'Result', 'Net P/L', 'Balance'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((t) => (
                <tr key={t.n} onClick={() => setSel(t.n)} className={cn('cursor-pointer border-t border-border hover:bg-accent/40', selected?.n === t.n && sel != null && 'bg-accent/50')}>
                  <td className="px-3 py-2">#{t.n}</td><td className="px-3 py-2">{when(t.entry_time)}</td><td className="px-3 py-2"><SidePill side={t.side} /></td>
                  <td className="px-3 py-2">{t.entry.toFixed(3)}</td><td className="px-3 py-2">{t.expiry?.toFixed(3) ?? '—'}</td>
                  <td className="px-3 py-2">{t.result === 'SKIPPED' || t.result === 'VOID' ? '—' : '$1.00'}</td>
                  <td className="px-3 py-2"><ResultPill r={t.result} />{t.would_have && <span className="ml-1 font-sans text-[10px] text-muted-foreground">would be {t.would_have}</span>}</td>
                  <td className={cn('px-3 py-2', tone(t.net))}>{t.result === 'SKIPPED' || t.result === 'VOID' ? '—' : signed(t.net)}</td>
                  <td className="px-3 py-2">{usd(t.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-1 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground">How this test was run</div>
        <p>{meta.indicator}. {meta.method}</p>
        <p>Price data: {meta.data_source}, downloaded {meta.downloaded_at.slice(0, 16).replace('T', ' ')} UTC. The earlier CPES indicator report remains archived separately and was not used for AI decisions.</p>
        <p>This retrospective test provides only past candles, but cannot rule out prior model knowledge of historical prices. Immediate candle-close entry ignores AI response latency, and one week does not establish future performance. Sunday reopening and some final-minute quotes are missing.</p>
        <ul className="list-disc space-y-0.5 pl-4">{meta.disclosures.map((d) => <li key={d}>{d}</li>)}</ul>
      </section>
    </div>
  );
}
