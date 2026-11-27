import { ST_INTERVAL, ST_SYMBOLS, initialSt, processSt, stDirection, type StSignal, type StState, type StSymbol } from '../src/lib/engine/supertrend';
import { initialStAccount, processStAccount, type StAccountState, type StBrackets, type StMinuteFrame } from '../src/lib/engine/st-account';
import { ST_MAX_BATCH, ST_WARM_BARS, StBatch, parseStBrackets, stFrameMode, stSignalBarFor, stStateSchema, stWarmBars, type StCoin } from '../src/lib/engine/st-live';
import { fundingByMinute } from '../src/lib/engine/cstf-live';
import { MINUTE, type Candle } from '../src/lib/engine/model';
import { BINANCE_REST, BINANCE_SPOT_REST, BinanceRequestError, binanceFetch, restCandle } from './binance';

/** prompt-81: live SuperTrend (5 / hl2 / 1.6) 30m continuous-reversal paper Simulator. Polls closed Binance USD-M candles
 * (SPOT 30m for SuperTrend signals, USD-M futures 1m last/mark for execution) for the five coins and advances ONE shared cross-margin account minute by minute, committing each batch atomically
 * under the worker lease. Each coin has its own slot; only an opposite SuperTrend signal closes (and reverses) a trade. */
export interface StHost {
  app<T>(action: string, data: unknown): Promise<T>;
  instance: string; leaseOwned: boolean; marketAccessPaused: boolean; reportMarketFailure(e: unknown): void;
}
const BRACKETS_URL = 'https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets';
const FUNDING_GRACE_MS = 15 * MINUTE;

export class StService {
  private state: StAccountState | null = null; private revision = 0;
  private indicators = new Map<StSymbol, StState>(); private lastSignal = new Map<StSymbol, StSignal>(); private lastPrice = new Map<StSymbol, number>();
  private brackets: StBrackets | null = null; private bracketsAt = 0;
  private expectedFunding = new Map<StSymbol, Set<number>>();
  private timer: ReturnType<typeof setTimeout> | null = null; private running = false; private busy = false;
  private lastStatus = ''; readonly abort = new AbortController();
  lastError: string | null = null; lastCommitAt = 0;
  constructor(private readonly host: StHost, private readonly log = (m: string) => console.log(m)) {}

  start() { if (this.running) return; this.running = true; this.schedule(1500); }
  stop() { this.running = false; this.abort.abort(); if (this.timer) clearTimeout(this.timer); }
  private halt() { if (!this.running) return; this.log(JSON.stringify({ event: 'st_stopped_by_user' })); this.stop(); }
  private schedule(ms: number) { if (this.running) this.timer = setTimeout(() => { void this.tick().finally(() => this.schedule(5000)); }, ms); }

  /** Futures 1m last/mark candles settle trades; SPOT 30m candles (the user's TradingView chart, prompt-81 choice) drive signals. */
  private async kl(path: '/fapi/v1/klines' | '/fapi/v1/markPriceKlines' | '/api/v3/klines', symbol: string, interval: '1m' | '30m', start: number, end: number): Promise<Candle[]> {
    const span = interval === '1m' ? MINUTE : ST_INTERVAL; const out: Candle[] = []; const spot = path === '/api/v3/klines'; const limit = spot ? 1000 : 1500;
    for (let from = start; from < end;) {
      const q = new URLSearchParams({ symbol, interval, limit: String(limit), startTime: String(from), endTime: String(end - 1) });
      const rows = await binanceFetch(`${path}?${q}`, this.abort.signal, spot ? BINANCE_SPOT_REST : BINANCE_REST);
      if (!Array.isArray(rows)) throw new Error('Malformed Binance candles');
      const page = rows.map((r) => restCandle(r, span)).filter((c) => c.time >= from && c.time < end && c.time + span <= Date.now());
      out.push(...page);
      if (rows.length < limit || !page.length) break;
      from = (page.at(-1)?.time ?? end) + span;
    }
    return out;
  }
  private async status(status: string, error: string | null) {
    const key = `${status}|${error}`; if (key === this.lastStatus) return;
    await this.host.app('st-status', { instance_id: this.host.instance, status, error }).then(() => { this.lastStatus = key; }).catch(() => undefined);
  }
  private async load() {
    const r = await this.host.app<{ revision: number; state: unknown; stopped?: boolean }>('st-state', {});
    if (r.stopped) { this.halt(); return; }
    this.state = r.state === null ? initialStAccount() : stStateSchema.parse(r.state) as StAccountState; this.revision = r.revision;
    this.indicators.clear();
  }
  /** Rebuilds each coin's SuperTrend from confirmed history up to (not including) the next unprocessed signal bar. */
  private async warm(nextFrame: number) {
    const end = Math.floor(nextFrame / ST_INTERVAL) * ST_INTERVAL;
    for (const s of ST_SYMBOLS) {
      const bars = stWarmBars(await this.kl('/api/v3/klines', s, '30m', end - (ST_WARM_BARS + 1) * ST_INTERVAL, end), nextFrame);
      if (bars.length < 200) throw new Error(`${s}: insufficient 30m history for SuperTrend`);
      const st = initialSt();
      for (const b of bars) { const sig = processSt(st, s, b, b.time + ST_INTERVAL); if (sig[0]) this.lastSignal.set(s, sig[0]); this.lastPrice.set(s, b.close); }
      this.indicators.set(s, st);
    }
    this.log(JSON.stringify({ event: 'st_warm', next_frame: new Date(nextFrame).toISOString(), coins: this.indicators.size }));
  }
  private async refreshBrackets() {
    if (this.brackets && Date.now() - this.bracketsAt < 6 * 3_600_000) return;
    try {
      const res = await fetch(BRACKETS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.brackets = parseStBrackets(await res.json()); this.bracketsAt = Date.now();
    } catch (e) { if (!this.brackets) throw new Error(`Binance maintenance tiers unavailable: ${e instanceof Error ? e.message : e}`); }
  }
  private async refreshFundingSchedule() {
    const rows = await binanceFetch('/fapi/v1/premiumIndex', this.abort.signal) as { symbol: string; nextFundingTime: number }[];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!(ST_SYMBOLS as readonly string[]).includes(r.symbol) || !(Number(r.nextFundingTime) > 0)) continue;
      const set = this.expectedFunding.get(r.symbol as StSymbol) ?? new Set<number>(); set.add(Number(r.nextFundingTime));
      for (const t of set) if (t < Date.now() - 2 * 86_400_000) set.delete(t);
      this.expectedFunding.set(r.symbol as StSymbol, set);
    }
  }
  private coins(): StCoin[] {
    return ST_SYMBOLS.map((s) => {
      const st = this.indicators.get(s); const d = st ? stDirection(st) : { trend: null, line: null }; const sig = this.lastSignal.get(s);
      return { symbol: s, trend: d.trend, line: d.line, price: this.lastPrice.get(s) ?? null, bar_time: st?.lastTime ?? null, last_signal_side: sig?.side ?? null, last_signal_time: sig?.signalTime ?? null };
    });
  }

  async tick() {
    if (this.busy || !this.running || !this.host.leaseOwned || this.host.marketAccessPaused) return;
    this.busy = true; let restore: { ind: Map<StSymbol, StState>; sig: Map<StSymbol, StSignal>; px: Map<StSymbol, number> } | null = null;
    try {
      if (!this.state) await this.load();
      if (!this.running) return;
      const state0 = this.state; if (!state0) return;
      const latest = Math.floor((Date.now() - 3000) / MINUTE) * MINUTE - MINUTE;
      const first = state0.lastMinute === null ? latest : state0.lastMinute + MINUTE;
      if (first > latest) return;
      await this.refreshBrackets(); const brackets = this.brackets; if (!brackets) return;
      if (this.indicators.size !== ST_SYMBOLS.length) await this.warm(first);
      await this.refreshFundingSchedule().catch((e) => { if (e instanceof BinanceRequestError && e.pausesMarket) throw e; });
      const end = Math.min(latest, first + (ST_MAX_BATCH - 1) * MINUTE);
      const lastBar = Math.floor(end / ST_INTERVAL) * ST_INTERVAL - ST_INTERVAL;
      const data = new Map<StSymbol, { last: Map<number, Candle>; mark: Map<number, Candle>; bars: Map<number, Candle> }>();
      for (const s of ST_SYMBOLS) {
        const [last, mark] = await Promise.all([this.kl('/fapi/v1/klines', s, '1m', first, end + MINUTE), this.kl('/fapi/v1/markPriceKlines', s, '1m', first, end + MINUTE)]);
        const from = (this.indicators.get(s)?.lastTime ?? lastBar) + ST_INTERVAL;
        const bars = from <= lastBar ? await this.kl('/api/v3/klines', s, '30m', from, lastBar + ST_INTERVAL) : [];
        data.set(s, { last: new Map(last.map((c) => [c.time, c])), mark: new Map(mark.map((c) => [c.time, c])), bars: new Map(bars.map((c) => [c.time, c])) });
      }
      const funding = new Map<StSymbol, Map<number, number[]>>();
      const fundingFor = async (s: StSymbol) => {
        let m = funding.get(s); if (m) return m;
        const q = new URLSearchParams({ symbol: s, startTime: String(first), endTime: String(end + MINUTE - 1), limit: '1000' });
        const rows = await binanceFetch(`/fapi/v1/fundingRate?${q}`, this.abort.signal);
        m = fundingByMinute(Array.isArray(rows) ? rows : []); funding.set(s, m); return m;
      };
      restore = { ind: new Map([...this.indicators].map(([k, v]) => [k, structuredClone(v)])), sig: new Map(this.lastSignal), px: new Map(this.lastPrice) };
      const batch = new StBatch(first); let state = state0; let stopReason: string | null = null;
      for (let t = first; t <= end; t += MINUTE) {
        const frame: StMinuteFrame = { time: t, last: {} as StMinuteFrame['last'], mark: {} as StMinuteFrame['mark'], funding: {}, signals: [], mode: stFrameMode(t, Date.now()) };
        for (const s of ST_SYMBOLS) { const d = data.get(s); const l = d?.last.get(t); const m = d?.mark.get(t); if (!l || !m) { stopReason = `waiting for ${s} ${new Date(t).toISOString()} candle`; break; } frame.last[s] = l; frame.mark[s] = m; }
        if (stopReason) break;
        for (const s of new Set(state.positions.map((p) => p.symbol))) {
          const rates = (await fundingFor(s)).get(t) ?? [];
          const due = [...(this.expectedFunding.get(s) ?? [])].some((x) => x >= t && x < t + MINUTE);
          if (due && !rates.length && Date.now() - t < FUNDING_GRACE_MS) { stopReason = `waiting for ${s} funding rate`; break; }
          frame.funding[s] = rates;
        }
        if (stopReason) break;
        const bar = stSignalBarFor(t);
        if (bar !== null) {
          const missing = ST_SYMBOLS.find((s) => (this.indicators.get(s)?.lastTime ?? -1) < bar && !data.get(s)?.bars.get(bar));
          if (missing) { stopReason = `waiting for ${missing} spot 30m candle`; break; }
          for (const s of ST_SYMBOLS) {
            const st = this.indicators.get(s); const c = data.get(s)?.bars.get(bar);
            if (st && c) { const sig = processSt(st, s, c, t); frame.signals.push(...sig); if (sig[0]) this.lastSignal.set(s, sig[0]); }
          }
        }
        const result = processStAccount(state, frame, brackets); state = result.state;
        for (const s of ST_SYMBOLS) this.lastPrice.set(s, frame.last[s].close);
        batch.add(result, frame.mode, Object.fromEntries(ST_SYMBOLS.map((s) => [s, frame.mark[s].close])) as Record<StSymbol, number>);
      }
      if (!batch.frames) { if (stopReason && Date.now() - (first + MINUTE) > 3 * MINUTE) await this.status('WAITING', stopReason); restore = null; return; }
      const r = await this.host.app<{ conflict: boolean; revision: number; stopped?: boolean }>('st-commit', batch.payload(this.host.instance, this.revision, state, this.coins()));
      if (r.stopped) { restore = null; this.halt(); return; }
      if (r.conflict) throw new Error('SuperTrend Simulator revision conflict');
      this.state = state; this.revision = r.revision; restore = null; this.lastCommitAt = Date.now(); this.lastError = null; this.lastStatus = 'RUNNING|null';
      if (batch.opened.length || batch.closed.length || batch.mode === 'recovery') this.log(JSON.stringify({ event: 'st_commit', mode: batch.mode, frames: batch.frames,
        through: new Date(end).toISOString(), opened: batch.opened.length, closed: batch.closed.length, wallet: state.wallet, open: state.positions.length }));
    } catch (e) {
      if (restore) { this.indicators = restore.ind; this.lastSignal = restore.sig; this.lastPrice = restore.px; }
      if (e instanceof BinanceRequestError && e.pausesMarket) { this.host.reportMarketFailure(e); return; }
      if (this.abort.signal.aborted) return;
      this.lastError = e instanceof Error ? e.message.slice(0, 400) : 'Simulator processing error';
      console.error(`SuperTrend Simulator: ${this.lastError}`);
      this.state = null; this.indicators.clear(); // re-read durable state; never reuse a possibly stale revision
      await this.status('ERROR', this.lastError);
    } finally { this.busy = false; }
  }
}
