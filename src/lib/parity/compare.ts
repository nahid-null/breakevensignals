/** Candle-by-candle comparison report. Every bar is compared, including warm-up; nothing is skipped or hidden. */
import type { ParityRow, ParityValue } from '@/lib/engine/parity';
import { PARITY_FIELDS } from './fields';

export type FieldReport = {
  field: string; label: string; compared: number; matching: number; missing: number; pct: number; maxAbs: number;
  first: { time: number; native: ParityValue | undefined; reference: ParityValue | undefined; diff: number | null } | null;
  lastMismatchTime: number | null; reason: string | null;
};
export type ParityReport = { bars: number; fields: FieldReport[]; matches: boolean; firstMismatch: { field: string; time: number } | null };

const num = (v: ParityValue | undefined) => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function equalValue(a: ParityValue | undefined, b: ParityValue | undefined, tol: number) {
  if (a === b) return true;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b) && a !== undefined && b !== undefined;
  const x = num(a); const y = num(b);
  if (x === null || y === null) return (a === null || a === undefined || Number.isNaN(a)) && (b === null || b === undefined || Number.isNaN(b as number));
  return Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));
}

function reasonFor(field: string, f: FieldReport, bars: number, indexOf: (t: number) => number, first: number): string {
  const startIdx = indexOf(first); const lastIdx = f.lastMismatchTime === null ? -1 : indexOf(f.lastMismatchTime);
  if (f.missing === f.compared) return 'Not present in the reference (column missing from the export).';
  if (['ema9', 'ema21', 'ema200', 'macd', 'macdSignal', 'histogram', 'rsi', 'atr'].includes(field) && startIdx < 5 && lastIdx < bars * 0.6)
    return 'Differences only near the start, then converge: the two calculations started on different bars or seed the average differently (Pine EMA first value vs SMA seed). Use the same first candle.';
  if (field === 'volumeSMA' || field === 'score') return 'Depends on volume: check the reference uses the same volume (Binance USD-M base volume).';
  if (['setup', 'entryEvent', 'calculatedStop'].includes(field)) return 'Entry condition differs on this candle: compare the indicator rows above at the same time to find the input that differs.';
  return 'Follows from an earlier indicator or trade-state difference: fix the first mismatching field first.';
}

export function compareParity(native: ParityRow[], reference: ParityRow[], tol = 1e-7, fields = PARITY_FIELDS.map((f) => f.field)): ParityReport {
  const ref = new Map(reference.map((r) => [r.time, r]));
  const idx = new Map(native.map((r, i) => [r.time, i]));
  const reports: FieldReport[] = fields.map((field) => {
    const label = PARITY_FIELDS.find((f) => f.field === field)?.label ?? field;
    const f: FieldReport = { field, label, compared: 0, matching: 0, missing: 0, pct: 0, maxAbs: 0, first: null, lastMismatchTime: null, reason: null };
    for (const row of native) {
      const other = ref.get(row.time); f.compared++;
      const a = row.values[field]; const b = other?.values[field];
      if (!other || !(field in other.values)) { f.missing++; if (!f.first) f.first = { time: row.time, native: a, reference: undefined, diff: null }; f.lastMismatchTime = row.time; continue; }
      if (equalValue(a, b, tol)) { f.matching++; continue; }
      const x = num(a); const y = num(b); const d = x !== null && y !== null ? x - y : null;
      if (d !== null) f.maxAbs = Math.max(f.maxAbs, Math.abs(d));
      if (!f.first) f.first = { time: row.time, native: a, reference: b, diff: d };
      f.lastMismatchTime = row.time;
    }
    f.pct = f.compared ? (f.matching / f.compared) * 100 : 0;
    if (f.first) f.reason = reasonFor(field, f, native.length, (t) => idx.get(t) ?? 0, f.first.time);
    return f;
  });
  const firsts = reports.filter((r) => r.first).sort((a, b) => a.first!.time - b.first!.time);
  return { bars: native.length, fields: reports, matches: firsts.length === 0, firstMismatch: firsts[0] ? { field: firsts[0].field, time: firsts[0].first!.time } : null };
}
