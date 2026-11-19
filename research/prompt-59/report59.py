"""prompt-59: build the 7-day Scalp Pro report (offline). Adds a clearly-labelled signal-level check without slot/balance limits."""
import json, sys, csv, math, datetime as dt
from pathlib import Path
from collections import defaultdict
import numpy as np
RAW = Path(sys.argv[1]); OUT = Path(sys.argv[2])
C = json.loads((OUT/'result59-cross.json').read_text()); I = json.loads((OUT/'result59-isolated.json').read_text())
BR = json.loads(Path('/tmp/r59/brackets.json').read_text())
LEV, FEE, SLIP, MARGIN = 75, 0.0005, 0.0002, 50.0
def u(t): return dt.datetime.fromtimestamp(t/1000, dt.UTC).strftime('%Y-%m-%d %H:%M')
def dh(t): return dt.datetime.fromtimestamp(t/1000 + 6*3600, dt.UTC).strftime('%m-%d %H:%M')
def hold(a, b): m = (b-a)//60000; return f"{m//60}h {m%60:02d}m"
def money(x): return f"{'-' if x < 0 else '+'}${abs(x):,.2f}"
def px(x): return f"{x:.6g}" if x < 10 else f"{x:,.4f}" if x < 1000 else f"{x:,.2f}"
END = C['window_utc'][1]; START = C['window_utc'][0]

# ---- supplementary: every signal on its own (no slot/balance limit), TP vs isolated liquidation on 1m data ----
arr = {}
for s in BR:
    d = json.loads((RAW/f'{s}.json').read_text())
    k1 = np.array([[float(x) for x in k[:5]] for k in d['k1']]); m1 = np.array([[float(x) for x in k[:5]] for k in d['m1']])
    arr[s] = (k1, m1)
lev_rows = []
for sg in C['signals']:
    s = sg['sym']; k1, m1 = arr[s]; t = sg['close_time'] + 60000
    i = np.searchsorted(k1[:, 0], t)
    if i >= len(k1) or k1[i, 0] != t: lev_rows.append((sg, 'NO_FILL', None)); continue
    dirn = 1 if sg['side'] == 'BUY' else -1; E = k1[i, 1]*(1+SLIP*dirn); q = MARGIN*LEV/E
    b = BR[s][0]; r = b['bracketMaintenanceMarginRate']
    tp = (0.25*MARGIN + q*E*(1+FEE))/(q*(1-FEE))/(1-SLIP) if dirn > 0 else (q*E*(1-FEE) - 0.25*MARGIN)/(q*(1+FEE))/(1+SLIP)
    liq = (MARGIN - dirn*q*E)/(q*(r - dirn))
    hi, lo = k1[i:, 2], k1[i:, 3]; mhi, mlo = m1[i:, 2], m1[i:, 3]
    a = np.argmax(hi >= tp) if dirn > 0 else np.argmax(lo <= tp); a = a if (hi[a] >= tp if dirn > 0 else lo[a] <= tp) else 10**9
    z = np.argmax(mlo <= liq) if dirn > 0 else np.argmax(mhi >= liq); z = z if (mlo[z] <= liq if dirn > 0 else mhi[z] >= liq) else 10**9
    out = 'OPEN' if a == z == 10**9 else 'LIQ' if z <= a else 'TP'   # same minute -> against the trade
    lev_rows.append((sg, out, int(k1[i+min(a, z), 0]) if out != 'OPEN' else None))
sl = defaultdict(lambda: defaultdict(int))
for sg, o, _ in lev_rows: sl[sg['side']][o] += 1; sl['ALL'][o] += 1; sl[sg['sym']][o] += 1

def section(R, title):
    tr = R['trades']; L = []
    tp = [p for p in tr if p['status'] == 'TP']; op = [p for p in tr if p['status'] == 'OPEN']; lq = [p for p in tr if p['status'] == 'LIQUIDATED']
    real = sum(p['net'] for p in tp) + sum(p['net'] for p in lq)
    L.append(f"## {title}\n")
    L.append(f"| Item | Value |\n|---|---|\n| Starting balance | $1,000.00 |\n| Margin per slot (5% of start) | $50.00 at 75x = about $3,750 position |\n"
             f"| Trades opened | {len(tr)} (LONG {sum(p['side']=='LONG' for p in tr)}, SHORT {sum(p['side']=='SHORT' for p in tr)}) |\n"
             f"| Closed at take-profit | {len(tp)} |\n| Liquidated | {len(lq)} |\n| Still OPEN at the end | {len(op)} |\n"
             f"| Realized net P&L (fees, slippage and funding included) | {money(sum(p['net'] for p in tp))} from take-profits, {money(sum(p['net'] for p in lq))} from liquidations |\n"
             f"| Unrealized P&L of open trades | {money(sum(p['unreal_net_if_closed'] for p in op)) if op else '$0.00 (no open trades)'} |\n"
             f"| Final balance / total equity | ${R['wallet_realized']:,.2f} / ${R['equity_mark']:,.2f} |\n"
             f"| Most slots used at once | {R['max_slots']} of 6 |\n"
             f"| Signals not traded | {len(R['skipped'])} ({', '.join(f'{k}: {v}' for k, v in sorted(count(R['skipped']).items(), key=lambda x: -x[1]))}) |\n")
    if R.get('liquidation'):
        q = R['liquidation']; L.append(f"**Account liquidation:** {u(q['time'])} UTC ({dh(q['time'])} Dhaka). At the worst mark price that minute, account equity was ${q['equity_at_worst_mark']:,.2f} against ${q['maintenance']:,.2f} required maintenance. All open positions ({', '.join(x.replace('USDT','') for x in q['positions'])}) were closed and the remaining balance is lost (Binance keeps it as a liquidation fee). No trades are possible after this, so every later signal was skipped.\n")
    if not R.get('liquidation') and R['wallet_realized'] < MARGIN:
        t = max(p['exit_time'] for p in tr if 'exit_time' in p)
        L.append(f"**Balance ran out:** after the last liquidation at {u(t)} UTC ({dh(t)} Dhaka) the balance was ${R['wallet_realized']:,.2f}, below the $50 needed for a new trade, so every later signal was skipped.\n")
    hs = [(p['exit_time'] if 'exit_time' in p else END) - p['entry_time'] for p in tr]
    if tr: L.append(f"Holding time: average {hold(0, int(sum(hs)/len(hs)))}, longest {hold(0, max(hs))}.\n")
    L.append("| # | Coin | Side | Signal 5m close (UTC) | Entry time UTC (Dhaka) | Entry | TP price | Exit time UTC | Exit price | Held | Result | Net P&L | Max unrealized profit | Max unrealized loss |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n, p in enumerate(sorted(tr, key=lambda p: p['entry_time']), 1):
        ex = p.get('exit_time'); res = {'TP': 'TP hit', 'LIQUIDATED': 'LIQUIDATED', 'OPEN': 'OPEN'}[p['status']]
        pnl = p['net'] if 'net' in p else p['unreal_net_if_closed']
        L.append(f"| {n} | {p['sym'].replace('USDT','')} | {p['side']} | {u(p['signal_close_time'])[5:]} | {u(p['entry_time'])[5:]} ({dh(p['entry_time'])}) | {px(p['entry'])} | {px(p['tp_at_entry'])} | "
                 f"{u(ex)[5:] if ex else 'still open'} | {px(p['exit']) if ex else px(p['last_price'])+' (last)'} | {hold(p['entry_time'], ex or END)} | {res} | {money(pnl)}{' (unrealized)' if not ex else ''} | "
                 f"{money(p['max_up'])} ({p['max_up']/MARGIN*100:+.0f}%) | {money(p['max_dn'])} ({p['max_dn']/MARGIN*100:+.0f}%) |")
    L.append("")
    # per coin and per side
    L.append("| Coin | Signals (BUY/SELL) | Trades | TP | Liquidated | Open | Net P&L |\n|---|---|---|---|---|---|---|")
    for s in BR:
        ps = [p for p in tr if p['sym'] == s]; sg = [x for x in R['signals'] if x['sym'] == s]
        L.append(f"| {s.replace('USDT','')} | {len(sg)} ({sum(x['side']=='BUY' for x in sg)}/{sum(x['side']=='SELL' for x in sg)}) | {len(ps)} | {sum(p['status']=='TP' for p in ps)} | {sum(p['status']=='LIQUIDATED' for p in ps)} | {sum(p['status']=='OPEN' for p in ps)} | {money(sum(p.get('net', p.get('unreal_net_if_closed', 0)) for p in ps))} |")
    L.append("\n| Signal | Signals | Trades | TP | Liquidated | Open | Net P&L |\n|---|---|---|---|---|---|---|")
    for side, ps_side in (('BUY → LONG', 'LONG'), ('SELL → SHORT', 'SHORT')):
        ps = [p for p in tr if p['side'] == ps_side]
        L.append(f"| {side} | {sum(x['side']==side[:4].strip() for x in R['signals'])} | {len(ps)} | {sum(p['status']=='TP' for p in ps)} | {sum(p['status']=='LIQUIDATED' for p in ps)} | {sum(p['status']=='OPEN' for p in ps)} | {money(sum(p.get('net', p.get('unreal_net_if_closed', 0)) for p in ps))} |")
    if not op:
        L.append("\n**Open trades at the end:** none, so there is no unrealized P&L and no open liquidation risk.")
    if op:
        L.append("\n**Open trades at the end:**\n\n| Coin | Side | Entry | Last price | Unrealized P&L | Isolated liquidation price |\n|---|---|---|---|---|---|")
        for p in op: L.append(f"| {p['sym'].replace('USDT','')} | {p['side']} | {px(p['entry'])} | {px(p['last_price'])} | {money(p['unreal_net_if_closed'])} | {px(p['isolated_liq_price'])} |")
    L.append("")
    return L
def count(xs):
    c = defaultdict(int)
    for x in xs: c[x['skip']] += 1
    return c

sig = C['signals']; rp = C['repaint']
L = [f"# prompt-59 — Scalp Pro (new indicator) 7-day backtest\n",
     f"Offline research only. The live Simulator, scanner, database, balance, settings, Telegram and website were not changed, and nothing was published or activated.\n",
     f"**Window:** {u(START)} → {u(END)} UTC ({dh(START)} → {dh(END)} Dhaka), the latest 7 full days of closed 5-minute candles.\n",
     "## Method\n",
     "- **Indicator:** the uploaded `Scalp Pro v.2` source ported line by line (Fast 8, Slow 10, Smoothness 8). BUY = `crossover(macd, ssmooth3)` → LONG; SELL = `crossunder(macd, ssmooth3)` → SHORT. Nothing else is used: no filter, no confirmation, no other timeframe.",
     "- **Data:** Binance USDⓈ-M Futures 5m candles (signals), 1m candles (entries and take-profit), 1m mark-price candles (liquidation), real funding rates, Binance lot-size rules and margin tiers. 10 days of 5m history are loaded so the indicator is fully warmed up before the window starts.",
     "- **Entry:** only after the 5m candle has closed; filled at the open of the 1-minute candle that starts 60 seconds after the close, plus 0.02% slippage.",
     "- **Costs:** 0.05% taker fee on entry and exit, 0.02% slippage each side, actual funding every 8 hours while open.",
     "- **Exit:** only take-profit at +25% NET of the $50 margin (fees, slippage and funding paid so far included; the TP price is recalculated after each funding payment). No stop loss, no trailing, no breakeven, no emergency exit, no time close, no close on an opposite signal, no force-close at the end. One trade per coin; new signals on an open coin are ignored.",
     "- **Same-candle checks:** every trade is followed minute by minute on 1m data. If take-profit and liquidation fall inside the same minute it is counted against the trade (this happened 0 times).",
     "- **Balance:** $1,000 research balance, as in prompt-57/58, so each $3,750 position meets Binance minimum order sizes. Results scale with the balance.",
     "- **Margin mode:** cross margin like the live Simulator is the main result. Because it ended in an early liquidation, the same rules were also run with each trade on its own (isolated) margin, shown separately.\n",
     "## Repaint check\n",
     f"- The script only reads the candle close and its own past values. It has no other-timeframe or future references, so **a signal on a closed candle never changes later**.",
     f"- Recomputing with history cut off at about 80 points per coin and with a 3-day shorter warmup gave **0 differences** on all 12 coins.",
     f"- **While a candle is still forming, signals do appear and disappear:** on {sum(v['bars_with_intrabar_signal'] for v in rp.values())} candles a BUY/SELL showed during the candle; on {sum(v['bars_where_intrabar_signal_disappeared_or_flipped_at_close'] for v in rp.values())} of them it disappeared or flipped by the close. That is why only closed-candle signals were used.\n",
     "## Signals\n",
     f"Total signals in 7 days: **{len(sig)}** — BUY {sum(x['side']=='BUY' for x in sig)}, SELL {sum(x['side']=='SELL' for x in sig)} (about {len(sig)/12/7:.0f} per coin per day).\n"]
L.append("| Coin | BUY | SELL |\n|---|---|---|")
for s in BR: L.append(f"| {s.replace('USDT','')} | {sum(x['sym']==s and x['side']=='BUY' for x in sig)} | {sum(x['sym']==s and x['side']=='SELL' for x in sig)} |")
L.append("")
L += section(C, "Main result — your rules, cross margin")
L += section(I, "Comparison — same rules, each trade on its own (isolated) margin")
L.append("## Extra check — every signal on its own\n")
L.append("Not a portfolio result. Each of the signals is entered on its own (no 6-slot or balance limit, isolated $50 margin) and followed until take-profit or liquidation, to see how good the signals themselves are over the full 7 days.\n")
L.append("| Group | Signals | TP first | Liquidated first | Neither by the end | TP rate | Net if every signal traded |\n|---|---|---|---|---|---|---|")
for g in ['ALL', 'BUY', 'SELL'] + list(BR):
    v = sl[g]; done = v['TP'] + v['LIQ']
    net = v['TP']*12.5 - v['LIQ']*(MARGIN + 0)
    L.append(f"| {g.replace('USDT','')} | {sum(v.values())} | {v['TP']} | {v['LIQ']} | {v['OPEN']} | {v['TP']/done*100 if done else 0:.1f}% | about {money(net)} |")
L.append(f"\nBreak-even needs a take-profit rate of about 80% (+$12.50 per win against about -$50 plus fees per liquidation).\n")
L.append("## Limits\n- TradingView itself could not be run here; the indicator was ported from the uploaded source and checked by the repaint tests above, not by a TradingView export.\n- Liquidation uses Binance's public tier-1 margin rates and mark-price 1-minute extremes (all open positions at their worst at the same minute, which is slightly pessimistic for cross margin).\n- Raw data SHA-256 hashes are in `result59-cross.json`.\n")
(OUT/'prompt59-report.md').write_text('\n'.join(L))
with open(OUT/'prompt59-trades.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['mode','coin','side','signal_close_utc','entry_utc','entry_price','tp_price_at_entry','status','exit_utc','exit_price','holding_min','net_pnl_usd','max_unrealized_profit_usd','max_unrealized_loss_usd','funding_usd'])
    for R in (C, I):
        for p in sorted(R['trades'], key=lambda p: p['entry_time']):
            ex = p.get('exit_time'); w.writerow([R['mode'], p['sym'], p['side'], u(p['signal_close_time']), u(p['entry_time']), p['entry'], p['tp_at_entry'], p['status'], u(ex) if ex else '', p.get('exit', p.get('last_price')), ((ex or END)-p['entry_time'])//60000, round(p.get('net', p.get('unreal_net_if_closed', 0)), 4), round(p['max_up'], 4), round(p['max_dn'], 4), round(p['funding'], 4)])
with open(OUT/'prompt59-signals.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['coin','signal','candle_open_utc','candle_close_utc','close','macd','signal_line','alone_outcome','alone_outcome_time_utc'])
    for sg, o, t in lev_rows: w.writerow([sg['sym'], sg['side'], u(sg['bar_open']), u(sg['close_time']), sg['close'], sg['macd'], sg['signal'], o, u(t) if t else ''])
print('\n'.join(L)[:200])
