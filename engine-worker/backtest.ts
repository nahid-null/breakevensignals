/**
 * Portfolio replay of the paper robot on real Binance 1m candles, through the same RobotCore the worker runs.
 * Usage: bun engine-worker/backtest.ts <bars-dir with SYMBOL.json [[t,o,h,l,c,v],...]> <exchangeInfo.json> <out.json> [startBalance]
 * Historical order books are unavailable: fills use the next bar open with a one-tick spread plus configured slippage; funding is not replayed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, PAPER_LEVERAGE, ROBOT_SYMBOLS } from '../src/lib/robot/config';
import { MINUTE } from '../src/lib/robot/series';
import { RobotCore, exposure, type Queued } from '../src/lib/robot/engine';
import { computeMetrics, type ClosedTrade } from '../src/lib/robot/metrics';
import { DEFAULT_RULES, rulesFromFilters } from '../src/lib/robot/risk';
import type { Position } from '../src/lib/robot/paper';

const [dir = '/tmp/diag/bars', infoPath = '/tmp/diag/exchangeInfo.json', outPath = '/tmp/diag/result.json', startArg = '20'] = process.argv.slice(2);
import { TUNING } from '../src/lib/robot/strategy';
Object.assign(TUNING, JSON.parse(process.env['ROBOT_TUNING'] ?? '{}'));
const FROM = Number(process.env['BT_FROM'] ?? 0); const TO = Number(process.env['BT_TO'] ?? Infinity);
const s = { ...DEFAULT_SETTINGS, ...JSON.parse(process.env['ROBOT_SETTINGS'] ?? '{}') };
const START = Number(startArg);
const info = JSON.parse(readFileSync(infoPath, 'utf8')) as { symbols: { symbol: string; filters: Parameters<typeof rulesFromFilters>[0] }[] };

const core = new RobotCore(s);
const data = new Map<string, number[][]>(); const cursor = new Map<string, number>();
for (const sym of ROBOT_SYMBOLS) {
  const p = `${dir}/${sym}.json`; if (!existsSync(p)) continue;
  const rows = JSON.parse(readFileSync(p, 'utf8')) as number[][]; if (!rows.length) continue;
  const meta = info.symbols.find((x) => x.symbol === sym); core.addSymbol(sym, meta ? rulesFromFilters(meta.filters) : DEFAULT_RULES);
  data.set(sym, rows); cursor.set(sym, 0);
}
let start = Infinity; let end = -Infinity;
for (const r of data.values()) { start = Math.min(start, r[0]![0]!); end = Math.max(end, r.at(-1)![0]!); }

let balance = START; const closed: (ClosedTrade & { symbol: string; setup: string; score: number; leverage: number; roi: number; holdMin: number; margin: number })[] = [];
const pending = new Map<string, Queued>(); let maxAlloc = 0; let maxOpen = 0; const levs = new Set<number>(); let reopenedAfterClose = 0; let lastCloseAt = -1;
const fillsBy = { full: 0, partial: 0 };
const track = (p: Position) => {
  closed.push({ symbol: p.symbol, direction: p.direction, netPnl: p.realized, exitReason: p.exitReason!, closedAt: p.closedAt!, riskUsdt: p.riskUsdt,
    setup: p.setup, score: p.score, leverage: p.leverage, roi: (p.realized / ((p.qty * p.entry) / p.leverage)) * 100, holdMin: (p.closedAt! - p.openedAt) / MINUTE,
    margin: (p.qty * p.entry) / p.leverage });
  lastCloseAt = p.closedAt!;
};
end = Math.min(end, TO);
for (let t = start; t <= end; t += MINUTE) {
  const live = t >= FROM;
  for (const [sym, rows] of data) {
    const i = cursor.get(sym)!; const r = rows[i];
    if (!r || r[0] !== t) continue; cursor.set(sym, i + 1);
    const bar = { time: t, open: r[1]!, high: r[2]!, low: r[3]!, close: r[4]!, volume: r[5]! };
    const q = pending.get(sym);
    if (q) {
      pending.delete(sym);
      const tick = core.rules.get(sym)!.tickSize;
      const res = core.execute(q, { bids: [[bar.open - tick, 1e12]], asks: [[bar.open + tick, 1e12]] }, balance, t - 1);
      if (!('rejected' in res)) {
        core.confirmOpen(res, q.c, true); balance += res.fill.pnl; levs.add(res.position.leverage); fillsBy[res.position.fillStatus === 'PARTIAL' ? 'partial' : 'full']++;
        if (lastCloseAt >= 0 && t - lastCloseAt <= 5 * MINUTE) reopenedAfterClose++;
        const used = exposure(core.open).reduce((a, p) => a + p.margin, 0); maxAlloc = Math.max(maxAlloc, (used / balance) * 100);
        maxOpen = Math.max(maxOpen, core.open.length);
      }
    }
    const { fills } = core.onBar(sym, bar, live);
    for (const { position: p, fill } of fills) { balance += fill.pnl; if (p.status === 'CLOSED') track(p); }
    core.open = core.open.filter((p) => p.status === 'OPEN');
  }
  // Decide at the close of minute t; execute at the next bar's open (no look-ahead).
  const now = t + MINUTE;
  for (let k = 0; k < s.max_concurrent && core.open.length + pending.size < s.max_concurrent; k++) {
    const q = core.nextCandidate(now, balance); if (!q) break;
    if (pending.has(q.c.symbol)) { core.queue.delete(`${q.c.symbol}|${q.c.direction}`); continue; }
    pending.set(q.c.symbol, q); core.queue.delete(`${q.c.symbol}|${q.c.direction}`);
  }
  core.takeSignals(1e9);
}
const counters = core.counters;
const m = (xs: ClosedTrade[]) => computeMetrics(xs, START);
const by = (key: (c: (typeof closed)[number]) => string) => Object.fromEntries([...new Set(closed.map(key))].map((k) => [k, m(closed.filter((c) => key(c) === k))]));
const tp = closed.filter((c) => c.exitReason === 'TAKE_PROFIT');
let streakW = 0; let streakL = 0; let w = 0; let l = 0;
for (const c of [...closed].sort((a, b) => a.closedAt - b.closedAt)) { if (c.netPnl > 0) { w++; l = 0; } else { l++; w = 0; } streakW = Math.max(streakW, w); streakL = Math.max(streakL, l); }
const result = {
  generated_at: new Date().toISOString(), period_start: new Date(start).toISOString(), period_end: new Date(end + MINUTE).toISOString(),
  symbols: [...data.keys()], start_balance: START, end_balance: balance, settings: s, leverage_used: [...levs], fixed_leverage: PAPER_LEVERAGE,
  assumptions: { entry_fill: 'Next 1m bar open, one-tick spread, plus slippage', exits: 'Stop checked before target in the same bar; TP is a maker limit at the 10% net ROI price',
    fees: `taker ${s.fee_pct}% / maker ${s.maker_fee_pct}%`, funding: 'not replayed (no history used)', order_book: 'not available historically' },
  all: m(closed), long: m(closed.filter((c) => c.direction === 'LONG')), short: m(closed.filter((c) => c.direction === 'SHORT')),
  by_setup: by((c) => c.setup), by_exit: by((c) => c.exitReason), max_allocation_pct: maxAlloc, max_open_positions: maxOpen,
  tp_net_roi: tp.length ? { min: Math.min(...tp.map((c) => c.roi)), max: Math.max(...tp.map((c) => c.roi)), avg: tp.reduce((a, c) => a + c.roi, 0) / tp.length } : null,
  reopened_within_5min_of_a_close: reopenedAfterClose, fills: fillsBy, max_win_streak: streakW, max_loss_streak: streakL,
  avg_hold_minutes: closed.length ? closed.reduce((a, c) => a + c.holdMin, 0) / closed.length : 0,
  counters: { ...counters, reasons: Object.fromEntries(Object.entries(counters.reasons).sort((a, b) => b[1] - a[1])) },
  trades: closed.map((c) => ({ ...c, closedAt: new Date(c.closedAt).toISOString() })),
};
writeFileSync(outPath, JSON.stringify(result, null, 1));
const brief = (x: ReturnType<typeof m>) => `${x.trades} trades, win ${x.winRate.toFixed(1)}%, net ${x.netPnl.toFixed(2)}, PF ${x.profitFactor?.toFixed(2)}, DD ${x.maxDrawdownPct.toFixed(1)}%, SL ${x.stopLossRate.toFixed(1)}%`;
console.log('ALL  ', brief(result.all)); console.log('LONG ', brief(result.long)); console.log('SHORT', brief(result.short));
console.log('balance', START, '->', balance.toFixed(2), '| leverage', [...levs], '| max alloc %', maxAlloc.toFixed(1), '| max open', maxOpen, '| reopen<5m', reopenedAfterClose);
console.log('tp roi', result.tp_net_roi); console.log('by setup', Object.fromEntries(Object.entries(result.by_setup).map(([k, x]) => [k, brief(x)])));
console.log('by exit', Object.fromEntries(Object.entries(result.by_exit).map(([k, x]) => [k, x.trades])));
console.log('funnel', { evaluated: counters.evaluated, long: counters.long_candidates, short: counters.short_candidates, qualified: counters.qualified, submitted: counters.orders_submitted, rejected_orders: counters.orders_rejected });
console.log('top reasons', Object.entries(result.counters.reasons).slice(0, 12)); console.log('exec', counters.exec_failures); console.log('setups', counters.setups);
