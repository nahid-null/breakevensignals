// prompt-64 offline backtest: live OB STRONG code (ob-strong.ts) + live SQL OBSTRONG5_SPOT rules, no manual closes.
// Never imported by the app or worker; reads cached Binance SPOT candles only.
import { readFileSync, writeFileSync } from 'node:fs';
import { initialObStrong, processObStrong, OBS_SIM } from '../../src/lib/engine/ob-strong';
const RAW = '/tmp/r62/raw'; const ticks = JSON.parse(readFileSync(`${RAW}/ticks.json`, 'utf8'));
type K = { time: number; open: number; high: number; low: number; close: number; volume: number };
const k = (r: any[]): K => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] });
const data: Record<string, { s5: K[]; s1: Map<number, K> }> = {};
for (const sym of OBS_SIM.coins) { const d = JSON.parse(readFileSync(`${RAW}/${sym}.json`, 'utf8'));
  data[sym] = { s5: d.spot5.map(k), s1: new Map(d.spot1.map((r: any[]) => [r[0], k(r)])) }; }
const start = Math.min(...Object.values(data).map((d) => Math.min(...d.s1.keys())));
const end = Math.max(...Object.values(data).map((d) => Math.max(...d.s1.keys()))) + 60_000;
// signals per bar-close time
const sig = new Map<number, { sym: string; dir: 'LONG' | 'SHORT'; entry: number; score: number; time: number }[]>();
let nSig = 0;
for (const sym of OBS_SIM.coins) { const st = initialObStrong();
  for (const c of data[sym]!.s5) { const out = processObStrong(st, c); const close = c.time + 300_000;
    if (close <= start || close > end) continue;
    for (const x of out) { nSig++; const a = sig.get(close) ?? []; a.push({ sym, dir: x.direction, entry: x.entry, score: x.score, time: close }); sig.set(close, a); } } }
type T = { id: number; sym: string; dir: 'LONG' | 'SHORT'; pe: number; m: number; q: number; fee: number; tp: number; liq: number; opened: number; balBefore: number;
  closed?: number; px?: number; why?: string; pnl?: number; balAfter?: number };
let bal = 10; const trades: T[] = []; const skipped: Record<string, number> = {}; let low = bal, peak = bal, maxDd = 0;
const open = () => trades.filter((t) => !t.why);
for (let t = start; t < end; t += 60_000) {
  for (const tr of open()) { const c = data[tr.sym]!.s1.get(t); if (!c || t < tr.opened) continue; const s = tr.dir === 'LONG' ? 1 : -1;
    const liq = s === 1 ? c.low <= tr.liq : c.high >= tr.liq; const tp = s === 1 ? c.high >= tr.tp : c.low <= tr.tp;
    if (liq || tp) { tr.px = liq ? tr.liq : tr.tp; tr.why = liq ? 'LIQUIDATED' : 'TAKE_PROFIT'; tr.closed = t + 60_000;
      tr.pnl = s * (tr.px - tr.pe) * tr.q - tr.fee - tr.px * tr.q * 0.0005; bal += tr.pnl; tr.balAfter = bal; } }
  // floating equity drawdown
  const eq = bal + open().reduce((a, tr) => { const c = data[tr.sym]!.s1.get(t); if (!c) return a; const s = tr.dir === 'LONG' ? 1 : -1;
    const w = s === 1 ? c.low : c.high; return a + s * (w - tr.pe) * tr.q - tr.fee; }, 0);
  peak = Math.max(peak, eq); low = Math.min(low, eq); maxDd = Math.min(maxDd, eq - peak);
  for (const e of sig.get(t + 60_000) ?? []) { const m = Math.round(bal * 0.05 * 1e8) / 1e8;
    const free = bal - open().reduce((a, x) => a + x.m, 0);
    const why = m <= 0 || free < m ? 'NO_BALANCE' : open().length >= 7 ? 'ALL_SLOTS_IN_USE' : null;
    if (why) { skipped[why] = (skipped[why] ?? 0) + 1; continue; }
    const s = e.dir === 'LONG' ? 1 : -1; const slip = ticks[e.sym]; const q = m * 75 / e.entry; const fee = m * 75 * 0.0005;
    const tp = s === 1 ? (e.entry * (1.0005 + 0.5 / 75) + 2 * slip) / 0.9995 : (e.entry * (0.9995 - 0.5 / 75) - 2 * slip) / 1.0005;
    const liq = Math.max(e.entry - s * (free - fee - 0.005 * m * 75) / q, 0);
    trades.push({ id: trades.length + 1, sym: e.sym, dir: e.dir, pe: e.entry, m, q, fee, tp, liq, opened: t + 60_000, balBefore: bal }); }
}
const iso = (x: number) => new Date(x).toISOString().replace('T', ' ').slice(0, 16);
const dur = (ms: number) => { const mn = Math.round(ms / 60000); return `${Math.floor(mn / 60)}h ${mn % 60}m`; };
const done = trades.filter((t) => t.why); const tps = done.filter((t) => t.why === 'TAKE_PROFIT'); const liqs = done.filter((t) => t.why === 'LIQUIDATED');
const lastT = end; const openNow = open().map((tr) => { const c = data[tr.sym]!.s1.get(lastT - 60_000)!; const s = tr.dir === 'LONG' ? 1 : -1;
  return { ...tr, upnl: s * (c.close - tr.pe) * tr.q - tr.fee - c.close * tr.q * 0.0005, age: lastT - tr.opened }; });
const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const csv = ['id,coin,direction,opened_utc,closed_utc,duration,entry,exit,result,margin_usd,profit_usd,margin_gain_pct,balance_before,balance_after,balance_growth_pct',
  ...trades.map((t) => [t.id, t.sym, t.dir, iso(t.opened), t.closed ? iso(t.closed) : 'OPEN', t.closed ? dur(t.closed - t.opened) : dur(lastT - t.opened) + ' (still open)', t.pe, t.px ?? '', t.why ?? 'OPEN',
    t.m.toFixed(4), t.pnl?.toFixed(4) ?? '', t.pnl !== undefined ? (t.pnl / t.m * 100).toFixed(2) : '', t.balBefore.toFixed(4), t.balAfter?.toFixed(4) ?? '', t.balAfter ? ((t.balAfter / t.balBefore - 1) * 100).toFixed(2) : ''].join(','))].join('\n');
writeFileSync('/mnt/documents/prompt64-trades.csv', csv);
const rows = trades.map((t) => `| ${t.id} | ${t.sym.replace('USDT', '')} | ${t.dir} | ${iso(t.opened)} | ${t.closed ? iso(t.closed) : 'still open'} | ${t.closed ? dur(t.closed - t.opened) : dur(lastT - t.opened) + '+'} | ${t.why ?? 'OPEN'} | $${t.m.toFixed(3)} | ${t.pnl !== undefined ? (t.pnl >= 0 ? '+' : '') + '$' + t.pnl.toFixed(3) : '—'} | ${t.pnl !== undefined ? (t.pnl / t.m * 100).toFixed(1) + '%' : '—'} | ${t.balAfter ? '$' + t.balAfter.toFixed(2) : '—'} |`);
const upnl = openNow.reduce((a, x) => a + x.upnl, 0);
const md = `# Prompt-64 — OB STRONG 7-day backtest, no manual closes

Window (UTC): ${iso(start)} → ${iso(end)}. Coins: ${OBS_SIM.coins.map((c) => c.replace('USDT', '')).join(', ')}.
Rules = the live Simulator exactly: OB STRONG 5m on Binance SPOT (same code the scanner runs), $10 start, 7 slots, each trade 5% of current balance, 75x, no stop loss, target +50% of margin after fees, same coin allowed, TP / liquidation checked on SPOT 1-minute candles. **No trade is ever closed by hand** — each stays open until take profit or liquidation.

## Summary
| Item | Value |
|---|---|
| Signals | ${nSig} |
| Trades opened | ${trades.length} |
| Take profit | ${tps.length} |
| Liquidated | ${liqs.length} |
| Still open at end | ${openNow.length} (unrealised ${upnl >= 0 ? '+' : ''}$${upnl.toFixed(2)}) |
| Skipped signals | ${Object.entries(skipped).map(([a, b]) => `${a}: ${b}`).join(', ') || 'none'} |
| Start → end cash balance | $10.00 → $${bal.toFixed(2)} (${((bal / 10 - 1) * 100).toFixed(1)}%) |
| Value incl. open trades | $${(bal + upnl).toFixed(2)} |
| Lowest equity / max drawdown | $${low.toFixed(2)} / −$${(-maxDd).toFixed(2)} |
| Avg margin per trade | $${avg(trades.map((t) => t.m)).toFixed(3)} |
| Avg profit per winning trade | +$${avg(tps.map((t) => t.pnl!)).toFixed(3)} (= +${avg(tps.map((t) => t.pnl! / t.m * 100)).toFixed(1)}% of its margin) |
| Avg balance growth per win | +${avg(tps.map((t) => (t.balAfter! / t.balBefore - 1) * 100)).toFixed(2)}% |
| Avg time to take profit | ${dur(avg(tps.map((t) => t.closed! - t.opened)))} (fastest ${tps.length ? dur(Math.min(...tps.map((t) => t.closed! - t.opened))) : '—'}, slowest ${tps.length ? dur(Math.max(...tps.map((t) => t.closed! - t.opened))) : '—'}) |
${liqs.length ? `| Avg time to liquidation | ${dur(avg(liqs.map((t) => t.closed! - t.opened)))} |\n` : ''}
**How margin grows:** each trade uses 5% of the balance at that moment, so as wins add up, the next trade's margin is bigger. A win returns +50% of that margin (after fees), i.e. about +2.5% of the balance per win.

## Every trade
| # | Coin | Side | Opened | Closed | Time in trade | Result | Margin | Profit | On margin | Balance after |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## About manual closes
Earlier, the 4 old OB + VP trades (DOGE, LINK, NEAR, XRP) were closed by hand on 20 Nov only because "Close all 4 now" was the answer chosen when switching to OB STRONG. The Simulator itself never closes trades by hand: it only closes on take profit or liquidation. This backtest uses no manual closes.

Limits: backtest on past data; fills assume exact target/liquidation price; funding not charged (same as the live Simulator).
`;
writeFileSync('/mnt/documents/prompt64-report.md', md);
console.log(md.split('## Every trade')[0]);
