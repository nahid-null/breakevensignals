/**
 * Runs the existing native Pine port (src/lib/engine/scalper.ts, the same code the live worker runs)
 * bar by bar over chart candles and records every per-bar value. No formulas are re-implemented here.
 *
 * Other timeframes: the original scripts were written for and verified on 1-minute candles. Applied to a
 * 3M/5M/15M/1H/4H chart, Pine evaluates the same script on that chart's bars, with bar-count cooldowns.
 * The engine counts its 5-bar cooldown in minutes, so bars are re-indexed to consecutive minutes before
 * processing and mapped back afterwards; this reproduces Pine's bar_index semantics exactly.
 * The live trend filter (15M/5M/1M) is NOT part of the original indicator and is not applied here.
 */
import { initialState, MINUTE, PARAMETERS as P, type Candle } from '@/lib/engine/model';
import { processCandle } from '@/lib/engine/scalper';
import { pineGe, pineGt, pineLe, pineLt } from '@/lib/engine/pine-numbers';
import type { Direction } from '@/lib/config';

export type PineChecks = { trend: boolean; rsi: boolean; macd: boolean; volatility: boolean; score: boolean; stop: boolean; history: boolean };
export type PineSide = {
  score: number; setup: boolean; calcStop: number | null; swing: number | null; checks: PineChecks;
  entry: boolean; stopHit: boolean; targetHit: boolean; breakeven: boolean;
  active: boolean; beActive: boolean; tradeEntry: number | null; tradeStop: number | null; tradeTarget: number | null; beTrigger: number | null;
};
export type PineBar = {
  time: number; close: number; ema9: number; ema21: number; ema200: number; rsi: number | null; atr: number | null;
  macd: number; macdSignal: number; histogram: number; volumeSMA: number | null; trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  long: PineSide; short: PineSide;
};
export type PineTrade = {
  id: string; direction: Direction; entryTime: number; entry: number; originalStop: number; target: number; risk: number;
  /** Pine: tradeEntry ± tradeRisk × breakevenTrigger (1.0R by default). */
  beTrigger: number; beActivatedAt: number | null; beStop: number | null;
  exitTime: number | null; exitPrice: number | null; exit: 'STOP_LOSS' | 'BREAKEVEN_EXIT' | 'TAKE_PROFIT' | null; netR: number | null;
};
export type PineRun = { bars: PineBar[]; trades: PineTrade[]; tickSize: number };

const BASE = 1_000 * MINUTE;

export function runPineSeries(candles: Candle[], tickSize: number): PineRun {
  const state = initialState('NEARUSDT', tickSize);
  const bars: PineBar[] = []; const trades = new Map<string, PineTrade>(); const order: PineTrade[] = [];
  candles.forEach((c, i) => {
    const { analysis: a, signals } = processCandle(state, { ...c, time: BASE + i * MINUTE });
    if (!a) throw new Error('Duplicate candle');
    for (const s of signals) {
      if (s.event === 'entry_confirmed') {
        const side = s.direction === 'LONG' ? state.long : state.short; const t = side.trade!;
        const tr: PineTrade = { id: `${s.direction}-${c.time}`, direction: s.direction, entryTime: c.time, entry: t.entry, originalStop: t.originalStop,
          target: t.target, risk: t.risk, beTrigger: t.entry + (s.direction === 'LONG' ? 1 : -1) * t.risk * P.breakevenTrigger,
          beActivatedAt: null, beStop: null, exitTime: null, exitPrice: null, exit: null, netR: null };
        trades.set(s.trade_id, tr); order.push(tr);
      } else {
        const tr = trades.get(s.trade_id); if (!tr) continue;
        if (s.event === 'breakeven_activated') { tr.beActivatedAt = c.time; tr.beStop = s.stop_loss; }
        else { tr.exitTime = c.time; tr.exitPrice = s.exit_price ?? null; tr.netR = s.net_result_r ?? null;
          tr.exit = s.event === 'take_profit_hit' ? 'TAKE_PROFIT' : tr.beActivatedAt !== null ? 'BREAKEVEN_EXIT' : 'STOP_LOSS'; }
      }
    }
    const atrPct = a.atr === null ? null : a.atr / c.close * 100;
    const volatility = atrPct !== null && pineGe(atrPct, P.minAtrPercent) && pineLe(atrPct, P.maxAtrPercent);
    const history = a.atr !== null && a.volumeSMA !== null && i >= P.structureLength;
    const side = (d: Direction): PineSide => {
      const L = d === 'LONG'; const st = L ? state.long : state.short; const t = st.trade;
      const ev = signals.filter((s) => s.direction === d);
      const stop = L ? a.longStop : a.shortStop; const risk = stop === null ? null : Math.abs(c.close - stop);
      return {
        score: L ? a.longScore : a.shortScore, setup: L ? a.longSetup : a.shortSetup, calcStop: stop, swing: L ? state.swingLow : state.swingHigh,
        checks: {
          trend: a.trend === (L ? 'BULLISH' : 'BEARISH'),
          rsi: a.rsi !== null && (L ? pineGt(a.rsi, 50) : pineLt(a.rsi, 50)),
          macd: L ? pineGt(a.histogram, 0) : pineLt(a.histogram, 0), volatility,
          score: (L ? a.longScore : a.shortScore) >= P.scoreThreshold,
          stop: a.atr !== null && risk !== null && pineGe(risk, a.atr * P.minStopATR) && pineLe(risk, a.atr * P.maxStopATR) && pineGt(risk, tickSize),
          history,
        },
        entry: ev.some((e) => e.event === 'entry_confirmed'), stopHit: ev.some((e) => e.event === 'stop_loss_hit'),
        targetHit: ev.some((e) => e.event === 'take_profit_hit'), breakeven: ev.some((e) => e.event === 'breakeven_activated'),
        active: t !== null, beActive: t?.breakeven ?? false, tradeEntry: t?.entry ?? null, tradeStop: t?.stop ?? null, tradeTarget: t?.target ?? null,
        beTrigger: t ? t.entry + (L ? 1 : -1) * t.risk * P.breakevenTrigger : null,
      };
    };
    bars.push({ time: c.time, close: c.close, ema9: a.ema9, ema21: a.ema21, ema200: a.ema200, rsi: a.rsi, atr: a.atr, macd: a.macd,
      macdSignal: a.macd - a.histogram, histogram: a.histogram, volumeSMA: a.volumeSMA, trend: a.trend, long: side('LONG'), short: side('SHORT') });
  });
  return { bars, trades: order, tickSize };
}

/** Causal view at bar index `cursor`: only trades and events that had happened by that bar's close. */
export function pineAt(run: PineRun, cursor: number): PineRun {
  const t = run.bars[cursor]?.time ?? -Infinity;
  const trades = run.trades.filter((x) => x.entryTime <= t).map((x) => ({
    ...x,
    beActivatedAt: x.beActivatedAt !== null && x.beActivatedAt <= t ? x.beActivatedAt : null,
    beStop: x.beActivatedAt !== null && x.beActivatedAt <= t ? x.beStop : null,
    ...(x.exitTime !== null && x.exitTime > t ? { exitTime: null, exitPrice: null, exit: null, netR: null } : {}),
  }));
  return { bars: run.bars.slice(0, cursor + 1), trades, tickSize: run.tickSize };
}
