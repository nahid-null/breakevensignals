import type { RobotSettings } from './config';
import type { Level, SymbolState } from './series';

export type Direction = 'LONG' | 'SHORT';
export type Setup = 'SWEEP_RECLAIM' | 'PULLBACK_RECLAIM';
export type ScoreParts = { trend: number; structure: number; liquidity: number; confirmation: number; volume: number;
  momentum: number; volatility: number; spread: number; room: number };
export type Candidate = {
  symbol: string; direction: Direction; time: number; setup: Setup; score: number; parts: ScoreParts;
  entry: number; stop: number; tp1: number; tp2: number; atr: number; atrPct: number;
  sweptLevel: number | null; liquidity: string; reasons: string[];
};
export type Evaluation = { candidate: Candidate | null; rejected: string | null; direction: Direction };
/** Book data is only available live. Backtests pass null and get neutral points; never fabricated. */
export type BookContext = { spreadBps: number | null; imbalance: number | null; depthUsd: number | null };

const SWEEP_LOOKBACK_MIN = 5;
const roundTripCostPct = (s: RobotSettings) => 2 * (s.fee_pct + s.slippage_bps / 100);

/** Multi-confirmation evaluation for one direction at the close of the latest 1m bar. */
export function evaluate(st: SymbolState, direction: Direction, s: RobotSettings, book: BookContext): Evaluation {
  const reject = (why: string): Evaluation => ({ candidate: null, rejected: why, direction });
  if (!st.ready()) return reject('Warming up');
  const long = direction === 'LONG'; const sign = long ? 1 : -1;
  const m1 = st.m1; const bar = m1.last()!;
  const atr = m1.atr.value!; const price = bar.close; const atrPct = (atr / price) * 100;
  const ema9 = m1.ema9.value!; const ema21 = m1.ema21.value!; const vwap = m1.vwap.value!;
  const rsi = m1.rsi.value ?? 50; const hist = m1.macd.hist ?? 0;

  // Hard filters first: abnormal conditions, liquidity and volatility.
  if (atrPct > 1.2) return reject('Extreme volatility');
  if (atrPct < 0.03) return reject('Market too quiet to cover costs');
  if (st.quoteVolume24h < s.min_quote_volume_musd * 1e6) return reject('Low 24h liquidity');
  if (book.spreadBps !== null && book.spreadBps > s.max_spread_bps) return reject('Spread too wide');
  if (book.depthUsd !== null && book.depthUsd < 25_000) return reject('Thin order book');
  const range = bar.high - bar.low; const body = Math.abs(bar.close - bar.open);
  if (range > 3 * atr) return reject('Abnormal candle range');
  if (body > 1.8 * atr) return reject('Extended candle; not chasing');
  const wickAgainst = long ? bar.high - Math.max(bar.open, bar.close) : Math.min(bar.open, bar.close) - bar.low;
  if (wickAgainst > 2.5 * atr) return reject('Abnormal wick');
  if (m1.vol.value && bar.volume > 6 * m1.vol.value && body > 1.2 * atr) return reject('Volume spike with extended move');

  const t15 = st.m15.trend(true); const t5 = st.m5.trend(false);
  if (t15 === -sign) return reject('Against 15m trend');
  if (t5 === -sign) return reject('Against 5m trend');
  if (long ? rsi > 72 : rsi < 28) return reject('Momentum overextended');

  // Setup: liquidity sweep + reclaim, else pullback into EMA21/VWAP + reclaim.
  let setup: Setup | null = null; let swept: Level | null = null; let sweepExtreme = 0;
  for (const l of st.levels) {
    if (l.side !== (long ? 'low' : 'high') || l.sweptAt === null || l.sweepExtreme === null) continue;
    if (bar.time - l.sweptAt > SWEEP_LOOKBACK_MIN * 60_000 || l.sweptAt === bar.time) continue;
    const depth = (l.price - l.sweepExtreme) * sign;
    if (depth < 0.05 * atr || depth > 1.5 * atr) continue;
    const reclaimed = (bar.close - l.price) * sign > 0;
    if (!reclaimed) continue;
    if (!swept || l.touches > swept.touches || l.tf > swept.tf) { swept = l; sweepExtreme = l.sweepExtreme; }
  }
  if (swept) setup = 'SWEEP_RECLAIM';
  const recent = m1.bars.slice(-6, -1);
  if (!setup && t15 === sign) {
    const zone = long ? Math.max(ema21, vwap) : Math.min(ema21, vwap);
    const touched = recent.some((b) => long ? b.low <= zone + 0.1 * atr : b.high >= zone - 0.1 * atr);
    const held = recent.every((b) => long ? b.close > zone - 0.5 * atr : b.close < zone + 0.5 * atr);
    if (touched && held) { setup = 'PULLBACK_RECLAIM'; sweepExtreme = long ? Math.min(...recent.map((b) => b.low)) : Math.max(...recent.map((b) => b.high)); }
  }
  if (!setup) return reject('No sweep or pullback setup');

  // Confirmation candle (closed): direction, close beyond EMA9, not far from the reclaimed zone.
  const bodyOk = (bar.close - bar.open) * sign > 0 && body >= 0.4 * range;
  if (!bodyOk) return reject('No confirmation candle');
  if ((price - ema9) * sign < 0) return reject('Close not beyond EMA9');
  const anchor = swept?.price ?? ema21;
  if ((price - anchor) * sign > 0.9 * atr) return reject('Entry too far from reclaim; not chasing');

  // Protective stop beyond the sweep extreme, never exactly on an obvious level.
  const buffer = Math.max(0.3 * atr, 2 * st.tickSize);
  let stop = sweepExtreme - sign * buffer;
  const crowded = st.levels.find((l) => l.sweptAt === null && l.side === (long ? 'low' : 'high') && Math.abs(l.price - stop) < 0.2 * atr);
  if (crowded) stop = crowded.price - sign * 0.3 * atr;
  let risk = (price - stop) * sign;
  if (risk < 0.5 * atr) { stop = price - sign * 0.5 * atr; risk = 0.5 * atr; }
  if (risk > 2.5 * atr || risk / price > 0.015) return reject('Stop would be too wide');

  // Room to the nearest opposing liquidity (resistance for LONG, support for SHORT).
  const opposing = st.levels.filter((l) => l.sweptAt === null && l.side === (long ? 'high' : 'low') && (l.price - price) * sign > 0.2 * atr)
    .map((l) => l.price).sort((a, b) => (a - b) * sign);
  const first = opposing[0]; const second = opposing[1];
  let tp1 = price + sign * risk; let tp2 = price + sign * 2 * risk;
  if (first !== undefined && (first - sign * 0.1 * atr - tp1) * sign < 0) tp1 = first - sign * 0.1 * atr;
  if (second !== undefined && (second - sign * 0.1 * atr - tp2) * sign < 0) tp2 = second - sign * 0.1 * atr;
  if ((tp2 - tp1) * sign < 0) tp2 = tp1;
  const rr1 = ((tp1 - price) * sign) / risk;
  if (rr1 < 0.6) return reject('Too close to opposing liquidity');
  const grossPct = (((tp1 - price) * sign) / price) * 100;
  if (grossPct < 2 * roundTripCostPct(s)) return reject('Profit room too small for fees and slippage');
  const nearbyTrap = st.levels.some((l) => l.sweptAt === null && l.side === (long ? 'low' : 'high') && (price - l.price) * sign > 0 && (price - l.price) * sign < 0.3 * atr);
  if (nearbyTrap) return reject('Unswept liquidity just behind entry (stop-hunt risk)');
  if (book.imbalance !== null && book.imbalance * sign < -0.6) return reject('Order book strongly against direction');

  // Weighted score 0..100. Not a win probability.
  const parts: ScoreParts = { trend: 0, structure: 0, liquidity: 0, confirmation: 0, volume: 0, momentum: 0, volatility: 0, spread: 0, room: 0 };
  parts.trend = (t15 === sign ? 12 : 4) + (t5 === sign ? 8 : 0);
  const lows = st.levels.filter((l) => l.tf >= 5 && l.side === 'low').slice(-2); const highs = st.levels.filter((l) => l.tf >= 5 && l.side === 'high').slice(-2);
  const rising = (xs: Level[]) => xs.length === 2 && (xs[1]!.price - xs[0]!.price) * sign > 0;
  parts.structure = (rising(lows) ? 5 : 0) + (rising(highs) ? 5 : 0);
  parts.liquidity = setup === 'SWEEP_RECLAIM' ? Math.min(20, 12 + (swept!.touches > 1 ? 4 : 0) + (swept!.tf >= 5 ? 4 : 0)) : 8;
  parts.confirmation = 3 + ((price - vwap) * sign > 0 ? 3 : 0) + (body >= 0.5 * range && (long ? bar.close - bar.low : bar.high - bar.close) >= 0.7 * range ? 4 : 0);
  const avgVol = m1.vol.value ?? 0; const peakVol = Math.max(bar.volume, swept?.sweepBar?.volume ?? 0);
  parts.volume = peakVol >= 1.5 * avgVol ? 10 : peakVol >= 1.1 * avgVol ? 5 : 0;
  const rsiOk = long ? rsi >= 45 && rsi <= 70 && rsi > (m1.prevRsi ?? rsi) : rsi <= 55 && rsi >= 30 && rsi < (m1.prevRsi ?? rsi);
  const macdOk = (hist - (m1.prevHist ?? hist)) * sign > 0;
  parts.momentum = (rsiOk ? 5 : 0) + (macdOk ? 5 : 0);
  parts.volatility = atrPct >= 0.05 && atrPct <= 0.6 ? 5 : 2;
  parts.spread = book.spreadBps === null ? 3 : (book.spreadBps <= s.max_spread_bps / 2 ? 3 : 1) + (book.imbalance === null || book.imbalance * sign >= -0.2 ? 2 : 0);
  parts.room = rr1 >= 1 ? 10 : rr1 >= 0.8 ? 6 : 3;
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  const liquidity = setup === 'SWEEP_RECLAIM'
    ? `${long ? 'Sell' : 'Buy'}-side sweep of ${swept!.tf}m ${swept!.touches > 1 ? 'equal ' + (long ? 'lows' : 'highs') : 'swing'} reclaimed`
    : `Pullback to EMA21/VWAP reclaimed`;
  const candidate: Candidate = { symbol: st.symbol, direction, time: bar.time, setup, score, parts, entry: price, stop, tp1, tp2,
    atr, atrPct, sweptLevel: swept?.price ?? null, liquidity, reasons: [] };
  if (score < s.min_score) return { candidate, rejected: `Score ${score} below ${s.min_score}`, direction };
  return { candidate, rejected: null, direction };
}
