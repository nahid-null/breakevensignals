/**
 * RobotCore: the complete paper pipeline without I/O, shared by the live worker, the replay/backtest and the tests.
 * Market data -> analysis -> signal -> validation -> opportunity queue -> simulated order -> fill -> monitoring -> exit -> next opportunity.
 */
import { MINUTE, SymbolState, type Bar } from './series';
import { evaluate, evaluateLegacy, maxStopFraction, type BookContext, type Candidate, type Direction, type Evaluation } from './strategy';
import { allocationLimits, DEFAULT_RULES, planMargin, portfolioGate, riskMarginCap, sizeOrder, type ClosedResult, type OpenExposure, type SymbolRules } from './risk';
import { managePosition, manageTick, openPosition, simulateMarketFill, type DepthBook, type Fill, type Position } from './paper';
import { groupOf, type RobotSettings } from './config';

export const WARMUP_BARS = 900;
/** A qualified setup stays executable for two minutes after its 1m signal bar closed. */
export const QUEUE_TTL_MS = 3 * MINUTE;
export const NO_BOOK: BookContext = { spreadBps: null, imbalance: null, depthUsd: null };

export type Counters = {
  evaluated: number; long_candidates: number; short_candidates: number; rejected: number; qualified: number;
  orders_submitted: number; orders_partial: number; orders_rejected: number;
  reasons: Record<string, number>; exec_failures: Record<string, number>; setups: Record<string, { seen: number; qualified: number }>;
};
export const emptyCounters = (): Counters => ({ evaluated: 0, long_candidates: 0, short_candidates: 0, rejected: 0, qualified: 0,
  orders_submitted: 0, orders_partial: 0, orders_rejected: 0, reasons: {}, exec_failures: {}, setups: {} });
export type SignalLog = { id: string; candidate: Candidate; decision: 'TAKEN' | 'SKIPPED' | 'REJECTED'; reason: string | null };
export type Queued = { c: Candidate; rank: number; expires: number; spreadBps: number | null; lastReason: string | null };
export type Note = { long: string | null; short: string | null; longScore: number | null; shortScore: number | null };
export type PositionFill = { position: Position; fill: Fill };
export type CandleDecision = { symbol: string; direction: Direction; time: number; decision: 'QUALIFIED' | 'REJECTED'; reason: string; score: number | null; audit: Candidate['audit'] | null };

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
/** Collapse score-specific reasons so the diagnostic table groups them. */
export const reasonKey = (r: string) => r.startsWith('Score ') ? 'Score below threshold' : r.startsWith('Structural stop too wide') ? 'Structural stop too wide for 50x'
  : r.startsWith('Retracement ') && r.includes('outside OTE') ? 'Retracement outside the OTE band'
  : r.startsWith('Waiting for bullish MSS') ? 'Waiting for bullish MSS' : r.startsWith('Waiting for bearish MSS') ? 'Waiting for bearish MSS' : r;
export const exposure = (open: Position[]): OpenExposure[] => open.filter((p) => p.status === 'OPEN')
  .map((p) => ({ symbol: p.symbol, direction: p.direction, margin: p.margin, notional: p.qtyOpen * p.entry }));
export const signalId = (c: Pick<Candidate, 'symbol' | 'direction' | 'time'>) => `${c.symbol}-${c.direction}-${c.time + MINUTE}`;

export class RobotCore {
  readonly states = new Map<string, SymbolState>();
  readonly rules = new Map<string, SymbolRules>();
  readonly notes = new Map<string, Note>();
  readonly queue = new Map<string, Queued>();
  open: Position[] = [];
  counters = emptyCounters();
  signals: SignalLog[] = [];
  decisions: CandleDecision[] = [];
  /** Recently closed results (newest last) for the optional loss limits. */
  history: ClosedResult[] = [];
  /** Entry evaluator; replays may swap in an archived one for comparison. */
  evaluator: (st: SymbolState, d: Direction, s: RobotSettings, b: BookContext) => Evaluation = evaluate;
  constructor(public settings: RobotSettings, private readonly legacyComparison = false) {}

  addSymbol(symbol: string, rules: SymbolRules = DEFAULT_RULES) {
    this.states.set(symbol, new SymbolState(symbol, rules.tickSize)); this.rules.set(symbol, rules);
  }

  /** Consume one closed 1m bar. Live bars are evaluated and can queue entries; replayed bars only rebuild state and manage positions. */
  onBar(symbol: string, bar: Bar, live: boolean, book: BookContext = NO_BOOK): { accepted: boolean; fills: PositionFill[]; evals: Evaluation[] } {
    const st = this.states.get(symbol);
    if (!st || !st.update(bar)) return { accepted: false, fills: [], evals: [] };
    const fills: PositionFill[] = [];
    for (const p of this.open) if (p.symbol === symbol && p.status === 'OPEN') for (const f of managePosition(p, bar, st, this.settings)) fills.push({ position: p, fill: f });
    if (st.count < WARMUP_BARS) return { accepted: true, fills, evals: [] };
    const evals = (['LONG', 'SHORT'] as Direction[]).map((d) => (this.legacyComparison ? evaluateLegacy : this.evaluator)(st, d, this.settings, book));
    const note: Note = { long: null, short: null, longScore: null, shortScore: null };
    for (const e of evals) {
      const key = e.direction === 'LONG' ? 'long' : 'short';
      note[key] = e.rejected ?? `Qualified ${e.candidate!.tier === 'STRONG' ? 'strong ' : ''}${e.candidate!.setup.replace(/_/g, ' ').toLowerCase()}`;
      note[`${key}Score`] = e.candidate?.score ?? null;
      if (!live) continue;
      this.decisions.push({ symbol, direction: e.direction, time: bar.time, decision: e.rejected ? 'REJECTED' : 'QUALIFIED',
        reason: e.rejected ?? e.candidate?.liquidity ?? 'Qualified setup', score: e.candidate?.score ?? null, audit: e.candidate?.audit ?? null });
      this.counters.evaluated++;
      if (e.candidate) {
        if (e.direction === 'LONG') this.counters.long_candidates++; else this.counters.short_candidates++;
        const k = this.counters.setups[e.candidate.setup] ??= { seen: 0, qualified: 0 }; k.seen++; if (!e.rejected) k.qualified++;
      }
      if (e.rejected) {
        this.counters.rejected++; bump(this.counters.reasons, reasonKey(e.rejected));
        if (e.candidate && e.candidate.score >= 60) this.signals.push({ id: signalId(e.candidate), candidate: e.candidate, decision: 'REJECTED', reason: e.rejected });
        continue;
      }
      const c = e.candidate!;
      this.counters.qualified++;
      this.queue.set(`${c.symbol}|${c.direction}`, { c, rank: this.rank(c, book), expires: c.time + QUEUE_TTL_MS, spreadBps: book.spreadBps, lastReason: null });
      this.signals.push({ id: signalId(c), candidate: c, decision: 'SKIPPED', reason: 'Queued for execution' });
    }
    this.notes.set(symbol, note);
    return { accepted: true, fills, evals };
  }

  onTick(symbol: string, bid: number, ask: number, time: number): PositionFill[] {
    const out: PositionFill[] = [];
    for (const p of this.open) if (p.symbol === symbol && p.status === 'OPEN') for (const f of manageTick(p, bid, ask, time, this.settings)) out.push({ position: p, fill: f });
    return out;
  }

  /** Ranking: quality first, then liquidity, spread, volatility fit, risk distance and correlated exposure. */
  rank(c: Candidate, book: BookContext) {
    const st = this.states.get(c.symbol)!; const qv = st.quoteVolume24h;
    const groupOpen = this.open.some((p) => p.status === 'OPEN' && groupOf(p.symbol) === groupOf(c.symbol));
    return c.score + (qv >= 100e6 ? 3 : qv >= 20e6 ? 1.5 : 0) - (book.spreadBps ?? 2) * 0.5 + (c.atrPct >= 0.15 && c.atrPct <= 0.8 ? 2 : 0)
      + 5 * (1 - c.stopPct / maxStopFraction(this.settings)) - (groupOpen ? 6 : 0);
  }

  /** Drop expired entries (logging why they never executed) and return the rest best-first. */
  rankedQueue(now: number): Queued[] {
    for (const [k, q] of this.queue) if (q.expires <= now) {
      this.queue.delete(k);
      this.signals.push({ id: signalId(q.c), candidate: q.c, decision: 'SKIPPED', reason: `Expired: ${q.lastReason ?? 'no slot or margin in time'}` });
    }
    return [...this.queue.values()].sort((a, b) => b.rank - a.rank);
  }

  /** Next queue entry that passes the portfolio gates, recording the reason on every entry it passes over. */
  nextCandidate(now: number, balance: number): Queued | null {
    for (const q of this.rankedQueue(now)) {
      const gate = portfolioGate(q.c, exposure(this.open), balance, this.settings, this.history, now);
      const margin = gate ? null : planMargin(q.c, balance, exposure(this.open), this.settings);
      const reason = gate ?? (margin !== null && typeof margin === 'object' ? margin.rejected : null);
      if (!reason) return q;
      q.lastReason = reason;
    }
    return null;
  }

  /**
   * Validate against the current price, size at exactly 50x, simulate the market fill through the book and build the position.
   * The caller only treats the position as open after the database confirms the commit.
   */
  execute(q: Queued, depth: DepthBook, balance: number, now: number): PositionFill | { rejected: string } {
    const c = q.c; const sign = c.direction === 'LONG' ? 1 : -1; const rules = this.rules.get(c.symbol) ?? DEFAULT_RULES;
    this.counters.orders_submitted++;
    const fail = (why: string) => { this.counters.orders_rejected++; bump(this.counters.exec_failures, why); this.queue.delete(`${c.symbol}|${c.direction}`);
      this.signals.push({ id: signalId(c), candidate: c, decision: 'REJECTED', reason: `Execution: ${why}` }); return { rejected: why }; };
    const bid = depth.bids[0]?.[0]; const ask = depth.asks[0]?.[0];
    if (!bid || !ask || ask < bid) return fail('No valid order book');
    if (!this.legacyComparison) {
      const age = now - (c.time + MINUTE);
      if (age < 0 || age > this.settings.entry_max_age_ms || now >= q.expires) return fail('Stale entry signal');
      if (depth.receivedAt === undefined || now < depth.receivedAt || now - depth.receivedAt > this.settings.quote_max_age_ms) return fail('Stale or unverified order book');
      if ((ask - bid) / ((ask + bid) / 2) * 10_000 > this.settings.max_spread_bps) return fail('Abnormal spread at execution');
      const gate = portfolioGate(c, exposure(this.open), balance, this.settings, this.history, now);
      if (gate) return fail(gate);
    }
    const touch = sign > 0 ? ask : bid;
    const drift = this.legacyComparison ? 0.3 : this.settings.max_entry_drift_atr;
    if (Math.abs(touch - c.entry) > drift * c.atr) return fail('Price moved away before fill');
    const a = c.audit; const smc = a?.zone_low !== undefined && a.zone_high !== undefined;
    if (smc) {
      // Simulated limit order at the confirmed zone: only fill while price is still at the zone, otherwise cancel instead of chasing.
      const far = sign > 0 ? a!.zone_low! : a!.zone_high!; const near = sign > 0 ? a!.zone_high! : a!.zone_low!;
      if ((touch - far) * sign <= 0) return fail('Price broke through the entry zone — setup cancelled');
      if ((touch - near) * sign > drift * c.atr) return fail('Price left the entry zone — setup cancelled, not chasing');
    } else if (a && (touch - a.pool_price) * sign <= 0) return fail('Reclaim lost before execution');
    if ((touch - c.stop) * sign < 0.3 * c.atr) return fail('Price too close to stop at fill time');
    if (((touch - c.stop) * sign) / touch > maxStopFraction(this.settings)) return fail('Stop too wide at fill price');
    const planned = planMargin(c, balance, exposure(this.open), this.settings);
    if (typeof planned === 'object') return fail(planned.rejected);
    // Size from the maximum permitted dollar risk at the structural stop (50x stays fixed; only the margin shrinks).
    const cap = this.legacyComparison ? Infinity : riskMarginCap(balance, touch, c.stop, this.settings);
    const margin = Math.min(planned, cap);
    const sized = sizeOrder(margin, touch, rules);
    if ('rejected' in sized) return fail(sized.rejected);
    const fill = simulateMarketFill(c.direction, sized.qty, depth, this.settings, rules);
    if ('rejected' in fill) return fail(fill.rejected);
    if (!this.legacyComparison) {
      if (Math.abs(fill.avg - c.entry) > drift * c.atr) return fail('Final fill would chase signal');
      if (c.audit && !smc && (fill.avg - c.audit.pool_price) * sign <= 0) return fail('Final fill invalidates reclaim');
      if (smc && (fill.avg - (sign > 0 ? a!.zone_low! : a!.zone_high!)) * sign <= 0) return fail('Final fill outside the entry zone');
      const riskFraction = (fill.avg - c.stop) * sign / fill.avg + 2 * this.settings.fee_pct / 100 + 2 * this.settings.slippage_bps / 10_000;
      if (c.audit && 0.1 / 50 / riskFraction < this.settings.min_reward_risk) return fail('Net reward too small at executable fill');
    }
    const opened = openPosition({ id: signalId(c), symbol: c.symbol, direction: c.direction, setup: c.setup, score: c.score, tier: c.tier, stop: c.stop, liquidity: c.liquidity },
      fill, rules, now, this.settings);
    if ('rejected' in opened) return fail(opened.rejected);
    if (c.audit) {
      if (c.audit.opposing_level !== null && (c.audit.opposing_level - opened.position.tp) * sign < 0.05 * c.atr) return fail('Opposing liquidity too close at final fill');
      opened.position.audit = { ...c.audit, source: depth.source ?? 'LIVE_BINANCE', bid, ask, spread_bps: (ask - bid) / ((ask + bid) / 2) * 10_000,
        quote_received_at: depth.receivedAt, fill_at: now, delay_ms: now - c.audit.signal_close_at, fill_price: fill.avg,
        slippage_bps: (fill.avg / touch - 1) * sign * 10_000, signal_drift_bps: (fill.avg / c.entry - 1) * sign * 10_000,
        entry_fee: opened.position.entryFee, estimated_exit_fee: (sign > 0 ? bid : ask) * fill.qty * this.settings.fee_pct / 100,
        requested_quantity: sized.qty, filled_quantity: fill.qty, depth_levels: fill.levels, ...(Number.isFinite(cap) ? { risk_margin_cap: cap } : {}) };
    }
    // Set immediate liquidation-value PnL on the actual exit side, including spread and estimated costs.
    manageTick(opened.position, bid, ask, now, this.settings);
    if (opened.position.status !== 'OPEN') return fail('Entry quote already crosses protective exit');
    if (opened.position.audit) opened.position.audit.initial_net_roi_pct = (opened.position.realized + opened.position.unrealized) / opened.position.margin * 100;
    // The cap is checked against the balance after the entry fee, so combined margin never exceeds 70% at any moment.
    const { available } = allocationLimits(balance - opened.position.entryFee, exposure(this.open), this.settings);
    if (opened.position.margin > available + 1e-9) return fail('Margin budget full (70% cap)');
    if (fill.partial) this.counters.orders_partial++;
    this.queue.delete(`${c.symbol}|${c.direction}`);
    return opened;
  }

  /** Called after the database confirmed (or refused) an open. */
  confirmOpen(r: PositionFill, c: Candidate, ok: boolean, reason?: string) {
    if (ok) { this.open.push(r.position); this.signals.push({ id: r.position.id, candidate: c, decision: 'TAKEN', reason: r.position.fillStatus === 'PARTIAL' ? 'Partial fill' : null }); }
    else { this.counters.orders_rejected++; bump(this.counters.exec_failures, `Database: ${reason ?? 'rejected'}`);
      this.signals.push({ id: r.position.id, candidate: c, decision: 'REJECTED', reason: `Database guard: ${reason ?? 'rejected'}` }); }
  }

  takeCounters(): Counters { const c = this.counters; this.counters = emptyCounters(); return c; }
  takeSignals(max = 100): SignalLog[] { return this.signals.splice(0, max); }
  takeDecisions(max = 120): CandleDecision[] { return this.decisions.splice(0,max); }
}
