"""prompt-61: offline 7-day backtest of 'OB STRONG Entry Signals' with the user's rules. Research only: never touches the
live Simulator, scanner, database, balance, Telegram or website.
usage: backtest60.py RAW OUT VARIANT   VARIANT = main | futures_signals | exchange_rules"""
import json, math, sys, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from ob61 import run

RAW = Path(sys.argv[1]); OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True); VAR = sys.argv[3]
META = json.loads((RAW/'hashes.json').read_text()); END = META['end']; START = META['start']
SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","LINKUSDT","NEARUSDT","BCHUSDT","LTCUSDT","ADAUSDT","AVAXUSDT"]
WALLET0 = 10.0; SLOTS = 6; MARGIN = WALLET0*0.05; LEV = 75; TARGET = 0.50*MARGIN   # $0.50 margin, $0.25 net TP
FEE, SLIP = 0.0005, 0.0002   # Binance taker fee each side, 0.02% slippage on every fill
BR = json.loads((RAW/'brackets.json').read_text()); INFO = json.loads((RAW/'exchangeInfo.json').read_text())
MIN = 60000

def tier(sym, notional):
    for b in BR[sym]:
        if b['bracketNotionalFloor'] <= notional < b['bracketNotionalCap']: return b['bracketMaintenanceMarginRate'], b['cumFastMaintenanceAmount']
    b = BR[sym][-1]; return b['bracketMaintenanceMarginRate'], b['cumFastMaintenanceAmount']
def filt(sym):
    f = {x['filterType']: x for x in INFO[sym]['filters']}
    return float(f['MARKET_LOT_SIZE']['stepSize']), float(f['MIN_NOTIONAL']['notional'])
def tp_trigger(p):
    T = TARGET + p['funding']; q = p['qty']; E = p['entry']
    if p['dir'] > 0: return (T + q*E*(1+FEE)) / (q*(1-FEE)) / (1-SLIP)
    return (q*E*(1-FEE) - T) / (q*(1+FEE)) / (1+SLIP)
def net_if_closed(p, price):
    fill = price*(1-SLIP) if p['dir'] > 0 else price*(1+SLIP)
    return p['dir']*p['qty']*(fill-p['entry']) - FEE*p['qty']*p['entry'] - FEE*p['qty']*fill - p['funding']

D = {}; sigs = []; hashes = {}; WEAK = []
for s in SYMS:
    raw = (RAW/f'{s}.json').read_bytes(); hashes[s] = hashlib.sha256(raw).hexdigest(); d = json.loads(raw)
    k5 = d['fut5' if VAR == 'futures_signals' else 'spot5']
    t5 = [int(k[0]) for k in k5]; O, H, L, C, V = ([float(k[j]) for k in k5] for j in (1, 2, 3, 4, 5))
    assert all(t5[i+1]-t5[i] == 300000 for i in range(len(t5)-1)), s
    ev, weak = run(O, H, L, C, V, all_retests=True)
    for e in weak:
        if START <= t5[e['retest_bar']] + 300000 < END: WEAK.append(dict(sym=s, side=e['side'], signal_time=t5[e['retest_bar']] + 300000, score=e['score']))
    for e in ev:
        sig_time = t5[e['retest_bar']] + 300000          # close of the candle the label sits on
        if not (START <= sig_time < END): continue
        # the label's own SL/TP (1:2), checked on the same signal candles: which is touched first?
        own = 'neither before window end'; own_t = None
        for i in range(e['retest_bar']+1, len(C)):
            up = H[i] >= e['tp'] if e['side'] == 'LONG' else L[i] <= e['tp']; dn = L[i] <= e['sl'] if e['side'] == 'LONG' else H[i] >= e['sl']
            if up and dn: own, own_t = 'both in same candle', t5[i]; break
            if up: own, own_t = 'TP', t5[i]; break
            if dn: own, own_t = 'SL', t5[i]; break
        sigs.append(dict(sym=s, side=e['side'], candle_open=t5[e['retest_bar']], signal_time=sig_time, indicator_entry=e['entry'],
                         score=e['score'], parts=e['parts'], label_sl=e['sl'], label_tp=e['tp'], label_own_result=own, label_own_time=own_t,
                         ob_top=e['ob_top'], ob_bottom=e['ob_bottom'], label_still_on_chart=True))
    one = {int(k[0]): tuple(float(x) for x in k[1:5]) for k in d['k1']}
    mark = {int(k[0]): tuple(float(x) for x in k[1:5]) for k in d['m1']}
    assert all(t in one and t in mark for t in range(START, END, MIN)), f'missing 1m {s}'
    fund = {int(f['fundingTime'])//MIN*MIN: (float(f['fundingRate']), float(f['markPrice']) if f.get('markPrice') not in (None, '') else None) for f in d['fund']}
    D[s] = dict(one=one, mark=mark, fund=fund, filt=filt(s))
sigs.sort(key=lambda x: (x['signal_time'], SYMS.index(x['sym']), x['side']))
for i, sg in enumerate(sigs): sg['id'] = i + 1

# ---------- each signal on its own (no slots, no shared account): does it reach +50% before the window ends? ----------
for sg in sigs:
    s = sg['sym']; t = sg['signal_time']; dirn = 1 if sg['side'] == 'LONG' else -1; E = D[s]['one'][t][0]*(1+SLIP*dirn)
    p = dict(dir=dirn, qty=MARGIN*LEV/E, entry=E, funding=0.0); tp = tp_trigger(p); worst = 0.0; sg['alone_tp_time'] = None
    for m in range(t, END, MIN):
        o, h, l, c = D[s]['one'][m]
        if (h >= tp) if dirn > 0 else (l <= tp): sg['alone_tp_time'] = m; break
        worst = min(worst, net_if_closed(p, l if dirn > 0 else h))
    sg['alone_worst_float_before_tp'] = worst; sg['alone_worst_move_pct'] = worst / (MARGIN*LEV) * 100
    sg['alone_liquidated_isolated'] = worst <= -MARGIN

# ---------- portfolio: $10 cross-margin account, 6 slots x $0.50, 75x, no SL, +50% net TP, same coin allowed ----------
wallet = WALLET0; pos = []; trades = []; skipped = []; liquidation = None; max_slots = 0; ambiguous = 0
eq_peak = WALLET0; max_dd = 0.0; max_dd_t = None; min_eq = WALLET0; min_eq_t = None; worst_float = 0.0; worst_float_t = None
by_time = {}
for sg in sigs: by_time.setdefault(sg['signal_time'], []).append(sg)
for t in range(START, END, MIN):
    for p in pos:
        if t in D[p['sym']]['fund'] and p['entry_time'] < t:
            r, mp = D[p['sym']]['fund'][t]; mp = mp or D[p['sym']]['mark'][t][0]
            amt = p['dir']*p['qty']*mp*r; p['funding'] += amt; wallet -= amt; p['tp'] = tp_trigger(p)
    for sg in by_time.get(t, []):
        s = sg['sym']
        if liquidation: sg['result'] = 'skipped: account already liquidated'; skipped.append(sg); continue
        if len(pos) >= SLOTS: sg['result'] = 'skipped: all 6 slots in use'; skipped.append(sg); continue
        dirn = 1 if sg['side'] == 'LONG' else -1; E = D[s]['one'][t][0]*(1+SLIP*dirn); step, minnot = D[s]['filt']
        qty = MARGIN*LEV/E
        if VAR == 'exchange_rules':
            qty = math.floor(qty/step + 1e-9)*step
            if qty <= 0 or qty*E < minnot: sg['result'] = f'skipped: below Binance minimum order (step {step}, min ${minnot:g})'; skipped.append(sg); continue
        used = sum(x['margin'] for x in pos)
        eq = wallet + sum(x['dir']*x['qty']*(D[x['sym']]['mark'][t][0]-x['entry']) for x in pos)
        if eq - used < MARGIN + FEE*qty*E: sg['result'] = 'skipped: not enough free balance'; skipped.append(sg); continue
        fee = FEE*qty*E; wallet -= fee
        p = dict(id=len(trades)+len(pos)+1, signal_id=sg['id'], sym=s, side=sg['side'], dir=dirn, signal_time=sg['signal_time'], entry_time=t, entry=E,
                 indicator_entry=sg['indicator_entry'], qty=qty, notional=qty*E, margin=MARGIN if VAR != 'exchange_rules' else qty*E/LEV, entry_fee=fee, funding=0.0,
                 max_dn=0.0, max_dn_t=None, label_still_on_chart=sg['label_still_on_chart'])
        p['tp'] = tp_trigger(p); p['tp_at_entry'] = p['tp']; pos.append(p); sg['result'] = 'opened'
    max_slots = max(max_slots, len(pos))
    if not pos: continue
    hit = [p for p in pos if (D[p['sym']]['one'][t][1] >= p['tp'] if p['dir'] > 0 else D[p['sym']]['one'][t][2] <= p['tp'])]
    # cross-margin check: for each coin, the worse of its 1m mark low / high for the coin's net positions (all coins at once)
    eqw = wallet; mm = 0.0
    for s in {p['sym'] for p in pos}:
        ps = [p for p in pos if p['sym'] == s]; mk = D[s]['mark'][t]
        def at(P): return sum(p['dir']*p['qty']*(P-p['entry']) for p in ps)
        P = mk[2] if at(mk[2]) <= at(mk[1]) else mk[1]
        eqw += at(P)
        for p in ps:
            r, cum = tier(s, p['qty']*P); mm += p['qty']*P*r - cum
    # excursion per trade on last price (adverse side), before TP
    for p in pos:
        o, h, l, c = D[p['sym']]['one'][t]
        dn = net_if_closed(p, l if p['dir'] > 0 else h)
        if p in hit: dn = min(dn, 0.0) if dn < 0 else 0.0
        if dn < p['max_dn']: p['max_dn'], p['max_dn_t'] = dn, t
    if eqw <= mm:
        if hit: ambiguous += 1
        liquidation = dict(time=t, equity_at_worst_mark=eqw, maintenance=mm, positions=[p['id'] for p in pos])
        for p in pos:
            mk = D[p['sym']]['mark'][t]; P = mk[2] if p['dir'] > 0 else mk[1]
            p.update(status='LIQUIDATED', exit_time=t, exit=P, net=p['dir']*p['qty']*(P-p['entry']) - p['entry_fee'] - p['funding'])
            trades.append(p)
        wallet = 0.0; pos = []; min_eq = 0.0; min_eq_t = t; max_dd = max(max_dd, eq_peak); max_dd_t = t; continue
    for p in hit:
        pos.remove(p); fill = p['tp']*(1-SLIP) if p['dir'] > 0 else p['tp']*(1+SLIP)
        pnl = p['dir']*p['qty']*(fill-p['entry']); xfee = FEE*p['qty']*fill; wallet += pnl - xfee
        p.update(status='TP', exit_time=t, exit_trigger=p['tp'], exit=fill, exit_fee=xfee, net=pnl - xfee - p['entry_fee'] - p['funding'])
        trades.append(p)
    # account equity marks: worst point inside the minute (after this minute's take-profits) and close
    float_worst = sum(min(net_if_closed(p, D[p['sym']]['one'][t][2]), net_if_closed(p, D[p['sym']]['one'][t][1])) for p in pos)
    float_close = sum(net_if_closed(p, D[p['sym']]['one'][t][3]) for p in pos)
    e_low = wallet + float_worst + sum(p['entry_fee'] for p in pos) * 0  # wallet already paid entry fees
    if float_worst < worst_float: worst_float, worst_float_t = float_worst, t
    if e_low < min_eq: min_eq, min_eq_t = e_low, t
    if eq_peak - e_low > max_dd: max_dd, max_dd_t = eq_peak - e_low, t
    eq_peak = max(eq_peak, wallet + float_close)
last = END - MIN
for p in pos:
    lp = D[p['sym']]['one'][last][3]; mp = D[p['sym']]['mark'][last][3]
    p.update(status='OPEN', last_price=lp, last_mark=mp, unreal_gross=p['dir']*p['qty']*(lp-p['entry']), unreal_net_if_closed=net_if_closed(p, lp))
    trades.append(p)
openp = [p for p in trades if p['status'] == 'OPEN']
eq_now = wallet + sum(p['unreal_net_if_closed'] for p in openp)
trades.sort(key=lambda p: p['entry_time'])
res = dict(variant=VAR, window_utc=[START, END], wallet0=WALLET0, margin_per_slot=MARGIN, leverage=LEV, target_net=TARGET, fee=FEE, slip=SLIP,
           wallet_realized=wallet, equity_if_open_closed_now=eq_now, max_slots=max_slots, ambiguous_same_minute=ambiguous, liquidation=liquidation,
           max_drawdown=max_dd, max_drawdown_time=max_dd_t, lowest_equity=min_eq, lowest_equity_time=min_eq_t,
           max_unrealized_loss=worst_float, max_unrealized_loss_time=worst_float_t, weak_retests=WEAK, data_sha256=hashes, signals=sigs, trades=trades, skipped=skipped)
(OUT/f'result61-{VAR}.json').write_text(json.dumps(res, indent=1, default=float))
tp = [p for p in trades if p['status'] == 'TP']
print(json.dumps(dict(variant=VAR, signals=len(sigs), long=sum(x['side']=='LONG' for x in sigs), trades=len(trades), tp=len(tp), liq=sum(p['status']=='LIQUIDATED' for p in trades),
      open=len(openp), skipped=len(skipped), wallet=wallet, equity=eq_now, max_slots=max_slots, max_dd=max_dd, min_eq=min_eq, worst_float=worst_float,
      liquidation=liquidation, alone_tp=sum(1 for x in sigs if x['alone_tp_time']), weak=len(WEAK), own={k: sum(x['label_own_result']==k for x in sigs) for k in ('TP','SL','both in same candle','neither before window end')}), indent=1, default=float))
