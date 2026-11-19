import { ema, rma, trueRange } from './calculations';
import { pineGe, pineGt, pineLe, pineLt } from './pine-numbers';
import type { Average, Candle } from './model';

/**
 * prompt-51: the user's "OB + Weighted VP | Entry Signals (5m)" indicator (src/pine/ob-vp-entry.pine),
 * default inputs, translated for confirmed 5-minute bars. Only the entry logic is ported: the Simulator follows the
 * signal's side and Entry Price (signal-candle close). The SL/TP values are kept for reference only; the indicator's
 * Early Exit block only draws labels and never changes entries, so it is intentionally not used.
 */
export const OBVP = {
  swingLen: 10, maxZones: 8, maxZoneATR: 3, useDelta: true, wickPct: 30, useEngulf: true, midClose: true, oneSig: true,
  minScore: 0, atrLen: 14, slBuf: 0.2, rrBase: 2, rr3: 3, rr4: 4, rr5: 5, rr6: 6, strongWick: 50, volMult: 1.5,
  deltaStr: 0.25, emaFastLen: 50, emaSlowLen: 200, tightATR: 1.5, vpBars: 200, vpRows: 30, pocHard: false,
  /** Bars kept for lookbacks: OB search reaches 300 bars back (301 values). */
  keep: 310,
} as const;
export const OBVP_INDICATOR = 'OB + Weighted VP 5m';

export interface ObvpZone { top: number; bot: number; str: number; dir: 1 | -1; bar: number; used: boolean }
export interface ObvpState {
  index: number; bars: Candle[]; atr: Average; atrValue: number | null; emaFast: number | null; emaSlow: number | null;
  poc: number | null; zones: ObvpZone[];
  shP: number | null; shI: number | null; shBroken: boolean; slP: number | null; slI: number | null; slBroken: boolean;
}
export interface ObvpSignal {
  direction: 'LONG' | 'SHORT'; entry: number; stopLoss: number; takeProfit: number; score: number; rr: number;
  /** Open time of the confirmed 5-minute signal candle. */
  time: number;
}

export function initialObvp(): ObvpState {
  return { index: -1, bars: [], atr: { value: null, seed: [] }, atrValue: null, emaFast: null, emaSlow: null, poc: null, zones: [],
    shP: null, shI: null, shBroken: true, slP: null, slI: null, slBroken: true };
}

/** ta.pivothigh/pivotlow(len, len): equal values on the left are allowed, equal values on the right invalidate. */
function pivot(bars: Candle[], len: number, kind: 'high' | 'low'): number | null {
  const width = 2 * len + 1;
  if (bars.length < width) return null;
  const w = bars.slice(-width); const v = w[len]![kind];
  const ok = w.every((c, i) => i === len || (kind === 'high'
    ? (i < len ? c.high <= v : c.high < v)
    : (i < len ? c.low >= v : c.low > v)));
  return ok ? v : null;
}

/** Process one confirmed 5-minute bar. Returns the indicator's LONG/SHORT signals on this bar (at most one each). */
export function processObvp(s: ObvpState, c: Candle): ObvpSignal[] {
  const P = OBVP;
  const prev = s.bars.at(-1);
  s.bars.push(c); if (s.bars.length > P.keep) s.bars.splice(0, s.bars.length - P.keep);
  s.index += 1;
  const bi = s.index; const n0 = s.bars.length;
  // series[i] = value i bars ago; undefined when unavailable (Pine na).
  const at = (i: number): Candle | undefined => (i <= bi ? s.bars[n0 - 1 - i] : undefined);

  // ------------------------------ Core series ----------------------------
  s.atrValue = rma(s.atr, trueRange(c, prev), P.atrLen);
  const atr = s.atrValue;
  const ph = pivot(s.bars, P.swingLen, 'high');
  const pl = pivot(s.bars, P.swingLen, 'low');
  let vpTop: number | null = null; let vpBot: number | null = null;
  if (bi + 1 >= P.vpBars) {
    vpTop = -Infinity; vpBot = Infinity;
    for (let i = 0; i < P.vpBars; i++) { const b = at(i)!; vpTop = Math.max(vpTop, b.high); vpBot = Math.min(vpBot, b.low); }
  }
  let volMA: number | null = null;
  if (bi + 1 >= 20) { let sum = 0; for (let i = 0; i < 20; i++) sum += at(i)!.volume; volMA = sum / 20; }
  s.emaFast = ema(s.emaFast, c.close, P.emaFastLen);
  s.emaSlow = ema(s.emaSlow, c.close, P.emaSlowLen);

  // ------------------------------ Weighted VP POC ("Normal" weighting) ---
  if (vpTop !== null && vpBot !== null && pineGt(vpTop, vpBot)) {
    const stp = (vpTop - vpBot) / P.vpRows;
    const rowVol = new Array<number>(P.vpRows).fill(0);
    for (let i = 0; i < P.vpBars; i++) {
      const b = at(i); if (!b) continue;
      const v = b.volume;
      const r1 = Math.max(0, Math.min(P.vpRows - 1, Math.floor((vpTop - b.high) / stp)));
      const r2 = Math.max(0, Math.min(P.vpRows - 1, Math.floor((vpTop - b.low) / stp)));
      for (let r = r1; r <= r2; r++) rowVol[r] = rowVol[r]! + v;
    }
    const mx = Math.max(...rowVol);
    const mxIdx = rowVol.indexOf(mx);
    s.poc = vpTop - stp * (mxIdx + 0.5);
  }
  const poc = s.poc;

  // ------------------------------ Candle patterns ------------------------
  const rng = c.high - c.low;
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const bullRej = pineGt(c.close, c.open) && pineGt(rng, 0) && pineGe(lowerWick / rng, P.wickPct / 100);
  const bearRej = pineLt(c.close, c.open) && pineGt(rng, 0) && pineGe(upperWick / rng, P.wickPct / 100);
  const bullEng = P.useEngulf && !!prev && pineGt(c.close, c.open) && pineLt(prev.close, prev.open) && pineGt(c.close, prev.open);
  const bearEng = P.useEngulf && !!prev && pineLt(c.close, c.open) && pineGt(prev.close, prev.open) && pineLt(c.close, prev.open);
  const bullTrig = bullRej || bullEng; const bearTrig = bearRej || bearEng;

  // ------------------------------ Swing update ---------------------------
  if (ph !== null) { s.shP = ph; s.shI = bi - P.swingLen; s.shBroken = false; }
  if (pl !== null) { s.slP = pl; s.slI = bi - P.swingLen; s.slBroken = false; }

  const addZone = (t: number, b: number, dir: 1 | -1, dRatio: number) => {
    if (s.zones.length >= P.maxZones) s.zones.shift();
    s.zones.push({ top: t, bot: b, str: dRatio, dir, bar: bi, used: false });
  };
  const impulse = (off: number) => {
    let delta = 0; let totV = 0;
    for (let i = 0; i <= off; i++) { const b = at(i); const v = b?.volume ?? 0; delta += (b && pineGt(b.close, b.open) ? 1 : -1) * v; totV += v; }
    return { delta, dRatio: totV > 0 ? Math.abs(delta) / totV : 0 };
  };

  // ---- Bullish BOS -> Bullish OB (lowest candle between swing high and BOS)
  if (s.shP !== null && !s.shBroken && pineGt(c.close, s.shP)) {
    s.shBroken = true;
    const n = Math.max(1, Math.min(bi - s.shI!, 300));
    let ext = c.low; let off = 0;
    for (let i = 1; i <= n; i++) { const b = at(i); if (b && pineLt(b.low, ext)) { ext = b.low; off = i; } }
    const zt = at(off)!.high; const zb = at(off)!.low;
    const { delta, dRatio } = impulse(off);
    if (atr !== null && pineLe(zt - zb, atr * P.maxZoneATR) && (!P.useDelta || pineGt(delta, 0))) addZone(zt, zb, 1, dRatio);
  }
  // ---- Bearish BOS -> Bearish OB (highest candle between swing low and BOS)
  if (s.slP !== null && !s.slBroken && pineLt(c.close, s.slP)) {
    s.slBroken = true;
    const n = Math.max(1, Math.min(bi - s.slI!, 300));
    let ext = c.high; let off = 0;
    for (let i = 1; i <= n; i++) { const b = at(i); if (b && pineGt(b.high, ext)) { ext = b.high; off = i; } }
    const zt = at(off)!.high; const zb = at(off)!.low;
    const { delta, dRatio } = impulse(off);
    if (atr !== null && pineLe(zt - zb, atr * P.maxZoneATR) && (!P.useDelta || pineLt(delta, 0))) addZone(zt, zb, -1, dRatio);
  }

  // ---- Process zones: invalidation + retest signals
  const out: ObvpSignal[] = [];
  let longSig = false; let shortSig = false;
  const rrFor = (score: number) => score >= 6 ? P.rr6 : score === 5 ? P.rr5 : score === 4 ? P.rr4 : score === 3 ? P.rr3 : P.rrBase;
  for (let k = s.zones.length - 1; k >= 0; k--) {
    const z = s.zones[k]!; const t = z.top; const b = z.bot;
    const broken = z.dir === 1 ? pineLt(c.close, b) : pineGt(c.close, t);
    if (broken) { s.zones.splice(k, 1); continue; }
    if (!(bi > z.bar && !(P.oneSig && z.used))) continue;
    const mid = (t + b) / 2;
    const volSpike = volMA !== null && pineGt(c.volume, volMA * P.volMult);
    const tight = atr !== null && pineLe(t - b, atr * P.tightATR);
    const emaUp = s.emaFast !== null && s.emaSlow !== null && pineGt(s.emaFast, s.emaSlow);
    const emaDn = s.emaFast !== null && s.emaSlow !== null && pineLt(s.emaFast, s.emaSlow);
    if (z.dir === 1 && !longSig && pineLe(c.low, t) && pineGt(c.close, b) && bullTrig && (!P.midClose || pineGt(c.close, mid))
      && (!P.pocHard || poc === null || pineGt(c.close, poc))) {
      let score = 0;
      score += ((pineGt(rng, 0) && pineGe(lowerWick / rng, P.strongWick / 100)) || bullEng) ? 1 : 0;
      score += volSpike ? 1 : 0;
      score += pineGe(z.str, P.deltaStr) ? 1 : 0;
      score += (poc !== null && pineGt(c.close, poc)) ? 1 : 0;
      score += emaUp ? 1 : 0;
      score += tight ? 1 : 0;
      if (score >= P.minScore && atr !== null) {
        const rr = rrFor(score); const sl = b - atr * P.slBuf; const tp = c.close + (c.close - sl) * rr;
        longSig = true; z.used = true;
        out.push({ direction: 'LONG', entry: c.close, stopLoss: sl, takeProfit: tp, score, rr, time: c.time });
      }
    } else if (z.dir === -1 && !shortSig && pineGe(c.high, b) && pineLt(c.close, t) && bearTrig && (!P.midClose || pineLt(c.close, mid))
      && (!P.pocHard || poc === null || pineLt(c.close, poc))) {
      let score = 0;
      score += ((pineGt(rng, 0) && pineGe(upperWick / rng, P.strongWick / 100)) || bearEng) ? 1 : 0;
      score += volSpike ? 1 : 0;
      score += pineGe(z.str, P.deltaStr) ? 1 : 0;
      score += (poc !== null && pineLt(c.close, poc)) ? 1 : 0;
      score += emaDn ? 1 : 0;
      score += tight ? 1 : 0;
      if (score >= P.minScore && atr !== null) {
        const rr = rrFor(score); const sl = t + atr * P.slBuf; const tp = c.close - (sl - c.close) * rr;
        shortSig = true; z.used = true;
        out.push({ direction: 'SHORT', entry: c.close, stopLoss: sl, takeProfit: tp, score, rr, time: c.time });
      }
    }
  }
  return out;
}

/** One indicator signal as sent to the Simulator (separate from Pine signal events, so it never creates Pine positions). */
export interface SimulatorEntry {
  trade_id: string; symbol: string; direction: 'LONG' | 'SHORT'; indicator: string; timeframe: '5';
  entry_price: number; stop_loss: number; take_profit: number; score: number; rr: number; signal_time: string;
}
export function toSimulatorEntry(symbol: string, x: ObvpSignal): SimulatorEntry {
  return { trade_id: `${symbol}-OBVP5-${x.direction === 'LONG' ? 'L' : 'S'}-${x.time}`, symbol, direction: x.direction,
    indicator: OBVP_INDICATOR, timeframe: '5', entry_price: x.entry, stop_loss: x.stopLoss, take_profit: x.takeProfit,
    score: x.score, rr: x.rr, signal_time: new Date(x.time + 5 * 60_000).toISOString() };
}
