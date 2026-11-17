import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { Direction } from '@/lib/config';
import { SYMBOLS } from '@/lib/config';
import { TIMEFRAMES, tfMs, type TimeframeId } from '@/lib/chart/timeframes';
import { fetchLatest, fetchRange, fetchTickSize } from '@/lib/chart/binance-feed';
import { runPineSeries } from '@/lib/chart/pine-series';
import { nativeRows, verificationPine } from '@/lib/parity/fields';
import { compareParity, type ParityReport } from '@/lib/parity/compare';
import { parseTradingViewCsv } from '@/lib/parity/tradingview-csv';
import type { ParityValue } from '@/lib/engine/parity';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TITLE = 'Pine Parity Report — Crypto Signal Terminal';
const DESC = 'Candle-by-candle comparison of the internal Pine engine against the original Pine scripts and your TradingView exports, with first mismatch and reason.';
export const Route = createFileRoute('/parity')({
  head: () => ({ meta: [{ title: TITLE }, { name: 'description', content: DESC }, { property: 'og:title', content: TITLE }, { property: 'og:description', content: DESC },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] }),
  component: ParityPage,
});

type Run = { title: string; reference: string; symbol: string; tf: string; first: number; last: number; direction: Direction; report: ParityReport; candleCheck?: { compared: number; identical: number; firstDiff: number | null }; note?: string };
const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const fmt = (v: ParityValue | undefined) => v === undefined ? 'missing' : v === null ? 'na' : typeof v === 'boolean' ? (v ? 'true' : 'false') : Number(v.toPrecision(10)).toString();
const PINE_COINS = SYMBOLS.filter((s) => s !== 'WILDUSDT');

function ParityPage() {
  const [symbol, setSymbol] = useState<string>('NEARUSDT'); const [tf, setTf] = useState<TimeframeId>('1m'); const [count, setCount] = useState(1500);
  const [direction, setDirection] = useState<Direction>('LONG'); const [corrected, setCorrected] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [runs, setRuns] = useState<Run[]>([]);

  async function runLocal() {
    setBusy('Loading Binance candles…'); setError(null);
    try {
      const [tick, candles] = await Promise.all([fetchTickSize(symbol), fetchLatest(symbol, tf, count)]);
      setBusy(`Running the original ${direction} Pine source in the PineTS interpreter (${candles.length} candles)…`);
      const { runPineReference } = await import('@/lib/parity/pine-reference');
      const reference = await runPineReference(candles, symbol, tick, direction, tfMs(tf), corrected);
      const native = nativeRows(runPineSeries(candles, tick), direction);
      setRuns((r) => [{ title: `${symbol} ${tf} ${direction}: internal engine vs PineTS`, reference: corrected ? 'PineTS 0.13.1 + documented interpreter corrections' : 'PineTS 0.13.1 as shipped (uncorrected)',
        symbol, tf, first: candles[0]!.time, last: candles.at(-1)!.time, direction, report: compareParity(native, reference) }, ...r]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Comparison failed'); } finally { setBusy(null); }
  }

  async function runTradingView(file: File) {
    setBusy('Reading TradingView export…'); setError(null);
    try {
      const tv = parseTradingViewCsv(await file.text());
      const dir = tv.direction ?? direction; const step = tv.intervalMs;
      const tfDef = TIMEFRAMES.find((t) => t.ms === step);
      if (!tfDef) throw new Error('Could not recognise the export timeframe. Export a 1, 3, 5, 15, 60 or 240 minute chart.');
      if (!Object.keys(tv.mapped).length) throw new Error('No indicator columns found. Add the original indicator (or the verification script) before exporting.');
      setBusy(`Loading the same ${tv.candles.length} Binance candles and running the internal engine…`);
      const first = tv.candles[0]!.time; const last = tv.candles.at(-1)!.time;
      const [tick, candles] = await Promise.all([fetchTickSize(symbol), fetchRange(symbol, tfDef.id, first, last + step!)]);
      const byTime = new Map(tv.candles.map((c) => [c.time, c]));
      let identical = 0; let firstDiff: number | null = null;
      for (const c of candles) { const t = byTime.get(c.time); const same = !!t && t.open === c.open && t.high === c.high && t.low === c.low && t.close === c.close;
        if (same) identical++; else if (firstDiff === null) firstDiff = c.time; }
      const native = nativeRows(runPineSeries(candles, tick), dir);
      const report = compareParity(native, tv.rows, 1e-6, Object.keys(tv.mapped));
      setRuns((r) => [{ title: `${symbol} ${tfDef.id} ${dir}: internal engine vs TradingView export`, reference: `TradingView export "${file.name}" (columns: ${Object.values(tv.mapped).join(', ')})`,
        symbol, tf: tfDef.id, first, last, direction: dir, report, candleCheck: { compared: candles.length, identical, firstDiff },
        note: tv.hasVolume ? undefined : 'The export has no Volume column, so volume-based fields could not be cross-checked.' }, ...r]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not compare the export'); } finally { setBusy(null); }
  }

  async function download(d: Direction) {
    const { ORIGINAL_PINE } = await import('@/lib/parity/pine-reference');
    const blob = new Blob([verificationPine(ORIGINAL_PINE[d], d)], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `parity-${d.toLowerCase()}-verification.pine`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <div className="mb-1 font-mono text-[10px] text-active">VERIFY · PINE PARITY</div>
        <h1 className="text-2xl font-semibold">Pine parity report</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Compares every candle of the internal engine (the code the live Pine signals use, also drawn on the <Link to="/chart" className="underline">Chart</Link>) with a reference run on the identical candles, settings and start bar. Mismatches are listed, never hidden.</p>
      </div>

      <div className="border border-waiting/40 bg-waiting/5 p-3 text-sm">
        <p className="font-semibold text-waiting">TradingView status: not certified yet</p>
        <p className="mt-1 text-muted-foreground">TradingView's own Pine engine cannot run here. The PineTS comparison is an independent interpreter of your intact original scripts, not TradingView. A TradingView result exists only after you upload a TradingView export below.</p>
      </div>

      <section className="space-y-3 border border-border bg-card/40 p-4">
        <h2 className="font-semibold">1 · Original scripts vs internal engine (PineTS interpreter)</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select aria-label="Coin" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-9 border border-border bg-card px-2 font-mono">{PINE_COINS.map((s) => <option key={s}>{s}</option>)}</select>
          <select aria-label="Timeframe" value={tf} onChange={(e) => setTf(e.target.value as TimeframeId)} className="h-9 border border-border bg-card px-2 font-mono">{TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <select aria-label="Candles" value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-9 border border-border bg-card px-2 font-mono">{[500, 1000, 1500].map((n) => <option key={n} value={n}>{n} candles</option>)}</select>
          <select aria-label="Script" value={direction} onChange={(e) => setDirection(e.target.value as Direction)} className="h-9 border border-border bg-card px-2 font-mono"><option>LONG</option><option>SHORT</option></select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={corrected} onChange={(e) => setCorrected(e.target.checked)} /> Interpreter corrections</label>
          <Button size="sm" onClick={runLocal} disabled={!!busy}>Run comparison</Button>
        </div>
        <p className="text-xs text-muted-foreground">Corrections fix where PineTS differs from Pine's documented behaviour (EMA first value, 9-digit comparisons, unrounded storage, extrema history). Untick to see the raw interpreter disagree.</p>
      </section>

      <section className="space-y-3 border border-border bg-card/40 p-4">
        <h2 className="font-semibold">2 · TradingView export vs internal engine</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Download the verification script: your original source, unchanged, plus data-window plots of every compared value. <span className="whitespace-nowrap">
            <Button size="sm" variant="outline" className="ml-1 h-7" onClick={() => void download('LONG')}><Download className="mr-1 h-3.5 w-3.5" />LONG</Button>
            <Button size="sm" variant="outline" className="ml-1 h-7" onClick={() => void download('SHORT')}><Download className="mr-1 h-3.5 w-3.5" />SHORT</Button></span></li>
          <li>In TradingView open <span className="font-mono">BINANCE:{symbol}.P</span> on the same timeframe, add the script with default inputs.</li>
          <li>Chart menu → Export chart data (UNIX time). Upload the file here. The coin selected above is used to load the matching Binance candles.</li>
        </ol>
        <label className={cn('inline-flex cursor-pointer items-center gap-2 border border-border px-3 py-2 text-sm', busy && 'pointer-events-none opacity-50')}>
          <Upload className="h-4 w-4" /> Upload TradingView CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void runTradingView(f); e.target.value = ''; }} />
        </label>
        <p className="text-xs text-muted-foreground">Exporting only the original indicator still works: its EMA 9/21/200, signal, stop and take-profit plots are compared. RSI, MACD and break-even need the verification script, because the original does not plot them.</p>
      </section>

      {busy && <p className="text-sm text-active">{busy}</p>}
      {error && <p className="text-sm text-short">{error}</p>}
      {runs.map((r, i) => <ReportView key={i} run={r} />)}

      <section className="border border-border bg-card/40 p-4 text-sm">
        <h2 className="mb-2 font-semibold">Pine features in your scripts and how they are handled</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li><b className="text-foreground">Implemented exactly:</b> ta.ema, ta.rsi (Wilder), ta.macd, ta.atr (Wilder), ta.sma, ta.highest/lowest with [1] history, ta.pivotlow/pivothigh, persistent <span className="font-mono">var</span> trade state, 5-bar cooldown, stop-before-target, break-even after exits.</li>
          <li><b className="text-foreground">Candle close only:</b> entries and trade management run on <span className="font-mono">barstate.isconfirmed</span> bars; the forming candle is never used.</li>
          <li><b className="text-foreground">No repainting from the originals:</b> they use no request.security or lookahead. The separate live 15M/5M/1M trend filter reads only completed higher-timeframe bars.</li>
          <li><b className="text-foreground">Not reproduced as Pine objects:</b> label/line/table drawings and alert()/alertcondition. The chart draws equivalents; events are stored and sent by Telegram instead.</li>
          <li><b className="text-foreground">Inputs:</b> default values only (as uploaded); changing inputs in TradingView will break parity.</li>
          <li><b className="text-foreground">Unverified against TradingView:</b> how TradingView's built-in ta.ema seeds its first value. The engine follows Pine's documented formula (first value = source). Averages started on different bars disagree until they converge.</li>
        </ul>
      </section>
    </div>
  );
}

function ReportView({ run }: { run: Run }) {
  const r = run.report;
  return (
    <section className="min-w-0 space-y-3 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{run.title}</h2>
        <span className={cn('border px-2 py-0.5 font-mono text-xs font-semibold', r.matches ? 'border-long/50 text-long' : 'border-short/50 text-short')}>{r.matches ? 'PARITY PASSED' : 'MISMATCH FOUND'}</span>
      </div>
      <p className="text-xs text-muted-foreground">Reference: {run.reference} · {r.bars} candles {iso(run.first)} → {iso(run.last)} UTC · first mismatching candle: {r.firstMismatch ? `${iso(r.firstMismatch.time)} (${r.firstMismatch.field})` : 'none'}</p>
      {run.candleCheck && <p className={cn('text-xs', run.candleCheck.identical === run.candleCheck.compared ? 'text-long' : 'text-short')}>Candles: {run.candleCheck.identical}/{run.candleCheck.compared} identical OHLC between Binance and the export{run.candleCheck.firstDiff !== null ? `; first difference ${iso(run.candleCheck.firstDiff)}` : ''}.</p>}
      {run.note && <p className="text-xs text-waiting">{run.note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">Value</th><th className="pr-2">Matching</th><th className="pr-2">First mismatch</th><th className="pr-2">Reference</th><th className="pr-2">Internal</th><th className="pr-2">Difference</th><th>Reason</th></tr></thead>
          <tbody>{r.fields.map((f) => <tr key={f.field} className="border-t border-border align-top">
            <td className="py-1.5 pr-2">{f.label}</td>
            <td className={cn('pr-2 font-mono', f.pct === 100 ? 'text-long' : 'text-short')}>{f.pct.toFixed(2)}%</td>
            <td className="pr-2 font-mono">{f.first ? iso(f.first.time) : '—'}</td>
            <td className="pr-2 font-mono">{f.first ? fmt(f.first.reference) : '—'}</td>
            <td className="pr-2 font-mono">{f.first ? fmt(f.first.native) : '—'}</td>
            <td className="pr-2 font-mono">{f.first?.diff !== null && f.first?.diff !== undefined ? Number(f.first.diff.toPrecision(4)).toString() : '—'}</td>
            <td className="text-muted-foreground">{f.reason ?? ''}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
