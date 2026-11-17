/** Browser-only candlestick chart (TradingView Lightweight Charts). Loaded lazily behind <ClientOnly>. */
import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/lib/engine/model';
import type { PineBar } from '@/lib/chart/pine-series';
import type { ChartBox, ChartMarker, ChartSegment, Palette } from '@/lib/chart/chart-model';
import { OverlayPrimitive } from './overlay-primitive';

type Props = { bars: Candle[]; forming: Candle | null; pine: PineBar[]; showEma: boolean; markers: ChartMarker[]; boxes: ChartBox[]; segments: ChartSegment[]; palette: Palette;
  precision: number; follow: boolean; onCrosshair?: (time: number | null) => void };
const T = (ms: number) => (ms / 1000) as UTCTimestamp;

export default function TradingChart(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ chart: IChartApi; candles: ISeriesApi<'Candlestick'>; e9: ISeriesApi<'Line'>; e21: ISeriesApi<'Line'>; e200: ISeriesApi<'Line'>;
    rsi: ISeriesApi<'Line'>; macd: ISeriesApi<'Line'>; signal: ISeriesApi<'Line'>; hist: ISeriesApi<'Histogram'>; markers: ISeriesMarkersPluginApi<Time>; overlay: OverlayPrimitive } | null>(null);
  const cb = useRef(p.onCrosshair); cb.current = p.onCrosshair;

  useEffect(() => {
    if (!el.current) return;
    const c = p.palette; const grid = c.alpha(c.muted, 0.08);
    const chart = createChart(el.current, { autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, panes: { separatorColor: c.alpha(c.muted, 0.25) } },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } }, crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: c.alpha(c.muted, 0.25) }, timeScale: { borderColor: c.alpha(c.muted, 0.25), timeVisible: true, secondsVisible: false, rightOffset: 6 } });
    const candles = chart.addSeries(CandlestickSeries, { upColor: c.long, downColor: c.short, borderUpColor: c.long, borderDownColor: c.short, wickUpColor: c.long, wickDownColor: c.short });
    const line = (color: string, width: 1 | 2, pane = 0) => chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
    const e9 = line(c.active, 1); const e21 = line(c.waiting, 1); const e200 = line(c.fg, 2);
    const rsi = line(c.breakeven, 1, 1); const macd = line(c.active, 1, 2); const signal = line(c.waiting, 1, 2);
    const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 2);
    rsi.createPriceLine({ price: 50, color: c.alpha(c.muted, 0.5), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
    const panes = chart.panes(); panes[0]?.setHeight(420); panes[1]?.setHeight(90); panes[2]?.setHeight(110);
    const overlay = new OverlayPrimitive(); candles.attachPrimitive(overlay);
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeCrosshairMove((e) => cb.current?.(e.time === undefined ? null : Number(e.time) * 1000));
    api.current = { chart, candles, e9, e21, e200, rsi, macd, signal, hist, markers, overlay };
    return () => { chart.remove(); api.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const a = api.current; if (!a) return;
    const prec = Math.min(8, Math.max(0, p.precision));
    a.candles.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: 1 / 10 ** prec } });
    const data = p.bars.map((b) => ({ time: T(b.time), open: b.open, high: b.high, low: b.low, close: b.close }));
    if (p.forming && (!p.bars.length || p.forming.time > p.bars.at(-1)!.time)) data.push({ time: T(p.forming.time), open: p.forming.open, high: p.forming.high, low: p.forming.low, close: p.forming.close });
    a.candles.setData(data);
    const ser = (f: (b: PineBar) => number | null) => p.pine.flatMap((b) => { const v = f(b); return v === null || !Number.isFinite(v) ? [] : [{ time: T(b.time), value: v }]; });
    a.e9.setData(p.showEma ? ser((b) => b.ema9) : []); a.e21.setData(p.showEma ? ser((b) => b.ema21) : []); a.e200.setData(p.showEma ? ser((b) => b.ema200) : []);
    a.rsi.setData(ser((b) => b.rsi)); a.macd.setData(ser((b) => b.macd)); a.signal.setData(ser((b) => b.macdSignal));
    a.hist.setData(p.pine.map((b) => ({ time: T(b.time), value: b.histogram, color: p.palette.alpha(b.histogram >= 0 ? p.palette.long : p.palette.short, 0.6) })));
    a.markers.setMarkers(p.markers.map((m) => ({ time: T(m.time), position: m.position, shape: m.shape, color: m.color, text: m.text, ...(m.price !== undefined ? { price: m.price } : {}) })) as never);
    a.overlay.set(p.boxes, p.segments);
    if (p.follow) a.chart.timeScale().scrollToRealTime();
  }, [p.bars, p.forming, p.pine, p.showEma, p.markers, p.boxes, p.segments, p.palette, p.precision, p.follow]);

  return <div ref={el} className="h-[560px] w-full md:h-[640px]" aria-label="Candlestick chart" />;
}
