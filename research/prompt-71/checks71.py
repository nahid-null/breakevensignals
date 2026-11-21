"""prompt-71 checks: (1) Python port vs intact Pine run in PineTS, (2) look-ahead (truncated history), (3) warm-up sensitivity,
(4) TP / fee reconciliation, (5) data completeness. Offline only."""
import json, sys, random, collections
sys.path.insert(0, "/dev-server/research/prompt-71"); from cstf71 import run
SYMS = "ZEN GALA S ETH SOL XRP LINK NEAR BCH LTC ADA AVAX TRX BNB UNI WLD WIF CRV EGLD FIL SAND HBAR".split()
R = "/tmp/r71/raw"; M = json.load(open(f"{R}/meta.json")); START, END = M['start'], M['end']
P = json.load(open("/tmp/r71/pinets_all.json")); res = {}
mm_all = mm_win = tot_all = tot_win = 0; look = [0, 0]; warm = collections.Counter(); diffs = []
random.seed(71)
for c in SYMS:
    s = c + "USDT"; k = json.load(open(f"{R}/{s}.json"))['m30']; T = [x[0] for x in k]; cols = [[x[j] for x in k] for j in range(1, 6)]
    ev = run(*cols); py = {(T[e['bar']], e['side']) for e in ev}
    pt = {(t, 'LONG') for t in P[s]['long']} | {(t, 'SHORT') for t in P[s]['short']}
    pt = {x for x in pt if x[0] != T[-1]}   # last bar is still forming in a live chart; barstate.isconfirmed edge
    py_ = {x for x in py if x[0] != T[-1]}
    sd = py_ ^ pt; mm_all += len(sd); tot_all += len(py_ | pt)
    win = lambda x: START <= x[0] + 1800000 < END
    mm_win += len({x for x in sd if win(x)}); tot_win += len({x for x in py_ | pt if win(x)})
    diffs += [(s, x, x in py_) for x in sd if win(x)]
    # look-ahead: recompute on history truncated at the signal bar for 15 random window bars (signals + non-signals)
    wbars = [i for i in range(len(T)) if START <= T[i] + 1800000 < END]
    for i in random.sample(wbars, 15) + [e['bar'] for e in ev if win((T[e['bar']], 0))][:10]:
        sub = {(T[e['bar']], e['side']) for e in run(*[col[:i + 1] for col in cols]) if e['bar'] == i}
        full = {x for x in py if x[0] == T[i]}; look[0] += 1; look[1] += (sub != full)
    # warm-up: start the indicator only 10 days / 5 days before the window
    for days in (10, 5):
        j = next(i for i in range(len(T)) if T[i] >= START - days * 86400000)
        sub = {(T[j + e['bar']], e['side']) for e in run(*[col[j:] for col in cols])}
        warm[days] += len({x for x in sub ^ py if win(x)})
print("PineTS vs Python: all bars", tot_all, "mismatch", mm_all, "| window", tot_win, "mismatch", mm_win, diffs[:10])
print("look-ahead samples", look[0], "mismatches", look[1]); print("warm-up window diffs", dict(warm))
o = json.load(open("/tmp/r71/outMAIN.json"))
tp = [t for t in o['trades'] if t['result'] == 'TP HIT']
print("TP net pnl min/max", min(t['pnl'] for t in tp), max(t['pnl'] for t in tp), "count", len(tp))
print("margin per trade", {round(t['margin'], 6) for t in o['trades']}, "lev", {t['lev'] for t in o['trades']})
cash = 10 + sum(t['pnl'] for t in o['trades'] if t['result'] != 'STILL OPEN') - sum(t['fee_in'] + t['fund'] for t in o['trades'] if t['result'] == 'STILL OPEN')
print("wallet reconcile", round(cash, 6), round(o['wallet'], 6))
json.dump(dict(pinets_total=tot_all, pinets_mismatch=mm_all, pinets_window=tot_win, pinets_window_mismatch=mm_win, diffs=diffs,
               look_samples=look[0], look_mismatch=look[1], warm=dict(warm)), open("/tmp/r71/checks.json", "w"))
