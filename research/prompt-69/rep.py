import json,datetime as dt,collections,csv
D=json.load(open("/tmp/r69/out.json"));T=D['trades']
f=lambda ms:dt.datetime.utcfromtimestamp(ms/1000).strftime("%Y-%m-%d %H:%M") if ms else "-"
du=lambda m:f"{int(m//60)}h {int(m%60)}m"
comp=[t for t in T if t['result'].startswith('COMP')];liq=[t for t in T if t['result']=='LIQUIDATED'];op=[t for t in T if t['result']=='STILL OPEN']
L=[f"# Prompt-69 — OB STRONG 30m backtest (no stop loss)\n",f"Window: {f(D['start'])} → {f(D['end'])} UTC. Backtest only; Simulator untouched.\n",
"Rules: OB STRONG (unchanged, default inputs) on Binance SPOT 30m candles; entry at the next 30m open; exits checked on SPOT 1m candles. Each coin its own $10 account, 7 slots, 5% of balance margin, 75x isolated, no stop loss, no time exit, take profit = +50% of margin net of costs. Liquidation at ~0.83% adverse move (75x minus 0.5% maintenance). Costs: 0.05% fee per side, 0.02% slippage per fill, real Binance futures funding every funding time.\n",
"## Totals\n","| Item | Value |","|---|---|",f"| Signals generated | {sum(D['sigs'].values())} |",f"| Trades executed | {len(T)} |",f"| Completed (take profit) | {len(comp)} |",f"| Still open | {len(op)} |",f"| Liquidated | {len(liq)} |",f"| Net result (all coins) | ${sum(t['pnl'] for t in T):+.2f} |"]
if comp:
    a=min(comp,key=lambda t:t['mins']);b=max(comp,key=lambda t:t['mins'])
    L+=[f"| Fastest completed | {a['coin']} {a['side']} — {du(a['mins'])} |",f"| Slowest completed | {b['coin']} {b['side']} — {du(b['mins'])} |",f"| Average completion time | {du(sum(t['mins'] for t in comp)/len(comp))} |"]
L+=["\n## Completed trades per day (UTC)\n","| Day | Completed | Liquidated |","|---|---|---|"]
dc=collections.Counter(f(t['exit_time'])[:10] for t in comp);dl=collections.Counter(f(t['exit_time'])[:10] for t in liq)
s=D['start']
for i in range(7):
    d=f(s+i*86400000)[:10];L.append(f"| {d} | {dc[d]} | {dl[d]} |")
L+=["\n## Per coin\n","| Coin | Signals | Executed | Completed | Open | Liquidated | Avg completion | Net $ |","|---|---|---|---|---|---|---|---|"]
for c in D['sigs']:
    x=[t for t in T if t['coin']==c];cc=[t for t in x if t['result'].startswith('COMP')]
    L.append(f"| {c} | {D['sigs'][c]} | {len(x)} | {len(cc)} | {sum(t['result']=='STILL OPEN' for t in x)} | {sum(t['result']=='LIQUIDATED' for t in x)} | {du(sum(t['mins'] for t in cc)/len(cc)) if cc else '-'} | {sum(t['pnl'] for t in x):+.2f} |")
L+=["\n## Every trade\n","| Coin | Side | Entry time | Entry | Exit time | Exit | Result | Duration | P&L $ |","|---|---|---|---|---|---|---|---|---|"]
for t in sorted(T,key=lambda t:t['signal_time']):
    L.append(f"| {t['coin']} | {t['side']} | {f(t['signal_time'])} | {t['entry']:.5g} | {f(t['exit_time'])} | {t['exit_price']:.5g} | {t['result']} | {du(t['mins'])} | {t['pnl']:+.3f} |")
import os;o="/mnt/documents/Simulator Performance Reports/prompt-69";os.makedirs(o,exist_ok=True)
open(o+"/prompt69-report.md","w").write("\n".join(L)+"\n")
with open(o+"/prompt69-trades.csv","w",newline="") as fh:
    w=csv.writer(fh);w.writerow(["coin","side","entry_time_utc","entry","margin","exit_time_utc","exit","result","minutes","funding","pnl"])
    for t in T: w.writerow([t['coin'],t['side'],f(t['signal_time']),t['entry'],round(t['margin'],4),f(t['exit_time']),t['exit_price'],t['result'],round(t['mins']),round(t['fund'],5),round(t['pnl'],4)])
print("\n".join(L))
