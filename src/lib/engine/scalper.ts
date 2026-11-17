import { INDICATORS, type Direction } from "../config";
import { ema, rma, relativeStrength, trueRange, confirmedPivot } from "./calculations";
import { pineGt as gt, pineLt as lt, pineGe as ge, pineLe as le } from './pine-numbers';
import { snapshot, updateMtf, type MtfSnapshot } from "./mtf-trend";
import { MINUTE, PARAMETERS as P, validateCandle, type EngineState, type Candle, type Trade, type Signal, type SideState, type Analysis } from "./model";

export function calculate(state: EngineState, c: Candle): Analysis {
  const previous = state.candles.at(-1);
  const previousRsi = state.rsi;
  state.ema9 = ema(state.ema9, c.close, 9);
  state.ema21 = ema(state.ema21, c.close, 21);
  state.ema200 = ema(state.ema200, c.close, 200);
  state.fast = ema(state.fast, c.close, P.macdFast);
  state.slow = ema(state.slow, c.close, P.macdSlow);
  const macd = state.fast - state.slow;
  state.macdSignal = ema(state.macdSignal, macd, P.macdSignal);
  const histogram = macd - state.macdSignal;
  const atr = rma(state.atr, trueRange(c, previous), P.atrLength);
  if (previous) {
    const change = c.close - previous.close;
    state.rsi = relativeStrength(rma(state.gain, Math.max(change, 0), P.rsiLength), rma(state.loss, Math.max(-change, 0), P.rsiLength));
  }
  const prior = state.candles.slice(-P.structureLength);
  const resistance = prior.length ? Math.max(...prior.map((x) => x.high)) : null;
  const support = prior.length ? Math.min(...prior.map((x) => x.low)) : null;
  state.candles.push(c);
  state.candles = state.candles.slice(-Math.max(P.swingLookback, P.volumeLength));
  state.swingLow = confirmedPivot(state.candles, "low") ?? state.swingLow;
  state.swingHigh = confirmedPivot(state.candles, "high") ?? state.swingHigh;
  const volumeSMA = state.candles.length >= P.volumeLength
    ? state.candles.slice(-P.volumeLength).reduce((a, x) => a + x.volume, 0) / P.volumeLength : null;
  const bullish = gt(c.close, state.ema200) && gt(state.ema9, state.ema21);
  const bearish = lt(c.close, state.ema200) && lt(state.ema9, state.ema21);
  const volume = volumeSMA !== null && gt(c.volume, volumeSMA * P.volumeMultiplier);
  const rsi = state.rsi;
  const longScore = (bullish ? 20 : 0) + (gt(c.close, state.ema21) && gt(state.ema9, state.ema21) ? 10 : 0)
    + (rsi !== null && previousRsi !== null && gt(rsi, 52) && gt(rsi, previousRsi) ? 15 : 0)
    + (gt(histogram, 0) ? 15 : 0) + (volume ? 10 : 0)
    + (previous && gt(c.close, c.open) && gt(c.close, previous.high) ? 15 : 0)
    + (resistance !== null && gt(c.close, resistance) ? 15 : 0);
  const shortScore = (bearish ? 20 : 0) + (lt(c.close, state.ema21) && lt(state.ema9, state.ema21) ? 10 : 0)
    + (rsi !== null && previousRsi !== null && lt(rsi, 48) && lt(rsi, previousRsi) ? 15 : 0)
    + (lt(histogram, 0) ? 15 : 0) + (volume ? 10 : 0)
    + (previous && lt(c.close, c.open) && lt(c.close, previous.low) ? 15 : 0)
    + (support !== null && lt(c.close, support) ? 15 : 0);
  const swingWindow = state.candles.slice(-P.swingLookback);
  const fallbackLow = Math.min(...swingWindow.map((x) => x.low));
  const fallbackHigh = Math.max(...swingWindow.map((x) => x.high));
  const low = state.swingLow !== null && lt(state.swingLow, c.close) ? state.swingLow : fallbackLow;
  const high = state.swingHigh !== null && gt(state.swingHigh, c.close) ? state.swingHigh : fallbackHigh;
  const longStop = atr === null || low === null ? null : Math.min(c.close - atr * P.atrStopMult, low - atr * P.swingBuffer);
  const shortStop = atr === null || high === null ? null : Math.max(c.close + atr * P.atrStopMult, high + atr * P.swingBuffer);
  const valid = (risk: number) => atr !== null && ge(risk, atr * P.minStopATR) && le(risk, atr * P.maxStopATR) && gt(risk, state.tickSize);
  const volatility = atr !== null && ge(atr / c.close * 100, P.minAtrPercent) && le(atr / c.close * 100, P.maxAtrPercent);
  const history = atr !== null && volumeSMA !== null && resistance !== null && support !== null;
  return { ema9: state.ema9, ema21: state.ema21, ema200: state.ema200, rsi, atr, macd, histogram, volumeSMA,
    trend: bullish ? "BULLISH" : bearish ? "BEARISH" : "SIDEWAYS", longScore, shortScore, longStop, shortStop,
    longSetup: history && bullish && rsi !== null && gt(rsi, 50) && gt(histogram, 0) && volatility && longScore >= P.scoreThreshold && longStop !== null && valid(c.close - longStop),
    shortSetup: history && bearish && rsi !== null && lt(rsi, 50) && lt(histogram, 0) && volatility && shortScore >= P.scoreThreshold && shortStop !== null && valid(shortStop - c.close) };
}

function signal(state: EngineState, trade: Trade, event: Signal["event"], time: number, exit?: number, net?: number): Signal {
  return { event_id: `${trade.id}-${event}`, trade_id: trade.id, symbol: state.symbol, direction: trade.direction,
    indicator: INDICATORS[trade.direction], timeframe: "1", event, entry_price: trade.entry,
    stop_loss: trade.stop, take_profit: trade.target, fee_rate_percent: P.feePercent,
    timestamp: new Date(time + MINUTE).toISOString(), ...(exit === undefined ? {} : { exit_price: exit }),
    ...(net === undefined ? {} : { net_result_r: net }) };
}
export function manageTrade(state: EngineState, side: SideState, c: Candle, trend: MtfSnapshot | null = null): Signal | null {
  const t = side.trade;
  if (!t || c.time <= t.entryTime) return null;
  const long = t.direction === "LONG";
  const stop = long ? le(c.low, t.stop) : ge(c.high, t.stop);
  const target = long ? ge(c.high, t.target) : le(c.low, t.target);
  if (stop || target) {
    const exit = stop ? t.stop : t.target;
    const gross = (long ? exit - t.entry : t.entry - exit) / t.risk;
    const cost = ((t.entry + exit) * P.feePercent / 100 + 2 * P.slippageTicks * state.tickSize) / t.risk;
    const net = gross - cost;
    const perf = side.performance;
    perf.total += 1;
    if (gt(net, 0)) { perf.wins += 1; perf.positiveNetR += net; }
    else { perf.losses += 1; perf.negativeNetR += Math.abs(net); }
    if (gt(gross, 0)) perf.grossProfitR += gross; else perf.grossLossR += Math.abs(gross);
    perf.netR += net; perf.peakR = Math.max(perf.peakR, perf.netR);
    perf.maxDrawdownR = Math.max(perf.maxDrawdownR, perf.peakR - perf.netR);
    side.lastExitTime = c.time; side.trade = null;
    return signal(state, t, stop ? "stop_loss_hit" : "take_profit_hit", c.time, exit, net);
  }
  const trigger = long ? t.entry + t.risk * P.breakevenTrigger : t.entry - t.risk * P.breakevenTrigger;
  if (P.enableBreakeven && !t.breakeven && (long ? ge(c.high, trigger) : le(c.low, trigger))) {
    t.breakeven = true; t.breakevenTime = c.time; t.stop = long ? Math.max(t.stop, t.entry) : Math.min(t.stop, t.entry);
    const be = signal(state, t, "breakeven_activated", c.time);
    // Trend Identify reading (previous closed 15M/5M/1M bars) for the Simulator only; never gates Pine.
    return trend ? { ...be, mtf_trend: trend } : be;
  }
  return null;
}
export function cooldownFinished(lastExitTime: number | null, now: number): boolean {
  return lastExitTime === null || (now - lastExitTime) / MINUTE > P.cooldownBars;
}

/** Mutates a tentative checkpoint. Persist it atomically with returned events before accepting it. */
export function processCandle(state: EngineState, c: Candle, allowEntries = true): { signals: Signal[]; analysis: Analysis | null; duplicate: boolean } {
  validateCandle(c);
  if (state.lastTime !== null && c.time <= state.lastTime) return { signals: [], analysis: null, duplicate: true };
  if (state.lastTime !== null && c.time !== state.lastTime + MINUTE) throw new Error("Missing candles: recovery required before processing");
  // Previous completed 15M/5M/1M bars, as read by request.security(f_trend()[1]) on this 1M bar.
  const trend = state.mtf ? snapshot(state.mtf) : null;
  const analysis = calculate(state, c);
  const signals: Signal[] = [];
  for (const direction of ["LONG", "SHORT"] as Direction[]) {
    const side = direction === "LONG" ? state.long : state.short;
    const managed = manageTrade(state, side, c, trend);
    if (managed) signals.push(managed);
    const stop = direction === "LONG" ? analysis.longStop : analysis.shortStop;
    const setup = direction === "LONG" ? analysis.longSetup : analysis.shortSetup;
    // Only the original Pine conditions apply; saved legacy MTF state never gates entries.
    if (allowEntries && !side.trade && cooldownFinished(side.lastExitTime, c.time) && setup && stop !== null) {
      const risk = Math.abs(c.close - stop);
      const trade: Trade = { id: `native-${state.symbol}-${direction}-${c.time}`, direction, entry: c.close,
        stop, originalStop: stop, target: c.close + (direction === "LONG" ? 1 : -1) * risk * P.rrMultiplier,
        risk, entryTime: c.time, breakeven: false, breakevenTime: null };
      side.trade = trade;
      signals.push(signal(state, trade, "entry_confirmed", c.time));
    }
  }
  if (state.mtf) updateMtf(state.mtf, c);
  state.lastTime = c.time; state.count += 1;
  return { signals, analysis, duplicate: false };
}