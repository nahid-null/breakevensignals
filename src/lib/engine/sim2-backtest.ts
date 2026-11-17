/** Pure Simulator 2 replay; formulas mirror simulate2_engine_candle (50x, 80% margin, 0.05% fee/side, 1 tick/side). */
export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Rules = { trend: boolean; realistic: boolean; share?: number; base?: 'balance' | 'margin' };
export type Sim2Trade = { symbol: string; direction: 'LONG' | 'SHORT'; signalTime: number; entry: number; tp: number; sl: number; exit: number; reason: string; pnl: number; balanceAfter: number };
export const SIM2 = { lev: 50, share: 0.8, fee: 0.0005, target: 0.10, risk: 0.05, body: 0.60, trendLen: 20, rangeLen: 5 } as const;

/** Price levels for a trade opened at `op` (same algebra as the database function). */
export function sim2Levels(balance: number, op: number, s: 1 | -1, tick: number, share: number = SIM2.share, base: 'balance' | 'margin' = 'balance') {
  const m = balance * share, ref = base === 'margin' ? m : balance, q = (m * SIM2.lev) / op, f = m * SIM2.lev * SIM2.fee;
  const tp = (op * s + (ref * SIM2.target + f) / q + 2 * tick) / (s - SIM2.fee);
  const sl = (op * s + (-ref * SIM2.risk + f) / q + 2 * tick) / (s - SIM2.fee);
  const liq = op * (1 - s * (1 / SIM2.lev - 0.005));
  return { m, q, f, tp, sl, liq };
}

/** Training 1 breakout + optional Training 3 filters, evaluated on closed candles up to index i. */
export function sim2Signal(c: Candle[], i: number, tick: number, balance: number, rules: Rules): { dir: 'LONG' | 'SHORT' | null; skip?: 'trend' | 'range' } {
  const k = c[i], p = c[i - 1];
  if (!k || !p || p.time !== k.time - 60000 || k.high === k.low) return { dir: null };
  if (Math.abs(k.close - k.open) / (k.high - k.low) < SIM2.body) return { dir: null };
  const dir = k.close > k.open && k.close > p.high ? 'LONG' : k.close < k.open && k.close < p.low ? 'SHORT' : null;
  if (!dir) return { dir: null };
  if (rules.trend) {
    if (i < SIM2.trendLen) return { dir: null, skip: 'trend' };
    const avg = (end: number) => c.slice(end - SIM2.trendLen + 1, end + 1).reduce((a, x) => a + x.close, 0) / SIM2.trendLen;
    const now = avg(i), before = avg(i - 1);
    const ok = dir === 'LONG' ? k.close > now && now > before : k.close < now && now < before;
    if (!ok) return { dir: null, skip: 'trend' };
  }
  if (rules.realistic) {
    if (i < SIM2.rangeLen - 1) return { dir: null, skip: 'range' };
    const avgRange = c.slice(i - SIM2.rangeLen + 1, i + 1).reduce((a, x) => a + (x.high - x.low) / x.close, 0) / SIM2.rangeLen;
    const s = dir === 'LONG' ? 1 : -1; const { tp } = sim2Levels(balance, k.close, s, tick, rules.share, rules.base);
    if (avgRange < Math.abs(tp - k.close) / k.close) return { dir: null, skip: 'range' };
  }
  return { dir };
}

export function sim2Settle(balance: number, k: Candle, dir: 'LONG' | 'SHORT', tick: number, share: number = SIM2.share, base: 'balance' | 'margin' = 'balance') {
  const s = dir === 'LONG' ? 1 : -1, op = k.open; const { m, q, f, tp, sl, liq } = sim2Levels(balance, op, s, tick, share, base);
  if (!(tick > 0 && s * (op - sl) > 0 && s * (sl - liq) > 0 && s * (tp - op) > 0)) return null;
  let px: number, reason: string;
  if ((s === 1 && k.low <= sl) || (s === -1 && k.high >= sl)) { px = sl; reason = 'STOP_LOSS'; }
  else if ((s === 1 && k.low <= liq) || (s === -1 && k.high >= liq)) { px = liq; reason = 'LIQUIDATED'; }
  else if ((s === 1 && k.high >= tp) || (s === -1 && k.low <= tp)) { px = tp; reason = 'TAKE_PROFIT'; }
  else { px = k.close; reason = 'ONE_CANDLE'; }
  const ef = reason === 'LIQUIDATED' ? 0 : q * px * SIM2.fee;
  const gross = reason === 'LIQUIDATED' ? -m : Math.max(q * (px - op) * s - 2 * q * tick, -m);
  const nb = Math.max(balance + gross - f - ef, 0);
  return { entry: op, tp, sl, exit: px, reason, pnl: nb - balance, balanceAfter: nb };
}

/** One trade at a time across all coins, chronological; signals only from candles at/after `from`. */
export function simulate2(data: Record<string, { tick: number; candles: Candle[] }>, rules: Rules, from: number, startBalance = 5) {
  const idx: Record<string, Map<number, number>> = {};
  const get = <T,>(r: Record<string, T>, k: string) => r[k] as T;
  const times = new Set<number>();
  for (const [s, d] of Object.entries(data)) { idx[s] = new Map(d.candles.map((c, i) => [c.time, i])); d.candles.forEach(c => c.time >= from && times.add(c.time)); }
  let skippedCost = 0; let balance = startBalance, peak = startBalance, maxDrawdown = 0, skippedTrend = 0, skippedRange = 0, freeAt = 0;
  const trades: Sim2Trade[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    if (t < freeAt || balance <= 0) continue;
    for (const s of Object.keys(data).sort()) {
      const i = get(idx, s).get(t); if (i === undefined) continue;
      const d = get(data, s), c = d.candles; const sig = sim2Signal(c, i, d.tick, balance, rules);
      if (sig.skip === 'trend') skippedTrend++; if (sig.skip === 'range') skippedRange++;
      if (!sig.dir) continue;
      const next = c[i + 1]; if (!next || next.time !== t + 60000) break;
      const r = sim2Settle(balance, next, sig.dir, d.tick, rules.share, rules.base);
      freeAt = t + 120000;
      if (!r) { skippedCost++; freeAt = 0; continue; }
      balance = r.balanceAfter; peak = Math.max(peak, balance); maxDrawdown = Math.max(maxDrawdown, (peak - balance) / peak);
      trades.push({ symbol: s, direction: sig.dir, signalTime: t, ...r });
      break;
    }
  }
  return { trades, balance, maxDrawdown, skippedTrend, skippedRange, skippedCost };
}
