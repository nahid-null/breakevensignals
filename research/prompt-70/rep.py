"""prompt-70 report: markdown + CSVs from /tmp/r70/outA.json (strict 75x) and outB.json (capped coins at their max). Offline only."""
import json, csv, statistics as st, datetime as D, collections, os
OUT = "/mnt/documents/Simulator Performance Reports/prompt-70"; os.makedirs(OUT, exist_ok=True)
SYMS = [c + "USDT" for c in "W ZEN GALA S A FF ETH SOL XRP LINK NEAR BCH LTC ADA AVAX DOGS PROM 1000CAT FLUX TRX BNB UNI BOME WLD WIF CRV EGLD FIL SAND HBAR".split()]
f = lambda t: D.datetime.utcfromtimestamp(t / 1000).strftime('%Y-%m-%d %H:%M') if t else '-'
def dur(m):
    m = int(round(m)); d, r = divmod(m, 1440); h, mi = divmod(r, 60)
    return (f"{d}d " if d else "") + (f"{h}h " if h or d else "") + f"{mi}m"
def load(S):
    o = json.load(open(f"/tmp/r70/out{S}.json"))
    for t in o['trades']: t['mins'] = ((t['exit_time'] or o['end']) - t['entry_time']) / 60000
    return o
A, B = load("A"), load("B")
def summary(o):
    tr = o['trades']; done = [t for t in tr if t['result'] == 'TP HIT']; op = [t for t in tr if t['result'] == 'STILL OPEN']
    liq = [t for t in tr if t['result'] == 'LIQUIDATED']
    realized = sum(t['pnl'] for t in done) + sum(t['pnl'] for t in liq); unreal = sum(t['pnl'] for t in op)
    final_eq = o['wallet'] + sum(t['gross'] - t['fee_out'] for t in op)   # open trades closed at last price incl. exit fee
    return dict(tr=tr, done=done, op=op, liq=liq, realized=realized, unreal=unreal, final_eq=final_eq)
def block(o, s, title):
    L = []; sk = collections.Counter(x['reason'] for x in o['skipped'])
    net = s['final_eq'] - 10
    L += [f"## {title}", "", "| Item | Value |", "|---|---|",
          f"| Initial account balance | $10.00 |",
          f"| Final wallet balance (cash, open trades not closed) | ${o['wallet']:.2f} |",
          f"| Final account equity (open trades valued at last price, after exit fee) | ${s['final_eq']:.2f} |",
          f"| Total net profit/loss (equity) | {'+' if net>=0 else '−'}${abs(net):.2f} ({net/10*100:+.1f}%) |",
          f"| Total signals generated | {o['events']} |",
          f"| Total trades executed | {len(s['tr'])} |",
          f"| Completed trades | {len(s['done'])} |",
          f"| Winning trades | {sum(1 for t in s['done'] if t['pnl']>0)} |",
          f"| Losing trades (closed at a loss) | {sum(1 for t in s['done']+s['liq'] if t['pnl']<=0)} |",
          f"| Still open at end | {len(s['op'])} |",
          f"| Liquidated trades | {len(s['liq'])} |",
          f"| Stop-loss exits | 0 (no stop loss used) |",
          f"| Skipped: all 7 slots occupied | {sk.get('ALL 7 SLOTS OCCUPIED',0)} |",
          f"| Skipped: insufficient available margin | {sk.get('INSUFFICIENT AVAILABLE MARGIN',0)} |",
          f"| Skipped: coin not tradable at 75x on Binance | {sum(v for k,v in sk.items() if k.startswith('NOT TRADABLE'))} |",
          f"| Max simultaneous occupied slots | {o['maxslots']} |",
          f"| Highest account equity | ${o['hi']:.2f} |",
          f"| Lowest account equity (worst price inside each minute) | ${o['lo']:.2f} |",
          f"| Max unrealized loss across open positions | −${abs(o['min_upnl']):.2f} |",
          f"| Max drawdown (peak equity to lowest) | ${o['maxdd']:.2f} |",
          f"| Total trading fees | ${o['fees']:.4f} |",
          f"| Total funding fees (negative = received) | ${o['funding']:+.4f} |",
          f"| Total realized profit/loss | ${s['realized']:+.2f} |",
          f"| Total unrealized profit/loss (open trades, after exit fee) | ${s['unreal']:+.2f} |", ""]
    return L
def durations(o, s):
    d = s['done']; m = [t['mins'] for t in d]; L = ["### Trade duration (completed trades only)", ""]
    if not m: return L + ["No completed trades.", ""]
    fa = min(d, key=lambda t: t['mins']); sl = max(d, key=lambda t: t['mins'])
    L += ["| Item | Value |", "|---|---|",
          f"| Fastest | {fa['coin']} {fa['side']} — {dur(fa['mins'])} |",
          f"| Slowest | {sl['coin']} {sl['side']} — {dur(sl['mins'])} |",
          f"| Average | {dur(st.mean(m))} |", f"| Median | {dur(st.median(m))} |"]
    for lim, lab in [(30,'30 minutes'),(60,'1 hour'),(240,'4 hours'),(720,'12 hours'),(1440,'24 hours')]:
        L.append(f"| Completed within {lab} | {sum(1 for x in m if x<=lim)} |")
    L += ["", "**Daily completions (UTC):**", "", "| Day | Completed |", "|---|---|"]
    for i in range(7):
        a = o['start'] + i*86400000; b = a + 86400000
        L.append(f"| {f(a)[:10]} {f(a)[11:]} → {f(b)[5:]} | {sum(1 for t in d if a < t['exit_time'] <= b)} |")
    return L + [""]
def coins(o, s, write=None):
    L = ["### Coin-by-coin", "", "| Coin | Max lev | Signals | Executed | Skipped | Completed | Wins | Losses | Open | Liquidated | Net P&L | Avg time | Fastest | Slowest |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    rows = []
    for c in SYMS:
        tr = [t for t in s['tr'] if t['coin']==c]; d = [t for t in tr if t['result']=='TP HIT']; m = [t['mins'] for t in d]
        sk = sum(1 for x in o['skipped'] if x['coin']==c); net = sum(t['pnl'] for t in tr)
        r = dict(coin=c, maxlev=o['brackets'][c]['maxOpenPosLeverage'], signals=o['sigcount'].get(c,0), executed=len(tr), skipped=sk, completed=len(d),
                 wins=sum(1 for t in d if t['pnl']>0), losses=sum(1 for t in tr if t['result']!='STILL OPEN' and t['pnl']<=0),
                 open=sum(1 for t in tr if t['result']=='STILL OPEN'), liq=sum(1 for t in tr if t['result']=='LIQUIDATED'), net=net,
                 avg=dur(st.mean(m)) if m else '-', fast=dur(min(m)) if m else '-', slow=dur(max(m)) if m else '-')
        rows.append(r)
        L.append(f"| {c} | {r['maxlev']}x | {r['signals']} | {r['executed']} | {r['skipped']} | {r['completed']} | {r['wins']} | {r['losses']} | {r['open']} | {r['liq']} | {'+' if net>=0 else '−'}${abs(net):.2f} | {r['avg']} | {r['fast']} | {r['slow']} |")
    traded = [r for r in rows if r['executed']]
    if traded:
        best = max(traded, key=lambda r: r['net']); worst = min(traded, key=lambda r: r['net'])
        L += ["", f"**Best coin:** {best['coin']} ({'+' if best['net']>=0 else '−'}${abs(best['net']):.2f}). **Worst coin:** {worst['coin']} ({'+' if worst['net']>=0 else '−'}${abs(worst['net']):.2f}).",
              f"**No signals in 7 days:** {', '.join(r['coin'] for r in rows if r['signals']==0)}."]
    if write:
        with open(write, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); [w.writerow({**r, 'net': round(r['net'],4)}) for r in rows]
    return L + [""]
def history(s):
    L = ["### Trade-by-trade history", "", "| # | Coin | Signal candle | Entry | Side | Entry price | Qty | Margin | Lev | Equity at entry | Liq. price at entry (cross) | Exit | Exit price | Duration | Gross | Fees | Funding | Net | Status |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for i, t in enumerate(sorted(s['tr'], key=lambda t: t['entry_time']), 1):
        fees = t['fee_in'] + t['fee_out']
        L.append(f"| {i} | {t['coin']} | {f(t['signal_time'])} | {f(t['entry_time'])} | {t['side']} | {t['entry']:.6g} | {t['qty']:.6g} | ${t['margin']:.2f} | {t['lev']}x | ${t['equity_at_entry']:.2f} | {t['liq_at_entry']:.6g} | {f(t['exit_time']) if t['exit_time'] else 'open (last '+format(t['exit_price'],'.6g')+')'} | {t['exit_price']:.6g} | {dur(t['mins'])} | {t['gross']:+.4f} | {fees:.4f} | {t['fund']:+.4f} | {t['pnl']:+.4f} | {t['result']} |")
    op = s['op']
    if op:
        L += ["", "**Still-open positions at the end:**", ""]
        for t in op:
            dist = abs(t['liq_now'] - t['exit_price']) / t['exit_price'] * 100 if t['liq_now'] > 0 else None
            L.append(f"- {t['coin']} {t['side']} from {t['entry']:.6g}: last price {t['exit_price']:.6g}, unrealized {t['pnl']:+.2f} USDT, cross liquidation price now {t['liq_now']:.6g}" + (f" ({dist:.1f}% away)" if dist else " (no liquidation price — account covers the whole position)"))
    return L + [""]
def write_trades(o, s, path):
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["coin","signal_candle_utc","entry_utc","side","entry_price","qty","margin","leverage","equity_at_entry","liq_price_at_entry","exit_utc","exit_or_last_price","duration_min","gross_pnl","fees","funding","net_pnl","status"])
        for t in sorted(s['tr'], key=lambda t: t['entry_time']):
            w.writerow([t['coin'], f(t['signal_time']), f(t['entry_time']), t['side'], t['entry'], t['qty'], t['margin'], t['lev'], round(t['equity_at_entry'],4), t['liq_at_entry'], f(t['exit_time']) if t['exit_time'] else '', t['exit_price'], round(t['mins']), round(t['gross'],5), round(t['fee_in']+t['fee_out'],5), round(t['fund'],5), round(t['pnl'],5), t['result']])
        for x in o['skipped']:
            w.writerow([x['coin'], f(x['signal_time']), f(x['confirm_time']), x['side'], '', '', '', '', '', '', '', '', '', '', '', '', '', 'SKIPPED: ' + x['reason']])
sA, sB = summary(A), summary(B)
L = ["# prompt-70 — OB STRONG 30m, shared $10 CROSS-margin account, 7-day backtest (30 coins)", "",
     f"Window: {f(A['start'])} → {f(A['end'])} UTC. Backtest only — the live Simulator, scanner, database and Telegram were not touched.", "",
     "**Rules used:** OB STRONG (your original script, unchanged, default inputs) on Binance USDⓈ-M Futures 30m candles; a signal is entered at the open of the minute after the alert candle closes (no look-ahead). One shared $10 cross-margin account, 7 slots, fixed $0.50 margin per trade (5% of the initial $10), 75x, no stop loss, no time exit. Exit = +50% of margin net ($0.25 after both fees and funding) or cross-margin liquidation. Exits/liquidation checked minute by minute on 1m futures candles. Fee 0.05% per side (Binance taker), 0.02% slippage per side, real historical funding. Maintenance margin: Binance's tier table per coin (downloaded today).", "",
     "**Important finding before the results:** 7 of the 30 coins cannot be opened at 75x on Binance — W, DOGS, PROM, FLUX, BOME (max 50x), FF and 1000CAT (max 20x). The main result (Scenario A) follows your exact settings, so their signals are recorded as *not tradable at 75x*. Scenario B shows what happens if those 7 coins trade at their own maximum leverage with the same $0.50 margin.", "",
     "All 30 pairs exist and are trading on Binance USDⓈ-M Futures; full 7-day 1m and 30m history was available for every coin.", ""]
L += block(A, sA, "Scenario A — exact settings (75x only)") + durations(A, sA) + coins(A, sA, f"{OUT}/prompt70-coins.csv") + history(sA)
L += block(B, sB, "Scenario B — capped coins at their maximum leverage (W/DOGS/PROM/FLUX/BOME 50x, FF/1000CAT 20x)") + durations(B, sB) + coins(B, sB) + history(sB)
L += ["## How cross margin was calculated", "",
      "- Equity = wallet balance + unrealized P&L of every open trade. Wallet = $10 + realized profits − all fees − funding.",
      "- A new trade opens only if available margin (equity − $0.50 for each open trade) still covers $0.50 plus the entry fee.",
      "- Liquidation check every minute: if equity at each open trade's worst price in that minute falls to or below the total maintenance margin (notional × tier rate − tier deduction), the whole account is liquidated. This is stricter than reality because different coins rarely hit their worst prices in the same minute.",
      "- The liquidation price shown per trade is Binance's cross-margin formula at the moment of entry, holding the other open trades at their prices at that time. In cross margin this price moves whenever other trades gain, lose, open or close.",
      "- With $10 of shared collateral behind each $37.50 position, a single trade's liquidation is roughly 25–35% away instead of the ~0.8% of isolated $0.50 margin; that is why no trade was liquidated this week.", "",
      "## Limitations", "",
      "- Binance liquidates on the **mark price**; historical mark-price 1m candles were not used, last-trade prices were. Mark price is usually smoother, so this is slightly conservative.",
      "- Maintenance tiers are Binance's **current** tables; Binance does not publish historical tier tables. For $37.50 positions only tier 1 applies.",
      "- Same coin long and short at once (e.g. AVAX) assumes Hedge Mode; in One-way Mode the second order would reduce the first instead.",
      "- Exact liquidation timing, partial liquidation order and the insurance-fund clearance fee cannot be reproduced exactly without account-level data; a liquidation in this test would wipe the account.",
      "- If several exits and the liquidation test land in the same minute, liquidation is checked first (conservative).",
      "- OB STRONG itself has no exit rule, so INDICATOR EXIT never occurs; exits are only TP HIT, STILL OPEN or LIQUIDATED.", ""]
open(f"{OUT}/prompt70-report.md", "w").write("\n".join(L))
write_trades(A, sA, f"{OUT}/prompt70-trades.csv"); write_trades(B, sB, f"{OUT}/prompt70-trades-scenarioB.csv")
print("\n".join(L[:60]))
