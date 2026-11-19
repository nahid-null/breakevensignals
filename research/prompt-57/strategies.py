"""prompt-57 candidate entry families (research only). Every rule reads only closed 5m bars and HTF bars closed at
or before the 5m close. Returns list of (symbol, i5, side)."""
import itertools, json, numpy as np, pandas as pd

def sh(x, k=1): return np.concatenate([np.full(k, np.nan), x[:-k]])
def rmin(x, L): return pd.Series(x).rolling(L).min().shift(1).values
def rmax(x, L): return pd.Series(x).rolling(L).max().shift(1).values

def _emit(sym, longm, shortm):
    longm = np.asarray(longm, dtype=bool); shortm = np.asarray(shortm, dtype=bool)
    out = [(sym, int(i), 1) for i in np.where(longm)[0] if i > 300]
    out += [(sym, int(i), -1) for i in np.where(shortm)[0] if i > 300]
    return out

def trend(f, which, side):
    n = len(f['rsi'])
    if which == 'none': return np.ones(n, bool)
    if which == 'h1': return (f['h1_c'] > f['h1_e50']) if side > 0 else (f['h1_c'] < f['h1_e50'])
    if which == 'h4': return (f['regime'] == 1) if side > 0 else (f['regime'] == -1)
    if which == 'counter_ok': return (f['regime'] != -1) if side > 0 else (f['regime'] != 1)
    raise ValueError(which)

def A_sweep(c, L, vz, tr):
    b, f = c.b, c.f
    lo, hi = rmin(b['l'], L), rmax(b['h'], L); rng = np.maximum(b['h'] - b['l'], 1e-12)
    L_ = (b['l'] < lo) & (b['c'] > lo) & ((b['c'] - b['l']) / rng > 0.5) & (f['volz'] >= vz) & trend(f, tr, 1)
    S_ = (b['h'] > hi) & (b['c'] < hi) & ((b['h'] - b['c']) / rng > 0.5) & (f['volz'] >= vz) & trend(f, tr, -1)
    return _emit(c.sym, L_, S_)

def B_ema(c, htf, lvl, m15):
    b, f = c.b, c.f; r = f['rsi']
    if htf == 'h1':
        up = (f['h1_c'] > f['h1_e50']) & (f['h1_e50'] > f['h1_e200']); dn = (f['h1_c'] < f['h1_e50']) & (f['h1_e50'] < f['h1_e200'])
    else:
        up = (f['regime'] == 1) & (f['h1_c'] > f['h1_e50']); dn = (f['regime'] == -1) & (f['h1_c'] < f['h1_e50'])
    if m15: up = up & (f['m15_c'] > f['m15_e50']); dn = dn & (f['m15_c'] < f['m15_e50'])
    L_ = up & (b['l'] <= f['ema20']) & (b['c'] > f['ema20']) & (sh(r) < lvl) & (r >= lvl) & (f['hist'] > 0)
    S_ = dn & (b['h'] >= f['ema20']) & (b['c'] < f['ema20']) & (sh(r) > 100 - lvl) & (r <= 100 - lvl) & (f['hist'] < 0)
    return _emit(c.sym, L_, S_)

def C_vwap(c, vz, tr, dl):
    b, f = c.b, c.f; vw = f['vwap']
    L_ = (sh(b['c']) < sh(vw)) & (b['c'] > vw) & (f['volz'] >= vz) & (f['delta'] > dl) & trend(f, tr, 1)
    S_ = (sh(b['c']) > sh(vw)) & (b['c'] < vw) & (f['volz'] >= vz) & (f['delta'] < -dl) & trend(f, tr, -1)
    return _emit(c.sym, L_, S_)

def D_rsi(c, os_, band, tr):
    b, f = c.b, c.f; r = f['rsi']; h = f['hist']; ar = f['h1_atr_rank']
    inb = (ar >= band[0]) & (ar <= band[1])
    mn = np.fmin(np.fmin(sh(r, 1), sh(r, 2)), sh(r, 3)); mx = np.fmax(np.fmax(sh(r, 1), sh(r, 2)), sh(r, 3))
    L_ = (mn < os_) & (r > os_) & (h > sh(h)) & inb & trend(f, tr, 1)
    S_ = (mx > 100 - os_) & (r < 100 - os_) & (h < sh(h)) & inb & trend(f, tr, -1)
    return _emit(c.sym, L_, S_)

def E_mtf(c, pa, strict):
    b, f = c.b, c.f; o, cl = b['o'], b['c']
    up = (f['regime'] == 1) & (f['h1_c'] > f['h1_e50']) & (f['m15_c'] > f['m15_e20'])
    dn = (f['regime'] == -1) & (f['h1_c'] < f['h1_e50']) & (f['m15_c'] < f['m15_e20'])
    if strict: up = up & (f['h1_rsi'] > 50) & (f['h1_rsi'] < 70); dn = dn & (f['h1_rsi'] < 50) & (f['h1_rsi'] > 30)
    if pa == 'engulf':
        bl = (cl > o) & (sh(cl) < sh(o)) & (cl > sh(o)) & (o <= sh(cl)); br = (cl < o) & (sh(cl) > sh(o)) & (cl < sh(o)) & (o >= sh(cl))
    else:
        bl = (sh(b['l']) < sh(f['ema20'])) & (cl > f['ema9']) & (cl > o); br = (sh(b['h']) > sh(f['ema20'])) & (cl < f['ema9']) & (cl < o)
    return _emit(c.sym, up & bl & (cl > f['ema20']), dn & br & (cl < f['ema20']))

def F_fvg(c, g, tr, wait):
    b, f = c.b, c.f; h, l, cl, a = b['h'], b['l'], b['c'], f['atr']; n = len(cl)
    L_ = np.zeros(n, bool); S_ = np.zeros(n, bool)
    bull = np.where((l > sh(h, 2)) & ((l - sh(h, 2)) >= g * a))[0]
    bear = np.where((h < sh(l, 2)) & ((sh(l, 2) - h) >= g * a))[0]
    for j in bull:
        top, bot = l[j], h[j - 2]
        for i in range(j + 1, min(n, j + 1 + wait)):
            if cl[i] < bot: break
            if l[i] <= top and cl[i] > bot and cl[i] > b['o'][i]: L_[i] = True; break
    for j in bear:
        bot, top = h[j], l[j - 2]
        for i in range(j + 1, min(n, j + 1 + wait)):
            if cl[i] > top: break
            if h[i] >= bot and cl[i] < top and cl[i] < b['o'][i]: S_[i] = True; break
    return _emit(c.sym, L_ & trend(f, tr, 1), S_ & trend(f, tr, -1))

OBVP = None
def H_obvp(c, minscore, tr):
    """Live OB+VP indicator signals (spot 5m, unchanged port) mapped to the same futures 5m bar."""
    global OBVP
    if OBVP is None: OBVP = json.load(open('/tmp/r57/work/obvp_signals.json'))
    t5 = c.b['t']; out = []; tl, ts = trend(c.f, tr, 1), trend(c.f, tr, -1)
    for x in OBVP:
        if x['symbol'] != c.sym or x['score'] < minscore: continue
        i = int(np.searchsorted(t5, x['time']))
        if i < len(t5) and t5[i] == x['time'] and i > 300:
            sd = 1 if x['direction'] == 'LONG' else -1
            if (tl if sd > 0 else ts)[i]: out.append((c.sym, i, sd))
    return out

def R_random(c, rate, seed):
    rng = np.random.default_rng(seed + hash(c.sym) % 1000); n = len(c.b['t'])
    m = rng.random(n) < rate; side = rng.random(n) < 0.5
    return _emit(c.sym, m & side, m & ~side)

def I_momentum(c, X, Y, fund):
    """Evidence-driven (development bins only): trade WITH the 3-day move on a 5m RSI re-cross of 50, in calm-to-normal
    1h volatility; optional: side must not be the one receiving funding (crowd-paying side won more often in dev)."""
    b, f = c.b, c.f; cl = b['c']; r = f['rsi']
    ret72 = (cl / sh(cl, 864) - 1) * 100; calm = f['h1_atr_rank'] <= Y
    L_ = (ret72 >= X) & calm & (sh(r) < 50) & (r >= 50)
    S_ = (ret72 <= -X) & calm & (sh(r) > 50) & (r <= 50)
    if fund: L_ = L_ & (f['funding'] >= 0); S_ = S_ & (f['funding'] <= 0)
    return _emit(c.sym, L_, S_)

GP = None
def G_hybrid(c, thr):
    """Hybrid confidence score: logistic model fitted on development candidates only (hybrid.py)."""
    global GP
    if GP is None:
        import pickle
        P = pickle.load(open('/tmp/r57/work/pool.pkl', 'rb')); p = np.load('/tmp/r57/work/hybrid_p.npy')
        GP = {}
        for m, q in zip(P['meta'], p): GP.setdefault(m['sym'], []).append((m['i5'], m['side'], float(q)))
    return [(c.sym, i, sd) for i, sd, q in GP.get(c.sym, []) if q >= thr]

FAMILIES = {
    'A_sweep': (A_sweep, dict(L=[24, 48, 96], vz=[1.0, 1.5, 2.5], tr=['none', 'h1', 'counter_ok'])),
    'B_ema_momentum': (B_ema, dict(htf=['h1', 'h4'], lvl=[50, 55], m15=[False, True])),
    'C_vwap_volume': (C_vwap, dict(vz=[1.5, 2.0, 3.0], tr=['none', 'h1', 'h4'], dl=[0.1, 0.3])),
    'D_rsi_macd_vol': (D_rsi, dict(os_=[25, 30], band=[(0.0, 1.0), (0.2, 0.8), (0.0, 0.7)], tr=['none', 'counter_ok', 'h1'])),
    'E_mtf_price_action': (E_mtf, dict(pa=['engulf', 'pullback'], strict=[False, True])),
    'F_fvg_orderflow': (F_fvg, dict(g=[0.3, 0.6, 1.0], tr=['none', 'h1', 'h4'], wait=[6, 18])),
    'I_momentum_regime': (I_momentum, dict(X=[2, 4, 6], Y=[0.5, 0.8, 1.0], fund=[False, True])),
    'G_hybrid_score': (G_hybrid, dict(thr=[0.86, 0.87, 0.88, 0.89, 0.90])),
    'H_live_obvp': (H_obvp, dict(minscore=[0, 3, 4, 5], tr=['none', 'h1', 'h4'])),
}

def grid(name):
    fn, ps = FAMILIES[name]; keys = list(ps)
    for vals in itertools.product(*[ps[k] for k in keys]): yield dict(zip(keys, vals))

def signals(coins, name, params):
    fn = FAMILIES[name][0] if name in FAMILIES else R_random; out = []
    for c in coins.values(): out += fn(c, **params)
    return out
