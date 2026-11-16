import { MINUTE, type Level, type SymbolState } from './series';
import type { RobotSettings } from './config';
import type { BookContext, Candidate, Direction, Evaluation, ScoreParts } from './strategy';
import { targetMove, maxStopFraction } from './strategy';
import type { EntryAudit } from './entry-audit';

/** A previously known pool, an actual sweep, reclaim and a later closed confirmation. No touch/break entry. */
export function confirmedSweep(st: SymbolState, direction: Direction, s: RobotSettings): { level: Level; evidence: string; volumeRatio: number } | { rejected: string } {
  const sign = direction === 'LONG' ? 1 : -1;
  const bar = st.m1.last(); const prev = st.m1.last(1); const atr = st.m5.atr.value;
  if (!bar || !prev || atr === null || atr <= 0) return { rejected: 'Warming up indicators' };
  const pools = st.levels.filter((l) => l.tf >= 5 && l.side === (sign > 0 ? 'low' : 'high') && l.time < (l.sweptAt ?? -Infinity));
  const swept = pools.filter((l) => l.sweptAt !== null && l.sweepExtreme !== null && bar.time - l.sweptAt <= s.sweep_max_age_minutes * MINUTE);
  if (!swept.length) return { rejected: 'No recent meaningful liquidity sweep' };
  let reason = 'No reclaimed sweep with a later confirmation';
  for (const l of [...swept].reverse()) {
    const at = l.sweptAt; const extreme = l.sweepExtreme; const sb = l.sweepBar;
    if (at === null || extreme === null || !sb) continue;
    const depth = (l.price - extreme) * sign;
    if (depth < Math.max(s.min_sweep_atr * atr, 2 * st.tickSize) || depth > s.max_sweep_atr * atr) { reason = 'Sweep too weak or too deep'; continue; }
    if (bar.time <= at || prev.time < at) { reason = 'Waiting for post-sweep confirmation close'; continue; }
    if ((prev.close - l.price) * sign <= 0 || (bar.close - l.price) * sign <= 0) { reason = 'Swept level not reclaimed on two closes'; continue; }
    const sweepRange = sb.high - sb.low;
    const wick = sign > 0 ? Math.min(sb.open, sb.close) - sb.low : sb.high - Math.max(sb.open, sb.close);
    const range = bar.high - bar.low; const body = (bar.close - bar.open) * sign;
    const closeLocation = range > 0 ? (sign > 0 ? bar.close - bar.low : bar.high - bar.close) / range : 0;
    const strongWick = sweepRange > 0 && wick / sweepRange >= s.min_rejection_wick;
    const displacement = body >= 0.5 * atr && closeLocation >= 0.7;
    const confirmation = range > 0 && body >= 0.5 * range && closeLocation >= 0.65 && (bar.close - (sign > 0 ? prev.high : prev.low)) * sign > 0;
    if (!(body > 0 && (strongWick || displacement || confirmation))) { reason = 'No directional rejection or convincing confirmation'; continue; }
    const avg = st.m1.prevVol;
    const volumeRatio = avg !== null && avg > 0 ? bar.volume / avg : 0;
    if (volumeRatio < s.min_volume_ratio) { reason = 'Confirmation volume below threshold'; continue; }
    const ema = st.m1.ema9.value;
    if ((bar.close - prev.close) * sign <= 0 || ema === null || (bar.close - ema) * sign <= 0) { reason = 'Short-term momentum does not confirm reclaim'; continue; }
    return { level: l, evidence: strongWick ? 'sweep rejection wick and directional confirmation' : displacement ? 'bullish/bearish displacement after reclaim' : 'prior-bar break with strong confirmation body', volumeRatio };
  }
  return { rejected: reason };
}

export function evaluateSweep(st: SymbolState, direction: Direction, s: RobotSettings, book: BookContext): Evaluation {
  const reject = (why: string, candidate: Candidate | null = null): Evaluation => ({ candidate, rejected: why, direction });
  if (!st.ready()) return reject('Warming up indicators');
  const bar = st.m1.last(); const prev = st.m1.last(1); const atr = st.m5.atr.value;
  if (!bar || !prev || atr === null || atr <= 0 || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || bar.close <= 0 || bar.low <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) return reject('Invalid market data');
  const sign = direction === 'LONG' ? 1 : -1; const price = bar.close; const range = bar.high - bar.low;
  if (atr / price > 0.025) return reject('Extreme volatility');
  if (range > s.max_candle_atr * atr) return reject('Unusually large confirmation candle — no chase');
  if (st.quoteVolume24h < s.min_quote_volume_musd * 1e6) return reject('Low rolling liquidity');
  if (book.spreadBps !== null && book.spreadBps > s.max_spread_bps) return reject('Abnormal spread');
  const sweep = confirmedSweep(st, direction, s);
  if ('rejected' in sweep) return reject(sweep.rejected);
  const l = sweep.level; const extreme = l.sweepExtreme; const sweptAt = l.sweptAt;
  if (extreme === null || sweptAt === null) return reject('Incomplete sweep evidence');
  const stop = extreme - sign * Math.max(0.15 * atr, 2 * st.tickSize);
  const stopPct = (price - stop) * sign / price;
  const move = targetMove(s); const tp = price * (1 + sign * move);
  const opposing = st.levels.filter((x) => x.tf >= 5 && x.sweptAt === null && x.side === (sign > 0 ? 'high' : 'low') && (x.price - price) * sign > 0).sort((a, b) => (a.price - b.price) * sign)[0];
  const costs = s.fee_pct / 100 * 2 + s.slippage_bps / 10_000 * 2;
  const rewardRisk = (0.1 / 50) / (stopPct + costs);
  const trend = st.m15.trend(true) === sign ? 20 : st.m15.trend(false) === sign ? 14 : st.m15.trend(false) === -sign ? 0 : 8;
  const body = Math.abs(bar.close - bar.open); const lower = Math.min(bar.open, bar.close) - bar.low; const upper = bar.high - Math.max(bar.open, bar.close);
  const parts: ScoreParts = { trend, structure: l.touches >= 2 ? 10 : l.tf >= 15 ? 8 : 6, setup: Math.min(25, 20 + (l.touches >= 2 ? 3 : 0) + (l.tf >= 15 ? 2 : 0)),
    trigger: 5 + (range > 0 && body / range >= 0.5 ? 5 : 0) + ((price - (sign > 0 ? prev.high : prev.low)) * sign > 0 ? 5 : 0),
    momentum: 5 + ((st.m5.macd.hist ?? 0) * sign > 0 ? 3 : 0) + (((st.m5.macd.hist ?? 0) - (st.m5.prevHist ?? 0)) * sign > 0 ? 2 : 0),
    volume: sweep.volumeRatio >= 1.5 ? 10 : sweep.volumeRatio >= 1.1 ? 7 : 4,
    execution: (book.spreadBps === null ? 3 : book.spreadBps <= s.max_spread_bps / 2 ? 5 : 2) + (rewardRisk >= 1 ? 3 : 1) + (!opposing || (opposing.price - price) * sign > 2 * price * move ? 2 : 0) };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  const explanation = `${direction}: ${l.tf}m ${l.touches >= 2 ? 'equal ' : 'swing '}${sign > 0 ? 'low' : 'high'} ${l.price} swept to ${extreme}; two closed 1m reclaims; ${sweep.evidence}; volume ${sweep.volumeRatio.toFixed(2)}x; score ${score}; stop beyond sweep + 0.15 ATR.`;
  const audit: EntryAudit = { strategy: 'LIQUIDITY_SWEEP_V1', source: 'LIVE_BINANCE', explanation, signal_open_at: bar.time, signal_close_at: bar.time + MINUTE, signal_price: price,
    body_pct: range > 0 ? body / range * 100 : 0, lower_wick_pct: range > 0 ? lower / range * 100 : 0, upper_wick_pct: range > 0 ? upper / range * 100 : 0,
    volume: bar.volume, volume_ratio: sweep.volumeRatio, atr, pool_price: l.price, pool_time: l.time, pool_tf: l.tf, pool_touches: l.touches,
    sweep_at: sweptAt, sweep_extreme: extreme, reclaim_at: prev.time + MINUTE, confirmation_at: bar.time + MINUTE, opposing_level: opposing?.price ?? null, reward_risk: rewardRisk };
  const candidate: Candidate = { symbol: st.symbol, direction, time: bar.time, setup: 'SWEEP_RECLAIM', score, tier: score >= s.high_score ? 'STRONG' : score >= s.min_score ? 'QUALIFIED' : 'WEAK',
    parts, entry: price, stop, tp, atr, atrPct: atr / price * 100, stopPct, tpPct: move * 100, liquidity: explanation, audit };
  if (!(stopPct > 0) || stopPct > maxStopFraction(s)) return reject('Structural stop too wide for 50x', candidate);
  if (opposing && (opposing.price - price) * sign < price * move + 0.05 * atr) return reject('Opposing liquidity before net target', candidate);
  if (rewardRisk < s.min_reward_risk) return reject('Net reward too small relative to structural stop and costs', candidate);
  if (score < s.min_score) return reject(`Score ${score} below ${s.min_score}`, candidate);
  return { candidate, rejected: null, direction };
}