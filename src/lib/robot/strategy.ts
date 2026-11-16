import type { RobotSettings } from './config';
import type { Level, SymbolState } from './series';

export type Direction = 'LONG' | 'SHORT';
export type Setup = 'SWEEP_RECLAIM' | 'PULLBACK_RECLAIM';
export type ScoreParts = { trend: number; structure: number; liquidity: number; confirmation: number; volume: number;
  momentum: number; volatility: number; spread: number; room: number };
export type Candidate = {
  symbol: string; direction: Direction; time: number; setup: Setup; score: number; parts: ScoreParts;
  entry: number; stop: number; tp1: number; tp2: number; atr: number; atrPct: number;
  sweptLevel: number | null; liquidity: string;
};
export type Evaluation = { candidate: Candidate | null; rejected: string | null; direction: Direction };
/** Book data is only available live. Backtests pass null and get neutral points; never fabricated. */
export type BookContext = { spreadBps: number | null; imbalance: number | null; depthUsd: number | null };

/** Signal bars are 5m; the 15m and 1h trends give context. Sweeps are tracked on 1m bars. */
const SWEEP_LOOKBACK_MS = 15 * 60_000;
/** Structural constants, adjustable only after backtesting. */
export const TUNING = { stopBufferAtr: 0.5, minRiskAtr: 1.0, maxRiskAtr: 2.2, requireBothTrends: false, allowPullback: true,
  tp1R: 1, tp2R: 2, minRr1: 0.7, confirmBars: 2 };
export const roundTripCostPct = (s: RobotSettings) => 2 * (s.fee_pct + s.slippage_bps / 100);

export function evaluate(st: SymbolState, direction: Direction, s: RobotSettings, book: BookContext): Evaluation {
  const reject = (why: string, candidate: Candidate | null = null): Evaluation => ({ candidate, rejected: why, direction });
  if (!st.ready()) return reject('Warming up');
  const long = direction === 'LONG'; const sign = long ? 1 : -1;
  const sig = st.m5; const bar = sig.last()!; const now = bar.time + 5 * 60_000;
  const atr = sig.atr.value!; const price = bar.close; const atrPct = (atr / price) * 100;
  const ema9 = sig.ema9.value!; const ema21 = sig.ema21.value!; const vwap = st.m1.vwap.value ?? price;
  const rsi = sig.rsi.value ?? 50; const hist = sig.macd.hist ?? 0;
  const cost = roundTripCostPct(s);

  // Hard filters: abnormal conditions, liquidity, volatility.
  if (atrPct > 2.5) return reject('Extreme volatility');
  if (atrPct < 0.12) return reject('Market too quiet to cover costs');
  if (st.quoteVolume24h < s.min_quote_volume_musd * 1e6) return reject('Low 24h liquidity');
  if (book.spreadBps !== null && book.spreadBps > s.max_spread_bps) return reject('Spread too wide');
  if (book.depthUsd !== null && book.depthUsd < 25_000) return reject('Thin order book');
  const range = bar.high - bar.low; const body = Math.abs(bar.close - bar.open);
  if (range > 3 * atr) return reject('Abnormal candle range');
  if (body > 1.8 * atr) return reject('Extended candle; not chasing');
  const wickAgainst = long ? bar.high - Math.max(bar.open, bar.close) : Math.min(bar.open, bar.close) - bar.low;
  if (wickAgainst > 1.5 * atr) return reject('Abnormal wick');
  if (sig.vol.value && bar.volume > 6 * sig.vol.value && body > 1.2 * atr) return reject('Volume spike with extended move');

  const htf = st.m60.trend(true); const mid = st.m15.trend(false);
  if (htf === -sign || mid === -sign) return reject('Against higher-timeframe trend');
  if (TUNING.requireBothTrends ? htf !== sign || mid !== sign : htf !== sign && mid !== sign) return reject('No higher-timeframe trend');
  if (long ? rsi > 70 : rsi < 30) return reject('Momentum overextended');

  // Setup: sweep of a 5m+ liquidity pool and reclaim, else pullback into EMA21/VWAP in a 1h trend.
  const pools = st.levels.filter((l) => l.tf >= 5);
  let setup: Setup | null = null; let swept: Level | null = null; let extreme = 0;
  for (const l of pools) {
    if (l.side !== (long ? 'low' : 'high') || l.sweptAt === null || l.sweepExtreme === null) continue;
    if (now - l.sweptAt > SWEEP_LOOKBACK_MS) continue;
    const depth = (l.price - l.sweepExtreme) * sign;
    if (depth < 0.05 * atr || depth > 1.5 * atr) continue;
    if ((bar.close - l.price) * sign <= 0) continue;
    if (!swept || l.touches > swept.touches || l.tf > swept.tf) { swept = l; extreme = l.sweepExtreme; }
  }
  if (swept) setup = 'SWEEP_RECLAIM';
  const recent = sig.bars.slice(-4, -1);
  if (!setup && TUNING.allowPullback && htf === sign) {
    const zone = long ? Math.max(ema21, vwap) : Math.min(ema21, vwap);
    const touched = recent.some((b) => long ? b.low <= zone + 0.1 * atr : b.high >= zone - 0.1 * atr);
    const held = recent.every((b) => long ? b.close > zone - 0.5 * atr : b.close < zone + 0.5 * atr);
    if (touched && held) { setup = 'PULLBACK_RECLAIM'; extreme = long ? Math.min(...recent.map((b) => b.low), bar.low) : Math.max(...recent.map((b) => b.high), bar.high); }
  }
  if (!setup) return reject('No sweep or pullback setup');

  // Closed confirmation candle in the trade direction, beyond EMA9, not far from the reclaim.
  if (!((bar.close - bar.open) * sign > 0 && body >= 0.4 * range)) return reject('No confirmation candle');
  for (let k = 1; k < TUNING.confirmBars; k++) { const b = sig.last(k); if (!b || (b.close - b.open) * sign <= 0) return reject('No confirmation candle'); }
  if ((price - ema9) * sign < 0) return reject('Close not beyond EMA9');
  const anchor = swept?.price ?? ema21;
  if ((price - anchor) * sign > 1.0 * atr) return reject('Entry too far from reclaim; not chasing');

  // Protective stop beyond the sweep extreme with a volatility buffer, never on an obvious pool.
  let stop = extreme - sign * Math.max(TUNING.stopBufferAtr * atr, 2 * st.tickSize);
  const crowded = pools.find((l) => l.sweptAt === null && l.side === (long ? 'low' : 'high') && Math.abs(l.price - stop) < 0.2 * atr);
  if (crowded) stop = crowded.price - sign * 0.3 * atr;
  let risk = (price - stop) * sign;
  if (risk < TUNING.minRiskAtr * atr) { stop = price - sign * TUNING.minRiskAtr * atr; risk = TUNING.minRiskAtr * atr; }
  if (risk > TUNING.maxRiskAtr * atr || risk / price > 0.025) return reject('Stop would be too wide');
  if (cost / ((risk / price) * 100) > 0.25) return reject('Costs too large versus stop distance');

  // Room to the nearest opposing liquidity (resistance for LONG, support for SHORT).
  const opposing = pools.filter((l) => l.sweptAt === null && l.side === (long ? 'high' : 'low') && (l.price - price) * sign > 0.2 * atr)
    .map((l) => l.price).sort((a, b) => (a - b) * sign);
  let tp1 = price + sign * TUNING.tp1R * risk; let tp2 = price + sign * TUNING.tp2R * risk;
  const first = opposing[0]; const second = opposing[1] ?? first;
  if (first !== undefined && (first - sign * 0.1 * atr - tp1) * sign < 0) tp1 = first - sign * 0.1 * atr;
  if (second !== undefined && (second - sign * 0.1 * atr - tp2) * sign < 0) tp2 = second - sign * 0.1 * atr;
  if ((tp2 - tp1) * sign < 0) tp2 = tp1;
  const rr1 = ((tp1 - price) * sign) / risk;
  if (rr1 < TUNING.minRr1) return reject('Too close to opposing liquidity');
  if ((((tp1 - price) * sign) / price) * 100 < 3 * cost) return reject('Profit room too small for fees and slippage');
  if (pools.some((l) => l.sweptAt === null && l.side === (long ? 'low' : 'high') && (price - l.price) * sign > 0 && (price - l.price) * sign < 0.3 * atr))
    return reject('Unswept liquidity just behind entry (stop-hunt risk)');
  if (book.imbalance !== null && book.imbalance * sign < -0.6) return reject('Order book strongly against direction');

  // Weighted score 0..100. Not a win probability.
  const parts: ScoreParts = { trend: 0, structure: 0, liquidity: 0, confirmation: 0, volume: 0, momentum: 0, volatility: 0, spread: 0, room: 0 };
  parts.trend = (htf === sign ? 12 : 4) + (mid === sign ? 8 : 0);
  const lows = st.levels.filter((l) => l.tf >= 15 && l.side === 'low').slice(-2); const highs = st.levels.filter((l) => l.tf >= 15 && l.side === 'high').slice(-2);
  const rising = (xs: Level[]) => xs.length === 2 && (xs[1]!.price - xs[0]!.price) * sign > 0;
  parts.structure = (rising(lows) ? 5 : 0) + (rising(highs) ? 5 : 0);
  parts.liquidity = setup === 'SWEEP_RECLAIM' ? Math.min(20, 12 + (swept!.touches > 1 ? 4 : 0) + (swept!.tf >= 15 ? 4 : 0)) : 8;
  parts.confirmation = 3 + ((price - vwap) * sign > 0 ? 3 : 0) + (body >= 0.5 * range && (long ? bar.close - bar.low : bar.high - bar.close) >= 0.7 * range ? 4 : 0);
  const avgVol = sig.vol.value ?? 0; const peakVol = Math.max(bar.volume, sig.last(1)?.volume ?? 0);
  parts.volume = peakVol >= 1.5 * avgVol ? 10 : peakVol >= 1.1 * avgVol ? 5 : 0;
  const rsiOk = long ? rsi >= 45 && rsi <= 68 && rsi > (sig.prevRsi ?? rsi) : rsi <= 55 && rsi >= 32 && rsi < (sig.prevRsi ?? rsi);
  parts.momentum = (rsiOk ? 5 : 0) + ((hist - (sig.prevHist ?? hist)) * sign > 0 ? 5 : 0);
  parts.volatility = atrPct >= 0.15 && atrPct <= 1.2 ? 5 : 2;
  parts.spread = book.spreadBps === null ? 3 : (book.spreadBps <= s.max_spread_bps / 2 ? 3 : 1) + (book.imbalance === null || book.imbalance * sign >= -0.2 ? 2 : 0);
  parts.room = rr1 >= 1 ? 10 : rr1 >= 0.85 ? 6 : 3;
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  const liquidity = setup === 'SWEEP_RECLAIM'
    ? `${long ? 'Sell' : 'Buy'}-side sweep of ${swept!.tf}m ${swept!.touches > 1 ? 'equal ' + (long ? 'lows' : 'highs') : 'swing'} reclaimed`
    : 'Pullback to EMA21/VWAP reclaimed';
  const candidate: Candidate = { symbol: st.symbol, direction, time: now - 60_000, setup, score, parts, entry: price, stop, tp1, tp2,
    atr, atrPct, sweptLevel: swept?.price ?? null, liquidity };
  if (score < s.min_score) return reject(`Score ${score} below ${s.min_score}`, candidate);
  return { candidate, rejected: null, direction };
}
