import type { Bar } from './cpes';

/** Forex weekly closure (UTC): Friday 22:00 → Sunday 22:00 (New York 17:00 during US standard time). */
export function forexOpen(tSec: number): boolean {
  const d = new Date(tSec * 1000);
  const day = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (day === 6) return false;
  if (day === 5 && m >= 22 * 60) return false;
  if (day === 0 && m < 22 * 60) return false;
  return true;
}

export type RawRow = [number, number | null, number | null, number | null, number | null];

/** Clean 1-minute rows: drop empty rows and market-closed filler, round to the 3-decimal quote precision. */
export function cleanMinutes(rows: RawRow[]): Bar[] {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const out: Bar[] = [];
  for (const [t, o, h, l, c] of rows) {
    if (o == null || h == null || l == null || c == null || !forexOpen(t)) continue;
    out.push({ t, o: r3(o), h: r3(h), l: r3(l), c: r3(c) });
  }
  return out;
}

/** Aggregate 1-minute bars into M3 bars aligned to UTC multiples of 3 minutes. */
export function toM3(minutes: Bar[]): (Bar & { minutes: number })[] {
  const out: (Bar & { minutes: number })[] = [];
  for (const m of minutes) {
    const t = Math.floor(m.t / 180) * 180;
    const last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, m.h); last.l = Math.min(last.l, m.l); last.c = m.c; last.minutes++; }
    else out.push({ t, o: m.o, h: m.h, l: m.l, c: m.c, minutes: 1 });
  }
  return out;
}
