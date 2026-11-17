import { createFileRoute, Link, ClientOnly } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { z } from 'zod';
import type { Candle } from '@/lib/engine/model';
import { CHART_SYMBOLS, PINE_SYMBOLS, ROBOT_SET, TIMEFRAMES, barOpen, isTimeframe, tfMs, type TimeframeId } from '@/lib/chart/timeframes';
import { fetchKlines, fetchLatest, fetchRange, fetchTickSize, gaps, subscribeKlines, type FeedStatus } from '@/lib/chart/binance-feed';
import { pineAt, runPineSeries, type PineTrade } from '@/lib/chart/pine-series';
import { analyzeSmc, smcAt } from '@/lib/chart/smc-overlay';
import { buildOverlay, DEFAULT_OVERLAYS, type Overlays, type Palette, type RobotTradeView } from '@/lib/chart/chart-model';
import { decisionBarTime, robotStage, stageEvents, STAGE_LABEL, type RobotDecisionRow } from '@/lib/chart/robot-overlay';
import { pineBreakeven, robotBreakeven } from '@/lib/chart/breakeven';
import { readRobotDecisionsFor, readSignalEventsFor } from '@/lib/dashboard.functions';
import { useRobotMarkets, useRobotPositions, useRobotSettings } from '@/lib/robot/data';
import { useMarkets } from '@/lib/data';
import { readPalette } from '@/components/chart/palette';
import { BreakevenTable, ComparisonList, PineConditions, type Check } from '@/components/chart/Panels';
import { px } from '@/components/robot/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const TradingChart = lazy(() => import('@/components/chart/TradingChart'));
const TITLE = 'Chart & Robot Verification — Crypto Signal Terminal';
const DESC = 'Live Binance futures candles with your Pine indicator, Smart Money structure and the Paper Robot\'s real trades and decisions on one chart, plus bar replay.';
const search = z.object({ symbol: z.string().optional().catch(undefined), tf: z.string().optional().catch(undefined) });

export const Route = createFileRoute('/chart')({
  validateSearch: (s) => search.parse(s),
  head: () => ({ meta: [{ title: TITLE }, { name: 'description', content: DESC }, { property: 'og:title', content: TITLE }, { property: 'og:description', content: DESC },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] }),
  component: ChartPage,
});

const WARMUP = 600; const AFTER = 900; const LIVE_BARS = 1200; const MIN = 60_000;
const OVERLAY_LABELS: [keyof Overlays, string][] = [['ema', 'EMAs'], ['pineSignals', 'Pine signals'], ['pineLevels', 'Pine SL/TP/BE'], ['liquidity', 'Liquidity & EQH/EQL'],
  ['structure', 'BOS / MSS / CHoCH'], ['fvg', 'FVG'], ['ob', 'Order blocks'], ['premium', 'Premium / discount'], ['ote', 'OTE'], ['robotTrades', 'Robot trades'], ['robotStages', 'Robot sweep/MSS stages']];
const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const decimals = (tick: number) => Math.max(0, Math.min(8, Math.round(-Math.log10(tick))));

function ChartPage() {
  const s = Route.useSearch(); const nav = Route.useNavigate();
  const symbol = s.symbol && CHART_SYMBOLS.includes(s.symbol) ? s.symbol : 'NEARUSDT';
  const tf: TimeframeId = s.tf && isTimeframe(s.tf) ? s.tf : '1m'; const ms = tfMs(tf);
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [replayAt, setReplayAt] = useState(''); const [replayKey, setReplayKey] = useState(0);
  const [data, setData] = useState<{ bars: Candle[]; tick: number; key: string } | null>(null);
  const [forming, setForming] = useState<Candle | null>(null);
  const [error, setError] = useState<string | null>(null); const [feed, setFeed] = useState<FeedStatus | 'rest'>('connecting');
  const [cursor, setCursor] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(4);
  const [restCheck, setRestCheck] = useState<{ time: number; ok: boolean; detail: string } | null>(null);
  const [show, setShow] = useState<Overlays>(DEFAULT_OVERLAYS); const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null); const [palette, setPalette] = useState<Palette | null>(null);

  useEffect(() => { setPalette(readPalette()); setReplayAt(new Date(Date.now() - 86_400_000).toISOString().slice(0, 16)); }, []);

  // Live: latest closed bars + kline stream; each closed stream bar is re-checked against REST.
  useEffect(() => {
    if (mode !== 'live') return;
    let stop = () => {}; let cancelled = false; const ac = new AbortController();
    setData(null); setForming(null); setError(null); setRestCheck(null); setSelected(null);
    (async () => {
      try {
        const [tick, bars] = await Promise.all([fetchTickSize(symbol, ac.signal), fetchLatest(symbol, tf, LIVE_BARS, undefined, ac.signal)]);
        if (cancelled) return;
        setData({ bars, tick, key: `${symbol}-${tf}-live` });
        stop = subscribeKlines(symbol, tf, (c, closed) => {
          if (!closed) { setForming(c); return; }
          setForming(null);
          setData((d) => {
            if (!d || c.time <= d.bars.at(-1)!.time) return d;
            if (c.time - d.bars.at(-1)!.time !== ms) { void fetchLatest(symbol, tf, LIVE_BARS).then((b) => setData({ ...d, bars: b })); return d; }
            return { ...d, bars: [...d.bars, c].slice(-LIVE_BARS - 200) };
          });
          setTimeout(() => { void fetchKlines(symbol, tf, { startTime: c.time, limit: 1 }).then(([r]) => {
            if (!r || r.time !== c.time) return;
            const diff = (['open', 'high', 'low', 'close', 'volume'] as const).filter((k) => Math.abs(r[k] - c[k]) > 1e-12 * Math.max(1, Math.abs(r[k])));
            setRestCheck({ time: c.time, ok: diff.length === 0, detail: diff.length ? `Stream and REST differ on ${diff.join(', ')}; REST value used.` : 'Open, high, low, close and volume identical.' });
            if (diff.length) setData((d) => d && { ...d, bars: d.bars.map((b) => b.time === r.time ? r : b) });
          }).catch(() => {}); }, 2500);
        }, setFeed);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load Binance candles'); }
    })();
    return () => { cancelled = true; ac.abort(); stop(); };
  }, [symbol, tf, ms, mode]);

  // Replay: warm-up bars before the chosen time are processed but the strategy only ever sees bars up to the cursor.
  useEffect(() => {
    if (mode !== 'replay' || !replayAt) return;
    const ac = new AbortController(); setPlaying(false); setData(null); setError(null); setForming(null); setFeed('rest'); setSelected(null);
    const start = barOpen(Date.parse(`${replayAt}:00Z`), ms);
    (async () => {
      try {
        const end = Math.min(Date.now(), start + AFTER * ms);
        const [tick, bars] = await Promise.all([fetchTickSize(symbol, ac.signal), fetchRange(symbol, tf, start - WARMUP * ms, end, ac.signal)]);
        if (!bars.length) throw new Error('No candles for that date.');
        setData({ bars, tick, key: `${symbol}-${tf}-${start}` });
        setCursor(Math.max(0, bars.findIndex((b) => b.time >= start)));
      } catch (e) { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load history'); }
    })();
    return () => ac.abort();
  }, [mode, replayKey, symbol, tf, ms]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing || !data) return;
    const id = setInterval(() => setCursor((c) => { if (c >= data.bars.length - 1) { setPlaying(false); return c; } return c + 1; }), 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, data]);

  const pineFull = useMemo(() => data ? runPineSeries(data.bars, data.tick) : null, [data]);
  const smcFull = useMemo(() => data ? analyzeSmc(data.bars, data.tick) : null, [data]);
  const idx = !data ? -1 : mode === 'replay' ? Math.min(cursor, data.bars.length - 1) : data.bars.length - 1;
  const bars = useMemo(() => data ? data.bars.slice(0, idx + 1) : [], [data, idx]);
  const pine = useMemo(() => pineFull && idx >= 0 ? pineAt(pineFull, idx) : null, [pineFull, idx]);
  const smc = useMemo(() => smcFull && idx >= 0 ? smcAt(smcFull, idx) : null, [smcFull, idx]);
  const viewEnd = bars.length ? bars.at(-1)!.time + ms : 0;

  // Robot + live-engine rows (stored history only).
  const positions = useRobotPositions(); const settings = useRobotSettings(); const rMarkets = useRobotMarkets(); const eMarkets = useMarkets();
  const first = data?.bars[0]?.time ?? 0; const lastAll = data ? data.bars.at(-1)!.time + ms : 0;
  const dFrom = Math.max(first, lastAll - 8 * 86_400_000 + MIN);
  const decisions = useQuery({ queryKey: ['chart-decisions', symbol, dFrom, lastAll], enabled: !!data && ROBOT_SET.has(symbol), refetchInterval: mode === 'live' ? 30_000 : false,
    queryFn: () => readRobotDecisionsFor({ data: { symbol, from: dFrom, to: lastAll + MIN } }) as Promise<RobotDecisionRow[]> });
  const events = useQuery({ queryKey: ['chart-events', symbol], enabled: PINE_SYMBOLS.has(symbol), refetchInterval: 30_000, queryFn: () => readSignalEventsFor({ data: { symbol } }) });

  const robotTrades: RobotTradeView[] = useMemo(() => {
    const st = settings.data; if (!positions.data || !st) return [];
    return positions.data.filter((p) => p.symbol === symbol && Date.parse(p.opened_at) < viewEnd).map((p) => {
      const closedAt = p.closed_at ? Date.parse(p.closed_at) : null; const done = closedAt !== null && closedAt < viewEnd;
      const be = robotBreakeven({ ...p, tick_size: p.tick_size }, { fee_pct: Number(st.fee_pct), slippage_bps: Number(st.slippage_bps), breakeven_trigger_roi_pct: Number((st as { breakeven_trigger_roi_pct?: number }).breakeven_trigger_roi_pct ?? 6) });
      return { id: p.id, direction: p.direction === 'SHORT' ? 'SHORT' : 'LONG', openedAt: Date.parse(p.opened_at), closedAt: done ? closedAt : null, entry: p.entry_price,
        initialStop: p.initial_stop, stop: done || mode === 'live' ? p.stop_loss : p.initial_stop, tp: p.tp1, exitPrice: done ? p.exit_price : null, exitReason: done ? p.exit_reason : null,
        pnl: done ? p.realized_pnl : null, roi: done ? p.net_roi_pct : null, audit: p.entry_audit, setup: p.setup, beTrigger: be.trigger, lockStop: be.stop } satisfies RobotTradeView;
    });
  }, [positions.data, settings.data, symbol, viewEnd, mode]);
  const visibleDecisions = useMemo(() => (decisions.data ?? []).filter((d) => decisionBarTime(d) + MIN <= viewEnd), [decisions.data, viewEnd]);
  const stages = useMemo(() => stageEvents(visibleDecisions), [visibleDecisions]);
  const overlay = useMemo(() => palette && pine && smc ? buildOverlay({ bars, tfMs: ms, pine, smc, robot: robotTrades, stages, show, c: palette, selectedId: selected }) : null,
    [palette, pine, smc, bars, ms, robotTrades, stages, show, selected]);

  // Reference bar for the panels: crosshair bar if hovering, else the latest closed (or replay) bar.
  const refBar = useMemo(() => { if (!pine) return undefined; const h = hover !== null ? pine.bars.find((b) => b.time === hover) : undefined; return h ?? pine.bars.at(-1); }, [pine, hover]);

  const checks: Check[] = useMemo(() => {
    const out: Check[] = []; if (!data || !pine) return out;
    const g = gaps(bars, tf);
    out.push({ component: 'Candle continuity', status: g === 0 ? 'MATCH' : 'MISMATCH', detail: g === 0 ? `${bars.length} closed Binance candles, none missing.` : `${g} gaps in the loaded candles.` });
    out.push(mode === 'live'
      ? restCheck ? { component: 'Live candle vs Binance REST', status: restCheck.ok ? 'MATCH' : 'MISMATCH', detail: `${iso(restCheck.time)} UTC: ${restCheck.detail}` }
        : { component: 'Live candle vs Binance REST', status: 'INFO', detail: 'Checked automatically when the next candle closes.' }
      : { component: 'Replay source', status: 'INFO', detail: 'Binance REST history. Indicators and structure only use candles up to the replay cursor.' });
    const rm = rMarkets.data?.find((m) => m.symbol === symbol);
    if (ROBOT_SET.has(symbol) && mode === 'live') {
      const lc = rm?.last_candle_at ? Date.parse(rm.last_candle_at) : null; const lastClosed1m = barOpen(Date.now(), MIN) - MIN;
      const lag = lc === null ? null : Math.round((lastClosed1m - barOpen(lc, MIN)) / MIN);
      out.push({ component: 'Robot candle sync', status: lag === null ? 'N/A' : Math.abs(lag) <= 2 ? 'MATCH' : 'MISMATCH',
        detail: lag === null ? 'The robot has not reported a candle for this coin.' : `Robot's last 1m candle ${iso(lc!)} UTC (${lag <= 0 ? 'current' : `${lag} min behind`}); robot price ${px(rm?.price)} vs chart ${px(forming?.close ?? bars.at(-1)?.close)}.` });
    } else if (!ROBOT_SET.has(symbol)) out.push({ component: 'Robot candle sync', status: 'N/A', detail: 'This coin is not in the robot list.' });
    const em = eMarkets.data?.find((m) => m.symbol === symbol);
    if (PINE_SYMBOLS.has(symbol) && tf === '1m' && mode === 'live' && em?.last_candle_at) {
      const t = Date.parse(em.last_candle_at); const b = pine.bars.find((x) => x.time === t) ?? pine.bars.find((x) => x.time === t - MIN);
      out.push(b ? { component: 'Pine scores: live worker vs chart', status: b.long.score === em.long_score && b.short.score === em.short_score ? 'MATCH' : 'MISMATCH',
        detail: `${iso(b.time)} UTC · worker LONG ${em.long_score}/SHORT ${em.short_score} · chart LONG ${b.long.score}/SHORT ${b.short.score}. The chart started ${bars.length} candles ago; the worker has run longer, which only matters while averages warm up.` }
        : { component: 'Pine scores: live worker vs chart', status: 'INFO', detail: `Worker's last candle ${iso(t)} UTC is not in the loaded chart yet.` });
    } else out.push({ component: 'Pine scores: live worker vs chart', status: 'N/A', detail: PINE_SYMBOLS.has(symbol) ? 'Available on the 1M live chart (the live Pine engine runs on 1-minute candles).' : 'This coin is not in the Pine signal list.' });
    if (PINE_SYMBOLS.has(symbol) && tf === '1m' && events.data) {
      const live = events.data.filter((e) => e.event_type === 'entry_confirmed').map((e) => ({ t: Date.parse(e.timestamp) - MIN, d: e.direction }))
        .filter((e) => e.t >= first + 300 * MIN && e.t < viewEnd);
      const chart = pine.trades.filter((t) => t.entryTime >= first + 300 * MIN);
      const both = chart.filter((c) => live.some((l) => l.t === c.entryTime && l.d === c.direction)).length;
      const onlyLive = live.filter((l) => !chart.some((c) => c.entryTime === l.t && c.direction === l.d)).length;
      out.push({ component: 'Pine entries: live history vs chart', status: onlyLive === 0 ? 'MATCH' : 'MISMATCH',
        detail: `After 300 warm-up candles: ${chart.length} chart signals, ${live.length} live entries, ${both} identical. ${chart.length - both} chart-only signals are expected when the live 15M/5M/1M trend filter blocked them or a trade was already open live.${onlyLive ? ` ${onlyLive} live entries have no chart signal.` : ''}` });
    }
    if (refBar && ROBOT_SET.has(symbol)) for (const d of ['LONG', 'SHORT'] as const) {
      const ps = d === 'LONG' ? refBar.long : refBar.short;
      const rows = (decisions.data ?? []).filter((x) => x.direction === d && barOpen(decisionBarTime(x), ms) === refBar.time);
      const entered = robotTrades.some((r) => r.direction === d && barOpen(r.openedAt, ms) === refBar.time);
      const reason = rows.at(-1)?.reason;
      out.push({ component: `${d} decision at ${iso(refBar.time)}`, status: ps.entry === entered ? 'MATCH' : 'MISMATCH',
        detail: `Pine: ${ps.entry ? 'SIGNAL' : ps.setup ? 'setup, no new entry' : 'no signal'} · Robot: ${entered ? 'ENTERED' : reason ? `no entry — ${reason}` : 'no stored decision'}. The robot uses its own SMC rules, not the Pine indicator.` });
    }
    return out;
  }, [data, pine, bars, tf, mode, restCheck, rMarkets.data, eMarkets.data, events.data, decisions.data, symbol, forming, refBar, robotTrades, viewEnd, first, ms]);

  const pineTrades = pine?.trades ?? [];
  const selPine = selected?.startsWith('pine-') ? pineTrades.find((t) => `pine-${t.id}` === selected) : undefined;
  const selRobot = selected?.startsWith('robot-') ? robotTrades.find((t) => `robot-${t.id}` === selected) : undefined;
  const selRobotRow = selRobot ? positions.data?.find((p) => p.id === selRobot.id) : undefined;
  const nearMisses = useMemo(() => !pine ? [] : pine.trades.slice(-12).reverse().map((t: PineTrade) => {
    const rows = (decisions.data ?? []).filter((x) => x.direction === t.direction && barOpen(decisionBarTime(x), ms) === t.entryTime);
    const r = rows.at(-1);
    return { t, reason: r ? `${STAGE_LABEL[robotStage(r.reason, r.decision)]}: ${r.reason}` : ROBOT_SET.has(symbol) ? 'No stored robot decision for this candle (robot window is the last 8 days).' : 'Coin not in the robot list.' };
  }), [pine, decisions.data, ms, symbol]);

  const setSearch = (p: Partial<{ symbol: string; tf: string }>) => void nav({ search: (prev) => ({ ...prev, ...p }) });
  const total = data?.bars.length ?? 0;
  const lastShown = bars.at(-1);

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <div className="mb-1 font-mono text-[10px] text-active">VERIFY · CHART · PAPER ONLY</div>
        <h1 className="text-2xl font-semibold">Chart &amp; robot verification</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Binance USD-M Futures candles. Pine values come from the same engine code as the live Pine signals; robot drawings come only from the robot's stored trades and decisions. Times are UTC. This is not TradingView's Pine engine — see <Link to="/parity" className="underline">Parity report</Link>.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Coin" value={symbol} onChange={(e) => setSearch({ symbol: e.target.value })} className="h-9 border border-border bg-card px-2 font-mono text-sm">
          {CHART_SYMBOLS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <div className="flex border border-border" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => <button key={t.id} type="button" onClick={() => setSearch({ tf: t.id })} aria-pressed={t.id === tf}
            className={cn('px-2.5 py-1.5 font-mono text-xs', t.id === tf ? 'bg-active/20 text-active' : 'text-muted-foreground hover:text-foreground')}>{t.label}</button>)}
        </div>
        <div className="flex border border-border" role="group" aria-label="Mode">
          {(['live', 'replay'] as const).map((m) => <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={m === mode}
            className={cn('px-3 py-1.5 text-xs capitalize', m === mode ? 'bg-active/20 text-active' : 'text-muted-foreground hover:text-foreground')}>{m === 'live' ? 'Live' : 'Bar replay'}</button>)}
        </div>
        <span className={cn('font-mono text-[11px]', feed === 'live' ? 'text-long' : feed === 'rest' ? 'text-active' : 'text-waiting')}>
          {mode === 'live' ? (feed === 'live' ? '● LIVE STREAM' : feed === 'reconnecting' ? '● RECONNECTING' : '● CONNECTING') : '● HISTORY'}</span>
        {UNAVAILABLE(symbol)}
      </div>

      {mode === 'replay' && <div className="flex flex-wrap items-center gap-2 border border-border bg-card/40 p-2">
        <label className="text-xs text-muted-foreground" htmlFor="replay-at">Start (UTC)</label>
        <Input id="replay-at" type="datetime-local" value={replayAt} max={new Date().toISOString().slice(0, 16)} onChange={(e) => setReplayAt(e.target.value)} className="h-8 w-auto font-mono text-xs" />
        <Button size="sm" variant="outline" onClick={() => setReplayKey((k) => k + 1)}>Load</Button>
        <Button size="icon" variant="outline" aria-label="Step back" onClick={() => { setPlaying(false); setCursor((c) => Math.max(0, c - 1)); }}><SkipBack className="h-4 w-4" /></Button>
        <Button size="icon" variant="outline" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} disabled={!data}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
        <Button size="icon" variant="outline" aria-label="Step forward" onClick={() => { setPlaying(false); setCursor((c) => Math.min(total - 1, c + 1)); }}><SkipForward className="h-4 w-4" /></Button>
        <select aria-label="Speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-8 border border-border bg-card px-1 font-mono text-xs">
          {[1, 2, 4, 8, 16].map((v) => <option key={v} value={v}>{v} bars/s</option>)}
        </select>
        <input type="range" aria-label="Replay position" min={0} max={Math.max(0, total - 1)} value={Math.max(0, idx)} onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} className="min-w-[140px] flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">{lastShown ? `${iso(lastShown.time)} · bar ${idx + 1}/${total}` : ''}</span>
      </div>}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Overlays">
        {OVERLAY_LABELS.map(([k, label]) => <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow((o) => ({ ...o, [k]: !o[k] }))}
          className={cn('border px-2 py-1 text-[11px]', show[k] ? 'border-active/60 bg-active/10 text-foreground' : 'border-border text-muted-foreground')}>{label}</button>)}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 border border-border bg-card/30">
          {error ? <p className="p-4 text-sm text-short">{error}</p> : !data || !overlay || !pine ? <p className="p-4 text-sm text-muted-foreground">Loading Binance candles…</p> :
            <ClientOnly fallback={<div className="h-[560px]" />}><Suspense fallback={<div className="h-[560px]" />}>
              <TradingChart bars={bars} forming={mode === 'live' ? forming : null} pine={pine.bars} showEma={show.ema} markers={overlay.markers} boxes={overlay.boxes} segments={overlay.segments}
                palette={palette!} precision={decimals(data.tick)} follow={mode === 'replay'} onCrosshair={setHover} />
            </Suspense></ClientOnly>}
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">Panes: price · RSI 14 · MACD 12/26/9. The forming candle is drawn but never used in calculations; signals fire on candle close.</p>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="border border-border bg-card/40 p-3">
            <h2 className="mb-1 text-sm font-semibold">Live signal comparison</h2>
            <ComparisonList checks={checks} />
          </section>
          <section className="border border-border bg-card/40 p-3">
            <h2 className="mb-2 text-sm font-semibold">Pine conditions {hover !== null ? '(crosshair candle)' : '(latest closed candle)'}</h2>
            <PineConditions bar={refBar} />
          </section>
        </aside>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section className="min-w-0 border border-border bg-card/40 p-3">
          <h2 className="mb-2 text-sm font-semibold">Trades on this chart</h2>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto text-xs">
            {robotTrades.map((r) => <li key={r.id}><button type="button" onClick={() => setSelected(`robot-${r.id}`)} className={cn('flex w-full flex-wrap gap-x-3 py-1.5 text-left', selected === `robot-${r.id}` && 'text-active')}>
              <span className="font-mono text-active">ROBOT</span><span className={r.direction === 'LONG' ? 'text-long' : 'text-short'}>{r.direction}</span>
              <span className="font-mono">{iso(r.openedAt)}</span><span className="font-mono">fill {px(r.entry)}</span><span>{r.exitReason ?? 'OPEN'}</span></button></li>)}
            {[...pineTrades].reverse().map((t) => <li key={t.id}><button type="button" onClick={() => setSelected(`pine-${t.id}`)} className={cn('flex w-full flex-wrap gap-x-3 py-1.5 text-left', selected === `pine-${t.id}` && 'text-active')}>
              <span className="font-mono text-muted-foreground">PINE</span><span className={t.direction === 'LONG' ? 'text-long' : 'text-short'}>{t.direction}</span>
              <span className="font-mono">{iso(t.entryTime)}</span><span className="font-mono">entry {px(t.entry)}</span><span>{t.exit ?? 'OPEN'}{t.netR !== null ? ` ${t.netR.toFixed(2)}R` : ''}</span></button></li>)}
            {!robotTrades.length && !pineTrades.length && <li className="py-2 text-muted-foreground">No trades in the loaded candles.</li>}
          </ul>
        </section>
        <section className="min-w-0 border border-border bg-card/40 p-3">
          <h2 className="mb-2 text-sm font-semibold">Break-even breakdown</h2>
          {selPine && data ? <><p className="mb-2 text-xs text-muted-foreground">Pine {selPine.direction} at {iso(selPine.entryTime)} · entry {px(selPine.entry)} · SL {px(selPine.originalStop)} · TP {px(selPine.target)} · {selPine.beActivatedAt ? `BE activated ${iso(selPine.beActivatedAt)}` : 'BE not activated'}</p>
            <BreakevenTable rows={[pineBreakeven(selPine, data.tick)]} /></>
          : selRobot && selRobotRow && settings.data ? <><p className="mb-2 text-xs text-muted-foreground">Robot {selRobot.direction} {selRobot.setup} · fill {px(selRobot.entry)} · qty {selRobotRow.quantity} · initial SL {px(selRobot.initialStop)} · stored stop {px(selRobotRow.stop_loss)} {selRobotRow.stop_loss !== selRobotRow.initial_stop ? '(moved)' : '(not moved)'}</p>
            <BreakevenTable rows={[robotBreakeven(selRobotRow, { fee_pct: Number(settings.data.fee_pct), slippage_bps: Number(settings.data.slippage_bps), breakeven_trigger_roi_pct: Number((settings.data as { breakeven_trigger_roi_pct?: number }).breakeven_trigger_roi_pct ?? 6) }),
              pineBreakeven({ direction: selRobot.direction, entry: selRobot.entry, originalStop: selRobot.initialStop }, selRobotRow.tick_size ?? data?.tick ?? 0)]} />
            <p className="mt-2 text-[11px] text-waiting">The right column is what the Pine 1R rule would give for this same fill and stop. The robot does not use it, which is why the two break-even prices differ.</p></>
          : <p className="text-xs text-muted-foreground">Pick a trade on the left to see its activation condition, trigger, stop, fee-adjusted and tick-rounded break-even prices.</p>}
        </section>
      </div>

      <section className="min-w-0 border border-border bg-card/40 p-3">
        <h2 className="mb-1 text-sm font-semibold">Pine signals vs robot: why the robot did or did not enter</h2>
        <p className="mb-2 text-xs text-muted-foreground">Latest Pine signals in view, with the robot's own stored decision on the same candle.</p>
        <ul className="divide-y divide-border text-xs">
          {nearMisses.map(({ t, reason }) => <li key={t.id} className="flex flex-wrap gap-x-3 py-1.5">
            <span className={cn('font-mono', t.direction === 'LONG' ? 'text-long' : 'text-short')}>{t.direction}</span><span className="font-mono">{iso(t.entryTime)}</span>
            <span className="min-w-0 flex-1 break-words text-muted-foreground">{reason}</span></li>)}
          {!nearMisses.length && <li className="py-2 text-muted-foreground">No Pine signals in the loaded candles.</li>}
        </ul>
      </section>
    </div>
  );
}

function UNAVAILABLE(symbol: string) {
  return !PINE_SYMBOLS.has(symbol) ? <span className="text-[11px] text-muted-foreground">Robot coin (no live Pine signals)</span>
    : !ROBOT_SET.has(symbol) ? <span className="text-[11px] text-muted-foreground">Pine coin</span> : null;
}
