"""prompt-58 entry-time features and target-first labels (offline). Every feature uses only 5m bars closed at or before the
signal close (rolling windows are shifted where they include the current bar only because that bar is already closed)."""
import sys, numpy as np, pandas as pd
sys.path.insert(0, '../prompt-57'); import engine as e
MIN = e.MIN
def roll(x, L, fn): return getattr(pd.Series(x).rolling(L, min_periods=max(5, L // 3)), fn)().values
def sh(x, k=1): return np.concatenate([np.full(k, np.nan), x[:-k]])

# directional features are multiplied by side (+1 LONG, -1 SHORT) so "high" always means "good for this side"
DIRECTIONAL = ['dist_swing_against_24', 'dist_swing_against_96', 'dist_swing_with_96', 'liq_pool_against', 'funding_s', 'oi1_s', 'oi4_s',
               'taker1_s', 'taker12_s', 'btc_ret1h_s', 'mkt_ret1h_s', 'ret1h_s', 'ret4h_s', 'rsi_s', 'ema50_dist_s', 'streak_s', 'h4_trend_s', 'h1_trend_s',
               'sweep_recent_s']
NEUTRAL = ['funding_abs_z', 'oi1_abs', 'btc_atr_rank', 'atr_rank', 'vol_expansion', 'bar_range_atr', 'corr_btc', 'mkt_dispersion',
           'false_breakout_rate', 'stop_hunt_rate', 'structure_flip', 'hour_sin', 'hour_cos']
NAMES = DIRECTIONAL + NEUTRAL

def raw(c, btc, mkt_ret1h, mkt_disp):
    b, f = c.b, c.f; h, l, cl, v = b['h'], b['l'], b['c'], b['v']; a = f['atr']
    R = {}
    for L in (24, 96):
        hi, lo = roll(h, L, 'max'), roll(l, L, 'min')
        R[f'up{L}'] = (hi - cl) / a; R[f'dn{L}'] = (cl - lo) / a   # room to swing high / low in ATR
    # liquidity concentration: share of last 288 bar lows (highs) within 0.3% below (above) price = resting stops
    lowsN = np.zeros(len(cl)); highsN = np.zeros(len(cl))
    L = 288
    for i in range(L, len(cl)):
        w_l = l[i - L + 1:i + 1]; w_h = h[i - L + 1:i + 1]; p = cl[i]
        lowsN[i] = np.mean((w_l < p) & (w_l > p * 0.997)); highsN[i] = np.mean((w_h > p) & (w_h < p * 1.003))
    R['lowsN'], R['highsN'] = lowsN, highsN
    fr = f['funding']; frz = (fr - roll(fr, 2016, 'mean')) / np.maximum(roll(fr, 2016, 'std'), 1e-6)
    R['funding'] = fr * 1e4; R['funding_abs_z'] = np.abs(np.nan_to_num(frz))
    o = c.oiv; close5 = b['t'] + 5 * MIN
    def oich(m):
        i = np.searchsorted(c.oit, close5, side='right') - 1; j = np.searchsorted(c.oit, close5 - m * MIN, side='right') - 1
        ok = (i >= 0) & (j >= 0); den = o[np.clip(j, 0, None)]
        return np.where(ok & (den > 0), o[np.clip(i, 0, None)] / np.where(den > 0, den, 1) - 1, 0.0)
    R['oi1'], R['oi4'] = oich(60) * 100, oich(240) * 100
    d = f['delta']; R['taker1'] = d; R['taker12'] = roll(2 * b['tbv'] - v, 12, 'sum') / np.maximum(roll(v, 12, 'sum'), 1e-12)
    r5 = np.diff(np.log(cl), prepend=np.log(cl[0])); rb = np.diff(np.log(btc.b['c']), prepend=np.log(btc.b['c'][0]))
    R['corr_btc'] = pd.Series(r5).rolling(288, min_periods=100).corr(pd.Series(rb)).values
    R['btc_ret1h'] = (btc.b['c'] / sh(btc.b['c'], 12) - 1) * 100; R['btc_atr_rank'] = btc.f['h1_atr_rank']
    R['mkt_ret1h'] = mkt_ret1h; R['mkt_dispersion'] = mkt_disp
    R['ret1h'] = (cl / sh(cl, 12) - 1) * 100; R['ret4h'] = (cl / sh(cl, 48) - 1) * 100
    R['atr_rank'] = f['h1_atr_rank']; R['vol_expansion'] = a / roll(a, 288, 'mean'); R['bar_range_atr'] = (h - l) / a
    R['rsi'] = (f['rsi'] - 50) / 50; R['ema50_dist'] = (cl - f['ema50']) / a
    up = (cl > b['o']).astype(float) - (cl < b['o']).astype(float); st = np.zeros(len(cl))
    for i in range(1, len(cl)): st[i] = st[i - 1] + up[i] if np.sign(st[i - 1]) == up[i] else up[i]
    R['streak'] = st
    R['h4_trend'] = f['regime'].astype(float); R['h1_trend'] = np.sign(f['h1_c'] - f['h1_e50'])
    # false breakout: of the 24-bar breakouts in the last 288 bars, share that closed back inside within 3 bars
    hi24, lo24 = roll(h, 24, 'max'), roll(l, 24, 'min'); hi24, lo24 = sh(hi24), sh(lo24)
    bo_up = cl > hi24; bo_dn = cl < lo24
    fail_up = bo_up & (np.fmin(np.fmin(np.roll(cl, -1), np.roll(cl, -2)), np.roll(cl, -3)) < hi24)
    fail_dn = bo_dn & (np.fmax(np.fmax(np.roll(cl, -1), np.roll(cl, -2)), np.roll(cl, -3)) > lo24)
    # fails are only known 3 bars later -> shift by 3 before rolling (no look-ahead)
    nb = roll((bo_up | bo_dn).astype(float), 288, 'sum'); nf = sh(roll((fail_up | fail_dn).astype(float), 288, 'sum'), 3)
    R['false_breakout_rate'] = np.where(nb > 0, nf / np.maximum(nb, 1), 0.5)
    # stop-hunt: wick through 24-bar extreme then close back inside, recent 48 bars (rate) and directional count
    sw_dn = (l < lo24) & (cl > lo24); sw_up = (h > hi24) & (cl < hi24)
    R['stop_hunt_rate'] = roll((sw_dn | sw_up).astype(float), 48, 'mean')
    R['sweep_recent'] = roll(sw_dn.astype(float) - sw_up.astype(float), 12, 'sum')   # + = lows recently swept (bullish)
    R['structure_flip'] = (pd.Series(f['regime']).diff().abs().rolling(48, min_periods=1).sum().values > 0).astype(float)
    hr = (b['t'] // 3_600_000) % 24; R['hour_sin'] = np.sin(hr / 24 * 2 * np.pi); R['hour_cos'] = np.cos(hr / 24 * 2 * np.pi)
    return R

def side_feats(R, side):
    s = side; F = {}
    F['dist_swing_against_24'] = R['dn24'] if s > 0 else R['up24']   # room before the stop pool behind the trade
    F['dist_swing_against_96'] = R['dn96'] if s > 0 else R['up96']
    F['dist_swing_with_96'] = -(R['up96'] if s > 0 else R['dn96'])    # high = target-side swing is close (resistance)
    F['liq_pool_against'] = -(R['lowsN'] if s > 0 else R['highsN'])   # high = few resting stops just behind entry
    F['funding_s'] = -s * R['funding']                                # high = this side receives funding
    F['oi1_s'] = s * R['oi1']; F['oi4_s'] = s * R['oi4']
    F['taker1_s'] = s * R['taker1']; F['taker12_s'] = s * R['taker12']
    F['btc_ret1h_s'] = s * R['btc_ret1h']; F['mkt_ret1h_s'] = s * R['mkt_ret1h']; F['ret1h_s'] = s * R['ret1h']; F['ret4h_s'] = s * R['ret4h']
    F['rsi_s'] = s * R['rsi']; F['ema50_dist_s'] = s * R['ema50_dist']; F['streak_s'] = s * R['streak']
    F['h4_trend_s'] = s * R['h4_trend']; F['h1_trend_s'] = s * R['h1_trend']; F['sweep_recent_s'] = s * R['sweep_recent']
    F['funding_abs_z'] = R['funding_abs_z']; F['oi1_abs'] = np.abs(R['oi1'])
    for k in ['btc_atr_rank', 'atr_rank', 'vol_expansion', 'bar_range_atr', 'corr_btc', 'mkt_dispersion', 'false_breakout_rate', 'stop_hunt_rate', 'structure_flip', 'hour_sin', 'hour_cos']:
        F[k] = R[k]
    return np.column_stack([np.nan_to_num(np.asarray(F[n], float), nan=0.0, posinf=0.0, neginf=0.0) for n in NAMES])

def labels(c, side, thr_pct, H=1440, H4=240):
    """For every 5m bar: target-first within H minutes vs adverse threshold (mark price). Vectorised; tie -> adverse."""
    m = c.m; n5 = len(c.b['t']); n = len(m['t'])
    fi = ((c.b['t'] + 5 * MIN - m['t'][0]) // MIN).astype(int) + 1
    ok = fi + H < n
    E = np.where(ok, m['o'][np.clip(fi, 0, n - 1)], np.nan) * (1 + e.SLIP * side)
    T = np.array([e.target_trigger(x, side) for x in E]) if False else (E * (1 + e.FEE + e.R / e.LEV) / (1 - e.FEE) / (1 - e.SLIP) if side > 0 else E * (1 - e.FEE - e.R / e.LEV) / (1 + e.FEE) / (1 + e.SLIP))
    from numpy.lib.stride_tricks import sliding_window_view as sw
    px_t = sw(m['h'] if side > 0 else -m['l'], H); px_a = sw(m['ml'] if side > 0 else -m['mh'], H)
    out = {a: np.zeros(n5, np.int8) for a in thr_pct}; out4 = {a: np.zeros(n5, np.int8) for a in thr_pct}
    mins_tp = np.full(n5, -1); mae4 = np.full(n5, np.nan)
    idx = np.where(ok)[0]
    for ch in np.array_split(idx, max(1, len(idx) // 2000)):
        F_ = fi[ch]; Tt = T[ch] * side; Ee = E[ch]
        hit_t = px_t[F_] >= Tt[:, None]; ft = np.where(hit_t.any(1), hit_t.argmax(1), H + 1)
        mins_tp[ch] = np.where(ft <= H, ft + 1, -1)
        wa = px_a[F_][:, :H4]; mae4[ch] = (Ee - (wa.min(1) if side > 0 else -wa.max(1)) * (1 if side > 0 else 1)) / Ee if side > 0 else (-wa.min(1) - Ee) / Ee
        for a in thr_pct:
            A = (Ee * (1 - a / 100)) if side > 0 else -(Ee * (1 + a / 100))
            hit_a = px_a[F_] <= A[:, None]; fa = np.where(hit_a.any(1), hit_a.argmax(1), H + 1)
            out[a][ch] = (ft < fa) & (ft <= H); out4[a][ch] = (ft < fa) & (ft < H4)
    return out, out4, mins_tp, mae4, ok
