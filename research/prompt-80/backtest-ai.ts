// Reproducible 7-day causal AI AUD/JPY backtest (prompt-80): NO indicators, raw OHLC price action only.
// Run: bun research/prompt-80/backtest-ai.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cleanMinutes, toM3, type RawRow } from '../../src/lib/forex/candles';
import { FX_RULES, canOpen, settle, tradeMoney, type FxResult, type FxSide } from '../../src/lib/forex/binary-account';
import { sliceCausalBars, type AiTradeDecision } from '../../src/lib/forex/ai-prompt';
import { AI_FOREX_MODEL, requestAiForexDecision } from '../../src/lib/forex/ai-trader.server';

const raw = JSON.parse(readFileSync(new URL('../prompt-78/data/audjpy-1m-yahoo.json', import.meta.url), 'utf8')) as {
  source: string;
  downloaded_at: string;
  rows: RawRow[];
};
const START = Date.UTC(2026, 10, 19) / 1000;
const END = Date.UTC(2026, 10, 26) / 1000;
const STEP_SEC = 1800; // Evaluate every 30 minutes on UTC :00 and :30 M3 candle closes
const CONCURRENCY = 1;

const minutes = cleanMinutes(raw.rows);
const m1 = new Map(minutes.map((b) => [b.t, b]));
const m3 = toM3(minutes);
const m3ByStart = new Map(m3.map((b) => [b.t, b]));
const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z');

const cachePath = new URL('./ai-decisions-cache.json', import.meta.url);
type CachedDecision = AiTradeDecision & { entryT: number; model: string; runId?: string };
const cache: Record<string, CachedDecision> = existsSync(cachePath)
  ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, CachedDecision>)
  : {};

// Build strictly valid checkpoints inside the 7-day window
const checkpoints: number[] = [];
for (let entryT = START; entryT < END; entryT += STEP_SEC) {
  const signalBar = m3ByStart.get(entryT - 180);
  const lastMin = m1.get(entryT - 60);
  const expMin = m1.get(entryT);
  if (!signalBar || signalBar.minutes !== 3 || !lastMin || !expMin) continue;
  checkpoints.push(entryT);
}

console.log(`Checkpoints in 7-day window (every 30m): ${checkpoints.length}, cached: ${Object.keys(cache).length}`);

async function evaluateWithRetry(entryT: number): Promise<CachedDecision> {
  const key = String(entryT);
  const cached = cache[key];
  if (cached) return cached;
  const { m3: h3, m1: h1 } = sliceCausalBars(m3, minutes, entryT, 20, 10);
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await requestAiForexDecision({ m3: h3, m1: h1, entryTimeSec: entryT });
      const saved: CachedDecision = { entryT, action: res.action, confidence: res.confidence, reason: res.reason, model: res.model, ...(res.runId ? { runId: res.runId } : {}) };
      cache[key] = saved;
      return saved;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number; status?: number })?.statusCode ?? (err as { status?: number })?.status;
      if (status !== 429 && !(status != null && status >= 500 && status <= 599)) {
        throw err; // Terminal per ai-gateway-error-semantics
      }
      if (attempt >= 4) throw err;
      const retryAfter = Number((err as { responseHeaders?: Record<string, string> }).responseHeaders?.['retry-after']);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(15_000, 1000 * 2 ** attempt + Math.floor(Math.random() * 500));
      console.warn(`Transient error at ${iso(entryT)} (attempt ${attempt}), retrying in ${waitMs}ms...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// Run missing checkpoints with bounded concurrency
const pending = checkpoints.filter((t) => !cache[String(t)]);
let completed = checkpoints.length - pending.length;
let cursor = 0;
let fatalError: unknown = null;

async function worker() {
  while (true) {
    if (fatalError) return;
    const idx = cursor++;
    if (idx >= pending.length) return;
    const entryT = pending[idx];
    if (entryT == null) return;
    try {
      await evaluateWithRetry(entryT);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      completed++;
      if (completed % 20 === 0 || completed === checkpoints.length) {
        writeFileSync(cachePath, JSON.stringify(cache, null, 2));
        console.log(`Progress: ${completed}/${checkpoints.length}`);
      }
    } catch (err) {
      fatalError = err;
      return;
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
writeFileSync(cachePath, JSON.stringify(cache, null, 2));
if (fatalError) {
  console.error('Backtest halted on terminal error:', fatalError);
  process.exit(1);
}

// Settle all AI trades strictly chronologically under Quotex binary rules
type AiBacktestTrade = {
  n: number;
  signal_time: string;
  entry_time: string;
  expiry_time: string;
  side: FxSide;
  patterns: string[];
  confidence: number;
  reason: string;
  entry: number;
  expiry: number | null;
  stake: number;
  result: FxResult | 'VOID' | 'SKIPPED';
  void_reason?: string;
  would_have?: FxResult | null;
  gross_profit: number;
  fee: number;
  net: number;
  balance_after: number;
};

const trades: AiBacktestTrade[] = [];
let bal = Math.round(FX_RULES.startBalance * 100);
let aiPassed = 0;

for (const entryT of checkpoints) {
  const dec = cache[String(entryT)];
  if (!dec) throw new Error(`Missing AI decision at ${entryT}`);
  if (dec.action === 'SKIP') {
    aiPassed++;
    continue;
  }
  const signalBar = m3ByStart.get(entryT - 180);
  const expMin = m1.get(entryT);
  if (!signalBar || !expMin) throw new Error(`Missing price at ${entryT}`);
  const side: FxSide = dec.action;
  const base = {
    n: trades.length + 1,
    signal_time: iso(signalBar.t),
    entry_time: iso(entryT),
    expiry_time: iso(entryT + 60),
    side,
    patterns: [`AI ${dec.confidence}%`],
    confidence: dec.confidence,
    reason: dec.reason,
    entry: signalBar.c,
    stake: 1,
  };
  if (!canOpen(bal)) {
    trades.push({
      ...base,
      expiry: expMin.c,
      result: 'SKIPPED',
      void_reason: 'Balance below $1 — no trade allowed',
      would_have: settle(side, signalBar.c, expMin.c),
      gross_profit: 0,
      fee: 0,
      net: 0,
      balance_after: bal / 100,
    });
    continue;
  }
  const result = settle(side, signalBar.c, expMin.c);
  const m = tradeMoney(result);
  bal += m.netC;
  trades.push({
    ...base,
    expiry: expMin.c,
    result,
    gross_profit: m.grossProfitC / 100,
    fee: m.feeC / 100,
    net: m.netC / 100,
    balance_after: bal / 100,
  });
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (w: number, l: number) => (w + l > 0 ? Math.round((w * 1000) / (w + l)) / 10 : null);

const days = [] as Record<string, unknown>[];
let running = FX_RULES.startBalance;
for (let d = START; d < END; d += 86400) {
  const date = iso(d).slice(0, 10);
  const ts = trades.filter((t) => t.entry_time.startsWith(date) && t.result !== 'VOID' && t.result !== 'SKIPPED');
  const w = ts.filter((t) => t.result === 'WIN').length;
  const l = ts.filter((t) => t.result === 'LOSS').length;
  const dr = ts.filter((t) => t.result === 'DRAW').length;
  const net = r2(ts.reduce((a, t) => a + t.net, 0));
  const hasData = minutes.some((b) => b.t >= d && b.t < d + 86400);
  days.push({
    date,
    market_open: hasData,
    total: ts.length,
    long: ts.filter((t) => t.side === 'LONG').length,
    short: ts.filter((t) => t.side === 'SHORT').length,
    wins: w,
    losses: l,
    draws: dr,
    win_rate: pct(w, l),
    gross_profit: r2(ts.reduce((a, t) => a + t.gross_profit, 0)),
    fees: r2(ts.reduce((a, t) => a + t.fee, 0)),
    net,
    start_balance: r2(running),
    end_balance: r2(running + net),
    signals: trades.filter((t) => t.entry_time.startsWith(date)).length,
    skipped: trades.filter((t) => t.entry_time.startsWith(date) && t.result === 'SKIPPED').length,
    voided: trades.filter((t) => t.entry_time.startsWith(date) && t.result === 'VOID').length,
  });
  running = r2(running + net);
}

const done = trades.filter((t) => t.result !== 'VOID' && t.result !== 'SKIPPED');
const cnt = (f: (t: AiBacktestTrade) => boolean) => done.filter(f).length;
let streakW = 0, streakL = 0, maxW = 0, maxL = 0;
for (const t of done) {
  if (t.result === 'WIN') { streakW++; streakL = 0; }
  else if (t.result === 'LOSS') { streakL++; streakW = 0; }
  maxW = Math.max(maxW, streakW);
  maxL = Math.max(maxL, streakL);
}
const tradedDays = days.filter((d) => (d.total as number) > 0);
const by = (f: (a: Record<string, unknown>, b: Record<string, unknown>) => number) =>
  ([...tradedDays].sort(f)[0]?.['date'] as string | undefined) ?? null;

const overall = {
  total: done.length,
  wins: cnt((t) => t.result === 'WIN'),
  losses: cnt((t) => t.result === 'LOSS'),
  draws: cnt((t) => t.result === 'DRAW'),
  voided: trades.filter((t) => t.result === 'VOID').length,
  skipped: trades.filter((t) => t.result === 'SKIPPED').length,
  signals: trades.length,
  win_rate: pct(cnt((t) => t.result === 'WIN'), cnt((t) => t.result === 'LOSS')),
  long_trades: cnt((t) => t.side === 'LONG'),
  short_trades: cnt((t) => t.side === 'SHORT'),
  long_win_rate: pct(cnt((t) => t.side === 'LONG' && t.result === 'WIN'), cnt((t) => t.side === 'LONG' && t.result === 'LOSS')),
  short_win_rate: pct(cnt((t) => t.side === 'SHORT' && t.result === 'WIN'), cnt((t) => t.side === 'SHORT' && t.result === 'LOSS')),
  gross_profit: r2(done.reduce((a, t) => a + t.gross_profit, 0)),
  fees: r2(done.reduce((a, t) => a + t.fee, 0)),
  net: r2(done.reduce((a, t) => a + t.net, 0)),
  start_balance: FX_RULES.startBalance,
  final_balance: bal / 100,
  max_consecutive_wins: maxW,
  max_consecutive_losses: maxL,
  best_day: by((a, b) => (b.net as number) - (a.net as number)),
  worst_day: by((a, b) => (a.net as number) - (b.net as number)),
  scanned_checkpoints: checkpoints.length,
  ai_passed: aiPassed,
};

const sk = trades.filter((t) => t.result === 'SKIPPED');
const allPriced = trades.filter((t) => t.result !== 'VOID').map((t) => (t.result === 'SKIPPED' ? t.would_have : t.result));
const info_all_signals = {
  note: 'Information only — not money. What every AI trade call would have scored if the balance had never run out.',
  signals: allPriced.length,
  wins: allPriced.filter((r) => r === 'WIN').length,
  losses: allPriced.filter((r) => r === 'LOSS').length,
  draws: allPriced.filter((r) => r === 'DRAW').length,
  skipped_wins: sk.filter((t) => t.would_have === 'WIN').length,
  skipped_losses: sk.filter((t) => t.would_have === 'LOSS').length,
};

const chart = m3.filter((b) => b.t >= START - 3600 && b.t < END).map((b) => [b.t, b.o, b.h, b.l, b.c]);
const out = {
  meta: {
    title: 'AUD/JPY · AI Price-Action Trader · 1-minute binary expiry · 7-day historical backtest',
    mode: 'HISTORICAL AI BACKTEST (not live)',
    window_utc: [iso(START), iso(END)],
    data_source: raw.source,
    downloaded_at: raw.downloaded_at,
    indicator: 'None — autonomous Lovable AI reading raw OHLC candles only (no indicators)',
    model: AI_FOREX_MODEL,
    method:
      'Every 30 minutes on closed UTC M3 candles, the AI inspects only the last 20 closed M3 and 10 closed M1 raw OHLC candles (zero lookahead, no indicators) and decides LONG, SHORT, or SKIP. Entry = M3 close; expiry = close of the next 1-minute candle.',
    disclosures: [
      'Zero indicators were used: the AI saw only past raw OHLC candles up to each decision time, never future candles.',
      'Exact tick prices were not available, so expiry uses the 1-minute candle close (last quote before entry + 60 s).',
      'Price data is Yahoo Finance AUDJPY=X, which may differ slightly from Quotex or TradingView quotes.',
      'Forex is closed Friday 22:00 to Sunday 22:00 UTC (Saturday Nov 21 and Sunday Nov 22 have no trades).',
    ],
    rules: FX_RULES,
  },
  overall,
  info_all_signals,
  days,
  trades,
  chart,
  ema: [],
  signals_total: trades.length,
};

mkdirSync(new URL('../../src/lib/forex/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../src/lib/forex/data/backtest-80-ai.json', import.meta.url), JSON.stringify(out));
console.log('=== AI 7-DAY BACKTEST OVERALL ===');
console.log(JSON.stringify(overall, null, 2));
console.table(days);
console.log('=== INFO ALL AI CALLS ===');
console.log(info_all_signals);