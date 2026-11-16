import WebSocket from "ws";
import { SYMBOLS, INDICATORS, type Symbol } from "../src/lib/config";
import { initialState, ENGINE_VERSION, MINUTE, PARAMETERS, validateCandle, type EngineState, type Candle, type Analysis, type Signal } from "../src/lib/engine/model";
import { processCandle } from "../src/lib/engine/scalper";
import { BINANCE_WS, BinanceRequestError, binanceFetch, history, delay, backoff } from "./binance";

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
  private marketPaused = false;
  private connected = false;
  private lastMessage = 0;
  private failures = 0;
  private lastError: string | null = null;
  private lastRestAt = 0;
  private publishing = false;
  private nextRestProbe = 0;
  private ownedLease = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInFlight: Promise<void> | null = null;
  private recovery = new Set<Symbol>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private startedAt: number | null = null;
  private lastScanAt: number | null = null;
  constructor(private readonly appUrl: string, private readonly secret: string, private readonly observeOnly = false,
    private readonly runtimeMode: 'production' | 'temporary' = 'production',
    private readonly hostKind: 'windows_pc' | 'hosted' | 'temporary' | 'unknown' = 'unknown') {}

  private async app<T>(action: string, data: unknown): Promise<T> {
    const response = await fetch(`${this.appUrl}/api/public/engine`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}` },
      body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`App rejected ${action} (${response.status})`);
    return response.json() as Promise<T>;
  }
  private async heartbeat(status?: string) {
    // Serialize state reports so a late STARTING response cannot overwrite a restriction.
    if (this.heartbeatInFlight) await this.heartbeatInFlight;
    if (!this.running) return;
    const pending = this.sendHeartbeat(status);
    this.heartbeatInFlight = pending;
    try { await pending; }
    finally { if (this.heartbeatInFlight === pending) this.heartbeatInFlight = null; }
  }
  private async sendHeartbeat(status?: string) {
    if (this.observeOnly) return;
    const currentStatus = this.lastError ? 'ERROR' : status ?? (this.connected && this.initialized && this.recovery.size === 0 ? 'RUNNING' : 'RECOVERING');
    const r = await this.app<{ acquired: boolean }>('heartbeat', { instance_id: this.instance,
      websocket_connected: this.connected && !this.marketPaused, binance_connected: !this.marketPaused && this.lastRestAt > 0 && Date.now() - this.lastRestAt < 90_000,
      available_symbols: this.available.size, status: currentStatus, error: this.lastError, runtime_mode: this.runtimeMode,
      ...this.telemetry() });
    if (!this.running) return;
    if (!r.acquired) { await this.stop(); throw new Error("Another engine instance owns the lease"); }
    this.ownedLease = true;
  }
  private market(symbol: Symbol, state: EngineState, c: Candle, a: Analysis | null, status: string): Market {
    return { symbol, price: c.close, trend: a?.trend ?? 'WAITING', status,
      last_candle_at: new Date(c.time + MINUTE).toISOString(), long_score: a?.longScore ?? 0,
      short_score: a?.shortScore ?? 0, error: null };
  }
  private async commit(symbol: Symbol, tentative: EngineState, market: Market, events: Signal[], mode: 'live' | 'warmup' | 'recovery') {
    if (!this.running || this.marketPaused) return;
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
    if (this.running) return;
    this.startedAt = Date.now();
    this.running = true;
    // Report cloud liveness and acquire ownership before contacting the market provider.
    await this.heartbeat('STARTING');
    this.timers.push(setInterval(() => { void this.heartbeat().catch((e) => this.fail(e)); }, 20_000));
    await this.bootstrap();
  }
  private async bootstrap() {
    if (!this.running || this.marketPaused) return;
    try { await this.initializeMarkets(); }
    catch (error) {
      this.fail(error);
      if (!this.running) return;
      await this.heartbeat('ERROR');
      if (this.marketPaused) return;
      if (!(error instanceof BinanceRequestError)) throw error;
      if (error.kind === 'request') return;
      // Only transient provider failures may retry. A 451/418 stays paused until a lawful restart.
      const wait = backoff(this.failures++);
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        void this.bootstrap().catch((e) => this.fail(e));
      }, wait);
    }
  }
  private async initializeMarkets() {
    const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols?: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
    if (!this.running || this.marketPaused) return;
    this.lastRestAt = Date.now();
    for (const symbol of SYMBOLS) {
      const contract = info.symbols?.find((s) => s.symbol === symbol && s.status === 'TRADING');
      const tick = Number(contract?.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize);
      if (contract && tick > 0) this.available.set(symbol, tick);
      else this.markets.set(symbol, { symbol, price: null, trend: 'WAITING', status: 'UNAVAILABLE',
        last_candle_at: null, long_score: 0, short_score: 0, error: 'Not listed as a trading Binance USD-M Futures contract' });
    }
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
      for (const m of this.markets.values()) {
        if (!this.running || this.marketPaused) return;
        if (m.status === 'UNAVAILABLE') await this.app('market', { instance_id: this.instance, market: m });
      }
    }
    if (!this.socket) this.connect(); // Buffer incoming closed candles before REST warm-up.
    for (const [symbol, tick] of this.available) {
      if (!this.running || this.marketPaused) return;
      const saved = this.checkpoints.get(symbol);
      if (!saved) {
        const candles = await history(symbol);
        if (!this.running || this.marketPaused) return;
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
    if (!this.running || this.marketPaused) return;
    this.initialized = true;
    this.recordSuccessfulScan();
    this.timers.push(setInterval(() => {
      if (!this.running || this.marketPaused) return;
      if (this.socket && Date.now() - this.lastMessage > 60_000) this.socket.terminate();
      void this.drain();
      if (!this.observeOnly) void this.app('deliveries', { instance_id: this.instance }).catch((e) => this.fail(e));
    }, 10_000));
    this.timers.push(setInterval(() => {
      if (this.observeOnly || this.marketPaused || !this.connected || this.draining) return;
      void this.publishPrices().catch((e) => this.fail(e));
    }, 5000));
    await this.heartbeat();
    console.log(`Signal service started: ${this.available.size}/${SYMBOLS.length} available contracts. ${this.observeOnly ? 'OBSERVATION ONLY: no database writes or Telegram.' : 'Confirmed-candle live processing.'}`);
  }
  private connect() {
    if (!this.running || this.marketPaused) return;
    this.reconnectTimer = null;
    const streams = [...this.available.keys()].map((s) => `${s.toLowerCase()}@kline_1m`).join('/');
    const ws = new WebSocket(`${BINANCE_WS}${streams}`);
    this.socket = ws;
    ws.on('open', () => {
      if (!this.running || this.marketPaused || this.socket !== ws) { ws.terminate(); return; }
      this.connected = true; this.lastMessage = Date.now(); this.failures = 0;
      for (const s of this.available.keys()) this.recovery.add(s);
      console.log('Binance Futures WebSocket connected');
      void this.heartbeat().catch((e) => this.fail(e));
    });
    ws.on('message', (raw) => {
      if (!this.running || this.marketPaused || this.socket !== ws) return;
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
    ws.on('error', () => { if (!this.marketPaused) this.lastError = 'Binance WebSocket connection error'; ws.terminate(); });
    ws.on('unexpected-response', (_request, response) => {
      const status = response.statusCode;
      if (status === 451 || status === 418) {
        response.resume();
        this.fail(new BinanceRequestError(status === 451 ? 'restricted' : 'banned', status, '/stream', 'Binance rejected the WebSocket connection. Resolve permitted access before restarting.'));
      } else {
        response.resume();
        this.lastError = `Binance WebSocket rejected connection (HTTP ${status ?? 'unknown'})`;
        ws.terminate();
      }
    });
    ws.on('close', () => {
      this.connected = false;
      for (const s of this.available.keys()) this.recovery.add(s);
      if (this.socket === ws) this.socket = null;
      if (this.running && !this.marketPaused) { const wait = backoff(this.failures++); console.log(`WebSocket disconnected; reconnect in ${wait}ms`); this.reconnectTimer = setTimeout(() => this.connect(), wait); }
    });
  }
  private async accept(symbol: Symbol, c: Candle, mode: 'live' | 'recovery') {
    if (this.marketPaused) return;
    const saved = this.checkpoints.get(symbol);
    if (!saved || c.time <= (saved.state.lastTime ?? -1)) return;
    const tentative = structuredClone(saved.state);
    const result = processCandle(tentative, c);
    if (!this.running || this.marketPaused) return;
    await this.commit(symbol, tentative, this.market(symbol, tentative, c, result.analysis, mode === 'live' ? 'LIVE' : 'RECOVERING'), result.signals, mode);
  }
  private async recover(symbol: Symbol, until: number) {
    let saved = this.checkpoints.get(symbol);
    if (!saved || saved.state.lastTime === null) return;
    while (this.running && !this.marketPaused && saved.state.lastTime !== null && saved.state.lastTime + 2 * MINUTE <= until) {
      const candles = await history(symbol, saved.state.lastTime + MINUTE, until);
      if (!this.running || this.marketPaused) return;
      if (!candles.length) throw new Error(`${symbol}: missing candle recovery incomplete`);
      for (const c of candles) await this.accept(symbol, c, 'recovery');
      const next = this.checkpoints.get(symbol);
      if (!next || next.state.lastTime === saved.state.lastTime) throw new Error('Recovery made no progress');
      saved = next;
    }
    this.recovery.delete(symbol);
  }
  private async drain() {
    if (this.draining || !this.running || this.marketPaused || !this.initialized) return;
    this.draining = true;
    try {
      if (Date.now() >= this.nextRestProbe) {
        this.nextRestProbe = Date.now() + 60_000;
        await binanceFetch('/fapi/v1/time');
        if (!this.running || this.marketPaused) return;
        this.lastRestAt = Date.now();
      }
      for (const symbol of [...this.recovery]) await this.recover(symbol, Date.now());
      for (const [symbol, q] of this.queues) {
        if (!this.running || this.marketPaused) return;
        if (!this.checkpoints.has(symbol)) continue;
        for (const c of [...q]) {
          const saved = this.checkpoints.get(symbol);
          if (!saved || saved.state.lastTime === null) continue;
          if (c.time > saved.state.lastTime + MINUTE) await this.recover(symbol, c.time);
          await this.accept(symbol, c, Date.now() - (c.time + MINUTE) < 30_000 ? 'live' : 'recovery');
          this.queues.set(symbol, (this.queues.get(symbol) ?? []).filter((x) => x.time > c.time));
        }
      }
      if (!this.marketPaused && this.connected && [...this.available.keys()].every((s) => Date.now() - (this.checkpoints.get(s)?.state.lastTime ?? 0) < 3 * MINUTE)) {
        this.lastError = null;
        this.recordSuccessfulScan();
      }
    } catch (e) { this.fail(e); }
    finally { this.draining = false; }
  }
  private async publishPrices() {
    if (this.publishing) return;
    this.publishing = true;
    try { for (const market of this.markets.values()) {
      if (!this.running || this.marketPaused) return;
      await this.app('market', { instance_id: this.instance, market });
    } } finally { this.publishing = false; }
  }
  private fail(e: unknown) {
    // A later app/network error must not replace a known access restriction.
    if (this.marketPaused) return;
    this.lastError = e instanceof Error ? e.message.slice(0, 500) : 'Signal processing error';
    if (e instanceof BinanceRequestError) {
      this.lastRestAt = 0;
      console.error(JSON.stringify({ event: 'binance_request_failed', code: e.kind, http_status: e.status,
        endpoint: e.endpoint, checked_at: e.checkedAt, explanation: this.lastError }));
      if (e.pausesMarket) {
        this.marketPaused = true;
        this.connected = false;
        if (this.startupTimer) clearTimeout(this.startupTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.startupTimer = null; this.reconnectTimer = null;
        this.queues.clear();
        const socket = this.socket;
        this.socket = null;
        socket?.terminate();
        console.error('Market processing paused; health reporting remains active. Confirm lawful Binance access before restarting.');
        if (this.running && !this.observeOnly) void this.heartbeat('ERROR').catch(() => {
          console.error('Could not report paused market status to the app; check the website address and matching engine key.');
        });
      }
    } else console.error(this.lastError);
  }
  private recordSuccessfulScan() {
    const times = [...this.available.keys()].map((s) => this.checkpoints.get(s)?.state.lastTime);
    if (times.length && times.every((t): t is number => t !== undefined && t !== null)) {
      // Slowest durable feed; never call a wall-clock poll a completed candle scan.
      this.lastScanAt = Math.min(...times) + MINUTE;
    }
  }
  private telemetry() {
    return { host_kind: this.hostKind, started_at: this.startedAt === null ? null : new Date(this.startedAt).toISOString(),
      uptime_seconds: this.startedAt === null ? 0 : Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      scanned_symbols: [...this.available.keys()].filter((s) => this.checkpoints.has(s)).length,
      last_scan_at: this.lastScanAt === null ? null : new Date(this.lastScanAt).toISOString() };
  }
  snapshot() { return { connected: this.connected, configured: SYMBOLS.length, available: this.available.size,
    running: this.running && this.initialized && !this.marketPaused, process_alive: this.running, market_paused: this.marketPaused,
    initialized: this.initialized, error: this.lastError, ...this.telemetry(),
    receivedAt: this.lastMessage, markets: [...this.markets.values()], counts: [...this.checkpoints].map(([symbol, row]) => ({ symbol, candles: row.state.count, lastTime: row.state.lastTime })) }; }
  disconnectForTest() { this.socket?.terminate(); }
  async stop() {
    const wasRunning = this.running;
    this.running = false; this.connected = false;
    for (const timer of this.timers) clearInterval(timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.socket?.terminate();
    await this.heartbeatInFlight?.catch(() => undefined);
    if (wasRunning && this.ownedLease && !this.observeOnly) {
      await this.app('stop', { instance_id: this.instance }).catch((e) => this.fail(e));
      this.ownedLease = false;
    }
  }
}