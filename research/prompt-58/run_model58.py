"""Stage 1: univariate feature tests (each feature alone) + multivariate model per threshold. Fit on dev only."""
import numpy as np, json, pickle, model58 as M
T, names, TH = M.load(); t = T['t']; day = t // 86_400_000
per = {k: (t >= a) & (t < b) for k, (a, b) in M.P.items()}
# dev rows must also be RESOLVED before the dev cutoff (label horizon 24 h) -> drop last 24 h of dev to avoid leakage
dev_fit = per['dev'] & (t < M.P['dev'][1] - 86_400_000)
out = dict(univariate={}, models={}, adverse={})
for a in TH:
    y = T['y'][a].astype(float)
    u = {}
    for j, n in enumerate(names):
        u[n] = {k: M.auc(y[m], T['X'][m, j]) for k, m in per.items()}
    out['univariate'][str(a)] = u
    m = M.fit(T['X'][dev_fit], y[dev_fit], lam=10.0); p = M.predict(m, T['X'])
    out['models'][str(a)] = dict(coef=dict(zip(['intercept'] + names, m['w'].tolist())),
                                 **{k: M.metrics(y[mm], p[mm], day[mm]) for k, mm in per.items()})
    # 4h variant
    y4 = T['y4'][a].astype(float); m4 = M.fit(T['X'][dev_fit], y4[dev_fit], lam=10.0); p4 = M.predict(m4, T['X'])
    out['models'][str(a)]['within_4h'] = {k: M.metrics(y4[mm], p4[mm], day[mm]) for k, mm in per.items()}
    # adverse-movement prediction: P(adverse >= a within 4 h), regardless of target
    ya = (T['mae4'] >= a / 100).astype(float); ma = M.fit(T['X'][dev_fit], ya[dev_fit], lam=10.0); pa = M.predict(ma, T['X'])
    out['adverse'][str(a)] = {k: M.metrics(ya[mm], pa[mm], day[mm]) for k, mm in per.items()}
    pickle.dump(dict(m=m, m4=m4, ma=ma), open(f'/tmp/r58/model_{a}.pkl', 'wb')); np.save(f'/tmp/r58/p_{a}.npy', p)
    r = out['models'][str(a)]
    print(a, 'AUC dev/val/oos', [round(r[k]['auc'], 3) for k in per], 'oosCI', np.round(r['oos']['auc_ci95'], 3), 'top1% hit oos', round(r['oos']['top1pct_hit'], 3), 'base', round(r['oos']['base_rate'], 3),
          '| adverse AUC oos', round(out['adverse'][str(a)]['oos']['auc'], 3), flush=True)
json.dump(out, open('/tmp/r58/model_results.json', 'w'), indent=1, default=float)
# stable univariate features: same direction dev & oos, |auc-0.5|>0.02 both
u = out['univariate']['1.0']; print('univariate a=1.0 (dev, val, oos):')
for n in names: print(f'  {n:24s}', [round(u[n][k], 3) for k in ['dev', 'validation', 'oos']])
