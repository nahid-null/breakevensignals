"""prompt-58 staged study. select: dev+validation grid for approach C, freeze. oos: evaluate A, B, C once on unseen data.
robust: random baseline (100 seeds), exit sensitivity, walk-forward, per-coin/regime, CSV."""
import sys, json, pickle, hashlib, numpy as np, pandas as pd, itertools, datetime
sys.path.insert(0, '../prompt-57'); import engine as e, strategies as S, port58 as PT, model58 as M
OUT = '/tmp/r58'; coins = pickle.load(open('/tmp/r57/work/coins.pkl', 'rb')); lab = e.Labeler(coins)
T, names, TH = M.load(); t = T['t']; P = M.P; JC = names.index('corr_btc')
CORR = {(s, i): c for s, i, c in zip(T['sym'], T['i5'], T['X'][:, JC])}
sel57 = json.load(open('../prompt-57/selection-frozen.json'))['dev_picks']
tup = lambda p: {k: (tuple(v) if isinstance(v, list) else v) for k, v in p.items()}
SIG_A = S.signals(coins, 'C_vwap_volume', tup(sel57['C_vwap_volume'])); SIG_B = S.signals(coins, 'I_momentum_regime', tup(sel57['I_momentum_regime']))
def order(sigs): return sorted(sigs, key=lambda x: (coins[x[0]].b['t'][x[1]], x[0]))
def gate_fn(msd, beta):
    def g(openp, r):
        same = sum(1 for p in openp if p['side'] == r['side'])
        if same >= msd: return False
        if beta != 'none':
            hi = sum(1 for p in openp if p['side'] == r['side'] and CORR.get((p['sym'], p['i5']), 0) > 0.6)
            if CORR.get((r['sym'], r['i5']), 0) > 0.6 and hi >= beta: return False
        return True
    return g
def sig_C(p, thr, lo=None, hi=None):
    m = p >= thr
    if lo is not None: m &= (t >= lo) & (t < hi)
    ix = np.where(m)[0]; ix = ix[np.lexsort((-p[ix], t[ix]))]
    return [(T['sym'][i], int(T['i5'][i]), int(T['side'][i])) for i in ix]
def run(sigs, k, per, gate=None):
    pf = PT.portfolio(lab, sigs, k, *per, gate=gate); st = e.stats(pf['trades'], pf['open'])
    tr = [x for x in pf['trades'] if x['kind'] != 'OPEN']
    # exposure: max concurrent notional / wallet0 and max same-direction count
    ev = sorted([(x['fill_t'], 1, x) for x in pf['trades'] + pf['open']] + [(x['exit_t'], -1, x) for x in tr], key=lambda z: (z[0], z[1]))
    cur = []; mx_n = 0; mx_dir = 0
    for _, d, x in ev:
        if d > 0: cur.append(x)
        elif x in cur: cur.remove(x)
        mx_n = max(mx_n, sum(y['notional'] for y in cur)); mx_dir = max(mx_dir, max(sum(y['side'] > 0 for y in cur), sum(y['side'] < 0 for y in cur)))
    return dict(stats=st, wallet_end=pf['wallet'], equity_end=pf['equity_end'], max_dd=pf['max_dd'], min_liq_dist=pf['min_liq_dist'],
                worst_simultaneous_unrealized=pf['max_unreal_loss'], liquidation=pf['liquidation'], skipped=pf['skipped'], open_end=len(pf['open']),
                max_notional_x_wallet=mx_n / 1000, max_same_direction=mx_dir), pf
GRID = dict(a=TH, q=[0.99, 0.995, 0.999], msd=[1, 2, 3, 6], beta=['none', 3])
stage = sys.argv[1]
if stage == 'select':
    res = []
    for a, q, msd, beta in itertools.product(*GRID.values()):
        p = np.load(f'{OUT}/p_{a}.npy'); dev = (t >= P['dev'][0]) & (t < P['dev'][1]); thr = float(np.quantile(p[dev], q))
        sg = sig_C(p, thr); k = PT.k_for(a); g = gate_fn(msd, beta)
        d, _ = run(sg, k, P['dev'], g); v, _ = run(sg, k, P['validation'], g)
        res.append(dict(a=a, q=q, msd=msd, beta=beta, thr=thr, dev=d, val=v))
        print(a, q, msd, beta, 'dev', d['stats']['completed'], round(d['stats']['net'], 1), 'val', v['stats']['completed'], round(v['stats']['net'], 1), 'liq', v['liquidation'] is not None, flush=True)
    ok = [r for r in res if r['dev']['stats']['completed'] >= 40]
    best = max(ok, key=lambda r: r['val']['stats']['net'])
    sel = dict(selected={k: best[k] for k in ['a', 'q', 'msd', 'beta', 'thr']}, validation_net=best['val']['stats']['net'], dev_net=best['dev']['stats']['net'],
               validation_passed=bool(best['val']['stats']['net'] > 0 and best['val']['liquidation'] is None), configs_tested=len(res),
               frozen_utc=datetime.datetime.utcnow().isoformat() + 'Z')
    json.dump(sel, open('selection-frozen.json', 'w'), indent=1, default=float); json.dump(res, open(f'{OUT}/select.json', 'w'), default=float)
    print('FROZEN', sel, hashlib.sha256(open('selection-frozen.json', 'rb').read()).hexdigest())
elif stage == 'oos':
    sel = json.load(open('selection-frozen.json'))['selected']; a = sel['a']; p = np.load(f'{OUT}/p_{a}.npy')
    sgC = sig_C(p, sel['thr']); gC = gate_fn(sel['msd'], sel['beta']); kC = PT.k_for(a)
    R = {}; trades = []
    for name, sg, g in [('A_vwap_volume', order(SIG_A), None), ('B_momentum_calm', order(SIG_B), None), ('C_adverse_model', sgC, gC)]:
        R[name] = {}
        for kl, k in [('own_exit_a', kC), ('k2_margin', 2.0), ('no_emergency', None)]:
            for per in ['dev', 'validation', 'oos']:
                r, pf = run(sg, k, P[per], g); R[name].setdefault(kl, {})[per] = r
                print(name, kl, per, r['stats']['completed'], 'net', round(r['stats']['net'], 1), 'win', round(r['stats']['win_rate'] or 0, 3), 'dd', round(r['max_dd'], 3), 'liq', r['liquidation'] is not None, flush=True)
                if kl == 'own_exit_a' and per != 'dev':
                    for x in pf['trades'] + pf['open']:
                        trades.append(dict(approach=name, period=per, exit_rule=f'emergency at ~{a}% adverse', symbol=x['sym'], side='LONG' if x['side'] > 0 else 'SHORT',
                            signal_utc=pd.Timestamp(x['sig_t'], unit='ms').isoformat(), entry_utc=pd.Timestamp(x['fill_t'], unit='ms').isoformat(), entry=round(x['entry'], 6),
                            exit_utc=pd.Timestamp(x['exit_t'], unit='ms').isoformat() if x['kind'] != 'OPEN' else '', exit=round(x['exit'], 6) if x['kind'] != 'OPEN' else '',
                            result=x['kind'], margin_usd=round(x['margin'], 4), pnl_usd=round(x['pnl'], 4) if x['kind'] != 'OPEN' else '',
                            margin_roi_pct=round(x['pnl'] / x['margin'] * 100, 2) if x['kind'] != 'OPEN' else '', mae_pct=round(x['mae'] * 100, 3), minutes=x['mins'],
                            trend_regime={1: 'bullish', -1: 'bearish', 0: 'sideways'}[x['regime']], vol_regime={1: 'high', -1: 'low', 0: 'normal'}[x['vol']]))
    pd.DataFrame(trades).to_csv(f'{OUT}/all-trades.csv', index=False); json.dump(R, open(f'{OUT}/oos.json', 'w'), indent=1, default=str)
