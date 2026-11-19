"""Side-adjusted entry features for the hybrid confidence score (all from closed bars at the signal close)."""
import numpy as np
NAMES = ['h4_trend', 'h1_trend', 'm15_trend', 'h1_rsi_s', 'rsi_s', 'atr_rank', 'volz', 'delta_s', 'oi_chg', 'funding_s',
         'vwap_dist_s', 'ema50_dist_s', 'ret24_s', 'ret72_s', 'ret4h_s', 'h4_ext_s', 'hour_sin', 'hour_cos']
def feats(c, i, side):
    f, b = c.f, c.b; cl = b['c'][i]; a = f['atr'][i]
    r = lambda k: (cl / b['c'][i - k] - 1) * side if i - k >= 0 else 0.0
    hr = (b['t'][i] // 3_600_000) % 24
    return [side * f['regime'][i], side * np.sign(f['h1_c'][i] - f['h1_e50'][i]), side * np.sign(f['m15_c'][i] - f['m15_e50'][i]),
            side * (f['h1_rsi'][i] - 50) / 50, side * (f['rsi'][i] - 50) / 50, f['h1_atr_rank'][i], min(f['volz'][i], 10),
            side * f['delta'][i], float(np.clip(f['oi_chg'][i], -0.5, 0.5)) if np.isfinite(f['oi_chg'][i]) else 0.0, side * f['funding'][i] * 1e4,
            side * (cl - f['vwap'][i]) / a, side * (cl - f['ema50'][i]) / a, r(288) * 100, r(864) * 100, r(48) * 100,
            side * (f['h4_c'][i] - f['h4_e50'][i]) / f['h4_c'][i] * 100, np.sin(hr / 24 * 2 * np.pi), np.cos(hr / 24 * 2 * np.pi)]
