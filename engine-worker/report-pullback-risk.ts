/**
 * prompt-49 RESEARCH backtest (read-only: no database, no Telegram, live Simulator untouched).
 * Entries: unchanged Pullback setup (Setup B in src/lib/engine/multi-setup.ts), score >= 60, Trend Identify gate — identical
 * candidate pipeline and window to the prompt-48 report (MS_NOW=1794938400000 -> 10-17 Nov 2026 18:00 UTC).
 * Settlement: src/lib/engine/pullback-risk.ts (account-level cross margin, mark-price liquidation, real funding, no time close).
 * Usage: MS_NOW=1794938400000 bun engine-worker/report-pullback-risk.ts [outDir=/tmp/pr-report]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { SYMBOLS } from '../src/lib/config';
import { MINUTE, type Candle, type Signal } from '../src/lib/engine/model';
import { initMtf, updateMtf, snapshot } from '../src/lib/engine/mtf-trend';
import { trendSkip } from '../src/lib/engine/simulator-replay';
import { PINE1, closePine1, openPine1, pine1Exit, pine1Skip, type Pine1Position, type Pine1Trade } from '../src/lib/engine/pine1-cross';
import { MultiSetup } from '../src/lib/engine/multi-setup';
import { PR, simulate, swingPools, pathStudy, type Entry, type ExitRule, type Market, type SimResult, type TradeRecord } from '../src/lib/engine/pullback-risk';
import { binanceFetch, history } from './binance';

const outDir = process.argv[2] ?? '/tmp/pr-report'; const msCache = '/tmp/ms-cache'; const cache = '/tmp/pr-cache';
const Q = 15 * MINUTE; const DAY = 86_400_000;
const now = Number(process.env.MS_NOW ?? Math.floor(Date.now() / Q) * Q);
const main = { from: now - 7 * DAY, to: now }; const start = now - 15 * DAY;
mkdirSync(msCache, { recursive: true }); mkdirSync(cache, { recursive: true });
async function range(symbol: string, a: number, b: number) {
  const f = `${msCache}/${symbol}-${a}-${b}.json`; if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Candle[];
  const all: Candle[] = []; let t = a;
  while (t < b) { const part = (await history(symbol, t, b)).filter((c) => c.time < b); if (!part.length) break; all.push(...part); t = part.at(-1)!.time + MINUTE; }
  const out = all.filter((c, i, x) => i === 0 || c.time > x[i - 1]!.time); writeFileSync(f, JSON.stringify(out)); return out;
}
async function markRange(symbol: string, a: number, b: number) {
  const f = `${cache}/mark-${symbol}-${a}-${b}.json`; if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Candle[];
  const all: Candle[] = []; let t = a;
  while (t < b) { const rows = await binanceFetch(`/fapi/v1/markPriceKlines?symbol=${symbol}&interval=1m&limit=1500&startTime=${t}&endTime=${b - 1}`) as unknown[][];
    if (!rows.length) break; for (const r of rows) all.push({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: 0 });
    t = all.at(-1)!.time + MINUTE; }
  const out = all.filter((c, i, x) => c.time < b && (i === 0 || c.time > x[i - 1]!.time)); writeFileSync(f, JSON.stringify(out)); return out;
}
async function fundingRange(symbol: string, a: number, b: number) {
  const f = `${cache}/funding-${symbol}-${a}-${b}.json`; if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as { fundingTime: number; fundingRate: string }[];
  const rows = await binanceFetch(`/fapi/v1/fundingRate?symbol=${symbol}&startTime=${a}&endTime=${b}&limit=1000`) as { fundingTime: number; fundingRate: string }[];
  writeFileSync(f, JSON.stringify(rows)); return rows;
}

const info = await binanceFetch('/fapi/v1/exchangeInfo') as { symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] };
const market: Market = { last: new Map(), mark: new Map(), funding: new Map(), lows: new Map(), highs: new Map() };
const entries = new Map<number, Entry[]>(); const missing: string[] = []; const hashes: Record<string, string> = {}; const markCoverage: Record<string, number> = {};
const fundingCount: Record<string, number> = {}; let candidates = 0; const trendOf = new Map<string, unknown>();
for (const symbol of SYMBOLS) {
  const meta = info.symbols.find((s) => s.symbol === symbol && s.status === 'TRADING'); if (!meta) { missing.push(symbol); continue; }
  const tick = Number(meta.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize);
  const f15 = await history(symbol, undefined, start, undefined, '15m'); const f5 = await history(symbol, undefined, start, undefined, '5m');
  const mtf = initMtf(start - MINUTE, await history(symbol, undefined, start), f5, f15);
  const det = new MultiSetup(tick); det.seed(f15, f5);
  const bars = await range(symbol, start, now);
  if (bars[0]?.time !== start || bars.length !== (now - start) / MINUTE) throw new Error(`${symbol}: incomplete 1-minute candles`);
  hashes[symbol] = new Bun.CryptoHasher('sha256').update(JSON.stringify(bars)).digest('hex');
  const map = new Map<number, Candle>();
  for (const c of bars) {
    map.set(c.time, c); updateMtf(mtf, c); const trend = snapshot(mtf);
    for (const r of det.step(c)) {
      if (r === null || typeof r === 'string' || c.time < main.from || c.time >= main.to) continue;
      if (trendSkip(trend, r.side)) continue;
      if (!r.setups.includes('B') || r.score < 60) continue;
      candidates++; trendOf.set(`${symbol}-${r.side}-${c.time}`, trend);
      entries.set(c.time, [...(entries.get(c.time) ?? []), { id: `${symbol}-${r.side}-${c.time}`, symbol, side: r.side, time: c.time, price: r.entry, score: r.score, tick }]);
    }
  }
  market.last.set(symbol, map);
  const pools = swingPools(bars); market.lows.set(symbol, pools.lows); market.highs.set(symbol, pools.highs);
  const mk = await markRange(symbol, main.from, main.to); market.mark.set(symbol, new Map(mk.map((c) => [c.time, c]))); markCoverage[symbol] = mk.length;
  const fr = await fundingRange(symbol, main.from, main.to);
  market.funding.set(symbol, new Map(fr.filter((x) => x.fundingTime >= main.from && x.fundingTime < main.to).map((x) => [Math.floor(x.fundingTime / MINUTE) * MINUTE, Number(x.fundingRate)])));
  fundingCount[symbol] = market.funding.get(symbol)!.size;
  console.error(`${symbol}: ${bars.length} candles, ${mk.length} mark, ${fundingCount[symbol]} funding`);
}
for (const list of entries.values()) list.sort((a, b) => b.score - a.score);

// ---- Verification 0: the candidate list reproduces the prompt-48 "Setup B only, score >= 60" result with its old 24h rule ----
function legacy() {
  let balance = new Decimal(PINE1.startBalance); let opens: Pine1Position[] = []; const trades: Pine1Trade[] = [];
  const reserved = (ex?: Pine1Position) => opens.filter((o) => o !== ex).reduce((a, o) => a.plus(o.margin), new Decimal(0));
  for (let t = main.from; t < main.to; t += MINUTE) {
    for (const open of [...opens]) { const c = market.last.get(open.symbol)!.get(t)!; if (t <= open.openedCandle) continue; const r = pine1Exit(open, c);
      if (r) { const done = closePine1(open, r, t, balance, c.close, reserved(open)); trades.push(done); balance = new Decimal(done.balanceAfter); opens = opens.filter((o) => o !== open); } }
    for (const k of entries.get(t) ?? []) {
      const e = { trade_id: k.id, symbol: k.symbol, direction: k.side, entry_price: k.price, mtf_trend: trendOf.get(k.id) } as unknown as Signal;
      if (pine1Skip(e, balance, opens)) continue;
      opens.push(openPine1(e, t, Math.max(k.tick, k.price * 0.0002), balance, reserved()));
    }
  }
  return { closed: trades.length, tp: trades.filter((t) => t.reason === 'TAKE_PROFIT').length, final: Number(balance.toFixed(2)) };
}
const legacyCheck = legacy();

// ---- Five simulations ----
const sims: { name: string; key: string; rule: ExitRule }[] = [
  { name: '100% Threshold', key: 'A_100', rule: { kind: 'fixed', pct: 100 } },
  { name: '200% Threshold', key: 'B_200', rule: { kind: 'fixed', pct: 200 } },
  { name: '300% Threshold', key: 'C_300', rule: { kind: 'fixed', pct: 300 } },
  { name: 'No Forced Exit', key: 'D_NONE', rule: { kind: 'none' } },
  { name: 'Dynamic Liquidity Protection', key: 'E_DYN', rule: { kind: 'dynamic' } },
];
const results = sims.map((s) => ({ ...s, r: simulate(market, entries, { from: main.from, to: main.to, rule: s.rule }) }));
const sensitivity = sims.filter((s) => s.key === 'D_NONE' || s.key === 'E_DYN' || s.key === 'C_300').map((s) => ({ ...s, r: simulate(market, entries, { from: main.from, to: main.to, rule: s.rule, mmr: 0.01 }) }));

// ---- Verification ----
const checks: { check: string; pass: boolean; detail: string }[] = [];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ids = new Set([...entries.values()].flat().map((e) => e.id));
for (const x of results) {
  const r = x.r; const realized = PR.startBalance + sum(r.trades.map((t) => t.pnl));
  checks.push({ check: `${x.name}: final balance = $10 + sum of trade-record PnL`, pass: Math.abs(realized - r.wallet) < 1e-6, detail: `${realized.toFixed(8)} vs ${r.wallet.toFixed(8)}` });
  checks.push({ check: `${x.name}: every trade comes from the Pullback score>=60 candidate list`, pass: r.trades.every((t) => ids.has(t.id)), detail: `${r.trades.length} trades` });
  checks.push({ check: `${x.name}: no time-based exits; unresolved trades never counted as TP`, pass: r.trades.every((t) => ['TAKE_PROFIT', 'RISK_THRESHOLD', 'DYNAMIC_LIQUIDITY_PROTECTION', 'ACCOUNT_LIQUIDATION', 'UNRESOLVED'].includes(t.reason)) && r.trades.filter((t) => t.reason === 'UNRESOLVED').every((t) => t.exitTime === null), detail: '' });
  if (x.rule.kind === 'fixed') { const k = x.rule.pct; const bad = r.trades.filter((t) => t.reason === 'RISK_THRESHOLD').filter((t) => {
      const s = t.side === 'LONG' ? 1 : -1; const thr = t.entryFill - s * t.margin * k / 100 / t.quantity; const c = market.last.get(t.symbol)!.get(t.exitTime! - MINUTE)!;
      const trig = s === 1 ? Math.min(c.open, thr) : Math.max(c.open, thr); const slip = Math.max(t.signalPrice * PR.slipPct, (t.exitPrice! - trig) * -s);
      return Math.abs(t.exitPrice! - (trig - s * slip)) > Math.abs(trig) * 1e-9 || (s === 1 ? c.low > thr : c.high < thr); });
    checks.push({ check: `${x.name}: each threshold exit fills at the threshold price (or the candle open on a gap) minus slippage, on a candle that actually reached it`, pass: bad.length === 0, detail: `${bad.length} mismatches` }); }
  if (x.rule.kind === 'dynamic') { const bad = r.trades.filter((t) => t.reason === 'DYNAMIC_LIQUIDITY_PROTECTION' && (!t.dynamic || t.exitTime! - MINUTE <= t.dynamic.armedTime || (t.maeTime !== null && t.dynamic.armedTime < (t.maeTime ?? 0) && t.dynamic.thresholdPct > t.maePct + 1e-9)));
    checks.push({ check: `${x.name}: protection armed on an earlier candle close than the exit, threshold = max loss recorded up to arming (no future candles)`, pass: bad.length === 0, detail: `${bad.length} violations` }); }
  checks.push({ check: `${x.name}: liquidation decided at account level`, pass: r.trades.filter((t) => t.reason === 'ACCOUNT_LIQUIDATION').length === sum(r.liquidationEvents.map((e) => e.positions.length)), detail: `${r.liquidationEvents.length} events` });
}
if (now === 1794938400000) checks.push({ check: 'Same candidate list reproduces prompt-48 "Setup B only, score >= 60" (103 closed, 98 TP, $47.34) under its old 24-hour rule', pass: legacyCheck.closed === 103 && legacyCheck.tp === 98 && legacyCheck.final === 47.34, detail: JSON.stringify(legacyCheck) });
checks.push({ check: 'Mark-price 1m candles complete for the window', pass: Object.values(markCoverage).every((n) => n === (main.to - main.from) / MINUTE), detail: JSON.stringify(markCoverage) });
if (checks.some((c) => !c.pass)) console.error('VERIFICATION FAILURES', checks.filter((c) => !c.pass));

// ---- Statistics ----
const r2 = (x: number, d = 2) => Number(x.toFixed(d));
const pct = (v: number[], p: number) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i); return r2(s[lo]! + (s[Math.ceil(i)]! - s[lo]!) * (i - lo), 1); };
const mean = (v: number[]) => v.length ? sum(v) / v.length : null;
const hold = (t: TradeRecord) => ((t.exitTime ?? main.to) - t.entryTime) / MINUTE;
function stats(r: SimResult, side?: 'LONG' | 'SHORT') {
  const xs = r.trades.filter((t) => !side || t.side === side); const tp = xs.filter((t) => t.reason === 'TAKE_PROFIT');
  const closed = xs.filter((t) => t.reason !== 'UNRESOLVED'); const mae = xs.map((t) => t.maePct);
  const out: Record<string, number | string | null> = {
    totalTrades: xs.length, tpHits: tp.length, tpHitRatePct: xs.length ? r2(tp.length / xs.length * 100, 1) : 0,
    riskBasedExits: xs.filter((t) => t.reason === 'RISK_THRESHOLD' || t.reason === 'DYNAMIC_LIQUIDITY_PROTECTION').length,
    liquidatedTrades: xs.filter((t) => t.reason === 'ACCOUNT_LIQUIDATION').length, unresolvedTrades: xs.filter((t) => t.reason === 'UNRESOLVED').length,
    avgMaxLossPctOfMargin: mean(mae) === null ? null : r2(mean(mae)!, 1), worstMaxLossPctOfMargin: mae.length ? r2(Math.max(...mae), 1) : null,
    realizedNetPnlUsd: r2(sum(xs.map((t) => t.pnl)), 4), feesUsd: r2(sum(xs.map((t) => t.entryFee + t.exitFee)), 4), fundingPaidUsd: r2(sum(xs.map((t) => t.funding)), 4),
    unresolvedUnrealizedUsd: r2(sum(xs.map((t) => t.unrealizedAtEnd ?? 0)), 4),
    avgHoldMin: closed.length ? Math.round(mean(xs.map(hold))!) : null, maxHoldMin: xs.length ? Math.max(...xs.map(hold)) : null,
  };
  if (!side) Object.assign(out, { maxDrawdownClosePct: r2(r.maxDdClosePct, 1), maxDrawdownIntrabarPct: r2(r.maxDdIntrabarPct, 1), accountLiquidationEvents: r.liquidationEvents.length,
    finalBalanceUsd: r2(r.wallet, 4), equityIncludingUnresolvedUsd: r2(r.equityEnd, 4), totalReturnPct: r2((r.wallet / PR.startBalance - 1) * 100, 1),
    pctTimeAllSlotsBusy: r2(r.minutesAllSlots / r.minutes * 100, 1), slotHoursOccupied: r2(r.slotMinutes / 60, 1),
    missedAllSlotsBusy: r.skips.ALL_SLOTS_IN_USE, missedCoinAlreadyOpen: r.skips.COIN_ALREADY_OPEN, missedInsufficientBalance: r.skips.INSUFFICIENT_BALANCE,
    sameCandleAmbiguities: r.ambiguousCandles });
  return out;
}
const table = results.map((x) => ({ simulation: x.name, ...stats(x.r) }));
const sides = results.flatMap((x) => (['LONG', 'SHORT'] as const).map((s) => ({ simulation: x.name, side: s, ...stats(x.r, s) })));

// MAE path study: every distinct signal entered by at least one simulation, followed alone until TP or window end
const entered = new Map<string, Entry>(); for (const x of results) for (const t of x.r.trades) entered.set(t.id, [...entries.values()].flat().find((e) => e.id === t.id)!);
const paths = [...entered.values()].sort((a, b) => a.time - b.time).map((e) => ({ e, ...pathStudy(market, e, main.to) }));
function maeStats(rows: typeof paths) { const v = rows.map((p) => p.maePct); const tp = rows.filter((p) => p.tpTime !== null);
  return { signals: rows.length, reachedTp: tp.length, neverReachedTp: rows.length - tp.length,
    avg: mean(v) === null ? null : r2(mean(v)!, 1), median: pct(v, 0.5), p75: pct(v, 0.75), p90: pct(v, 0.9), p95: pct(v, 0.95), worst: v.length ? r2(Math.max(...v), 1) : null,
    avgMinEntryToMae: mean(rows.filter((p) => p.maeTime).map((p) => (p.maeTime! - p.e.time - MINUTE) / MINUTE + 1)) === null ? null : Math.round(mean(rows.filter((p) => p.maeTime).map((p) => (p.maeTime! - p.e.time) / MINUTE))!),
    avgMinMaeToTp: mean(tp.filter((p) => p.maeTime).map((p) => (p.tpTime! - p.maeTime!) / MINUTE)) === null ? null : Math.round(mean(tp.filter((p) => p.maeTime).map((p) => (p.tpTime! - p.maeTime!) / MINUTE))!),
    tpAfterAbove: Object.fromEntries(PR.marks.map((k) => [`${k}%`, tp.filter((p) => p.cross[k] !== null).length])),
    allAbove: Object.fromEntries(PR.marks.map((k) => [`${k}%`, rows.filter((p) => p.cross[k] !== null).length])) }; }
const maeAll = maeStats(paths); const maeLong = maeStats(paths.filter((p) => p.e.side === 'LONG')); const maeShort = maeStats(paths.filter((p) => p.e.side === 'SHORT'));
const inSimMae = results.map((x) => { const v = x.r.trades.map((t) => t.maePct); return { simulation: x.name, avg: mean(v) === null ? null : r2(mean(v)!, 1), median: pct(v, 0.5), p75: pct(v, 0.75), p90: pct(v, 0.9), p95: pct(v, 0.95), worst: v.length ? r2(Math.max(...v), 1) : null }; });

// Dynamic results
const dyn = results.find((x) => x.key === 'E_DYN')!.r; const none = results.find((x) => x.key === 'D_NONE')!.r;
const dynExits = dyn.trades.filter((t) => t.reason === 'DYNAMIC_LIQUIDITY_PROTECTION'); const dv = dynExits.map((t) => -t.pnl / t.margin * 100);
const noneLiq = new Set(none.trades.filter((t) => t.reason === 'ACCOUNT_LIQUIDATION').map((t) => t.id));
const dynamicSummary = { closedByProtection: dynExits.length, avgMarginLossPctAtExit: mean(dv) === null ? null : r2(mean(dv)!, 1), medianMarginLossPctAtExit: pct(dv, 0.5), maxMarginLossPctAtExit: dv.length ? r2(Math.max(...dv), 1) : null,
  reachedTpWithoutProtection: dyn.trades.filter((t) => t.reason === 'TAKE_PROFIT' && !t.dynamic).length, reachedTpAfterArming: dyn.trades.filter((t) => t.reason === 'TAKE_PROFIT' && t.dynamic).length,
  closedBeforeTp: dynExits.length, armedButStillOpenAtEnd: dyn.trades.filter((t) => t.reason === 'UNRESOLVED' && t.dynamic).length,
  protectedTradesLiquidatedInNoForcedExitSim: dynExits.filter((t) => noneLiq.has(t.id)).length,
  accountLiquidationEvents: dyn.liquidationEvents.length, armedByAccountCushion: dyn.trades.filter((t) => t.dynamic?.trigger === 'ACCOUNT_CUSHION').length,
  armedByLiquidityPoolBreak: dyn.trades.filter((t) => t.dynamic?.trigger === 'LIQUIDITY_POOL_BREAK').length };
const realistic = table.filter((x) => (x.accountLiquidationEvents as number) === 0);
const best = [...table].sort((a, b) => (b.finalBalanceUsd as number) - (a.finalBalanceUsd as number))[0]!;
const summary = { window: { from: new Date(main.from).toISOString(), to: new Date(main.to).toISOString() }, coinsTested: SYMBOLS.length - missing.length, missing,
  candidatesPassingAllEntryRules: candidates, assumptions: { ...PR, maintenanceMarginRate: PR.mmr, liquidation: 'account-level, mark price, all positions at their worst mark of the candle simultaneously' },
  fundingEventsPerCoin: fundingCount, candleSha256: hashes, legacyReproduction: legacyCheck, comparison: table, longVsShort: sides,
  maePathStudy: { all: maeAll, long: maeLong, short: maeShort }, inSimulationMae: inSimMae, dynamic: dynamicSummary,
  sensitivityMaintenance1pct: sensitivity.map((x) => ({ simulation: x.name, ...stats(x.r) })),
  bestByFinalBalance: best.simulation, profitableWithoutLiquidation: realistic.filter((x) => (x.realizedNetPnlUsd as number) > 0).map((x) => x.simulation), verification: checks };

// ---- Files ----
mkdirSync(outDir, { recursive: true });
const iso = (t: number | null | undefined) => t == null ? '' : new Date(t).toISOString();
const csv = (rows: Record<string, unknown>[]) => { const cols = Object.keys(rows[0] ?? {}); return [cols.join(','), ...rows.map((r) => cols.map((c) => { const v = r[c]; const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(','))].join('\n') + '\n'; };
const label: Record<string, string> = { TAKE_PROFIT: 'Take profit hit', RISK_THRESHOLD: 'Risk threshold exit', DYNAMIC_LIQUIDITY_PROTECTION: 'Dynamic Liquidity Protection', ACCOUNT_LIQUIDATION: 'Account liquidation', UNRESOLVED: 'Unresolved (still open at end)' };
writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${outDir}/comparison.csv`, csv(table));
writeFileSync(`${outDir}/long-vs-short.csv`, csv(sides));
writeFileSync(`${outDir}/trades.csv`, csv(results.flatMap((x) => x.r.trades.map((t) => ({
  simulation: x.name, trade_id: t.id, coin: t.symbol, direction: t.side, score: t.score, entry_utc: iso(t.entryTime), signal_price: t.signalPrice, entry_fill: r2(t.entryFill, 8),
  account_balance_before: r2(t.balanceBefore, 6), initial_margin: r2(t.margin, 6), leverage: PR.leverage, notional: r2(t.notional, 4),
  max_adverse_loss_usd: r2(t.maeUsd, 6), max_adverse_loss_pct_margin: r2(t.maePct, 2), max_adverse_utc: iso(t.maeTime == null ? null : t.maeTime + MINUTE),
  tp_price: r2(t.tpPrice, 8), tp_result: t.reason === 'TAKE_PROFIT' ? 'HIT' : t.reason === 'UNRESOLVED' ? 'NOT YET' : 'NOT HIT',
  exit_price: t.exitPrice == null ? '' : r2(t.exitPrice, 8), exit_utc: iso(t.exitTime), exit_reason: label[t.reason], holding_minutes: hold(t),
  trading_fees_usd: r2(t.entryFee + t.exitFee, 6), funding_fees_usd: r2(t.funding, 6), slippage_usd: r2(t.slippageUsd, 6), liquidation_clearance_usd: r2(t.liquidationClearance, 6),
  net_pnl_usd: r2(t.pnl, 6), unrealized_at_end_usd: t.unrealizedAtEnd == null ? '' : r2(t.unrealizedAtEnd, 6),
  crossed_100: t.crossed[100], crossed_150: t.crossed[150], crossed_200: t.crossed[200], crossed_300: t.crossed[300],
  dynamic_protection_triggered: t.reason === 'DYNAMIC_LIQUIDITY_PROTECTION', account_liquidation: t.reason === 'ACCOUNT_LIQUIDATION', tp_touched_in_exit_candle: t.tpTouchedSameCandle,
}))) ));
writeFileSync(`${outDir}/max-adverse-loss.csv`, csv(paths.map((p) => ({ trade_id: p.e.id, coin: p.e.symbol, direction: p.e.side, entry_utc: iso(p.e.time + MINUTE), signal_price: p.e.price,
  max_adverse_loss_pct_margin: r2(p.maePct, 2), max_adverse_utc: iso(p.maeTime == null ? null : p.maeTime + MINUTE), tp_utc: iso(p.tpTime == null ? null : p.tpTime + MINUTE),
  minutes_entry_to_max_adverse: p.maeTime == null ? '' : (p.maeTime - p.e.time) / MINUTE, minutes_max_adverse_to_tp: p.tpTime == null || p.maeTime == null ? '' : (p.tpTime - p.maeTime) / MINUTE,
  reached_tp_in_window: p.tpTime !== null, above_100: p.cross[100] !== null, above_150: p.cross[150] !== null, above_200: p.cross[200] !== null, above_300: p.cross[300] !== null,
  ...Object.fromEntries(results.map((x) => { const t = x.r.trades.find((y) => y.id === p.e.id); return [`in_sim_${x.key}`, t ? `${label[t.reason]} (${r2(t.maePct, 1)}%)` : 'not entered']; })) }))));
writeFileSync(`${outDir}/dynamic-protection.csv`, csv(dyn.trades.filter((t) => t.dynamic).map((t) => ({ trade_id: t.id, coin: t.symbol, direction: t.side, entry_utc: iso(t.entryTime), entry_fill: r2(t.entryFill, 8),
  initial_margin: r2(t.margin, 6), armed_utc: iso(t.dynamic!.armedTime + MINUTE), arming_trigger: t.dynamic!.trigger, account_cushion_pct_at_arming: r2(t.dynamic!.cushionPct, 1),
  liquidity_pool_price_candle_proxy: t.dynamic!.pool ?? '', close_at_arming: t.dynamic!.closeAtArm, recorded_max_loss_pct_threshold: r2(t.dynamic!.thresholdPct, 2), protection_stop_price: r2(t.dynamic!.stopPrice, 8),
  outcome: label[t.reason], exit_utc: iso(t.exitTime), exit_price: t.exitPrice == null ? '' : r2(t.exitPrice, 8), loss_usd_after_costs: t.reason === 'UNRESOLVED' ? '' : r2(-t.pnl, 6),
  loss_pct_margin_after_costs: t.reason === 'UNRESOLVED' ? '' : r2(-t.pnl / t.margin * 100, 1), trading_fees_usd: r2(t.entryFee + t.exitFee, 6), funding_usd: r2(t.funding, 6), slippage_usd: r2(t.slippageUsd, 6),
  same_trade_in_no_forced_exit: (() => { const n = none.trades.find((y) => y.id === t.id); return n ? label[n.reason] : 'not entered'; })() }))));
console.log(JSON.stringify({ ...summary, candleSha256: undefined, longVsShort: undefined }, null, 2));
