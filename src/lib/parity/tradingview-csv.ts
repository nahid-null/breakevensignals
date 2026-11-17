/**
 * Parser for TradingView "Export chart data" CSV files. Maps the original indicator's own plot titles
 * ("EMA 9", "Confirmed LONG", ...) and the verification plots ("VERIFY_rsi", ...) to comparison fields.
 */
import type { Candle } from '@/lib/engine/model';
import type { ParityRow, ParityValue } from '@/lib/engine/parity';
import type { Direction } from '@/lib/config';
import { PARITY_FIELDS } from './fields';

export type TvExport = { candles: Candle[]; rows: ParityRow[]; mapped: Record<string, string>; unmapped: string[]; direction: Direction | null; intervalMs: number | null; hasVolume: boolean };

export function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out.map((s) => s.trim());
}

export function parseTime(v: string): number | null {
  if (/^\d+(\.\d+)?$/.test(v)) { const n = Number(v); return n > 1e12 ? n : n * 1000; }
  const t = Date.parse(v); return Number.isFinite(t) ? t : null;
}

const NATIVE_TITLES: Record<string, string> = { 'EMA 9': 'ema9', 'EMA 21': 'ema21', 'EMA 200': 'ema200', 'Confirmed LONG': 'entryEvent', 'Confirmed SHORT': 'entryEvent',
  'Stop Loss Exit': 'stopEvent', 'Take Profit Exit': 'targetEvent' };

export function parseTradingViewCsv(text: string): TvExport {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('The file has no data rows.');
  const header = splitCsvLine(lines[0]!);
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name);
  const ti = col('time'); const oi = col('open'); const hi = col('high'); const li = col('low'); const ci = col('close'); const vi = col('volume');
  if (ti < 0 || oi < 0 || hi < 0 || li < 0 || ci < 0) throw new Error('Missing time/open/high/low/close columns. Use TradingView "Export chart data".');
  const mapped: Record<string, string> = {}; const unmapped: string[] = []; const fieldCol: [string, number][] = [];
  let direction: Direction | null = null;
  header.forEach((h, i) => {
    if ([ti, oi, hi, li, ci, vi].includes(i)) return;
    const verify = /^VERIFY_(\w+)$/.exec(h)?.[1];
    const field = verify && PARITY_FIELDS.some((f) => f.field === verify) ? verify : NATIVE_TITLES[h];
    if (h === 'Confirmed LONG') direction = 'LONG'; if (h === 'Confirmed SHORT') direction = 'SHORT';
    if (field && !fieldCol.some(([f]) => f === field && verify === undefined)) {
      // A VERIFY_ column wins over the indicator's own plot of the same value.
      const existing = fieldCol.findIndex(([f]) => f === field);
      if (existing >= 0) { if (verify) fieldCol[existing] = [field, i]; } else fieldCol.push([field, i]);
      mapped[field] = h;
    } else unmapped.push(h);
  });
  const candles: Candle[] = []; const rows: ParityRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line); const time = parseTime(c[ti] ?? '');
    if (time === null) continue;
    const candle = { time, open: Number(c[oi]), high: Number(c[hi]), low: Number(c[li]), close: Number(c[ci]), volume: vi >= 0 ? Number(c[vi]) : NaN };
    candles.push(candle);
    const values: Record<string, ParityValue> = {};
    for (const [field, i] of fieldCol) {
      const raw = c[i] ?? ''; const n = raw === '' || /^nan$/i.test(raw) ? NaN : Number(raw);
      const kind = PARITY_FIELDS.find((f) => f.field === field)?.kind;
      values[field] = kind === 'bool' ? Number.isFinite(n) && n !== 0 : Number.isFinite(n) ? n : null;
    }
    rows.push({ time, values });
  }
  const steps = candles.slice(1, 50).map((c, i) => c.time - candles[i]!.time).filter((x) => x > 0).sort((a, b) => a - b);
  return { candles, rows, mapped, unmapped, direction, intervalMs: steps[Math.floor(steps.length / 2)] ?? null, hasVolume: vi >= 0 };
}
