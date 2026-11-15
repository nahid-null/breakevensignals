// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PineTS } from 'pinets';
import { ema } from '@/lib/engine/calculations';
import { comparePineRows } from '@/lib/engine/parity';
import { runCorrectedPine } from '../../engine-worker/pine-runtime';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Pine comparison safeguards', () => {
  it('does not mistake the experimental SMA-seeded interpreter for Pine first-value EMA', async () => {
    const bars = [10, 20, 30].map((close, i) => ({ openTime: i * 60000, closeTime: (i + 1) * 60000,
      open: close, high: close + 1, low: close - 1, close, volume: 100 }));
    const output = await new PineTS(bars).run('//@version=6\nindicator("seed audit")\nplot(ta.ema(close, 3), "EMA")');
    expect(ema(null, 10, 3)).toBe(10);
    expect(Number.isNaN(output.plots.EMA?.data[0]?.value)).toBe(true);
    expect(output.plots.EMA?.data[2]?.value).toBe(20);
    let previous: number | null = null;
    const native = bars.map((bar) => { previous = ema(previous, bar.close, 3); return { time: bar.openTime, values: { ema: previous } }; });
    const reference = bars.map((bar, i) => { const value = output.plots.EMA?.data[i]?.value; return { time: bar.openTime, values: { ema: Number.isFinite(value) ? Number(value) : null } }; });
    expect(comparePineRows(native, reference).matches).toBe(false);
    expect(native[2]?.values.ema).toBe(22.5);
  });
  it('fails a changed entry, stop or breakeven rather than just comparing final totals', () => {
    const result = comparePineRows([{ time: 60000, values: { entry: true, stop: 99, breakeven: false } }],
      [{ time: 60000, values: { entry: false, stop: 98, breakeven: true } }]);
    expect(result.matches).toBe(false);
    expect(result.differences.map((d) => d.field)).toEqual(['entry', 'stop', 'breakeven']);
  });
  it('corrects reference EMA first-value seed and all MACD EMA calls without a warmup gap', async () => {
    const bars = [10, 20, 30].map((close, i) => ({ openTime: i * 60000, closeTime: (i + 1) * 60000,
      open: close, high: close + 1, low: close - 1, close, volume: 100 }));
    const output = await runCorrectedPine(new PineTS(bars), '//@version=6\nindicator("seed correction")\nplot(ta.ema(close, 3), "EMA")\n[f,s,h] = ta.macd(close, 2, 3, 2)\nplot(f,"MACD")\nplot(h,"Histogram")');
    expect(output.plots.EMA.data.map((point: { value: number }) => point.value)).toEqual([10, 15, 22.5]);
    expect(output.plots.MACD.data[0].value).toBe(0);
    expect(output.plots.MACD.data[1].value).toBeCloseTo(5 / 3, 12);
    expect(output.plots.Histogram.data[1].value).toBeCloseTo(5 / 9, 12);
  });
  it('corrects partial extrema, prior-bar offsets and nine-decimal comparison independently', async () => {
    const bars = [10, 20, 30].map((close, i) => ({ openTime: i * 60000, closeTime: (i + 1) * 60000,
      open: close, high: close + 1, low: close - 1, close, volume: 100 }));
    const output = await runCorrectedPine(new PineTS(bars), '//@version=6\nindicator("startup semantics")\nplot(ta.lowest(low,3),"LOW")\nplot(ta.highest(high[1],3),"PRIOR")\nplot(52.0000000001 > 52.0 ? 1 : 0,"CMP")');
    expect(output.plots.LOW.data.map((point: { value: number }) => point.value)).toEqual([9, 9, 9]);
    expect(Number.isNaN(output.plots.PRIOR.data[0].value)).toBe(true);
    expect(output.plots.PRIOR.data[1].value).toBe(11);
    expect(output.plots.CMP.data[0].value).toBe(0);
  });
  it('rejects missing bars and startup values without discarding warmup', () => {
    const result = comparePineRows([{ time: 0, values: { ema: 10 } }, { time: 60000, values: { ema: 12 } }], [{ time: 0, values: { ema: null } }]);
    expect(result.differences.map((d) => d.field)).toEqual(['ema', 'missing_bar']);
  });
  it('accepts matching values only within the explicit numerical tolerance', () => {
    const native = [{ time: 0, values: { rsi: 52, entry: false, stop: null } }];
    expect(comparePineRows(native, [{ time: 0, values: { rsi: 52 + 1e-8, entry: false, stop: null } }]).matches).toBe(true);
    expect(comparePineRows(native, [{ time: 0, values: { rsi: 52 + 1e-5, entry: false, stop: null } }]).matches).toBe(false);
  });
  for (const symbol of ['near', 'link', 'wif']) {
    it(`${symbol}: both intact original scripts match native EMA, entries, SL/TP and breakeven on all 1500 real candles`, () => {
      const path = join(tmpdir(), `pine-regression-${symbol}.json`);
      execFileSync('bun', ['engine-worker/verify-pine.ts', `--fixture=src/test/fixtures/binance-${symbol}-1m.json`, path], { cwd: process.cwd(), stdio: 'pipe' });
      const report = JSON.parse(readFileSync(path, 'utf8'));
      expect(report.bars).toBe(1500);
      expect(report.comparisons).toHaveLength(2);
      for (const side of report.comparisons) {
        expect(side.matches).toBe(true);
        expect(side.byField).toEqual({});
        expect(side.fields.find((field: { field: string }) => field.field === 'ema200').maxAbsoluteError).toBe(0);
        expect(side.fields.find((field: { field: string }) => field.field === 'breakevenEvent').eventCount).toBeGreaterThan(0);
      }
    }, 30000);
  }
});