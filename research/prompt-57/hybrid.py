"""Strategy G: logistic confidence score. fit() uses only candidates signalled in [t0, t1) AND resolved before t1,
so no later outcome leaks into the score."""
import pickle, json, numpy as np, engine as e, strategies as S, features as F
P = pickle.load(open('/tmp/r57/work/pool.pkl', 'rb')); X, META = P['X'], P['meta']
FAMS = [f for f in S.FAMILIES if f != 'G_hybrid_score']
D = np.array([[1.0 if f in m['fams'] else 0.0 for f in FAMS] for m in META]); Z = np.hstack([X, D])
SIG = np.array([m['sig_t'] for m in META]); EXT = np.array([m['exit_t'] for m in META]); KIND = np.array([m['kind'] for m in META])
y = (KIND == 'TP').astype(float)
NAMES = ['bias'] + F.NAMES + ['fam_' + f for f in FAMS]
def fit(t0, t1, lam=5.0):
    d = (SIG >= t0) & (SIG < t1) & (KIND != 'OPEN') & (EXT < t1)
    mu, sd = Z[d].mean(0), Z[d].std(0) + 1e-9
    std = lambda Z_: np.hstack([np.ones((len(Z_), 1)), (Z_ - mu) / sd])
    A, yy = std(Z[d]), y[d]; w = np.zeros(A.shape[1])
    for _ in range(30):
        p = 1 / (1 + np.exp(-A @ w)); g = A.T @ (p - yy) + lam * np.r_[0, w[1:]]
        H = (A * (p * (1 - p))[:, None]).T @ A + lam * np.diag(np.r_[0, np.ones(len(w) - 1)])
        w -= np.linalg.solve(H, g)
    return 1 / (1 + np.exp(-std(Z) @ w)), w, int(d.sum())
if __name__ == '__main__':
    p, w, n = fit(e.ms('2026-08-01'), e.ms('2026-10-01'))
    print('fitted on', n, 'resolved development candidates')
    for nm, c in sorted(zip(NAMES, w), key=lambda x: -abs(x[1]))[:12]: print(f'  {nm:22s} {c:+.3f}')
    json.dump(dict(weights=dict(zip(NAMES, w.tolist())), n=n), open('/tmp/r57/work/hybrid_model.json', 'w'), indent=1)
    np.save('/tmp/r57/work/hybrid_p.npy', p)
