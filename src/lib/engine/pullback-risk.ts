import Decimal from 'decimal.js';
import { MINUTE, type Candle } from './model';

/**
 * prompt-49 RESEARCH ONLY: account-level cross-margin replay for the Pullback (Setup B), score 60+ entries.
 * Not wired into the worker, database, Telegram or the live Simulator. Pure: reads only the candles it is given,
 * every decision at minute t uses candles up to and including t (no look-ahead).
 * No time-based close in any rule. Rules: 'none' (no forced exit), 'fixed' (close when the loss reaches pct% of
 * initial margin), 'dynamic' (Dynamic Liquidity Protection, see armDynamic).
 */
export const PR = {
  leverage: 50, marginShare: 0.1, feeRate: 0.0005, mmr: 0.005, startBalance: 10, slots: 3, slipPct: 0.0002,
  /** Dynamic arming: account cushion (margin balance - maintenance) at or below this share of wallet balance. */
  cushionArm: 0.5,
  /** Dynamic arming: candle close beyond the trade's swing liquidity pool AND loss at least this % of margin. */
  poolArmLossPct: 100,
  marks: [100, 150, 200, 300],
} as const;
const D = (x: Decimal.Value) => new Decimal(x);
const ZERO = D(0);

export type ExitRule = { kind: 'none' } | { kind: 'fixed'; pct: number } | { kind: 'dynamic'; cushionArm?: number; poolArmLossPct?: number };
export interface Entry { id: string; symbol: string; side: 'LONG' | 'SHORT'; time: number; price: number; score: number; tick: number }
export interface Pool { known: number; price: number }
export interface Market {
  last: Map<string, Map<number, Candle>>; mark: Map<string, Map<number, Candle>>;
  /** funding rate keyed by the minute of the funding time */
  funding: Map<string, Map<number, number>>; lows: Map<string, Pool[]>; highs: Map<string, Pool[]>;
}
export interface SimOptions { from: number; to: number; rule: ExitRule; mmr?: number }
export type Reason = 'TAKE_PROFIT' | 'RISK_THRESHOLD' | 'DYNAMIC_LIQUIDITY_PROTECTION' | 'ACCOUNT_LIQUIDATION' | 'UNRESOLVED';

export interface DynamicInfo { armedTime: number; trigger: 'ACCOUNT_CUSHION' | 'LIQUIDITY_POOL_BREAK'; thresholdPct: number; stopPrice: number;
  cushionPct: number; pool: number | null; closeAtArm: number }
export interface TradeRecord {
  id: string; symbol: string; side: 'LONG' | 'SHORT'; score: number; entryTime: number; signalPrice: number; entryFill: number;
  balanceBefore: number; margin: number; notional: number; quantity: number; tpPrice: number;
  maeUsd: number; maePct: number; maeTime: number | null; crossed: Record<number, boolean>; crossedTime: Record<number, number | null>;
  thresholdCross: { time: number; price: number; lossUsd: number; lossPct: number } | null;
  exitTime: number | null; exitPrice: number | null; reason: Reason; tpTouchedSameCandle: boolean;
  entryFee: number; exitFee: number; funding: number; slippageUsd: number; liquidationClearance: number;
  pnl: number; unrealizedAtEnd: number | null; dynamic: DynamicInfo | null; pool: number | null;
}
export interface SimResult {
  trades: TradeRecord[]; wallet: number; equityEnd: number; maxDdClosePct: number; maxDdIntrabarPct: number;
  skips: Record<'ALL_SLOTS_IN_USE' | 'COIN_ALREADY_OPEN' | 'INSUFFICIENT_BALANCE', number>;
  minutes: number; minutesAllSlots: number; slotMinutes: number; liquidationEvents: { time: number; positions: string[]; equity: number; maintenance: number }[];
  ambiguousCandles: number; markFallbacks: number;
}

interface Pos {
  e: Entry; s: 1 | -1; q: Decimal; margin: Decimal; notional: Decimal; fill: Decimal; slip: Decimal; target: Decimal; entryFee: Decimal;
  funding: Decimal; balanceBefore: Decimal; mae: Decimal; maeTime: number | null; crossedTime: Record<number, number | null>;
  thresholdCross: TradeRecord['thresholdCross']; dynamic: DynamicInfo | null; pool: number | null;
}

/** Target formula identical to the live PINE1 rule (+25% net of margin after fees and two-sided slippage). */
export function targetPrice(side: 'LONG' | 'SHORT', price: Decimal.Value, slip: Decimal.Value) {
  const pe = D(price); const sl = D(slip);
  return side === 'LONG' ? pe.mul(1.0055).plus(sl.mul(2)).div(0.9995) : pe.mul(0.9945).minus(sl.mul(2)).div(1.0005);
}
export const slipOf = (price: number, tick: number) => Math.max(tick, price * PR.slipPct);

/** Confirmed 15-minute swing pools (pivot length 2) built from 1-minute candles; known only after the confirming bar closes. */
export function swingPools(bars: Candle[], len = 2): { lows: Pool[]; highs: Pool[] } {
  const span = 15 * MINUTE; const q: Candle[] = []; let cur = null as Candle | null;
  for (const c of bars) {
    const st = Math.floor(c.time / span) * span;
    const prev = cur as Candle | null;
    cur = !prev || prev.time !== st ? { ...c, time: st } : { ...prev, high: Math.max(prev.high, c.high), low: Math.min(prev.low, c.low), close: c.close };
    if (c.time + MINUTE === st + span) { q.push(cur); cur = null; }
  }
  const lows: Pool[] = []; const highs: Pool[] = [];
  for (let j = len; j + len < q.length; j++) {
    const m = q[j]!; const known = q[j + len]!.time + span; const side = [...q.slice(j - len, j), ...q.slice(j + 1, j + len + 1)];
    if (side.every((b, k) => k < len ? b.high < m.high : b.high <= m.high)) highs.push({ known, price: m.high });
    if (side.every((b, k) => k < len ? b.low > m.low : b.low >= m.low)) lows.push({ known, price: m.low });
  }
  return { lows, highs };
}

/** Latest confirmed pool on the adverse side of the entry fill, known at entry. */
export function poolAt(m: Market, e: Entry, fill: number): number | null {
  const at = e.time + MINUTE;
  const list = (e.side === 'LONG' ? m.lows : m.highs).get(e.symbol) ?? [];
  for (let i = list.length - 1; i >= 0; i--) { const p = list[i]!; if (p.known > at) continue;
    if (e.side === 'LONG' ? p.price < fill : p.price > fill) return p.price; }
  return null;
}

export function simulate(m: Market, entries: Map<number, Entry[]>, o: SimOptions): SimResult {
  const mmr = o.mmr ?? PR.mmr; const rule = o.rule;
  let wallet = D(PR.startBalance); let opens: Pos[] = []; const out: TradeRecord[] = [];
  const skips = { ALL_SLOTS_IN_USE: 0, COIN_ALREADY_OPEN: 0, INSUFFICIENT_BALANCE: 0 };
  let peak = wallet; let ddClose = ZERO; let ddBar = ZERO; let minutes = 0; let minutesAll = 0; let slotMinutes = 0; let ambiguous = 0; let markFallbacks = 0;
  const liqEvents: SimResult['liquidationEvents'] = [];
  const last = (sym: string, t: number) => { const c = m.last.get(sym)?.get(t); if (!c) throw new Error(`${sym}: missing candle ${t}`); return c; };
  const mark = (sym: string, t: number) => { const c = m.mark.get(sym)?.get(t); if (c) return c; markFallbacks++; return last(sym, t); };
  const lossAt = (p: Pos, px: Decimal.Value) => p.q.mul(p.fill.minus(px)).mul(p.s); // positive = loss
  const record = (p: Pos, x: Partial<TradeRecord> & { reason: Reason }): TradeRecord => {
    const crossed: Record<number, boolean> = {}; for (const k of PR.marks) crossed[k] = p.crossedTime[k] !== null;
    const r: TradeRecord = {
      id: p.e.id, symbol: p.e.symbol, side: p.e.side, score: p.e.score, entryTime: p.e.time + MINUTE, signalPrice: p.e.price, entryFill: p.fill.toNumber(),
      balanceBefore: p.balanceBefore.toNumber(), margin: p.margin.toNumber(), notional: p.notional.toNumber(), quantity: p.q.toNumber(), tpPrice: p.target.toNumber(),
      maeUsd: p.mae.toNumber(), maePct: p.mae.div(p.margin).mul(100).toNumber(), maeTime: p.maeTime, crossed, crossedTime: { ...p.crossedTime },
      thresholdCross: p.thresholdCross, exitTime: null, exitPrice: null, tpTouchedSameCandle: false, entryFee: p.entryFee.toNumber(), exitFee: 0,
      funding: p.funding.toNumber(), slippageUsd: p.q.mul(p.slip).toNumber(), liquidationClearance: 0, pnl: 0, unrealizedAtEnd: null,
      dynamic: p.dynamic, pool: p.pool, ...x,
    };
    return r;
  };
  const closeAt = (p: Pos, t: number, px: Decimal, reason: Reason, tpTouched = false) => {
    const exitFee = p.q.mul(px).mul(PR.feeRate); const gross = lossAt(p, px).neg();
    wallet = wallet.plus(gross).minus(exitFee);
    const pnl = gross.minus(exitFee).minus(p.entryFee).minus(p.funding);
    out.push(record(p, { reason, exitTime: t + MINUTE, exitPrice: px.toNumber(), exitFee: exitFee.toNumber(), pnl: pnl.toNumber(),
      slippageUsd: p.q.mul(p.slip).mul(2).toNumber(), tpTouchedSameCandle: tpTouched }));
  };

  for (let t = o.from; t < o.to; t += MINUTE) {
    minutes++;
    // 1) funding at the funding timestamp (positions opened before it)
    for (const p of opens) { const rate = m.funding.get(p.e.symbol)?.get(t); if (rate === undefined || p.e.time + MINUTE > t) continue;
      const pay = p.q.mul(mark(p.e.symbol, t).open).mul(rate).mul(p.s); wallet = wallet.minus(pay); p.funding = p.funding.plus(pay); }
    // 2) candle evaluation for positions opened before this candle
    const live = opens.filter((p) => p.e.time < t);
    const ev = live.map((p) => {
      const c = last(p.e.symbol, t); const mk = mark(p.e.symbol, t);
      const worst = D(p.s === 1 ? c.low : c.high); const best = D(p.s === 1 ? c.high : c.low); const markWorst = D(p.s === 1 ? mk.low : mk.high);
      let stop: Decimal | null = null; let reason: Reason | null = null;
      if (rule.kind === 'fixed') { stop = p.fill.minus(p.margin.mul(rule.pct / 100).div(p.q).mul(p.s)); reason = 'RISK_THRESHOLD'; }
      if (rule.kind === 'dynamic' && p.dynamic) { stop = D(p.dynamic.stopPrice); reason = 'DYNAMIC_LIQUIDITY_PROTECTION'; }
      const stopHit = !!stop && (p.s === 1 ? worst.lte(stop) : worst.gte(stop));
      const trig = stopHit ? (p.s === 1 ? Decimal.min(D(c.open), stop!) : Decimal.max(D(c.open), stop!)) : null;
      const stopFill = trig ? trig.minus(p.slip.mul(p.s)) : null;
      const tpHit = p.s === 1 ? best.gte(p.target) : best.lte(p.target);
      return { p, c, worst, markWorst, stop, stopHit, trig, stopFill, tpHit, reason };
    });
    // MAE (last price, vs entry fill); a stopped trade only experiences the path up to its trigger price
    for (const x of ev) {
      const reach = x.stopHit ? x.trig! : x.worst; const loss = lossAt(x.p, reach);
      if (loss.gt(x.p.mae)) { x.p.mae = loss; x.p.maeTime = t; }
      for (const k of PR.marks) if (x.p.crossedTime[k] === null && loss.gte(x.p.margin.mul(k / 100))) x.p.crossedTime[k] = t;
      if (rule.kind === 'fixed' && x.stopHit && !x.p.thresholdCross) x.p.thresholdCross = { time: t, price: x.trig!.toNumber(), lossUsd: lossAt(x.p, x.trig!).toNumber(), lossPct: lossAt(x.p, x.trig!).div(x.p.margin).mul(100).toNumber() };
      if (x.stopHit && x.tpHit) ambiguous++;
    }
    // 3) account-level cross-margin liquidation (mark price, every position at its worst point of the candle at once)
    if (ev.length) {
      let eq = wallet; let maint = ZERO;
      for (const x of ev) {
        if (x.stopHit) eq = eq.minus(lossAt(x.p, x.stopFill!)).minus(x.p.q.mul(x.stopFill!).mul(PR.feeRate));
        else { eq = eq.minus(lossAt(x.p, x.markWorst)); maint = maint.plus(x.p.q.mul(x.markWorst).mul(mmr)); }
      }
      for (const p of opens.filter((p) => p.e.time >= t)) { const c = last(p.e.symbol, t); eq = eq.minus(lossAt(p, c.close)); maint = maint.plus(p.q.mul(c.close).mul(mmr)); }
      const exposed = ev.filter((x) => !x.stopHit);
      if (exposed.length && eq.lte(maint)) {
        for (const x of ev.filter((x) => x.stopHit)) closeAt(x.p, t, x.stopFill!, x.reason!, x.tpHit);
        const victims = opens.filter((p) => !ev.some((x) => x.p === p && x.stopHit));
        const px = new Map(victims.map((p) => { const x = ev.find((y) => y.p === p); return [p, x ? x.markWorst : D(last(p.e.symbol, t).close)] as const; }));
        let equity = wallet; for (const p of victims) equity = equity.minus(lossAt(p, px.get(p)!));
        const totalNotional = victims.reduce((a, p) => a.plus(p.q.mul(px.get(p)!)), ZERO);
        liqEvents.push({ time: t, positions: victims.map((p) => p.e.id), equity: equity.toNumber(), maintenance: maint.toNumber() });
        for (const p of victims) {
          const gross = lossAt(p, px.get(p)!).neg(); const clearance = totalNotional.gt(0) ? equity.mul(p.q.mul(px.get(p)!)).div(totalNotional) : ZERO;
          const x = ev.find((y) => y.p === p);
          out.push(record(p, { reason: 'ACCOUNT_LIQUIDATION', exitTime: t + MINUTE, exitPrice: px.get(p)!.toNumber(), liquidationClearance: clearance.toNumber(),
            pnl: gross.minus(clearance).minus(p.entryFee).minus(p.funding).toNumber(), tpTouchedSameCandle: !!x?.tpHit }));
          if (x?.tpHit) ambiguous++;
        }
        wallet = ZERO; opens = [];
      } else {
        for (const x of ev) {
          if (x.stopHit) closeAt(x.p, t, x.stopFill!, x.reason!, x.tpHit);
          else if (x.tpHit) closeAt(x.p, t, x.p.target.minus(x.p.slip.mul(x.p.s)), 'TAKE_PROFIT');
          else continue;
          opens = opens.filter((p) => p !== x.p);
        }
      }
    }
    // 4) Dynamic Liquidity Protection arming at this candle's close (information up to t only)
    if (rule.kind === 'dynamic' && opens.length && wallet.gt(0)) {
      let eq = wallet; let maint = ZERO;
      for (const p of opens) { const mk = mark(p.e.symbol, t); eq = eq.minus(lossAt(p, mk.close)); maint = maint.plus(p.q.mul(mk.close).mul(mmr)); }
      const cushion = eq.minus(maint).div(wallet);
      for (const p of opens) {
        if (p.dynamic || p.e.time >= t || p.mae.lte(0)) continue;
        const close = last(p.e.symbol, t).close; const lossNow = lossAt(p, close);
        const lossPct = lossNow.div(p.margin).mul(100);
        const byCushion = cushion.lte(rule.cushionArm ?? PR.cushionArm) && lossNow.gt(0);
        const byPool = p.pool !== null && (p.s === 1 ? close < p.pool : close > p.pool) && lossPct.gte(rule.poolArmLossPct ?? PR.poolArmLossPct);
        if (!byCushion && !byPool) continue;
        const thr = p.mae.div(p.margin).mul(100);
        p.dynamic = { armedTime: t, trigger: byCushion ? 'ACCOUNT_CUSHION' : 'LIQUIDITY_POOL_BREAK', thresholdPct: thr.toNumber(),
          stopPrice: p.fill.minus(p.mae.div(p.q).mul(p.s)).toNumber(), cushionPct: cushion.mul(100).toNumber(), pool: p.pool, closeAtArm: close };
      }
    }
    // 5) entries at this candle's close
    for (const e of entries.get(t) ?? []) {
      if (opens.some((p) => p.e.symbol === e.symbol)) { skips.COIN_ALREADY_OPEN++; continue; }
      if (opens.length >= PR.slots) { skips.ALL_SLOTS_IN_USE++; continue; }
      const margin = wallet.mul(PR.marginShare).toDecimalPlaces(8); const notional = margin.mul(PR.leverage); const fee = notional.mul(PR.feeRate);
      const upnl = opens.reduce((a, p) => a.minus(lossAt(p, last(p.e.symbol, t).close)), ZERO);
      const available = wallet.plus(Decimal.min(upnl, 0)).minus(opens.reduce((a, p) => a.plus(p.margin), ZERO));
      if (margin.lte(0) || available.lt(margin.plus(fee))) { skips.INSUFFICIENT_BALANCE++; continue; }
      const s = e.side === 'LONG' ? 1 : -1; const slip = D(slipOf(e.price, e.tick)); const pe = D(e.price);
      const fill = pe.plus(slip.mul(s)); const q = notional.div(pe);
      const p: Pos = { e, s, q, margin, notional, fill, slip, target: targetPrice(e.side, pe, slip), entryFee: fee, funding: ZERO, balanceBefore: wallet,
        mae: ZERO, maeTime: null, crossedTime: Object.fromEntries(PR.marks.map((k) => [k, null])), thresholdCross: null, dynamic: null, pool: null };
      p.pool = poolAt(m, e, fill.toNumber());
      wallet = wallet.minus(fee); opens.push(p);
    }
    // 6) equity, drawdown and slot statistics
    let eqC = wallet; let eqW = wallet;
    for (const p of opens) { const c = last(p.e.symbol, t); eqC = eqC.minus(lossAt(p, c.close)); eqW = eqW.minus(lossAt(p, p.s === 1 ? c.low : c.high)); }
    if (eqC.gt(peak)) peak = eqC;
    if (peak.gt(0)) { ddClose = Decimal.max(ddClose, peak.minus(eqC).div(peak)); ddBar = Decimal.max(ddBar, peak.minus(eqW).div(peak)); }
    if (opens.length >= PR.slots) minutesAll++; slotMinutes += opens.length;
  }
  const lastT = o.to - MINUTE; let equityEnd = wallet;
  for (const p of opens) { const c = last(p.e.symbol, lastT); const u = lossAt(p, c.close).neg(); equityEnd = equityEnd.plus(u);
    out.push(record(p, { reason: 'UNRESOLVED', pnl: p.entryFee.plus(p.funding).neg().toNumber(), unrealizedAtEnd: u.toNumber() })); }
  return { trades: out, wallet: wallet.toNumber(), equityEnd: equityEnd.toNumber(), maxDdClosePct: ddClose.mul(100).toNumber(), maxDdIntrabarPct: ddBar.mul(100).toNumber(),
    skips, minutes, minutesAllSlots: minutesAll, slotMinutes, liquidationEvents: liqEvents, ambiguousCandles: ambiguous, markFallbacks };
}

/** Standalone path study: one signal followed alone from entry until its TP or the end of the window (no exits, no account). */
export function pathStudy(m: Market, e: Entry, to: number) {
  const s = e.side === 'LONG' ? 1 : -1; const slip = slipOf(e.price, e.tick); const fill = e.price + s * slip; const target = targetPrice(e.side, e.price, slip).toNumber();
  const marginMove = e.price / PR.leverage; // price move equal to 100% of initial margin
  let mae = 0; let maeTime: number | null = null; let tpTime: number | null = null; const cross: Record<number, number | null> = Object.fromEntries(PR.marks.map((k) => [k, null]));
  for (let t = e.time + MINUTE; t < to; t += MINUTE) {
    const c = m.last.get(e.symbol)!.get(t)!; const worst = s === 1 ? c.low : c.high; const loss = (fill - worst) * s / marginMove * 100;
    if (loss > mae) { mae = loss; maeTime = t; }
    for (const k of PR.marks) if (cross[k] === null && loss >= k) cross[k] = t;
    if (s === 1 ? c.high >= target : c.low <= target) { tpTime = t; break; }
  }
  return { maePct: mae, maeTime, tpTime, cross };
}
