/**
 * Adaptive micro-scalping signal engine. 15m = trend context, 5m = setup, 1m = entry timing.
 * Six setup families compete; the best one for a direction is scored 0-100 with weighted parts.
 * Hard rejects are limited to safety and the explicit "avoid" list; everything else is weighting.
 */
import { MINUTE, type Level, type SymbolState } from './series';
import { PAPER_LEVERAGE, TARGET_NET_ROI_PCT, type RobotSettings } from './config';
import type { EntryAudit } from './entry-audit';
import { evaluateSmc } from './smc';

export type Direction = 'LONG' | 'SHORT';
export const SETUPS = ['SMC_SWEEP_MSS', 'SWEEP_RECLAIM', 'TREND_PULLBACK', 'EMA_RETEST', 'VWAP_RECLAIM', 'SR_REJECTION', 'BREAKOUT_RETEST'] as const;
/** PULLBACK_RECLAIM is the retired family name kept only so old rows still read. */
export type Setup = (typeof SETUPS)[number] | 'PULLBACK_RECLAIM';
/** Weighted score components; names depend on the evaluator that produced them. */
export type ScoreParts = Record<string, number>;
export type Candidate = {
  symbol: string; direction: Direction; time: number; setup: Setup; score: number; tier: 'STRONG' | 'QUALIFIED' | 'WEAK'; parts: ScoreParts;
  entry: number; stop: number; tp: number; atr: number; atrPct: number; stopPct: number; tpPct: number; liquidity: string; audit?: EntryAudit;
};
export type Evaluation = { candidate: Candidate | null; rejected: string | null; direction: Direction };
/** Book data is only available live. Backtests pass null and get neutral points; never fabricated. */
export type BookContext = { spreadBps: number | null; imbalance: number | null; depthUsd: number | null };

const COUNTER_TREND_OK: ReadonlySet<Setup> = new Set(['SWEEP_RECLAIM', 'SR_REJECTION']);

/** Price move (fraction) from entry that yields the target NET ROI at 50x after taker entry and maker exit fees. */
export function targetMove(s: Pick<RobotSettings, 'fee_pct' | 'maker_fee_pct'>, roiPct = TARGET_NET_ROI_PCT, leverage = PAPER_LEVERAGE) {
  const t = s.fee_pct / 100; const m = s.maker_fee_pct / 100; const r = roiPct / 100 / leverage;
  return (1 + r + t) / (1 - m) - 1;
}
/** Widest structural stop accepted: keeps risk proportionate to the fixed 10% target and well inside 50x liquidation. */
/** Structural constants: best profit factor of six variants on Nov 3-12 2026 replays. All variants lost money, and the one unseen Nov 12-16 check lost too. No proven edge. */
export const TUNING = { maxStopMult: 3.5, earlyExit: false, profitLockAt: 6 };
export const maxStopFraction = (s: Pick<RobotSettings, 'fee_pct' | 'maker_fee_pct'>) => Math.min(0.009, TUNING.maxStopMult * targetMove(s));
export const MIN_STOP_FRACTION = 0.0012;

type Family = { setup: Setup; quality: number; stopRef: number; label: string };

/** Archived evaluator for old/new comparisons only; live entries are exclusively confirmed liquidity sweeps. */
export function evaluateLegacy(st: SymbolState, direction: Direction, s: RobotSettings, book: BookContext): Evaluation {
  const reject = (why: string, candidate: Candidate | null = null): Evaluation => ({ candidate, rejected: why, direction });
  if (!st.ready()) return reject('Warming up indicators');
  const long = direction === 'LONG'; const sign = long ? 1 : -1;
  const m1 = st.m1; const m5 = st.m5; const bar = m1.last()!; const prev = m1.last(1); const b5 = m5.last();
  if (!prev || !b5) return reject('Warming up indicators');
  const price = bar.close; const now = bar.time + MINUTE;
  const atr = m5.atr.value!; const atrPct = (atr / price) * 100;
  const e9 = m5.ema9.value!; const e21 = m5.ema21.value!; const e50 = m5.ema50.value!;
  const e9m1 = m1.ema9.value!; const vwap = m1.vwap.value!;
  const rsi = m5.rsi.value!; const hist = m5.macd.hist!; const prevHist = m5.prevHist ?? hist;
  const move = targetMove(s); const tpDist = price * move;

  // --- Safety and "avoid" list ------------------------------------------------------------
  if (![bar.open, bar.high, bar.low, bar.close, atr].every((x) => Number.isFinite(x) && x > 0) || bar.high < bar.low) return reject('Invalid market data');
  if (atrPct > 2.5) return reject('Extreme volatility');
  if (atr < 0.35 * tpDist) return reject('Too quiet to reach the 10% net target');
  if (st.quoteVolume24h < s.min_quote_volume_musd * 1e6) return reject('Low 24h liquidity');
  if (book.spreadBps !== null && book.spreadBps > s.max_spread_bps) return reject('Abnormal spread');
  const range = bar.high - bar.low; const body = Math.abs(bar.close - bar.open);
  if (body > 1.0 * atr) return reject('Extended 1m candle — not chasing');
  if ((price - e21) * sign > 2.5 * atr) return reject('Price extended from 5m mean — not chasing');
  if (long ? rsi > 75 : rsi < 25) return reject('Momentum overextended');

  // --- Context -----------------------------------------------------------------------------
  const t15 = st.m15.trend(true) === sign ? 2 : st.m15.trend(false) === sign ? 1 : st.m15.trend(false) === -sign ? -1 : 0;
  const pools5 = st.levels.filter((l) => l.tf >= 5);
  const lows = pools5.filter((l) => l.side === 'low').slice(-2); const highs = pools5.filter((l) => l.side === 'high').slice(-2);
  const slope = (xs: Level[]) => xs.length === 2 ? Math.sign((xs[1]!.price - xs[0]!.price) * sign) : 0;
  const structure = slope(lows) + slope(highs); // -2..2 in trade direction
  const recent1 = m1.bars.slice(-6, -1); const recent5 = m5.bars.slice(-4);
  const ext = (xs: { low: number; high: number }[]) => long ? Math.min(...xs.map((b) => b.low)) : Math.max(...xs.map((b) => b.high));

  // --- Setup families ----------------------------------------------------------------------
  const families: Family[] = [];
  // A. Liquidity sweep and reclaim: a pool was taken and price closed back beyond it twice (confirmed).
  for (const l of pools5) {
    if (l.side !== (long ? 'low' : 'high') || l.sweptAt === null || l.sweepExtreme === null || now - l.sweptAt > 20 * MINUTE) continue;
    const depth = (l.price - l.sweepExtreme) * sign;
    if (depth < 0.05 * atr || depth > 1.5 * atr) continue;
    if ((bar.close - l.price) * sign <= 0 || (prev.close - l.price) * sign <= 0) continue;
    families.push({ setup: 'SWEEP_RECLAIM', quality: Math.min(25, 15 + (l.touches > 1 ? 5 : 0) + (l.tf >= 15 ? 5 : 0)), stopRef: l.sweepExtreme,
      label: `${long ? 'Sell' : 'Buy'}-side sweep of ${l.tf}m ${l.touches > 1 ? 'equal ' + (long ? 'lows' : 'highs') : 'swing'} reclaimed` });
  }
  // B. Trend pullback and continuation on 5m, triggered by a 1m break of the prior bar.
  const stack = (e9 - e21) * sign > 0 && (e21 - e50) * sign > 0;
  if (stack && recent5.some((b) => long ? b.low <= e21 + 0.15 * atr : b.high >= e21 - 0.15 * atr)
    && recent5.every((b) => (b.close - e50) * sign > -0.1 * atr) && (bar.close - (long ? prev.high : prev.low)) * sign > 0)
    families.push({ setup: 'TREND_PULLBACK', quality: 20 + (rsi >= 40 && rsi <= 60 ? 3 : 0), stopRef: ext([...recent5, bar]), label: 'Pullback to 5m EMA21 in trend, 1m break' });
  // C. EMA9 retest with momentum confirmation.
  if ((e9 - e21) * sign > 0 && (b5.close - e9) * sign > 0 && hist * sign > 0
    && [...recent1.slice(-3), bar].some((b) => long ? b.low <= e9 + 0.1 * atr && b.low >= e9 - 0.15 * atr : b.high >= e9 - 0.1 * atr && b.high <= e9 + 0.15 * atr)
    && (bar.close - e9) * sign > 0)
    families.push({ setup: 'EMA_RETEST', quality: 16 + ((hist - prevHist) * sign > 0 ? 4 : 0), stopRef: ext([...recent1, bar]), label: '5m EMA9 retest with MACD momentum' });
  // D. VWAP reclaim (cross back with two closes) or VWAP rejection (wick through, close away).
  const below = m1.bars.slice(-11, -2).filter((b) => (b.close - vwap) * sign < 0).length;
  if (below >= 2 && (bar.close - vwap) * sign > 0 && (prev.close - vwap) * sign > 0)
    families.push({ setup: 'VWAP_RECLAIM', quality: 15 + (bar.volume >= 1.5 * (m1.vol.value ?? Infinity) ? 4 : 0), stopRef: ext([...recent1, bar]), label: 'VWAP reclaimed with two 1m closes' });
  else if (below === 0 && (long ? bar.low <= vwap + 0.05 * atr : bar.high >= vwap - 0.05 * atr) && (bar.close - vwap) * sign > 0.1 * atr)
    families.push({ setup: 'VWAP_RECLAIM', quality: 15, stopRef: ext([...recent1.slice(-2), bar]), label: `VWAP ${long ? 'support' : 'resistance'} rejection` });
  // E. Support / resistance rejection: touch (not a sweep) of a 5m+ pool with a strong rejection wick.
  const wick = long ? Math.min(bar.open, bar.close) - bar.low : bar.high - Math.max(bar.open, bar.close);
  const closeLoc = range > 0 ? (long ? bar.close - bar.low : bar.high - bar.close) / range : 0;
  for (const l of pools5) {
    if (l.side !== (long ? 'low' : 'high')) continue;
    if (l.sweptAt !== null && !(l.sweptAt === bar.time && Math.abs((l.sweepExtreme ?? l.price) - l.price) <= 0.1 * atr)) continue;
    const ext1 = long ? bar.low : bar.high;
    if (Math.abs(ext1 - l.price) > 0.15 * atr || range <= 0 || wick < 0.5 * range || closeLoc < 0.65) continue;
    families.push({ setup: 'SR_REJECTION', quality: Math.min(23, 14 + (l.touches > 1 ? 5 : 0) + (l.tf >= 15 ? 4 : 0)),
      stopRef: long ? Math.min(bar.low, l.price) : Math.max(bar.high, l.price), label: `${l.tf}m ${long ? 'support' : 'resistance'} rejection` });
  }
  // F. Confirmed breakout retest: a 5m close beyond the level, then a 1m retest that holds.
  for (const l of pools5) {
    if (l.side !== (long ? 'high' : 'low') || l.sweptAt === null || now - l.sweptAt > 45 * MINUTE) continue;
    const sweptAt = l.sweptAt;
    if (!m5.bars.some((b) => b.time >= sweptAt - 4 * MINUTE && (b.close - l.price) * sign > 0.1 * atr)) continue;
    if (![...recent1.slice(-3), bar].some((b) => Math.abs((long ? b.low : b.high) - l.price) <= 0.15 * atr)) continue;
    if ((bar.close - l.price) * sign <= 0.05 * atr || (bar.close - bar.open) * sign <= 0) continue;
    families.push({ setup: 'BREAKOUT_RETEST', quality: 20 + (l.tf >= 15 ? 3 : 0), stopRef: long ? Math.min(ext([...recent1.slice(-3), bar]), l.price - 0.3 * atr)
      : Math.max(ext([...recent1.slice(-3), bar]), l.price + 0.3 * atr), label: `Breakout retest of ${l.tf}m ${long ? 'resistance' : 'support'}` });
  }
  const allowed = families.filter((f) => t15 >= 0 || COUNTER_TREND_OK.has(f.setup));
  if (!families.length) return reject('No qualifying setup');
  if (!allowed.length) return reject('Trend setup against 15m trend');
  const fam = allowed.sort((a, b) => b.quality - a.quality)[0]!;

  // --- 1m entry trigger ---------------------------------------------------------------------
  if ((bar.close - bar.open) * sign <= 0) return reject('No 1m entry trigger candle');

  // --- Stop: structure + ATR buffer, liquidity-aware; never moved later except to tighten ------
  let stop = fam.stopRef - sign * Math.max(0.25 * atr, 2 * st.tickSize);
  const crowded = pools5.find((l) => l.sweptAt === null && l.side === (long ? 'low' : 'high') && Math.abs(l.price - stop) < 0.2 * atr);
  if (crowded) stop = crowded.price - sign * 0.3 * atr; // step beyond an obvious stop cluster
  const minDist = Math.max(0.5 * atr, MIN_STOP_FRACTION * price, 3 * st.tickSize);
  if ((price - stop) * sign < minDist) stop = price - sign * minDist;
  const stopPct = ((price - stop) * sign) / price;
  const tp = price + sign * tpDist;

  // --- Weighted score -----------------------------------------------------------------------
  const parts: ScoreParts = { trend: 0, structure: 0, setup: 0, trigger: 0, momentum: 0, volume: 0, execution: 0 };
  parts.trend = t15 === 2 ? 20 : t15 === 1 ? 14 : t15 === 0 ? 8 : 0;
  parts.structure = structure === 2 ? 10 : structure === 1 ? 7 : structure === 0 ? 4 : structure === -1 ? 2 : 0;
  parts.setup = fam.quality;
  parts.trigger = ((price - e9m1) * sign > 0 ? 5 : 0) + (range > 0 && body >= 0.5 * range ? 5 : 0) + ((price - (long ? prev.high : prev.low)) * sign > 0 ? 5 : 0);
  const rsiOk = long ? rsi >= 42 && rsi <= 70 : rsi <= 58 && rsi >= 30;
  const rsiRising = (rsi - (m5.prevRsi ?? rsi)) * sign > 0;
  parts.momentum = (rsiOk ? 3 : 0) + (rsiRising ? 2 : 0) + ((hist - prevHist) * sign > 0 ? 3 : 0) + (hist * sign > 0 ? 2 : 0);
  const avgVol = m1.vol.value ?? 0; const vr = avgVol > 0 ? Math.max(bar.volume, prev.volume) / avgVol : 0;
  parts.volume = vr >= 1.5 ? 10 : vr >= 1.1 ? 6 : vr >= 0.7 ? 3 : 0;
  const opposing = pools5.filter((l) => l.sweptAt === null && l.side === (long ? 'high' : 'low') && (l.price - price) * sign > 0)
    .sort((a, b) => (a.price - b.price) * sign)[0];
  const room = opposing ? Math.abs(opposing.price - price) : Infinity;
  parts.execution = (book.spreadBps === null ? 3 : book.spreadBps <= s.max_spread_bps / 2 ? 5 : 2)
    + (book.imbalance === null ? 2 : book.imbalance * sign >= 0.1 ? 3 : book.imbalance * sign >= -0.3 ? 2 : 0) + (room >= 2 * tpDist ? 2 : 0);
  const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
  const tier = score >= s.high_score ? 'STRONG' : score >= s.min_score ? 'QUALIFIED' : 'WEAK';
  const candidate: Candidate = { symbol: st.symbol, direction, time: bar.time, setup: fam.setup, score, tier, parts, entry: price, stop, tp,
    atr, atrPct, stopPct, tpPct: move * 100, liquidity: fam.label };

  // --- Late hard rejects (candidate is still reported with its score) ----------------------
  if (stopPct > maxStopFraction(s)) return reject(`Structural stop too wide for 50x (${(stopPct * 100).toFixed(2)}%)`, candidate);
  if (room < tpDist + 0.05 * atr) return reject(`${long ? 'Resistance' : 'Support'} before the 10% target`, candidate);
  if (book.imbalance !== null && book.imbalance * sign < -0.6) return reject('Order book strongly against direction', candidate);
  if (score < s.min_score) return reject(`Score ${score} below ${s.min_score}`, candidate);
  return { candidate, rejected: null, direction };
}

/** Live robot entries: SMC_V1 only (prompt-20). The previous sweep/reclaim and six-family evaluators are kept for replay comparison. */
export const evaluate = evaluateSmc;
