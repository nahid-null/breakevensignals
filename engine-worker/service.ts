import WebSocket from './websocket';
import { SYMBOLS, INDICATORS, type Symbol } from "../src/lib/config";
import { initialState, ENGINE_VERSION, MINUTE, PARAMETERS, validateCandle, type EngineState, type Candle, type Analysis, type Signal } from "../src/lib/engine/model";
import { processCandle } from "../src/lib/engine/scalper";
import { buildFive, bucketStart, processMinute } from "../src/lib/engine/five-minute";
import type { SimulatorEntry } from "../src/lib/engine/ob-vp";
import { BINANCE_WS, BinanceRequestError, binanceFetch, checkWebSocketAccess, history, delay, backoff } from "./binance";
import { initMtf, snapshot as trendSnapshot, type MtfSnapshot } from "../src/lib/engine/mtf-trend";
import { feedHasLiveEvidence, MESSAGE_MAX_AGE_MS, type FeedHealth } from '../src/lib/engine/feed-health';

type Market = { symbol: Symbol; price: number | null; trend: string; status: string; last_candle_at: string | null;
  long_score: number; short_score: number; error: string | null; mtf_trend?: MtfSnapshot | null };
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
  private socketOpenedAt = 0;
  private checkingSocketAccess = false;
  private feedMessages = new Map<Symbol, FeedHealth['feeds'][number]>();
  private recoverySymbol: Symbol | null = null;
  private failures = 0;
  private lastError: string | null = null;
  private lastRestAt = 0;
  private publishing = false;
  private nextRestProbe = 0;
  private ownedLease = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInFlight: Promise<void> | null = null;
  private readonly marketAbort = new AbortController();
  private recovery = new Set<Symbol>();
  /** Historical 5-minute Pine trades to store with the next commit after the 5-minute engine is built. */
  private adoption = new Map<Symbol, Signal[]>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private startedAt: number | null = null;
  private lastScanAt: number | null = null;
  constructor(private readonly appUrl: string, private readonly secret: string, private readonly observeOnly = false,
    private readonly runtimeMode: 'production' | 'temporary' = 'production',
    private readonly hostKind: 'windows_pc' | 'hosted' | 'temporary' | 'unknown' = 'unknown') {}

  /** Read-only views for the paper robot, which shares this worker's lease and restriction pause. */
  get leaseOwned() { return this.ownedLease && this.running; }
  get marketAccessPaused() { return this.marketPaused; }
  private async app<T>(action: string, data: unknown): Promise<T> {
    if (this.marketPaused && ['commit', 'market', 'deliveries'].includes(action)) throw new Error('Market processing is paused');
    const response = await fetch(`${this.appUrl}/api/public/engine`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}` },
      body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`App rejected ${action} (${response.status})`);
    return response.json() as Promise<T>;
  }
  private async heartbeat(status?: string) {
    // Serialize state reports so a late STARTING response cannot overwrite a restriction.
    while (this.heartbeatInFlight) await this.heartbeatInFlight;
    if (!this.running) return;
    const pending = this.sendHeartbeat(status);
    this.heartbeatInFlight = pending;
    try { await pending; }
    finally { if (this.heartbeatInFlight === pending) this.heartbeatInFlight = null; }
  }
  private async sendHeartbeat(status?: string) {
    if (this.observeOnly) return;
    const currentStatus = this.lastError ? 'ERROR' : status ?? (this.marketReady() ? 'RUNNING' : 'RECOVERING');
    const r = await this.app<{ acquired: boolean }>('heartbeat', { instance_id: this.instance,
      websocket_connected: this.connected && !this.marketPaused, binance_connected: !this.marketPaused && this.lastRestAt > 0 && Date.now() - this.lastRestAt < 90_000,
      available_symbols: this.available.size, status: currentStatus, error: this.lastError, runtime_mode: this.runtimeMode,
      ...this.telemetry() });
    if (!r.acquired) {
      this.running = false; this.connected = false;
      this.marketAbort.abort();
      for (const timer of this.timers) clearInterval(timer);
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (this.startupTimer) clearTimeout(this.startupTimer);
      this.socket?.terminate(); this.ownedLease = false;
      throw new Error("Another engine instance owns the lease");
    }
    this.ownedLease = true;
  }
  private market(symbol: Symbol, state: EngineState, c: Candle, a: Analysis | null, status: string): Market {
    return { symbol, price: c.close, trend: a?.trend ?? 'WAITING', status,
      last_candle_at: new Date(c.time + MINUTE).toISOString(), long_score: a?.longScore ?? 0,
      short_score: a?.shortScore ?? 0, error: null, mtf_trend: state.mtf ? trendSnapshot(state.mtf) : null };
  }
  /** Builds the 15M/5M/1M Trend Identify state as of the close of the candle at lastTime from Binance's own candles. */
  private async trendState(symbol: Symbol, lastTime: number) {
    const end = lastTime + MINUTE;
    const minutes = await history(symbol, undefined, end, this.marketAbort.signal, '1m');
    const fives = await history(symbol, undefined, end, this.marketAbort.signal, '5m');
    const fifteens = await history(symbol, undefined, end, this.marketAbort.signal, '15m');
    if (this.running && !this.marketPaused) this.lastRestAt = Date.now();
    if (fifteens.length < 200 || fives.length < 200 || minutes.length < 200) throw new Error(`${symbol}: insufficient Binance trend history`);
    return initMtf(lastTime, minutes, fives, fifteens);
  }
  /** Warms the original Pine scripts on 5-minute bars up to the saved one-minute candle. */
  private async fiveState(symbol: Symbol, tick: number, lastTime: number) {
    const fives = await history(symbol, undefined, bucketStart(lastTime) + 5 * MINUTE, this.marketAbort.signal, '5m');
    const partial = await history(symbol, bucketStart(lastTime), lastTime + MINUTE, this.marketAbort.signal, '1m');
    if (this.running && !this.marketPaused) this.lastRestAt = Date.now();
    return buildFive(symbol, tick, lastTime, fives, partial);
  }
  private async commit(symbol: Symbol, tentative: EngineState, market: Market, events: Signal[], mode: 'live' | 'warmup' | 'recovery', entries: SimulatorEntry[] = []) {
    if (!this.running || this.marketPaused) return;
    const previous = this.checkpoints.get(symbol);
    if (this.observeOnly) {
      this.checkpoints.set(symbol, { state: tentative, revision: (previous?.revision ?? 0) + 1 });
      this.markets.set(symbol, market);
      this.recordCommit(symbol, tentative, mode);
      return;
    }
    try {
      // The OB + Weighted VP state stays in memory (rebuilt from Binance after restart) to keep each checkpoint small.
      const { obvp: _obvp, ...checkpoint } = tentative;
      const r = await this.app<{ conflict: boolean; revision: number }>('commit', { instance_id: this.instance,
        symbol, expected_revision: previous?.revision ?? 0, checkpoint, market, events, mode, simulator_entries: entries });
      if (r.conflict) throw new Error("Checkpoint revision conflict");
      this.checkpoints.set(symbol, { state: tentative, revision: r.revision });
      this.markets.set(symbol, market);
      this.recordCommit(symbol, tentative, mode);
    } catch (e) {
      // If the response was lost after commit, re-read durable state. Never reuse a stale revision.
      const r = await this.app<{ checkpoints: { symbol: Symbol; revision: number; state: EngineState }[] }>('state', {});
      const saved = r.checkpoints.find((x) => x.symbol === symbol);
      if (saved) {
        // The saved state never carries OB + Weighted VP; keep ours only when this exact candle was committed, else rebuild later.
        const { obvp: _drop, ...state } = saved.state;
        this.checkpoints.set(symbol, { ...saved, state: saved.state.lastTime === tentative.lastTime && tentative.obvp ? { ...state, obvp: tentative.obvp } : state });
      }
      if (saved?.state.lastTime === tentative.lastTime) { this.markets.set(symbol, market); this.recordCommit(symbol, tentative, mode); return; }
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
    this.timers.push(setInterval(() => {
      if (!this.running || this.marketPaused || !this.socket || !this.connected) return;
      if (Date.now() - (this.lastMessage || this.socketOpenedAt) >= MESSAGE_MAX_AGE_MS) {
        console.error('No validated current Binance candle messages for 60 seconds; reconnecting.');
        this.socket.terminate();
      }
    }, 10_000));
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
    const info = await binanceFetch('/fapi/v1/exchangeInfo', this.marketAbort.signal) as { symbols?: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
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
        const candles = await this.loadHistory(symbol);
        if (!this.running || this.marketPaused) return;
        if (candles.length < 200) throw new Error(`${symbol}: insufficient Binance history`);
        const state = initialState(symbol, tick);
        const first = candles[0];
        if (!first) throw new Error('Empty history');
        state.mtf = await this.trendState(symbol, first.time - MINUTE);
        if (!this.running || this.marketPaused) return;
        let analysis: Analysis | null = null;
        // Pine entries now come from 5-minute bars; the 1-minute replay only feeds trend and display.
        for (const c of candles) analysis = processCandle(state, c, false).analysis;
        const last = candles.at(-1);
        if (!last) throw new Error('Empty history');
        const built = await this.fiveState(symbol, tick, last.time);
        if (!this.running || this.marketPaused) return;
        state.five = built.five;
        state.obvp = built.obvp;
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
        await this.commit(symbol, state, this.market(symbol, state, last, analysis, 'RECOVERING'), [...adopted, ...built.adopted], 'warmup');
      }
      const current = this.checkpoints.get(symbol);
      if (current && !current.state.mtf && current.state.lastTime !== null) {
        // Checkpoints saved without Trend Identify state: rebuild it at the saved candle; it is
        // persisted atomically with the next candle commit. It never gates Pine entries.
        current.state.mtf = await this.trendState(symbol, current.state.lastTime);
        if (!this.running || this.marketPaused) return;
      }
      this.recovery.add(symbol);
      await this.recover(symbol, Date.now());
      console.log(JSON.stringify({ event: 'startup_recovery_progress', symbol,
        durable_candle_at: this.markets.get(symbol)?.last_candle_at ?? null }));
      await delay(100);
    }
    if (!this.running || this.marketPaused) return;
    this.initialized = true;
    this.recordSuccessfulScan();
    this.timers.push(setInterval(() => {
      if (!this.running || this.marketPaused) return;
      void (async () => {
        await this.drain();
        if (this.running && !this.marketPaused && !this.observeOnly) await this.app('deliveries', { instance_id: this.instance });
      })().catch((e) => this.fail(e));
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
      this.connected = true; this.socketOpenedAt = Date.now(); this.lastMessage = 0; this.feedMessages.clear(); this.failures = 0;
      for (const s of this.available.keys()) this.recovery.add(s);
      console.log('Binance Futures WebSocket connected');
      void this.heartbeat().catch((e) => this.fail(e));
    });
    ws.on('message', (raw) => {
      if (!this.running || this.marketPaused || this.socket !== ws) return;
      try {
        const payload = JSON.parse(raw.toString()) as { data?: { s: string; E?: number; k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean; i?: string; s?: string } } };
        const data = payload.data; const k = data?.k;
        const symbol = data?.s as Symbol;
        if (!k || !this.available.has(symbol)) return;
        if ((k.i !== undefined && k.i !== '1m') || (k.s !== undefined && k.s !== symbol) || typeof k.x !== 'boolean') return;
        const c: Candle = { time: k.t, open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
        validateCandle(c);
        const eventTime = data?.E;
        if (typeof eventTime !== 'number' || !Number.isFinite(eventTime)) return;
        const age = Date.now() - eventTime;
        if (age < -5000 || age >= MESSAGE_MAX_AGE_MS || c.time > eventTime || eventTime - c.time > 2 * MINUTE) return;
        if (k.x && c.time + MINUTE > Date.now() + 5000) return;
        const previousFeed = this.feedMessages.get(symbol);
        this.lastMessage = Date.now();
        this.feedMessages.set(symbol, { symbol, message_at: new Date(this.lastMessage).toISOString(), event_at: new Date(eventTime).toISOString(),
          closed_at: k.x ? new Date(c.time + MINUTE).toISOString() : previousFeed?.closed_at ?? null,
          live_commit_at: previousFeed?.live_commit_at ?? null });
        // Intrabar price is display-only. Signal conditions run only for k.x=true.
        const m = this.markets.get(symbol);
        if (m && Number.isFinite(Number(k.c)) && Number(k.c) > 0) m.price = Number(k.c);
        if (!k.x) return;
        const q = this.queues.get(symbol) ?? [];
        if (!q.some((x) => x.time === c.time)) q.push(c);
        // Bound memory. Any omitted candles are recovered from REST, never silently skipped.
        this.queues.set(symbol, q.sort((a, b) => a.time - b.time).slice(-200));
        void this.drain();
      } catch (e) { this.fail(e); }
    });
    ws.on('error', () => {
      if (this.socket === ws && !this.marketPaused) {
        this.lastError = 'Binance WebSocket connection error';
        if (!this.checkingSocketAccess) {
          this.checkingSocketAccess = true;
          void checkWebSocketAccess(streams, this.marketAbort.signal).catch((error) => this.fail(error)).finally(() => { this.checkingSocketAccess = false; });
        }
      }
      ws.terminate();
    });
    if (!('Bun' in globalThis)) ws.on('unexpected-response', (_request, response) => {
      if (this.socket !== ws || !this.running || this.marketPaused) { response.resume(); return; }
      const status = response.statusCode;
      if (status === 451 || status === 418) {
        response.resume();
        this.fail(new BinanceRequestError(status === 451 ? 'restricted' : 'banned', status, '/market/stream', 'Binance rejected the WebSocket connection. Resolve permitted access before restarting.'));
      } else {
        response.resume();
        this.lastError = `Binance WebSocket rejected connection (HTTP ${status ?? 'unknown'})`;
        ws.terminate();
      }
    });
    ws.on('close', () => {
      if (this.socket !== ws) return;
      this.connected = false;
      this.feedMessages.clear(); this.lastMessage = 0;
      for (const s of this.available.keys()) this.recovery.add(s);
      if (this.socket === ws) this.socket = null;
      if (this.running && !this.marketPaused) {
        const wait = backoff(this.failures++); console.log(`WebSocket disconnected; reconnect in ${wait}ms`);
        const reconnect = () => {
          if (!this.running || this.marketPaused) return;
          if (this.checkingSocketAccess) { this.reconnectTimer = setTimeout(reconnect, 500); return; }
          this.connect();
        };
        this.reconnectTimer = setTimeout(reconnect, wait);
      }
    });
  }
  private async accept(symbol: Symbol, c: Candle, mode: 'live' | 'recovery') {
    if (this.marketPaused) return;
    const saved = this.checkpoints.get(symbol);
    if (!saved || c.time <= (saved.state.lastTime ?? -1)) return;
    if ((!saved.state.five || !saved.state.obvp) && saved.state.lastTime !== null) {
      // Checkpoint saved before the 5-minute switch: build it once; its still-open Pine trades are adopted.
      // prompt-51: the OB + Weighted VP state is never saved, so it is rebuilt from Binance's 5-minute bars up to the saved candle.
      const built = await this.fiveState(symbol, saved.state.tickSize, saved.state.lastTime);
      if (!this.running || this.marketPaused) return;
      if (!saved.state.five) { saved.state.five = built.five; this.adoption.set(symbol, built.adopted); }
      saved.state.obvp = built.obvp;
    }
    const tentative = structuredClone(saved.state);
    const result = processMinute(tentative, c);
    if (!this.running || this.marketPaused) return;
    const events = [...(this.adoption.get(symbol) ?? []), ...result.signals];
    await this.commit(symbol, tentative, this.market(symbol, tentative, c, result.analysis, mode === 'live' ? 'LIVE' : 'RECOVERING'), events, mode, result.entries);
    if (this.checkpoints.get(symbol)?.state.five) this.adoption.delete(symbol);
  }
  private async recover(symbol: Symbol, until: number) {
    let saved = this.checkpoints.get(symbol);
    if (!saved || saved.state.lastTime === null) return;
    this.recoverySymbol = symbol;
    while (this.running && !this.marketPaused && saved.state.lastTime !== null && saved.state.lastTime + 2 * MINUTE <= until) {
      const candles = await this.loadHistory(symbol, saved.state.lastTime + MINUTE, until);
      if (!this.running || this.marketPaused) return;
      if (!candles.length) throw new Error(`${symbol}: missing candle recovery incomplete`);
      for (const c of candles) {
        if (!this.running || this.marketPaused) return;
        await this.accept(symbol, c, 'recovery');
      }
      const next = this.checkpoints.get(symbol);
      if (!next || next.state.lastTime === saved.state.lastTime) throw new Error('Recovery made no progress');
      saved = next;
    }
    this.recovery.delete(symbol);
    this.recoverySymbol = null;
  }
  private async drain() {
    if (this.draining || !this.running || this.marketPaused || !this.initialized) return;
    this.draining = true;
    try {
      if (Date.now() >= this.nextRestProbe) {
        this.nextRestProbe = Date.now() + 60_000;
        await binanceFetch('/fapi/v1/time', this.marketAbort.signal);
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
      if (this.marketReady(true)) {
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
      const feed = this.feedMessages.get(market.symbol);
      if (!feed || Date.now() - Date.parse(feed.message_at ?? '') >= MESSAGE_MAX_AGE_MS) continue;
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
        this.marketAbort.abort();
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
    if (!this.marketReady()) return;
    const times = [...this.available.keys()].map((s) => this.checkpoints.get(s)?.state.lastTime);
    if (times.length && times.every((t): t is number => t !== undefined && t !== null)) {
      // Slowest durable feed; never call a wall-clock poll a completed candle scan.
      this.lastScanAt = Math.min(...times) + MINUTE;
    }
  }
  private recordCommit(symbol: Symbol, state: EngineState, mode: 'live' | 'warmup' | 'recovery') {
    const feed = this.feedMessages.get(symbol);
    if (mode === 'live' && feed && state.lastTime !== null) feed.live_commit_at = new Date(state.lastTime + MINUTE).toISOString();
  }
  private async loadHistory(symbol: Symbol, start?: number, end?: number) {
    const candles = await history(symbol, start, end, this.marketAbort.signal);
    if (this.running && !this.marketPaused) this.lastRestAt = Date.now();
    return candles;
  }
  private marketReady(allowPreviousError = false) {
    return this.running && this.initialized && !this.marketPaused && this.connected && (allowPreviousError || !this.lastError)
      && this.recovery.size === 0 && this.available.size > 0 && Date.now() - this.lastRestAt < 90_000
      && [...this.available.keys()].every((s) => {
        const feed = this.feedMessages.get(s);
        const close = (this.checkpoints.get(s)?.state.lastTime ?? 0) + MINUTE;
        return !!feed && feedHasLiveEvidence(feed) && Date.now() - close < 180_000;
      });
  }
  private feedHealth(): FeedHealth {
    return { version: 1, initialized: this.initialized, rest_at: this.lastRestAt ? new Date(this.lastRestAt).toISOString() : null,
      recovery_symbol: this.recoverySymbol, feeds: [...this.available.keys()].map((symbol) => this.feedMessages.get(symbol)
        ?? { symbol, message_at: null, event_at: null, closed_at: null, live_commit_at: null }) };
  }
  private telemetry() {
    return { host_kind: this.hostKind, started_at: this.startedAt === null ? null : new Date(this.startedAt).toISOString(),
      uptime_seconds: this.startedAt === null ? 0 : Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      scanned_symbols: [...this.available.keys()].filter((s) => this.checkpoints.has(s)).length,
      last_scan_at: this.lastScanAt === null ? null : new Date(this.lastScanAt).toISOString(), feed_health: this.feedHealth() };
  }
  snapshot() { return { connected: this.connected, configured: SYMBOLS.length, available: this.available.size,
    running: this.marketReady(), process_alive: this.running, market_paused: this.marketPaused,
    initialized: this.initialized, error: this.lastError, ...this.telemetry(),
    receivedAt: this.lastMessage, markets: [...this.markets.values()], counts: [...this.checkpoints].map(([symbol, row]) => ({ symbol, candles: row.state.count, lastTime: row.state.lastTime })) }; }
  disconnectForTest() { this.socket?.terminate(); }
  async stop() {
    const wasRunning = this.running;
    this.running = false; this.connected = false;
    this.marketAbort.abort();
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