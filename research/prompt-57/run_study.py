"""prompt-57 staged study. stage=select: development pick + validation ranking, then freezes selection-frozen.json.
stage=oos: reads the frozen file and evaluates the unseen period once. Offline only."""
import sys, pickle, json, hashlib, numpy as np, engine as e, strategies as S
OUT = '/tmp/r57/out'; import os; os.makedirs(OUT, exist_ok=True)
coins = pickle.load(open('/tmp/r57/work/coins.pkl', 'rb')); lab = e.Labeler(coins)
PR = json.load(open('protocol.json'))['periods']; ms = e.ms
DEV = (ms(PR['development'][0]), ms(PR['development'][1])); VAL = (ms(PR['validation'][0]), ms(PR['validation'][1]))
OOS = (ms(PR['out_of_sample'][0]), ms(PR['out_of_sample'][1]))
BATCH = {'validation': [('2026-10-01', '2026-10-08'), ('2026-10-08', '2026-10-15'), ('2026-10-15', '2026-10-26')],
         'out_of_sample': [('2026-10-26', '2026-11-02'), ('2026-11-02', '2026-11-09'), ('2026-11-09', '2026-11-19')]}
K = 2.0
def clean(p): return {k: (list(v) if isinstance(v, tuple) else v) for k, v in p.items()}
def tup(p): return {k: (tuple(v) if isinstance(v, list) else v) for k, v in p.items()}
def evaluate(name, params, per, label, k=K):
    sg = S.signals(coins, name, tup(params))
    ch = e.chain(lab, sg, k, per[0], per[1], resolve_by=per[1]); cst = e.stats(ch)
    pf = e.portfolio(lab, sg, k, per[0], per[1]); pst = e.stats(pf['trades'], pf['open'])
    batches = []
    for a, b in BATCH.get(label, []):
        tr = [t for t in pf['trades'] if ms(a) <= t['sig_t'] < ms(b)]; st = e.stats(tr)
        batches.append(dict(batch=f'{a}..{b}', completed=st['completed'], net=st['net'], win_rate=st['win_rate']))
    return dict(family=name, params=clean(params), chain=cst, portfolio=pst, batches=batches,
                wallet_end=pf['wallet'], equity_end=pf['equity_end'], max_dd=pf['max_dd'], min_liq_dist=pf['min_liq_dist'],
                max_unreal_loss=pf['max_unreal_loss'], liquidation=pf['liquidation'], skipped=pf['skipped'], open_end=len(pf['open'])), pf
stage = sys.argv[1]
if stage == 'select':
    picks = {}
    for name in S.FAMILIES:
        best = None
        for p in S.grid(name):
            ch = e.chain(lab, S.signals(coins, name, p), K, *DEV, resolve_by=DEV[1]); st = e.stats(ch)
            if st['completed'] >= 175 and (best is None or st['per_trade'] > best[1]['per_trade']): best = (p, st)
        if best: picks[name] = clean(best[0]); print('dev pick', name, best[0], best[1]['completed'], round(best[1]['per_trade'], 4))
    val = {}
    for name, p in picks.items():
        r, _ = evaluate(name, p, VAL, 'validation'); val[name] = r
        print('VAL', name, r['portfolio']['completed'], 'net$', round(r['portfolio']['net'], 2), 'win', round(r['portfolio']['win_rate'] or 0, 4), [b['completed'] for b in r['batches']])
    elig = [n for n, r in val.items() if all(b['completed'] >= 20 for b in r['batches'])]
    rank = sorted(elig, key=lambda n: -val[n]['portfolio']['net'])
    passed = [n for n in rank if val[n]['portfolio']['net'] > 0]
    sel = dict(selected=(passed or rank)[0], selected_params=picks[(passed or rank)[0]], validation_passed=bool(passed),
               ranking=rank, dev_picks=picks, frozen_utc=__import__('datetime').datetime.utcnow().isoformat() + 'Z')
    json.dump(sel, open('selection-frozen.json', 'w'), indent=1)
    json.dump(val, open(f'{OUT}/validation.json', 'w'), indent=1, default=float)
    print('FROZEN', sel['selected'], sel['selected_params'], 'validation_passed', sel['validation_passed'],
          hashlib.sha256(open('selection-frozen.json', 'rb').read()).hexdigest())
elif stage == 'oos':
    sel = json.load(open('selection-frozen.json')); res = {}
    for name, p in sel['dev_picks'].items():
        r, pf = evaluate(name, p, OOS, 'out_of_sample'); res[name] = r
        print('OOS', name, r['portfolio']['completed'], 'net$', round(r['portfolio']['net'], 2), 'win', round(r['portfolio']['win_rate'] or 0, 4), [b['completed'] for b in r['batches']])
    json.dump(res, open(f'{OUT}/oos.json', 'w'), indent=1, default=float)
