/** Minimal drawing layer for zones (boxes) and levels (segments) on a lightweight-charts series. */
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time, UTCTimestamp } from 'lightweight-charts';

export type Box = { from: number; to: number | null; top: number; bottom: number; fill: string; stroke: string; label?: string };
export type Segment = { from: number; to: number | null; price: number; color: string; dash?: boolean; width?: number; label?: string };
type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

export class OverlayPrimitive implements ISeriesPrimitive<Time> {
  boxes: Box[] = []; segments: Segment[] = [];
  private chart: IChartApi | null = null; private series: ISeriesApi<SeriesType> | null = null; private request: (() => void) | null = null;
  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart as IChartApi; this.series = p.series as ISeriesApi<SeriesType>; this.request = p.requestUpdate; }
  detached() { this.chart = null; this.series = null; this.request = null; }
  set(boxes: Box[], segments: Segment[]) { this.boxes = boxes; this.segments = segments; this.request?.(); }
  updateAllViews() {}
  private x(t: number | null, width: number) {
    if (t === null || !this.chart) return width;
    const c = this.chart.timeScale().timeToCoordinate((t / 1000) as UTCTimestamp);
    if (c !== null) return c;
    const range = this.chart.timeScale().getVisibleRange();
    if (!range) return null;
    return t / 1000 > Number(range.to) ? width : 0;
  }
  paneViews(): readonly IPrimitivePaneView[] {
    const self = this;
    const view = (layer: 'bottom' | 'top'): IPrimitivePaneView => ({
      zOrder: () => layer,
      renderer: () => ({
        draw(target: Target) {
          const s = self.series; if (!s) return;
          target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
            const width = bitmapSize.width / hr;
            ctx.font = `${10 * vr}px "JetBrains Mono", monospace`;
            if (layer === 'bottom') for (const b of self.boxes) {
              const x1 = self.x(b.from, width); const x2 = self.x(b.to, width); const y1 = s.priceToCoordinate(b.top); const y2 = s.priceToCoordinate(b.bottom);
              if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
              const L = Math.min(x1, x2) * hr; const W = Math.max(1, Math.abs(x2 - x1)) * hr; const T = Math.min(y1, y2) * vr; const H = Math.max(1, Math.abs(y2 - y1)) * vr;
              ctx.fillStyle = b.fill; ctx.fillRect(L, T, W, H); ctx.strokeStyle = b.stroke; ctx.lineWidth = hr; ctx.strokeRect(L, T, W, H);
              if (b.label) { ctx.fillStyle = b.stroke; ctx.fillText(b.label, L + 3 * hr, T + 11 * vr); }
            }
            if (layer === 'top') for (const g of self.segments) {
              const x1 = self.x(g.from, width); const x2 = self.x(g.to, width); const y = s.priceToCoordinate(g.price);
              if (x1 === null || x2 === null || y === null) continue;
              ctx.strokeStyle = g.color; ctx.lineWidth = (g.width ?? 1) * hr; ctx.setLineDash(g.dash ? [4 * hr, 3 * hr] : []);
              ctx.beginPath(); ctx.moveTo(x1 * hr, y * vr); ctx.lineTo(x2 * hr, y * vr); ctx.stroke(); ctx.setLineDash([]);
              if (g.label) { ctx.fillStyle = g.color; ctx.fillText(g.label, Math.max(x1, 0) * hr + 3 * hr, y * vr - 3 * vr); }
            }
          });
        },
      }),
    });
    return [view('bottom'), view('top')];
  }
}
