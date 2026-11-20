"""prompt-60 report builder (offline research only)."""
import json, sys, csv, datetime, statistics, collections
from pathlib import Path
OUT = Path(sys.argv[1]); DOC = Path(sys.argv[2]); DOC.mkdir(parents=True, exist_ok=True)
R = {v: json.loads((OUT/f'result60-{v}.json').read_text()) for v in ('main', 'futures_signals', 'exchange_rules')}
CHK = json.loads((OUT/'checks60.json').read_text())
f = lambda t: datetime.datetime.fromtimestamp(t/1000, datetime.UTC).strftime('%Y-%m-%d %H:%M') if t else '—'
dh = lambda m: f"{int(m//60)}h {int(m%60):02d}m"
def stats(r):
    T = r['trades']; tp = [p for p in T if p['status'] == 'TP']; lq = [p for p in T if p['status'] == 'LIQUIDATED']; op = [p for p in T if p['status'] == 'OPEN']
    closed = tp + lq; dur = [(p['exit_time']-p['entry_time'])/60000 for p in closed]
    peak_wallet = 10.0; w = 10.0
    for p in sorted(closed, key=lambda p: p['exit_time']):
        w += p['net'] if p['status'] == 'TP' else 0
    return dict(T=T, tp=tp, lq=lq, op=op, closed=closed, dur=dur,
                realized=sum(p['net'] for p in closed), tp_profit=sum(p['net'] for p in tp), liq_loss=sum(p['net'] for p in lq))
m = R['main']; s = stats(m)
L = []; A = L.append
A("# OB Entry Signals — 7-day backtest (prompt-60)\n")
A(f"**Window:** {f(m['window_utc'][0])} → {f(m['window_utc'][1])} UTC (exact previous 7 days). **Research only — the live Simulator, scanner, balance, Telegram and website were not changed.**\n")
A("## Rules used (exactly as requested)\n")
A("- Entries: ONLY the uploaded *OB Entry Signals* indicator (default inputs), 5-minute candles, every Enter Long / Enter Short signal; no other indicator or filter.")
A("- Signal candles: Binance **spot** 5m (the same chart you use on TradingView, and the live setup since prompt-52). Trades settle on Binance USD-M futures 1-minute prices. A futures-candle run is shown below for comparison.")
A("- 12 coins: BTC ETH SOL XRP BNB DOGE LINK NEAR BCH LTC ADA AVAX (USDT).")
A("- $10 account, 6 slots, each slot **$0.50 margin** (5% of $10), 75x (unchanged existing rule) → $37.50 position.")
A("- No stop loss, no time close, no loss close. Take profit = **+$0.25 net** (50% of the $0.50 margin) after both Binance taker fees (0.05% each), 0.02% slippage and funding.")
A("- Several trades on the same coin allowed (each signal uses its own slot). A new signal is skipped only when all 6 slots are busy.")
A("- Entry at the first futures price right after the signal candle closes (the indicator fires its alert at that moment).")
A("- Cross margin on the whole $10 account. Binance still force-closes (liquidates) every position when the account equity falls to the maintenance margin — this cannot be switched off by removing the stop loss, so the test applies it using Binance mark prices.\n")
A("## Result summary\n")
lq = m['liquidation']
A("| Item | Result |\n|---|---|")
rows = [
 ("Signals from the indicator in 7 days", f"{len(m['signals'])} ({sum(x['side']=='LONG' for x in m['signals'])} LONG / {sum(x['side']=='SHORT' for x in m['signals'])} SHORT)"),
 ("Total trades opened", len(s['T'])),
 ("Winning trades (TP hit)", len(s['tp'])),
 ("Losing trades", f"{len(s['lq'])} (all liquidated together)"),
 ("Win rate (closed trades)", f"{len(s['tp'])/len(s['closed'])*100:.1f}%"),
 ("Total Take Profit hits", len(s['tp'])),
 ("Profit from TP hits", f"+${s['tp_profit']:.2f}"),
 ("Loss from liquidated trades", f"${s['liq_loss']:.2f}"),
 ("Total realized profit", f"${m['wallet_realized']-10:.2f} (account $10.00 → ${m['wallet_realized']:.2f})"),
 ("Account liquidated", f"YES — {f(lq['time'])} UTC, ~{(lq['time']-m['window_utc'][0])/3600000:.0f} h after start" if lq else "No"),
 ("Maximum unrealized (floating) loss, whole account", f"${m['max_unrealized_loss']:.2f} at {f(m['max_unrealized_loss_time'])}"),
 ("Maximum drawdown", f"${m['max_drawdown']:.2f} (100% of equity — account reached $0)" if lq else f"${m['max_drawdown']:.2f}"),
 ("Highest floating loss on one trade", (lambda p: f"${p['max_dn']:.2f} — #{p['id']} {p['sym']} {p['side']}")(min(s['T'], key=lambda p: p['max_dn']))),
 ("Average trade duration (closed)", dh(statistics.mean(s['dur']))),
 ("Average time to TP (winners)", dh(statistics.mean([(p['exit_time']-p['entry_time'])/60000 for p in s['tp']]))),
 ("Longest trade duration", dh(max(s['dur']))),
 ("Maximum slots in use at once", f"{m['max_slots']} of 6"),
 ("Signals skipped: all 6 slots busy", sum(1 for x in m['signals'] if x.get('result') == 'skipped: all 6 slots in use')),
 ("Signals skipped: account already liquidated", sum(1 for x in m['signals'] if x.get('result') == 'skipped: account already liquidated')),
 ("Trades still open at the end", f"{len(s['op'])}" + (" (account was liquidated earlier)" if lq else "")),
 ("Final account balance", f"${m['wallet_realized']:.2f}"),
]
for k, v in rows: A(f"| {k} | {v} |")
A("")
A("## What happened\n")
A(f"The first {len(s['tp'])} closed trades were all winners (+$0.25 each). But six LONG positions opened on 13–14 Nov (DOGE, BTC ×2, ETH ×2, XRP) kept falling with the whole market. With no stop loss they stayed open; the combined floating loss on $225 of positions ate the $10 account plus all profits, and Binance's cross-margin rules liquidated all six together on {f(lq['time'])} UTC. After that the account was $0 and the remaining {sum(1 for x in m['signals'] if x.get('result') == 'skipped: account already liquidated')} signals could not be traded.\n")
A("| # | Coin | Side | Opened (UTC) | Entry | Liquidated at (mark) | Loss |\n|---|---|---|---|---|---|---|")
for p in s['lq']: A(f"| {p['id']} | {p['sym']} | {p['side']} | {f(p['entry_time'])} | {p['entry']:.6g} | {p['exit']:.6g} | ${p['net']:.2f} |")
A("")
A("## Trades per coin\n")
A("| Coin | Trades | TP | Liquidated | Net |\n|---|---|---|---|---|")
by = collections.defaultdict(list)
for p in s['T']: by[p['sym']].append(p)
for c in ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","LINKUSDT","NEARUSDT","BCHUSDT","LTCUSDT","ADAUSDT","AVAXUSDT"]:
    g = by.get(c, []); A(f"| {c} | {len(g)} | {sum(p['status']=='TP' for p in g)} | {sum(p['status']=='LIQUIDATED' for p in g)} | ${sum(p.get('net',0) for p in g):.2f} |")
A("")
A("## Every trade\n")
A("| # | Coin | Side | Opened (UTC) | Entry | Closed (UTC) | Result | Net | Worst floating | Duration |\n|---|---|---|---|---|---|---|---|---|---|")
for p in s['T']: A(f"| {p['id']} | {p['sym']} | {p['side']} | {f(p['entry_time'])} | {p['entry']:.6g} | {f(p.get('exit_time'))} | {p['status']} | ${p.get('net',0):.2f} | ${p['max_dn']:.2f} | {dh((p['exit_time']-p['entry_time'])/60000) if 'exit_time' in p else 'open'} |")
A("")
sig = m['signals']; alone_tp = sum(1 for x in sig if x['alone_tp_time']); alone_wipe = sum(x['alone_liquidated_isolated'] for x in sig)
A("## Why it looks like 'every signal hits TP' on TradingView\n")
A(f"- The indicator gave **{len(sig)} signals** in 7 days (about {len(sig)/12/7:.0f} per coin per day), not a few.")
A(f"- On the chart, the indicator only keeps a label if its order block is still unbroken and among the 3 nearest blocks *at the last candle*. When price later breaks through a block (usually a losing trade), its old labels disappear. At the end of this window only **{sum(x['label_still_on_chart'] for x in sig)} of {len(sig)}** labels would still be visible.")
sh = [x for x in sig if x['label_still_on_chart']]; hd = [x for x in sig if not x['label_still_on_chart']]
A(f"- Taken one by one (no slot limit), {alone_tp} of {len(sig)} signals ({alone_tp/len(sig)*100:.1f}%) did reach +50% before the week ended. But {alone_wipe} of them ({alone_wipe/len(sig)*100:.0f}%) first went so far against the entry that the full $0.50 margin was lost on paper. For visible labels that happened {sum(x['alone_liquidated_isolated'] for x in sh)} of {len(sh)} times ({sum(x['alone_liquidated_isolated'] for x in sh)/len(sh)*100:.0f}%); for hidden labels {sum(x['alone_liquidated_isolated'] for x in hd)} of {len(hd)} ({sum(x['alone_liquidated_isolated'] for x in hd)/len(hd)*100:.0f}%).")
A("- So the chart shows mostly the trades that went well; the alerts a live system receives include all of them. At 75x with no stop loss, a ~1.3% move against a position wipes its margin, and the account needs only a few of those at once.\n")
A("## Comparison runs (same rules)\n")
A("| Run | Signals | Trades | TP | Liquidated | Liquidation time | Final balance |\n|---|---|---|---|---|---|---|")
names = dict(main='Main: spot signal candles (paper sizing)', futures_signals='Futures signal candles', exchange_rules='Spot signals + real Binance order-size rules')
for v, r in R.items():
    q = stats(r); A(f"| {names[v]} | {len(r['signals'])} | {len(q['T'])} | {len(q['tp'])} | {len(q['lq'])} | {f(r['liquidation']['time']) if r['liquidation'] else '—'} | ${r['wallet_realized']:.2f} |")
A("\nReal Binance rules: a $37.50 BTCUSDT order is below Binance's $50 BTC minimum, so every BTC signal would be rejected on the real exchange (7 skipped in that run).\n")
A("## Verification\n")
A(f"- Indicator logic ported line by line from the uploaded file (saved unchanged in `research/prompt-60/OB_Entry_Signals.pine`); default inputs (swing 5, Wick invalidation, 4-bar signal spacing).")
A(f"- No look-ahead: for 180 random signals the candle after the signal was replaced by a random candle — all 180 signals still fired ({sum(v['lookahead_mismatch'] for v in CHK.values())} mismatches).")
A(f"- Warm-up: 14 days of history before the window. With only 7 days: {sum(v['warmup']['7d']['missing']+v['warmup']['7d']['extra'] for v in CHK.values())} differences; with 3 days: {sum(v['warmup']['3d']['missing']+v['warmup']['3d']['extra'] for v in CHK.values())}.")
A(f"- Every signal candle re-checked against the indicator's retest rule: {sum(v['retest_condition_failures'] for v in CHK.values())} failures.")
A(f"- Same-minute TP/liquidation ambiguities: {m['ambiguous_same_minute']}. Liquidation uses the worse 1-minute mark price of each coin at once (cautious).")
A("- Not independently certified against a TradingView export; positions on the same coin are kept separate (Binance hedge mode).\n")
A("## Data\n")
A("Binance spot 5m and USD-M futures 5m (from 14 days before the window), futures 1m last and mark prices, funding history, exchange rules and margin tiers. SHA-256 per coin:\n")
for k, v in m['data_sha256'].items(): A(f"- {k}: `{v}`")
(DOC/'prompt60-report.md').write_text("\n".join(L).replace('$-', '−$'))
keys = ['id','signal_id','sym','side','signal_time','entry_time','entry','indicator_entry','qty','notional','margin','tp_at_entry','status','exit_time','exit','net','max_dn','funding','label_still_on_chart']
with open(DOC/'prompt60-trades.csv', 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(keys)
    for p in s['T']: w.writerow([f(p[k]) if k.endswith('_time') and p.get(k) else p.get(k, '') for k in keys])
sk = ['id','sym','side','signal_time','indicator_entry','ob_top','ob_bottom','result','label_still_on_chart','alone_tp_time','alone_worst_float_before_tp','alone_liquidated_isolated']
with open(DOC/'prompt60-signals.csv', 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(sk)
    for x in sig: w.writerow([f(x[k]) if k.endswith('_time') and x.get(k) else x.get(k, '') for k in sk])
print(open(DOC/'prompt60-report.md').read()[:6000])
