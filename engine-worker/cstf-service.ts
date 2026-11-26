import { CSTF_INTERVAL, CSTF_SYMBOLS, initialCstf, processCstf, type CstfSignal, type CstfState, type CstfSymbol } from '../src/lib/engine/cstf';
import { initialCstfAccount, processCstfAccount, type AccountState, type Brackets, type MinuteFrame } from '../src/lib/engine/cstf-account';
import { CSTF_MAX_BATCH, CSTF_WARM_BARS, CstfBatch, cstfStateSchema, frameMode, fundingByMinute, parseBrackets, signalBarFor, warmBars } from '../src/lib/engine/cstf-live';
import { MINUTE, type Candle } from '../src/lib/engine/model';
import { BinanceRequestError, binanceFetch, restCandle } from './binance';

/** prompt-74: live CSTF v4 Strong Trend 30m paper Simulator. Polls closed Binance USD-M candles for all 22 coins and
 * advances ONE shared cross-margin account minute by minute, committing each batch atomically under the worker lease. */
export interface CstfHost {
  app<T>(action: string, data: unknown): Promise<T>;
  instance: string; leaseOwned: boolean; marketAccessPaused: boolean; reportMarketFailure(e: unknown): void;
}
const BRACKETS_URL = 'https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets';
const FUNDING_GRACE_MS = 15 * MINUTE;

async function pool<T, R>(items: readonly T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k] as T); } }));
  return out;
}

export class CstfService {
  private state: AccountState | null = null; private revision = 0;
  private indicators = new Map<CstfSymbol, CstfState>();
  private brackets: Brackets | null = null; private bracketsAt = 0;
  private expectedFunding = new Map<CstfSymbol, Set<number>>();
  private timer: ReturnType<typeof setTimeout> | null = null; private running = false; private busy = false;
  private lastStatus = ''; readonly abort = new AbortController();
  lastError: string | null = null; lastCommitAt = 0;
  constructor(private readonly host: CstfHost, private readonly log = (m: string) => console.log(m)) {}

  start() { if (this.running) return; this.running = true; this.schedule(1000); }
  stop() { this.running = false; this.abort.abort(); if (this.timer) clearTimeout(this.timer); }
  get account() { return this.state; }
  /** prompt-79: the user stopped the crypto Simulator. Stop polling for good; saved history is untouched. */
  private halt() { if (!this.running) return; this.log(JSON.stringify({ event: 'cstf_stopped_by_user' })); this.stop(); }
  private schedule(ms: number) { if (this.running) this.timer = setTimeout(() => { void this.tick().finally(() => this.schedule(5000)); }, ms); }

  private async kl(path: '/fapi/v1/klines' | '/fapi/v1/markPriceKlines', symbol: string, interval: '1m' | '30m', start: number, end: number): Promise<Candle[]> {
    const span = interval === '1m' ? MINUTE : CSTF_INTERVAL; const out: Candle[] = [];
    for (let from = start; from < end;) {
      const q = new URLSearchParams({ symbol, interval, limit: '1500', startTime: String(from), endTime: String(end - 1) });
      const rows = await binanceFetch(`${path}?${q}`, this.abort.signal);
      if (!Array.isArray(rows)) throw new Error('Malformed Binance candles');
      const page = rows.map((r) => restCandle(r, span)).filter((c) => c.time >= from && c.time < end && c.time + span <= Date.now());
      out.push(...page);
      if (rows.length < 1500 || !page.length) break;
      from = (page.at(-1)?.time ?? end) + span;
    }
    return out;
  }
  private async status(status: string, error: string | null) {
    const key = `${status}|${error}`; if (key === this.lastStatus) return;
    await this.host.app('cstf-status', { instance_id: this.host.instance, status, error }).then(() => { this.lastStatus = key; }).catch(() => undefined);
  }
  private async load() {
    const r = await this.host.app<{ revision: number; state: unknown; stopped?: boolean }>('cstf-state', {});
    if (r.stopped) { this.halt(); return; }
    this.state = r.state === null ? initialCstfAccount() : cstfStateSchema.parse(r.state) as AccountState; this.revision = r.revision;
    this.indicators.clear();
  }
  private async warm(nextFrame: number) {
    const end = Math.floor(nextFrame / CSTF_INTERVAL) * CSTF_INTERVAL;
    await pool(CSTF_SYMBOLS, 4, async (s) => {
      const bars = warmBars(await this.kl('/fapi/v1/klines', s, '30m', end - (CSTF_WARM_BARS + 1) * CSTF_INTERVAL, end), nextFrame);
      if (bars.length < 200) throw new Error(`${s}: insufficient 30m history for the indicator`);
      const st = initialCstf(); for (const b of bars) processCstf(st, s, b, b.time + CSTF_INTERVAL); this.indicators.set(s, st);
    });
    this.log(JSON.stringify({ event: 'cstf_warm', next_frame: new Date(nextFrame).toISOString(), coins: this.indicators.size }));
  }
  private async refreshBrackets() {
    if (this.brackets && Date.now() - this.bracketsAt < 6 * 3_600_000) return;
    try {
      const res = await fetch(BRACKETS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.brackets = parseBrackets(await res.json()); this.bracketsAt = Date.now();
    } catch (e) { if (!this.brackets) throw new Error(`Binance maintenance tiers unavailable: ${e instanceof Error ? e.message : e}`); }
  }
  private async refreshFundingSchedule() {
    const rows = await binanceFetch('/fapi/v1/premiumIndex', this.abort.signal) as { symbol: string; nextFundingTime: number }[];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!(CSTF_SYMBOLS as readonly string[]).includes(r.symbol) || !(Number(r.nextFundingTime) > 0)) continue;
      const set = this.expectedFunding.get(r.symbol as CstfSymbol) ?? new Set<number>(); set.add(Number(r.nextFundingTime));
      for (const t of set) if (t < Date.now() - 2 * 86_400_000) set.delete(t);
      this.expectedFunding.set(r.symbol as CstfSymbol, set);
    }
  }

  async tick() {
    if (this.busy || !this.running || !this.host.leaseOwned || this.host.marketAccessPaused) return;
    this.busy = true; let restore: Map<CstfSymbol, CstfState> | null = null;
    try {
      if (!this.state) await this.load();
      if (!this.running) return;
      const state0 = this.state; if (!state0) return;
      const latest = Math.floor((Date.now() - 3000) / MINUTE) * MINUTE - MINUTE;
      const first = state0.lastMinute === null ? latest : state0.lastMinute + MINUTE;
      if (first > latest) return;
      await this.refreshBrackets(); const brackets = this.brackets; if (!brackets) return;
      if (this.indicators.size !== CSTF_SYMBOLS.length) await this.warm(first);
      await this.refreshFundingSchedule().catch((e) => { if (e instanceof BinanceRequestError && e.pausesMarket) throw e; });
      const end = Math.min(latest, first + (CSTF_MAX_BATCH - 1) * MINUTE);
      const lastBar = Math.floor(end / CSTF_INTERVAL) * CSTF_INTERVAL - CSTF_INTERVAL;
      const data = new Map<CstfSymbol, { last: Map<number, Candle>; mark: Map<number, Candle>; bars: Map<number, Candle> }>();
      await pool(CSTF_SYMBOLS, 6, async (s) => {
        const [last, mark] = await Promise.all([this.kl('/fapi/v1/klines', s, '1m', first, end + MINUTE), this.kl('/fapi/v1/markPriceKlines', s, '1m', first, end + MINUTE)]);
        const from = (this.indicators.get(s)?.lastTime ?? lastBar) + CSTF_INTERVAL;
        const bars = from <= lastBar ? await this.kl('/fapi/v1/klines', s, '30m', from, lastBar + CSTF_INTERVAL) : [];
        data.set(s, { last: new Map(last.map((c) => [c.time, c])), mark: new Map(mark.map((c) => [c.time, c])), bars: new Map(bars.map((c) => [c.time, c])) });
      });
      const funding = new Map<CstfSymbol, Map<number, number[]>>();
      const fundingFor = async (s: CstfSymbol) => {
        let m = funding.get(s); if (m) return m;
        const q = new URLSearchParams({ symbol: s, startTime: String(first), endTime: String(end + MINUTE - 1), limit: '1000' });
        const rows = await binanceFetch(`/fapi/v1/fundingRate?${q}`, this.abort.signal);
        m = fundingByMinute(Array.isArray(rows) ? rows : []); funding.set(s, m); return m;
      };
      restore = new Map([...this.indicators].map(([k, v]) => [k, structuredClone(v)]));
      const batch = new CstfBatch(first); let state = state0; let stopReason: string | null = null;
      for (let t = first; t <= end; t += MINUTE) {
        const frame: MinuteFrame = { time: t, last: {} as MinuteFrame['last'], mark: {} as MinuteFrame['mark'], funding: {}, signals: [], mode: frameMode(t, Date.now()) };
        for (const s of CSTF_SYMBOLS) { const d = data.get(s); const l = d?.last.get(t); const m = d?.mark.get(t); if (!l || !m) { stopReason = `waiting for ${s} ${new Date(t).toISOString()} candle`; break; } frame.last[s] = l; frame.mark[s] = m; }
        if (stopReason) break;
        for (const s of new Set(state.positions.map((p) => p.signal.symbol))) {
          const rates = (await fundingFor(s)).get(t) ?? [];
          const due = [...(this.expectedFunding.get(s) ?? [])].some((x) => x >= t && x < t + MINUTE);
          if (due && !rates.length && Date.now() - t < FUNDING_GRACE_MS) { stopReason = `waiting for ${s} funding rate`; break; }
          frame.funding[s] = rates;
        }
        if (stopReason) break;
        const bar = signalBarFor(t); const signals: CstfSignal[] = [];
        if (bar !== null) {
          const missing = CSTF_SYMBOLS.find((s) => (this.indicators.get(s)?.lastTime ?? -1) < bar && !data.get(s)?.bars.get(bar));
          if (missing) { stopReason = `waiting for ${missing} 30m candle`; break; }
          for (const s of CSTF_SYMBOLS) { const st = this.indicators.get(s); const c = data.get(s)?.bars.get(bar); if (st && c) signals.push(...processCstf(st, s, c, t)); }
        }
        frame.signals = signals;
        const result = processCstfAccount(state, frame, brackets); state = result.state;
        batch.add(result, frame.mode, Object.fromEntries(CSTF_SYMBOLS.map((s) => [s, frame.mark[s].close])) as Record<CstfSymbol, number>);
      }
      if (!batch.frames) { if (stopReason && Date.now() - (first + MINUTE) > 3 * MINUTE) await this.status('WAITING', stopReason); restore = null; return; }
      const r = await this.host.app<{ conflict: boolean; revision: number; stopped?: boolean }>('cstf-commit', batch.payload(this.host.instance, this.revision, state));
      if (r.stopped) { restore = null; this.halt(); return; }
      if (r.conflict) throw new Error('Simulator account revision conflict');
      this.state = state; this.revision = r.revision; restore = null; this.lastCommitAt = Date.now(); this.lastError = null; this.lastStatus = 'RUNNING|null';
      if (batch.opened.length || batch.closed.length || batch.mode === 'recovery') this.log(JSON.stringify({ event: 'cstf_commit', mode: batch.mode, frames: batch.frames,
        through: new Date(end).toISOString(), opened: batch.opened.length, closed: batch.closed.length, skipped: batch.skipped.length, wallet: state.wallet, open: state.positions.length }));
    } catch (e) {
      if (restore) this.indicators = restore;
      if (e instanceof BinanceRequestError && e.pausesMarket) { this.host.reportMarketFailure(e); return; }
      if (this.abort.signal.aborted) return;
      this.lastError = e instanceof Error ? e.message.slice(0, 400) : 'Simulator processing error';
      console.error(`CSTF Simulator: ${this.lastError}`);
      this.state = null; this.indicators.clear(); // re-read durable state; never reuse a possibly stale revision
      await this.status('ERROR', this.lastError);
    } finally { this.busy = false; }
  }
}
