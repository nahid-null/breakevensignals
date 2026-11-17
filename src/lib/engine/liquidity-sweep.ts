import type { Candle } from './model';

/**
 * prompt-46 RESEARCH ONLY: liquidity-sweep entry logic (no LONG/SHORT Pine indicators).
 * Not wired into the worker or the live Simulator. Pure, closed-candle only, no look-ahead.
 * SHORT is evaluated by running the identical LONG rules on price-negated candles, so both sides are exact mirrors.
 */
export const LS = {
  pivot: 3, htfPivot: 2, minPivotAge: 5, sweepLookback: 120, mssWindow: 30, retraceWindow: 30, confirmWindow: 5,
  volLen: 20, rsiLen: 14, atrLen: 14, rsiMin: 50, rsiMax: 70, maxAtrPct: 0.006, maxRangeAtr: 2, maxChaseAtr: 1,
  tpMovePct: 1.0055 / 0.9995 - 1, roomBuffer: 0.001, maxDrawPct: 0.03, levelMemory: 40,
} as const;

export type Side = 'LONG' | 'SHORT';
const flip = (c: Candle): Candle => ({ ...c, open: -c.open, close: -c.close, high: -c.low, low: -c.high });

interface Pivot { idx: number; price: number; swept?: boolean }
class Ema { v: number | null = null; n = 0; sum = 0; constructor(private len: number) {}
  push(x: number) { if (this.v === null) { this.sum += x; if (++this.n === this.len) this.v = this.sum / this.len; } else this.v += (x - this.v) * 2 / (this.len + 1); return this.v; } }
class Wilder { v: number | null = null; n = 0; sum = 0; constructor(private len: number) {}
  push(x: number) { if (this.v === null) { this.sum += x; if (++this.n === this.len) this.v = this.sum / this.len; } else this.v = (this.v * (this.len - 1) + x) / this.len; return this.v; } }

/** Pivot highs/lows confirmed `len` bars after the extreme. */
class Pivots { highs: Pivot[] = []; lows: Pivot[] = []; bars: Candle[] = []; i = -1;
  constructor(private len: number, private keep: number) {}
  push(c: Candle) { this.bars.push(c); this.i++; if (this.bars.length > 2 * this.len + 1) this.bars.shift();
    if (this.bars.length === 2 * this.len + 1) { const m = this.bars[this.len]!; const o = this.bars.filter((_, k) => k !== this.len);
      if (o.every((b, k) => k < this.len ? b.high < m.high : b.high <= m.high)) this.highs.push({ idx: this.i - this.len, price: m.high });
      if (o.every((b, k) => k < this.len ? b.low > m.low : b.low >= m.low)) this.lows.push({ idx: this.i - this.len, price: m.low });
      if (this.highs.length > this.keep) this.highs.shift(); if (this.lows.length > this.keep) this.lows.shift(); } } }

/** Closed higher-timeframe bars built from 1m candles (or fed directly from history). */
class Htf { bar: Candle | null = null; emas: Ema[]; close: number | null = null; piv: Pivots;
  constructor(public minutes: number, lens: number[]) { this.emas = lens.map((l) => new Ema(l)); this.piv = new Pivots(LS.htfPivot, LS.levelMemory); }
  closeBar(b: Candle) { this.close = b.close; for (const e of this.emas) e.push(b.close); this.piv.push(b); }
  addMinute(c: Candle) { const span = this.minutes * 60_000; const start = Math.floor(c.time / span) * span;
    if (!this.bar || this.bar.time !== start) this.bar = { ...c, time: start };
    else this.bar = { ...this.bar, high: Math.max(this.bar.high, c.high), low: Math.min(this.bar.low, c.low), close: c.close, volume: this.bar.volume + c.volume };
    if (c.time + 60_000 === start + span) { this.closeBar(this.bar); this.bar = null; } }
  /** HH+HL (1), LH+LL (-1) or mixed (0) from the last two confirmed swings. */
  structure(): 1 | -1 | 0 { const h = this.piv.highs.slice(-2), l = this.piv.lows.slice(-2); if (h.length < 2 || l.length < 2) return 0;
    if (h[1]!.price > h[0]!.price && l[1]!.price > l[0]!.price) return 1; if (h[1]!.price < h[0]!.price && l[1]!.price < l[0]!.price) return -1; return 0; } }

type Stage = { kind: 'swept'; idx: number; level: number; sweepLow: number; mss: number }
  | { kind: 'mss'; idx: number; level: number; sweepLow: number; mss: number; zoneTop: number; touched: number | null };
export interface Setup { side: Side; entry: number; sweptLevel: number; sweepExtreme: number; mssLevel: number; drawLevel: number }

/** One-direction detector working in "LONG space" (SHORT feeds negated candles). */
class Detector {
  piv = new Pivots(LS.pivot, LS.levelMemory); atr = new Wilder(LS.atrLen); gain = new Wilder(LS.rsiLen); loss = new Wilder(LS.rsiLen);
  vols: number[] = []; recent: Candle[] = []; prev: Candle | null = null; i = -1; stage: Stage | null = null;
  m15 = new Htf(15, [50, 200]); m5 = new Htf(5, [9, 21, 50]);
  constructor(public side: Side) {}
  seedHtf(fifteens: Candle[], fives: Candle[]) { const f = this.side === 'SHORT' ? flip : (c: Candle) => c; for (const b of fifteens) this.m15.closeBar(f(b)); for (const b of fives) this.m5.closeBar(f(b)); }
  /** Returns a setup on the candle's close, a rejection reason when a confirmed setup fails a quality filter, or null. */
  step(raw: Candle): Setup | string | null {
    const c = this.side === 'SHORT' ? flip(raw) : raw; this.i++; const i = this.i; const p = this.prev; this.prev = c;
    this.m15.addMinute(c); this.m5.addMinute(c);
    const atr = p ? this.atr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close))) : null;
    let rsi: number | null = null; if (p) { const g = this.gain.push(Math.max(c.close - p.close, 0)), l = this.loss.push(Math.max(p.close - c.close, 0)); if (g !== null && l !== null) rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    const volAvg = this.vols.length >= LS.volLen ? this.vols.reduce((a, b) => a + b, 0) / this.vols.length : null;
    this.vols.push(c.volume); if (this.vols.length > LS.volLen) this.vols.shift();
    this.recent.push(c); if (this.recent.length > 3) this.recent.shift();
    const lowsBefore = this.piv.lows, highsBefore = this.piv.highs;
    let out: Setup | string | null = null;
    const s = this.stage;
    if (s?.kind === 'swept') {
      if (c.low < s.sweepLow || i - s.idx > LS.mssWindow) this.stage = null;
      else if (c.close > s.mss) {
        // Fair value gap left by the displacement (low[i] > high[i-2]) extends the retrace zone upward.
        const r = this.recent; const fvgTop = r.length === 3 && r[2]!.low > r[0]!.high ? r[2]!.low : s.mss;
        this.stage = { ...s, kind: 'mss', idx: i, zoneTop: Math.max(s.mss, fvgTop), touched: null };
      }
    } else if (s?.kind === 'mss') {
      if (c.low <= s.sweepLow || i - s.idx > LS.retraceWindow || (s.touched !== null && i - s.touched > LS.confirmWindow)) this.stage = null;
      else { if (s.touched === null && c.low <= s.zoneTop) s.touched = i;
        if (s.touched !== null && c.close > c.open && c.close > s.mss) {
          const range = c.high - c.low; const lowerWick = Math.min(c.open, c.close) - c.low;
          out = this.quality(c, s, atr, rsi, volAvg, range, lowerWick); this.stage = null; } }
    }
    if (!this.stage && !out) {
      // Sweep: wick below an older unswept swing low, close back above it; never entered on this candle.
      const cand = [...lowsBefore].reverse().find((v) => !v.swept && i - v.idx >= LS.minPivotAge && i - v.idx <= LS.sweepLookback && c.low < v.price && c.close > v.price);
      if (cand) { cand.swept = true;
        const mss = [...highsBefore].reverse().find((h) => h.idx > cand.idx && h.idx < i && h.price > cand.price) ?? [...highsBefore].reverse().find((h) => h.idx < i && h.price > c.close);
        if (mss) this.stage = { kind: 'swept', idx: i, level: cand.price, sweepLow: c.low, mss: mss.price }; }
    }
    this.piv.push(c);
    return out;
  }
  private quality(c: Candle, s: Extract<Stage, { kind: 'mss' }>, atr: number | null, rsi: number | null, volAvg: number | null, range: number, lowerWick: number): Setup | string {
    const [e50, e200] = this.m15.emas.map((e) => e.v); const [e9, e21, e5_50] = this.m5.emas.map((e) => e.v);
    if (e50 == null || e200 == null || e9 == null || e21 == null || e5_50 == null || atr == null || rsi == null || volAvg == null) return 'WARMUP';
    if (!(this.m15.close! > e200 && e50 > e200) || this.m15.structure() === -1) return 'HTF_15M_NOT_ALIGNED';
    if (!(e9 > e21 && this.m5.close! > e5_50)) return 'HTF_5M_EMA_NOT_ALIGNED';
    if (this.m5.structure() !== 1) return 'NO_HH_HL_STRUCTURE';
    if (!(lowerWick >= 0.4 * range || c.close - c.low >= 0.66 * range)) return 'WEAK_REJECTION';
    if (c.volume < volAvg) return 'NO_VOLUME_CONFIRMATION';
    if (rsi <= LS.rsiMin || rsi >= LS.rsiMax) return 'RSI_CONFLICT';
    if (atr / Math.abs(c.close) > LS.maxAtrPct || range > LS.maxRangeAtr * atr) return 'HIGH_VOLATILITY';
    if (c.close - s.mss > LS.maxChaseAtr * atr) return 'TOO_FAR_FROM_ENTRY_ZONE';
    const tp = c.close + Math.abs(c.close) * (LS.tpMovePct + LS.roomBuffer);
    const above = [...this.piv.highs, ...this.m5.piv.highs, ...this.m15.piv.highs].map((h) => h.price).filter((x) => x > c.close);
    if (above.some((x) => x <= tp)) return 'TP_BLOCKED_BY_RESISTANCE';
    const draw = above.filter((x) => x <= c.close + Math.abs(c.close) * LS.maxDrawPct).sort((a, b) => a - b)[0];
    if (draw === undefined) return 'NO_LIQUIDITY_TARGET';
    const sg = this.side === 'SHORT' ? -1 : 1;
    return { side: this.side, entry: sg * c.close, sweptLevel: sg * s.level, sweepExtreme: sg * s.sweepLow, mssLevel: sg * s.mss, drawLevel: sg * draw };
  }
}

export class LiquiditySweep {
  long = new Detector('LONG'); short = new Detector('SHORT');
  seedHtf(fifteens: Candle[], fives: Candle[]) { this.long.seedHtf(fifteens, fives); this.short.seedHtf(fifteens, fives); }
  step(c: Candle) { return [this.long.step(c), this.short.step(c)] as const; }
}
