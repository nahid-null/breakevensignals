import { INDICATORS } from '../config';
import { processCandle } from './scalper';
import { snapshot } from './mtf-trend';
import { initialObStrong as initialObvp, processObStrong as processObvp, toSimulatorEntry, type SimulatorEntry } from './ob-strong';
import { FIVE_MINUTES, MINUTE, PARAMETERS, initialState, type Candle, type EngineState, type Signal, type Analysis } from './model';

/**
 * Original LONG/SHORT Pine scripts on the 5-minute chart. The feed stays one-minute (Trend Identify,
 * prices, health); each completed 5-minute bucket of closed 1-minute candles becomes one 5-minute bar
 * for the unchanged Pine engine. The one-minute Pine engine only finishes trades it already holds.
 */
export const bucketStart = (time: number) => time - (time % FIVE_MINUTES);

export function aggregateFive(bars: Candle[]): Candle {
  const first = bars[0]; const last = bars.at(-1);
  if (!first || !last || bars.length !== 5) throw new Error('A 5-minute bar needs five 1-minute candles');
  return { time: first.time, open: first.open, close: last.close, high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)), volume: bars.reduce((a, b) => a + b.volume, 0) };
}

export function fiveEngine(symbol: EngineState['symbol'], tickSize: number): EngineState {
  return { ...initialState(symbol, tickSize), interval: FIVE_MINUTES };
}

/** Historical entries/breakevens for Pine trades still open after warm-up, stored as historical only. */
export function adoptionSignals(engine: EngineState): Signal[] {
  const out: Signal[] = []; const bar = engine.interval ?? MINUTE;
  for (const t of [engine.long.trade, engine.short.trade]) {
    if (!t) continue;
    const entry: Signal = { event_id: `${t.id}-entry_confirmed`, trade_id: t.id, event: 'entry_confirmed', symbol: engine.symbol,
      direction: t.direction, indicator: INDICATORS[t.direction], timeframe: String(bar / MINUTE), entry_price: t.entry,
      stop_loss: t.originalStop, take_profit: t.target, fee_rate_percent: PARAMETERS.feePercent,
      timestamp: new Date(t.entryTime + bar).toISOString(), adopted: true };
    out.push(entry);
    if (t.breakeven) out.push({ ...entry, event_id: `${t.id}-breakeven_activated`, event: 'breakeven_activated', stop_loss: t.stop,
      timestamp: new Date((t.breakevenTime ?? t.entryTime) + bar).toISOString() });
  }
  return out;
}

/**
 * Warm the 5-minute Pine engine from closed 5-minute bars ending at the bucket that contains lastTime,
 * then hold the partial bucket's 1-minute candles. Returns the state plus adoption events.
 */
export function buildFive(symbol: EngineState['symbol'], tickSize: number, lastTime: number, fives: Candle[], partial: Candle[], spotFives: Candle[] = []) {
  const start = bucketStart(lastTime);
  const complete = lastTime + MINUTE === start + FIVE_MINUTES;
  const until = complete ? start : start - FIVE_MINUTES; // open time of the last 5-minute bar to replay
  const bars = fives.filter((c) => c.time <= until);
  if (bars.length < 200) throw new Error(`${symbol}: insufficient 5-minute history`);
  if (bars.at(-1)?.time !== until) throw new Error(`${symbol}: 5-minute history does not reach the saved candle`);
  const engine = fiveEngine(symbol, tickSize);
  for (const c of bars) processCandle(engine, c);
  // prompt-52: warm the OB + Weighted VP entry indicator on Binance SPOT 5-minute bars (the user's TradingView chart);
  // warm-up signals are never traded. Any spot bar not yet published is caught up by advanceObvp on the next 5-minute close.
  const obvp = initialObvp();
  for (const c of spotFives.filter((x) => x.time <= until).sort((a, b) => a.time - b.time)) processObvp(obvp, c);
  const bucket = complete ? [] : partial.filter((c) => c.time >= start && c.time <= lastTime);
  if (!complete && (bucket.length !== (lastTime - start) / MINUTE + 1 || bucket.some((c, i) => c.time !== start + i * MINUTE)))
    throw new Error(`${symbol}: incomplete 1-minute candles for the current 5-minute bar`);
  return { five: { engine, bucket }, obvp, adopted: adoptionSignals(engine) };
}

/** Process one closed 1-minute candle: Trend Identify + display + legacy 1m exits, then 5m Pine on bucket close. */
export function processMinute(state: EngineState, c: Candle): { signals: Signal[]; analysis: Analysis | null; duplicate: boolean; fiveClosed: number | null } {
  // Pine signals (1m and 5m) are still recorded for history; Simulator entries come only from advanceObvp (spot 5m bars).
  const trend = state.mtf ? snapshot(state.mtf) : null;
  const result = { ...processCandle(state, c, true), fiveClosed: null as number | null };
  if (result.duplicate || !state.five) return result;
  const f = state.five; const start = bucketStart(c.time);
  f.bucket = [...f.bucket.filter((x) => bucketStart(x.time) === start), c];
  if (c.time + MINUTE === start + FIVE_MINUTES) {
    if (f.bucket.length !== 5 || f.bucket.some((x, i) => x.time !== start + i * MINUTE)) throw new Error('Incomplete 5-minute bar; recovery required');
    const bar = aggregateFive(f.bucket);
    const five = processCandle(f.engine, bar, true, trend);
    result.signals.push(...five.signals);
    // prompt-52: the futures 5-minute bar closed; the caller now feeds the matching SPOT bar to advanceObvp.
    result.fiveClosed = start;
    f.bucket = [];
  }
  return result;
}

/**
 * prompt-52: the only Simulator entry source. Feeds closed Binance SPOT 5-minute bars (the user's TradingView chart) newer than the
 * indicator's last bar, up to `bucket`, into the OB STRONG port (prompt-63; was OB + Weighted VP). Only the bar opening at `bucket` may produce entries,
 * so bars caught up after a missed fetch are never traded late. `reached` is false while the spot bar is not yet published.
 */
export function advanceObvp(state: EngineState, spot: Candle[], bucket: number): { entries: SimulatorEntry[]; reached: boolean } {
  const o = state.obvp; if (!o) return { entries: [], reached: false };
  const entries: SimulatorEntry[] = [];
  for (const c of spot.filter((x) => x.time > (o.bars.at(-1)?.time ?? -Infinity) && x.time <= bucket).sort((a, b) => a.time - b.time)) {
    const signals = processObvp(o, c);
    if (c.time === bucket) entries.push(...signals.map((x) => toSimulatorEntry(state.symbol, x)));
  }
  return { entries, reached: (o.bars.at(-1)?.time ?? -Infinity) >= bucket };
}
