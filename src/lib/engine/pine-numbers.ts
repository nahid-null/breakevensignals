/** Pine float comparisons round operands to nine fractional digits, not assignment values.
 * https://www.tradingview.com/pine-script-docs/language/type-system/#float
 */
export function pineNumber(value: number): number {
  const scale = 1_000_000_000;
  return Math.abs(value) * scale < Number.MAX_SAFE_INTEGER ? Math.round(value * scale) / scale : value;
}
export const pineGt = (a: number, b: number) => pineNumber(a) > pineNumber(b);
export const pineLt = (a: number, b: number) => pineNumber(a) < pineNumber(b);
export const pineGe = (a: number, b: number) => pineNumber(a) >= pineNumber(b);
export const pineLe = (a: number, b: number) => pineNumber(a) <= pineNumber(b);