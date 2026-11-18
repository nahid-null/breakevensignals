import { MINUTE, type Candle } from './model';

/**
 * prompt-50 RESEARCH ONLY: "AI Analyst" — a transparent multi-evidence decision engine that independently chooses coin,
 * side, entry time, take-profit and expected time-to-target. Not wired into the worker, database, Telegram or live Simulator.
 * Pure and deterministic: every decision at time T reads only bars that CLOSED at or before T (no look-ahead).
 * No conventional fixed stop loss: ordinary exits are TP or a closed-candle thesis invalidation. A separate intrabar
 * emergency level caps each trade's planned loss at 0.5% of equity; account-level halts and isolated liquidation are modelled.
 */
export const AA = {
  startBalance: 10, riskPct: 0.005, feeRate: 0.0005, entrySlip: 0.0002, exitSlip: 0.0005, mmr: 0.01,
  maxLeverage: 20, liqMultiple: 3, maxOpen: 5, maxOpenRiskPct: 0.025, dailyLossHalt: 0.03, drawdownHalt: 0.1,
  haltMs: 24 * 60 * MINUTE, cooldownMs: 2 * 60 * MINUTE, minRR: 1.5, maxEtaMin: 240, minEmPct: 0.0025, maxEmPct: 0.025,
  tpAtr1hCap: 2.0, pullbackBars: 6,
} as const;
export type Profile = 'strict' | 'standard' | 'relaxed';
export const PROFILES: Record<Profile, { minScore: number; positiveHist: boolean }> = {
  strict: { minScore: 7, positiveHist: true }, standard: { minScore: 6, positiveHist: true }, relaxed: { minScore: 5, positiveHist: false },
};
export type Side = 'LONG' | 'SHORT';
export interface Bar extends Candle { takerBuy: number }
export interface Swing { price: number; time: number; known: number; sweptAt: number | null }
export interface Series {
  minutes: number; ms: number; start: number; bars: Bar[];
  ema9: number[]; ema20: number[]; ema50: number[]; rsi: number[]; hist: number[]; atr: number[]; highs: Swing[]; lows: Swing[];
}

export function aggregate(m1: Bar[], minutes: number): Bar[] {
  const ms = minutes * MINUTE; const out: Bar[] = []; let cur: Bar | null = null; let n = 0;
  for (const c of m1) {
    const open = Math.floor(c.time / ms) * ms;
    if (!cur || cur.time !== open) {
      if (cur && n === minutes) out.push(cur);
      cur = { ...c, time: open }; n = c.time === open ? 1 : -1e9; continue;
    }
    cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low); cur.close = c.close;
    cur.volume += c.volume; cur.takerBuy += c.takerBuy; n++;
  }
  if (cur && n === minutes) out.push(cur);
  return out;
}

function emaArr(xs: number[], len: number) { const k = 2 / (len + 1); const out: number[] = []; let p = xs[0] ?? 0; for (const x of xs) { p = p + k * (x - p); out.push(p); } return out; }
const FRACTAL = 2;
export function buildSeries(m1: Bar[], minutes: number): Series {
  const bars = minutes === 1 ? m1 : aggregate(m1, minutes); const ms = minutes * MINUTE;
  for (let i = 1; i < bars.length; i++) if (bars[i]!.time !== bars[i - 1]!.time + ms) throw new Error(`gap in ${minutes}m series at ${bars[i]!.time}`);
  const close = bars.map((b) => b.close);
  const e12 = emaArr(close, 12), e26 = emaArr(close, 26); const macd = close.map((_, i) => e12[i]! - e26[i]!); const sig = emaArr(macd, 9);
  const rsi: number[] = []; let g = 0, l = 0;
  const atr: number[] = []; let a = 0;
  bars.forEach((b, i) => {
    const prev = bars[i - 1];
    const tr = prev ? Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)) : b.high - b.low;
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14; atr.push(a);
    const d = prev ? b.close - prev.close : 0;
    g = i < 14 ? (g * i + Math.max(d, 0)) / (i + 1) : (g * 13 + Math.max(d, 0)) / 14;
    l = i < 14 ? (l * i + Math.max(-d, 0)) / (i + 1) : (l * 13 + Math.max(-d, 0)) / 14;
    rsi.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  });
  const highs: Swing[] = [], lows: Swing[] = [];
  for (let i = FRACTAL; i + FRACTAL < bars.length; i++) {
    const b = bars[i]!; let hi = true, lo = true;
    for (let j = 1; j <= FRACTAL; j++) {
      if (!(b.high > bars[i - j]!.high && b.high >= bars[i + j]!.high)) hi = false;
      if (!(b.low < bars[i - j]!.low && b.low <= bars[i + j]!.low)) lo = false;
    }
    const known = bars[i + FRACTAL]!.time + ms;
    if (hi) { let sweptAt: number | null = null; for (let j = i + FRACTAL + 1; j < bars.length; j++) if (bars[j]!.high > b.high) { sweptAt = bars[j]!.time + ms; break; } highs.push({ price: b.high, time: b.time, known, sweptAt }); }
    if (lo) { let sweptAt: number | null = null; for (let j = i + FRACTAL + 1; j < bars.length; j++) if (bars[j]!.low < b.low) { sweptAt = bars[j]!.time + ms; break; } lows.push({ price: b.low, time: b.time, known, sweptAt }); }
  }
  return { minutes, ms, start: bars[0]?.time ?? 0, bars, ema9: emaArr(close, 9), ema20: emaArr(close, 20), ema50: emaArr(close, 50), rsi,
    hist: macd.map((m, i) => m - sig[i]!), atr, highs, lows };
}
/** Index of the latest bar whose close time is <= T (never a forming bar). */
export function lastIdx(s: Series, T: number) { return Math.floor((Math.floor(T / s.ms) * s.ms - s.ms - s.start) / s.ms); }
export function trendAt(s: Series, i: number): 1 | -1 | 0 {
  if (i < 3) return 0; const c = s.bars[i]!.close, e20 = s.ema20[i]!, e50 = s.ema50[i]!;
  if (c > e20 && e20 > e50 && e20 > s.ema20[i - 3]!) return 1;
  if (c < e20 && e20 < e50 && e20 < s.ema20[i - 3]!) return -1;
  return 0;
}
function knownBefore(xs: Swing[], T: number) { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m]!.known <= T) lo = m + 1; else hi = m; } return lo; }
/** +1 higher highs and higher lows, -1 lower highs and lower lows, 0 mixed — from the last two confirmed swings. */
export function structureAt(s: Series, T: number): 1 | -1 | 0 {
  const h = knownBefore(s.highs, T), l = knownBefore(s.lows, T); if (h < 2 || l < 2) return 0;
  const hh = s.highs[h - 1]!.price > s.highs[h - 2]!.price, hl = s.lows[l - 1]!.price > s.lows[l - 2]!.price;
  return hh && hl ? 1 : !hh && !hl ? -1 : 0;
}
/** Nearest confirmed, still-unswept liquidity pool beyond price in the trade direction (target side). */
export function nearestPool(s: Series, T: number, price: number, side: Side): number | null {
  const xs = side === 'LONG' ? s.highs : s.lows; let best: number | null = null;
  for (let k = knownBefore(xs, T) - 1, seen = 0; k >= 0 && seen < 80; k--, seen++) {
    const p = xs[k]!; if (p.sweptAt !== null && p.sweptAt <= T) continue;
    if (side === 'LONG' ? p.price > price && (best === null || p.price < best) : p.price < price && (best === null || p.price > best)) best = p.price;
  }
  return best;
}

export interface SymbolData {
  symbol: string; tick: number; step: number; minNotional: number; m1: Bar[]; mark: Map<number, Candle>;
  /** order-book imbalance at +/-1% (bid notional share), keyed by minute */ depth: Map<number, number>;
  /** open interest value keyed by 5-minute record time */ oi: Map<number, number>;
  funding: Map<number, number>;
}
export interface SymbolCtx extends SymbolData { start: number; s5: Series; s15: Series; s60: Series; s240: Series; vwap: number[] }
export function prepare(d: SymbolData): SymbolCtx {
  const vwap: number[] = []; let day = -1, pv = 0, v = 0;
  for (const c of d.m1) { const dd = Math.floor(c.time / 86_400_000); if (dd !== day) { day = dd; pv = 0; v = 0; } pv += (c.high + c.low + c.close) / 3 * c.volume; v += c.volume; vwap.push(v > 0 ? pv / v : c.close); }
  return { ...d, start: d.m1[0]!.time, s5: buildSeries(d.m1, 5), s15: buildSeries(d.m1, 15), s60: buildSeries(d.m1, 60), s240: buildSeries(d.m1, 240), vwap };
}
export const m1At = (c: SymbolCtx, t: number) => c.m1[(t - c.start) / MINUTE];

export interface Plan {
  symbol: string; side: Side; T: number; score: number; available: number; refPrice: number; tp: number; invalidation: number; emergency: number;
  etaMin: number; rr: number; evidence: string[]; missing: string[]; context: string;
}
export type Decision = { ok: true; plan: Plan } | { ok: false; gate: string };
const fmt = (x: number) => Number(x.toPrecision(6)).toString();

/** Full market analysis for one coin and side at a 5-minute close T. Hard gates first (reasons recorded), then evidence score. */
export function analyze(c: SymbolCtx, btc: SymbolCtx | null, T: number, side: Side, profile: Profile): Decision {
  const s = side === 'LONG' ? 1 : -1; const P = PROFILES[profile];
  const i5 = lastIdx(c.s5, T), i15 = lastIdx(c.s15, T), i60 = lastIdx(c.s60, T), i240 = lastIdx(c.s240, T);
  if (i5 < 300 || i15 < 60 || i60 < 60 || i240 < 55) return { ok: false, gate: 'WARMUP' };
  const b = c.s5.bars[i5]!; const px = b.close;
  const t4 = trendAt(c.s240, i240), t1 = trendAt(c.s60, i60), t15 = trendAt(c.s15, i15);
  const st60 = structureAt(c.s60, T), st15 = structureAt(c.s15, T);
  let reversal = false;
  if (t4 === -s) { reversal = t1 === s && st60 === s; if (!reversal) return { ok: false, gate: 'AGAINST_4H_TREND' }; }
  if (!(t1 === s || (t1 === 0 && t4 === s))) return { ok: false, gate: 'NO_1H_TREND' };
  if (t15 !== s) return { ok: false, gate: 'NO_15M_TREND' };
  if (st15 === -s) return { ok: false, gate: 'AGAINST_15M_STRUCTURE' };
  if (btc && btc.symbol !== c.symbol) { const bi15 = lastIdx(btc.s15, T), bi60 = lastIdx(btc.s60, T);
    if (trendAt(btc.s15, bi15) === -s || trendAt(btc.s60, bi60) === -s) return { ok: false, gate: 'AGAINST_BTC' }; }
  // abnormal volatility
  const atr5 = c.s5.atr[i5]!, atr15 = c.s15.atr[i15]!, atr60 = c.s60.atr[i60]!;
  const pct = c.s5.atr.slice(i5 - 288, i5).map((a, k) => a / c.s5.bars[i5 - 288 + k]!.close).sort((x, y) => x - y);
  const med = pct[pct.length >> 1]!;
  if (atr5 / px > 2 * med || b.high - b.low > 2.5 * atr5) return { ok: false, gate: 'ABNORMAL_VOLATILITY' };
  // no chasing
  if (Math.abs(px - c.s15.ema20[i15]!) > 1.0 * atr15 || s * (px - c.s5.bars[i5 - 12]!.close) > 2.5 * atr5) return { ok: false, gate: 'CHASING_EXTENDED_MOVE' };
  const rsi5 = c.s5.rsi[i5]!; if (s === 1 ? rsi5 < 50 || rsi5 > 70 : rsi5 > 50 || rsi5 < 30) return { ok: false, gate: 'RSI_NOT_IN_RANGE' };
  // confirmation: pullback to EMA20 then closed resumption candle with momentum
  const win = c.s5.bars.slice(i5 - AA.pullbackBars, i5);
  const touched = win.some((x, k) => s === 1 ? x.low <= c.s5.ema20[i5 - AA.pullbackBars + k]! + 0.2 * atr5 : x.high >= c.s5.ema20[i5 - AA.pullbackBars + k]! - 0.2 * atr5);
  if (!touched) return { ok: false, gate: 'NO_PULLBACK' };
  const prev = c.s5.bars[i5 - 1]!; const body = (b.close - b.open) * s;
  if (!(s * (b.close - (s === 1 ? prev.high : prev.low)) > 0 && body >= 0.5 * (b.high - b.low) && s * (b.close - c.s5.ema20[i5]!) > 0)) return { ok: false, gate: 'NO_CONFIRMED_RESUMPTION' };
  const h0 = c.s5.hist[i5]!, h1 = c.s5.hist[i5 - 1]!;
  if (!(s * (h0 - h1) > 0 && (!P.positiveHist || s * h0 > 0))) return { ok: false, gate: 'MOMENTUM_NOT_CONFIRMED' };
  // liquidity hunt: trigger bar swept a pool on the trade side and closed back (trap)
  const trap = (side === 'LONG' ? c.s5.highs : c.s5.lows).slice(Math.max(0, knownBefore(side === 'LONG' ? c.s5.highs : c.s5.lows, T) - 5), knownBefore(side === 'LONG' ? c.s5.highs : c.s5.lows, T))
    .some((p) => p.sweptAt === b.time + c.s5.ms && s * (b.close - p.price) < 0);
  if (trap) return { ok: false, gate: 'LIQUIDITY_HUNT_TRAP' };
  const vw = c.vwap[(T - MINUTE - c.start) / MINUTE]!;
  if (s * (px - vw) <= 0) return { ok: false, gate: 'WRONG_SIDE_OF_VWAP' };
  // levels
  const pullExtreme = s === 1 ? Math.min(...win.map((x) => x.low), b.low) : Math.max(...win.map((x) => x.high), b.high);
  const invalidation = pullExtreme; const emergency = pullExtreme - s * 0.5 * atr15; const emDist = s * (px - emergency);
  if (emDist / px < AA.minEmPct) return { ok: false, gate: 'INVALIDATION_TOO_TIGHT' };
  if (emDist / px > AA.maxEmPct) return { ok: false, gate: 'INVALIDATION_TOO_WIDE' };
  const pool15 = nearestPool(c.s15, T, px, side), pool60 = nearestPool(c.s60, T, px, side);
  const pools = [pool15, pool60].filter((x): x is number => x !== null);
  const nearest = pools.length ? (s === 1 ? Math.min(...pools) : Math.max(...pools)) : null;
  const cap = px + s * AA.tpAtr1hCap * atr60;
  const tp = nearest === null ? cap : s === 1 ? Math.min(nearest - 0.1 * atr5, cap) : Math.max(nearest + 0.1 * atr5, cap);
  const tpDist = s * (tp - px);
  if (tpDist <= 0 || tpDist < AA.minRR * emDist) return { ok: false, gate: nearest !== null && s * (nearest - px) < AA.minRR * emDist ? 'TOO_CLOSE_TO_SUPPORT_RESISTANCE' : 'REWARD_BELOW_1.5R' };
  const sigma5 = atr5 / 1.25; const etaMin = 5 * (tpDist / sigma5) ** 2;
  if (etaMin > AA.maxEtaMin) return { ok: false, gate: 'TP_NOT_REACHABLE_IN_4H' };
  // stop-hunt magnet: unswept opposite-side pool resting between price and the emergency level
  const opp = nearestPool(c.s15, T, px, side === 'LONG' ? 'SHORT' : 'LONG');
  if (opp !== null && s * (opp - emergency) > 0 && s * (px - opp) < 0.3 * atr5) return { ok: false, gate: 'LIQUIDITY_POOL_UNDER_ENTRY' };

  // ---- independent evidence score ----
  const ev: string[] = [], miss: string[] = []; let score = 0, avail = 0;
  const add = (ok: boolean | null, label: string) => { if (ok === null) { miss.push(label); return; } avail++; if (ok) { score++; ev.push(label); } };
  add(t4 === s, '4h trend aligned');
  add(st60 === s, `1h structure ${s === 1 ? 'HH/HL' : 'LH/LL'}`);
  const v20 = c.s5.bars.slice(i5 - 20, i5).reduce((x, y) => x + y.volume, 0) / 20;
  add(b.volume >= 1.3 * v20, `volume ${fmt(b.volume / v20)}x 20-bar average`);
  const takerShare = b.volume > 0 ? b.takerBuy / b.volume : 0.5;
  add(s === 1 ? takerShare >= 0.55 : takerShare <= 0.45, `taker ${s === 1 ? 'buy' : 'sell'} share ${fmt(s === 1 ? takerShare : 1 - takerShare)}`);
  const oiT = Math.floor((T - 5 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE; const oiNow = c.oi.get(oiT), oiAgo = c.oi.get(oiT - 60 * MINUTE);
  add(oiNow === undefined || oiAgo === undefined ? null : oiNow > oiAgo && s * (px - c.s5.bars[i5 - 12]!.close) > 0, 'open interest rising with price (1h)');
  const imbs: number[] = []; for (let t = T - 5 * MINUTE; t < T; t += MINUTE) { const x = c.depth.get(t); if (x !== undefined) imbs.push(x); }
  const imb = imbs.length ? imbs.reduce((x, y) => x + y, 0) / imbs.length : null;
  add(imb === null ? null : s === 1 ? imb >= 0.53 : imb <= 0.47, imb === null ? 'order book +/-1%' : `order book ${s === 1 ? 'bid' : 'ask'} share ${fmt(s === 1 ? imb : 1 - imb)} within 1%`);
  add(fvgOrBlock(c.s5, i5, side), `reaction from 5m ${s === 1 ? 'bullish' : 'bearish'} FVG/order block`);
  add(s * (px - poc(c.s5, i5)) > 0, '24h volume-profile POC on supportive side');
  add(btc && btc.symbol !== c.symbol ? trendAt(btc.s15, lastIdx(btc.s15, T)) === s : null, 'BTC 15m trend aligned');
  add(s * c.s15.hist[i15]! > 0, '15m MACD histogram aligned');
  if (score < P.minScore) return { ok: false, gate: 'INSUFFICIENT_CONFIRMATIONS' };
  const context = `4h ${t4} 1h ${t1} 15m ${t15}${reversal ? ' (counter-4h reversal confirmed by 1h structure)' : ''}; RSI5 ${fmt(rsi5)}; ATR5 ${fmt(atr5)}; VWAP ${fmt(vw)}`;
  return { ok: true, plan: { symbol: c.symbol, side, T, score, available: avail, refPrice: px, tp, invalidation, emergency, etaMin, rr: tpDist / emDist, evidence: ev, missing: miss, context } };
}
function fvgOrBlock(s5: Series, i: number, side: Side) {
  const s = side === 'LONG' ? 1 : -1; const bars = s5.bars;
  for (let j = i - 24; j <= i - 1; j++) {
    const a = bars[j - 2]!, c = bars[j]!;
    const lo = s === 1 ? a.high : c.high, hi = s === 1 ? c.low : a.low; // FVG zone
    if (hi > lo) { for (let k = j + 1; k < i; k++) { const x = bars[k]!; if (s === 1 ? x.low <= hi && x.low >= lo : x.high >= lo && x.high <= hi) return true; } }
    const ob = bars[j - 1]!; // opposite candle before an impulsive 3-bar move
    if (s * (ob.close - ob.open) < 0 && s * (bars[Math.min(j + 2, i)]!.close - ob.close) > 1.5 * s5.atr[j]!) {
      for (let k = j + 3; k < i; k++) { const x = bars[k]!; if (s === 1 ? x.low <= ob.high && x.low >= ob.low : x.high >= ob.low && x.high <= ob.high) return true; }
    }
  }
  return false;
}
export function poc(s5: Series, i: number) {
  const xs = s5.bars.slice(i - 288, i); const lo = Math.min(...xs.map((x) => x.low)), hi = Math.max(...xs.map((x) => x.high));
  const bins = new Array<number>(40).fill(0); const w = (hi - lo) / 40 || 1;
  for (const x of xs) bins[Math.min(39, Math.floor(((x.high + x.low + x.close) / 3 - lo) / w))]! += x.volume;
  const k = bins.indexOf(Math.max(...bins)); return lo + (k + 0.5) * w;
}

// ---------------------------- portfolio replay ----------------------------
export type ExitReason = 'TAKE_PROFIT' | 'THESIS_INVALID' | 'EMERGENCY_EXIT' | 'ISOLATED_LIQUIDATION' | 'UNRESOLVED';
export interface Trade {
  id: string; symbol: string; side: Side; score: number; available: number; decisionTime: number; entryTime: number; entry: number;
  qty: number; notional: number; leverage: number; margin: number; liqPrice: number; tp: number; invalidation: number; emergency: number;
  plannedRiskUsd: number; equityAtEntry: number; rr: number; etaMin: number; entryReason: string;
  exitTime: number | null; exitPrice: number | null; exitReason: ExitReason; exitDetail: string;
  fees: number; funding: number; slippageUsd: number; pnl: number; holdMin: number | null;
  maeUsd: number; maePct: number; mfeUsd: number; mfePct: number; balanceAfter: number | null;
}
export interface RunOptions { from: number; to: number; end: number; profile: Profile; startBalance?: number }
export interface RunResult {
  trades: Trade[]; wallet: number; maxDrawdownPct: number; worstUnrealizedUsd: number; worstUnrealizedTime: number;
  rejections: Record<string, number>; halts: { time: number; reason: string }[]; evaluations: number;
}
const roundDown = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;

/** `decide` defaults to analyze; tests may inject a fixed plan to exercise sizing and exits in isolation. */
export function run(ctxs: SymbolCtx[], btc: SymbolCtx | null, o: RunOptions, decide: typeof analyze = analyze): RunResult {
  let wallet = o.startBalance ?? AA.startBalance; const trades: Trade[] = []; let open: (Trade & { pending?: string; s: 1 | -1 })[] = [];
  const rej: Record<string, number> = {}; const bump = (k: string) => { rej[k] = (rej[k] ?? 0) + 1; };
  const halts: RunResult['halts'] = []; let haltUntil = 0; let dayKey = -1, dayStart = wallet; let peak = wallet, maxDd = 0, worstU = 0, worstUT = 0;
  const cooldown = new Map<string, number>(); let evaluations = 0; const byS = new Map(ctxs.map((c) => [c.symbol, c]));
  const close = (p: (typeof open)[number], t: number, price: number, reason: ExitReason, detail: string, slip: boolean) => {
    const fill = slip ? price * (1 - p.s * AA.exitSlip) : price;
    const fee = fill * p.qty * AA.feeRate; const gross = p.s * (fill - p.entry) * p.qty;
    p.fees += fee; p.slippageUsd += Math.abs(price - fill) * p.qty;
    p.pnl = reason === 'ISOLATED_LIQUIDATION' ? -p.margin - p.fees + fee + p.funding : gross - p.fees + p.funding;
    if (reason === 'ISOLATED_LIQUIDATION') p.fees -= fee;
    wallet += p.pnl; p.exitTime = t; p.exitPrice = fill; p.exitReason = reason; p.exitDetail = detail; p.holdMin = (t - p.entryTime) / MINUTE; p.balanceAfter = wallet;
    open = open.filter((x) => x !== p); if (reason !== 'TAKE_PROFIT') cooldown.set(`${p.symbol}-${p.side}`, t + AA.cooldownMs);
  };
  for (let t = o.from; t < o.end; t += MINUTE) {
    const dk = Math.floor(t / 86_400_000); if (dk !== dayKey) { dayKey = dk; dayStart = wallet + open.reduce((a, p) => a + unreal(p, m1At(byS.get(p.symbol)!, t - MINUTE)?.close ?? p.entry), 0); }
    // (a) thesis reassessment on every closed 15-minute bar — exit at this minute's open
    if (t % (15 * MINUTE) === 0) for (const p of open) {
      const c = byS.get(p.symbol)!; const i15 = lastIdx(c.s15, t), i60 = lastIdx(c.s60, t); const b = c.s15.bars[i15]!;
      const u = p.s * (b.close - p.entry);
      if (p.s * (b.close - p.invalidation) < 0) p.pending = `15m close ${fmt(b.close)} beyond invalidation ${fmt(p.invalidation)} (pullback extreme broken)`;
      else if (trendAt(c.s60, i60) === -p.s) p.pending = '1h trend flipped against the position';
      else if (structureAt(c.s15, t) === -p.s) p.pending = `15m structure turned ${p.s === 1 ? 'LH/LL' : 'HH/HL'}`;
      else if (u < 0 && p.s * c.s15.hist[i15]! < 0 && p.s * (b.close - c.s15.ema20[i15]!) < 0) p.pending = 'momentum reversed (15m MACD and EMA20 against) while position is losing';
      else if (u < 0 && btc && btc.symbol !== p.symbol && trendAt(btc.s15, lastIdx(btc.s15, t)) === -p.s) p.pending = 'BTC 15m trend turned against a losing position';
    }
    for (const p of [...open]) if (p.pending) { const c = m1At(byS.get(p.symbol)!, t); if (c) close(p, t, c.open, 'THESIS_INVALID', p.pending, true); }
    // (b) new entries on 5-minute closes inside the test window
    if (t % (5 * MINUTE) === 0 && t >= o.from && t < o.to) {
      const plans: Plan[] = [];
      for (const c of ctxs) for (const side of ['LONG', 'SHORT'] as Side[]) {
        evaluations++; const d = decide(c, btc, t, side, o.profile); if (!d.ok) { bump(d.gate); continue; } plans.push(d.plan);
      }
      plans.sort((a, b) => b.score - a.score || b.rr - a.rr);
      const equity = wallet + open.reduce((a, p) => a + unreal(p, m1At(byS.get(p.symbol)!, t - MINUTE)!.close), 0);
      if (equity > peak) peak = equity;
      if (haltUntil <= t && equity <= dayStart * (1 - AA.dailyLossHalt)) { haltUntil = (dayKey + 1) * 86_400_000; halts.push({ time: t, reason: `daily loss ${fmt((1 - equity / dayStart) * 100)}% >= 3%: no new entries until next UTC day` }); }
      if (haltUntil <= t && equity <= peak * (1 - AA.drawdownHalt)) { haltUntil = t + AA.haltMs; peak = equity; halts.push({ time: t, reason: `drawdown >= 10% from peak: no new entries for 24h` }); }
      for (const pl of plans) {
        if (haltUntil > t) { bump('ACCOUNT_HALT'); continue; }
        if (open.length >= AA.maxOpen) { bump('MAX_OPEN_POSITIONS'); continue; }
        if (open.some((p) => p.symbol === pl.symbol)) { bump('COIN_ALREADY_OPEN'); continue; }
        if ((cooldown.get(`${pl.symbol}-${pl.side}`) ?? 0) > t) { bump('COIN_COOLDOWN_AFTER_LOSS'); continue; }
        const c = byS.get(pl.symbol)!; const s = pl.side === 'LONG' ? 1 : -1; const bar = m1At(c, t); if (!bar) { bump('NO_NEXT_CANDLE'); continue; }
        const entry = bar.open * (1 + s * AA.entrySlip);
        const emDist = s * (entry - pl.emergency); const tpDist = s * (pl.tp - entry);
        if (emDist <= 0 || tpDist < AA.minRR * emDist) { bump('FILL_DESTROYED_REWARD'); continue; }
        const risk = equity * AA.riskPct; const perUnit = emDist + entry * AA.exitSlip + 2 * entry * AA.feeRate;
        const qty = roundDown(risk / perUnit, c.step); const notional = qty * entry;
        if (qty <= 0 || notional < c.minNotional) { bump('BELOW_EXCHANGE_MINIMUM'); continue; }
        const openRisk = open.reduce((a, p) => a + p.plannedRiskUsd, 0);
        if (openRisk + qty * perUnit > equity * AA.maxOpenRiskPct) { bump('ACCOUNT_RISK_CAP'); continue; }
        const lev = Math.max(1, Math.min(AA.maxLeverage, Math.floor(1 / (AA.liqMultiple * emDist / entry + AA.mmr))));
        const margin = notional / lev; const used = open.reduce((a, p) => a + p.margin, 0);
        if (used + margin + notional * AA.feeRate > wallet) { bump('INSUFFICIENT_FREE_MARGIN'); continue; }
        const liqPrice = entry * (1 - s * (1 / lev - AA.mmr));
        const fee = notional * AA.feeRate;
        const tr: Trade & { s: 1 | -1 } = { id: `${pl.symbol}-${pl.side}-${t}`, symbol: pl.symbol, side: pl.side, score: pl.score, available: pl.available, decisionTime: t, entryTime: t, entry, qty, notional, leverage: lev, margin, liqPrice,
          tp: pl.tp, invalidation: pl.invalidation, emergency: pl.emergency, plannedRiskUsd: qty * perUnit, equityAtEntry: equity, rr: tpDist / emDist, etaMin: pl.etaMin,
          entryReason: `${pl.side} ${pl.symbol}: ${pl.score}/${pl.available} confirmations [${pl.evidence.join('; ')}]${pl.missing.length ? ` (no data: ${pl.missing.join(', ')})` : ''}. ${pl.context}. TP ${fmt(pl.tp)} at nearest liquidity/ATR target, R:R ${fmt(tpDist / emDist)}, est. ${Math.round(pl.etaMin)} min to TP.`,
          exitTime: null, exitPrice: null, exitReason: 'UNRESOLVED', exitDetail: '', fees: fee, funding: 0, slippageUsd: Math.abs(entry - bar.open) * qty, pnl: 0, holdMin: null,
          maeUsd: 0, maePct: 0, mfeUsd: 0, mfePct: 0, balanceAfter: null, s };
        open.push(tr); trades.push(tr);
      }
    }
    // (c) intrabar processing of this 1-minute candle (conservative: emergency before TP inside one candle)
    let uSum = 0;
    for (const p of [...open]) {
      const c = byS.get(p.symbol)!; const bar = m1At(c, t); if (!bar) continue; const mk = c.mark.get(t) ?? bar;
      const fr = c.funding.get(t); if (fr !== undefined) p.funding -= p.s * fr * p.qty * (mk.open);
      const adverse = p.s === 1 ? bar.low : bar.high, favor = p.s === 1 ? bar.high : bar.low;
      const mae = p.s * (adverse - p.entry) * p.qty; if (mae < p.maeUsd) { p.maeUsd = mae; p.maePct = p.s * (adverse - p.entry) / p.entry * 100; }
      const mfe = p.s * (favor - p.entry) * p.qty; if (mfe > p.mfeUsd) { p.mfeUsd = mfe; p.mfePct = p.s * (favor - p.entry) / p.entry * 100; }
      const markAdverse = p.s === 1 ? mk.low : mk.high;
      if (p.s * (mk.open - p.liqPrice) <= 0) { close(p, t, p.liqPrice, 'ISOLATED_LIQUIDATION', 'mark price opened beyond isolated liquidation price', false); continue; }
      if (p.s * (adverse - p.emergency) <= 0) { const px = p.s * (bar.open - p.emergency) <= 0 ? bar.open : p.emergency;
        if (p.s * (markAdverse - p.liqPrice) <= 0 && p.s * (px - p.liqPrice) <= 0) { close(p, t, p.liqPrice, 'ISOLATED_LIQUIDATION', 'price gapped through emergency level to liquidation', false); continue; }
        close(p, t, px, 'EMERGENCY_EXIT', `emergency risk level ${fmt(p.emergency)} reached (0.5% equity budget)`, true); continue; }
      if (p.s * (favor - p.tp) >= 0) { close(p, t, p.s * (bar.open - p.tp) >= 0 ? bar.open : p.tp, 'TAKE_PROFIT', `take profit ${fmt(p.tp)} reached`, false); continue; }
      uSum += p.s * (adverse - p.entry) * p.qty;
    }
    if (uSum < worstU) { worstU = uSum; worstUT = t; }
    const eq = wallet + open.reduce((a, p) => a + unreal(p, m1At(byS.get(p.symbol)!, t)?.close ?? p.entry), 0);
    if (eq > peak) peak = eq; const dd = (peak - eq) / peak * 100; if (dd > maxDd) maxDd = dd;
  }
  for (const p of open) { const c = byS.get(p.symbol)!; const last = m1At(c, o.end - MINUTE); p.pnl = (last ? unreal(p, last.close) : 0) - p.fees + p.funding; p.exitDetail = 'still open at end of available data (not counted as completed)'; }
  return { trades: trades.map(({ ...t }) => { delete (t as { s?: number }).s; delete (t as { pending?: string }).pending; return t; }), wallet, maxDrawdownPct: maxDd, worstUnrealizedUsd: worstU, worstUnrealizedTime: worstUT, rejections: rej, halts, evaluations };
}
function unreal(p: { s: 1 | -1; entry: number; qty: number }, price: number) { return p.s * (price - p.entry) * p.qty; }
