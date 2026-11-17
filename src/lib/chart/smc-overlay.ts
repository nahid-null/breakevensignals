/**
 * Causal Smart Money Concepts analysis of the displayed chart bars, using the robot's SMC_V1 definitions:
 * 2-bar confirmed swings, sweep = wick beyond a resting swing with a close back inside, MSS = first close beyond
 * the opposite swing that formed before the sweep, FVG = 3-candle gap filled only by a close through it,
 * order block = last opposite-colour candle before the break, invalidated by a close through it, OTE = 62–79%.
 *
 * Every object records the bar index at which it became knowable (`at`) and, if later invalidated, when.
 * `smcAt(result, i)` therefore shows exactly what was known at bar i — no future candles.
 * The robot itself evaluates 5m pools and 1m structure; its stored decisions are drawn separately and are
 * the authoritative record of what the robot actually saw.
 */
import type { Candle } from '@/lib/engine/model';

export const SMC_CHART_DEFAULTS = { pivot: 2, equalTolAtr: 0.1, fvgMinAtr: 0.1, mssWindow: 30, levelLookback: 150, oteMin: 0.62, oteMax: 0.79 };
export type SmcConfig = typeof SMC_CHART_DEFAULTS;
export type Swing = { kind: 'high' | 'low'; index: number; time: number; price: number; at: number };
export type EqualLevel = { kind: 'EQH' | 'EQL'; price: number; firstTime: number; secondTime: number; at: number; sweptAt: number | null };
export type Sweep = { side: 'BUY_SIDE' | 'SELL_SIDE'; at: number; time: number; level: number; levelTime: number; extreme: number };
export type StructureBreak = { kind: 'BOS' | 'CHoCH' | 'MSS'; dir: 1 | -1; at: number; time: number; level: number; levelTime: number };
export type SmcZone = { kind: 'FVG' | 'OB'; dir: 1 | -1; low: number; high: number; time: number; at: number; invalidatedAt: number | null };
export type DealingRange = { dir: 1 | -1; at: number; low: number; high: number; lowTime: number; highTime: number; eq: number; oteLow: number; oteHigh: number };
export type SmcResult = { swings: Swing[]; equals: EqualLevel[]; sweeps: Sweep[]; breaks: StructureBreak[]; zones: SmcZone[]; ranges: DealingRange[] };

export function analyzeSmc(bars: Candle[], tick: number, cfg: SmcConfig = SMC_CHART_DEFAULTS): SmcResult {
  const r: SmcResult = { swings: [], equals: [], sweeps: [], breaks: [], zones: [], ranges: [] };
  const P = cfg.pivot; let atr: number | null = null; const seed: number[] = [];
  type Pool = { swing: Swing; done: boolean; eq: EqualLevel | null };
  const pools: Pool[] = [];
  let lastHigh: Swing | null = null; let lastLow: Swing | null = null; let brokenHigh = -1; let brokenLow = -1; let trend: 1 | -1 | 0 = 0;
  let lastSellSweep: { at: number } | null = null; let lastBuySweep: { at: number } | null = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!; const prev = bars[i - 1];
    // Wilder ATR(14) of the displayed bars, causal.
    const tr = prev ? Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)) : b.high - b.low;
    if (atr === null) { seed.push(tr); if (seed.length === 14) atr = seed.reduce((x, y) => x + y, 0) / 14; } else atr = (atr * 13 + tr) / 14;
    const a = atr ?? (b.high - b.low);

    // 1. Invalidate zones by a close through them (robot: FVG filled / OB broken).
    for (const z of r.zones) if (z.invalidatedAt === null && z.at < i && (z.dir > 0 ? b.close < z.low : b.close > z.high)) z.invalidatedAt = i;

    // 2. Liquidity sweeps of resting swing pools (confirmed before this bar).
    for (const p of pools) {
      if (p.done || p.swing.at >= i || i - p.swing.index > cfg.levelLookback) continue;
      const s = p.swing;
      if (s.kind === 'high' && b.high > s.price) {
        p.done = true;
        if (b.close < s.price) { r.sweeps.push({ side: 'BUY_SIDE', at: i, time: b.time, level: s.price, levelTime: s.time, extreme: b.high }); lastBuySweep = { at: i }; if (p.eq) p.eq.sweptAt = i; }
      } else if (s.kind === 'low' && b.low < s.price) {
        p.done = true;
        if (b.close > s.price) { r.sweeps.push({ side: 'SELL_SIDE', at: i, time: b.time, level: s.price, levelTime: s.time, extreme: b.low }); lastSellSweep = { at: i }; if (p.eq) p.eq.sweptAt = i; }
      }
    }

    // 3. Structure: close beyond the last confirmed opposite swing.
    const brk = (dir: 1 | -1, sw: Swing) => {
      const sweep = dir > 0 ? lastSellSweep : lastBuySweep;
      const kind: StructureBreak['kind'] = sweep && i - sweep.at <= cfg.mssWindow && sw.index < sweep.at ? 'MSS' : trend === -dir ? 'CHoCH' : 'BOS';
      r.breaks.push({ kind, dir, at: i, time: b.time, level: sw.price, levelTime: sw.time }); trend = dir;
      // Leg extreme between the broken swing and now, then the dealing range / OTE of that leg.
      let ext = i; for (let k = sw.index; k <= i; k++) if (dir > 0 ? bars[k]!.low < bars[ext]!.low : bars[k]!.high > bars[ext]!.high) ext = k;
      let top = i; for (let k = ext; k <= i; k++) if (dir > 0 ? bars[k]!.high > bars[top]!.high : bars[k]!.low < bars[top]!.low) top = k;
      const lo = dir > 0 ? bars[ext]!.low : bars[top]!.low; const hi = dir > 0 ? bars[top]!.high : bars[ext]!.high; const size = hi - lo;
      if (size > 0) r.ranges.push({ dir, at: i, low: lo, high: hi, lowTime: bars[dir > 0 ? ext : top]!.time, highTime: bars[dir > 0 ? top : ext]!.time, eq: (lo + hi) / 2,
        oteLow: dir > 0 ? hi - cfg.oteMax * size : lo + cfg.oteMin * size, oteHigh: dir > 0 ? hi - cfg.oteMin * size : lo + cfg.oteMax * size });
      // Order block: last opposite-colour candle before the break, within the leg.
      for (let k = i - 1; k >= Math.max(ext, sw.index); k--) {
        const o = bars[k]!; if ((o.close - o.open) * dir >= 0) continue;
        r.zones.push({ kind: 'OB', dir, low: o.low, high: o.high, time: o.time, at: i, invalidatedAt: null }); break;
      }
    };
    if (lastHigh && lastHigh.index > brokenHigh && b.close > lastHigh.price) { brokenHigh = lastHigh.index; brk(1, lastHigh); }
    if (lastLow && lastLow.index > brokenLow && b.close < lastLow.price) { brokenLow = lastLow.index; brk(-1, lastLow); }

    // 4. Fair value gap formed by bars i-2..i.
    if (i >= 2) {
      const x = bars[i - 2]!; const min = Math.max(2 * tick, cfg.fvgMinAtr * a);
      if (b.low - x.high >= min) r.zones.push({ kind: 'FVG', dir: 1, low: x.high, high: b.low, time: bars[i - 1]!.time, at: i, invalidatedAt: null });
      if (x.low - b.high >= min) r.zones.push({ kind: 'FVG', dir: -1, low: b.high, high: x.low, time: bars[i - 1]!.time, at: i, invalidatedAt: null });
    }

    // 5. Confirm the swing P bars back (needs bars up to i only).
    const j = i - P;
    if (j >= P) {
      const c = bars[j]!; let hi = true; let lo = true;
      for (let k = j - P; k <= j + P; k++) { if (k === j) continue; const o = bars[k]!; if (o.high >= c.high) hi = false; if (o.low <= c.low) lo = false; }
      for (const [ok, kind] of [[hi, 'high'], [lo, 'low']] as const) {
        if (!ok) continue;
        const s: Swing = { kind, index: j, time: c.time, price: kind === 'high' ? c.high : c.low, at: i };
        r.swings.push(s);
        // Equal highs/lows: an untaken swing of the same side within tolerance.
        const twin = [...pools].reverse().find((p) => !p.done && p.swing.kind === kind && Math.abs(p.swing.price - s.price) <= cfg.equalTolAtr * a);
        let eq: EqualLevel | null = null;
        if (twin) { eq = { kind: kind === 'high' ? 'EQH' : 'EQL', price: (twin.swing.price + s.price) / 2, firstTime: twin.swing.time, secondTime: s.time, at: i, sweptAt: null }; r.equals.push(eq); twin.eq = eq; }
        pools.push({ swing: s, done: false, eq });
        if (kind === 'high') lastHigh = s; else lastLow = s;
      }
    }
  }
  return r;
}

/** What was knowable at bar index `cursor` (inclusive). */
export function smcAt(r: SmcResult, cursor: number): SmcResult {
  return {
    swings: r.swings.filter((x) => x.at <= cursor),
    equals: r.equals.filter((x) => x.at <= cursor).map((x) => ({ ...x, sweptAt: x.sweptAt !== null && x.sweptAt <= cursor ? x.sweptAt : null })),
    sweeps: r.sweeps.filter((x) => x.at <= cursor),
    breaks: r.breaks.filter((x) => x.at <= cursor),
    zones: r.zones.filter((x) => x.at <= cursor).map((x) => ({ ...x, invalidatedAt: x.invalidatedAt !== null && x.invalidatedAt <= cursor ? x.invalidatedAt : null })),
    ranges: r.ranges.filter((x) => x.at <= cursor),
  };
}
