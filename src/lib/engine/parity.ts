export type ParityValue = number | boolean | null;
export type ParityRow = { time: number; values: Record<string, ParityValue> };
export type ParityDifference = { time: number; field: string; native: ParityValue | undefined; reference: ParityValue | undefined };

/** Compare every bar, including startup; skipping warmup would hide different trade histories. */
export function comparePineRows(native: ParityRow[], reference: ParityRow[], tolerance = 1e-7) {
  const differences: ParityDifference[] = [];
  const byTime = new Map(reference.map((row) => [row.time, row]));
  for (const row of native) {
    const other = byTime.get(row.time);
    if (!other) {
      differences.push({ time: row.time, field: 'missing_bar', native: row.time, reference: undefined });
      continue;
    }
    for (const [field, value] of Object.entries(row.values)) {
      const expected = other.values[field];
      const equal = value === expected || (typeof value === 'number' && typeof expected === 'number'
        && Number.isFinite(value) && Number.isFinite(expected) && Math.abs(value - expected) <= tolerance);
      if (!equal) differences.push({ time: row.time, field, native: value, reference: expected });
    }
    byTime.delete(row.time);
  }
  for (const row of byTime.values()) differences.push({ time: row.time, field: 'extra_bar', native: undefined, reference: row.time });
  return { matches: differences.length === 0, comparedBars: native.length, differences };
}