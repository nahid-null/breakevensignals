/** Pure Simulator 2 replay; formulas mirror simulate2_engine_candle (50x, 80% margin, 0.05% fee/side, 1 tick/side). */
export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type Rules = { trend: boolean; realistic: boolean; share?: number; base?: 'balance' | 'margin'; lev?: number; hold?: number; extra?: Sim2Variant };
export type Sim2Variant = 'trend20' | 'retest' | 'noExtend' | 'vol' | 'room';
export type Sim2Trade = { symbol: string; direction: 'LONG' | 'SHORT'; signalTime: number; entry: number; tp: number; sl: number; exit: number; reason: string; pnl: number; balanceAfter: number; cost: number; held: number };
export const SIM2 = { lev: 50, share: 0.8, fee: 0.0005, target: 0.10, risk: 0.05, body: 0.60, trendLen: 20, rangeLen: 5 } as const;

/** Price levels for a trade opened at `op` (same algebra as the database function). */
export function sim2Levels(balance: number, op: number, s: 1 | -1, tick: number, share: number = SIM2.share, base: 'balance' | 'margin' = 'balance', lev: number = SIM2.lev) {
  const m = balance * share, ref = base === 'margin' ? m : balance, q = (m * lev) / op, f = m * lev * SIM2.fee;
  const tp = (op * s + (ref * SIM2.target + f) / q + 2 * tick) / (s - SIM2.fee);
  const sl = (op * s + (-ref * SIM2.risk + f) / q + 2 * tick) / (s - SIM2.fee);
  const liq = op * (1 - s * (1 / lev - 0.005));
  return { m, q, f, tp, sl, liq };
}

/** Training 1 breakout + optional Training 3 filters, evaluated on closed candles up to index i. */
function baseSignal(c: Candle[], i: number, tick: number, balance: number, rules: Rules): { dir: 'LONG' | 'SHORT' | null; skip?: 'trend' | 'range' } {
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
    const s = dir === 'LONG' ? 1 : -1; const { tp } = sim2Levels(balance, k.close, s, tick, rules.share, rules.base, rules.lev);
    if (avgRange < Math.abs(tp - k.close) / k.close) return { dir: null, skip: 'range' };
  }
  return { dir };
}

export function sim2Settle(balance: number, k: Candle | Candle[], dir: 'LONG' | 'SHORT', tick: number, share: number = SIM2.share, base: 'balance' | 'margin' = 'balance', lev: number = SIM2.lev) {
  const bars = Array.isArray(k) ? k : [k]; const first = bars[0]; if (!first) return null;
  const s = dir === 'LONG' ? 1 : -1, op = first.open; const { m, q, f, tp, sl, liq } = sim2Levels(balance, op, s, tick, share, base, lev);
  if (!(tick > 0 && s * (op - sl) > 0 && s * (sl - liq) > 0 && s * (tp - op) > 0)) return null;
  let px = op, reason = 'TIME_EXIT', held = 0;
  for (const b of bars) {
    held++;
    // Stop checked first inside each candle (conservative when one candle touches both levels).
    if ((s === 1 && b.low <= sl) || (s === -1 && b.high >= sl)) { px = sl; reason = 'STOP_LOSS'; break; }
    if ((s === 1 && b.low <= liq) || (s === -1 && b.high >= liq)) { px = liq; reason = 'LIQUIDATED'; break; }
    if ((s === 1 && b.high >= tp) || (s === -1 && b.low <= tp)) { px = tp; reason = 'TAKE_PROFIT'; break; }
    px = b.close;
  }
  if (reason === 'TIME_EXIT' && bars.length === 1) reason = 'ONE_CANDLE';
  const ef = reason === 'LIQUIDATED' ? 0 : q * px * SIM2.fee;
  const gross = reason === 'LIQUIDATED' ? -m : Math.max(q * (px - op) * s - 2 * q * tick, -m);
  const nb = Math.max(balance + gross - f - ef, 0);
  return { entry: op, tp, sl, exit: px, reason, pnl: nb - balance, balanceAfter: nb, cost: f + ef + 2 * q * tick, held };
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
      const hold = rules.hold ?? 1; const bars: Candle[] = [];
      for (let j = 1; j <= hold; j++) { const b = c[i + j]; if (!b || b.time !== t + j * 60000) break; bars.push(b); }
      if (bars.length < hold) break;
      const r = sim2Settle(balance, bars, sig.dir, d.tick, rules.share, rules.base, rules.lev);
      freeAt = t + ((r?.held ?? 1) + 1) * 60000;
      if (!r) { skippedCost++; freeAt = 0; continue; }
      balance = r.balanceAfter; peak = Math.max(peak, balance); maxDrawdown = Math.max(maxDrawdown, (peak - balance) / peak);
      trades.push({ symbol: s, direction: sig.dir, signalTime: t, ...r });
      break;
    }
  }
  return { trades, balance, maxDrawdown, skippedTrend, skippedRange, skippedCost };
}

const avgClose = (c: Candle[], end: number, n: number) => c.slice(end - n + 1, end + 1).reduce((a, x) => a + x.close, 0) / n;
const avgRange = (c: Candle[], end: number, n: number) => c.slice(end - n + 1, end + 1).reduce((a, x) => a + (x.high - x.low) / x.close, 0) / n;

/**
 * Training 3 signal plus one optional research variant (backtest only):
 * trend20  - last 20 candles: close above/below close 20 bars ago, >=12 of 20 candles in trade direction, 20-average rising/falling over 5 bars
 * retest   - Training 3 breakout in the previous 3 candles, then this candle retests the broken level (within 0.05%) and closes back beyond it in the trade direction
 * noExtend - skip if close is more than 0.5% from the 20-close average or signal candle range exceeds 2x the prior 20-candle average range
 * vol      - skip unless the 20-candle average range also covers the move the net target needs
 * room     - skip unless the target is reached before the last-20-candle swing high (LONG) / swing low (SHORT)
 */
export function sim2Signal(c: Candle[], i: number, tick: number, balance: number, rules: Rules): { dir: 'LONG' | 'SHORT' | null; skip?: 'trend' | 'range' | 'variant' } {
  const k = c[i]; if (!k) return { dir: null };
  const tpMove = (dir: 'LONG' | 'SHORT', at: number) => { const s = dir === 'LONG' ? 1 : -1; const { tp } = sim2Levels(balance, at, s, tick, rules.share, rules.base, rules.lev); return Math.abs(tp - at) / at; };
  if (rules.extra === 'retest') {
    if (i < 25) return { dir: null };
    for (let j = i - 1; j >= i - 3; j--) {
      const b = baseSignal(c, j, tick, balance, { ...rules, extra: undefined }); const prev = c[j - 1];
      if (!b.dir || !prev) continue;
      const level = b.dir === 'LONG' ? prev.high : prev.low;
      const ok = b.dir === 'LONG' ? k.low <= level * 1.0005 && k.close > level && k.close > k.open
                                  : k.high >= level * 0.9995 && k.close < level && k.close < k.open;
      return ok ? { dir: b.dir } : { dir: null, skip: 'variant' };
    }
    return { dir: null };
  }
  const b = baseSignal(c, i, tick, balance, rules);
  if (!b.dir || !rules.extra) return b;
  const up = b.dir === 'LONG'; let ok = true;
  if (i < 25) return { dir: null, skip: 'variant' };
  if (rules.extra === 'trend20') {
    const w = c.slice(i - 19, i + 1); const dirCount = w.filter(x => up ? x.close > x.open : x.close < x.open).length;
    const base = c[i - 20]!; const slope = avgClose(c, i, 20) - avgClose(c, i - 5, 20);
    ok = (up ? k.close > base.close && slope > 0 : k.close < base.close && slope < 0) && dirCount >= 12;
  } else if (rules.extra === 'noExtend') {
    const avg = avgClose(c, i, 20); const prevRange = avgRange(c, i - 1, 20);
    ok = Math.abs(k.close - avg) / avg <= 0.005 && (k.high - k.low) / k.close <= 2 * prevRange;
  } else if (rules.extra === 'vol') {
    ok = avgRange(c, i, 20) >= tpMove(b.dir, k.close);
  } else if (rules.extra === 'room') {
    const w = c.slice(i - 20, i); const swing = up ? Math.max(...w.map(x => x.high)) : Math.min(...w.map(x => x.low));
    const room = up ? (swing - k.close) / k.close : (k.close - swing) / k.close;
    ok = room <= 0 || room >= tpMove(b.dir, k.close); // already above the swing (clear air) or target fits before it
  }
  return ok ? b : { dir: null, skip: 'variant' };
}
