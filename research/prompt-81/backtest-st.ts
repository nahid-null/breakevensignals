// prompt-81 offline 7-day backtest of the SuperTrend (5 / hl2 / 1.6, 30m) continuous-reversal Simulator.
// Uses the SAME pure modules as the live worker (processSt + processStAccount) on real Binance USD-M Futures data:
// Binance SPOT 30m candles for SuperTrend signals (user's TradingView chart), USD-M Futures 1m last-price candles for entries/exits, 1m mark-price candles for cross liquidation,
// real funding rates and Binance maintenance tiers. Raw data is frozen under data/ with SHA-256 hashes.
// Usage: bun research/prompt-81/backtest-st.ts [--refresh]   (no database, no Telegram)
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ST_INTERVAL, ST_SYMBOLS, initialSt, processSt, type StSignal, type StState, type StSymbol } from '../../src/lib/engine/supertrend';
import { ST_RULES, initialStAccount, processStAccount, stMainBalance, stUnrealized, type StBrackets, type StClose, type StMinuteFrame, type StPosition } from '../../src/lib/engine/st-account';
import { ST_WARM_BARS, parseStBrackets, stDuration } from '../../src/lib/engine/st-live';
import { MINUTE, type Candle } from '../../src/lib/engine/model';

const DAY = 86_400_000;
const WINDOW_END = Date.UTC(2026, 10, 27); // 2026-11-27 00:00 UTC
const WINDOW_START = WINDOW_END - 7 * DAY; // 2026-11-20 00:00 UTC
const DIR = new URL('./data/', import.meta.url);
const refresh = process.argv.includes('--refresh');

async function get(url: string): Promise<unknown> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url); if (r.ok) return r.json();
    if (r.status === 451 || r.status === 418) throw new Error(`Binance refused (${r.status})`);
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error(`Failed ${url}`);
}
async function klines(path: string, symbol: string, interval: '1m' | '30m', start: number, end: number): Promise<Candle[]> {
  const span = interval === '1m' ? MINUTE : ST_INTERVAL; const out: Candle[] = []; const spot = path === '/api/v3/klines'; const limit = spot ? 1000 : 1500;
  for (let from = start; from < end;) {
    const rows = await get(`${spot ? 'https://data-api.binance.vision' : 'https://fapi.binance.com'}${path}?symbol=${symbol}&interval=${interval}&limit=${limit}&startTime=${from}&endTime=${end - 1}`) as unknown[][];
    const page = rows.map((r) => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) })).filter((c) => c.time >= from && c.time + span <= end);
    out.push(...page); if (rows.length < limit || !page.length) break; from = page.at(-1)!.time + span;
  }
  return out;
}
interface Frozen { symbol: string; signalSource: 'spot'; bars30: Candle[]; last1: Candle[]; mark1: Candle[]; funding: { fundingTime: number; fundingRate: string }[] }
async function load(symbol: StSymbol): Promise<Frozen> {
  const f = new URL(`${symbol}.json`, DIR);
  if (!refresh && existsSync(f)) { const d = JSON.parse(await readFile(f, 'utf8')) as Frozen; if (d.signalSource === 'spot') return d; }
  const bars30 = await klines('/api/v3/klines', symbol, '30m', WINDOW_START - ST_WARM_BARS * ST_INTERVAL, WINDOW_END);
  const last1 = await klines('/fapi/v1/klines', symbol, '1m', WINDOW_START, WINDOW_END);
  const mark1 = await klines('/fapi/v1/markPriceKlines', symbol, '1m', WINDOW_START, WINDOW_END);
  const funding = await get(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&startTime=${WINDOW_START}&endTime=${WINDOW_END - 1}&limit=1000`) as Frozen['funding'];
  const data: Frozen = { symbol, signalSource: 'spot', bars30, last1, mark1, funding };
  await writeFile(f, JSON.stringify(data)); return data;
}
async function brackets(): Promise<StBrackets> {
  const f = new URL('brackets.json', DIR);
  if (!refresh && existsSync(f)) return parseStBrackets(JSON.parse(await readFile(f, 'utf8')));
  const r = await fetch('https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const body = await r.json() as { data: { brackets: { symbol: string }[] } };
  const slim = { data: { brackets: body.data.brackets.filter((b) => (ST_SYMBOLS as readonly string[]).includes(b.symbol)) } };
  await writeFile(f, JSON.stringify(slim)); return parseStBrackets(slim);
}

await mkdir(DIR, { recursive: true });
const tiers = await brackets();
const data = new Map<StSymbol, Frozen>(); for (const s of ST_SYMBOLS) data.set(s, await load(s));
const hashes = Object.fromEntries(await Promise.all([...ST_SYMBOLS.map((s) => `${s}.json`), 'brackets.json'].map(async (n) => [n, createHash('sha256').update(await readFile(new URL(n, DIR))).digest('hex')])));

// Data completeness (never invent prices: a missing minute stops the run and is reported).
const missing: string[] = [];
const idx = new Map<StSymbol, { last: Map<number, Candle>; mark: Map<number, Candle>; bars: Map<number, Candle>; funding: Map<number, number[]> }>();
for (const s of ST_SYMBOLS) {
  const d = data.get(s)!; const funding = new Map<number, number[]>();
  for (const r of d.funding) { const t = Math.floor(Number(r.fundingTime) / MINUTE) * MINUTE; funding.set(t, [...(funding.get(t) ?? []), Number(r.fundingRate)]); }
  idx.set(s, { last: new Map(d.last1.map((c) => [c.time, c])), mark: new Map(d.mark1.map((c) => [c.time, c])), bars: new Map(d.bars30.map((c) => [c.time, c])), funding });
  const m1 = (WINDOW_END - WINDOW_START) / MINUTE; if (d.last1.length !== m1) missing.push(`${s}: ${m1 - d.last1.length} last-price minutes missing`); if (d.mark1.length !== m1) missing.push(`${s}: ${m1 - d.mark1.length} mark-price minutes missing`);
}

// Warm the indicator on bars confirmed before the window; window bars feed the account at their confirmed close.
const ind = new Map<StSymbol, StState>(); const signalsIn = new Map<StSymbol, StSignal[]>();
for (const s of ST_SYMBOLS) {
  const st = initialSt(); for (const b of data.get(s)!.bars30.filter((b) => b.time + ST_INTERVAL < WINDOW_START)) processSt(st, s, b, b.time + ST_INTERVAL);
  ind.set(s, st); signalsIn.set(s, []);
}
let state = initialStAccount(); const closed: StClose[] = []; const opened: StPosition[] = []; const skipped: { signal: StSignal; reason: string }[] = [];
let peak = ST_RULES.startingBalance; let maxDd = 0; let maxDdPct = 0; let minEquity = ST_RULES.startingBalance; let lastEquity = ST_RULES.startingBalance;
const firstMinute = WINDOW_START; let stoppedAt: number | null = null;
for (let t = firstMinute; t < WINDOW_END; t += MINUTE) {
  const frame: StMinuteFrame = { time: t, last: {} as StMinuteFrame['last'], mark: {} as StMinuteFrame['mark'], funding: {}, signals: [], mode: 'live' };
  let gap = false;
  for (const s of ST_SYMBOLS) { const d = idx.get(s)!; const l = d.last.get(t); const m = d.mark.get(t); if (!l || !m) { gap = true; break; } frame.last[s] = l; frame.mark[s] = m; frame.funding[s] = d.funding.get(t) ?? []; }
  if (gap) { stoppedAt = t; missing.push(`stopped at ${new Date(t).toISOString()}: incomplete minute`); break; }
  if (t % ST_INTERVAL === 0) {
    const bar = t - ST_INTERVAL;
    for (const s of ST_SYMBOLS) { const c = idx.get(s)!.bars.get(bar); if (!c) { missing.push(`${s}: 30m bar ${new Date(bar).toISOString()} missing`); continue; } const sig = processSt(ind.get(s)!, s, c, t); signalsIn.get(s)!.push(...sig); frame.signals.push(...sig); }
  }
  const r = processStAccount(state, frame, tiers); state = r.state; closed.push(...r.closed); opened.push(...r.opened); skipped.push(...r.skipped);
  // Drawdown on worst intra-minute mark equity (conservative) and on minute-close equity.
  const worst = state.wallet + state.positions.reduce((v, p) => v + stUnrealized(p, p.side === 'LONG' ? frame.mark[p.symbol].low : frame.mark[p.symbol].high), 0);
  peak = Math.max(peak, r.equity); minEquity = Math.min(minEquity, worst); maxDd = Math.max(maxDd, peak - worst); maxDdPct = Math.max(maxDdPct, peak > 0 ? (peak - worst) / peak : 0); lastEquity = r.equity;
}

const endTime = stoppedAt ?? WINDOW_END; const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
const lastMark = (s: StSymbol) => idx.get(s)!.mark.get(endTime - MINUTE)?.close ?? NaN;
const done = closed; const wins = done.filter((c) => c.net > 0); const losses = done.filter((c) => c.net <= 0);
const durations = done.map((c) => c.time - c.position.entryTime);
const openNow = state.positions.map((p) => ({ ...p, mark: lastMark(p.symbol), unrealized: stUnrealized(p, lastMark(p.symbol)) }));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const perCoin = ST_SYMBOLS.map((s) => {
  const sigs = signalsIn.get(s)!; const c = done.filter((x) => x.position.symbol === s); const o = openNow.find((p) => p.symbol === s);
  return { symbol: s, buy: sigs.filter((x) => x.side === 'LONG').length, sell: sigs.filter((x) => x.side === 'SHORT').length, longs: opened.filter((p) => p.symbol === s && p.side === 'LONG').length, shorts: opened.filter((p) => p.symbol === s && p.side === 'SHORT').length,
    completed: c.length, wins: c.filter((x) => x.net > 0).length, losses: c.filter((x) => x.net <= 0).length, net: sum(c.map((x) => x.net)), fees: sum(c.map((x) => x.position.entryFee + x.exitFee)), funding: sum(c.map((x) => x.position.funding)),
    open: o ? `${o.side} @ ${Number(o.entry.toPrecision(6))}` : 'none', unrealized: o?.unrealized ?? 0 };
});
const result = {
  rules: { indicator: 'SuperTrend (user Pine v4 source) ATR Period 5, Source hl2, Multiplier 1.6, Change ATR method = true (RMA)', timeframe: '30m confirmed close', signalCandles: 'Binance SPOT (matches the user TradingView chart)', executionPrices: 'Binance USD-M Futures', coins: ST_SYMBOLS, ...ST_RULES, entry: 'open of the first 1m candle after the 30m close ± 0.02% slippage', exits: 'opposite SuperTrend signal only (close + immediate reverse); cross-margin liquidation on 1m mark extremes' },
  window: { start: iso(WINDOW_START), end: iso(WINDOW_END), processedThrough: iso(endTime) }, dataHashes: hashes, missingData: missing,
  summary: { buySignals: sum(perCoin.map((c) => c.buy)), sellSignals: sum(perCoin.map((c) => c.sell)), longsOpened: opened.filter((p) => p.side === 'LONG').length, shortsOpened: opened.filter((p) => p.side === 'SHORT').length,
    completed: done.length, wins: wins.length, losses: losses.length, winRate: done.length ? wins.length / done.length : null,
    realizedProfit: sum(wins.map((c) => c.net)), realizedLoss: sum(losses.map((c) => c.net)), netRealized: sum(done.map((c) => c.net)),
    feesPaid: state.fees, fundingPaid: state.funding, startingBalance: ST_RULES.startingBalance, finalMainBalance: stMainBalance(state), finalWallet: state.wallet,
    finalEquity: state.wallet + sum(openNow.map((p) => p.unrealized)), lastMinuteEquity: lastEquity, maxDrawdownUsd: maxDd, maxDrawdownPct: maxDdPct, lowestEquity: minEquity,
    avgDurationMs: durations.length ? sum(durations) / durations.length : null, longestMs: durations.length ? Math.max(...durations) : null, shortestMs: durations.length ? Math.min(...durations) : null,
    openTrades: openNow.length, unrealized: sum(openNow.map((p) => p.unrealized)), liquidations: state.liquidations, liquidationClearance: state.liquidationClearance, skipped: skipped.map((s) => ({ id: s.signal.id, reason: s.reason })) },
  perCoin,
  trades: done.map((c) => ({ id: c.position.id, symbol: c.position.symbol, side: c.position.side, entryTime: iso(c.position.entryTime), entry: c.position.entry, exitTime: iso(c.time), exit: c.price, margin: c.position.margin, leverage: ST_RULES.leverage,
    durationMs: c.time - c.position.entryTime, gross: c.gross, fees: c.position.entryFee + c.exitFee, funding: c.position.funding, net: c.net, reason: c.reason, mainAfter: c.mainAfter, reversedTo: c.reversedTo })),
  open: openNow.map((p) => ({ id: p.id, symbol: p.symbol, side: p.side, entryTime: iso(p.entryTime), entry: p.entry, margin: p.margin, leverage: ST_RULES.leverage, mark: p.mark, unrealized: p.unrealized, funding: p.funding, liquidationPrice: p.liquidationPrice, openForMs: endTime - p.entryTime })),
};
await writeFile(new URL('../../src/lib/supertrend/backtest-81.json', import.meta.url), JSON.stringify(result, null, 1));
const s = result.summary; const $ = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(4)}`;
console.log(JSON.stringify({ ...s, skipped: s.skipped.length, avg: s.avgDurationMs && stDuration(s.avgDurationMs), longest: s.longestMs && stDuration(s.longestMs), shortest: s.shortestMs && stDuration(s.shortestMs), missing }, null, 1));
console.log(perCoin.map((c) => `${c.symbol} buy ${c.buy} sell ${c.sell} L ${c.longs} S ${c.shorts} done ${c.completed} W ${c.wins} L ${c.losses} net ${$(c.net)} open ${c.open} unreal ${$(c.unrealized)}`).join('\n'));
