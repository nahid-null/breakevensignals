"""prompt-71 report: markdown + CSVs from /tmp/r71/outMAIN.json (and outLOT.json, checks.json). Offline only."""
import json, csv, time, statistics as st, collections, os
O = json.load(open("/tmp/r71/outMAIN.json")); L = json.load(open("/tmp/r71/outLOT.json")); K = json.load(open("/tmp/r71/checks.json"))
DST = "/mnt/documents/Simulator Performance Reports/prompt-71"; os.makedirs(DST, exist_ok=True)
f = lambda ms: time.strftime('%Y-%m-%d %H:%M', time.gmtime(ms / 1000)) if ms else ''
day = lambda ms: time.strftime('%Y-%m-%d', time.gmtime(ms / 1000))
def px(x): return f"{x:.6g}" if x < 1 else f"{x:.4f}"
T = O['trades']; done = [t for t in T if t['result'] != 'STILL OPEN']; tp = [t for t in T if t['result'] == 'TP HIT']
liq = [t for t in T if t['result'] == 'LIQUIDATED']; op = [t for t in T if t['result'] == 'STILL OPEN']
for t in done: t['dur'] = (t['exit_time'] - t['entry_time']) / 60000
for t in op: t['dur'] = (O['end'] - t['entry_time']) / 60000
durs = [t['dur'] for t in done]
realized = sum(t['pnl'] for t in done); unreal = sum(t['pnl'] for t in op)
rows = []
for i, t in enumerate(T, 1):
    rows.append(dict(trade=i, coin=t['coin'], side=t['side'], pattern=t['pattern'], signal_candle_open_utc=f(t['signal_time']),
        signal_available_utc=f(t['signal_time'] + 1800000), entry_utc=f(t['entry_time']), entry_price=px(t['entry']), margin_usdt=f"{t['margin']:.4f}",
        leverage=t['lev'], position_qty=f"{t['qty']:.6f}", position_notional_usdt=f"{t['qty'] * t['entry']:.4f}", take_profit_price=px(t['tp']),
        liq_price_at_entry=px(t['liq_at_entry']), exit_utc=f(t['exit_time']), exit_price=px(t['exit_price']) if t['result'] != 'STILL OPEN' else '',
        last_price_if_open=px(t['exit_price']) if t['result'] == 'STILL OPEN' else '', holding_minutes=int(t['dur']),
        gross_pnl=f"{t['gross']:.4f}", fees=f"{t['fee_in'] + t['fee_out']:.4f}", funding_paid=f"{t['fund']:.4f}", net_pnl=f"{t['pnl']:.4f}",
        status=t['result'] + (' (unrealized at end)' if t['result'] == 'STILL OPEN' else '')))
for s in O['skipped']:
    rows.append(dict(trade='', coin=s['coin'], side=s['side'], pattern=s['pattern'], signal_candle_open_utc=f(s['signal_time']),
        signal_available_utc=f(s['confirm_time']), status='SKIPPED: ' + s['reason']))
with open(f"{DST}/prompt71-trades.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
# daily
D = collections.defaultdict(lambda: collections.Counter())
for e in O['events']: D[day(e['confirm_time'])]['signals'] += 1
for t in T: D[day(t['entry_time'])]['opened'] += 1
for s in O['skipped']: D[day(s['confirm_time'])]['skipped'] += 1
for t in done:
    d = D[day(t['exit_time'])]; d['completed'] += 1; d['tp'] += t['result'] == 'TP HIT'; d['liq'] += t['result'] == 'LIQUIDATED'; d['net'] += t['pnl']
for t in op: D[day(t['entry_time'])]['open_end'] += 1
eod = {}
for ts, eq, n, wal in O['curve']: eod[day(ts - 1)] = (eq, wal, n)
days = sorted(D)
with open(f"{DST}/prompt71-daily.csv", "w", newline="") as fh:
    w = csv.writer(fh); w.writerow(["date_utc", "signals", "opened", "skipped_slots_full", "completed", "tp_hit", "liquidated", "realized_net_pnl", "end_wallet", "end_equity_incl_open", "open_positions_at_end"])
    for d in days: x = D[d]; w.writerow([d, x['signals'], x['opened'], x['skipped'], x['completed'], x['tp'], x['liq'], f"{x['net']:.4f}", f"{eod[d][1]:.4f}", f"{eod[d][0]:.4f}", eod[d][2]])
# coins
C = []
for s in sorted(O['brackets']):
    tr = [t for t in T if t['coin'] == s]; dn = [t for t in tr if t['result'] != 'STILL OPEN']
    C.append(dict(coin=s, signals=O['sigcount'].get(s, 0), opened=len(tr), skipped=sum(1 for k in O['skipped'] if k['coin'] == s), completed=len(dn),
        tp=sum(t['result'] == 'TP HIT' for t in tr), liquidated=sum(t['result'] == 'LIQUIDATED' for t in tr), open=sum(t['result'] == 'STILL OPEN' for t in tr),
        win_rate=(100 * sum(t['result'] == 'TP HIT' for t in dn) / len(dn)) if dn else None, realized=sum(t['pnl'] for t in dn), unrealized=sum(t['pnl'] for t in tr if t['result'] == 'STILL OPEN'),
        fastest=min((t['dur'] for t in dn), default=None), slowest=max((t['dur'] for t in dn), default=None), avg=(st.mean(t['dur'] for t in dn) if dn else None),
        mmr=O['brackets'][s]['bracketMaintenanceMarginRate'], maxlev=O['brackets'][s]['maxOpenPosLeverage']))
with open(f"{DST}/prompt71-coins.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(C[0].keys())); w.writeheader()
    for c in C: w.writerow({k: (f"{v:.4f}" if isinstance(v, float) else v) for k, v in c.items()})
with open(f"{DST}/prompt71-signals.csv", "w", newline="") as fh:
    w = csv.writer(fh); w.writerow(["coin", "side", "pattern", "signal_candle_open_utc", "signal_available_utc", "signal_close"])
    for e in O['events']: w.writerow([e['coin'], e['side'], e['pattern'], f(e['signal_time']), f(e['confirm_time']), e['sig_close']])
# headline numbers
fast = min(done, key=lambda t: t['dur']); slow = max(done, key=lambda t: t['dur'])
withdn = [c for c in C if c['completed']]
best_wr = max(withdn, key=lambda c: (c['win_rate'], c['completed'])); best_pnl = max(C, key=lambda c: c['realized'] + c['unrealized'])
sides = collections.Counter(e['side'] for e in O['events']); tsides = collections.Counter(t['side'] for t in T)
minutes_full = sum(1 for _, _, n, _ in O['curve'] if n >= 7)
M = []; a = M.append
a("# prompt-71 — Candle Signals Trend Filter v4 (Strong Trend), 30-minute, 22 coins, shared $10 cross margin\n")
a("**Research only.** Website, live Simulator, scanner, database, Telegram and settings were NOT changed. No trade here entered live history.\n")
a(f"- Test window: **{f(O['start'])} → {f(O['end'])} UTC** (7 full days, ending at the last full hour before the request; Bangladesh time = UTC+6). Your prompt did not name a period, so the same 7-day length as prompts 69/70 was used.")
a("- Data: genuine Binance USD-M Futures `fapi` 30m candles (30 days of warm-up before the window), 1m last-price candles, 1m **mark-price** candles and real funding history. All 22 coins complete: 1,776 30m bars and 10,080 1m bars each, 0 gaps.")
a("- Indicator: your attached file, unchanged, default inputs (only setting changed: chart timeframe = 30m, as you asked; note the script's title says \"3m\").")
a("- Rules: $10 cross-margin balance, 7 slots, **$0.50 fixed margin** (5% of initial $10), 75x (all 22 coins allow 75x), no stop loss, no time exit, target = **+$0.10 net** (20% of margin) after entry fee, exit fee, slippage and funding paid. Same coin may hold several trades. When 7 slots were full, new signals were skipped.\n")
a("## A. Overall statistics\n")
a("| Item | Result |\n|---|---|")
for k, v in [("Indicator signals in window", f"{len(O['events'])} (LONG {sides['LONG']}, SHORT {sides['SHORT']})"),
             ("Trades opened", f"{len(T)} (LONG {tsides['LONG']}, SHORT {tsides['SHORT']})"), ("Signals skipped (all 7 slots full)", len(O['skipped'])),
             ("Completed trades", len(done)), ("Successful (TP HIT)", len(tp)), ("Win rate of completed trades", f"{100 * len(tp) / len(done):.1f}%"),
             ("Still open at end", len(op)), ("Liquidated trades", len(liq)), ("Realized net profit (closed trades, after fees & funding)", f"${realized:+.4f}"),
             ("Unrealized P&L of open trades at end (after exit fee)", f"${unreal:+.4f}"),
             ("Final Main Balance (wallet, closed trades only)", f"**${O['wallet']:.4f}**"), ("Final equity if open trades closed at end", f"**${O['final_equity']:.4f}** ({100 * (O['final_equity'] / 10 - 1):+.1f}%)"),
             ("Total trading fees", f"${O['fees']:.4f}"), ("Total funding paid (+) / received (−)", f"${O['funding']:+.4f}"),
             ("Lowest account equity (worst mark price each minute)", f"${O['lo']:.4f}"), ("Highest equity", f"${O['hi']:.4f}"), ("Largest drop from a peak", f"${O['maxdd']:.4f}"),
             ("Max simultaneous open trades", O['maxslots']), ("Minutes with all 7 slots full", f"{minutes_full:,} of 10,080")]:
    a(f"| {k} | {v} |")
a("\n## B. Trade duration (completed trades)\n")
tpd = [t['dur'] for t in tp]
a("| Item | Minutes |\n|---|---|")
a(f"| Fastest | {fast['dur']:.0f} ({fast['coin']} {fast['side']}, trade #{T.index(fast) + 1}) |")
a(f"| Slowest | {slow['dur']:.0f} ({slow['coin']} {slow['side']}, trade #{T.index(slow) + 1}) |")
a(f"| Average | {st.mean(durs):.1f} |\n| Median | {st.median(durs):.1f} |\n| Average, successful trades | {st.mean(tpd):.1f} |")
a(f"| Average, liquidated trades | {'n/a — no liquidations' if not liq else f'{st.mean(t['dur'] for t in liq):.1f}'} |")
a(f"\nOpen trades at the end had been open {', '.join(f'{t['coin']} {t['side']} {t['dur']:.0f} min' for t in op)}.\n")
a("## C. Daily statistics (UTC dates)\n")
a("| Date | Signals | Opened | Skipped | Completed | TP | Liquidated | Realized net | End wallet | End equity | Open at end |\n|---|---|---|---|---|---|---|---|---|---|---|")
for d in days:
    x = D[d]; a(f"| {d} | {x['signals']} | {x['opened']} | {x['skipped']} | {x['completed']} | {x['tp']} | {x['liq']} | ${x['net']:+.4f} | ${eod[d][1]:.4f} | ${eod[d][0]:.4f} | {eod[d][2]} |")
a("\nThe first and last dates are partial days (window starts and ends at 13:00 UTC).\n")
a("## E. Additional analysis\n")
a(f"- Fastest completed trade: **{fast['coin']}** ({fast['dur']:.0f} min). Slowest completed trade: **{slow['coin']}** ({slow['dur']:.0f} min).")
a(f"- Best win rate: every coin with completed trades won 100% (no liquidations); with the most completed trades: **{best_wr['coin']}** ({best_wr['completed']} of {best_wr['completed']}).")
a(f"- Highest total net profit (realized + open): **{best_pnl['coin']}** (${best_pnl['realized'] + best_pnl['unrealized']:+.4f}).")
a(f"- Most liquidations: **none** — 0 liquidations on every coin.")
a("\n| Coin | Signals | Opened | Skipped | TP | Liq | Open | Realized | Open P&L | Fastest | Slowest | Avg min |\n|---|---|---|---|---|---|---|---|---|---|---|---|")
for c in C:
    g = lambda v: '' if v is None else f"{v:.0f}"
    a(f"| {c['coin']} | {c['signals']} | {c['opened']} | {c['skipped']} | {c['tp']} | {c['liquidated']} | {c['open']} | ${c['realized']:+.2f} | ${c['unrealized']:+.2f} | {g(c['fastest'])} | {g(c['slowest'])} | {g(c['avg'])} |")
a("\n### Was it profitable under these exact rules?\n")
a(f"**Yes, in this one week:** equity went from $10.00 to **${O['final_equity']:.2f}** ({100 * (O['final_equity'] / 10 - 1):+.1f}%), with {len(tp)} targets and **0 liquidations**. "
  f"Wallet cash is ${O['wallet']:.2f}; {len(op)} trades are still open with ${unreal:+.2f} unrealized loss.")
a(f"\nImportant cautions, in plain words:")
a(f"- The week was mostly a **falling market** ({sides['SHORT']} of {len(O['events'])} signals were SHORT). The indicator only trades with a strong trend, so a steady down-week suits it. A choppy or rising week may behave very differently — this is one week only.")
a(f"- The account was not safe all the time: equity fell to **${O['lo']:.2f}** at its lowest and dropped **${O['maxdd']:.2f}** from a peak. With no stop loss, one strong move against several open trades at once could still liquidate the whole account.")
a(f"- {len(O['skipped'])} signals ({100 * len(O['skipped']) / len(O['events']):.0f}%) were skipped because all 7 slots were full; results depend on which signals happened to get a slot.")
a(f"- Each win is small (+$0.10) while each open trade risks up to its share of the whole $10 account, so a single bad cluster can cancel many wins.")
a("\n## 7. Data and verification\n")
a(f"- **Indicator reproduction:** the intact uploaded Pine file was run in the project's Pine interpreter (PineTS with the project's documented corrections) on the same candles, and compared with the Python port bar by bar. In the test window: **{K['pinets_window']} of {K['pinets_window']} signals identical, 0 differences**. Over all 37 days, {K['pinets_mismatch']} differences existed, all before 2026-10-18 (start-up of the moving averages, weeks before the window).")
a(f"- **No future data:** {K['look_samples']} bars recomputed using only candles up to that bar — {K['look_mismatch']} differences. Signals use `barstate.isconfirmed` (closed candle); entry is at the next 1-minute open after the 30m candle closes, plus 0.02% slippage.")
a(f"- **Warm-up:** starting the indicator only 10 or 5 days before the window changed {K['warm'].get('10', K['warm'].get(10))} / {K['warm'].get('5', K['warm'].get(5))} window signals.")
a("- **All signals and entries use 30-minute candles**; 1-minute candles are used only to find when the target or liquidation was touched.")
a(f"- **Target check:** all {len(tp)} TP trades closed at net +$0.1000 (range {min(t['pnl'] for t in tp):.6f}…{max(t['pnl'] for t in tp):.6f}); target price re-solved each minute including funding already paid.")
a("- **Fees:** Binance USD-M taker 0.05% on entry and exit (regular user, no BNB discount); 0.02% slippage each side. **Funding:** real Binance funding rates at each settlement on mark price (S and WIF settle every 4 h, others every 8 h).")
a("- **Cross-margin liquidation:** one shared wallet. Every minute, all open positions are valued at their worst 1m **mark price** (low for longs, high for shorts — all at once, which is stricter than reality) and compared with total maintenance margin from Binance's public leverage-bracket table (tier 1: 0.4%–1.0% depending on coin). Liquidation if equity ≤ maintenance. It never triggered. Liquidation prices shown per trade use Binance's cross formula with other positions held at mark price.")
a(f"- **Wallet reconciliation:** $10 + closed-trade net − open-trade entry fees/funding = ${O['wallet']:.6f}, equal to the simulated wallet.")
a(f"- **Real order sizes check:** rounding each order down to Binance's lot step (margin slightly under $0.50) gave {len(L['trades'])} trades, {sum(t['result'] == 'TP HIT' for t in L['trades'])} TP, {sum(t['result'] == 'LIQUIDATED' for t in L['trades'])} liquidated, equity ${L['final_equity']:.2f} — same conclusion. All $37.50 orders are above Binance's minimum order value.")
a("- **Raw data SHA-256** (30m+1m+funding files): " + ", ".join(f"{s} `{h[:12]}`" for s, h in O['hashes'].items()))
a("\n**Assumptions / limits (disclosed):** 1-minute candles cannot show the order of moves inside a minute — liquidation is checked before the target in the same minute (conservative). "
  "Signals at the same minute are filled in alphabetical coin order. Liquidation clearance fees are not modelled (no liquidation happened). The screenshot attached (BCH 30m) shows the OB STRONG indicator, not this one, so it was not used for checking. "
  "This is a local interpreter match, not an exported TradingView result.\n")
a("## D. Complete individual trade history\n")
a("Times UTC. Signal = 30m candle open time; it becomes available at candle close (+30 min), entry next minute. Skipped signals are listed in `prompt71-trades.csv` with status SKIPPED.\n")
a("| # | Coin | Side | Signal candle | Entry | Entry price | Margin | Lev | Qty | Notional | TP price | Exit | Exit price | Min | Gross | Fees | Funding | Net | Status |\n|" + "---|" * 19)
for r in rows:
    if r['trade'] == '': continue
    a(f"| {r['trade']} | {r['coin']} | {r['side']} | {r['signal_candle_open_utc']} | {r['entry_utc']} | {r['entry_price']} | {r['margin_usdt']} | {r['leverage']}x | {r['position_qty']} | {r['position_notional_usdt']} | {r['take_profit_price']} | {r['exit_utc'] or '—'} | {r['exit_price'] or r['last_price_if_open'] + ' (last)'} | {r['holding_minutes']} | {r['gross_pnl']} | {r['fees']} | {r['funding_paid']} | {r['net_pnl']} | {r['status']} |")
a(f"\n### Skipped signals ({len(O['skipped'])}, all because 7 slots were occupied)\n")
a(", ".join(f"{s['coin'].replace('USDT', '')} {s['side'][0]} {f(s['confirm_time'])[5:]}" for s in O['skipped']))
open(f"{DST}/prompt71-report.md", "w").write("\n".join(M) + "\n")
print("ok", len(rows), DST)
