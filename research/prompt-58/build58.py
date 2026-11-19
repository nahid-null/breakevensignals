"""Build the full feature/label table (every 5m bar x 12 coins x 2 sides) -> /tmp/r58/table.pkl"""
import sys, os, pickle, time, numpy as np
sys.path.insert(0, '../prompt-57'); import engine as e, feat58 as F
os.makedirs('/tmp/r58', exist_ok=True)
coins = pickle.load(open('/tmp/r57/work/coins.pkl', 'rb')); btc = coins['BTCUSDT']
C = np.column_stack([coins[s].b['c'] for s in e.SYMS]); r1 = (C / np.vstack([np.full((12, C.shape[1]), np.nan)[:, :12].T, C[:-12]]) - 1) * 100
mkt = np.nanmean(r1, 1); disp = np.nanstd(r1, 1)
TH = [0.5, 0.75, 1.0, 1.5, 2.0]; rows = []
for s in e.SYMS:
    t = time.time(); c = coins[s]; R = F.raw(c, btc, mkt, disp)
    for side in (1, -1):
        X = F.side_feats(R, side); y, y4, mt, mae4, ok = F.labels(c, side, TH)
        keep = np.where(ok & (np.arange(len(ok)) > 300))[0]
        rows.append(dict(sym=s, side=side, i5=keep, t=c.b['t'][keep] + 5 * e.MIN, X=X[keep].astype(np.float32),
                         y={a: y[a][keep] for a in TH}, y4={a: y4[a][keep] for a in TH}, mins=mt[keep], mae4=mae4[keep]))
    print(s, round(time.time() - t, 1), flush=True)
pickle.dump(dict(rows=rows, names=F.NAMES, TH=TH), open('/tmp/r58/table.pkl', 'wb'))
