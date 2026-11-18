/**
 * prompt-50 RESEARCH backtest (read-only: no database, no Telegram, live Simulator untouched).
 * Engine: src/lib/engine/ai-analyst.ts. Windows are frozen calendar weeks (UTC):
 *   main test   2026-11-10 00:00 -> 2026-11-17 00:00   unseen validation 2026-11-03 00:00 -> 2026-11-10 00:00
 * Open positions may resolve for up to 24h after a window (no new entries). Rules were fixed before either window was run.
 * Data: Binance USD-M 1m klines (with taker-buy volume), 1m mark-price klines, funding history, and data.binance.vision
 * daily bookDepth (+/-1% depth snapshots) and metrics (open interest) archives.
 * Usage: bun engine-worker/report-ai-analyst.ts [outDir=/tmp/aa-report]  (UNIVERSE=broad adds the 40 most liquid perps)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SYMBOLS } from '../src/lib/config';
import { MINUTE, type Candle } from '../src/lib/engine/model';
import { AA, PROFILES, prepare, run, type Bar, type Profile, type RunResult, type SymbolCtx, type Trade } from '../src/lib/engine/ai-analyst';
import { binanceFetch } from './binance';

const outDir = process.argv[2] ?? '/tmp/aa-report'; const cache = '/tmp/aa-cache'; mkdirSync(outDir, { recursive: true }); mkdirSync(cache, { recursive: true });
const DAY = 86_400_000; const H = 60 * MINUTE;
const MAIN = { name: 'main', from: Date.UTC(2026, 10, 10), to: Date.UTC(2026, 10, 17) };
const CHECK = { name: 'unseen', from: Date.UTC(2026, 10, 3), to: Date.UTC(2026, 10, 10) };
const WARM = CHECK.from - 14 * DAY; const END = MAIN.to + DAY;
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const iso = (t: number | null) => (t === null ? '' : new Date(t).toISOString().replace('.000Z', 'Z'));

async function klines(symbol: string, path: 'klines' | 'markPriceKlines', a: number, b: number) {
  const f = `${cache}/${path}-${symbol}-${a}-${b}.json`; if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Bar[];
  const out: Bar[] = []; let t = a;
  while (t < b) {
    const rows = await binanceFetch(`/fapi/v1/${path}?symbol=${symbol}&interval=1m&limit=1500&startTime=${t}&endTime=${b - 1}`) as unknown[][];
    if (!rows.length) break;
    for (const r of rows) out.push({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) || 0, takerBuy: Number(r[9]) || 0 });
    t = out.at(-1)!.time + MINUTE;
  }
  const clean = out.filter((c, i, x) => c.time < b && (i === 0 || c.time > x[i - 1]!.time)); writeFileSync(f, JSON.stringify(clean)); return clean;
}
async function funding(symbol: string, a: number, b: number) {
  const f = `${cache}/funding-${symbol}-${a}-${b}.json`; if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as { fundingTime: number; fundingRate: string }[];
  const rows = await binanceFetch(`/fapi/v1/fundingRate?symbol=${symbol}&startTime=${a}&endTime=${b}&limit=1000`) as { fundingTime: number; fundingRate: string }[];
  writeFileSync(f, JSON.stringify(rows)); return rows;
}
async function archive(kind: 'bookDepth' | 'metrics', symbol: string, day: string): Promise<string | null> {
  const f = `${cache}/${kind}-${symbol}-${day}.csv`; if (existsSync(f)) return readFileSync(f, 'utf8') || null;
  const res = await fetch(`https://data.binance.vision/data/futures/um/daily/${kind}/${symbol}/${symbol}-${kind}-${day}.zip`);
  if (!res.ok) { writeFileSync(f, ''); return null; }
  const z = `${cache}/${kind}-${symbol}-${day}.zip`; writeFileSync(z, new Uint8Array(await res.arrayBuffer()));
  const csv = execSync(`unzip -p ${z}`, { maxBuffer: 64 * 1024 * 1024 }).toString(); writeFileSync(f, csv); execSync(`rm -f ${z}`); return csv;
}
const ts = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z');

const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols: { symbol: string; status: string; contractType: string; quoteAsset: string; filters: Record<string, string>[] }[] };
let universe = [...SYMBOLS] as string[];
if (process.env.UNIVERSE === 'broad') {
  const tick = await binanceFetch('/fapi/v1/ticker/24hr') as { symbol: string; quoteVolume: string }[];
  const perp = new Set(info.symbols.filter((s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT').map((s) => s.symbol));
  const top = tick.filter((t) => perp.has(t.symbol) && t.symbol !== 'BTCUSDT' && !/^(USDC|FDUSD|BUSD|TUSD)/.test(t.symbol)).sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, 40).map((t) => t.symbol);
  universe = [...new Set([...universe, ...top])];
}
const ctxs: SymbolCtx[] = []; const missing: string[] = []; const coverage: Record<string, { candles: number; mark: number; funding: number; depthMinutes: number; oiPoints: number; sha256: string }> = {};
let btc: SymbolCtx | null = null;
for (const symbol of ['BTCUSDT', ...universe]) {
  const meta = info.symbols.find((s) => s.symbol === symbol && s.status === 'TRADING'); if (!meta) { missing.push(symbol); continue; }
  const f = (t: string) => meta.filters.find((x) => x.filterType === t)!;
  const m1 = await klines(symbol, 'klines', WARM, END);
  if (m1[0]?.time !== WARM || m1.length !== (END - WARM) / MINUTE) { missing.push(`${symbol} (incomplete candles: ${m1.length})`); continue; }
  const mk = await klines(symbol, 'markPriceKlines', CHECK.from, END);
  const fr = await funding(symbol, CHECK.from, END);
  const depth = new Map<number, number>(); const oi = new Map<number, number>();
  for (let d = CHECK.from; d < MAIN.to; d += DAY) {
    const csv = await archive('bookDepth', symbol, dayStr(d));
    if (csv) { let cur = 0, bid = 0, ask = 0; for (const line of csv.split('\n').slice(1)) { const [t, p, , n] = line.split(','); if (!t) continue; const tt = ts(t);
        if (tt !== cur) { if (cur && bid + ask > 0) depth.set(Math.floor(cur / MINUTE) * MINUTE, bid / (bid + ask)); cur = tt; bid = 0; ask = 0; }
        if (p === '-1.00') bid = Number(n); if (p === '1.00') ask = Number(n); }
      if (cur && bid + ask > 0) depth.set(Math.floor(cur / MINUTE) * MINUTE, bid / (bid + ask)); }
    const met = await archive('metrics', symbol, dayStr(d));
    if (met) for (const line of met.split('\n').slice(1)) { const [t, , , v] = line.split(','); if (t && v) oi.set(ts(t), Number(v)); }
  }
  const ctx = prepare({ symbol, tick: Number(f('PRICE_FILTER').tickSize), step: Number(f('LOT_SIZE').stepSize), minNotional: Number(f('MIN_NOTIONAL')?.notional ?? 5),
    m1, mark: new Map((mk as Candle[]).map((c) => [c.time, c])), depth, oi,
    funding: new Map(fr.map((x) => [Math.floor(x.fundingTime / MINUTE) * MINUTE, Number(x.fundingRate)])) });
  coverage[symbol] = { candles: m1.length, mark: mk.length, funding: fr.length, depthMinutes: depth.size, oiPoints: oi.size, sha256: new Bun.CryptoHasher('sha256').update(JSON.stringify(m1)).digest('hex') };
  console.error(`${symbol}: ${m1.length} 1m, ${mk.length} mark, ${fr.length} funding, ${depth.size} depth-min, ${oi.size} OI`);
  if (symbol === 'BTCUSDT') btc = ctx; else ctxs.push(ctx);
}

// ---------------- runs ----------------
const profiles: Profile[] = ['standard', 'strict', 'relaxed'];
const runs: { profile: Profile; period: typeof MAIN; r: RunResult }[] = [];
for (const period of [MAIN, CHECK]) for (const profile of profiles) {
  const r = run(ctxs, btc, { from: period.from, to: period.to, end: period.to + DAY, profile });
  runs.push({ profile, period, r }); console.error(`${period.name}/${profile}: ${r.trades.length} trades, wallet ${r.wallet.toFixed(4)}`);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const r4 = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4);
function metrics(x: (typeof runs)[number]) {
  const done = x.r.trades.filter((t) => t.exitReason !== 'UNRESOLVED'); const tp = done.filter((t) => t.exitReason === 'TAKE_PROFIT');
  const wins = done.filter((t) => t.pnl > 0), losses = done.filter((t) => t.pnl <= 0);
  const days: Record<string, { completed: number; long: number; short: number; tp: number; pnl: number; shortfall: number }> = {};
  for (let d = x.period.from; d < x.period.to; d += DAY) days[dayStr(d)] = { completed: 0, long: 0, short: 0, tp: 0, pnl: 0, shortfall: 30 };
  for (const t of done) { const k = dayStr(t.exitTime!); const row = days[k] ?? (days[`${k} (after window)`] ??= { completed: 0, long: 0, short: 0, tp: 0, pnl: 0, shortfall: 0 });
    row.completed++; row[t.side === 'LONG' ? 'long' : 'short']++; if (t.exitReason === 'TAKE_PROFIT') row.tp++; row.pnl = r4(row.pnl + t.pnl)!; }
  for (const [k, v] of Object.entries(days)) if (!k.includes('after')) v.shortfall = Math.max(0, 30 - v.completed);
  const holds = done.map((t) => t.holdMin!); const tpHolds = tp.map((t) => t.holdMin!);
  const within = (h: number) => (done.length ? r4(tp.filter((t) => t.holdMin! <= h * 60).length / done.length * 100) : null);
  const gp = sum(wins.map((t) => t.pnl)), gl = -sum(losses.map((t) => t.pnl));
  const byReason = (k: string) => done.filter((t) => t.exitReason === k).length;
  return {
    period: `${x.period.name} ${iso(x.period.from)} -> ${iso(x.period.to)}`, profile: x.profile, minScore: PROFILES[x.profile].minScore,
    startBalance: AA.startBalance, finalBalance: r4(x.r.wallet), netProfit: r4(x.r.wallet - AA.startBalance), returnPct: r4((x.r.wallet / AA.startBalance - 1) * 100),
    tradesOpened: x.r.trades.length, completed: done.length, stillOpen: x.r.trades.length - done.length, long: done.filter((t) => t.side === 'LONG').length, short: done.filter((t) => t.side === 'SHORT').length,
    takeProfit: tp.length, thesisInvalidExits: byReason('THESIS_INVALID'), emergencyExits: byReason('EMERGENCY_EXIT'), liquidations: byReason('ISOLATED_LIQUIDATION'),
    winRatePct: done.length ? r4(wins.length / done.length * 100) : null, profitFactor: gl > 0 ? r4(gp / gl) : null,
    totalFees: r4(sum(done.map((t) => t.fees))), totalFunding: r4(sum(done.map((t) => t.funding))), totalSlippage: r4(sum(done.map((t) => t.slippageUsd))),
    expectancyPerTrade: done.length ? r4(sum(done.map((t) => t.pnl)) / done.length) : null,
    maxDrawdownPct: r4(x.r.maxDrawdownPct), worstUnrealizedUsd: r4(x.r.worstUnrealizedUsd), worstUnrealizedTime: iso(x.r.worstUnrealizedTime || null),
    avgHoldMin: holds.length ? r4(sum(holds) / holds.length) : null, medianHoldMin: r4(median(holds)), medianTpHoldMin: r4(median(tpHolds)),
    tpWithin1hPct: within(1), tpWithin2hPct: within(2), tpWithin4hPct: within(4),
    avgEstimatedEtaMin: tp.length ? r4(sum(tp.map((t) => t.etaMin)) / tp.length) : null,
    worstTradeUsd: done.length ? r4(Math.min(...done.map((t) => t.pnl))) : null, maxPlannedRiskPctOfEquity: done.length ? r4(Math.max(...x.r.trades.map((t) => t.plannedRiskUsd / t.equityAtEntry * 100))) : null,
    accountHalts: x.r.halts, days, avgPerDay: r4(done.filter((t) => t.exitTime! < x.period.to).length / 7), evaluations: x.r.evaluations, rejections: x.r.rejections,
  };
}
const summary = runs.map(metrics);
// ---------------- verification ----------------
const checks: { check: string; pass: boolean; detail: string }[] = [];
for (const x of runs) {
  const tag = `${x.period.name}/${x.profile}`; const done = x.r.trades.filter((t) => t.exitReason !== 'UNRESOLVED');
  checks.push({ check: `${tag}: final balance = start + sum of completed trade PnL`, pass: Math.abs(AA.startBalance + sum(done.map((t) => t.pnl)) - x.r.wallet) < 1e-9, detail: '' });
  checks.push({ check: `${tag}: planned emergency risk <= 0.5% of equity on every trade`, pass: x.r.trades.every((t) => t.plannedRiskUsd <= t.equityAtEntry * AA.riskPct + 1e-12), detail: '' });
  checks.push({ check: `${tag}: every entry inside the window, decided on a 5m close, R:R >= 1.5`, pass: x.r.trades.every((t) => t.entryTime >= x.period.from && t.entryTime < x.period.to && t.entryTime % (5 * MINUTE) === 0 && t.rr >= AA.minRR - 1e-9), detail: '' });
  checks.push({ check: `${tag}: no fixed-time exits (only TP, thesis, emergency, liquidation or unresolved)`, pass: x.r.trades.every((t) => ['TAKE_PROFIT', 'THESIS_INVALID', 'EMERGENCY_EXIT', 'ISOLATED_LIQUIDATION', 'UNRESOLVED'].includes(t.exitReason)), detail: '' });
  checks.push({ check: `${tag}: emergency level always inside isolated liquidation price`, pass: x.r.trades.every((t) => (t.side === 'LONG' ? t.emergency > t.liqPrice : t.emergency < t.liqPrice)), detail: '' });
  checks.push({ check: `${tag}: never two open positions on one coin, never more than ${AA.maxOpen} open`, pass: (() => { const ev = x.r.trades.flatMap((t) => [[t.entryTime, 1, t.symbol], [t.exitTime ?? Infinity, -1, t.symbol]] as [number, number, string][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const o = new Map<string, number>(); let n = 0; for (const [, d, s] of ev) { n += d; o.set(s, (o.get(s) ?? 0) + d); if (n > AA.maxOpen || o.get(s)! > 1) return false; } return true; })(), detail: '' });
}
// ---------------- outputs ----------------
const csvEsc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cols: (keyof Trade)[] = ['id', 'symbol', 'side', 'score', 'available', 'entryTime', 'entry', 'qty', 'notional', 'leverage', 'margin', 'liqPrice', 'tp', 'invalidation', 'emergency', 'plannedRiskUsd', 'equityAtEntry', 'rr', 'etaMin',
  'exitTime', 'exitPrice', 'exitReason', 'holdMin', 'fees', 'funding', 'slippageUsd', 'pnl', 'maeUsd', 'maePct', 'mfeUsd', 'mfePct', 'balanceAfter', 'entryReason', 'exitDetail'];
for (const x of runs) {
  const rows = x.r.trades.map((t) => cols.map((k) => csvEsc(k === 'entryTime' || k === 'exitTime' ? iso(t[k] as number | null) : typeof t[k] === 'number' ? r4(t[k] as number) : t[k])).join(','));
  writeFileSync(`${outDir}/ai-analyst-${x.period.name}-${x.profile}-trades.csv`, [cols.join(','), ...rows].join('\n'));
}
writeFileSync(`${outDir}/ai-analyst-summary.json`, JSON.stringify({ generatedAt: new Date().toISOString(), parameters: AA, profiles: PROFILES, universe: ctxs.map((c) => c.symbol), contextOnly: 'BTCUSDT', missing, coverage, summary, checks }, null, 2));
console.log(JSON.stringify({ missing, checks: checks.filter((c) => !c.pass), summary: summary.map(({ days, rejections, accountHalts, ...s }) => ({ ...s, days: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, v.completed])), halts: accountHalts.length, topRejections: Object.entries(rejections).sort((a, b) => b[1] - a[1]).slice(0, 8) })) }, null, 1));
