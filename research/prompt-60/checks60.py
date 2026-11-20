"""prompt-60 verification: (1) the alert on bar b depends only on candles up to b-1 (no look-ahead),
(2) warm-up length sensitivity, (3) each signal re-checked against the Pine retest condition on raw candles."""
import json, sys, random
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from ob60 import run
RAW = Path(sys.argv[1]); META = json.loads((RAW/'hashes.json').read_text()); START, END = META['start'], META['end']
SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","LINKUSDT","NEARUSDT","BCHUSDT","LTCUSDT","ADAUSDT","AVAXUSDT"]
random.seed(60); out = {}
for s in SYMS:
    k = json.loads((RAW/f'{s}.json').read_text())['spot5']; t5 = [int(x[0]) for x in k]
    O, H, L, C = ([float(x[j]) for x in k] for j in (1, 2, 3, 4))
    ev, _ = run(O, H, L, C)
    key = lambda e: (e['retest_bar'], e['side'])
    full = {key(e) for e in ev if START <= t5[e['retest_bar']]+300000 < END}
    # (1) no look-ahead: cut history right after the signal bar's first tick (bar b replaced by a random candle)
    la_bad = 0; sample = random.sample(sorted(full), min(15, len(full)))
    for rb, side in sample:
        b = rb + 1; o = C[rb]; x = o*(1+random.uniform(-0.02, 0.02))
        O2, H2, L2, C2 = O[:b]+[o], H[:b]+[max(o, x)*1.01], L[:b]+[min(o, x)*0.99], C[:b]+[x]
        e2, _ = run(O2, H2, L2, C2)
        if (rb, side) not in {key(e) for e in e2 if e['bar'] == b}: la_bad += 1
    # (2) warm-up: 7 and 3 days instead of 14 days before the window
    warm = {}
    for days in (7, 3):
        w = next(i for i, t in enumerate(t5) if t >= START - days*86400000)
        e3, _ = run(O[w:], H[w:], L[w:], C[w:])
        got = {(e['retest_bar']+w, e['side']) for e in e3 if START <= t5[e['retest_bar']+w]+300000 < END}
        warm[f'{days}d'] = dict(missing=len(full-got), extra=len(got-full))
    # (3) every signal candle satisfies the retest condition against its order block
    bad = 0
    for e in ev:
        rb = e['retest_bar']
        if e['side'] == 'LONG': ok = O[rb] > e['ob_top'] and C[rb] > e['ob_top'] and e['ob_bottom'] <= L[rb] <= e['ob_top']
        else: ok = O[rb] < e['ob_bottom'] and C[rb] < e['ob_bottom'] and e['ob_bottom'] <= H[rb] <= e['ob_top']
        bad += not ok or e['entry'] != C[rb]
    out[s] = dict(signals=len(full), lookahead_sampled=len(sample), lookahead_mismatch=la_bad, warmup=warm, retest_condition_failures=bad)
    print(s, out[s], flush=True)
Path(sys.argv[2]).write_text(json.dumps(out, indent=1))
