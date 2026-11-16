/**
 * PAPER ROBOT: runs alongside the existing signal engine in the same worker and lease.
 * Simulated fills only — this module never places exchange orders.
 * Live 1m candles and best bid/ask come from Binance public streams; entries are decided only on live 5m closes.
 */
import WebSocket from './websocket';
import { BINANCE_WS, BinanceRequestError, binanceFetch, checkWebSocketAccess, delay, backoff, restCandle } from './binance';
import { DEFAULT_SETTINGS, ROBOT_SYMBOLS, type RobotSettings } from '../src/lib/robot/config';
import { SymbolState, MINUTE, type Bar } from '../src/lib/robot/series';
import { abnormalMarket, evaluateBoth, exposure, pickEntry, stepSymbol, WARMUP_BARS } from '../src/lib/robot/engine';
import { openPosition, type Fill, type Position } from '../src/lib/robot/paper';
import { sizePosition, type Account } from '../src/lib/robot/risk';
import { evaluate, type BookContext, type Candidate, type Evaluation } from '../src/lib/robot/strategy';
import type { RobotCommit, RobotCommitResult } from '../src/lib/robot/protocol';

type Row = Record<string, unknown>;
type Book = { bid: number; ask: number; bidQty: number; askQty: number; at: number };
type Pending = { expected: number; fills: Fill[]; notify: boolean };
const LIVE_BAR_MAX_AGE = 2 * MINUTE;
const num = (v: unknown) => Number(v);

export function positionFromRow(r: Row): Position {
  return { id: String(r.id), symbol: String(r.symbol), direction: r.direction as Position['direction'], status: r.status as Position['status'],
    setup: r.setup as Position['setup'], score: num(r.score), leverage: num(r.leverage), band: String(r.band), entry: num(r.entry_price),
    qty: num(r.quantity), qtyOpen: num(r.quantity_open), margin: num(r.margin), notional: num(r.notional), stop: num(r.stop_loss),
    initialStop: num(r.initial_stop), tp1: num(r.tp1), tp2: num(r.tp2), liquidation: num(r.liquidation_price), riskUsdt: num(r.risk_usdt),
    tp1Done: Boolean(r.tp1_done), fees: num(r.fees), realized: num(r.realized_pnl), openedAt: Date.parse(String(r.opened_at)),
    closedAt: null, exitPrice: null, exitReason: null, lastCandleTime: num(r.last_candle_time), version: num(r.version),
    liquidity: String(r.liquidity ?? ''), lastPrice: num(r.last_price ?? r.entry_price), unrealized: num(r.unrealized_pnl) };
}

/** Daily loss and loss-streak context from durable closed trades. */
export function accountFrom(balance: number, open: Position[], closed: { realized_pnl: unknown; closed_at: unknown }[], now: number): Account {
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  const today = closed.filter((c) => Date.parse(String(c.closed_at)) >= dayStart).reduce((a, c) => a + num(c.realized_pnl), 0)
    + open.filter((p) => p.openedAt >= dayStart).reduce((a, p) => a + p.realized, 0);
  let lossStreak = 0;
  for (const c of closed) { if (num(c.realized_pnl) <= 0) lossStreak++; else break; }
  const lastLoss = closed.find((c) => num(c.realized_pnl) <= 0);
  return { balance, dayStartBalance: balance - today, realizedToday: today, lossStreak, lastLossAt: lastLoss ? Date.parse(String(lastLoss.closed_at)) : null };
}

export class RobotService {
  private states = new Map<string, SymbolState>();
  private books = new Map<string, Book>();
  private queues = new Map<string, Bar[]>();
  private warm = new Set<string>();
  private open: Position[] = [];
  private pending = new Map<string, Pending>();
  private signals: RobotCommit['signals'] = [];
  private notes = new Map<string, { note: string | null; best: number | null; dir: 'LONG' | 'SHORT' | null }>();
  private boundary = new Map<number, Evaluation[]>();
  private settings: RobotSettings = { ...DEFAULT_SETTINGS };
  private account: Account = { balance: 0, dayStartBalance: 0, realizedToday: 0, lossStreak: 0, lastLossAt: null };
  private socket: WebSocket | null = null;
  private running = false; private paused = false; private failures = 0; private checking = false;
  private draining = false; private flushing = false; private suspendedUntil = 0;
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
    if (!r.ok) throw new Error(`App rejected ${action} (${r.status})`);
    return r.json() as Promise<T>;
  }
  private active() { return this.running && !this.paused && !this.marketPaused() && this.ownsLease(); }

  async start() {
    if (this.running) return;
    this.running = true;
    while (this.running && !this.ownsLease()) await delay(1000);
    if (!this.running) return;
    try {
      const info = await binanceFetch('/fapi/v1/exchangeInfo', this.abort.signal) as { symbols?: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
      for (const symbol of ROBOT_SYMBOLS) {
        const c = info.symbols?.find((s) => s.symbol === symbol && s.status === 'TRADING');
        const tick = Number(c?.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize);
        if (c && tick > 0) this.states.set(symbol, new SymbolState(symbol, tick)); else this.unavailable.push(symbol);
      }
      await this.refresh();
      this.connect();
      this.timers.push(setInterval(() => { void this.flush().catch((e) => this.fail(e)); }, 5000));
      this.timers.push(setInterval(() => { void this.refresh().catch((e) => this.fail(e)); }, 15_000));
      for (const symbol of this.states.keys()) {
        if (!this.active()) return;
        await this.warmUp(symbol);
        await delay(400); // Stay far below Binance request-weight limits during warm-up.
      }
      console.log(`PAPER ROBOT warmed up: ${this.warm.size}/${ROBOT_SYMBOLS.length} coins. Simulated fills only.`);
    } catch (e) { this.fail(e); }
  }

  /** Load the latest durable settings, account and positions. The database is the source of truth. */
  private async refresh() {
    if (this.observeOnly || !this.ownsLease()) return;
    const r = await this.app<{ settings: Row; account: Row; open: Row[]; closed: Row[] }>('robot-state', {});
    this.settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, typeof DEFAULT_SETTINGS[k as keyof RobotSettings] === 'boolean' ? Boolean(r.settings[k]) : num(r.settings[k])])) } as RobotSettings;
    const durable = new Map(r.open.map((row) => [String(row.id), row]));
    // Keep local positions with unsaved fills; drop any closed elsewhere (for example by STOP ALL).
    this.open = this.open.filter((p) => durable.has(p.id) || this.pending.has(p.id));
    for (const [id, row] of durable) if (!this.open.some((p) => p.id === id)) this.open.push(positionFromRow(row));
    this.account = accountFrom(num(r.account.balance), this.open, r.closed, Date.now());
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
    const st = this.states.get(symbol)!;
    const bars: Bar[] = []; let end = Date.now();
    while (bars.length < WARMUP_BARS + 60) {
      const chunk = await this.loadBars(symbol, undefined, end);
      if (!chunk.length) break;
      bars.unshift(...chunk.filter((b) => !bars.length || b.time < bars[0]!.time));
      end = chunk[0]!.time - 1;
      if (chunk.length < 1500) break;
    }
    for (const b of bars) this.step(symbol, b, false);
    this.warm.add(symbol);
    void this.drain(symbol);
  }

  private step(symbol: string, bar: Bar, live: boolean) {
    const st = this.states.get(symbol)!;
    const { accepted, fills } = stepSymbol(st, bar, this.open, this.settings);
    if (!accepted) return;
    for (const { position: p, fill } of fills) {
      const entry = this.pending.get(p.id) ?? { expected: p.version - 1, fills: [], notify: live };
      entry.fills.push(fill); entry.notify = entry.notify && live;
      this.pending.set(p.id, entry);
    }
    for (const p of this.open) if (p.symbol === symbol && p.status === 'OPEN' && !this.pending.has(p.id) && p.lastCandleTime === bar.time) {
      // Mark-to-market only; no fill.
      this.pending.set(p.id, { expected: p.version, fills: [], notify: live });
    }
    if (live) this.lastLiveBar.set(symbol, bar.time);
    if (!st.signalClosed) return;
    const evals = evaluateBoth(st, this.settings, this.bookContext(symbol));
    const best = evals.map((e) => e.candidate).filter((c): c is Candidate => !!c).sort((a, b) => b.score - a.score)[0];
    const firstReason = evals.find((e) => e.rejected && e.rejected !== 'No sweep or pullback setup')?.rejected ?? null;
    this.notes.set(symbol, { note: best && !evals.find((e) => e.candidate === best)?.rejected ? 'Qualified setup' : firstReason ?? 'No setup',
      best: best?.score ?? null, dir: best?.direction ?? null });
    if (!live || Date.now() - (bar.time + MINUTE) > LIVE_BAR_MAX_AGE) return;
    const key = bar.time + MINUTE;
    const list = this.boundary.get(key) ?? [];
    if (!list.length) setTimeout(() => { void this.decide(key).catch((e) => this.fail(e)); }, 4000);
    list.push(...evals); this.boundary.set(key, list);
  }

  private bookContext(symbol: string): BookContext {
    const b = this.books.get(symbol);
    if (!b || Date.now() - b.at > 30_000) return { spreadBps: null, imbalance: null, depthUsd: null };
    const mid = (b.bid + b.ask) / 2;
    return { spreadBps: ((b.ask - b.bid) / mid) * 10_000, imbalance: (b.bidQty - b.askQty) / Math.max(1e-12, b.bidQty + b.askQty), depthUsd: null };
  }

  /** Depth within 0.5% of mid from the public order book; used only to confirm a chosen candidate. */
  private async depth(symbol: string): Promise<BookContext> {
    const d = await binanceFetch(`/fapi/v1/depth?symbol=${symbol}&limit=50`, this.abort.signal) as { bids?: [string, string][]; asks?: [string, string][] };
    const bids = (d.bids ?? []).map(([p, q]) => [Number(p), Number(q)] as const); const asks = (d.asks ?? []).map(([p, q]) => [Number(p), Number(q)] as const);
    const bid = bids[0]?.[0]; const ask = asks[0]?.[0];
    if (!bid || !ask) return { spreadBps: null, imbalance: null, depthUsd: null };
    const mid = (bid + ask) / 2;
    const sum = (xs: (readonly [number, number])[]) => xs.filter(([p]) => Math.abs(p - mid) / mid <= 0.005).reduce((a, [p, q]) => a + p * q, 0);
    const b = sum(bids); const a = sum(asks);
    this.books.set(symbol, { bid, ask, bidQty: bids[0]![1], askQty: asks[0]![1], at: Date.now() });
    return { spreadBps: ((ask - bid) / mid) * 10_000, imbalance: (b - a) / Math.max(1e-9, a + b), depthUsd: Math.min(a, b) };
  }

  private async decide(key: number) {
    const evals = this.boundary.get(key) ?? []; this.boundary.delete(key);
    if (!this.active() || !evals.length) return;
    const now = Date.now();
    const abnormal = abnormalMarket(this.states.get('BTCUSDT'));
    if (abnormal) this.suspendedUntil = now + 15 * MINUTE;
    const reject = (c: Candidate, reason: string) => this.logSignal(c, 'SKIPPED', reason);
    if (now < this.suspendedUntil) { for (const e of evals) if (e.candidate && !e.rejected) reject(e.candidate, abnormal ?? 'Abnormal market: entries suspended'); return; }
    const { chosen, skipped } = pickEntry(evals, this.open, this.account, this.settings, now);
    for (const s of skipped) reject(s.candidate, s.reason);
    for (const e of evals) if (e.candidate && !e.rejected && e.candidate !== chosen && !skipped.some((s) => s.candidate === e.candidate)) reject(e.candidate, 'A higher-scoring setup was chosen');
    if (!chosen) return;
    // Re-score with the live order book before committing paper capital.
    const book = await this.depth(chosen.symbol);
    const again = evaluate(this.states.get(chosen.symbol)!, chosen.direction, this.settings, book);
    if (!again.candidate || again.rejected) { reject(chosen, again.rejected ?? 'Setup no longer valid'); return; }
    const c = again.candidate;
    const b = this.books.get(chosen.symbol); const sign = c.direction === 'LONG' ? 1 : -1;
    const touch = b ? (sign > 0 ? b.ask : b.bid) : c.entry;
    const fill = touch * (1 + sign * this.settings.slippage_bps / 10_000);
    if ((c.stop - fill) * sign >= 0 || (c.tp1 - fill) * sign <= 0) { reject(c, 'Price moved past levels before fill'); return; }
    const z = sizePosition(c, this.account.balance, exposure(this.open), this.settings, book.spreadBps, fill);
    if ('rejected' in z) { reject(c, z.rejected); return; }
    const { position, fill: f } = openPosition(c, z, fill, c.time + MINUTE, this.settings);
    const open: RobotCommit['opens'][number] = { id: position.id, symbol: c.symbol, direction: c.direction, setup: c.setup, score: c.score,
      leverage: z.leverage, band: z.band, entry_price: fill, quantity: z.qty, margin: z.margin, notional: z.notional, stop_loss: c.stop,
      tp1: c.tp1, tp2: c.tp2, liquidation_price: z.liquidation, risk_usdt: z.riskUsdt, fees: f.fee, realized_pnl: f.pnl, liquidity: c.liquidity,
      opened_at: new Date(now).toISOString(), last_candle_time: position.lastCandleTime, balance_before: this.account.balance };
    const sig = this.signalRow(c, 'TAKEN', null, position.id);
    const r = await this.app<RobotCommitResult>('robot-commit', { instance_id: this.instance(), opens: [open], signals: [sig] });
    if (r.opened?.includes(position.id)) {
      this.open.push(position); this.account.balance += f.pnl; this.account.realizedToday += f.pnl;
      console.log(JSON.stringify({ event: 'robot_paper_open', id: position.id, leverage: z.leverage, score: c.score }));
    }
  }

  private signalRow(c: Candidate, decision: 'TAKEN' | 'SKIPPED' | 'REJECTED', reason: string | null, id = `${c.symbol}-${c.direction}-${c.time}`): RobotCommit['signals'][number] {
    return { id, symbol: c.symbol, direction: c.direction, setup: c.setup, score: c.score, parts: c.parts as unknown as Record<string, number>,
      entry_price: c.entry, stop_loss: c.stop, tp1: c.tp1, tp2: c.tp2, liquidity: c.liquidity, decision, reason, candle_time: new Date(c.time + MINUTE).toISOString() };
  }
  private logSignal(c: Candidate, decision: 'SKIPPED', reason: string) {
    if (this.signals.length < 100) this.signals.push(this.signalRow(c, decision, reason.slice(0, 160)));
  }

  private marketRows(): RobotCommit['markets'] {
    const rows: RobotCommit['markets'] = this.unavailable.map((symbol) => ({ symbol, price: null, spread_bps: null, depth_usd: null, imbalance: null,
      quote_volume_24h: null, trend_1h: null, trend_15m: null, status: 'UNAVAILABLE', liquidity: null, best_direction: null, best_score: null,
      note: 'Not listed as a trading Binance USD-M Futures contract', last_candle_at: null }));
    for (const [symbol, st] of this.states) {
      const last = st.m1.last(); const b = this.bookContext(symbol); const n = this.notes.get(symbol);
      const liveAt = this.lastLiveBar.get(symbol);
      const status = this.marketPaused() ? 'PAUSED' : !this.warm.has(symbol) || st.count < WARMUP_BARS || !st.ready() ? 'WARMING UP'
        : liveAt !== undefined && Date.now() - (liveAt + MINUTE) < 3 * MINUTE ? 'LIVE' : 'RECOVERING';
      const pools = st.levels.filter((l) => l.tf >= 5 && l.sweptAt === null && last);
      const near = (side: 'high' | 'low') => pools.filter((l) => l.side === side).sort((a, c) => Math.abs(a.price - last!.close) - Math.abs(c.price - last!.close))[0];
      const hi = near('high'); const lo = near('low');
      rows.push({ symbol, price: this.books.get(symbol) ? (this.books.get(symbol)!.bid + this.books.get(symbol)!.ask) / 2 : last?.close ?? null,
        spread_bps: b.spreadBps === null ? null : Math.round(b.spreadBps * 100) / 100, depth_usd: null,
        imbalance: b.imbalance === null ? null : Math.round(b.imbalance * 1000) / 1000, quote_volume_24h: Math.round(st.quoteVolume24h),
        trend_1h: st.m60.ema50.value === null ? null : st.m60.trend(true), trend_15m: st.m15.ema21.value === null ? null : st.m15.trend(false), status,
        liquidity: last && (hi || lo) ? `Buy-side ${hi ? Number(hi.price.toPrecision(8)) : '—'} · Sell-side ${lo ? Number(lo.price.toPrecision(8)) : '—'}` : null,
        best_direction: n?.dir ?? null, best_score: n?.best ?? null, note: n?.note?.slice(0, 160) ?? null,
        last_candle_at: last ? new Date(last.time + MINUTE).toISOString() : null });
    }
    return rows;
  }

  /** Save market rows, mark-to-market and fills in one atomic call. Version checks stop double-applying fills. */
  private async flush() {
    if (this.flushing || this.observeOnly || !this.ownsLease() || this.paused) return;
    this.flushing = true;
    try {
      const updates: RobotCommit['updates'] = [];
      const batch = [...this.pending.entries()].slice(0, 20);
      for (const [id, pend] of batch) {
        const p = this.open.find((x) => x.id === id);
        if (!p) { this.pending.delete(id); continue; }
        if (pend.expected === p.version) { // mark-to-market without a fill
          updates.push(this.updateRow(p, pend, p.version, p.version + 1)); p.version++;
        } else updates.push(this.updateRow(p, pend, pend.expected, p.version));
      }
      const signals = this.signals.splice(0, 100);
      const r = await this.app<RobotCommitResult>('robot-commit', { instance_id: this.instance(), markets: this.marketRows(), updates, signals });
      if (r.paused) return;
      for (const [id] of batch) this.pending.delete(id);
      for (const p of this.open) if (p.status === 'CLOSED' && r.applied?.includes(p.id)) {
        if (p.realized <= 0) { this.account.lossStreak++; this.account.lastLossAt = p.closedAt; } else this.account.lossStreak = 0;
      }
      for (const u of updates) if (r.applied?.includes(u.id)) { this.account.balance += u.pnl_delta; this.account.realizedToday += u.pnl_delta; }
      this.open = this.open.filter((p) => p.status === 'OPEN' && !r.conflicts?.includes(p.id));
      if (r.conflicts?.length) await this.refresh();
    } finally { this.flushing = false; }
  }
  private updateRow(p: Position, pend: Pending, expected: number, version: number): RobotCommit['updates'][number] {
    return { id: p.id, symbol: p.symbol, direction: p.direction, expected_version: expected, version, status: p.status,
      quantity_open: p.qtyOpen, margin: p.margin, stop_loss: p.stop, tp1_done: p.tp1Done, fees: p.fees, realized_pnl: p.realized,
      unrealized_pnl: p.status === 'OPEN' ? p.unrealized : 0, last_price: p.lastPrice, closed_at: p.closedAt === null ? null : new Date(p.closedAt).toISOString(),
      exit_price: p.exitPrice, exit_reason: p.exitReason, last_candle_time: p.lastCandleTime, pnl_delta: pend.fills.reduce((a, f) => a + f.pnl, 0),
      entry_price: p.entry, leverage: p.leverage, opened_at: new Date(p.openedAt).toISOString(),
      fills: pend.fills.filter((f) => f.kind !== 'OPEN').map((f) => ({ kind: f.kind as 'PARTIAL' | 'CLOSE', price: f.price, qty: f.qty, pnl: f.pnl, fee: f.fee,
        reason: (f.reason ?? 'TAKE_PROFIT') as never, time: f.time })), notify: pend.notify };
  }

  private async drain(symbol: string) {
    if (!this.warm.has(symbol) || this.draining) return;
    this.draining = true;
    try {
      for (const [sym, q] of this.queues) {
        if (!this.warm.has(sym)) continue;
        const st = this.states.get(sym)!;
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
    const symbols = [...this.states.keys()].map((s) => s.toLowerCase());
    const streams = symbols.flatMap((s) => [`${s}@kline_1m`, `${s}@bookTicker`]).join('/');
    const ws = new WebSocket(`${BINANCE_WS}${streams}`);
    this.socket = ws;
    ws.on('open', () => { this.failures = 0; console.log('PAPER ROBOT market stream connected'); });
    ws.on('message', (raw) => {
      if (this.socket !== ws || !this.active()) return;
      try {
        const msg = JSON.parse(raw.toString()) as { data?: { e?: string; s?: string; E?: number; b?: string; a?: string; B?: string; A?: string;
          k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean; i?: string } } };
        const d = msg.data; const symbol = d?.s;
        if (!d || !symbol || !this.states.has(symbol)) return;
        if (d.e === 'bookTicker') {
          const bid = Number(d.b); const ask = Number(d.a);
          if (bid > 0 && ask >= bid) this.books.set(symbol, { bid, ask, bidQty: Number(d.B), askQty: Number(d.A), at: Date.now() });
          return;
        }
        const k = d.k;
        if (!k || !k.x || (k.i !== undefined && k.i !== '1m')) return;
        const bar = restCandle([k.t, k.o, k.h, k.l, k.c, k.v, 0]);
        if (bar.time + MINUTE > Date.now() + 5000) return;
        const q = this.queues.get(symbol) ?? [];
        if (!q.some((x) => x.time === bar.time)) q.push(bar);
        this.queues.set(symbol, q.sort((a, b) => a.time - b.time).slice(-200));
        void this.drain(symbol).catch((e) => this.fail(e));
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

  private fail(e: unknown) {
    if (e instanceof BinanceRequestError && e.pausesMarket) {
      // Never retry around a 451/418. The signal engine reports the restriction in health.
      this.paused = true; this.abort.abort(); this.socket?.terminate(); this.socket = null;
      console.error('PAPER ROBOT paused: Binance restricted market access.');
      return;
    }
    console.error('PAPER ROBOT error:', e instanceof Error ? e.message.slice(0, 300) : 'unknown');
  }

  async stop() {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.abort.abort(); this.socket?.terminate(); this.socket = null;
  }
}
