import { type Candle, validateCandle } from './model';
import { pineGt as gt, pineLt as lt, pineGe as ge, pineLe as le } from './pine-numbers';

/** Exact default-input prompt-71 indicator port. No added entry filter. Not activated until durable integration is verified. */
export const CSTF_INTERVAL = 30 * 60_000;
export const CSTF_SYMBOLS = ['ZENUSDT', 'GALAUSDT', 'SUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT', 'NEARUSDT', 'BCHUSDT', 'LTCUSDT', 'ADAUSDT', 'AVAXUSDT', 'TRXUSDT', 'BNBUSDT', 'UNIUSDT', 'WLDUSDT', 'WIFUSDT', 'CRVUSDT', 'EGLDUSDT', 'FILUSDT', 'SANDUSDT', 'HBARUSDT'] as const;
export type CstfSymbol = typeof CSTF_SYMBOLS[number];
export interface CstfSignal { id: string; symbol: CstfSymbol; side: 'LONG' | 'SHORT'; pattern: string; signalTime: number; confirmTime: number; close: number; atr: number }
interface Row { candle: Candle; body: number; averageBody: number | null; fast: number | null; slow: number | null; up: number; down: number }
export interface CstfState { version: 1; count: number; lastTime: number | null; lastCross: number | null; seed: number[]; trSeed: number[]; atr: number | null; fast: number | null; slow: number | null; bodies: number[]; rows: Row[] }
export const initialCstf = (): CstfState => ({ version: 1, count: 0, lastTime: null, lastCross: null, seed: [], trSeed: [], atr: null, fast: null, slow: null, bodies: [], rows: [] });
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Only a complete closed 30m candle is accepted. Duplicate bars are inert; gaps require recovery. */
export function processCstf(state: CstfState, symbol: CstfSymbol, candle: Candle, closedThrough: number): CstfSignal[] {
  validateCandle(candle);
  if (candle.time % CSTF_INTERVAL !== 0 || candle.time + CSTF_INTERVAL > closedThrough) throw new Error('CSTF needs a confirmed 30-minute candle');
  if (state.lastTime !== null && candle.time <= state.lastTime) return [];
  if (state.lastTime !== null && candle.time !== state.lastTime + CSTF_INTERVAL) throw new Error('CSTF candle gap: recover before continuing');
  const previous = state.rows.at(-1);
  const tr = previous ? Math.max(candle.high - candle.low, Math.abs(candle.high - previous.candle.close), Math.abs(candle.low - previous.candle.close)) : candle.high - candle.low;
  state.count++;
  if (state.count <= 50) state.seed.push(candle.close);
  if (state.count <= 14) state.trSeed.push(tr);
  state.fast = state.count === 20 ? sum(state.seed.slice(0, 20)) / 20 : state.fast === null ? null : 2 / 21 * candle.close + 19 / 21 * state.fast;
  state.slow = state.count === 50 ? sum(state.seed) / 50 : state.slow === null ? null : 2 / 51 * candle.close + 49 / 51 * state.slow;
  state.atr = state.count === 14 ? sum(state.trSeed) / 14 : state.atr === null ? null : tr / 14 + 13 / 14 * state.atr;
  const body = Math.abs(candle.close - candle.open);
  state.bodies = [...state.bodies, body].slice(-14);
  const averageBody = state.bodies.length === 14 ? sum(state.bodies) / 14 : null;
  const F = state.fast; const S = state.slow;
  if (F !== null && S !== null && previous?.fast !== null && previous?.slow !== null && previous?.fast !== undefined && previous?.slow !== undefined && ((gt(F, S) && le(previous.fast, previous.slow)) || (lt(F, S) && ge(previous.fast, previous.slow)))) state.lastCross = state.count - 1;
  const up = F !== null && S !== null && previous?.fast != null && previous.slow !== null && gt(F, previous.fast) && gt(S, previous.slow) ? 1 : 0;
  const down = F !== null && S !== null && previous?.fast != null && previous.slow !== null && lt(F, previous.fast) && lt(S, previous.slow) ? 1 : 0;
  state.rows.push({ candle, body, averageBody, fast: F, slow: S, up, down });
  state.rows = state.rows.slice(-15); state.lastTime = candle.time;
  const r = state.rows; const a = state.atr; const p1 = r.at(-2); const p2 = r.at(-3); const p5 = r.at(-6); const p10 = r.at(-11);
  if (a === null || a <= 0 || F === null || S === null || averageBody === null || !p1 || !p2 || p5?.fast == null || p5.slow === null || p10?.fast == null || p10.slow === null || p1.fast === null || p1.slow === null) return [];
  const gap = Math.abs(F - S); const crossAge = state.lastCross === null ? null : state.count - 1 - state.lastCross;
  const fastSlope = (F - p5.fast) / 5; const slowSlope = (S - p5.slow) / 5;
  const noRecentCross = crossAge === null || crossAge > 5;
  const emaBull = gt(F, S) && gt(F, p1.fast) && gt(S, p1.slow) && ge(fastSlope, a * .05) && ge(slowSlope, a * .02) && ge(gap, a * .30) && noRecentCross;
  const emaBear = lt(F, S) && lt(F, p1.fast) && lt(S, p1.slow) && le(fastSlope, -a * .05) && le(slowSlope, -a * .02) && ge(gap, a * .30) && noRecentCross;
  const sf = (F - p10.fast) / 10 / a; const ss = (S - p10.slow) / 10 / a;
  const common = ge(gap, a * .60) && ge(gap, Math.abs(p5.fast - p5.slow) * .90) && ge(Math.abs(ss), Math.abs(sf) * .40) && le(Math.abs(ss), Math.abs(sf) * 2.50) && (crossAge === null || crossAge >= 20) && ge(Math.atan(Math.abs(sf)) * 180 / Math.PI, 5);
  const strongBull = gt(F, S) && ge(sf, .10) && ge(ss, .05) && ge(sum(r.slice(-10).map(x => x.up)), 9) && common;
  const strongBear = lt(F, S) && le(sf, -.10) && le(ss, -.05) && ge(sum(r.slice(-10).map(x => x.down)), 9) && common;
  const trend = gt(F, S) && gt(candle.close, S) && gt(gap, a * .15) ? 1 : lt(F, S) && lt(candle.close, S) && gt(gap, a * .15) ? -1 : 0;
  const bull = (x: Row) => gt(x.candle.close, x.candle.open); const bear = (x: Row) => lt(x.candle.close, x.candle.open);
  const longBody = (x: Row) => x.averageBody !== null && ge(x.body, x.averageBody * .8); const smallBody = (x: Row) => x.averageBody !== null && le(x.body, x.averageBody * .6);
  const { open: o, close: c, high: h, low: l } = candle; const { open: o1, close: c1 } = p1.candle; const { open: o2, close: c2 } = p2.candle;
  const current = r.at(-1); if (!current) return [];
  const tol = a * .1; const sizeOK = ge(h - l, a * .5); const mid1 = (o1 + c1) / 2; const mid2 = (o2 + c2) / 2; const upW = h - Math.max(o, c); const loW = Math.min(o, c) - l;
  const longs: string[] = []; const shorts: string[] = [];
  if (sizeOK && gt(body, 0) && le(body, (h-l)*.35) && ge(loW, 2*body) && le(upW, (h-l)*.2)) longs.push('Hammer');
  if (sizeOK && bear(p1) && bull(current) && le(o, c1) && ge(c, o1) && gt(body, p1.body)) longs.push('Bullish Engulfing');
  if (bear(p2) && longBody(p2) && smallBody(p1) && le(Math.max(o1,c1), o2-p2.body*.4) && bull(current) && ge(body, averageBody*.7) && gt(c,mid2)) longs.push('Morning Star');
  if (bear(p1) && longBody(p1) && bull(current) && lt(o,c1) && gt(c,mid1) && lt(c,o1) && sizeOK) longs.push('Piercing Line');
  if (sizeOK && gt(body,0) && le(body,(h-l)*.35) && ge(upW,2*body) && le(loW,(h-l)*.2)) shorts.push('Shooting Star');
  if (sizeOK && bull(p1) && bear(current) && ge(o,c1) && le(c,o1) && gt(body,p1.body)) shorts.push('Bearish Engulfing');
  if (bull(p2) && longBody(p2) && smallBody(p1) && ge(Math.min(o1,c1),o2+p2.body*.4) && bear(current) && ge(body,averageBody*.7) && lt(c,mid2)) shorts.push('Evening Star');
  if (bull(p1) && longBody(p1) && bear(current) && ge(o,c1-tol) && lt(c,mid1) && gt(c,o1) && sizeOK) shorts.push('Dark Cloud Cover');
  if (bull(current) && bull(p1) && bull(p2) && ge(body,averageBody*.6) && ge(p1.body,averageBody*.6) && ge(p2.body,averageBody*.6) && gt(c,c1) && gt(c1,c2) && gt(o,o1) && gt(o1,o2) && le(o,c1+tol) && le(o1,c2+tol)) longs.push('Three White Soldiers');
  if (bear(current) && bear(p1) && bear(p2) && ge(body,averageBody*.6) && ge(p1.body,averageBody*.6) && ge(p2.body,averageBody*.6) && lt(c,c1) && lt(c1,c2) && lt(o,o1) && lt(o1,o2) && ge(o,c1-tol) && ge(o1,c2-tol)) shorts.push('Three Black Crows');
  const side = trend === 1 && emaBull && strongBull && longs.length ? 'LONG' : trend === -1 && emaBear && strongBear && shorts.length ? 'SHORT' : null;
  if (!side) return [];
  return [{ id: `CSTF30-${symbol}-${side}-${candle.time}`, symbol, side, pattern: (side === 'LONG' ? longs : shorts).join(', '), signalTime: candle.time, confirmTime: candle.time+CSTF_INTERVAL, close: c, atr: a }];
}