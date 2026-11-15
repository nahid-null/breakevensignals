import WebSocket from "ws";
import { SYMBOLS, INDICATORS, type Symbol } from "../src/lib/config";
import { initialState, ENGINE_VERSION, MINUTE, PARAMETERS, validateCandle, type EngineState, type Candle, type Analysis, type Signal } from "../src/lib/engine/model";
import { processCandle } from "../src/lib/engine/scalper";
import { BINANCE_WS, binanceFetch, history, delay, backoff } from "./binance";

type Market = { symbol: Symbol; price: number | null; trend: string; status: string; last_candle_at: string | null;
  long_score: number; short_score: number; error: string | null };
type Checkpoint = { state: EngineState; revision: number };

export class SignalService {
  readonly instance = crypto.randomUUID();
  private checkpoints = new Map<Symbol, Checkpoint>();
  private available = new Map<Symbol, number>();
  private markets = new Map<Symbol, Market>();
  private socket: WebSocket | null = null;
  private queues = new Map<Symbol, Candle[]>();
  private running = false;
  private draining = false;
  private initialized = false;
  private connected = false;
  private lastMessage = 0;
  private failures = 0;
  private lastError: string | null = null;
  private lastRestAt = 0;
  private publishing = false;
  private nextRestProbe = 0;
  private ownedLease = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private recovery = new Set<Symbol>();
  private timers: ReturnType<typeof setInterval>[] = [];
  constructor(private readonly appUrl: string, private readonly secret: string, private readonly observeOnly = false,
    private readonly runtimeMode: 'production' | 'temporary' = 'production') {}

  private async app<T>(action: string, data: unknown): Promise<T> {
    const response = await fetch(`${this.appUrl}/api/public/engine`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}` },
      body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`App rejected ${action} (${response.status})`);
    return response.json() as Promise<T>;
  }
  private async heartbeat(status = this.lastError ? 'ERROR' : this.connected && this.initialized && this.recovery.size === 0 ? 'RUNNING' : 'RECOVERING') {
    if (this.observeOnly) return;
    const r = await this.app<{ acquired: boolean }>('heartbeat', { instance_id: this.instance,
      websocket_connected: this.connected, binance_connected: Date.now() - this.lastRestAt < 90_000,
      available_symbols: this.available.size, status, error: this.lastError, runtime_mode: this.runtimeMode });
    if (!r.acquired) { await this.stop(); throw new Error("Another engine instance owns the lease"); }
    this.ownedLease = true;
  }
  private market(symbol: Symbol, state: EngineState, c: Candle, a: Analysis | null, status: string): Market {
    return { symbol, price: c.close, trend: a?.trend ?? 'WAITING', status,
      last_candle_at: new Date(c.time + MINUTE).toISOString(), long_score: a?.longScore ?? 0,
      short_score: a?.shortScore ?? 0, error: null };
  }
  private async commit(symbol: Symbol, tentative: EngineState, market: Market, events: Signal[], mode: 'live' | 'warmup' | 'recovery') {
    const previous = this.checkpoints.get(symbol);
    if (this.observeOnly) {
      this.checkpoints.set(symbol, { state: tentative, revision: (previous?.revision ?? 0) + 1 });
      this.markets.set(symbol, market);
      return;
    }
    try {
      const r = await this.app<{ conflict: boolean; revision: number }>('commit', { instance_id: this.instance,
        symbol, expected_revision: previous?.revision ?? 0, checkpoint: tentative, market, events, mode });
      if (r.conflict) throw new Error("Checkpoint revision conflict");
      this.checkpoints.set(symbol, { state: tentative, revision: r.revision });
      this.markets.set(symbol, market);
    } catch (e) {
      // If the response was lost after commit, re-read durable state. Never reuse a stale revision.
      const r = await this.app<{ checkpoints: { symbol: Symbol; revision: number; state: EngineState }[] }>('state', {});
      const saved = r.checkpoints.find((x) => x.symbol === symbol);
      if (saved) this.checkpoints.set(symbol, saved);
      if (saved?.state.lastTime === tentative.lastTime) { this.markets.set(symbol, market); return; }
      throw e;
    }
  }
  async start() {
    const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols?: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
    this.lastRestAt = Date.now();
    for (const symbol of SYMBOLS) {
      const contract = info.symbols?.find((s) => s.symbol === symbol && s.status === 'TRADING');
      const tick = Number(contract?.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize);
      if (contract && tick > 0) this.available.set(symbol, tick);
      else this.markets.set(symbol, { symbol, price: null, trend: 'WAITING', status: 'UNAVAILABLE',
        last_candle_at: null, long_score: 0, short_score: 0, error: 'Not listed as a trading Binance USD-M Futures contract' });
    }
    this.running = true;
    await this.heartbeat('STARTING');
    if (!this.observeOnly) {
      const saved = await this.app<{ checkpoints: { symbol: Symbol; revision: number; state: EngineState }[] }>('state', {});
      const storedMarkets = await this.app<{ markets: Market[] }>('market-state', {});
      for (const m of storedMarkets.markets) if (this.available.has(m.symbol)) this.markets.set(m.symbol, {
        ...m, last_candle_at: m.last_candle_at ? new Date(m.last_candle_at).toISOString() : null,
      });
      for (const row of saved.checkpoints) {
        if (row.state.version !== ENGINE_VERSION) throw new Error('Unsupported checkpoint version; migration required');
        this.checkpoints.set(row.symbol, row);
      }
      for (const m of this.markets.values()) if (m.status === 'UNAVAILABLE') await this.app('market', { instance_id: this.instance, market: m });
    }
    this.timers.push(setInterval(() => { void this.heartbeat().catch((e) => this.fail(e)); }, 20_000));
    this.connect(); // Buffer incoming closed candles before REST warm-up.
    for (const [symbol, tick] of this.available) {
      if (!this.running) break;
      const saved = this.checkpoints.get(symbol);
      if (!saved) {
        const candles = await history(symbol);
        if (candles.length < 200) throw new Error(`${symbol}: insufficient Binance history`);
        const state = initialState(symbol, tick);
        let analysis: Analysis | null = null;
        for (const c of candles) analysis = processCandle(state, c).analysis;
        const last = candles.at(-1);
        if (!last) throw new Error('Empty history');
        // Replay every trading rule, including locking/cooldown. Do not publish backtest
        // trades as live signals. If a real historical trade is still open, adopt it with
        // explicit historical provenance, no notification, and its original entry levels.
        const adopted: Signal[] = [];
        for (const side of [state.long, state.short]) {
          const t = side.trade;
          if (!t) continue;
          adopted.push({ event_id: `${t.id}-entry_confirmed`, trade_id: t.id, event: 'entry_confirmed', symbol,
            direction: t.direction, indicator: INDICATORS[t.direction], timeframe: '1', entry_price: t.entry,
            stop_loss: t.originalStop, take_profit: t.target, fee_rate_percent: PARAMETERS.feePercent,
            timestamp: new Date(t.entryTime + MINUTE).toISOString() });
          const entry = adopted.at(-1);
          if (t.breakeven && entry) adopted.push({ ...entry,
            event_id: `${t.id}-breakeven_activated`, event: 'breakeven_activated', stop_loss: t.stop,
            timestamp: new Date((t.breakevenTime ?? last.time) + MINUTE).toISOString() });
        }
        await this.commit(symbol, state, this.market(symbol, state, last, analysis, 'RECOVERING'), adopted, 'warmup');
      }
      this.recovery.add(symbol);
      await this.recover(symbol, Date.now());
      await delay(100);
    }
    this.initialized = true;
    this.timers.push(setInterval(() => {
      if (!this.running) return;
      if (this.socket && Date.now() - this.lastMessage > 60_000) this.socket.terminate();
      void this.drain();
      if (!this.observeOnly) void this.app('deliveries', { instance_id: this.instance }).catch((e) => this.fail(e));
    }, 10_000));
    this.timers.push(setInterval(() => {
      if (this.observeOnly || !this.connected || this.draining) return;
      void this.publishPrices().catch((e) => this.fail(e));
    }, 5000));
    await this.heartbeat();
    console.log(`Signal service started: ${this.available.size}/${SYMBOLS.length} available contracts. ${this.observeOnly ? 'OBSERVATION ONLY: no database writes or Telegram.' : 'Confirmed-candle live processing.'}`);
  }
  private connect() {
    if (!this.running) return;
    this.reconnectTimer = null;
    const streams = [...this.available.keys()].map((s) => `${s.toLowerCase()}@kline_1m`).join('/');
    const ws = new WebSocket(`${BINANCE_WS}${streams}`);
    this.socket = ws;
    ws.on('open', () => {
      this.connected = true; this.lastMessage = Date.now(); this.failures = 0;
      for (const s of this.available.keys()) this.recovery.add(s);
      console.log('Binance Futures WebSocket connected');
      void this.heartbeat().catch((e) => this.fail(e));
    });
    ws.on('message', (raw) => {
      this.lastMessage = Date.now();
      try {
        const payload = JSON.parse(raw.toString()) as { data?: { s: string; k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean } } };
        const data = payload.data; const k = data?.k;
        const symbol = data?.s as Symbol;
        if (!k || !this.available.has(symbol)) return;
        // Intrabar price is display-only. Signal conditions run only for k.x=true.
        const m = this.markets.get(symbol);
        if (m && Number.isFinite(Number(k.c)) && Number(k.c) > 0) m.price = Number(k.c);
        if (!k.x) return;
        const c: Candle = { time: k.t, open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
        validateCandle(c);
        const q = this.queues.get(symbol) ?? [];
        if (!q.some((x) => x.time === c.time)) q.push(c);
        // Bound memory. Any omitted candles are recovered from REST, never silently skipped.
        this.queues.set(symbol, q.sort((a, b) => a.time - b.time).slice(-200));
        void this.drain();
      } catch (e) { this.fail(e); }
    });
    ws.on('error', () => { this.lastError = 'Binance WebSocket connection error'; ws.terminate(); });
    ws.on('close', () => {
      this.connected = false;
      for (const s of this.available.keys()) this.recovery.add(s);
      if (this.running) { const wait = backoff(this.failures++); console.log(`WebSocket disconnected; reconnect in ${wait}ms`); this.reconnectTimer = setTimeout(() => this.connect(), wait); }
    });
  }
  private async accept(symbol: Symbol, c: Candle, mode: 'live' | 'recovery') {
    const saved = this.checkpoints.get(symbol);
    if (!saved || c.time <= (saved.state.lastTime ?? -1)) return;
    const tentative = structuredClone(saved.state);
    const result = processCandle(tentative, c);
    if (!this.running) return;
    await this.commit(symbol, tentative, this.market(symbol, tentative, c, result.analysis, mode === 'live' ? 'LIVE' : 'RECOVERING'), result.signals, mode);
  }
  private async recover(symbol: Symbol, until: number) {
    let saved = this.checkpoints.get(symbol);
    if (!saved || saved.state.lastTime === null) return;
    while (this.running && saved.state.lastTime !== null && saved.state.lastTime + 2 * MINUTE <= until) {
      const candles = await history(symbol, saved.state.lastTime + MINUTE, until);
      if (!candles.length) throw new Error(`${symbol}: missing candle recovery incomplete`);
      for (const c of candles) await this.accept(symbol, c, 'recovery');
      const next = this.checkpoints.get(symbol);
      if (!next || next.state.lastTime === saved.state.lastTime) throw new Error('Recovery made no progress');
      saved = next;
    }
    this.recovery.delete(symbol);
  }
  private async drain() {
    if (this.draining || !this.running || !this.initialized) return;
    this.draining = true;
    try {
      if (Date.now() >= this.nextRestProbe) {
        this.nextRestProbe = Date.now() + 60_000;
        await binanceFetch('/fapi/v1/time');
        this.lastRestAt = Date.now();
      }
      for (const symbol of [...this.recovery]) await this.recover(symbol, Date.now());
      for (const [symbol, q] of this.queues) {
        if (!this.running) return;
        if (!this.checkpoints.has(symbol)) continue;
        for (const c of [...q]) {
          const saved = this.checkpoints.get(symbol);
          if (!saved || saved.state.lastTime === null) continue;
          if (c.time > saved.state.lastTime + MINUTE) await this.recover(symbol, c.time);
          await this.accept(symbol, c, Date.now() - (c.time + MINUTE) < 30_000 ? 'live' : 'recovery');
          this.queues.set(symbol, (this.queues.get(symbol) ?? []).filter((x) => x.time > c.time));
        }
      }
      if (this.connected && [...this.available.keys()].every((s) => Date.now() - (this.checkpoints.get(s)?.state.lastTime ?? 0) < 3 * MINUTE)) this.lastError = null;
    } catch (e) { this.fail(e); }
    finally { this.draining = false; }
  }
  private async publishPrices() {
    if (this.publishing) return;
    this.publishing = true;
    try { for (const market of this.markets.values()) {
      if (!this.running) return;
      await this.app('market', { instance_id: this.instance, market });
    } } finally { this.publishing = false; }
  }
  private fail(e: unknown) {
    this.lastError = e instanceof Error ? e.message.slice(0, 500) : 'Signal processing error';
    console.error(this.lastError);
  }
  snapshot() { return { connected: this.connected, configured: SYMBOLS.length, available: this.available.size,
    receivedAt: this.lastMessage, markets: [...this.markets.values()], counts: [...this.checkpoints].map(([symbol, row]) => ({ symbol, candles: row.state.count, lastTime: row.state.lastTime })) }; }
  disconnectForTest() { this.socket?.terminate(); }
  async stop() {
    const wasRunning = this.running;
    this.running = false; this.connected = false;
    for (const timer of this.timers) clearInterval(timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.terminate();
    if (wasRunning && this.ownedLease && !this.observeOnly) {
      await this.app('stop', { instance_id: this.instance }).catch((e) => this.fail(e));
      this.ownedLease = false;
    }
  }
}