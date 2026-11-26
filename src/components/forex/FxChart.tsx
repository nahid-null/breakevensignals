/** Browser-only AUD/JPY M3 chart with LONG/SHORT entries and WIN/LOSS/DRAW expiry markers. Loaded lazily behind <ClientOnly>. */
import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, LineSeries, createChart, createSeriesMarkers, type IChartApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { readPalette } from '@/components/chart/palette';
import type { FxTrade } from '@/lib/forex.functions';

type Props = { bars: [number, number, number, number, number][]; ema: [number, number][]; trades: FxTrade[]; range: [number, number]; focus: FxTrade | null };
const T = (s: number) => s as UTCTimestamp;
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export default function FxChart({ bars, ema, trades, range, focus }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = readPalette(); const grid = c.alpha(c.muted, 0.08);
    const chart = createChart(el.current, { autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } }, localization: { priceFormatter: (p: number) => p.toFixed(3) },
      rightPriceScale: { borderColor: c.alpha(c.muted, 0.25) }, timeScale: { borderColor: c.alpha(c.muted, 0.25), timeVisible: true, secondsVisible: false, rightOffset: 4 } });
    const candles = chart.addSeries(CandlestickSeries, { upColor: c.long, downColor: c.short, borderUpColor: c.long, borderDownColor: c.short, wickUpColor: c.long, wickDownColor: c.short,
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 } });
    candles.setData(bars.map(([t, o, h, l, cl]) => ({ time: T(t), open: o, high: h, low: l, close: cl })));
    const line = chart.addSeries(LineSeries, { color: c.alpha(c.muted, 0.6), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    line.setData(ema.map(([t, v]) => ({ time: T(t), value: v })));
    const markers: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      const signalBar = sec(t.signal_time);
      markers.push(t.side === 'LONG'
        ? { time: T(signalBar), position: 'belowBar', shape: 'arrowUp', color: c.long, text: `LONG ${t.entry.toFixed(3)}` }
        : { time: T(signalBar), position: 'aboveBar', shape: 'arrowDown', color: c.short, text: `SHORT ${t.entry.toFixed(3)}` });
      const expiryBar = Math.floor(sec(t.entry_time) / 180) * 180;
      const r = t.result;
      const color = r === 'WIN' ? c.long : r === 'LOSS' ? c.short : r === 'DRAW' ? c.waiting : c.muted;
      const text = r === 'SKIPPED' ? 'SKIP' : r;
      markers.push({ time: T(expiryBar), position: t.side === 'LONG' ? 'aboveBar' : 'belowBar', shape: r === 'WIN' ? 'circle' : 'square', color, text, size: r === 'SKIPPED' ? 0.5 : 1 });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    createSeriesMarkers(candles, markers);
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, [bars, ema, trades]);
  useEffect(() => {
    const ch = chartRef.current; if (!ch) return;
    if (focus) { const s = sec(focus.signal_time); ch.timeScale().setVisibleRange({ from: T(s - 180 * 25), to: T(s + 180 * 12) }); }
    else ch.timeScale().setVisibleRange({ from: T(range[0]), to: T(range[1]) });
  }, [range, focus, bars]);
  return <div ref={el} className="h-[340px] w-full sm:h-[440px]" />;
}
