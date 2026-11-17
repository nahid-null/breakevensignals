// @vitest-environment node
import { describe, expect, it } from 'vitest';
import near from './fixtures/binance-near-1m.json';
import wif from './fixtures/binance-wif-1m.json';
import { initialState, type Candle } from '@/lib/engine/model';
import { processCandle } from '@/lib/engine/scalper';
import { pineAt, runPineSeries } from '@/lib/chart/pine-series';
import { analyzeSmc, smcAt } from '@/lib/chart/smc-overlay';
import { pineBreakeven, robotBreakeven, roundToTick } from '@/lib/chart/breakeven';
import { robotStage, stageEvents } from '@/lib/chart/robot-overlay';
import { nativeRows, verificationPine } from '@/lib/parity/fields';
import { compareParity } from '@/lib/parity/compare';
import { parseTradingViewCsv } from '@/lib/parity/tradingview-csv';
import { netRoi, type Position } from '@/lib/robot/paper';
import { DEFAULT_SETTINGS } from '@/lib/robot/config';

const candles = near.candles as Candle[];

describe('chart Pine series uses the live engine unchanged', () => {
  it('records exactly the events the live engine emits on real NEARUSDT candles', () => {
    const state = initialState('NEARUSDT', near.tickSize); const live: string[] = [];
    for (const c of candles) for (const s of processCandle(state, c).signals) live.push(`${s.direction}:${s.event}:${c.time}`);
    const run = runPineSeries(candles, near.tickSize); const chart: string[] = [];
    run.bars.forEach((b) => (['LONG', 'SHORT'] as const).forEach((d) => {
      const s = d === 'LONG' ? b.long : b.short;
      if (s.stopHit) chart.push(`${d}:stop_loss_hit:${b.time}`); if (s.targetHit) chart.push(`${d}:take_profit_hit:${b.time}`);
      if (s.breakeven) chart.push(`${d}:breakeven_activated:${b.time}`); if (s.entry) chart.push(`${d}:entry_confirmed:${b.time}`);
    }));
    expect(live.length).toBeGreaterThan(0);
    expect(chart.sort()).toEqual(live.sort());
  });
  it('replay cursor never exposes later trades, exits or break-even moves', () => {
    const run = runPineSeries(candles, near.tickSize);
    for (const k of [250, 600, 999, 1300]) {
      const prefix = runPineSeries(candles.slice(0, k + 1), near.tickSize);
      const view = pineAt(run, k);
      expect(view.bars).toEqual(prefix.bars);
      expect(view.trades).toEqual(prefix.trades.map((t) => ({ ...t })));
    }
  });
  it('treats other timeframes as consecutive bars (Pine bar_index cooldown)', () => {
    const five: Candle[] = [];
    for (let i = 0; i + 5 <= candles.length; i += 5) { const g = candles.slice(i, i + 5);
      five.push({ time: g[0]!.time, open: g[0]!.open, close: g.at(-1)!.close, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), volume: g.reduce((a, x) => a + x.volume, 0) }); }
    const run = runPineSeries(five, near.tickSize);
    expect(run.bars).toHaveLength(five.length);
    expect(run.bars.map((b) => b.time)).toEqual(five.map((b) => b.time));
  });
});

describe('Smart Money overlay is causal', () => {
  it('what is shown at a replay bar equals analysing only the candles up to that bar', () => {
    for (const set of [candles, wif.candles as Candle[]]) {
      const full = analyzeSmc(set, 0.001);
      expect(full.sweeps.length + full.breaks.length + full.zones.length).toBeGreaterThan(0);
      for (const k of [100, 480, 901, 1499]) expect(smcAt(full, k)).toEqual(analyzeSmc(set.slice(0, k + 1), 0.001));
    }
  });
  it('labels a break that follows a sweep of the opposite side as MSS', () => {
    const bar = (t: number, o: number, h: number, l: number, c: number): Candle => ({ time: t * 60_000, open: o, high: h, low: l, close: c, volume: 1 });
    // swing high 105 at i=2, swing low 98 at i=6, sweep below 98 closing back above at i=9, close above 105 at i=11.
    const seq = [bar(0, 100, 101, 99, 100), bar(1, 100, 103, 99.5, 102), bar(2, 102, 105, 101, 104), bar(3, 104, 104.5, 101, 101.5), bar(4, 101.5, 102, 99, 99.5),
      bar(5, 99.5, 100, 98.5, 99), bar(6, 99, 99.5, 98, 98.8), bar(7, 98.8, 100, 98.6, 99.6), bar(8, 99.6, 100.5, 99.2, 100), bar(9, 100, 100.2, 97.5, 99.4),
      bar(10, 99.4, 103, 99.3, 102.8), bar(11, 102.8, 106, 102.5, 105.6)];
    const r = analyzeSmc(seq, 0.01);
    expect(r.sweeps.map((s) => [s.side, s.level])).toEqual([['SELL_SIDE', 98]]);
    expect(r.breaks.at(-1)).toMatchObject({ kind: 'MSS', dir: 1, level: 105, at: 11 });
  });
});

describe('break-even: five separate values', () => {
  it('Pine LONG: 1R trigger, stop at the exact entry, fee-adjusted price above it', () => {
    const b = pineBreakeven({ direction: 'LONG', entry: 100, originalStop: 99 }, 0.01);
    expect(b.trigger).toBe(101);
    expect(b.stop).toBe(100);
    expect(b.feeAdjusted).toBeCloseTo((100 * 1.0004 + 0.02) / 0.9996, 10);
    expect(b.feeAdjusted).toBeGreaterThan(b.stop);
  });
  it('Pine SHORT mirrors it', () => {
    const b = pineBreakeven({ direction: 'SHORT', entry: 100, originalStop: 101.5 }, 0.01);
    expect(b.trigger).toBe(98.5);
    expect(b.stop).toBe(100);
    expect(b.feeAdjusted).toBeCloseTo((100 * 0.9996 - 0.02) / 1.0004, 10);
  });
  it('robot trigger is where its own net ROI reaches the setting, and its stop locks +2% net', () => {
    const s = { ...DEFAULT_SETTINGS, breakeven_trigger_roi_pct: 6 };
    for (const direction of ['LONG', 'SHORT'] as const) {
      const entry = 3.2715; const qty = 31; const fee = entry * qty * s.fee_pct / 100;
      const row = { direction, entry_price: entry, quantity: qty, leverage: 50, entry_fee: fee, funding: 0, tick_size: 0.0001, initial_stop: direction === 'LONG' ? 3.25 : 3.29, stop_loss: direction === 'LONG' ? 3.25 : 3.29 };
      const be = robotBreakeven(row, s);
      const p = { direction, entry, qtyOpen: qty, margin: entry * qty / 50, realized: -fee } as unknown as Position;
      expect(netRoi(p, be.trigger, s)).toBeCloseTo(6, 8);
      expect(netRoi(p, be.stop, s)).toBeGreaterThanOrEqual(2);
      expect(netRoi(p, be.stop, s)).toBeLessThan(2.5);
      expect((be.stop - entry) * (direction === 'LONG' ? 1 : -1)).toBeGreaterThan(0);
    }
  });
  it('rounds exchange prices to the tick in the protective direction', () => {
    expect(roundToTick(100.00049, 0.001, 'up')).toBe(100.001);
    expect(roundToTick(100.00049, 0.001, 'down')).toBe(100);
  });
});

describe('robot stages from stored reasons', () => {
  it('maps SMC_V1 rejection reasons to how far the sequence got', () => {
    expect(robotStage('No recent sell-side liquidity sweep', 'REJECTED')).toBe(0);
    expect(robotStage('Waiting for bullish MSS: no close beyond 3.27', 'REJECTED')).toBe(1);
    expect(robotStage('Waiting for retracement into the FVG', 'REJECTED')).toBe(2);
    expect(robotStage('Retracement 55% outside OTE 62–79%', 'REJECTED')).toBe(3);
    expect(robotStage('Qualified setup', 'QUALIFIED')).toBe(4);
  });
  it('emits only forward transitions per direction', () => {
    const row = (m: number, reason: string) => ({ candle_time: new Date(m * 60_000).toISOString(), direction: 'LONG', phase: 'EVALUATION', decision: 'REJECTED', reason, score: null, strategy: 'SMC_V1', evidence: null });
    const ev = stageEvents([row(2, 'No recent sell-side liquidity sweep'), row(3, 'Waiting for bullish MSS: x'), row(4, 'Waiting for bullish MSS: x'), row(5, 'Waiting for retracement into the OB')]);
    expect(ev.map((e) => [e.time / 60_000, e.stage])).toEqual([[2, 1], [4, 2]]);
  });
});

describe('parity report', () => {
  const run = runPineSeries(candles, near.tickSize);
  it('passes against identical values and reports the first changed candle', () => {
    const native = nativeRows(run, 'LONG');
    expect(compareParity(native, native).matches).toBe(true);
    const ref = native.map((r, i) => i === 700 ? { ...r, values: { ...r.values, rsi: (r.values.rsi as number) + 0.01 } } : r);
    const rep = compareParity(native, ref);
    expect(rep.matches).toBe(false);
    expect(rep.firstMismatch).toEqual({ field: 'rsi', time: candles[700]!.time });
    expect(rep.fields.find((f) => f.field === 'rsi')!.matching).toBe(candles.length - 1);
  });
  it('verification script keeps the original source byte-for-byte and only appends plots', () => {
    const src = '//@version=6\nindicator("x")\nplot(close)\n';
    const out = verificationPine(src, 'LONG');
    expect(out.startsWith(src.trimEnd())).toBe(true);
    expect(out).toContain('plot(rsi, "VERIFY_rsi", display=display.data_window)');
  });
  it('reads a TradingView export with the original plot titles and verification columns', () => {
    const csv = 'time,open,high,low,close,EMA 9,Confirmed LONG,VERIFY_rsi,Volume\n1794887820,3.272,3.274,3.263,3.267,3.2701,NaN,48.5,157421\n1794887880,3.267,3.282,3.265,3.28,3.2721,1,55.1,253541\n';
    const tv = parseTradingViewCsv(csv);
    expect(tv.direction).toBe('LONG');
    expect(tv.intervalMs).toBe(60_000);
    expect(tv.rows[0]!.time).toBe(1794887820000);
    expect(tv.rows.map((r) => [r.values.ema9, r.values.entryEvent, r.values.rsi])).toEqual([[3.2701, false, 48.5], [3.2721, true, 55.1]]);
  });
});

describe('parity page pipeline on the intact original scripts', () => {
  it('internal engine matches the corrected PineTS run of the original LONG and SHORT source', async () => {
    const { runPineReference } = await import('@/lib/parity/pine-reference');
    const set = candles.slice(0, 700); const run = runPineSeries(set, near.tickSize);
    for (const d of ['LONG', 'SHORT'] as const) {
      const rep = compareParity(nativeRows(run, d), await runPineReference(set, 'NEARUSDT', near.tickSize, d, 60_000, true));
      expect(rep.fields.filter((f) => f.pct < 100).map((f) => f.field)).toEqual([]);
      expect(rep.matches).toBe(true);
      expect(rep.bars).toBe(700);
      expect(rep.fields.length).toBeGreaterThan(15);
    }
    const raw = compareParity(nativeRows(run, 'LONG'), await runPineReference(set, 'NEARUSDT', near.tickSize, 'LONG', 60_000, false));
    expect(raw.matches).toBe(false);
  }, 120_000);
});
