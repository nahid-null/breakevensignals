"""prompt-68 Smart Signal Filter — offline 7-day historical backtest. Research only: never imported by the website,
worker, SQL or Telegram; no live trades, no orders. Original OB STRONG signals come unchanged from ob68.run (byte-identical
signal logic to research/prompt-61/ob61.py, asserted below). Decisions use only bars closed at decision time.
usage: python filter68.py RAW_DIR OUT_DIR START_BALANCE"""
import json, sys, hashlib, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent)); sys.path.insert(0, str(Path(__file__).parent.parent/'prompt-61'))
import ob68, ob61, ind68 as I

RAW = Path(sys.argv[1]); OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True); BAL0 = float(sys.argv[3])
META = json.loads((RAW/'hashes.json').read_text()); START, END = META['start'], META['end']
TICK = json.loads((RAW/'ticks.json').read_text()); FUND = json.loads((RAW/'funding.json').read_text())
SYMS = ['ETHUSDT','SOLUSDT','XRPUSDT','LINKUSDT','NEARUSDT','BCHUSDT','LTCUSDT','ADAUSDT','AVAXUSDT']
M5, M1 = 300000, 60000
# ---- fixed rules (frozen before the run; never changed during the test) ----
TARGET = 0.007            # +0.70% favourable move = SUCCESS
TOUCH_TOL = 0.001         # G: an obstacle inside the last 0.10% before the target does not block a touch target
PREF_SPACE = 0.0085       # preferred clear space; required for conditional (70-79) candidates
MAX_DEV = 0.0015          # Filter H: max entry deviation from the indicator entry
STRONG, COND = 80, 70     # score bands
HORIZON = 24*60*M1        # rejected-signal tracking horizon
SLOTS, SHARE, LEV, FEE, MMR = 7, 0.05, 75, 0.0005, 0.005   # live Simulator sizing/fee (simulate_engine_candle OBSTRONG5_SPOT)

def build(sym):
    raw = (RAW/f'{sym}.json').read_bytes(); assert hashlib.sha256(raw).hexdigest() == META['files'][sym], sym
    d = json.loads(raw); k5 = d['spot5']
    t5 = [int(k[0]) for k in k5]; O, H, L, C, V = ([float(k[j]) for k in k5] for j in (1, 2, 3, 4, 5))
    missing5 = [t for t in range(t5[0], END, M5) if t not in set(t5)]
    snap = []; ev = ob68.run(O, H, L, C, V, snap=snap); assert ev == ob61.run(O, H, L, C, V), 'signal logic drift'
    one = {int(k[0]): tuple(float(x) for x in k[1:6]) for k in d['spot1']}
    missing1 = [t for t in range(START, END, M1) if t not in one]
    rsi = I.rsi(C); adx, pdi, mdi, atr = I.adx(H, L, C); vma = I.sma(V, 20)
    ph3, pl3 = I.pivots(H, L, 3); ph5, pl5 = I.pivots(H, L, 5)
    # 15m bars from completed 5m bars (aligned to 15m boundaries)
    g = {}
    for i, t in enumerate(t5): g.setdefault(t//900000, []).append(i)
    q15 = [(k*900000 + 900000, C[ix[-1]]) for k, ix in sorted(g.items()) if len(ix) == 3]
    e20 = I.ema([c for _, c in q15], 20); e50 = I.ema([c for _, c in q15], 50)
    fund = {int(f['fundingTime']): float(f['fundingRate']) for f in FUND[sym]}
    return dict(t5=t5, O=O, H=H, L=L, C=C, V=V, snap=snap, ev=ev, one=one, rsi=rsi, adx=adx, pdi=pdi, mdi=mdi, atr=atr, vma=vma,
                ph3=ph3, pl3=pl3, ph5=ph5, pl5=pl5, q15=q15, e20=e20, e50=e50, fund=fund, missing5=missing5, missing1=missing1)

def known(piv, i):   return [p for p in piv if p[0] <= i]

def evaluate(D, ev, i, path):
    """Score the original signal using only bars <= i (i = last closed 5m bar at decision time). path: CONTINUATION|BREAKOUT."""
    O, H, L, C, V, A = D['O'], D['H'], D['L'], D['C'], D['V'], D['atr']; j = ev['retest_bar']; s = 1 if ev['side'] == 'LONG' else -1
    T = D['t5'][i] + M5; ex = D['one'].get(T); orig = ev['entry']
    if ex is None or A[i] is None: return dict(ok=False, mandatory_fail=['market data unavailable'], score=0)
    entry = ex[0]; atr = A[i]; f = {}; why_fail = []; passed = []; failed = []
    # ---- A: 5m structure (25) ----
    hs = known(D['ph3'], i)[-2:]; ls = known(D['pl3'], i)[-2:]
    hh = len(hs) == 2 and hs[1][2] > hs[0][2]; hl = len(ls) == 2 and ls[1][2] > ls[0][2]
    lh = len(hs) == 2 and hs[1][2] < hs[0][2]; ll = len(ls) == 2 and ls[1][2] < ls[0][2]
    prog = (hh + hl) if s > 0 else (lh + ll); against = (lh and ll) if s > 0 else (hh and hl)
    bos = False
    for k in range(max(i-5, 1), i+1):
        ref = known(D['ph3'] if s > 0 else D['pl3'], k-1)
        if ref and (C[k] > ref[-1][2] if s > 0 else C[k] < ref[-1][2]): bos = True
    zone_edge = ev['ob_top'] if s > 0 else ev['ob_bottom']
    near = abs(C[i] - zone_edge) <= 1.0*atr
    a_pts = 5*prog + (10 if bos else 0) + (5 if near else 0)
    conflict = against and not bos
    f['A'] = dict(points=a_pts, max=25, swing_progress=int(prog), opposite_structure=bool(against), break_of_structure_6bars=bos, near_support_resistance=near)
    # ---- B: breakout / continuation (25) ----
    if path == 'CONTINUATION':
        imp = s*(C[i] - C[i-6])/atr; ext = max(H[i-6:i+1]) if s > 0 else min(L[i-6:i+1]); near_ext = abs(ext - C[i]) <= 0.5*atr
        back3 = s*(C[i] - C[i-3])/atr
        b_pts = (12 if imp >= 1.5 else 6 if imp >= 0.8 else 0) + (8 if near_ext else 0) + (5 if back3 >= 0 else 0)
        primary = imp >= 1.5 and near_ext and back3 >= 0
        f['B'] = dict(points=b_pts, max=25, path=path, impulse_6bars_atr=round(imp, 2), close_near_6bar_extreme=near_ext, last3_move_atr=round(back3, 2), confirmed=primary,
                      confirmation='strong continuation' if primary else 'no strong continuation')
    else:
        k = j + 1; rng = H[k] - L[k]; beyond = C[k] > H[j] if s > 0 else C[k] < L[j]
        body = abs(C[k]-O[k])/rng if rng else 0; dirc = (C[k] > O[k]) if s > 0 else (C[k] < O[k])
        outer = ((C[k]-L[k])/rng >= 0.7 if s > 0 else (H[k]-C[k])/rng >= 0.7) if rng else False
        primary = beyond and dirc and body >= 0.4
        b_pts = (15 if beyond else 0) + (5 if dirc and body >= 0.4 else 0) + (5 if outer else 0)
        f['B'] = dict(points=b_pts, max=25, path=path, closed_beyond_signal_extreme=beyond, body_pct=round(body*100), outer_30pct_close=outer, confirmed=primary,
                      confirmation=('close beyond signal ' + ('high' if s > 0 else 'low')) if primary else ('wick only / no close beyond' if not beyond else 'weak breakout candle'))
    # ---- C: 15m EMA20/50 (10) ----
    k15 = max((n for n, (te, _) in enumerate(D['q15']) if te <= T), default=None)
    e20, e50 = (D['e20'][k15], D['e50'][k15]) if k15 is not None else (None, None)
    if e50 is not None and k15 >= 3 and D['e50'][k15-3] is not None:
        al = (e20 > e50) if s > 0 else (e20 < e50); sl = s*(e50 - D['e50'][k15-3]) > 0
        c_pts = (6 if al else 0) + (4 if sl else 0); trend = 'BULLISH' if e20 > e50 else 'BEARISH' if e20 < e50 else 'FLAT'
    else: al = sl = False; c_pts = 0; trend = 'UNKNOWN'
    f['C'] = dict(points=c_pts, max=10, ema20=e20, ema50=e50, trend_15m=trend, aligned=al, ema50_slope_with_signal=sl)
    # ---- D: momentum (15) ----
    r, ad, p, m = D['rsi'][i], D['adx'][i], D['pdi'][i], D['mdi'][i]
    lo, hi = (52, 70) if s > 0 else (30, 48)
    r_pts = 5 if lo <= r <= hi else 2 if lo-5 <= r <= hi+5 else 0
    a2 = 5 if ad >= 20 else 2 if ad >= 15 else 0; di = (p > m) if s > 0 else (m > p)
    f['D'] = dict(points=r_pts + a2 + (5 if di else 0), max=15, rsi=round(r, 1), adx=round(ad, 1), plus_di=round(p, 1), minus_di=round(m, 1), di_with_signal=di)
    # ---- E: volume (10) ----
    rv = V[j]/D['vma'][j] if D['vma'][j] else 0
    win = range(i-5, i+1); dv = sum(V[k] for k in win if (C[k] > O[k] if s > 0 else C[k] < O[k])); tv = sum(V[k] for k in win)
    share = dv/tv if tv else 0
    e_pts = (4 if rv >= 1.5 else 3 if rv >= 1.0 else 1 if rv >= 0.7 else 0) + (6 if share >= 0.6 else 3 if share >= 0.5 else 0)
    f['E'] = dict(points=e_pts, max=10, signal_relative_volume=round(rv, 2), directional_volume_share_6bars=round(share, 2))
    # ---- F/G: opposing obstacles and clear space ----
    obst = []
    for top, bot, bull in D['snap'][i]:
        if s > 0 and not bull and top > entry: obst.append(('bearish OB', max(bot, entry)))
        if s < 0 and bull and bot < entry: obst.append(('bullish OB', min(top, entry)))
    for conf, pidx, px in known(D['ph5'] if s > 0 else D['pl5'], i):
        if pidx < i - 288: continue
        # major swing only: the extreme of the 48 bars (4h) up to the pivot; smaller intraday swings are treated as minor
        if (s > 0 and px < max(H[max(pidx-48, 0):pidx+1])) or (s < 0 and px > min(L[max(pidx-48, 0):pidx+1])): continue
        if s > 0 and px > entry and max(C[pidx+1:i+1]) < px: obst.append(('swing high', px))
        if s < 0 and px < entry and min(C[pidx+1:i+1]) > px: obst.append(('swing low', px))
    if obst:
        kind, lvl = min(obst, key=lambda x: abs(x[1] - entry)); space = abs(lvl - entry)/entry
    else: kind, lvl, space = 'none within 24h', None, 0.03
    f_pts = 15 if space >= 0.012 else 12 if space >= PREF_SPACE else 6 if space >= TARGET else 0
    f['F'] = dict(points=f_pts, max=15, nearest_obstacle=kind, obstacle_price=lvl, obstacle_distance_pct=round(space*100, 3))
    f['G'] = dict(clear_space_pct=round(space*100, 3), needed_pct=round((TARGET - TOUCH_TOL)*100, 2), preferred_pct=PREF_SPACE*100, passed=space >= TARGET - TOUCH_TOL)
    dev = abs(entry - orig)/orig
    f['H'] = dict(entry_price=entry, indicator_entry=orig, deviation_pct=round(dev*100, 4), passed=dev <= MAX_DEV)
    score = a_pts + b_pts + c_pts + f['D']['points'] + e_pts + f_pts
    mand = []
    if ev['score'] < 5: mand.append('original score below 5 stars')
    if conflict: mand.append('A: clear opposite 5m structure (%s) with no break of structure' % ('LH+LL' if s > 0 else 'HH+HL'))
    if not primary: mand.append('B: no primary price confirmation (' + f['B']['confirmation'] + ')')
    if not f['G']['passed']: mand.append('G: only %.2f%% clear space to %s (< 0.60%%, target +0.70%%)' % (space*100, kind))
    if not f['H']['passed']: mand.append('H: entry moved %.3f%% from indicator entry (> 0.15%%)' % (dev*100))
    band = 'STRONG' if score >= STRONG else 'CONDITIONAL' if score >= COND else 'LOW'
    if band == 'CONDITIONAL':
        if space < PREF_SPACE: mand.append('conditional 70-79: clear space %.2f%% < preferred 0.85%%' % (space*100))
        if b_pts < 20: mand.append('conditional 70-79: confirmation %d/25 < 20' % b_pts)
    if band == 'LOW': mand.append('score %d < 70' % score)
    for key, name in (('A', 'A structure'), ('B', 'B confirmation'), ('C', 'C 15m trend'), ('D', 'D momentum'), ('E', 'E volume'), ('F', 'F obstacle distance')):
        (passed if f[key]['points'] >= 0.6*f[key]['max'] else failed).append('%s %d/%d' % (name, f[key]['points'], f[key]['max']))
    (passed if f['G']['passed'] else failed).append('G space %.2f%%' % (space*100)); (passed if f['H']['passed'] else failed).append('H deviation %.3f%%' % (dev*100))
    return dict(ok=not mand, mandatory_fail=mand, score=score, band=band, filters=f, decision_time=T, entry=entry, passed=passed, failed=failed)

# ---------------------------------------------------------------- run
DATA = {s: build(s) for s in SYMS}
sigs = []
for s in SYMS:
    D = DATA[s]
    for ev in D['ev']:
        st = D['t5'][ev['retest_bar']] + M5
        if not (START <= st < END): continue
        sigs.append(dict(sym=s, ev=ev, signal_time=st))
sigs.sort(key=lambda x: (x['signal_time'], SYMS.index(x['sym']), x['ev']['side']))
rows = []
for n, sg in enumerate(sigs, 1):
    D = DATA[sg['sym']]; ev = sg['ev']; j = ev['retest_bar']
    cont = evaluate(D, ev, j, 'CONTINUATION')
    if cont['ok']: res, path = cont, 'CONTINUATION'
    elif j + 1 < len(D['C']) and D['t5'][j+1] + M5 < END: res, path = evaluate(D, ev, j+1, 'BREAKOUT'), 'BREAKOUT'
    else: res, path = dict(ok=False, mandatory_fail=['confirmation candle not closed before window end'], score=0, filters={}, passed=[], failed=[]), 'BREAKOUT'
    strong_cont = cont.get('filters', {}).get('B', {}).get('confirmed', False)
    rows.append(dict(id=n, sym=sg['sym'], side=ev['side'], signal_time=sg['signal_time'], candle_open=D['t5'][j], stars=ev['score'], star_parts=ev['parts'],
        indicator_entry=ev['entry'], sl=ev['sl'], tp=ev['tp'], ob_top=ev['ob_top'], ob_bottom=ev['ob_bottom'], sig_high=D['H'][j], sig_low=D['L'][j], sig_close=D['C'][j],
        decision='ACCEPTED' if res['ok'] else 'REJECTED', path=path if res['ok'] else None, strong_continuation=strong_cont,
        continuation_eval=cont, final_eval=res))

# ---- rejected / all-signal outcome tracking (24h from signal close, vs indicator entry and original SL) ----
def track(D, row, t0, ref):
    s = 1 if row['side'] == 'LONG' else -1; tgt = ref*(1 + s*TARGET); mfe = mae = 0.0; hit = None; sl_first = None; end = min(t0 + HORIZON, END)
    for t in range(t0, end, M1):
        b = D['one'].get(t)
        if b is None: continue
        o, h, l, c, v = b; fav = s*((h if s > 0 else l) - ref)/ref; adv = s*((l if s > 0 else h) - ref)/ref
        sl_now = (l <= row['sl']) if s > 0 else (h >= row['sl'])
        if sl_now and sl_first is None and hit is None: sl_first = t
        mfe = max(mfe, fav); mae = min(mae, adv)
        if hit is None and ((h >= tgt) if s > 0 else (l <= tgt)): hit = t
    return dict(horizon_hours=round((end - t0)/3600000, 2), horizon_complete=end - t0 == HORIZON, reached_070=hit is not None,
                minutes_to_070=None if hit is None else (hit - t0)//M1, reached_070_before_sl=hit is not None and (sl_first is None or hit < sl_first),
                original_sl_hit_first=sl_first is not None and (hit is None or sl_first < hit or sl_first == hit),
                mfe_pct=round(mfe*100, 3), mae_pct=round(mae*100, 3))
for r in rows: r['after_signal'] = track(DATA[r['sym']], r, r['signal_time'], r['indicator_entry'])

# ---- portfolio: live Simulator sizing (5% of balance, 75x, 7 slots, 0.05% fee/side, 1-tick slippage, cross-margin liq as SQL) ----
bal = BAL0; pos = []; trades = []; acc = {r['final_eval']['decision_time']: [] for r in rows if r['decision'] == 'ACCEPTED'}
for r in rows:
    if r['decision'] == 'ACCEPTED': acc[r['final_eval']['decision_time']].append(r)
def close(p, t, px, why):
    global bal
    s = p['s']; fill = px - s*p['slip']; fee = FEE*p['q']*fill
    pnl = s*p['q']*(fill - p['fill']) - p['fee_in'] - fee - p['funding']
    if why == 'LIQUIDATED': pnl = max(pnl, -(bal))
    bal_before = bal; bal += pnl
    p.update(exit_time=t, exit_price=px, exit_reason=why, pnl=pnl, balance_after=bal, exit_fee=fee); trades.append(p)
for t in range(START, END + M1, M1):
    for p in list(pos):
        if p['t0'] < t and t in DATA[p['sym']]['fund']:
            p['funding'] += p['s']*p['q']*DATA[p['sym']]['one'].get(t, (p['fill'],))[0]*DATA[p['sym']]['fund'][t]
        b = DATA[p['sym']]['one'].get(t)
        if b is None or t >= END: continue
        o, h, l, c, v = b; s = p['s']
        win = (h >= p['target']) if s > 0 else (l <= p['target'])
        stop_lvl = max(p['sl'], p['liq']) if s > 0 else min(p['sl'], p['liq']); stop_is_liq = stop_lvl == p['liq'] and p['liq'] != p['sl']
        lose = (l <= stop_lvl) if s > 0 else (h >= stop_lvl)
        if win and lose:
            p['ambiguous'] = True; pos.remove(p); close(p, t, stop_lvl, 'AMBIGUOUS (target and stop in same 1m candle; booked as stop)')
        elif lose: pos.remove(p); close(p, t, stop_lvl, 'LIQUIDATED' if stop_is_liq else 'STOP_LOSS')
        elif win: pos.remove(p); close(p, t, p['target'], 'TARGET_070')
    if t >= END: break
    for r in acc.get(t, []):
        ev = r['final_eval']
        if len(pos) >= SLOTS: r['trade'] = dict(status='ACCEPTED_NO_SLOT'); continue
        m = round(bal*SHARE, 8); free = bal - sum(p['margin'] for p in pos)
        if m <= 0 or free < m: r['trade'] = dict(status='ACCEPTED_NO_BALANCE'); continue
        s = 1 if r['side'] == 'LONG' else -1; slip = TICK[r['sym']]; px = ev['entry']; fill = px + s*slip; q = m*LEV/fill; fee_in = FEE*q*fill
        liq = max(fill - s*(free - fee_in - MMR*m*LEV)/q, 0)
        p = dict(id=r['id'], sym=r['sym'], side=r['side'], s=s, path=r['path'], score=ev['score'], t0=t, entry_price=px, fill=fill, slip=slip, q=q, margin=m, notional=m*LEV,
                 target=px*(1 + s*TARGET), sl=r['sl'], liq=liq, fee_in=fee_in, funding=0.0, balance_before=bal, ambiguous=False)
        pos.append(p); r['trade'] = p
unres = []
for p in pos:
    last = max(k for k in DATA[p['sym']]['one'] if k < END); c = DATA[p['sym']]['one'][last][3]
    p.update(exit_time=None, exit_reason='UNRESOLVED (open at window end)', unrealized=p['s']*p['q']*(c - p['fill']) - p['fee_in'] - p['funding'], last_price=c); unres.append(p)
for p in trades + unres:
    st = 'SUCCESS' if p['exit_reason'] == 'TARGET_070' else 'AMBIGUOUS' if p['ambiguous'] else 'UNRESOLVED' if p['exit_time'] is None else 'UNSUCCESSFUL'
    p['status'] = st; p['minutes_open'] = None if p['exit_time'] is None else (p['exit_time'] - p['t0'])//M1
data_gaps = {s: dict(missing_5m=len(DATA[s]['missing5']), missing_1m=len(DATA[s]['missing1'])) for s in SYMS}
json.dump(dict(start=START, end=END, start_balance=BAL0, final_cash=bal, rows=rows, trades=sorted(trades + unres, key=lambda p: (p['t0'], p['id'])),
               data_gaps=data_gaps, rules_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), raw_hashes=META['files']),
          open(OUT/'result.json', 'w'), default=str, indent=1)
print('signals', len(rows), 'accepted', sum(r['decision'] == 'ACCEPTED' for r in rows), 'trades', len(trades) + len(unres), 'final cash', round(bal, 4), 'gaps', data_gaps)
