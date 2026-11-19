"""prompt-57 robustness: coin-flip baseline, emergency sensitivity, walk-forward, per-coin, regimes, loser analysis."""
import pickle, json, numpy as np, pandas as pd, engine as e, strategies as S, hybrid as HY
OUT = '/tmp/r57/out'; ms = e.ms
coins = pickle.load(open('/tmp/r57/work/coins.pkl', 'rb')); lab = e.Labeler(coins)
sel = json.load(open('selection-frozen.json')); picks = sel['dev_picks']
tup = lambda p: {k: (tuple(v) if isinstance(v, list) else v) for k, v in p.items()}
P = dict(dev=(ms('2026-08-01'), ms('2026-10-01')), validation=(ms('2026-10-01'), ms('2026-10-26')), oos=(ms('2026-10-26'), ms('2026-11-19')))
R = {}
# 1. costed coin-flip baseline (chain view, k=2)
base = {}
for per, (a, b) in P.items():
    vals = []
    for seed in range(100):
        ch = e.chain(lab, S.signals(coins, 'R', dict(rate=0.004, seed=seed)), 2.0, a, b, resolve_by=b); st = e.stats(ch)
        vals.append((st['per_trade'], st['win_rate'], st['completed']))
    v = np.array(vals); base[per] = dict(per_trade_mean=float(v[:, 0].mean()), per_trade_p95=float(np.quantile(v[:, 0], .95)),
                                          win_mean=float(v[:, 1].mean()), win_p95=float(np.quantile(v[:, 1], .95)), trades_mean=float(v[:, 2].mean()))
    print('coinflip', per, base[per], flush=True)
R['coinflip'] = base
# chain (entry-quality) per family per period
R['chain'] = {}
for n, p in picks.items():
    sg = S.signals(coins, n, tup(p))
    R['chain'][n] = {per: e.stats(e.chain(lab, sg, 2.0, a, b, resolve_by=b)) for per, (a, b) in P.items()}
# 2. emergency sensitivity, validation+oos together, portfolio
R['emergency'] = {}
for n in [sel['selected'], 'I_momentum_regime', 'H_live_obvp', 'B_ema_momentum']:
    sg = S.signals(coins, n, tup(picks[n])); R['emergency'][n] = {}
    for k in [1.0, 2.0, 3.0, None]:
        pf = e.portfolio(lab, sg, k, P['validation'][0], P['oos'][1]); st = e.stats(pf['trades'], pf['open'])
        R['emergency'][n][str(k)] = dict(stats=st, wallet=pf['wallet'], equity_end=pf['equity_end'], max_dd=pf['max_dd'],
                                         min_liq_dist=pf['min_liq_dist'], liquidation=pf['liquidation'], max_unreal_loss=pf['max_unreal_loss'])
        print('emerg', n, k, st['completed'], round(st['net'], 1), pf['liquidation'] is not None, round(pf['max_dd'], 3), flush=True)
# live-like (no emergency) on the whole window for the live indicator
pf = e.portfolio(lab, S.signals(coins, 'H_live_obvp', dict(minscore=0, tr='none')), None, P['dev'][0], P['oos'][1])
R['live_like_full'] = dict(stats=e.stats(pf['trades'], pf['open']), wallet=pf['wallet'], equity_end=pf['equity_end'], max_dd=pf['max_dd'],
                           liquidation=pf['liquidation'], min_liq_dist=pf['min_liq_dist'])
print('live-like', R['live_like_full']['liquidation'], R['live_like_full']['stats']['completed'])
# 3. walk-forward
folds = []; start = ms('2026-08-01'); D = 86_400_000
t = start + 28 * D
while t < ms('2026-11-19'):
    folds.append((t - 28 * D, t, min(t + 14 * D, ms('2026-11-19')))); t += 14 * D
WF = {}
for n in picks:
    WF[n] = []
    for a, b, c in folds:
        if n == 'G_hybrid_score':
            p_, _, _ = HY.fit(a, b); S.GP = {}
            for m_, q in zip(HY.META, p_): S.GP.setdefault(m_['sym'], []).append((m_['i5'], m_['side'], float(q)))
        best = None
        for p in S.grid(n):
            st = e.stats(e.chain(lab, S.signals(coins, n, p), 2.0, a, b, resolve_by=b))
            if st['completed'] >= 80 and (best is None or st['per_trade'] > best[1]): best = (p, st['per_trade'])
        if not best: WF[n].append(dict(test=[a, b, c], params=None)); continue
        sg = S.signals(coins, n, best[0]); pf = e.portfolio(lab, sg, 2.0, b, c); st = e.stats(pf['trades'], pf['open'])
        WF[n].append(dict(train=[int(a), int(b)], test_end=int(c), params={k: (list(v) if isinstance(v, tuple) else v) for k, v in best[0].items()},
                          completed=st['completed'], net=st['net'], win_rate=st['win_rate'], liquidated=pf['liquidation'] is not None))
    S.GP = None
    print('WF', n, [round(f.get('net') or 0) for f in WF[n]], flush=True)
R['walk_forward'] = WF
# 4/5. per coin, regimes, losers for the selected + I + H on validation+oos portfolio (k=2)
def breakdown(trs):
    df = pd.DataFrame([t for t in trs if t['kind'] in ('TP', 'EMERGENCY', 'LIQUIDATED')])
    if df.empty: return {}
    out = {}
    for key, col in [('coin', 'sym'), ('trend_regime', 'regime'), ('vol_regime', 'vol')]:
        g = df.groupby(col).agg(trades=('pnl', 'size'), net=('pnl', 'sum'), wins=('pnl', lambda x: int((x > 0).sum())),
                                tp_med_h=('mins', lambda x: float(np.median(x) / 60)), mae_max=('mae', 'max'))
        out[key] = {str(k): v for k, v in g.to_dict('index').items()}
    los = df[df.pnl <= 0]
    out['losers'] = dict(n=len(los), counter_4h=int(((los.regime * los.side) < 0).sum()), with_4h=int(((los.regime * los.side) > 0).sum()),
                         high_vol=int((los.vol == 1).sum()), mean_mins_h=float(los.mins.mean() / 60) if len(los) else None,
                         same_day_cluster=int(los.groupby(pd.to_datetime(los.exit_t, unit='ms').dt.date).size().max()) if len(los) else 0)
    w = df[df.pnl > 0]
    out['winners_mae_med'] = float(w.mae.median()) if len(w) else None
    return out
R['breakdown'] = {}; trades_out = []
for n in picks:
    sg = S.signals(coins, n, tup(picks[n]))
    for per in ['validation', 'oos']:
        pf = e.portfolio(lab, sg, 2.0, *P[per]); R['breakdown'].setdefault(n, {})[per] = breakdown(pf['trades'])
        for t in pf['trades'] + pf['open']:
            trades_out.append(dict(strategy=n, period=per, symbol=t['sym'], side='LONG' if t['side'] > 0 else 'SHORT',
                                   signal_utc=pd.Timestamp(t['sig_t'], unit='ms').isoformat(), entry_utc=pd.Timestamp(t['fill_t'], unit='ms').isoformat(),
                                   entry=round(t['entry'], 6), exit_utc=pd.Timestamp(t['exit_t'], unit='ms').isoformat() if t['kind'] != 'OPEN' else '',
                                   exit=round(t['exit'], 6) if t['kind'] != 'OPEN' else '', result=t['kind'], margin_usd=round(t['margin'], 4),
                                   pnl_usd=round(t['pnl'], 4) if t['kind'] != 'OPEN' else '', unrealized_end_usd=round(t.get('unreal_end', 0), 4) if t['kind'] == 'OPEN' else '',
                                   margin_roi_pct=round(t['pnl'] / t['margin'] * 100, 2) if t['kind'] != 'OPEN' else '', fees_pct_margin=round(t['fee_m'] * 100, 2),
                                   funding_pct_margin=round(t['fund_m'] * 100, 3), mae_pct=round(t['mae'] * 100, 3), mfe_pct=round(t['mfe'] * 100, 3),
                                   minutes=t['mins'], trend_regime={1: 'bullish', -1: 'bearish', 0: 'sideways'}[t['regime']],
                                   vol_regime={1: 'high', -1: 'low', 0: 'normal'}[t['vol']]))
pd.DataFrame(trades_out).to_csv(f'{OUT}/all-trades.csv', index=False)
json.dump(R, open(f'{OUT}/robustness.json', 'w'), indent=1, default=lambda o: float(o) if isinstance(o, (np.floating, np.integer)) else str(o))
print('done', len(trades_out))
