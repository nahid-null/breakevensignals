import { pineGe, pineGt, pineLe, pineLt } from './pine-numbers';
import type { Candle } from './model';

/**
 * prompt-63: the user's "OB STRONG Entry Signals (Long/Short)" Pine v6 indicator (intact source src/pine/ob-strong-entry.pine),
 * default inputs, on closed Binance SPOT 5-minute bars. Only the signal logic is ported (drawing code is not). A signal is the
 * close of the retest candle (the label's Entry), scored 0..6; only score >= 5 is a signal. Same logic as the tested
 * research/prompt-61/ob61.py, evaluated at the retest candle's own close instead of on the next bar.
 */
export const OBS = { swing: 5, bins: 40, maxObs: 50, spacing: 4, minScore: 5, minWick: 40, volLen: 20, volMult: 1.2, emaLen: 100,
  maxRiskAtr: 3, minDelta: 55, rr: 2 } as const;
export const OBS_INDICATOR = 'OB STRONG 5m';

export interface ObsZone { left: number; created: number; top: number; bottom: number; bull: boolean; active: boolean; retested: boolean;
  hasDelta: boolean; bullPct: number; bearPct: number }
export interface ObStrongState {
  bars: Candle[]; atr: (number | null)[]; ema: (number | null)[]; vma: (number | null)[]; trSeed: number[];
  obs: ObsZone[]; lastBull: number | null; lastBear: number | null;
  shP: number | null; shI: number | null; slP: number | null; slI: number | null;
  slEnd: (number | null)[]; shEnd: (number | null)[]; bbn: boolean[]; bun: boolean[];
}
export interface ObStrongSignal { direction: 'LONG' | 'SHORT'; entry: number; stopLoss: number; takeProfit: number; score: number; time: number }

export function initialObStrong(): ObStrongState {
  return { bars: [], atr: [], ema: [], vma: [], trSeed: [], obs: [], lastBull: null, lastBear: null, shP: null, shI: null, slP: null, slI: null,
    slEnd: [], shEnd: [], bbn: [], bun: [] };
}

const pineRound = (x: number) => Math.floor(x + 0.5);

/** Process one closed 5-minute bar; returns the score >= 5 signals whose signal candle is this bar. */
export function processObStrong(s: ObStrongState, c: Candle): ObStrongSignal[] {
  const P = OBS; s.bars.push(c); const B = s.bars; const b = B.length - 1;
  const H = (i: number) => B[i]!.high; const L = (i: number) => B[i]!.low; const O = (i: number) => B[i]!.open; const C = (i: number) => B[i]!.close;
  const V = (i: number) => B[i]!.volume;
  // ta.atr(14) (RMA seeded by SMA), ta.ema(close, 100) (SMA seed), ta.sma(volume, 20)
  const tr = b === 0 ? H(0) - L(0) : Math.max(H(b) - L(b), Math.abs(H(b) - C(b - 1)), Math.abs(L(b) - C(b - 1)));
  if (b < 14) s.trSeed.push(tr);
  s.atr.push(b === 13 ? s.trSeed.reduce((a, x) => a + x, 0) / 14 : b > 13 ? (s.atr[b - 1]! * 13 + tr) / 14 : null);
  if (b === P.emaLen - 1) { let t = 0; for (let i = 0; i < P.emaLen; i++) t += C(i); s.ema.push(t / P.emaLen); }
  else if (b >= P.emaLen) { const a = 2 / (P.emaLen + 1); s.ema.push(a * C(b) + (1 - a) * s.ema[b - 1]!); } else s.ema.push(null);
  if (b >= P.volLen - 1) { let t = 0; for (let i = b - P.volLen + 1; i <= b; i++) t += V(i); s.vma.push(t / P.volLen); } else s.vma.push(null);

  const n = P.swing;
  const pivot = (kind: 'h' | 'l'): number | null => {
    if (b < 2 * n) return null; const m = b - n;
    if (kind === 'h') { const v = H(m); for (let i = m - n; i < m; i++) if (!(H(i) <= v)) return null; for (let i = m + 1; i <= b; i++) if (!(H(i) < v)) return null; return v; }
    const v = L(m); for (let i = m - n; i < m; i++) if (!(L(i) >= v)) return null; for (let i = m + 1; i <= b; i++) if (!(L(i) > v)) return null; return v;
  };
  const ph = pivot('h'); const pl = pivot('l');
  if (ph !== null) { s.shP = ph; s.shI = b - n; }
  if (pl !== null) { s.slP = pl; s.slI = b - n; }
  s.bbn.push(s.slP !== null && s.slI !== null && b > s.slI && b >= 1 && C(b) < s.slP && C(b - 1) >= s.slP);
  s.bun.push(s.shP !== null && s.shI !== null && b > s.shI && b >= 1 && C(b) > s.shP && C(b - 1) <= s.shP);

  const mostTouched = (f: number, t: number): number | null => {
    if (t - f <= 0) return null; let minP = Infinity; let maxP = -Infinity;
    for (let i = f; i <= t; i++) { minP = Math.min(minP, L(i)); maxP = Math.max(maxP, H(i)); }
    if (!(minP < maxP)) return null; const step = (maxP - minP) / P.bins; const diff = new Array<number>(P.bins).fill(0);
    for (let i = f; i <= t; i++) {
      const st = Math.min(Math.max(Math.floor((L(i) - minP) / step), 0), P.bins - 1); const en = Math.min(Math.max(Math.floor((H(i) - minP) / step), 0), P.bins - 1);
      diff[st]! += 1; if (en + 1 < P.bins) diff[en + 1]! -= 1;
    }
    let best = 0; let bestc = 0; let run = 0;
    for (let i = 0; i < P.bins; i++) { run += diff[i]!; if (run > bestc) { bestc = run; best = i; } }
    return minP + (best + 0.5) * step;
  };
  const hasGap = (a: number, bos: number, bull: boolean) => {
    const f = Math.min(a, bos); const t = Math.max(a, bos);
    for (let i = f + 1; i <= t; i++) { if (bull && L(i) > H(i - 1)) return true; if (!bull && H(i) < L(i - 1)) return true; }
    return false;
  };
  const overlaps = (top: number, bot: number) => { const zT = Math.max(top, bot); const zB = Math.min(top, bot);
    return s.obs.some((o) => o.active && zT >= Math.min(o.top, o.bottom) && zB <= Math.max(o.top, o.bottom)); };
  const prune = () => {
    const minLeft = Math.max(0, b - 4999); s.obs = s.obs.filter((o) => !(o.left < minLeft));
    while (s.obs.length > P.maxObs) { let k = -1; for (let j = s.obs.length - 1; j >= 0; j--) if (!s.obs[j]!.active) { k = j; break; }
      if (k >= 0) s.obs.splice(k, 1); else s.obs.pop(); }
  };
  for (const bear of [true, false]) {
    if (!(b >= 1 && (bear ? s.bbn : s.bun)[b - 1])) continue;
    const bos = b - 1; const f = (bear ? s.slEnd : s.shEnd)[b - 1] ?? null; const t = b - 1;
    const poc = f !== null ? mostTouched(f, t) : null;
    if (poc !== null && f !== null) {
      let k = 0; let tv = 0; let bv = 0;
      for (let i = f; i <= t; i++) if (L(i) <= poc && H(i) >= poc) { k++; tv += V(i); if (C(i) > O(i)) bv += V(i); }
      if (k > 0) {
        let best: number | null = null; let ext: number | null = null;
        for (let idx = t; idx >= f; idx--) {
          let ok: boolean;
          if (bear) { ext = ext === null ? H(idx) : Math.max(ext, H(idx)); ok = H(idx) === ext; }
          else { ext = ext === null ? L(idx) : Math.min(ext, L(idx)); ok = L(idx) === ext; }
          if (L(idx) <= poc && H(idx) >= poc && ok) best = idx;
        }
        if (best !== null && !hasGap(best, bos, !bear) && !overlaps(H(best), L(best))) {
          const hasDelta = tv > 0; const bullPct = hasDelta ? pineRound(bv / tv * 100) : 50;
          s.obs.unshift({ left: best, created: bos, top: H(best), bottom: L(best), bull: !bear, active: true, retested: false,
            hasDelta, bullPct, bearPct: hasDelta ? 100 - bullPct : 50 });
          prune();
        }
      }
    }
    if (bear) { s.slP = null; s.slI = null; } else { s.shP = null; s.shI = null; }
  }
  for (const o of s.obs) if (o.active && (o.bull ? L(b) < o.bottom : H(b) > o.top)) o.active = false;
  // Retest of this bar (the Pine script evaluates it on the next bar with identical inputs).
  const out: ObStrongSignal[] = []; const j = b; const o1 = O(j); const h1 = H(j); const l1 = L(j); const c1 = C(j); const rng = h1 - l1;
  for (const o of s.obs) {
    // Pine evaluates on the next bar after its age prune (left < bar - 4999), so mirror that cutoff here.
    if (!o.active || o.left < b + 1 - 4999) continue;
    const rt = o.bull ? (o1 > o.top && c1 > o.top && l1 <= o.top && l1 >= o.bottom) : (o1 < o.bottom && c1 < o.bottom && h1 >= o.bottom && h1 <= o.top);
    if (!(rt && j > o.created)) continue;
    const first = !o.retested; o.retested = true;
    const last = o.bull ? s.lastBull : s.lastBear;
    if (!(last === null || j - last >= P.spacing)) continue;
    const dirOk = o.bull ? c1 > o1 : c1 < o1;
    const wick = o.bull ? Math.min(o1, c1) - l1 : h1 - Math.max(o1, c1); const wpct = rng > 0 ? wick / rng * 100 : 0;
    const vma = s.vma[j] ?? null; const ema = s.ema[j] ?? null; const atr = s.atr[j] ?? null;
    const slp = o.bull ? o.bottom : o.top; const risk = Math.abs(c1 - slp);
    const parts = [dirOk && pineGe(wpct, P.minWick), vma !== null && vma > 0 && pineGe(V(j), vma * P.volMult),
      ema !== null && (o.bull ? pineGt(c1, ema) : pineLt(c1, ema)), first,
      atr !== null && atr > 0 && risk > 0 && pineLe(risk, P.maxRiskAtr * atr), o.hasDelta && pineGe(o.bull ? o.bullPct : o.bearPct, P.minDelta)];
    const score = parts.filter(Boolean).length;
    if (score < P.minScore) continue;
    if (o.bull) s.lastBull = j; else s.lastBear = j;
    out.push({ direction: o.bull ? 'LONG' : 'SHORT', entry: c1, stopLoss: slp, takeProfit: o.bull ? c1 + risk * P.rr : c1 - risk * P.rr, score, time: c.time });
  }
  s.slEnd.push(s.slI); s.shEnd.push(s.shI);
  return out;
}

/** One indicator signal as sent to the Simulator (separate from Pine signal events, so it never creates Pine positions). */
export interface SimulatorEntry {
  trade_id: string; symbol: string; direction: 'LONG' | 'SHORT'; indicator: string; timeframe: '5';
  entry_price: number; stop_loss: number; take_profit: number; score: number; rr: number; signal_time: string;
}
export function toSimulatorEntry(symbol: string, x: ObStrongSignal): SimulatorEntry {
  return { trade_id: `${symbol}-OBS5-${x.direction === 'LONG' ? 'L' : 'S'}-${x.time}`, symbol, direction: x.direction,
    indicator: OBS_INDICATOR, timeframe: '5', entry_price: x.entry, stop_loss: x.stopLoss, take_profit: x.takeProfit,
    score: x.score, rr: OBS.rr, signal_time: new Date(x.time + 5 * 60_000).toISOString() };
}

/** prompt-62/63 Simulator rules (mirrored in public.simulate_engine_candle OBSTRONG5_SPOT): 7 slots x 5% of balance, 75x, +50% target, 9 coins. */
export const OBS_SIM = { slots: 7, marginShare: 0.05, leverage: 75, targetRoi: 0.5,
  coins: ['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT', 'NEARUSDT', 'BCHUSDT', 'LTCUSDT', 'ADAUSDT', 'AVAXUSDT'] } as const;
export const isTradingCoin = (symbol: string) => (OBS_SIM.coins as readonly string[]).includes(symbol);
