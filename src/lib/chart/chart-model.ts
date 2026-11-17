/** Pure: turns calculation results and stored robot rows into chart markers, boxes and level segments. */
import type { Candle } from '@/lib/engine/model';
import type { PineRun } from './pine-series';
import type { SmcResult } from './smc-overlay';
import { barOpen } from './timeframes';
import { STAGE_LABEL, evidenceOf, type StageEvent } from './robot-overlay';

export type Palette = { long: string; short: string; waiting: string; active: string; breakeven: string; fg: string; muted: string; alpha: (c: string, a: number) => string };
export type Overlays = { ema: boolean; pineSignals: boolean; pineLevels: boolean; liquidity: boolean; structure: boolean; fvg: boolean; ob: boolean; premium: boolean; ote: boolean; robotTrades: boolean; robotStages: boolean };
export const DEFAULT_OVERLAYS: Overlays = { ema: true, pineSignals: true, pineLevels: true, liquidity: true, structure: true, fvg: true, ob: true, premium: false, ote: true, robotTrades: true, robotStages: true };

export type ChartMarker = { time: number; position: 'aboveBar' | 'belowBar' | 'atPriceMiddle'; price?: number | undefined; shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; color: string; text: string };
export type ChartBox = { from: number; to: number | null; top: number; bottom: number; fill: string; stroke: string; label?: string | undefined };
export type ChartSegment = { from: number; to: number | null; price: number; color: string; dash?: boolean; width?: number; label?: string | undefined };

export type RobotTradeView = {
  id: string; direction: 'LONG' | 'SHORT'; openedAt: number; closedAt: number | null; entry: number; initialStop: number; stop: number; tp: number;
  exitPrice: number | null; exitReason: string | null; pnl: number | null; roi: number | null; audit: unknown; setup: string; beTrigger: number | null; lockStop: number | null;
};

export function buildOverlay(o: { bars: Candle[]; tfMs: number; pine: PineRun; smc: SmcResult; robot: RobotTradeView[]; stages: StageEvent[]; show: Overlays; c: Palette; selectedId: string | null }) {
  const { bars, tfMs, pine, smc, robot, stages, show, c } = o;
  const markers: ChartMarker[] = []; const boxes: ChartBox[] = []; const segments: ChartSegment[] = [];
  if (!bars.length) return { markers, boxes, segments };
  const first = bars[0]!.time; const last = bars.at(-1)!.time;
  const inView = (t: number) => t >= first && t <= last;
  const timeAt = (i: number) => bars[i]?.time ?? last;
  const B = (t: number) => barOpen(t, tfMs);

  if (show.pineSignals || show.pineLevels) for (const t of pine.trades) {
    const L = t.direction === 'LONG'; const sel = o.selectedId === `pine-${t.id}`;
    if (show.pineSignals) {
      markers.push({ time: t.entryTime, position: L ? 'belowBar' : 'aboveBar', shape: L ? 'arrowUp' : 'arrowDown', color: L ? c.long : c.short, text: `PINE ${t.direction}` });
      if (t.beActivatedAt !== null) markers.push({ time: t.beActivatedAt, position: L ? 'aboveBar' : 'belowBar', shape: 'square', color: c.breakeven, text: 'BE on' });
      if (t.exitTime !== null) markers.push({ time: t.exitTime, position: L ? 'aboveBar' : 'belowBar', shape: 'circle', color: t.exit === 'TAKE_PROFIT' ? c.long : t.exit === 'BREAKEVEN_EXIT' ? c.breakeven : c.short,
        text: `${t.exit === 'TAKE_PROFIT' ? 'TP' : t.exit === 'BREAKEVEN_EXIT' ? 'BE exit' : 'SL'}${t.netR !== null ? ` ${t.netR >= 0 ? '+' : ''}${t.netR.toFixed(2)}R` : ''}` });
    }
    if (show.pineLevels) {
      const end = t.exitTime; const w = sel ? 2 : 1;
      segments.push({ from: t.entryTime, to: end, price: t.entry, color: c.fg, width: w, label: sel ? 'Entry' : undefined });
      segments.push({ from: t.entryTime, to: t.beActivatedAt ?? end, price: t.originalStop, color: c.short, width: w, label: sel ? 'SL' : undefined });
      segments.push({ from: t.entryTime, to: end, price: t.target, color: c.long, width: w, label: sel ? 'TP' : undefined });
      segments.push({ from: t.entryTime, to: t.beActivatedAt ?? end, price: t.beTrigger, color: c.breakeven, dash: true, label: sel ? 'BE trigger 1R' : undefined });
      if (t.beActivatedAt !== null && t.beStop !== null) segments.push({ from: t.beActivatedAt, to: end, price: t.beStop, color: c.breakeven, width: w, label: sel ? 'BE stop' : undefined });
    }
  }

  if (show.liquidity) {
    for (const e of smc.equals.slice(-12)) segments.push({ from: e.firstTime, to: e.sweptAt !== null ? timeAt(e.sweptAt) : null, price: e.price, color: c.waiting, dash: true, label: e.kind });
    for (const s of smc.sweeps.slice(-25)) markers.push({ time: s.time, position: s.side === 'BUY_SIDE' ? 'aboveBar' : 'belowBar', shape: 'circle', color: c.waiting, text: s.side === 'BUY_SIDE' ? 'sweep ▲liq' : 'sweep ▼liq' });
  }
  if (show.structure) for (const b of smc.breaks.slice(-20))
    segments.push({ from: b.levelTime, to: b.time, price: b.level, color: b.dir > 0 ? c.long : c.short, dash: b.kind === 'BOS', label: b.kind });
  const zone = (kind: 'FVG' | 'OB') => smc.zones.filter((z) => z.kind === kind).slice(-15).forEach((z) => {
    const col = z.dir > 0 ? c.long : c.short; const dead = z.invalidatedAt !== null;
    boxes.push({ from: z.time, to: dead ? timeAt(z.invalidatedAt!) : null, top: z.high, bottom: z.low, fill: c.alpha(col, dead ? 0.05 : kind === 'FVG' ? 0.14 : 0.1), stroke: c.alpha(col, dead ? 0.25 : 0.6),
      label: `${z.dir > 0 ? 'Bull' : 'Bear'} ${kind}${dead ? ' ✗' : ''}` });
  });
  if (show.fvg) zone('FVG');
  if (show.ob) zone('OB');
  const range = smc.ranges.at(-1);
  if (range && show.premium) {
    const from = Math.min(range.lowTime, range.highTime);
    boxes.push({ from, to: null, top: range.high, bottom: range.eq, fill: c.alpha(c.short, 0.05), stroke: c.alpha(c.short, 0.3), label: 'Premium' });
    boxes.push({ from, to: null, top: range.eq, bottom: range.low, fill: c.alpha(c.long, 0.05), stroke: c.alpha(c.long, 0.3), label: 'Discount' });
    segments.push({ from, to: null, price: range.eq, color: c.muted, dash: true, label: 'EQ 50%' });
  }
  if (range && show.ote) boxes.push({ from: timeAt(range.at), to: null, top: range.oteHigh, bottom: range.oteLow, fill: c.alpha(c.breakeven, 0.1), stroke: c.alpha(c.breakeven, 0.5), label: 'OTE 62–79%' });

  if (show.robotTrades) for (const r of robot) {
    const L = r.direction === 'LONG'; const sel = o.selectedId === `robot-${r.id}`; const open = B(r.openedAt);
    if (!inView(open)) continue;
    const end = r.closedAt !== null ? B(r.closedAt) : null; const w = sel ? 2 : 1;
    markers.push({ time: open, position: 'atPriceMiddle', price: r.entry, shape: L ? 'arrowUp' : 'arrowDown', color: c.active, text: `ROBOT ${r.direction} fill ${Number(r.entry.toPrecision(6))}` });
    if (end !== null && r.exitPrice !== null) markers.push({ time: end, position: 'atPriceMiddle', price: r.exitPrice, shape: 'circle', color: (r.pnl ?? 0) >= 0 ? c.long : c.short,
      text: `${r.exitReason ?? 'EXIT'} ${r.pnl !== null ? `${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(3)}` : ''}${r.roi !== null ? ` (${r.roi.toFixed(1)}%)` : ''}` });
    segments.push({ from: open, to: end, price: r.entry, color: c.active, width: w, label: sel ? 'Robot entry' : undefined });
    segments.push({ from: open, to: end, price: r.initialStop, color: c.short, width: w, label: sel ? 'Robot SL' : undefined });
    if (r.stop !== r.initialStop) segments.push({ from: open, to: end, price: r.stop, color: c.breakeven, width: w, label: sel ? 'Robot lock stop' : undefined });
    segments.push({ from: open, to: end, price: r.tp, color: c.long, width: w, label: sel ? 'Robot TP (+10% net)' : undefined });
    if (r.beTrigger !== null) segments.push({ from: open, to: end, price: r.beTrigger, color: c.breakeven, dash: true, label: sel ? 'Robot BE trigger' : undefined });
    const ev = evidenceOf(r.audit);
    if (ev?.zone_low !== undefined && ev.zone_high !== undefined) boxes.push({ from: B(ev.mss_at ?? r.openedAt), to: end, top: ev.zone_high, bottom: ev.zone_low,
      fill: c.alpha(c.active, 0.12), stroke: c.alpha(c.active, 0.7), label: `ROBOT ${ev.zone_kind ?? 'zone'}` });
    if (ev?.mss_level !== undefined && ev.mss_at !== undefined) segments.push({ from: B(ev.sweep_at ?? ev.mss_at), to: B(ev.mss_at), price: ev.mss_level, color: c.active, label: 'ROBOT MSS' });
    if (ev?.sweep_extreme !== undefined && ev.sweep_at !== undefined) segments.push({ from: B(ev.sweep_at), to: open, price: ev.sweep_extreme, color: c.active, dash: true, label: 'ROBOT sweep' });
    if (ev?.signal_price !== undefined && ev.signal_open_at !== undefined && inView(B(ev.signal_open_at)))
      markers.push({ time: B(ev.signal_open_at), position: 'atPriceMiddle', price: ev.signal_price, shape: 'square', color: c.active, text: 'signal' });
  }
  if (show.robotStages) for (const s of stages) {
    const t = B(s.time); if (!inView(t)) continue;
    markers.push({ time: t, position: s.direction === 'LONG' ? 'belowBar' : 'aboveBar', shape: 'circle', color: c.active, text: `R${s.direction === 'LONG' ? '↑' : '↓'} ${STAGE_LABEL[s.stage]}` });
  }
  markers.sort((a, b) => a.time - b.time);
  return { markers: markers.filter((m) => inView(m.time)), boxes, segments };
}
