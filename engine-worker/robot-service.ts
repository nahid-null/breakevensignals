/**
 * PAPER ROBOT: runs alongside the existing signal engine in the same worker and lease.
 * Simulated orders only — this module never places exchange orders.
 * Live closed 1m candles and best bid/ask come from Binance public streams; the pipeline itself lives in RobotCore.
 */
import WebSocket from './websocket';
import { BINANCE_WS, BinanceRequestError, binanceFetch, checkWebSocketAccess, delay, backoff, restCandle } from './binance';
import { DEFAULT_SETTINGS, PAPER_LEVERAGE, ROBOT_SYMBOLS, TARGET_NET_ROI_PCT, type RobotSettings } from '../src/lib/robot/config';
import { MINUTE, type Bar } from '../src/lib/robot/series';
import { RobotCore, WARMUP_BARS, emptyCounters, signalId, type Counters, type PositionFill } from '../src/lib/robot/engine';
import type { DepthBook, Fill, Position } from '../src/lib/robot/paper';
import { DEFAULT_RULES, rulesFromFilters } from '../src/lib/robot/risk';
import type { BookContext, Candidate } from '../src/lib/robot/strategy';
import type { RobotCommit, RobotCommitResult } from '../src/lib/robot/protocol';

type Row = Record<string, unknown>;
type Book = { bid: number; ask: number; bidQty: number; askQty: number; at: number };
const LIVE_BAR_MAX_AGE = 2 * MINUTE;
const num = (v: unknown) => Number(v);
const iso = (t: number) => new Date(t).toISOString();

export function positionFromRow(r: Row): Position {
  const entry = num(r.entry_price); const qty = num(r.quantity);
  return { id: String(r.id), symbol: String(r.symbol), direction: r.direction as Position['direction'], status: r.status as Position['status'],
    setup: r.setup as Position['setup'], score: num(r.score), leverage: num(r.leverage), band: String(r.band), entry, qty, qtyOpen: num(r.quantity_open),
    margin: num(r.margin), notional: num(r.notional), stop: num(r.stop_loss), initialStop: num(r.initial_stop), tp: num(r.tp1), liquidation: num(r.liquidation_price),
    riskUsdt: num(r.risk_usdt), entryFee: num(r.entry_fee ?? 0), fees: num(r.fees), funding: num(r.funding ?? 0), fundingApplied: 0, realized: num(r.realized_pnl),
    openedAt: Date.parse(String(r.opened_at)), closedAt: null, exitPrice: null, exitReason: null, lastCandleTime: num(r.last_candle_time), version: num(r.version),
    liquidity: String(r.liquidity ?? ''), lastPrice: num(r.last_price ?? entry), unrealized: num(r.unrealized_pnl), tick: num(r.tick_size) || DEFAULT_RULES.tickSize,
    requestedQty: num(r.requested_quantity ?? qty), fillStatus: r.fill_status === 'PARTIAL' ? 'PARTIAL' : 'FILLED' };
}

export function settingsFromRow(row: Row): RobotSettings {
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, d]) => [k, row[k] === undefined || row[k] === null ? d
    : typeof d === 'boolean' ? Boolean(row[k]) : num(row[k])])) as RobotSettings;
}

function addCounters(a: Counters, b: Counters): Counters {
  const out = emptyCounters();
  for (const k of ['evaluated', 'long_candidates', 'short_candidates', 'rejected', 'qualified', 'orders_submitted', 'orders_partial', 'orders_rejected'] as const) out[k] = a[k] + b[k];
  for (const k of ['reasons', 'exec_failures'] as const) for (const src of [a[k], b[k]]) for (const [r, n] of Object.entries(src)) out[k][r] = (out[k][r] ?? 0) + n;
  for (const src of [a.setups, b.setups]) for (const [r, n] of Object.entries(src)) { const o = out.setups[r] ??= { seen: 0, qualified: 0 }; o.seen += n.seen; o.qualified += n.qualified; }
  return out;
}

export class RobotService {
  readonly core = new RobotCore({ ...DEFAULT_SETTINGS });
  private books = new Map<string, Book>();
  private queues = new Map<string, Bar[]>();
  private warm = new Set<string>();
  /** Last version the database confirmed per position, and fills not yet saved. */
  private committed = new Map<string, number>();
  private pendingFills = new Map<string, Fill[]>();
  private notify = new Map<string, boolean>();
  private balance = 0;
  private socket: WebSocket | null = null;
  private bookSocket: WebSocket | null = null;
  private bookTimer: ReturnType<typeof setTimeout> | null = null;
  private decideTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false; private paused = false; private failures = 0; private checking = false;
  private draining = false; private flushing = false; private executing = false; private rerun = false;
  private lastLiveBar = new Map<string, number>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly abort = new AbortController();
  private unavailable: string[] = [];

  constructor(private readonly appUrl: string, private readonly secret: string, private readonly instance: () => string,
    private readonly ownsLease: () => boolean, private readonly marketPaused: () => boolean, private readonly observeOnly = false) {}

  private async app<T>(action: string, data: unknown): Promise<T> {
    if (this.observeOnly) throw new Error('Observation only');
    const r = await fetch(`${this.appUrl}/api/public/engine`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}` },
      body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`App rejected ${action} (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return r.json() as Promise<T>;
  }
  private active() { return this.running && !this.paused && !this.marketPaused() && this.ownsLease(); }

  async start() {
    if (this.running) return;
    this.running = true;
    while (this.running && !this.ownsLease()) await delay(1000);
    if (!this.running) return;
    try {
      const info = await binanceFetch('/fapi/v1/exchangeInfo', this.abort.signal) as { symbols?: { symbol: string; status: string; filters: Parameters<typeof rulesFromFilters>[0] }[] };
      for (const symbol of ROBOT_SYMBOLS) {
        const c = info.symbols?.find((s) => s.symbol === symbol && s.status === 'TRADING');
        if (c) this.core.addSymbol(symbol, rulesFromFilters(c.filters)); else this.unavailable.push(symbol);
      }
      await this.refresh();
      await this.loadFunding().catch((e) => this.fail(e));
      this.connect();
      this.connectBook();
      this.timers.push(setInterval(() => { void this.flush().catch((e) => this.fail(e)); }, 5000));
      this.timers.push(setInterval(() => { void this.refresh().catch((e) => this.fail(e)); }, 15_000));
      this.timers.push(setInterval(() => { void this.loadFunding().catch((e) => this.fail(e)); }, 5 * MINUTE));
      for (const symbol of this.core.states.keys()) {
        if (!this.active()) return;
        await this.warmUp(symbol);
        await delay(250); // Stay far below Binance request-weight limits during warm-up.
      }
      console.log(`PAPER ROBOT warmed up: ${this.warm.size}/${ROBOT_SYMBOLS.length} coins at fixed ${PAPER_LEVERAGE}x. Simulated orders only.`);
    } catch (e) { this.fail(e); }
  }

  /** Load the latest durable settings, account and positions. The database is the source of truth. */
  private async refresh() {
    if (this.observeOnly || !this.ownsLease()) return;
    const r = await this.app<{ settings: Row; account: Row; open: Row[] }>('robot-state', {});
    this.core.settings = settingsFromRow(r.settings);
    const durable = new Map(r.open.map((row) => [String(row.id), row]));
    // Keep local positions with unsaved changes; drop any closed elsewhere (for example by STOP ALL).
    this.core.open = this.core.open.filter((p) => durable.has(p.id) || p.version > (this.committed.get(p.id) ?? 0));
    for (const [id, row] of durable) if (!this.core.open.some((p) => p.id === id)) {
      const p = positionFromRow(row); this.core.open.push(p); this.committed.set(id, p.version);
    }
    for (const id of [...this.committed.keys()]) if (!this.core.open.some((p) => p.id === id)) this.committed.delete(id);
    this.balance = num(r.account.balance);
  }

  private async loadFunding() {
    const rows = await binanceFetch('/fapi/v1/premiumIndex', this.abort.signal) as { symbol: string; lastFundingRate: string; nextFundingTime: number }[];
    if (!Array.isArray(rows)) return;
    for (const r of rows) { const st = this.core.states.get(r.symbol); const rate = Number(r.lastFundingRate);
      if (st && Number.isFinite(rate) && r.nextFundingTime > 0) st.funding = { rate, next: r.nextFundingTime }; }
  }

  private async loadBars(symbol: string, start: number | undefined, end: number, limit = 1500): Promise<Bar[]> {
    const q = new URLSearchParams({ symbol, interval: '1m', limit: String(limit), endTime: String(end) });
    if (start !== undefined) q.set('startTime', String(start));
    const rows = await binanceFetch(`/fapi/v1/klines?${q}`, this.abort.signal);
    if (!Array.isArray(rows)) throw new Error('Malformed Binance history');
    return rows.map((row) => restCandle(row)).filter((c) => c.time + MINUTE <= Date.now());
  }

  /** Rebuild indicators from REST history. Positions are managed through the gap, but those fills are never announced as live. */
  private async warmUp(symbol: string) {
    const bars = await this.loadBars(symbol, undefined, Date.now(), Math.min(1500, WARMUP_BARS + 300));
    for (const b of bars) this.step(symbol, b, false);
    this.warm.add(symbol);
    void this.drain();
  }

  private record(list: PositionFill[], live: boolean) {
    for (const { position: p, fill } of list) {
      const arr = this.pendingFills.get(p.id) ?? []; arr.push(fill); this.pendingFills.set(p.id, arr);
      this.notify.set(p.id, (this.notify.get(p.id) ?? true) && live);
      if (fill.kind === 'CLOSE') console.log(JSON.stringify({ event: 'robot_paper_close', id: p.id, reason: fill.reason, pnl: Number(p.realized.toFixed(4)) }));
    }
    if (list.some((x) => x.fill.kind === 'CLOSE')) void this.flush().catch((e) => this.fail(e));
  }

  private step(symbol: string, bar: Bar, live: boolean) {
    const fresh = live && Date.now() - (bar.time + MINUTE) <= LIVE_BAR_MAX_AGE;
    const { accepted, fills } = this.core.onBar(symbol, bar, fresh, this.bookContext(symbol));
    if (!accepted) return;
    this.record(fills, live);
    if (live) this.lastLiveBar.set(symbol, bar.time);
    // Decide once the minute's bars from all coins have arrived.
    if (fresh && !this.decideTimer) this.decideTimer = setTimeout(() => { this.decideTimer = null; void this.fillQueue('new candle'); }, 3000);
  }

  private bookContext(symbol: string): BookContext {
    const b = this.books.get(symbol);
    if (!b || Date.now() - b.at > 30_000) return { spreadBps: null, imbalance: null, depthUsd: null };
    const mid = (b.bid + b.ask) / 2;
    return { spreadBps: ((b.ask - b.bid) / mid) * 10_000, imbalance: (b.bidQty - b.askQty) / Math.max(1e-12, b.bidQty + b.askQty), depthUsd: null };
  }

  /** Public order book snapshot used to simulate the market fill level by level. */
  private async depth(symbol: string): Promise<DepthBook> {
    const d = await binanceFetch(`/fapi/v1/depth?symbol=${symbol}&limit=50`, this.abort.signal) as { bids?: [string, string][]; asks?: [string, string][] };
    const bids = (d.bids ?? []).map(([p, q]) => [Number(p), Number(q)] as const).filter(([p, q]) => p > 0 && q > 0);
    const asks = (d.asks ?? []).map(([p, q]) => [Number(p), Number(q)] as const).filter(([p, q]) => p > 0 && q > 0);
    if (bids[0] && asks[0]) this.books.set(symbol, { bid: bids[0][0], ask: asks[0][0], bidQty: bids[0][1], askQty: asks[0][1], at: Date.now() });
    return { bids, asks };
  }

  /** Opportunity queue: open the best qualified setups while slots and margin remain. Runs after each minute and after every close. */
  private async fillQueue(trigger: string) {
    if (this.executing) { this.rerun = true; return; }
    if (!this.active() || this.observeOnly) return;
    this.executing = true;
    try {
      for (let k = 0; k < this.core.settings.max_concurrent; k++) {
        const q = this.core.nextCandidate(Date.now(), this.balance);
        if (!q) break;
        const depth = await this.depth(q.c.symbol);
        const res = this.core.execute(q, depth, this.balance, Date.now());
        if ('rejected' in res) continue;
        const r = await this.app<RobotCommitResult>('robot-commit', { instance_id: this.instance(), opens: [this.openRow(res, q.c)] });
        if (r.paused) break;
        const ok = r.opened?.includes(res.position.id) ?? false;
        this.core.confirmOpen(res, q.c, ok, r.rejected?.find((x) => x.id === res.position.id)?.reason);
        if (ok) {
          this.committed.set(res.position.id, 1); this.balance += res.fill.pnl;
          console.log(JSON.stringify({ event: 'robot_paper_open', id: res.position.id, leverage: res.position.leverage, margin: Number(res.position.margin.toFixed(4)), trigger }));
        }
      }
    } catch (e) { this.fail(e); }
    finally { this.executing = false; if (this.rerun) { this.rerun = false; void this.fillQueue('rerun'); } }
  }

  private openRow(r: PositionFill, c: Candidate): RobotCommit['opens'][number] {
    const p = r.position;
    return { id: p.id, symbol: p.symbol, direction: p.direction, setup: c.setup as RobotCommit['opens'][number]['setup'], score: p.score, leverage: PAPER_LEVERAGE,
      band: p.band.slice(0, 60), entry_price: p.entry, quantity: p.qty, requested_quantity: p.requestedQty, fill_status: p.fillStatus, margin: p.margin,
      notional: p.notional, stop_loss: p.stop, tp1: p.tp, tp2: p.tp, liquidation_price: p.liquidation, risk_usdt: p.riskUsdt, fees: p.fees, entry_fee: p.entryFee,
      realized_pnl: r.fill.pnl, liquidity: p.liquidity.slice(0, 160), opened_at: iso(p.openedAt), last_candle_time: p.lastCandleTime,
      balance_before: Math.max(0, this.balance), target_roi_pct: TARGET_NET_ROI_PCT, tick_size: p.tick };
  }

  private signalRows(): RobotCommit['signals'] {
    return this.core.takeSignals(100).map(({ id, candidate: c, decision, reason }) => ({ id, symbol: c.symbol, direction: c.direction,
      setup: c.setup as RobotCommit['signals'][number]['setup'], score: Math.max(0, Math.min(100, c.score)), parts: c.parts as unknown as Record<string, number>,
      entry_price: c.entry, stop_loss: c.stop, tp1: c.tp, tp2: c.tp, liquidity: c.liquidity.slice(0, 160), decision, reason: reason?.slice(0, 160) ?? null,
      candle_time: iso(c.time + MINUTE) }));
  }

  private liveCount(now = Date.now()) { return [...this.lastLiveBar.values()].filter((t) => now - (t + MINUTE) < 3 * MINUTE).length; }

  private marketRows(): RobotCommit['markets'] {
    const rows: RobotCommit['markets'] = this.unavailable.map((symbol) => ({ symbol, price: null, spread_bps: null, depth_usd: null, imbalance: null,
      quote_volume_24h: null, trend_1h: null, trend_15m: null, status: 'UNAVAILABLE', liquidity: null, best_direction: null, best_score: null,
      note: 'Not listed as a trading Binance USD-M Futures contract', note_long: null, note_short: null, score_long: null, score_short: null, last_candle_at: null }));
    for (const [symbol, st] of this.core.states) {
      const last = st.m1.last(); const b = this.bookContext(symbol); const n = this.core.notes.get(symbol);
      const liveAt = this.lastLiveBar.get(symbol);
      const status = this.marketPaused() ? 'PAUSED' : !this.warm.has(symbol) || st.count < WARMUP_BARS || !st.ready() ? 'WARMING UP'
        : liveAt !== undefined && Date.now() - (liveAt + MINUTE) < 3 * MINUTE ? 'LIVE' : 'RECOVERING';
      const pools = st.levels.filter((l) => l.tf >= 5 && l.sweptAt === null && last);
      const near = (side: 'high' | 'low') => pools.filter((l) => l.side === side).sort((a, c) => Math.abs(a.price - last!.close) - Math.abs(c.price - last!.close))[0];
      const hi = near('high'); const lo = near('low');
      const book = this.books.get(symbol);
      const ls = n?.longScore ?? null; const ss = n?.shortScore ?? null;
      const bestDir = ls === null && ss === null ? null : (ls ?? -1) >= (ss ?? -1) ? 'LONG' : 'SHORT';
      const clip = (x: number | null) => x === null ? null : Math.max(0, Math.min(100, Math.round(x)));
      rows.push({ symbol, price: book ? Number(((book.bid + book.ask) / 2).toPrecision(10)) : last?.close ?? null,
        spread_bps: b.spreadBps === null ? null : Math.round(b.spreadBps * 100) / 100, depth_usd: null,
        imbalance: b.imbalance === null ? null : Math.max(-1, Math.min(1, Math.round(b.imbalance * 1000) / 1000)), quote_volume_24h: Math.round(st.quoteVolume24h),
        trend_1h: st.m60.ema50.value === null ? null : st.m60.trend(true), trend_15m: st.m15.ema21.value === null ? null : st.m15.trend(false), status,
        liquidity: last && (hi || lo) ? `Buy-side ${hi ? Number(hi.price.toPrecision(8)) : '—'} · Sell-side ${lo ? Number(lo.price.toPrecision(8)) : '—'}` : null,
        best_direction: bestDir, best_score: clip(bestDir === 'LONG' ? ls : ss),
        note: n ? `L: ${n.long ?? '—'} | S: ${n.short ?? '—'}`.slice(0, 160) : null, note_long: n?.long?.slice(0, 160) ?? null, note_short: n?.short?.slice(0, 160) ?? null,
        score_long: clip(ls), score_short: clip(ss), last_candle_at: last ? iso(last.time + MINUTE) : null });
    }
    return rows;
  }

  private scanner(counts: Counters): NonNullable<RobotCommit['scanner']> {
    const now = Date.now(); const lastBar = Math.max(-Infinity, ...this.lastLiveBar.values());
    const setups: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts.setups)) { setups[`${k} seen`] = v.seen; setups[`${k} qualified`] = v.qualified; }
    const trim = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).slice(0, 60).map(([k, v]) => [k.slice(0, 120), v]));
    return { monitored: this.core.states.size, live_feeds: this.liveCount(now), last_candle_at: Number.isFinite(lastBar) ? iso(lastBar + MINUTE) : null,
      queue: this.core.rankedQueue(now).slice(0, 20).map((q) => ({ symbol: q.c.symbol, direction: q.c.direction, setup: q.c.setup as never, score: q.c.score,
        rank: Math.round(q.rank * 100) / 100, expires_at: iso(q.expires), waiting: q.lastReason?.slice(0, 120) ?? null })),
      counts: { evaluated: counts.evaluated, long_candidates: counts.long_candidates, short_candidates: counts.short_candidates, rejected: counts.rejected,
        qualified: counts.qualified, orders_submitted: counts.orders_submitted, orders_partial: counts.orders_partial, orders_rejected: counts.orders_rejected },
      reasons: trim(counts.reasons), exec_failures: trim(counts.exec_failures), setups: trim(setups) };
  }

  /** Save market rows, diagnostics, signal log, mark-to-market and fills in one atomic call. Version checks stop double-applying fills. */
  private async flush() {
    if (this.flushing || this.observeOnly || !this.ownsLease() || this.paused) return;
    this.flushing = true;
    const counts = this.core.takeCounters();
    const signals = this.signalRows();
    try {
      const updates: RobotCommit['updates'] = []; const sent = new Map<string, number>();
      for (const p of this.core.open) {
        const expected = this.committed.get(p.id);
        if (expected === undefined || updates.length >= 20) continue;
        if (p.version <= expected) p.version = expected + 1; // mark-to-market only
        const fills = this.pendingFills.get(p.id) ?? [];
        sent.set(p.id, fills.length);
        updates.push(this.updateRow(p, expected, fills));
      }
      const r = await this.app<RobotCommitResult>('robot-commit', { instance_id: this.instance(), markets: this.marketRows(), updates, signals, scanner: this.scanner(counts) });
      if (r.paused) { this.core.counters = addCounters(this.core.counters, counts); return; }
      let closed = false;
      for (const u of updates) {
        if (!r.applied?.includes(u.id)) continue;
        this.committed.set(u.id, u.version); this.balance += u.pnl_delta;
        const rest = (this.pendingFills.get(u.id) ?? []).slice(sent.get(u.id) ?? 0);
        if (rest.length) this.pendingFills.set(u.id, rest); else { this.pendingFills.delete(u.id); this.notify.delete(u.id); }
        if (u.status === 'CLOSED') { closed = true; this.committed.delete(u.id); this.core.open = this.core.open.filter((p) => p.id !== u.id); }
      }
      if (r.conflicts?.length) {
        this.core.open = this.core.open.filter((p) => !r.conflicts!.includes(p.id));
        for (const id of r.conflicts) { this.committed.delete(id); this.pendingFills.delete(id); }
        await this.refresh();
      }
      if (closed) void this.fillQueue('position closed');
    } catch (e) {
      this.core.counters = addCounters(this.core.counters, counts); this.core.signals.unshift(...[]);
      throw e;
    } finally { this.flushing = false; }
  }

  private updateRow(p: Position, expected: number, fills: Fill[]): RobotCommit['updates'][number] {
    const initialMargin = (p.qty * p.entry) / p.leverage;
    return { id: p.id, symbol: p.symbol, direction: p.direction, expected_version: expected, version: p.version, status: p.status,
      quantity_open: p.qtyOpen, margin: p.status === 'OPEN' ? p.margin : 0, stop_loss: p.stop, tp: p.tp, funding: p.funding,
      net_roi_pct: Math.round(((p.realized + (p.status === 'OPEN' ? p.unrealized : 0)) / initialMargin) * 100 * 100) / 100,
      tp1_done: false, fees: p.fees, realized_pnl: p.realized, unrealized_pnl: p.status === 'OPEN' ? p.unrealized : 0, last_price: p.lastPrice,
      closed_at: p.closedAt === null ? null : iso(p.closedAt), exit_price: p.exitPrice, exit_reason: p.exitReason, last_candle_time: p.lastCandleTime,
      pnl_delta: fills.reduce((a, f) => a + f.pnl, 0), entry_price: p.entry, leverage: PAPER_LEVERAGE, opened_at: iso(p.openedAt),
      fills: fills.filter((f) => f.kind === 'CLOSE').map((f) => ({ kind: 'CLOSE' as const, price: f.price, qty: f.qty, pnl: f.pnl, fee: f.fee,
        reason: (f.reason ?? 'TAKE_PROFIT') as never, time: Math.round(f.time) })), notify: this.notify.get(p.id) ?? false };
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (const [sym, q] of this.queues) {
        if (!this.warm.has(sym)) continue;
        const st = this.core.states.get(sym)!;
        while (q.length && this.active()) {
          const bar = q.shift()!;
          if (st.lastTime !== null && bar.time <= st.lastTime) continue;
          if (st.lastTime !== null && bar.time > st.lastTime + MINUTE) {
            // Fill a gap from REST before the live bar; gap bars are processed but never trigger entries.
            const gap = await this.loadBars(sym, st.lastTime + MINUTE, bar.time - 1);
            for (const g of gap) this.step(sym, g, false);
          }
          this.step(sym, bar, true);
        }
      }
    } finally { this.draining = false; }
  }

  private connect() {
    if (!this.active()) return;
    const streams = [...this.core.states.keys()].map((s) => `${s.toLowerCase()}@kline_1m`).join('/');
    const ws = new WebSocket(`${BINANCE_WS}${streams}`);
    this.socket = ws;
    ws.on('open', () => { this.failures = 0; console.log('PAPER ROBOT market stream connected'); });
    ws.on('message', (raw) => {
      if (this.socket !== ws || !this.active()) return;
      try {
        const msg = JSON.parse(raw.toString()) as { data?: { s?: string; k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean; i?: string } } };
        const d = msg.data; const symbol = d?.s;
        if (!d || !symbol || !this.core.states.has(symbol)) return;
        const k = d.k;
        if (!k || !k.x || (k.i !== undefined && k.i !== '1m')) return;
        const bar = restCandle([k.t, k.o, k.h, k.l, k.c, k.v, 0]);
        if (bar.time + MINUTE > Date.now() + 5000) return;
        const q = this.queues.get(symbol) ?? [];
        if (!q.some((x) => x.time === bar.time)) q.push(bar);
        this.queues.set(symbol, q.sort((a, b) => a.time - b.time).slice(-200));
        void this.drain().catch((e) => this.fail(e));
      } catch (e) { this.fail(e); }
    });
    ws.on('error', () => {
      if (this.socket === ws && !this.checking) {
        this.checking = true;
        void checkWebSocketAccess(streams, this.abort.signal).catch((e) => this.fail(e)).finally(() => { this.checking = false; });
      }
      ws.terminate();
    });
    ws.on('close', () => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (!this.active()) return;
      const wait = backoff(this.failures++);
      const again = () => { if (this.checking) { this.reconnectTimer = setTimeout(again, 500); return; } this.connect(); };
      this.reconnectTimer = setTimeout(again, wait);
    });
  }

  /** Best bid/ask on Binance's public stream: spread data plus real-time stop / take-profit checks for open positions. */
  private connectBook() {
    if (!this.active()) return;
    const streams = [...this.core.states.keys()].map((s) => `${s.toLowerCase()}@bookTicker`).join('/');
    const ws = new WebSocket(`${BINANCE_WS.replace('/market/', '/public/')}${streams}`);
    this.bookSocket = ws;
    ws.on('message', (raw) => {
      if (this.bookSocket !== ws || !this.active()) return;
      try {
        const d = (JSON.parse(raw.toString()) as { data?: { s?: string; b?: string; a?: string; B?: string; A?: string } }).data;
        if (!d?.s || !this.core.states.has(d.s)) return;
        const bid = Number(d.b); const ask = Number(d.a);
        if (!(bid > 0 && ask >= bid)) return;
        this.books.set(d.s, { bid, ask, bidQty: Number(d.B), askQty: Number(d.A), at: Date.now() });
        if (this.core.open.some((p) => p.symbol === d.s && p.status === 'OPEN')) this.record(this.core.onTick(d.s, bid, ask, Date.now()), true);
      } catch { /* malformed frame ignored; spread falls back to unknown */ }
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      if (this.bookSocket !== ws) return;
      this.bookSocket = null;
      if (this.active()) this.bookTimer = setTimeout(() => this.connectBook(), backoff(this.failures));
    });
  }

  private fail(e: unknown) {
    if (e instanceof BinanceRequestError && e.pausesMarket) {
      // Never retry around a 451/418. The signal engine reports the restriction in health.
      this.paused = true; this.abort.abort(); this.socket?.terminate(); this.socket = null; this.bookSocket?.terminate(); this.bookSocket = null;
      console.error('PAPER ROBOT paused: Binance restricted market access.');
      return;
    }
    console.error('PAPER ROBOT error:', e instanceof Error ? e.message.slice(0, 300) : 'unknown');
  }

  async stop() {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.bookTimer) clearTimeout(this.bookTimer);
    if (this.decideTimer) clearTimeout(this.decideTimer);
    this.abort.abort(); this.socket?.terminate(); this.socket = null; this.bookSocket?.terminate(); this.bookSocket = null;
  }
}
export { signalId };
