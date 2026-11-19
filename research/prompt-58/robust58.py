"""prompt-58 robustness: 100 random-entry seeds (same exits and exposure cap), walk-forward refits, per-coin/regime, CIs."""
import sys, json, numpy as np, pandas as pd
import study58 as ST
from study58 import e, S, PT, M, P, T, t, coins, lab
sel = json.load(open('selection-frozen.json'))['selected']; a = sel['a']; kC = PT.k_for(a); g = ST.gate_fn(sel['msd'], sel['beta'])
R = {'random': {}}
for per in ['validation', 'oos']:
    v = []
    for seed in range(100):
        sg = ST.order(S.signals(coins, 'R', dict(rate=0.01, seed=seed))); r, _ = ST.run(sg, kC, P[per], g); st = r['stats']
        v.append((st['net'], st['per_trade'] or 0, st['win_rate'] or 0, st['completed'], r['liquidation'] is not None, r['max_dd']))
    v = np.array(v, float)
    R['random'][per] = dict(net_mean=v[:, 0].mean(), net_p5=np.quantile(v[:, 0], .05), net_p95=np.quantile(v[:, 0], .95), per_trade_p95=np.quantile(v[:, 1], .95),
                            per_trade_mean=v[:, 1].mean(), win_mean=v[:, 2].mean(), trades_mean=v[:, 3].mean(), liquidated_share=v[:, 4].mean(), dd_mean=v[:, 5].mean())
    print('random', per, {k: round(float(x), 3) for k, x in R['random'][per].items()}, flush=True)
# walk-forward: refit model each fold with frozen a/q/msd/beta
D = 86_400_000; folds = []; s0 = e.ms('2026-08-01'); x = s0 + 28 * D
while x < e.ms('2026-11-19'): folds.append((x - 28 * D, x, min(x + 14 * D, e.ms('2026-11-19')))); x += 14 * D
y = T['y'][a].astype(float); WF = []
for a0, b0, c0 in folds:
    tr = (t >= a0) & (t < b0 - D); m = M.fit(T['X'][tr], y[tr], lam=10.0); p = M.predict(m, T['X'])
    thr = float(np.quantile(p[(t >= a0) & (t < b0)], sel['q'])); sg = ST.sig_C(p, thr, b0, c0)
    r, _ = ST.run(sg, kC, (b0, c0), g); te = (t >= b0) & (t < c0)
    WF.append(dict(test=[pd.Timestamp(b0, unit='ms').date().isoformat(), pd.Timestamp(c0, unit='ms').date().isoformat()], trades=r['stats']['completed'],
                   net=r['stats']['net'], win=r['stats']['win_rate'], liquidated=r['liquidation'] is not None, max_dd=r['max_dd'], test_auc=M.auc(y[te], p[te])))
    print('WF', WF[-1], flush=True)
R['walk_forward'] = WF
# per-coin / regime and per-trade CI for C oos
r, pf = ST.run(ST.sig_C(np.load(f'/tmp/r58/p_{a}.npy'), sel['thr']), kC, P['oos'], g)
df = pd.DataFrame([x for x in pf['trades'] if x['kind'] != 'OPEN']); df['roi'] = df.pnl / df.margin
R['oos_by_coin'] = df.groupby('sym').agg(trades=('pnl', 'size'), net=('pnl', 'sum'), win=('pnl', lambda z: float((z > 0).mean()))).to_dict('index')
R['oos_by_side'] = df.groupby('side').agg(trades=('pnl', 'size'), net=('pnl', 'sum'), win=('pnl', lambda z: float((z > 0).mean()))).to_dict('index')
R['oos_by_trend'] = df.groupby('regime').agg(trades=('pnl', 'size'), net=('pnl', 'sum'), win=('pnl', lambda z: float((z > 0).mean()))).to_dict('index')
R['oos_by_vol'] = df.groupby('vol').agg(trades=('pnl', 'size'), net=('pnl', 'sum'), win=('pnl', lambda z: float((z > 0).mean()))).to_dict('index')
day = df.fill_t // D; ud = day.unique(); rng = np.random.default_rng(1); bs = []
for _ in range(1000):
    pick = rng.choice(ud, len(ud)); bs.append(pd.concat([df.roi[day == d] for d in pick]).mean())
R['oos_roi_per_trade'] = dict(mean=float(df.roi.mean()), ci95=[float(np.quantile(bs, .025)), float(np.quantile(bs, .975))], trades_per_day=len(df) / 24)
print({k: R[k] for k in ['oos_by_side', 'oos_by_trend', 'oos_by_vol', 'oos_roi_per_trade']}); print('coins', {k: round(v['net'], 1) for k, v in R['oos_by_coin'].items()})
json.dump(R, open('/tmp/r58/robust.json', 'w'), indent=1, default=float)
