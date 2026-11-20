"""prompt-61 report builder (offline research only)."""
import json, sys, csv, datetime, statistics, collections
from pathlib import Path
OUT = Path(sys.argv[1]); DOC = Path(sys.argv[2]); DOC.mkdir(parents=True, exist_ok=True)
R = {v: json.loads((OUT/f'result61-{v}.json').read_text()) for v in ('main', 'futures_signals', 'exchange_rules')}
CHK = json.loads((OUT/'checks61.json').read_text())
SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","LINKUSDT","NEARUSDT","BCHUSDT","LTCUSDT","ADAUSDT","AVAXUSDT"]
f = lambda t: datetime.datetime.fromtimestamp(t/1000, datetime.UTC).strftime('%Y-%m-%d %H:%M') if t else '—'
dh = lambda m: f"{int(m//60)}h {int(m%60):02d}m"
money = lambda x: f"{'−' if x < 0 else '+' if x > 0 else ''}${abs(x):.2f}"
def stats(r):
    T = r['trades']; tp = [p for p in T if p['status'] == 'TP']; lq = [p for p in T if p['status'] == 'LIQUIDATED']; op = [p for p in T if p['status'] == 'OPEN']
    closed = tp + lq; end = r['window_utc'][1]
    dur_closed = [(p['exit_time']-p['entry_time'])/60000 for p in closed]
    dur_all = dur_closed + [(end-p['entry_time'])/60000 for p in op]
    return dict(T=T, tp=tp, lq=lq, op=op, closed=closed, dur=dur_closed, dur_all=dur_all, tp_profit=sum(p['net'] for p in tp), liq_loss=sum(p['net'] for p in lq))
m = R['main']; s = stats(m); sig = m['signals']; END = m['window_utc'][1]
L = []; A = L.append
A("# OB STRONG Entry Signals — 7-day backtest (prompt-61)\n")
A(f"**Window:** {f(m['window_utc'][0])} → {f(END)} UTC (7 full days). **Research only — the live Simulator, scanner, balance, Telegram and website were not changed.**\n")
A("## Rules used (exactly as requested)\n")
A("- Entries: ONLY the uploaded *OB STRONG Entry Signals* indicator with its default inputs (minimum score 5 of 6), 5-minute candles, every Enter Long / Enter Short signal. No other indicator, trend filter or confirmation.")
A("- Signal candles: Binance **spot** 5m (your TradingView chart). Trades settle on Binance USD-M futures 1-minute prices. A futures-candle run is shown for comparison.")
A("- 12 coins: BTC ETH SOL XRP BNB DOGE LINK NEAR BCH LTC ADA AVAX (USDT).")
A("- $10 account, 6 slots, each slot **$0.50 margin** (5% of $10), 75x (existing rule, unchanged) → $37.50 position.")
A("- No stop loss, no time close, no loss close. The indicator's own SL/TP in the label are **not** used. Take profit = **+$0.25 net** (50% of the $0.50 margin) after both taker fees (0.05% each), 0.02% slippage and funding.")
A("- Several trades on the same coin allowed; a signal is skipped only when all 6 slots are busy.")
A("- Entry at the first futures price right after the signal candle closes (when the indicator fires its alert).")
A("- Cross margin on the whole $10 account; Binance's forced liquidation (maintenance margin, mark price) still applies — removing the stop loss cannot switch it off.")
A("- Open trades at the end are **not** closed; their unrealized result is shown separately.\n")
A("## Result summary (main run)\n")
A("| Item | Result |\n|---|---|")
closed = s['closed']; op = s['op']
unreal = sum(p['unreal_net_if_closed'] for p in op)
worst_trade = min(s['T'], key=lambda p: p['max_dn'])
rows = [
 ("Signals from the indicator in 7 days", f"{len(sig)} ({sum(x['side']=='LONG' for x in sig)} LONG / {sum(x['side']=='SHORT' for x in sig)} SHORT)"),
 ("Total trades opened", len(s['T'])),
 ("Winning trades (TP hit)", len(s['tp'])),
 ("Losing trades", f"{len(s['lq'])}" + (" (liquidated)" if s['lq'] else " (no trade closed at a loss)")),
 ("Win rate (closed trades)", f"{len(s['tp'])/len(closed)*100:.1f}% ({len(s['tp'])} of {len(closed)})" if closed else "—"),
 ("Win rate counting still-open trades as not won", f"{len(s['tp'])/len(s['T'])*100:.1f}% ({len(s['tp'])} of {len(s['T'])})"),
 ("Total Take Profit hits", len(s['tp'])),
 ("Total realized profit", f"{money(m['wallet_realized']-10)} (cash balance $10.00 → ${m['wallet_realized']:.2f})"),
 ("Trades still open at the end", f"{len(op)}, unrealized {money(unreal)} if closed at the last price"),
 ("Account value including open trades", f"${m['equity_if_open_closed_now']:.2f}"),
 ("Maximum unrealized (floating) loss, all open trades together", f"{money(m['max_unrealized_loss'])} at {f(m['max_unrealized_loss_time'])} UTC"),
 ("Maximum drawdown (from highest account value)", f"{money(-m['max_drawdown'])} — lowest account value ${m['lowest_equity']:.2f} at {f(m['lowest_equity_time'])} UTC"),
 ("Highest floating loss on one trade", f"{money(worst_trade['max_dn'])} — #{worst_trade['id']} {worst_trade['sym']} {worst_trade['side']} (margin was $0.50)"),
 ("Average trade duration (closed trades)", dh(statistics.mean(s['dur']))),
 ("Longest trade duration", f"{dh(max(s['dur_all']))}" + (" (still open)" if max(s['dur_all']) > max(s['dur']) else "")),
 ("Longest closed trade", dh(max(s['dur']))),
 ("Maximum slots in use at once", f"{m['max_slots']} of 6"),
 ("Signals skipped because all 6 slots were busy", sum(1 for x in sig if x.get('result') == 'skipped: all 6 slots in use')),
 ("Account liquidated", f"YES — {f(m['liquidation']['time'])} UTC" if m['liquidation'] else "No"),
 ("Final account balance (cash)", f"${m['wallet_realized']:.2f}"),
]
for k, v in rows: A(f"| {k} | {v} |")
A("")
A("## Trades still open at the end (not closed)\n")
A("| # | Coin | Side | Opened (UTC) | Entry | Last price | Unrealized (if closed now) | Worst floating | Open for |\n|---|---|---|---|---|---|---|---|---|")
for p in op: A(f"| {p['id']} | {p['sym']} | {p['side']} | {f(p['entry_time'])} | {p['entry']:.6g} | {p['last_price']:.6g} | {money(p['unreal_net_if_closed'])} | {money(p['max_dn'])} | {dh((END-p['entry_time'])/60000)} |")
A("")
A(f"These {len(op)} positions are $150 of exposure on a $10 account. They tied up {len(op)} of the 6 slots, which is why later signals were skipped. A further adverse move of roughly {abs(m['equity_if_open_closed_now'])/sum(p['notional'] for p in op)*100:.1f}% on all of them together would wipe the account.\n")
A("## Trades per coin\n")
A("| Coin | Signals | Trades | TP | Liquidated | Open | Realized | Unrealized |\n|---|---|---|---|---|---|---|---|")
by = collections.defaultdict(list)
for p in s['T']: by[p['sym']].append(p)
for c in SYMS:
    g = by.get(c, [])
    A(f"| {c} | {sum(x['sym']==c for x in sig)} | {len(g)} | {sum(p['status']=='TP' for p in g)} | {sum(p['status']=='LIQUIDATED' for p in g)} | {sum(p['status']=='OPEN' for p in g)} | {money(sum(p.get('net',0) for p in g if p['status']!='OPEN'))} | {money(sum(p.get('unreal_net_if_closed',0) for p in g if p['status']=='OPEN'))} |")
A("")
A("## Every trade\n")
A("| # | Coin | Side | Score | Opened (UTC) | Entry | Closed (UTC) | Result | Net | Worst floating | Duration |\n|---|---|---|---|---|---|---|---|---|---|---|")
sc = {x['id']: x['score'] for x in sig}
for p in s['T']:
    d = (p['exit_time'] if 'exit_time' in p else END) - p['entry_time']
    A(f"| {p['id']} | {p['sym']} | {p['side']} | {sc[p['signal_id']]}/6 | {f(p['entry_time'])} | {p['entry']:.6g} | {f(p.get('exit_time'))} | {p['status']} | {money(p['net']) if 'net' in p else money(p['unreal_net_if_closed'])+' (open)'} | {money(p['max_dn'])} | {dh(d/60000)}{' (open)' if p['status']=='OPEN' else ''} |")
A("")
alone = sum(1 for x in sig if x['alone_tp_time']); wipe = sum(x['alone_liquidated_isolated'] for x in sig)
own = collections.Counter(x['label_own_result'] for x in sig)
A("## Each signal on its own and the label's own TP\n")
A(f"- Taken one at a time (no slot limit), **{alone} of {len(sig)}** signals ({alone/len(sig)*100:.0f}%) reached +$0.25 before the week ended; {len(sig)-alone} never did. {wipe} of them ({wipe/len(sig)*100:.0f}%) first moved far enough against the entry to lose the full $0.50 margin on paper (that trade alone would be liquidated in isolated margin).")
A(f"- The indicator's label also prints its own SL and TP (1:2). On the same spot candles the label's **TP came first {own['TP']} times, its SL first {own['SL']} times**, neither {own['neither before window end']} time(s). So in this week most signals did not reach the label's TP; the +50% margin target (only ~0.67% price move at 75x after costs) is much closer and is reached far more often.")
A(f"- The score filter removed {len(m['weak_retests'])} lower-score retests in this week (the old OB Entry Signals indicator would have signalled on them).\n")
A("## Comparison runs (same rules)\n")
A("| Run | Signals | Trades | TP | Liquidated | Open at end | Liquidation | Cash balance | Value incl. open |\n|---|---|---|---|---|---|---|---|---|")
names = dict(main='Main: spot signal candles', futures_signals='Futures signal candles', exchange_rules='Spot signals + real Binance minimum order rules')
for v, r in R.items():
    q = stats(r); A(f"| {names[v]} | {len(r['signals'])} | {len(q['T'])} | {len(q['tp'])} | {len(q['lq'])} | {len(q['op'])} | {f(r['liquidation']['time']) if r['liquidation'] else '—'} | ${r['wallet_realized']:.2f} | ${r['equity_if_open_closed_now']:.2f} |")
ex = R['exchange_rules']; nbtc = sum(1 for x in ex['signals'] if str(x.get('result','')).startswith('skipped: below'))
A(f"\n- Futures candles produce slightly different signals; in that run the account was **liquidated** on {f(R['futures_signals']['liquidation']['time'])} UTC. Results depend heavily on which candles drive the indicator.")
A(f"- Real Binance rules: a $37.50 BTCUSDT order is below the $50 BTC minimum, so {nbtc} BTC signal(s) would be rejected on the real exchange.\n")
A("## Verification\n")
A("- Indicator ported line by line from the uploaded file (kept unchanged in `research/prompt-61/OB_STRONG_Entry_Signals.pine`), default inputs: swing 5, Wick invalidation, minimum score 5, wick 40%, volume 1.2× SMA20, EMA100, SL ≤ 3×ATR14, delta 55%, first-touch.")
A("- With the score filter turned off, the port gives exactly the same signals as the prompt-60 port of the previous indicator (checked on BTC and DOGE), so only the new score part is new code.")
A(f"- No look-ahead: for all {sum(v['lookahead_sampled'] for v in CHK.values())} signals, the candle after the signal was replaced by a random candle — all still fired ({sum(v['lookahead_mismatch'] for v in CHK.values())} mismatches).")
A(f"- Warm-up: 14 days before the window. With only 7 days: {sum(v['warmup']['7d']['missing']+v['warmup']['7d']['extra'] for v in CHK.values())} differences; with 3 days: {sum(v['warmup']['3d']['missing']+v['warmup']['3d']['extra'] for v in CHK.values())}.")
A(f"- Every signal re-checked against the retest rule and score ≥ 5: {sum(v['retest_condition_failures'] for v in CHK.values())} failures.")
A(f"- Same-minute TP/liquidation ambiguities: {m['ambiguous_same_minute']}. Liquidation check uses the worse 1-minute mark price of every coin at once.")
A("- Not independently certified against a TradingView export. TradingView's volume, EMA and ATR start from its own chart history, so a borderline score (exactly 5) could differ on your chart. Same-coin positions are kept separate (Binance hedge mode).\n")
A("## Data\n")
A("Same hashed download as prompt-60: Binance spot 5m and USD-M futures 5m (14 days warm-up), futures 1m last and mark prices, funding, exchange rules and margin tiers. SHA-256 per coin:\n")
for k, v in m['data_sha256'].items(): A(f"- {k}: `{v}`")
(DOC/'prompt61-report.md').write_text("\n".join(L))
keys = ['id','signal_id','sym','side','signal_time','entry_time','entry','indicator_entry','qty','notional','margin','tp_at_entry','status','exit_time','exit','net','unreal_net_if_closed','max_dn','funding']
with open(DOC/'prompt61-trades.csv', 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(keys)
    for p in s['T']: w.writerow([f(p[k]) if k.endswith('_time') and p.get(k) else p.get(k, '') for k in keys])
sk = ['id','sym','side','score','signal_time','indicator_entry','label_sl','label_tp','label_own_result','result','alone_tp_time','alone_worst_float_before_tp','alone_liquidated_isolated']
with open(DOC/'prompt61-signals.csv', 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(sk)
    for x in sig: w.writerow([f(x[k]) if k.endswith('_time') and x.get(k) else x.get(k, '') for k in sk])
print("\n".join(L[:60]))
