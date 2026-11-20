"""prompt-70: OB STRONG 30m (Binance USD-M Futures candles), ONE shared $10 CROSS-margin account, 7 slots x $0.50 fixed
margin, 75x, no stop loss, +50% margin net target, 1m exits, Binance tier-1 maintenance margin, real funding.
Offline research only: never imported by the website, worker, SQL or Telegram."""
import json, sys, collections
sys.path.insert(0, "/dev-server/research/prompt-61")
from ob61 import run
SYMS = "W ZEN GALA S A FF ETH SOL XRP LINK NEAR BCH LTC ADA AVAX DOGS PROM 1000CAT FLUX TRX BNB UNI BOME WLD WIF CRV EGLD FIL SAND HBAR".split()
SCEN = sys.argv[1] if len(sys.argv) > 1 else "A"   # A = strict 75x (coins capped below 75x not tradable); B = those coins at their max
R = "/tmp/r70/raw"; M = json.load(open(f"{R}/meta.json")); START, END = M['start'], M['end']
BR = json.load(open(f"{R}/brackets.json"))
FEE, SLIP, LEV, MARGIN, SLOTS, TP_NET, BAL0 = 0.0005, 0.0002, 75, 0.50, 7, 0.25, 10.0

def bracket(s, notional):
    for r in BR[s]:
        if r['bracketNotionalFloor'] <= notional < r['bracketNotionalCap']: return r
    return BR[s][-1]
data = {}; events = []; sigcount = collections.Counter()
for c in SYMS:
    s = c + "USDT"; d = json.load(open(f"{R}/{s}.json")); k = d['m30']
    T = [x[0] for x in k]; O, H, L, C, V = [[x[i] for x in k] for i in range(1, 6)]
    m1 = d['m1']; assert len(m1) == 10080 and m1[0][0] == START, s
    data[s] = dict(m1={x[0]: x for x in m1}, fund=collections.defaultdict(list))
    for f in d['funding']:
        data[s]['fund'][int(f['fundingTime']) // 60000 * 60000].append(float(f['fundingRate']))
    for e in run(O, H, L, C, V):
        t = T[e['bar']] + 1800000            # alert bar closed -> enter at next 1m open (no look-ahead)
        if START <= t < END:
            events.append(dict(coin=s, side=e['side'], signal_time=T[e['retest_bar']], confirm_time=t, score=e['score'])); sigcount[s] += 1
events.sort(key=lambda e: (e['confirm_time'], e['coin']))
byt = collections.defaultdict(list)
for e in events: byt[e['confirm_time']].append(e)

wallet = BAL0; pos = []; trades = []; skipped = []; curve = []
fees = fund_total = 0.0; maxslots = 0; peak = BAL0; maxdd = 0.0; hi = BAL0; lo = BAL0; min_upnl = 0.0; liq_events = []
def upnl(p, px): return p['dir'] * p['qty'] * (px - p['entry'])
def mm(p, px):
    n = p['qty'] * px; b = bracket(p['coin'], n); return n * b['bracketMaintenanceMarginRate'] - b['cumFastMaintenanceAmount']
def liq_price(p, others_px):
    """Binance cross-margin single-position liquidation price, holding the other open positions at given prices."""
    oth = [q for q in pos if q is not p]
    u = sum(upnl(q, others_px[q['coin']]) for q in oth); t = sum(mm(q, others_px[q['coin']]) for q in oth)
    b = bracket(p['coin'], p['qty'] * p['entry']); mmr, cum = b['bracketMaintenanceMarginRate'], b['cumFastMaintenanceAmount']
    q, d = p['qty'], p['dir']
    lp = (wallet - t + u + cum - d * q * p['entry']) / (q * mmr - d * q)
    return max(lp, 0.0)
for t in range(START, END, 60000):
    bars = {s: data[s]['m1'][t] for s in data}
    o = {s: b[1] for s, b in bars.items()}
    # 1) funding settlements at this minute
    for p in pos:
        for rate in data[p['coin']]['fund'].get(t, []):
            f = p['dir'] * p['qty'] * o[p['coin']] * rate; p['fund'] += f; wallet -= f; fund_total += f
    # 2) new entries confirmed at this minute
    for e in byt.get(t, []):
        s = e['coin']; maxlev = BR[s][0]['maxOpenPosLeverage']
        lev = LEV if maxlev >= LEV else (maxlev if SCEN == "B" else None)
        if lev is None: skipped.append({**e, 'reason': f'NOT TRADABLE AT 75x (Binance max {maxlev}x)'}); continue
        if len(pos) >= SLOTS: skipped.append({**e, 'reason': 'ALL 7 SLOTS OCCUPIED'}); continue
        d = 1 if e['side'] == 'LONG' else -1; ent = o[s] * (1 + SLIP * d); q = MARGIN * lev / ent; fee_in = FEE * q * ent
        equity = wallet + sum(upnl(p, o[p['coin']]) for p in pos)
        avail = equity - sum(p['margin'] for p in pos)
        if avail < MARGIN + fee_in: skipped.append({**e, 'reason': 'INSUFFICIENT AVAILABLE MARGIN'}); continue
        wallet -= fee_in; fees += fee_in
        p = dict(coin=s, side=e['side'], dir=d, signal_time=e['signal_time'], entry_time=t, entry=ent, qty=q, margin=MARGIN, lev=lev,
                 fee_in=fee_in, fund=0.0, equity_at_entry=equity - fee_in, score=e['score'])
        pos.append(p); p['liq_at_entry'] = liq_price(p, o)
        b = bracket(s, q * ent); p['mmr'] = b['bracketMaintenanceMarginRate']
        p['tp'] = (TP_NET + fee_in + q * ent) / (q * (1 - FEE)) / (1 - SLIP) if d > 0 else (q * ent - TP_NET - fee_in) / (q * (1 + FEE)) / (1 + SLIP)
    maxslots = max(maxslots, len(pos))
    # 3) cross-margin liquidation check at every position's worst price inside this minute (conservative)
    if pos:
        worst = {p['coin']: (bars[p['coin']][3] if p['dir'] > 0 else bars[p['coin']][2]) for p in pos}
        # opposite-direction positions on the same coin cannot both be at their worst; use per-position worst (conservative)
        ueq = sum(upnl(p, bars[p['coin']][3] if p['dir'] > 0 else bars[p['coin']][2]) for p in pos)
        tmm = sum(mm(p, bars[p['coin']][3] if p['dir'] > 0 else bars[p['coin']][2]) for p in pos)
        weq = wallet + ueq; lo = min(lo, weq); min_upnl = min(min_upnl, ueq); maxdd = max(maxdd, peak - weq)
        if weq <= tmm:
            liq_events.append(dict(time=t, positions=len(pos), equity=weq, maint=tmm))
            for p in pos:
                px = bars[p['coin']][3] if p['dir'] > 0 else bars[p['coin']][2]
                trades.append({**p, 'result': 'LIQUIDATED', 'exit_time': t + 60000, 'exit_price': px,
                               'gross': upnl(p, px), 'fee_out': 0.0, 'pnl': None})
            # Binance takes the remaining collateral (liquidation clearance); the account is left with ~0
            wallet = 0.0; pos = []
    # 4) take-profit fills
    for p in list(pos):
        h, l = bars[p['coin']][2], bars[p['coin']][3]
        q, ent, need = p['qty'], p['entry'], TP_NET + p['fee_in'] + p['fund']   # target re-solved each minute incl. funding paid so far
        p['tp'] = (need + q * ent) / (q * (1 - FEE)) / (1 - SLIP) if p['dir'] > 0 else (q * ent - need) / (q * (1 + FEE)) / (1 + SLIP)
        if (p['dir'] > 0 and h >= p['tp']) or (p['dir'] < 0 and l <= p['tp']):
            fill = p['tp'] * (1 - p['dir'] * SLIP); g = upnl(p, fill); fo = FEE * p['qty'] * fill
            wallet += g - fo; fees += fo; pos.remove(p)
            trades.append({**p, 'result': 'TP HIT', 'exit_time': t + 60000, 'exit_price': fill, 'gross': g, 'fee_out': fo,
                           'pnl': g - p['fee_in'] - fo - p['fund']})
    c = {s: b[4] for s, b in bars.items()}
    eq = wallet + sum(upnl(p, c[p['coin']]) for p in pos)
    peak = max(peak, eq); hi = max(hi, eq); lo = min(lo, eq); maxdd = max(maxdd, peak - eq)
    curve.append((t + 60000, eq, len(pos)))
last = {s: data[s]['m1'][END - 60000][4] for s in data}
for p in list(pos):
    fill = last[p['coin']] * (1 - p['dir'] * SLIP); g = upnl(p, fill); fo = FEE * p['qty'] * fill
    p['liq_now'] = liq_price(p, last)
    trades.append({**p, 'result': 'STILL OPEN', 'exit_time': None, 'exit_price': last[p['coin']], 'gross': g, 'fee_out': fo,
                   'pnl': g - p['fee_in'] - fo - p['fund']})
# liquidated trade P&L: whole account equity was lost; allocate the loss to each position = its own -(margin side) for display
for tr in trades:
    if tr['result'] == 'LIQUIDATED': tr['pnl'] = tr['gross'] - tr['fee_in'] - tr['fund']
out = dict(scenario=SCEN, start=START, end=END, trades=trades, skipped=skipped, sigcount=sigcount, events=len(events),
           wallet=wallet, fees=fees, funding=fund_total, maxslots=maxslots, hi=hi, lo=lo, maxdd=maxdd, min_upnl=min_upnl,
           liq_events=liq_events, curve=curve[::30], brackets={s: BR[s][0] for s in BR})
json.dump(out, open(f"/tmp/r70/out{SCEN}.json", "w"))
print(SCEN, "signals", len(events), "trades", len(trades), collections.Counter(x['result'] for x in trades),
      collections.Counter(x['reason'] for x in skipped), "wallet %.4f fees %.4f fund %.4f slots %d lo %.3f hi %.3f dd %.3f liq %s" %
      (wallet, fees, fund_total, maxslots, lo, hi, maxdd, liq_events))
