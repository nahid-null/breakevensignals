/**
 * Smart Money Concepts entry engine (paper robot, SMC_V1). Pure: closed candles in, decision out.
 * 15m sets the bias, 5m holds the liquidity pools and volatility, 1m gives the entry.
 * LONG sequence (SHORT mirrored): sell-side liquidity sweep -> bullish MSS/CHoCH (close above the last 1m swing high
 * that formed before the sweep) -> bullish FVG or order block left by the move -> price retraces into that zone and
 * into the 62-79% OTE band of the post-sweep leg -> bullish rejection close -> spread/volatility/chase checks.
 * Sweep and MSS are mandatory; a high score never overrides a failed mandatory or safety condition.
 */
import { MINUTE, type Bar, type Level, type SymbolState } from './series';
import type { RobotSettings } from './config';
import type { BookContext, Candidate, Direction, Evaluation } from './strategy';
import { maxStopFraction, targetMove } from './strategy';
import type { EntryAudit } from './entry-audit';

export const SMC_STRATEGY = 'SMC_V1';
/** Points per component; maximum 100. */
export const SMC_WEIGHTS = { sweep: 20, mss: 20, fvg: 15, order_block: 10, htf: 15, displacement: 10, premium_discount: 5, volume: 5 } as const;
export type SmcParts = { [K in keyof typeof SMC_WEIGHTS]: number };
export type Zone = { kind: 'FVG' | 'OB'; low: number; high: number; time: number };

const PIVOT = 2;
/** Most recent confirmed 1m swing of the given side strictly before index `end`. */
export function lastSwing(bars: Bar[], end: number, side: 'high' | 'low', lookback = 40): { price: number; index: number } | null {
  for (let i = end - 1 - PIVOT; i >= Math.max(PIVOT, end - lookback); i--) {
    const p = bars[i]!; let ok = true;
    for (let k = i - PIVOT; k <= i + PIVOT && ok; k++) {
      if (k === i || k >= end) continue;
      const o = bars[k]!;
      if (side === 'high' ? o.high >= p.high : o.low <= p.low) ok = false;
    }
    if (ok) return { price: side === 'high' ? p.high : p.low, index: i };
  }
  return null;
}

/** Fair value gaps created by the move between `from` and `to` (inclusive), still unfilled by a close through them. */
export function findFvg(bars: Bar[], from: number, to: number, sign: 1 | -1, minGap: number): Zone | null {
  let best: Zone | null = null;
  for (let k = Math.max(from + 2, 2); k <= to; k++) {
    const a = bars[k - 2]!; const c = bars[k]!;
    const low = sign > 0 ? a.high : c.high; const high = sign > 0 ? c.low : a.low;
    if (high - low < minGap) continue;
    const filled = bars.slice(k + 1).some((b) => sign > 0 ? b.close < low : b.close > high);
    if (!filled) best = { kind: 'FVG', low, high, time: bars[k - 1]!.time };
  }
  return best;
}

/** Last opposite-colour candle before the displacement that broke structure (institutional demand/supply), not invalidated since. */
export function findOrderBlock(bars: Bar[], from: number, mss: number, sign: 1 | -1): Zone | null {
  for (let i = mss - 1; i >= from; i--) {
    const b = bars[i]!;
    if ((b.close - b.open) * sign >= 0) continue;
    const zone: Zone = { kind: 'OB', low: b.low, high: b.high, time: b.time };
    const broken = bars.slice(mss + 1).some((x) => sign > 0 ? x.close < zone.low : x.close > zone.high);
    return broken ? null : zone;
  }
  return null;
}

/** Recent 5m-or-equal-touch pool on the stop side, swept within the age window, with a sane sweep depth. */
function recentSweep(st: SymbolState, sign: 1 | -1, s: RobotSettings, now: number, atr5: number): Level | null | 'depth' {
  const pools = st.levels.filter((l) => (l.tf >= 5 || l.touches >= 2) && l.side === (sign > 0 ? 'low' : 'high')
    && l.sweptAt !== null && l.sweepExtreme !== null && l.time < l.sweptAt && now - l.sweptAt <= s.sweep_max_age_minutes * MINUTE);
  if (!pools.length) return null;
  const ok = pools.filter((l) => { const d = (l.price - l.sweepExtreme!) * sign; return d >= Math.max(s.min_sweep_atr * atr5, 2 * st.tickSize) && d <= s.max_sweep_atr * atr5; });
  return ok.sort((a, b) => b.sweptAt! - a.sweptAt!)[0] ?? 'depth';
}

export function evaluateSmc(st: SymbolState, direction: Direction, s: RobotSettings, book: BookContext): Evaluation {
  const reject = (why: string, candidate: Candidate | null = null): Evaluation => ({ candidate, rejected: why, direction });
  if (!st.ready()) return reject('Warming up indicators');
  const bars = st.m1.bars; const n = bars.length; const bar = bars[n - 1]; const prev = bars[n - 2];
  const atr5 = st.m5.atr.value; const atr1 = st.m1.atr.value;
  if (!bar || !prev || atr5 === null || atr1 === null || atr5 <= 0 || atr1 <= 0
    || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || bar.close <= 0 || bar.low <= 0
    || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) return reject('Invalid market data');
  const sign: 1 | -1 = direction === 'LONG' ? 1 : -1; const price = bar.close; const now = bar.time + MINUTE;

  // --- Safety / execution environment -------------------------------------------------------
  if (atr5 / price > 0.025) return reject('Extreme volatility');
  if (st.quoteVolume24h < s.min_quote_volume_musd * 1e6) return reject('Low rolling liquidity');
  if (book.spreadBps !== null && book.spreadBps > s.max_spread_bps) return reject('Abnormal spread');
  if (bar.high - bar.low > s.max_candle_atr * atr5) return reject('Unusually large candle — not chasing');
  if (prev.high - prev.low > s.max_candle_atr * atr5) return reject('Entry right after a large candle — waiting');

  // --- 1. Liquidity sweep (mandatory) -------------------------------------------------------
  const pool = recentSweep(st, sign, s, now, atr5);
  if (pool === null) return reject(`No recent ${sign > 0 ? 'sell' : 'buy'}-side liquidity sweep`);
  if (pool === 'depth') return reject('Sweep too weak or too deep');
  const si = bars.findIndex((b) => b.time === pool.sweptAt);
  if (si < 0) return reject('Sweep candle no longer in memory');
  const extreme = pool.sweepExtreme!;

  // --- 2. MSS / CHoCH (mandatory): close beyond the last opposite swing that formed before the sweep ----
  const swing = lastSwing(bars, si + 1, sign > 0 ? 'high' : 'low');
  if (!swing) return reject('No prior swing to confirm a structure shift');
  let mi = -1;
  for (let j = si; j < n; j++) if ((bars[j]!.close - swing.price) * sign > 0) { mi = j; break; }
  if (mi < 0) return reject(`Waiting for ${sign > 0 ? 'bullish' : 'bearish'} MSS: no close beyond ${swing.price}`);
  if (mi >= n - 1) return reject('Structure just shifted — waiting for the retracement, not chasing');
  const mssKind = st.m5.trend(false) === -sign ? 'CHoCH' : 'MSS';

  // --- Displacement ------------------------------------------------------------------------
  const leg = bars.slice(si + 1, mi + 1);
  const displacement = leg.some((b) => { const r = b.high - b.low; return r > 0 && (b.close - b.open) * sign >= 0.6 * r && r >= 1.2 * atr1; })
    || (bars[mi]!.close - extreme) * sign >= 2 * atr1;

  // --- 3. FVG / Order block ------------------------------------------------------------------
  const fvg = findFvg(bars, si, Math.min(mi + 1, n - 2), sign, Math.max(2 * st.tickSize, 0.1 * atr1));
  const ob = findOrderBlock(bars, si, mi, sign);
  const zone = fvg ?? ob;
  if (!zone) return reject('No valid FVG or order block after the structure shift');

  // --- 4. Retracement into the zone and the OTE band ------------------------------------------
  const after = bars.slice(mi + 1);
  const impulse = sign > 0 ? Math.max(...bars.slice(si, n - 1).map((b) => b.high)) : Math.min(...bars.slice(si, n - 1).map((b) => b.low));
  const legSize = (impulse - extreme) * sign;
  if (!(legSize > 0)) return reject('No impulse leg after the sweep');
  const deepest = sign > 0 ? Math.min(...after.map((b) => b.low)) : Math.max(...after.map((b) => b.high));
  if ((deepest - extreme) * sign <= 0) return reject('Retracement took out the sweep extreme — structure invalid');
  const tapped = [prev, bar].some((b, k) => n - 2 + k > mi && (sign > 0 ? b.low <= zone.high : b.high >= zone.low));
  if (!tapped) return reject(`Waiting for retracement into the ${zone.kind}`);
  const depth = (impulse - deepest) * sign / legSize;
  if (depth < s.ote_min || depth > s.ote_max) return reject(`Retracement ${(depth * 100).toFixed(0)}% outside OTE ${Math.round(s.ote_min * 100)}–${Math.round(s.ote_max * 100)}%`);

  // --- 5. Rejection candle close ----------------------------------------------------------------
  const range = bar.high - bar.low; const body = (bar.close - bar.open) * sign;
  const closeLoc = range > 0 ? (sign > 0 ? bar.close - bar.low : bar.high - bar.close) / range : 0;
  if (!(body > 0) || closeLoc < 0.6) return reject(`No ${sign > 0 ? 'bullish' : 'bearish'} rejection close from the zone`);
  if ((price - (sign > 0 ? zone.low : zone.high)) * sign <= 0) return reject('Closed through the zone — setup invalid');
  if ((price - (sign > 0 ? zone.high : zone.low)) * sign > 0.5 * atr1) return reject('Price already left the entry zone — not chasing');

  // --- 6. Higher-timeframe alignment ----------------------------------------------------------
  const strict15 = st.m15.trend(true); const loose15 = st.m15.trend(false);
  if (loose15 === -sign && pool.tf < 15) return reject('Against the 15m bias without a 15m liquidity reversal');

  // --- Stop, target, reward/risk ---------------------------------------------------------------
  const invalidation = sign > 0 ? Math.min(extreme, zone.low) : Math.max(extreme, zone.high);
  const stop = invalidation - sign * Math.max(0.1 * atr5, 2 * st.tickSize);
  const stopPct = (price - stop) * sign / price;
  const move = targetMove(s); const tp = price * (1 + sign * move);
  const opposing = st.levels.filter((x) => x.tf >= 5 && x.sweptAt === null && x.side === (sign > 0 ? 'high' : 'low') && (x.price - price) * sign > 0)
    .sort((a, b) => (a.price - b.price) * sign)[0];
  const costs = s.fee_pct / 100 * 2 + s.slippage_bps / 10_000 * 2;
  const rewardRisk = move / (stopPct + costs);

  // --- Score --------------------------------------------------------------------------------
  const mid = (impulse + extreme) / 2;
  const avgVol = st.m1.vol.value ?? 0;
  const volumeRatio = avgVol > 0 ? Math.max(...bars.slice(si, mi + 1).map((b) => b.volume)) / avgVol : 0;
  const parts: SmcParts = {
    sweep: SMC_WEIGHTS.sweep, mss: SMC_WEIGHTS.mss,
    fvg: fvg ? SMC_WEIGHTS.fvg : 0, order_block: ob ? SMC_WEIGHTS.order_block : 0,
    htf: strict15 === sign ? 15 : loose15 === sign ? 10 : loose15 === 0 ? 5 : 0,
    displacement: displacement ? SMC_WEIGHTS.displacement : 0,
    premium_discount: (price - mid) * sign < 0 ? SMC_WEIGHTS.premium_discount : 0,
    volume: volumeRatio >= 1.2 ? SMC_WEIGHTS.volume : 0,
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  const side = sign > 0 ? 'Sell' : 'Buy';
  const explanation = `${direction}: ${side}-side ${pool.tf}m ${pool.touches >= 2 ? 'equal ' : ''}${sign > 0 ? 'low' : 'high'} ${pool.price} swept to ${extreme}; `
    + `${mssKind} close beyond ${swing.price}; ${fvg ? `FVG ${fvg.low}–${fvg.high}` : ''}${fvg && ob ? ' + ' : ''}${ob ? `order block ${ob.low}–${ob.high}` : ''}; `
    + `retrace ${(depth * 100).toFixed(0)}% (OTE); ${(price - mid) * sign < 0 ? (sign > 0 ? 'discount' : 'premium') : 'equilibrium side'}; `
    + `15m ${strict15 === sign ? 'strongly aligned' : loose15 === sign ? 'aligned' : loose15 === 0 ? 'neutral' : 'opposed (15m pool reversal)'}; `
    + `${displacement ? 'displacement' : 'no strong displacement'}; score ${score}; stop beyond ${zone.kind === 'OB' ? 'order block / ' : ''}sweep extreme.`;
  const upper = bar.high - Math.max(bar.open, bar.close); const lower = Math.min(bar.open, bar.close) - bar.low;
  const audit: EntryAudit = { strategy: SMC_STRATEGY, source: 'LIVE_BINANCE', explanation, signal_open_at: bar.time, signal_close_at: now, signal_price: price,
    body_pct: range > 0 ? Math.abs(bar.close - bar.open) / range * 100 : 0, lower_wick_pct: range > 0 ? lower / range * 100 : 0, upper_wick_pct: range > 0 ? upper / range * 100 : 0,
    volume: bar.volume, volume_ratio: volumeRatio, atr: atr5, pool_price: pool.price, pool_time: pool.time, pool_tf: pool.tf, pool_touches: pool.touches,
    sweep_at: pool.sweptAt!, sweep_extreme: extreme, reclaim_at: bars[mi]!.time + MINUTE, confirmation_at: now, opposing_level: opposing?.price ?? null, reward_risk: rewardRisk,
    mss_kind: mssKind, mss_level: swing.price, mss_at: bars[mi]!.time + MINUTE, zone_kind: fvg && ob ? 'FVG+OB' : zone.kind, zone_low: zone.low, zone_high: zone.high,
    fvg_low: fvg?.low ?? null, fvg_high: fvg?.high ?? null, ob_low: ob?.low ?? null, ob_high: ob?.high ?? null,
    ote_depth: depth, premium_discount: (price - mid) * sign < 0 ? (sign > 0 ? 'DISCOUNT' : 'PREMIUM') : 'EQUILIBRIUM_OR_WRONG_SIDE',
    htf_bias: strict15 === 1 || loose15 === 1 ? 'BULLISH' : strict15 === -1 || loose15 === -1 ? 'BEARISH' : 'NEUTRAL', displacement, score_parts: parts };
  const candidate: Candidate = { symbol: st.symbol, direction, time: bar.time, setup: 'SMC_SWEEP_MSS', score,
    tier: score >= s.high_score ? 'STRONG' : score >= s.min_score ? 'QUALIFIED' : 'WEAK',
    parts, entry: price, stop, tp, atr: atr5, atrPct: atr5 / price * 100, stopPct, tpPct: move * 100, liquidity: explanation, audit };
  if (!(stopPct > 0) || stopPct > maxStopFraction(s)) return reject('Structural stop too wide for 50x', candidate);
  if (opposing && (opposing.price - price) * sign < price * move + 0.05 * atr5) return reject('Opposing liquidity before net target', candidate);
  if (rewardRisk < s.min_reward_risk) return reject('Net reward too small relative to structural stop and costs', candidate);
  if (score < s.min_score) return reject(`Score ${score} below ${s.min_score}`, candidate);
  return { candidate, rejected: null, direction };
}
