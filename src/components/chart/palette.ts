import type { Palette } from '@/lib/chart/chart-model';

/** Resolve a CSS custom property (any colour syntax) to rgb via a 1px canvas, so the chart uses the app's tokens. Browser only. */
export function cssColor(name: string): [number, number, number] {
  if (typeof document === 'undefined') return [128, 128, 128];
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d');
  if (!ctx || !raw) return [128, 128, 128];
  ctx.fillStyle = raw; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 128, d[1] ?? 128, d[2] ?? 128];
}
const rgba = ([r, g, b]: [number, number, number], a = 1) => `rgba(${r},${g},${b},${a})`;
export function readPalette(): Palette {
  const v = (n: string) => rgba(cssColor(n));
  return { long: v('--long'), short: v('--short'), waiting: v('--waiting'), active: v('--active'), breakeven: v('--breakeven'), fg: v('--foreground'), muted: v('--muted-foreground'),
    alpha: (c, a) => c.replace(/rgba\((\d+),(\d+),(\d+),[\d.]+\)/, `rgba($1,$2,$3,${a})`) };
}
