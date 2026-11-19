"""prompt-58 target-first probability model: L2 logistic (IRLS), fitted on development rows only; metrics on later periods."""
import numpy as np, pickle, json, sys
sys.path.insert(0, '../prompt-57'); import engine as e
from scipy.stats import rankdata
P = dict(dev=(e.ms('2026-08-01'), e.ms('2026-10-01')), validation=(e.ms('2026-10-01'), e.ms('2026-10-26')), oos=(e.ms('2026-10-26'), e.ms('2026-11-19')))
def load():
    D = pickle.load(open('/tmp/r58/table.pkl', 'rb')); r = D['rows']
    cat = lambda k: np.concatenate([x[k] for x in r])
    T = dict(sym=np.concatenate([[x['sym']] * len(x['i5']) for x in r]), side=np.concatenate([np.full(len(x['i5']), x['side']) for x in r]),
             i5=cat('i5'), t=cat('t'), X=cat('X').astype(float), mins=cat('mins'), mae4=cat('mae4'))
    T['y'] = {a: np.concatenate([x['y'][a] for x in r]) for a in D['TH']}; T['y4'] = {a: np.concatenate([x['y4'][a] for x in r]) for a in D['TH']}
    return T, D['names'], D['TH']
def auc(y, s):
    y = np.asarray(y).astype(bool); n1, n0 = y.sum(), (~y).sum()
    if n1 == 0 or n0 == 0: return np.nan
    r = rankdata(s); return float((r[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))
def auc_ci(y, s, day, B=60, seed=0):
    """day-block bootstrap 95% CI (keeps intraday dependence)."""
    rng = np.random.default_rng(seed); ud = np.unique(day); idx = {d: np.where(day == d)[0] for d in ud}; v = []
    for _ in range(B):
        pick = np.concatenate([idx[d] for d in rng.choice(ud, len(ud))]); v.append(auc(y[pick], s[pick]))
    return [float(np.nanquantile(v, .025)), float(np.nanquantile(v, .975))]
def fit(X, y, lam=1.0, it=25):
    mu, sd = X.mean(0), X.std(0) + 1e-9; Z = np.column_stack([np.ones(len(X)), (X - mu) / sd]); w = np.zeros(Z.shape[1])
    for _ in range(it):
        p = 1 / (1 + np.exp(-Z @ w)); g = Z.T @ (p - y) + lam * np.r_[0, w[1:]]
        Hs = (Z * (p * (1 - p))[:, None]).T @ Z + lam * np.diag(np.r_[0, np.ones(len(w) - 1)])
        step = np.linalg.solve(Hs, g); w -= step
        if np.abs(step).max() < 1e-7: break
    return dict(mu=mu, sd=sd, w=w)
def predict(m, X): return 1 / (1 + np.exp(-(np.column_stack([np.ones(len(X)), (X - m['mu']) / m['sd']]) @ m['w'])))
def calib(y, p, bins=10):
    q = np.quantile(p, np.linspace(0, 1, bins + 1)); b = np.clip(np.searchsorted(q, p, side='right') - 1, 0, bins - 1)
    return [dict(p_mean=float(p[b == k].mean()), hit=float(y[b == k].mean()), n=int((b == k).sum())) for k in range(bins) if (b == k).any()]
def metrics(y, p, day):
    eps = 1e-9; base = y.mean()
    return dict(n=int(len(y)), base_rate=float(base), auc=auc(y, p), auc_ci95=auc_ci(y, p, day), brier=float(np.mean((p - y) ** 2)),
                brier_base=float(np.mean((base - y) ** 2)), logloss=float(-np.mean(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps))),
                top1pct_hit=float(y[p >= np.quantile(p, .99)].mean()), top5pct_hit=float(y[p >= np.quantile(p, .95)].mean()), reliability=calib(y, p))
