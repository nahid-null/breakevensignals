/**
 * Faithful TypeScript port of the user's Pine v5 indicator
 * "Candle Pattern Entry Signals (38 Patterns)" (CPES, Candle_Pattern_Signals_1m_3-2.pine).
 * Default inputs only; every pattern, filter and the cooldown are copied 1:1.
 * Float comparisons use Pine's nine-fractional-digit operand rule (pine-numbers.ts).
 * Signals are evaluated on CLOSED bars only (barstate.isconfirmed).
 */
import { pineGe as GE, pineGt as GT, pineLe as LE, pineLt as LT } from '@/lib/engine/pine-numbers';

export type Bar = { t: number; o: number; h: number; l: number; c: number };
export type CpesSignal = { index: number; t: number; side: 'LONG' | 'SHORT'; patterns: string[]; price: number };

export const CPES_DEFAULTS = {
  useTrend: true, trendLen: 20, avgLen: 14, longMult: 1.0, smallMult: 0.6, minRngMult: 0.6, tolMult: 0.10,
  strictGap: false, cooldown: 2, enBullRev: true, enBullCon: true, enBearRev: true, enBearCon: true,
  disabledStr: '', strongOnly: true, rsiFilter: true, rsiLen: 14, rsiBand: 45, locFilter: true, locLen: 10,
  adxFilter: true, adxMax: 30,
} as const;
export type CpesInputs = { -readonly [K in keyof typeof CPES_DEFAULTS]: (typeof CPES_DEFAULTS)[K] extends boolean ? boolean : (typeof CPES_DEFAULTS)[K] extends number ? number : string };

export const STRONG_IDS = [1, 3, 4, 9, 10, 11, 12, 22, 28, 32, 34, 35, 36, 38];
export const LONG_REV: [number, string][] = [[1, 'Bullish Engulfing'], [2, 'Hammer'], [3, 'Morning Star'], [4, 'Piercing Line'], [5, 'Bullish Harami'], [6, 'Three White Soldiers'], [7, 'Inverted Hammer'], [8, 'Dragonfly Doji'], [9, 'Bullish Abandoned Baby'], [10, 'Three Inside Up'], [11, 'Three Outside Up'], [12, 'Bullish Kicker'], [13, 'Tweezer Bottom'], [15, 'Concealing Baby Swallow'], [18, 'Bullish Belt Hold'], [20, 'Ladder Bottom'], [21, 'Meeting Lines']];
export const LONG_CON: [number, string][] = [[14, 'Rising Three Methods'], [16, 'Mat Hold'], [17, 'Bullish Separating Lines'], [19, 'Three-Line Strike']];
export const SHORT_REV: [number, string][] = [[22, 'Bearish Engulfing'], [23, 'Bearish Belt Hold'], [26, 'Hanging Man'], [27, 'Upside Gap Two Crows'], [28, 'Evening Star'], [29, 'Shooting Star'], [30, 'Bearish Harami'], [31, 'Bearish Doji Star'], [32, 'Bearish Abandoned Baby'], [33, 'Tweezer Top'], [34, 'Bearish Kicker'], [35, 'Three Inside Down'], [36, 'Three Outside Down'], [38, 'Dark Cloud Cover']];
export const SHORT_CON: [number, string][] = [[24, 'Three Black Crows'], [25, 'Bearish Three-Line Strike'], [37, 'Bearish Mat Hold']];

const nan = Number.NaN;
const isNa = (x: number) => Number.isNaN(x);

function sma(src: number[], len: number): number[] {
  return src.map((_, i) => {
    if (i < len - 1) return nan;
    let s = 0;
    for (let k = i - len + 1; k <= i; k++) { const v = src[k]!; if (isNa(v)) return nan; s += v; }
    return s / len;
  });
}
/** Pine ta.rma is seeded with ta.sma once the window is complete; ta.ema is seeded with the first source value. */
function smoothed(src: number[], len: number, alpha: number, smaSeed: boolean): number[] {
  const seed = smaSeed ? sma(src, len) : src;
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const prev = i > 0 ? out[i - 1]! : nan;
    out.push(isNa(prev) ? seed[i]! : alpha * src[i]! + (1 - alpha) * prev);
  }
  return out;
}
const rma = (s: number[], len: number) => smoothed(s, len, 1 / len, true);
const ema = (s: number[], len: number) => smoothed(s, len, 2 / (len + 1), false);
function extreme(src: number[], len: number, hi: boolean): number[] {
  return src.map((_, i) => {
    if (i < len - 1) return nan;
    let m = src[i]!;
    for (let k = i - len + 1; k <= i; k++) m = hi ? Math.max(m, src[k]!) : Math.min(m, src[k]!);
    return m;
  });
}
function fixnan(src: number[]): number[] { let last = nan; return src.map((v) => (isNa(v) ? last : (last = v))); }

export type CpesSeries = { atr: number[]; ema: number[]; rsi: number[]; adx: number[] };

export function runCpes(bars: Bar[], inputs: CpesInputs = { ...CPES_DEFAULTS }): { signals: CpesSignal[]; series: CpesSeries } {
  const I = inputs;
  const n = bars.length;
  const open = bars.map((b) => b.o), high = bars.map((b) => b.h), low = bars.map((b) => b.l), close = bars.map((b) => b.c);
  const body = bars.map((b) => Math.abs(b.c - b.o));
  const rng = bars.map((b) => b.h - b.l);
  const trTrue = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - close[i - 1]!), Math.abs(b.l - close[i - 1]!))));
  const trFalse = trTrue.map((v, i) => (i === 0 ? nan : v));
  const atrV = rma(trTrue, I.avgLen);
  const avgB = sma(body, I.avgLen);
  const emaT = ema(close, I.trendLen);

  // RSI (ta.rsi)
  const up = close.map((c, i) => (i === 0 ? nan : Math.max(c - close[i - 1]!, 0)));
  const dn = close.map((c, i) => (i === 0 ? nan : Math.max(close[i - 1]! - c, 0)));
  const ru = rma(up, I.rsiLen), rd = rma(dn, I.rsiLen);
  const rsiV = ru.map((u, i) => { const d = rd[i]!; if (isNa(u) || isNa(d)) return nan; return d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d); });

  // ta.dmi(14, 14)
  const chH = high.map((h, i) => (i === 0 ? nan : h - high[i - 1]!));
  const chL = low.map((l, i) => (i === 0 ? nan : -(l - low[i - 1]!)));
  const plusDM = chH.map((u, i) => { const d = chL[i]!; return isNa(u) ? nan : u > d && u > 0 ? u : 0; });
  const minusDM = chL.map((d, i) => { const u = chH[i]!; return isNa(d) ? nan : d > u && d > 0 ? d : 0; });
  const trur = rma(trFalse, 14);
  const pRma = rma(plusDM, 14), mRma = rma(minusDM, 14);
  const plus = fixnan(pRma.map((v, i) => (100 * v) / trur[i]!));
  const minus = fixnan(mRma.map((v, i) => (100 * v) / trur[i]!));
  const adxV = rma(plus.map((p, i) => { const s = p + minus[i]!; return Math.abs(p - minus[i]!) / (s === 0 ? 1 : s); }), 14).map((v) => 100 * v);

  const hh3 = extreme(high, 3, true), ll3 = extreme(low, 3, false);
  const hhLoc = extreme(high, I.locLen, true), llLoc = extreme(low, I.locLen, false);

  // enable mask
  const en = new Array<boolean>(40).fill(true);
  if (I.strongOnly) for (let k = 1; k <= 39; k++) if (!STRONG_IDS.includes(k)) en[k] = false;
  for (const tk of I.disabledStr.replaceAll(' ', '').split(',')) { const nn = Number.parseInt(tk, 10); if (tk !== '' && Number.isFinite(Number(tk)) && nn >= 1 && nn <= 39) en[nn] = false; }

  // per-bar booleans
  const isBull: boolean[] = [], isBear: boolean[] = [], isLong: boolean[] = [], isSmall: boolean[] = [], isDoji: boolean[] = [];
  const upSh: number[] = [], loSh: number[] = [], bTop: number[] = [], bBot: number[] = [], midB: number[] = [];
  const upOK: boolean[] = [], dnOK: boolean[] = [];
  for (let i = 0; i < n; i++) {
    isBull.push(GT(close[i]!, open[i]!)); isBear.push(LT(close[i]!, open[i]!));
    isLong.push(GT(body[i]!, avgB[i]! * I.longMult)); isSmall.push(LT(body[i]!, avgB[i]! * I.smallMult));
    isDoji.push(GT(rng[i]!, 0) && LE(body[i]!, rng[i]! * 0.1));
    upSh.push(high[i]! - Math.max(open[i]!, close[i]!)); loSh.push(Math.min(open[i]!, close[i]!) - low[i]!);
    bTop.push(Math.max(open[i]!, close[i]!)); bBot.push(Math.min(open[i]!, close[i]!)); midB.push((open[i]! + close[i]!) / 2);
    const e3 = i >= 3 ? emaT[i - 3]! : nan;
    const upT = GT(close[i]!, emaT[i]!) && GT(emaT[i]!, e3);
    const dnT = LT(close[i]!, emaT[i]!) && LT(emaT[i]!, e3);
    upOK.push(!I.useTrend || upT); dnOK.push(!I.useTrend || dnT);
  }
  const N = (a: number[], i: number, k: number) => (i - k >= 0 ? a[i - k]! : nan);
  const B = (a: boolean[], i: number, k: number) => (i - k >= 0 ? a[i - k]! : false);

  const signals: CpesSignal[] = [];
  let lastL = -100000, lastS = -100000;
  for (let i = 0; i < n; i++) {
    const o = (k: number) => N(open, i, k), c = (k: number) => N(close, i, k), h = (k: number) => N(high, i, k), l = (k: number) => N(low, i, k);
    const bd = (k: number) => N(body, i, k), r = (k: number) => N(rng, i, k), us = (k: number) => N(upSh, i, k), ls = (k: number) => N(loSh, i, k);
    const top = (k: number) => N(bTop, i, k), bot = (k: number) => N(bBot, i, k), mid = (k: number) => N(midB, i, k);
    const bull = (k: number) => B(isBull, i, k), bear = (k: number) => B(isBear, i, k), lg = (k: number) => B(isLong, i, k), sm = (k: number) => B(isSmall, i, k), dj = (k: number) => B(isDoji, i, k);
    const uOK = (k: number) => B(upOK, i, k), dOK = (k: number) => B(dnOK, i, k);
    const atr = atrV[i]!, tol = atr * I.tolMult;
    const bigEnough = GE(r(0), atr * I.minRngMult);
    const pbHi1 = N(hh3, i, 1), pbLo1 = N(ll3, i, 1);
    const kickUp = I.strictGap ? GT(l(0), h(1)) : GT(o(0), o(1));
    const kickDn = I.strictGap ? LT(h(0), l(1)) : LT(o(0), o(1));
    const hammerShape = bigEnough && !dj(0) && LE(bd(0), r(0) * 0.35) && GE(ls(0), 2 * bd(0)) && GE(ls(0), r(0) * 0.55) && LE(us(0), r(0) * 0.15);
    const invShape = bigEnough && !dj(0) && LE(bd(0), r(0) * 0.35) && GE(us(0), 2 * bd(0)) && GE(us(0), r(0) * 0.55) && LE(ls(0), r(0) * 0.15);

    const p: Record<number, boolean> = {};
    // ---- Bullish reversal
    p[1] = bear(1) && bull(0) && LE(o(0), c(1)) && GE(c(0), o(1)) && GT(bd(0), bd(1)) && dOK(2);
    p[2] = hammerShape && dOK(1);
    p[3] = bear(2) && lg(2) && sm(1) && (!I.strictGap || LT(top(1), c(2))) && bull(0) && lg(0) && GT(c(0), mid(2)) && dOK(3);
    p[4] = bear(1) && lg(1) && bull(0) && LE(o(0), c(1)) && GT(c(0), mid(1)) && LT(c(0), o(1)) && dOK(2);
    p[5] = bear(1) && lg(1) && bull(0) && GE(o(0), c(1)) && LE(c(0), o(1)) && LT(bd(0), bd(1)) && dOK(2);
    p[6] = bull(0) && bull(1) && bull(2) && lg(0) && lg(1) && lg(2) && LE(us(0), bd(0) * 0.3) && LE(us(1), bd(1) * 0.3) && LE(us(2), bd(2) * 0.3) && GT(o(0), o(1)) && LE(o(0), c(1)) && GT(o(1), o(2)) && LE(o(1), c(2)) && GT(c(0), c(1)) && GT(c(1), c(2)) && dOK(3);
    p[7] = invShape && dOK(1);
    p[8] = bigEnough && dj(0) && GE(ls(0), r(0) * 0.6) && LE(us(0), r(0) * 0.1) && dOK(1);
    const gapDnBaby = I.strictGap ? LT(h(1), l(2)) && LT(h(1), l(0)) : LE(top(1), c(2)) && LE(top(1), o(0));
    p[9] = bear(2) && lg(2) && dj(1) && gapDnBaby && bull(0) && lg(0) && GT(c(0), mid(2)) && dOK(3);
    p[10] = bear(2) && lg(2) && bull(1) && GE(o(1), c(2)) && LT(c(1), o(2)) && GT(c(1), mid(2)) && bull(0) && GT(c(0), o(2)) && dOK(3);
    p[11] = bear(2) && bull(1) && LE(o(1), c(2)) && GE(c(1), o(2)) && GT(bd(1), bd(2)) && bull(0) && GT(c(0), c(1)) && dOK(3);
    p[12] = bear(1) && bull(0) && lg(0) && kickUp && GT(bd(0), bd(1)) && dOK(2);
    p[13] = bear(1) && bull(0) && LE(Math.abs(l(0) - l(1)), tol) && dOK(2);
    const gapDnCBS = I.strictGap ? LT(h(1), l(2)) : LE(top(1), c(2));
    p[15] = bear(3) && bear(2) && lg(3) && lg(2) && sm(1) && gapDnCBS && bear(0) && lg(0) && GE(o(0), top(1)) && LE(c(0), bot(1)) && dOK(4);
    p[18] = bull(0) && lg(0) && LE(ls(0), r(0) * 0.05) && LE(us(0), r(0) * 0.15) && LE(o(0), c(1)) && dOK(1);
    p[20] = bear(4) && bear(3) && bear(2) && lg(4) && lg(3) && lg(2) && GT(c(4), c(3)) && GT(c(3), c(2)) && sm(1) && bull(0) && lg(0) && GT(c(0), h(1)) && dOK(5);
    p[21] = bear(1) && lg(1) && bull(0) && lg(0) && LT(o(0), c(1)) && LE(Math.abs(c(0) - c(1)), tol) && dOK(2);
    // ---- Bullish continuation
    p[14] = bull(4) && lg(4) && bear(3) && bear(2) && bear(1) && LT(pbHi1, h(4)) && GT(pbLo1, l(4)) && LT(bd(1), bd(4)) && LT(bd(2), bd(4)) && LT(bd(3), bd(4)) && bull(0) && lg(0) && GT(c(0), h(4)) && uOK(5);
    p[16] = p[14] && GT(pbLo1, mid(4)) && GT(c(3), c(2)) && GT(c(2), c(1));
    p[17] = bear(1) && bull(0) && lg(0) && LE(Math.abs(o(0) - o(1)), tol) && uOK(2);
    p[19] = bull(3) && bull(2) && bull(1) && LT(c(3), c(2)) && LT(c(2), c(1)) && bear(0) && lg(0) && GE(o(0), c(1)) && LT(c(0), o(3)) && uOK(4);
    // ---- Bearish reversal
    p[22] = bull(1) && bear(0) && GE(o(0), c(1)) && LE(c(0), o(1)) && GT(bd(0), bd(1)) && uOK(2);
    p[23] = bear(0) && lg(0) && LE(us(0), r(0) * 0.05) && LE(ls(0), r(0) * 0.15) && GE(o(0), c(1)) && uOK(1);
    p[26] = hammerShape && uOK(1);
    const gapUpCrow = I.strictGap ? GT(l(1), h(2)) : GE(bot(1), c(2));
    p[27] = bull(2) && lg(2) && bear(1) && gapUpCrow && LT(bd(1), bd(2)) && bear(0) && LT(bd(0), bd(2)) && GE(o(0), o(1)) && LT(c(0), c(1)) && GT(c(0), c(2)) && uOK(3);
    p[28] = bull(2) && lg(2) && sm(1) && (!I.strictGap || GT(bot(1), c(2))) && bear(0) && lg(0) && LT(c(0), mid(2)) && uOK(3);
    p[29] = invShape && uOK(1);
    p[30] = bull(1) && lg(1) && bear(0) && LE(o(0), c(1)) && GE(c(0), o(1)) && LT(bd(0), bd(1)) && uOK(2);
    const gapUpDoji = I.strictGap ? GT(l(1), h(2)) : GE(bot(1), c(2));
    p[31] = bull(2) && lg(2) && dj(1) && gapUpDoji && bear(0) && LT(c(0), bot(1)) && uOK(3);
    const gapUpBaby = I.strictGap ? GT(l(1), h(2)) && LT(h(0), l(1)) : GE(bot(1), c(2)) && LE(o(0), bot(1));
    p[32] = bull(2) && lg(2) && dj(1) && gapUpBaby && bear(0) && lg(0) && LT(c(0), mid(2)) && uOK(3);
    p[33] = bull(1) && bear(0) && LE(Math.abs(h(0) - h(1)), tol) && uOK(2);
    p[34] = bull(1) && bear(0) && lg(0) && kickDn && GT(bd(0), bd(1)) && uOK(2);
    p[35] = bull(2) && lg(2) && bear(1) && LE(o(1), c(2)) && GT(c(1), o(2)) && LT(c(1), mid(2)) && bear(0) && LT(c(0), c(1)) && LT(c(0), o(2)) && uOK(3);
    p[36] = bull(2) && bear(1) && GE(o(1), c(2)) && LE(c(1), o(2)) && GT(bd(1), bd(2)) && bear(0) && LT(c(0), c(1)) && uOK(3);
    p[38] = bull(1) && lg(1) && bear(0) && (I.strictGap ? GT(o(0), h(1)) : GE(o(0), c(1))) && LT(c(0), mid(1)) && GT(c(0), o(1)) && uOK(2);
    // ---- Bearish continuation
    p[24] = bear(0) && bear(1) && bear(2) && lg(0) && lg(1) && lg(2) && LE(ls(0), bd(0) * 0.3) && LE(ls(1), bd(1) * 0.3) && LE(ls(2), bd(2) * 0.3) && LT(o(0), o(1)) && GE(o(0), c(1)) && LT(o(1), o(2)) && GE(o(1), c(2)) && LT(c(0), c(1)) && LT(c(1), c(2));
    p[25] = bear(3) && bear(2) && bear(1) && GT(c(3), c(2)) && GT(c(2), c(1)) && bull(0) && lg(0) && LE(o(0), c(1)) && GT(c(0), o(3)) && dOK(4);
    p[37] = bear(4) && lg(4) && bull(3) && bull(2) && bull(1) && LT(pbHi1, h(4)) && GT(pbLo1, l(4)) && LT(pbHi1, mid(4)) && LT(c(3), c(2)) && LT(c(2), c(1)) && LT(bd(1), bd(4)) && LT(bd(2), bd(4)) && LT(bd(3), bd(4)) && bear(0) && lg(0) && LT(c(0), l(4)) && dOK(5);

    const hit = (list: [number, string][], on: boolean) => (on ? list.filter(([id]) => p[id] && en[id]) : []);
    const longHits = [...hit(LONG_REV, I.enBullRev), ...hit(LONG_CON, I.enBullCon)];
    const shortHits = [...hit(SHORT_REV, I.enBearRev), ...hit(SHORT_CON, I.enBearCon)];
    const rawLong = longHits.length > 0, rawShort = shortHits.length > 0;

    const adxOK = !I.adxFilter || LE(adxV[i]!, I.adxMax);
    const atLow = LE(ll3[i]!, llLoc[i]!), atHigh = GE(hh3[i]!, hhLoc[i]!);
    const longOK = (!I.rsiFilter || LE(rsiV[i]!, I.rsiBand)) && (!I.locFilter || atLow) && adxOK;
    const shortOK = (!I.rsiFilter || GE(rsiV[i]!, 100 - I.rsiBand)) && (!I.locFilter || atHigh) && adxOK;
    const longSig = rawLong && !rawShort && longOK;
    const shortSig = rawShort && !rawLong && shortOK;
    const longEntry = longSig && i - lastL > I.cooldown;
    const shortEntry = shortSig && i - lastS > I.cooldown;
    if (longEntry) { lastL = i; signals.push({ index: i, t: bars[i]!.t, side: 'LONG', patterns: longHits.map(([, s]) => s), price: close[i]! }); }
    if (shortEntry) { lastS = i; signals.push({ index: i, t: bars[i]!.t, side: 'SHORT', patterns: shortHits.map(([, s]) => s), price: close[i]! }); }
  }
  return { signals, series: { atr: atrV, ema: emaT, rsi: rsiV, adx: adxV } };
}
