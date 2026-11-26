// Reproducible 7-day AUD/JPY backtest of the user's CPES indicator on M3 with 1-minute binary expiry.
// Run: bun research/prompt-78/backtest.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { runCpes } from '../../src/lib/forex/cpes';
import { cleanMinutes, toM3, type RawRow } from '../../src/lib/forex/candles';
import { FX_RULES, canOpen, settle, tradeMoney, type FxResult } from '../../src/lib/forex/binary-account';

const raw = JSON.parse(readFileSync(new URL('./data/audjpy-1m-yahoo.json', import.meta.url), 'utf8')) as { source: string; downloaded_at: string; rows: RawRow[] };
const START = Date.UTC(2026, 10, 19) / 1000, END = Date.UTC(2026, 10, 26) / 1000;
const minutes = cleanMinutes(raw.rows);
const m1 = new Map(minutes.map((b) => [b.t, b]));
const m3 = toM3(minutes);
const { signals, series } = runCpes(m3);

type Trade = { n: number; signal_time: string; entry_time: string; expiry_time: string; side: 'LONG' | 'SHORT'; patterns: string[]; entry: number; expiry: number | null; stake: number; result: FxResult | 'VOID' | 'SKIPPED'; void_reason?: string; would_have?: FxResult | null; gross_profit: number; fee: number; net: number; balance_after: number };
const trades: Trade[] = [];
let bal = Math.round(FX_RULES.startBalance * 100);
let lastSignalKey = '';
const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z');
for (const s of signals) {
  const entryT = s.t + FX_RULES.signalTimeframeSec; // signal confirmed at M3 close
  if (entryT < START || entryT >= END) continue;
  const key = `${s.t}-${s.side}`; if (key === lastSignalKey) continue; lastSignalKey = key; // one trade per signal
  const bar = m3[s.index]!;
  const lastMinute = m1.get(s.t + 120);
  const exp = m1.get(entryT); // 1-minute candle [entry, entry+60): its close is the last price at expiry
  const base = { n: trades.length + 1, signal_time: iso(s.t), entry_time: iso(entryT), expiry_time: iso(entryT + 60), side: s.side, patterns: s.patterns, entry: s.price, stake: 1 };
  let voidReason: string | undefined;
  if (!lastMinute) voidReason = 'Signal candle is missing its final minute in the price data, so the exact entry price is unknown';
  else if (!exp) voidReason = 'No price data for the expiry minute';
  if (voidReason) { trades.push({ ...base, expiry: exp?.c ?? null, result: 'VOID', void_reason: voidReason, gross_profit: 0, fee: 0, net: 0, balance_after: bal / 100 }); continue; }
  if (!canOpen(bal)) { trades.push({ ...base, expiry: exp!.c, result: 'SKIPPED', void_reason: 'Balance below $1 — no trade allowed', would_have: settle(s.side, bar.c, exp!.c), gross_profit: 0, fee: 0, net: 0, balance_after: bal / 100 }); continue; }
  const result = settle(s.side, bar.c, exp!.c);
  const m = tradeMoney(result); bal += m.netC;
  trades.push({ ...base, expiry: exp!.c, result, gross_profit: m.grossProfitC / 100, fee: m.feeC / 100, net: m.netC / 100, balance_after: bal / 100 });
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (w: number, l: number) => (w + l > 0 ? Math.round((w * 1000) / (w + l)) / 10 : null);
const days = [] as Record<string, unknown>[];
let running = FX_RULES.startBalance;
for (let d = START; d < END; d += 86400) {
  const date = iso(d).slice(0, 10);
  const ts = trades.filter((t) => t.entry_time.startsWith(date) && t.result !== 'VOID' && t.result !== 'SKIPPED');
  const w = ts.filter((t) => t.result === 'WIN').length, l = ts.filter((t) => t.result === 'LOSS').length, dr = ts.filter((t) => t.result === 'DRAW').length;
  const net = r2(ts.reduce((a, t) => a + t.net, 0));
  const hasData = minutes.some((b) => b.t >= d && b.t < d + 86400);
  days.push({ date, market_open: hasData, total: ts.length, long: ts.filter((t) => t.side === 'LONG').length, short: ts.filter((t) => t.side === 'SHORT').length, wins: w, losses: l, draws: dr, win_rate: pct(w, l), gross_profit: r2(ts.reduce((a, t) => a + t.gross_profit, 0)), fees: r2(ts.reduce((a, t) => a + t.fee, 0)), net, start_balance: r2(running), end_balance: r2(running + net), signals: trades.filter((t) => t.entry_time.startsWith(date)).length, skipped: trades.filter((t) => t.entry_time.startsWith(date) && t.result === 'SKIPPED').length, voided: trades.filter((t) => t.entry_time.startsWith(date) && t.result === 'VOID').length });
  running = r2(running + net);
}
const done = trades.filter((t) => t.result !== 'VOID' && t.result !== 'SKIPPED');
const cnt = (f: (t: Trade) => boolean) => done.filter(f).length;
let streakW = 0, streakL = 0, maxW = 0, maxL = 0;
for (const t of done) { if (t.result === 'WIN') { streakW++; streakL = 0; } else if (t.result === 'LOSS') { streakL++; streakW = 0; } maxW = Math.max(maxW, streakW); maxL = Math.max(maxL, streakL); }
const traded = days.filter((d) => (d.total as number) > 0);
const by = (f: (a: Record<string, unknown>, b: Record<string, unknown>) => number) => (traded.length ? [...traded].sort(f)[0]!.date : null);
const overall = {
  total: done.length, wins: cnt((t) => t.result === 'WIN'), losses: cnt((t) => t.result === 'LOSS'), draws: cnt((t) => t.result === 'DRAW'), voided: trades.filter((t) => t.result === 'VOID').length, skipped: trades.filter((t) => t.result === 'SKIPPED').length, signals: trades.length,
  win_rate: pct(cnt((t) => t.result === 'WIN'), cnt((t) => t.result === 'LOSS')),
  long_trades: cnt((t) => t.side === 'LONG'), short_trades: cnt((t) => t.side === 'SHORT'),
  long_win_rate: pct(cnt((t) => t.side === 'LONG' && t.result === 'WIN'), cnt((t) => t.side === 'LONG' && t.result === 'LOSS')),
  short_win_rate: pct(cnt((t) => t.side === 'SHORT' && t.result === 'WIN'), cnt((t) => t.side === 'SHORT' && t.result === 'LOSS')),
  gross_profit: r2(done.reduce((a, t) => a + t.gross_profit, 0)), fees: r2(done.reduce((a, t) => a + t.fee, 0)), net: r2(done.reduce((a, t) => a + t.net, 0)),
  start_balance: FX_RULES.startBalance, final_balance: bal / 100, max_consecutive_wins: maxW, max_consecutive_losses: maxL,
  best_day: by((a, b) => (b.net as number) - (a.net as number)), worst_day: by((a, b) => (a.net as number) - (b.net as number)),
};
const sk = trades.filter((t) => t.result === 'SKIPPED');
const allPriced = trades.filter((t) => t.result !== 'VOID').map((t) => (t.result === 'SKIPPED' ? t.would_have : t.result));
const info_all_signals = { note: 'Information only — not money. What every priced signal would have scored if the balance had never run out.', signals: allPriced.length, wins: allPriced.filter((r) => r === 'WIN').length, losses: allPriced.filter((r) => r === 'LOSS').length, draws: allPriced.filter((r) => r === 'DRAW').length, skipped_wins: sk.filter((t) => t.would_have === 'WIN').length, skipped_losses: sk.filter((t) => t.would_have === 'LOSS').length };
const chart = m3.filter((b) => b.t >= START - 3600 && b.t < END).map((b) => [b.t, b.o, b.h, b.l, b.c]);
const ema = m3.map((b, i) => [b.t, series.ema[i]!]).filter(([t]) => t! >= START - 3600 && t! < END).map(([t, v]) => [t, Math.round(v! * 1000) / 1000]);
const out = {
  meta: {
    title: 'AUD/JPY · CPES indicator on M3 · 1-minute binary expiry · historical backtest', mode: 'HISTORICAL BACKTEST (not live)',
    window_utc: [iso(START), iso(END)], data_source: raw.source, downloaded_at: raw.downloaded_at, indicator: 'Candle Pattern Entry Signals (38 Patterns), default inputs, unchanged',
    method: 'M3 candles built from 1-minute candles (UTC-aligned). Entry = signal M3 candle close at its close time. Expiry price = close of the 1-minute candle that starts at entry (the last quoted price before entry + 60 s).',
    disclosures: [
      'Exact tick prices were not available (the tick-data provider refused downloads), so the expiry price is the 1-minute candle close: the last quote before the expiry second, not a tick at the exact second.',
      'The price feed is Yahoo Finance AUDJPY=X. It may differ slightly from your Quotex or TradingView feed, so individual signals can differ.',
      'Sunday 22:00–24:00 UTC is missing from this feed and the 23:59 minute is missing on most days. Trades that depend on a missing minute are marked VOID and not counted.',
      'Forex is closed from Friday 22:00 to Sunday 22:00 UTC, so Saturday Nov 21 and Sunday Nov 22 have no trades.',
    ],
    rules: FX_RULES,
  },
  overall, info_all_signals, days, trades, chart, ema,
  signals_total: signals.filter((s) => s.t + 180 >= START && s.t + 180 < END).length,
};
writeFileSync(new URL('../../src/lib/forex/data/backtest-78.json', import.meta.url), JSON.stringify(out));
writeFileSync(new URL('./signals-ts.json', import.meta.url), JSON.stringify(signals.map((s) => [s.t, s.side])));
console.log(JSON.stringify(overall, null, 1)); console.table(days);
console.log(info_all_signals, trades.filter((t) => t.result === 'VOID').map((t) => [t.entry_time, t.void_reason]));
