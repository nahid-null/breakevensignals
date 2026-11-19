"""prompt-59: offline 7-day backtest of the uploaded 'Scalp Pro' indicator (Binance USD-M futures, 5m only).
Research only: never touches the live Simulator, scanner, database, balance, Telegram or website."""
import json, math, sys, hashlib
from pathlib import Path
import numpy as np

RAW = Path(sys.argv[1]); OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
END = int(sys.argv[3]); MODE = sys.argv[4] if len(sys.argv) > 4 else 'cross'; START = END - 7*86400000
SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","LINKUSDT","NEARUSDT","BCHUSDT","LTCUSDT","ADAUSDT","AVAXUSDT"]
LEV, SLOTS, SHARE, TARGET = 75, 6, 0.05, 0.25
FEE, SLIP, DELAY = 0.0005, 0.0002, 60000
WALLET0 = 1000.0
MARGIN = WALLET0 * SHARE
BR = json.loads(Path('/tmp/r59/brackets.json').read_text())
INFO = json.loads((RAW/'exchangeInfo.json').read_text())

# ---------- indicator: exact port of Scalp Pro v.2 (inputs 8 / 10 / 8) ----------
def ss_filter(src, n):
    f = (1.414*3.141592653589793238462643)/n; a = math.exp(-f); c2 = 2*a*math.cos(f); c3 = -a*a; c1 = 1-c2-c3
    out = [None]*len(src)
    for i in range(len(src)):
        if i == 0 or src[i] is None or src[i-1] is None: out[i] = None; continue  # p[1] is na -> na
        p1 = out[i-1] if out[i-1] is not None else 0.0              # nz(ssmooth[1])
        p2 = out[i-2] if i >= 2 and out[i-2] is not None else 0.0   # nz(ssmooth[2])
        out[i] = c1*(src[i]+src[i-1])*0.5 + c2*p1 + c3*p2
    return out
def scalp_pro(closes, fast=8, slow=10, smooth=8):
    s1 = ss_filter(closes, fast); s2 = ss_filter(closes, slow)
    macd = [None if (x is None or y is None) else (x-y)*10000000 for x, y in zip(s1, s2)]
    sig = ss_filter(macd, smooth)
    buy = [False]*len(closes); sell = [False]*len(closes)
    for i in range(1, len(closes)):
        if None in (macd[i], sig[i], macd[i-1], sig[i-1]): continue
        buy[i] = macd[i] > sig[i] and macd[i-1] <= sig[i-1]   # crossover
        sell[i] = macd[i] < sig[i] and macd[i-1] >= sig[i-1]  # crossunder
    return macd, sig, buy, sell

def tier(sym, notional):
    for b in BR[sym]:
        if b['bracketNotionalFloor'] <= notional < b['bracketNotionalCap']: return b['bracketMaintenanceMarginRate'], b['bracketMaintenanceMarginAmount'] if 'bracketMaintenanceMarginAmount' in b else b['cumFastMaintenanceAmount']
    b = BR[sym][-1]; return b['bracketMaintenanceMarginRate'], b['cumFastMaintenanceAmount']
def step_of(sym):
    f = {x['filterType']: x for x in INFO[sym]['filters']}
    return float(f['MARKET_LOT_SIZE']['stepSize']), float(f['MIN_NOTIONAL']['notional']), float(f['PRICE_FILTER']['tickSize'])

def tp_trigger(p):
    T = TARGET*MARGIN + p['funding']; q = p['qty']; E = p['entry']
    if p['dir'] > 0: return (T + q*E*(1+FEE)) / (q*(1-FEE)) / (1-SLIP)
    return (q*E*(1-FEE) - T) / (q*(1+FEE)) / (1+SLIP)
def net_if_closed(p, price):
    fill = price*(1-SLIP) if p['dir'] > 0 else price*(1+SLIP)
    return p['dir']*p['qty']*(fill-p['entry']) - FEE*p['qty']*p['entry'] - FEE*p['qty']*fill - p['funding']

D = {}; sigs = []; repaint = {}; hashes = {}
for s in SYMS:
    raw = (RAW/f'{s}.json').read_bytes(); hashes[s] = hashlib.sha256(raw).hexdigest(); d = json.loads(raw)
    k5 = d['k5']; t5 = [int(k[0]) for k in k5]; c5 = [float(k[4]) for k in k5]
    assert all(t5[i+1]-t5[i] == 300000 for i in range(len(t5)-1)), s
    macd, sig, buy, sell = scalp_pro(c5)
    # repaint checks: (a) truncated-history prefix test, (b) shorter warmup start, (c) intrabar flicker on forming bars
    idx = [i for i in range(len(t5)) if START < t5[i]+300000 <= END]
    trunc_bad = 0
    for cut in idx[::25]:
        _, _, b2, s2 = scalp_pro(c5[:cut+1])
        trunc_bad += sum(1 for j in range(cut+1) if b2[j] != buy[j] or s2[j] != sell[j])
    w = [i for i in range(len(t5)) if t5[i] >= START - 3*86400000][0]
    _, _, b3, s3 = scalp_pro(c5[w:])
    warm_bad = sum(1 for i in idx if b3[i-w] != buy[i] or s3[i-w] != sell[i])
    k1 = d['k1']; m1 = d['m1']
    one = {int(k[0]): (float(k[1]), float(k[2]), float(k[3]), float(k[4])) for k in k1}
    mark = {int(k[0]): (float(k[1]), float(k[2]), float(k[3]), float(k[4])) for k in m1}
    flick = 0; intrabar_seen = 0
    for i in idx:   # bars where a BUY/SELL showed after 1..4 minutes of the forming bar
        shown = []; 
        for mnt in range(1, 5):
            key = t5[i] + (mnt-1)*60000
            if key not in one: continue
            _, _, bp, sp = scalp_pro(c5[:i] + [one[key][3]])
            if bp[-1]: shown.append('BUY')
            if sp[-1]: shown.append('SELL')
        if shown:
            intrabar_seen += 1
            final = 'BUY' if buy[i] else 'SELL' if sell[i] else None
            if any(x != final for x in shown): flick += 1
    repaint[s] = dict(truncated_history_mismatches=trunc_bad, shorter_warmup_mismatches=warm_bad, bars_with_intrabar_signal=intrabar_seen, bars_where_intrabar_signal_disappeared_or_flipped_at_close=flick)
    for i in idx:
        if buy[i] or sell[i]:
            sigs.append(dict(sym=s, side='BUY' if buy[i] else 'SELL', bar_open=t5[i], close_time=t5[i]+300000, close=c5[i], macd=macd[i], signal=sig[i]))
    fund = [(int(f['fundingTime']), float(f['fundingRate']), float(f['markPrice']) if f.get('markPrice') not in (None, '') else None) for f in d['fund']]
    D[s] = dict(one=one, mark=mark, fund={t: (r, mp) for t, r, mp in fund}, step=step_of(s))
    assert all(t in one and t in mark for t in range(START, END, 60000)), f'missing 1m {s}'
sigs.sort(key=lambda x: (x['close_time'], SYMS.index(x['sym'])))

# ---------- portfolio simulation on the 1m timeline (cross margin) ----------
wallet = WALLET0; pos = {}; trades = []; skipped = []; liquidation = None; max_slots = 0; ambiguous = 0
pending = {}
for sg in sigs: pending.setdefault(sg['close_time'] + DELAY, []).append(sg)
for t in range(START, END, 60000):
    # funding settles at the start of the funding minute for positions opened before it
    for s, p in pos.items():
        if t in D[s]['fund'] and p['entry_time'] < t:
            r, mp = D[s]['fund'][t]; mp = mp or D[s]['mark'][t][0]
            amt = p['dir']*p['qty']*mp*r; p['funding'] += amt; wallet -= amt; p['tp'] = tp_trigger(p)
    for sg in pending.get(t, []):
        s = sg['sym']; sg['entered'] = False
        if liquidation: sg['skip'] = 'account liquidated'; skipped.append(sg); continue
        if s in pos: sg['skip'] = 'same coin already open'; skipped.append(sg); continue
        if len(pos) >= SLOTS: sg['skip'] = 'all 6 slots in use'; skipped.append(sg); continue
        o = D[s]['one'][t][0]; dirn = 1 if sg['side'] == 'BUY' else -1
        E = o*(1+SLIP*dirn); step, minnot, tick = D[s]['step']
        qty = math.floor(MARGIN*LEV/E/step + 1e-9)*step
        used = sum(x['margin'] for x in pos.values())
        eq = wallet + sum(x['dir']*x['qty']*(D[k]['mark'][t][0]-x['entry']) for k, x in pos.items())
        if qty*E < minnot: sg['skip'] = 'below Binance minimum order'; skipped.append(sg); continue
        free = (wallet - used) if MODE == 'isolated' else (eq - used)
        if free < MARGIN + FEE*qty*E: sg['skip'] = 'not enough free balance'; skipped.append(sg); continue
        fee = FEE*qty*E; wallet -= fee
        p = dict(sym=s, side='LONG' if dirn > 0 else 'SHORT', signal=sg['side'], dir=dirn, signal_close_time=sg['close_time'], entry_time=t, entry=E, qty=qty, notional=qty*E,
                 margin=MARGIN, entry_fee=fee, funding=0.0, max_up=-1e18, max_dn=1e18, max_up_t=None, max_dn_t=None)
        p['tp'] = tp_trigger(p); p['tp_at_entry'] = p['tp']; pos[s] = p; sg['entered'] = True
    max_slots = max(max_slots, len(pos))
    if not pos: continue
    # TP touches on last price this minute
    hit = {s for s, p in pos.items() if (D[s]['one'][t][1] >= p['tp'] if p['dir'] > 0 else D[s]['one'][t][2] <= p['tp'])}
    # account liquidation test on worst 1m mark of every open position simultaneously (conservative)
    eqw = wallet; mm = 0.0
    for s, p in pos.items():
        mk = D[s]['mark'][t]; worst = mk[2] if p['dir'] > 0 else mk[1]
        eqw += p['dir']*p['qty']*(worst-p['entry']); r, cum = tier(s, p['qty']*worst); mm += p['qty']*worst*r - cum
    # excursions on last price
    for s, p in pos.items():
        h, l = D[s]['one'][t][1], D[s]['one'][t][2]
        fav = (min(h, p['tp']) if p['dir'] > 0 else max(l, p['tp'])) if s in hit else (h if p['dir'] > 0 else l)
        adv = l if p['dir'] > 0 else h
        u, dn = net_if_closed(p, fav), net_if_closed(p, adv)
        if u > p['max_up']: p['max_up'], p['max_up_t'] = u, t
        if dn < p['max_dn']: p['max_dn'], p['max_dn_t'] = dn, t
    if MODE == 'isolated':
        for s in list(pos):
            p = pos[s]; mk = D[s]['mark'][t]; worst = mk[2] if p['dir'] > 0 else mk[1]
            r, cum = tier(s, p['qty']*worst)
            if p['margin'] + p['dir']*p['qty']*(worst-p['entry']) <= p['qty']*worst*r - cum:
                if s in hit: ambiguous += 1; hit.discard(s)
                pos.pop(s); wallet -= p['margin']
                p.update(status='LIQUIDATED', exit_time=t, exit=worst, net=-p['margin'] - p['entry_fee'] - p['funding'])
                trades.append(p)
        eqw, mm = 1.0, 0.0
    if eqw <= mm:
        if hit: ambiguous += 1
        liquidation = dict(time=t, equity_at_worst_mark=eqw, maintenance=mm, positions=[s for s in pos])
        for s, p in list(pos.items()):
            mk = D[s]['mark'][t]; worst = mk[2] if p['dir'] > 0 else mk[1]
            p.update(status='LIQUIDATED', exit_time=t, exit=worst, net=p['dir']*p['qty']*(worst-p['entry']) - p['entry_fee'] - p['funding'])
            trades.append(p)
        wallet = 0.0; pos = {}; continue
    for s in hit:
        p = pos.pop(s); fill = p['tp']*(1-SLIP) if p['dir'] > 0 else p['tp']*(1+SLIP)
        pnl = p['dir']*p['qty']*(fill-p['entry']); xfee = FEE*p['qty']*fill
        wallet += pnl - xfee
        p.update(status='TP', exit_time=t, exit_trigger=p['tp'], exit=fill, exit_fee=xfee, net=pnl - xfee - p['entry_fee'] - p['funding'])
        trades.append(p)
last = END - 60000
for s, p in pos.items():
    lp = D[s]['one'][last][3]; mp = D[s]['mark'][last][3]
    p.update(status='OPEN', last_price=lp, last_mark=mp, unreal_gross=p['dir']*p['qty']*(lp-p['entry']), unreal_net_if_closed=net_if_closed(p, lp))
    trades.append(p)
# cross-margin liquidation price per open trade (other open trades held at their last mark)
openp = [p for p in trades if p['status'] == 'OPEN']
for p in openp:
    r, cum = tier(p['sym'], p['notional'])
    p['isolated_liq_price'] = (p['margin'] - p['dir']*p['qty']*p['entry'] - cum) / (p['qty']*(r - p['dir']))
eq_now = wallet + sum(p['dir']*p['qty']*(p['last_mark']-p['entry']) for p in openp)
mm_now = sum(p['qty']*p['last_mark']*tier(p['sym'], p['qty']*p['last_mark'])[0] - tier(p['sym'], p['qty']*p['last_mark'])[1] for p in openp)
for p in openp:
    r, cum = tier(p['sym'], p['qty']*p['last_mark'])
    other_eq = eq_now - p['dir']*p['qty']*(p['last_mark']-p['entry'])
    other_mm = mm_now - (p['qty']*p['last_mark']*r - cum)
    # other_eq + dir*q*(P-E) = other_mm + q*P*r - cum
    P = (other_mm - cum - other_eq + p['dir']*p['qty']*p['entry']) / (p['qty']*(p['dir'] - r))
    p['cross_liq_price_alone'] = P if P > 0 else None
    p['cross_liq_distance_pct'] = (P/p['last_mark']-1)*100 if P > 0 else None
    p['isolated_style_price_full_margin_loss'] = p['entry']*(1 - p['dir']*MARGIN/p['notional'])
res = dict(mode=MODE, window_utc=[START, END], wallet0=WALLET0, margin_per_slot=MARGIN, wallet_realized=wallet, equity_mark=eq_now, maintenance_now=mm_now,
           max_slots=max_slots, ambiguous_same_minute=ambiguous, liquidation=liquidation, repaint=repaint, data_sha256=hashes, signals=sigs, trades=trades, skipped=skipped)
(OUT/f'result59-{MODE}.json').write_text(json.dumps(res, indent=1, default=float))
print(json.dumps(dict(signals=len(sigs), buys=sum(x['side']=='BUY' for x in sigs), trades=len(trades), tp=sum(p['status']=='TP' for p in trades),
      open=len(openp), liq=liquidation, wallet=wallet, equity=eq_now, max_slots=max_slots, ambiguous=ambiguous, repaint=repaint), indent=1, default=float))
