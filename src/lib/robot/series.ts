import { Atr, Ema, Macd, Rsi, Sma, Vwap } from './indicators';

export type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export const MINUTE = 60_000;
const KEEP_BARS = 150;
const PIVOT_SIDE = 3;
const KEEP_LEVELS = 40;

/** One timeframe of closed bars with incremental indicators and confirmed pivots. */
export class Timeframe {
  bars: Bar[] = [];
  ema9 = new Ema(9); ema21 = new Ema(21); ema50 = new Ema(50);
  rsi = new Rsi(); atr = new Atr(); macd = new Macd(); vol = new Sma(20); vwap = new Vwap();
  prevRsi: number | null = null; prevHist: number | null = null; prevHist2: number | null = null;
  prevVol: number | null = null;
  constructor(readonly minutes: number) {}
  /** Returns pivots confirmed by this bar (located PIVOT_SIDE bars back). */
  update(b: Bar): { highs: Bar[]; lows: Bar[] } {
    this.prevRsi = this.rsi.value; this.prevHist2 = this.prevHist; this.prevHist = this.macd.hist; this.prevVol = this.vol.value;
    this.ema9.update(b.close); this.ema21.update(b.close); this.ema50.update(b.close);
    this.rsi.update(b.close); this.atr.update(b.high, b.low, b.close); this.macd.update(b.close);
    this.vol.update(b.volume); this.vwap.update(b.time, b.high, b.low, b.close, b.volume);
    this.bars.push(b); if (this.bars.length > KEEP_BARS) this.bars.shift();
    const n = this.bars.length; const i = n - 1 - PIVOT_SIDE;
    const out = { highs: [] as Bar[], lows: [] as Bar[] };
    if (i < PIVOT_SIDE) return out;
    const p = this.bars[i]!;
    let high = true; let low = true;
    for (let k = i - PIVOT_SIDE; k <= i + PIVOT_SIDE; k++) {
      if (k === i) continue;
      const o = this.bars[k]!;
      if (o.high >= p.high) high = false;
      if (o.low <= p.low) low = false;
    }
    if (high) out.highs.push(p);
    if (low) out.lows.push(p);
    return out;
  }
  last(offset = 0) { return this.bars[this.bars.length - 1 - offset]; }
  /** +1 bullish stack, -1 bearish stack, 0 otherwise. */
  trend(strict: boolean): 1 | -1 | 0 {
    const c = this.last()?.close; const a = this.ema9.value; const b = this.ema21.value; const s = this.ema50.value;
    if (c === undefined || a === null || b === null || (strict && s === null)) return 0;
    if (strict) {
      if (a > b && b > s! && c > s!) return 1;
      if (a < b && b < s! && c < s!) return -1;
      return 0;
    }
    if (a > b && c > b) return 1;
    if (a < b && c < b) return -1;
    return 0;
  }
}

/** A liquidity pool: resting stops are assumed beyond an unswept swing high (buy-side) or low (sell-side). */
export type Level = { side: 'high' | 'low'; price: number; tf: number; time: number; touches: number;
  sweptAt: number | null; sweepExtreme: number | null; sweepBar: Bar | null };

export class SymbolState {
  m1 = new Timeframe(1); m5 = new Timeframe(5); m15 = new Timeframe(15); m60 = new Timeframe(60);
  /** True when this update closed a 5m signal bar. */
  signalClosed = false;
  levels: Level[] = [];
  lastTime: number | null = null; count = 0;
  private buckets: { 5: Bar | null; 15: Bar | null; 60: Bar | null } = { 5: null, 15: null, 60: null };
  private qv: number[] = []; quoteVolume24h = 0;
  constructor(readonly symbol: string, public tickSize: number) {}

  update(c: Bar) {
    if (this.lastTime !== null && c.time <= this.lastTime) return false;
    this.lastTime = c.time; this.count++;
    const q = c.close * c.volume; this.qv.push(q); this.quoteVolume24h += q;
    if (this.qv.length > 1440) this.quoteVolume24h -= this.qv.shift() ?? 0;
    this.signalClosed = false;
    this.markSweeps(c);
    this.addPivots(this.m1, this.m1.update(c));
    for (const tf of [this.m5, this.m15, this.m60]) {
      const span = tf.minutes * MINUTE; const start = Math.floor(c.time / span) * span;
      const key = tf.minutes as 5 | 15 | 60;
      let bucket = this.buckets[key];
      if (bucket && bucket.time !== start) { this.addPivots(tf, tf.update(bucket)); bucket = null; }
      bucket = bucket ? { ...bucket, high: Math.max(bucket.high, c.high), low: Math.min(bucket.low, c.low), close: c.close, volume: bucket.volume + c.volume }
        : { time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      if (c.time + MINUTE === start + span) { this.addPivots(tf, tf.update(bucket)); bucket = null; if (tf.minutes === 5) this.signalClosed = true; }
      this.buckets[key] = bucket;
    }
    return true;
  }
  private markSweeps(c: Bar) {
    for (const l of this.levels) {
      if (l.sweptAt !== null) continue;
      if (l.side === 'high' && c.high > l.price) { l.sweptAt = c.time; l.sweepExtreme = c.high; l.sweepBar = c; }
      if (l.side === 'low' && c.low < l.price) { l.sweptAt = c.time; l.sweepExtreme = c.low; l.sweepBar = c; }
    }
    // Track the extreme reached after the sweep so a deeper break is not mistaken for a reclaim.
    for (const l of this.levels) {
      if (l.sweptAt === null || l.sweptAt === c.time) continue;
      if (l.side === 'low') l.sweepExtreme = Math.min(l.sweepExtreme ?? c.low, c.low);
      else l.sweepExtreme = Math.max(l.sweepExtreme ?? c.high, c.high);
    }
  }
  private addPivots(tf: Timeframe, p: { highs: Bar[]; lows: Bar[] }) {
    const atr = tf.atr.value ?? 0;
    const add = (side: 'high' | 'low', b: Bar) => {
      const price = side === 'high' ? b.high : b.low;
      const twin = this.levels.find((l) => l.side === side && l.sweptAt === null && Math.abs(l.price - price) <= Math.max(atr * 0.15, this.tickSize));
      if (twin) { twin.touches++; twin.tf = Math.max(twin.tf, tf.minutes); twin.price = side === 'high' ? Math.max(twin.price, price) : Math.min(twin.price, price); return; }
      this.levels.push({ side, price, tf: tf.minutes, time: b.time, touches: 1, sweptAt: null, sweepExtreme: null, sweepBar: null });
    };
    for (const b of p.highs) add('high', b);
    for (const b of p.lows) add('low', b);
    if (this.levels.length > KEEP_LEVELS * 2) {
      // Drop the oldest levels first; swept levels older than 30 minutes are no longer useful.
      const now = this.lastTime ?? 0;
      this.levels = this.levels.filter((l) => l.sweptAt === null || now - l.sweptAt < 30 * MINUTE).slice(-KEEP_LEVELS * 2);
    }
  }
  ready() {
    return this.m5.ema50.value !== null && this.m15.ema50.value !== null && this.m60.ema50.value !== null
      && this.m5.macd.hist !== null && this.m5.atr.value !== null && this.m5.vol.value !== null && this.m1.atr.value !== null;
  }
}
