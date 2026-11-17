import type { Candle } from './model';

/**
 * prompt-47/48 RESEARCH ONLY: multi-setup entry finder with a 0-100 quality score (no LONG/SHORT Pine indicators).
 * Not wired into the worker or the live Simulator. Pure, closed-candle only, no look-ahead.
 * SHORT runs the identical LONG rules on price-negated candles, so both sides are exact mirrors.
 */
export const MS = {
  emaFast: 9, emaSlow: 21, atrLen: 14, rsiLen: 14, volLen: 20, pivot: 3, htfPivot: 2, keep: 40,
  /** Price move the existing +25% net target needs (50x, 0.05% fee per side), before slippage. */
  tpMovePct: 1.0055 / 0.9995 - 1,
  maxAtrPct: 0.008, maxRangeAtr: 2.5, maxExtensionAtr: 2.5, minAtrPct: 0.0003, maxTickPct: 0.0005,
  sweepAge: [5, 120], sweepConfirmBars: 10, breakoutAge: [3, 90], retestBars: [2, 20], retestAtr: 0.3,
  srTouchAtr: 0.15, srVolume: 1.2,
} as const;

export const SETUPS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type SetupId = typeof SETUPS[number];
export const SETUP_NAMES: Record<SetupId, string> = {
  A: 'Liquidity sweep + reversal', B: 'Trend pullback + EMA 9/21 reclaim', C: 'Breakout + retest',
  D: 'Market structure break + retest', E: 'Momentum continuation after pullback', F: 'Support/resistance rejection + volume',
};
export type Side = 'LONG' | 'SHORT';
export interface Candidate { side: Side; entry: number; setups: SetupId[]; score: number; parts: Record<string, number> }

const flip = (c: Candle): Candle => ({ ...c, open: -c.open, close: -c.close, high: -c.low, low: -c.high });
class Ema { v: number | null = null; n = 0; sum = 0; constructor(private len: number) {}
  push(x: number) { if (this.v === null) { this.sum += x; if (++this.n === this.len) this.v = this.sum / this.len; } else this.v += (x - this.v) * 2 / (this.len + 1); return this.v; } }
class Wilder { v: number | null = null; n = 0; sum = 0; constructor(private len: number) {}
  push(x: number) { if (this.v === null) { this.sum += x; if (++this.n === this.len) this.v = this.sum / this.len; } else this.v = (this.v * (this.len - 1) + x) / this.len; return this.v; } }
interface Pivot { idx: number; price: number; used?: boolean }
class Pivots { highs: Pivot[] = []; lows: Pivot[] = []; bars: Candle[] = []; i = -1;
  constructor(private len: number, private keep: number) {}
  push(c: Candle) { this.bars.push(c); this.i++; if (this.bars.length > 2 * this.len + 1) this.bars.shift();
    if (this.bars.length === 2 * this.len + 1) { const m = this.bars[this.len]!; const o = this.bars.filter((_, k) => k !== this.len);
      if (o.every((b, k) => k < this.len ? b.high < m.high : b.high <= m.high)) this.highs.push({ idx: this.i - this.len, price: m.high });
      if (o.every((b, k) => k < this.len ? b.low > m.low : b.low >= m.low)) this.lows.push({ idx: this.i - this.len, price: m.low });
      if (this.highs.length > this.keep) this.highs.shift(); if (this.lows.length > this.keep) this.lows.shift(); } } }
class Htf { bar: Candle | null = null; emas: Ema[]; close: number | null = null; piv: Pivots;
  constructor(public minutes: number, lens: number[]) { this.emas = lens.map((l) => new Ema(l)); this.piv = new Pivots(MS.htfPivot, MS.keep); }
  closeBar(b: Candle) { this.close = b.close; for (const e of this.emas) e.push(b.close); this.piv.push(b); }
  addMinute(c: Candle) { const span = this.minutes * 60_000; const start = Math.floor(c.time / span) * span;
    if (!this.bar || this.bar.time !== start) this.bar = { ...c, time: start };
    else this.bar = { ...this.bar, high: Math.max(this.bar.high, c.high), low: Math.min(this.bar.low, c.low), close: c.close, volume: this.bar.volume + c.volume };
    if (c.time + 60_000 === start + span) { this.closeBar(this.bar); this.bar = null; } }
  structure(): 1 | -1 | 0 { const h = this.piv.highs.slice(-2), l = this.piv.lows.slice(-2); if (h.length < 2 || l.length < 2) return 0;
    if (h[1]!.price > h[0]!.price && l[1]!.price > l[0]!.price) return 1; if (h[1]!.price < h[0]!.price && l[1]!.price < l[0]!.price) return -1; return 0; } }

interface Breakout { idx: number; level: number; priorLowerHighs: boolean; retested: boolean; done: boolean }

/** One-direction finder in "LONG space". */
class Finder {
  e9 = new Ema(MS.emaFast); e21 = new Ema(MS.emaSlow); atr = new Wilder(MS.atrLen); gain = new Wilder(MS.rsiLen); loss = new Wilder(MS.rsiLen);
  piv = new Pivots(MS.pivot, MS.keep); m5 = new Htf(5, [9, 21]); m15 = new Htf(15, [50, 200]);
  vols: number[] = []; bars: Candle[] = []; e9h: number[] = []; prev: Candle | null = null; i = -1;
  sweep: { idx: number; low: number; level: number } | null = null; breakouts: Breakout[] = []; usedSupport = new Set<number>();
  constructor(public side: Side, private tick: number) {}
  seed(f15: Candle[], f5: Candle[]) { const f = this.side === 'SHORT' ? flip : (c: Candle) => c; for (const b of f15) this.m15.closeBar(f(b)); for (const b of f5) this.m5.closeBar(f(b)); }

  step(raw: Candle): Candidate | string | null {
    const c = this.side === 'SHORT' ? flip(raw) : raw; this.i++; const i = this.i; const p = this.prev; this.prev = c;
    this.m15.addMinute(c); this.m5.addMinute(c);
    const atr = p ? this.atr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close))) : null;
    let rsi: number | null = null; if (p) { const g = this.gain.push(Math.max(c.close - p.close, 0)), l = this.loss.push(Math.max(p.close - c.close, 0)); if (g !== null && l !== null) rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    const volAvg = this.vols.length >= MS.volLen ? this.vols.reduce((a, b) => a + b, 0) / this.vols.length : null;
    this.vols.push(c.volume); if (this.vols.length > MS.volLen) this.vols.shift();
    const e9 = this.e9.push(c.close), e21 = this.e21.push(c.close); const prior = this.bars.slice(); const priorE9 = this.e9h.slice();
    this.bars.push(c); if (this.bars.length > 40) this.bars.shift(); if (e9 !== null) { this.e9h.push(e9); if (this.e9h.length > 40) this.e9h.shift(); }
    const pivHighs = this.piv.highs, pivLows = this.piv.lows;
    const atrOk = atr !== null && atr > 0;
    // --- event tracking (always runs so levels stay consistent) ---
    if (atrOk) {
      const swept = [...pivLows].reverse().find((v) => !v.used && i - v.idx >= MS.sweepAge[0] && i - v.idx <= MS.sweepAge[1] && c.low < v.price && c.close > v.price);
      if (swept) { swept.used = true; this.sweep = { idx: i, low: c.low, level: swept.price }; }
      if (p) for (const h of pivHighs) if (!h.used && i - h.idx >= MS.breakoutAge[0] && i - h.idx <= MS.breakoutAge[1] && c.close > h.price && p.close <= h.price) {
        h.used = true; const before = pivHighs.filter((x) => x.idx < h.idx).slice(-1)[0];
        this.breakouts.push({ idx: i, level: h.price, priorLowerHighs: !!before && h.price < before.price, retested: false, done: false }); }
      for (const b of this.breakouts) { if (i > b.idx && c.low <= b.level + MS.retestAtr * atr!) b.retested = true; if (c.close < b.level - MS.retestAtr * atr!) b.done = true; }
      this.breakouts = this.breakouts.filter((b) => !b.done && i - b.idx <= MS.retestBars[1]);
    }
    this.piv.push(c);
    const [m5e9, m5e21] = this.m5.emas.map((e) => e.v); const [m15e50, m15e200] = this.m15.emas.map((e) => e.v);
    if (!p || !atrOk || rsi === null || volAvg === null || e9 === null || e21 === null || m5e9 == null || m5e21 == null || m15e50 == null || m15e200 == null) return null;
    const range = c.high - c.low; const body = c.close - c.open; const bull = body > 0; const microBos = bull && c.close > p.high;
    // --- setups ---
    const setups: SetupId[] = [];
    const sw = this.sweep;
    if (sw && i > sw.idx && i - sw.idx <= MS.sweepConfirmBars && c.low > sw.low && microBos && c.close > sw.level) { setups.push('A'); this.sweep = null; }
    if (sw && i - sw.idx > MS.sweepConfirmBars) this.sweep = null;
    const last6 = this.bars.slice(-6);
    if (m5e9 > m5e21 && last6.some((b) => b.low <= e21) && last6.every((b) => b.close >= e21 - 0.5 * atr!) && priorE9.length >= 3
      && prior.slice(-3).some((b, k) => b.close < priorE9[priorE9.length - 3 + k]!) && c.close > e9 && microBos) setups.push('B');
    for (const b of this.breakouts) if (b.retested && i - b.idx >= MS.retestBars[0] && microBos && c.low >= b.level - MS.retestAtr * atr!) {
      setups.push(b.priorLowerHighs ? 'D' : 'C'); b.done = true; break; }
    if (m5e9 > m5e21 && this.m5.close! > m5e9) {
      const win = prior.slice(-30); let k = -1; let hh = -Infinity; win.forEach((b, j) => { if (b.high > hh) { hh = b.high; k = j; } });
      const pull = k >= 0 ? win.slice(k + 1) : [];
      const base = Math.min(...win.slice(Math.max(0, k - 20), k + 1).map((b) => b.low));
      if (pull.length >= 2 && pull.length <= 10) { const depth = hh - Math.min(...pull.map((b) => b.low));
        if (depth <= 0.5 * (hh - base) && depth <= 1.5 * atr! && pull.every((b) => b.high - b.low <= 1.5 * atr!)
          && bull && body >= 0.6 * range && range >= 0.7 * atr! && c.close > Math.max(...pull.map((b) => b.high))) setups.push('E'); }
    }
    const supports = [...this.m5.piv.lows, ...this.m15.piv.lows].map((s) => s.price);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const sr = supports.find((s) => !this.usedSupport.has(s) && c.low <= s + MS.srTouchAtr * atr! && c.low >= s - 0.5 * atr! && c.close > s);
    if (sr !== undefined && lowerWick >= 0.5 * range && range > 0 && c.volume >= MS.srVolume * volAvg) { setups.push('F'); this.usedSupport.add(sr); }
    if (!setups.length) return null;
    // --- hard rejects ---
    const px = Math.abs(c.close); const atrPct = atr! / px; const tickPct = this.tick / px;
    if (atrPct > MS.maxAtrPct || range > MS.maxRangeAtr * atr!) return 'ERRATIC_PRICE';
    if (atrPct < MS.minAtrPct) return 'TOO_QUIET_FOR_TARGET';
    if (tickPct > MS.maxTickPct) return 'WIDE_SPREAD_PROXY';
    if (c.close - e21 > MS.maxExtensionAtr * atr!) return 'CHASING_EXTENDED_CANDLE';
    const tp = c.close + px * (MS.tpMovePct + 2 * Math.max(tickPct, 0.0002));
    const htfAbove = [...this.m5.piv.highs, ...this.m15.piv.highs].map((h) => h.price).filter((x) => x > c.close);
    if (htfAbove.some((x) => x <= tp)) return 'TP_BLOCKED_BY_RESISTANCE';
    if (m5e9 <= m5e21 && rsi < 45 && !setups.includes('A') && !setups.includes('F')) return 'NO_MOMENTUM';
    // --- score 0-100 ---
    const s15 = (c.close > m15e50 ? 8 : 0) + (m15e50 > m15e200 ? 7 : 0);
    const s5 = (m5e9 > m5e21 ? 10 : 0) + (this.m5.close! > m5e9 ? 5 : 0);
    const s1 = (microBos ? 8 : 0) + (bull && body >= 0.5 * range ? 7 : 0);
    const st = this.m5.structure() === 1 ? 10 : this.m5.structure() === 0 ? 5 : 0;
    const liq = setups.includes('A') || setups.includes('F') ? 10 : htfAbove.some((x) => x <= c.close + px * 0.03) ? 5 : 0;
    const vol = c.volume >= 1.5 * volAvg ? 10 : c.volume >= volAvg ? 6 : 0;
    const rs = rsi >= 45 && rsi <= 72 ? 5 : 0;
    const path = pivHighs.some((h) => h.price > c.close && h.price <= tp) ? 0 : 10;
    const next = Math.min(...htfAbove, Infinity);
    const room = next === Infinity || next - c.close >= 2 * (tp - c.close) ? 5 : 0;
    const vola = atrPct >= 0.0008 && atrPct <= 0.005 ? 5 : 0;
    const parts = { trend15: s15, momentum5: s5, confirm1: s1, structure: st, liquidity: liq, volume: vol, rsi: rs, tpPath: path, room, volatility: vola };
    const score = Object.values(parts).reduce((a, b) => a + b, 0);
    const sg = this.side === 'SHORT' ? -1 : 1;
    return { side: this.side, entry: sg * c.close, setups, score, parts };
  }
}

export class MultiSetup {
  long: Finder; short: Finder;
  constructor(tick: number) { this.long = new Finder('LONG', tick); this.short = new Finder('SHORT', tick); }
  seed(f15: Candle[], f5: Candle[]) { this.long.seed(f15, f5); this.short.seed(f15, f5); }
  step(c: Candle) { return [this.long.step(c), this.short.step(c)] as const; }
}
