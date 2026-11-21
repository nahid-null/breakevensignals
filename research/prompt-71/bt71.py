"""prompt-71: CSTF v4 Strong Trend on Binance USD-M Futures 30m candles, ONE shared $10 CROSS-margin account,
7 slots x $0.50 fixed margin (5% of initial $10), 75x, no stop loss, +20% of margin NET target ($0.10 after fees+funding),
1m exits on last price, cross-margin liquidation on 1m MARK price with Binance tier maintenance margin, real funding.
Offline research only: never imported by the website, worker, SQL or Telegram.
Usage: python3 bt71.py [MAIN|LOT]   MAIN = exact $0.50 margin; LOT = quantity rounded down to Binance lot step."""
import json, sys, collections, math, hashlib
sys.path.insert(0, "/dev-server/research/prompt-71")
from cstf71 import run
SYMS = "ZEN GALA S ETH SOL XRP LINK NEAR BCH LTC ADA AVAX TRX BNB UNI WLD WIF CRV EGLD FIL SAND HBAR".split()
SCEN = sys.argv[1] if len(sys.argv) > 1 else "MAIN"
R = "/tmp/r71/raw"; M = json.load(open(f"{R}/meta.json")); START, END = M['start'], M['end']
BR = json.load(open(f"{R}/brackets.json")); EX = json.load(open(f"{R}/exinfo.json"))
FEE, SLIP, LEV, MARGIN, SLOTS, TP_NET, BAL0 = 0.0005, 0.0002, 75, 0.50, 7, 0.10, 10.0
def bracket(s, notional):
    for r in BR[s]:
        if r['bracketNotionalFloor'] <= notional < r['bracketNotionalCap']: return r
    return BR[s][-1]
def step(s):
    f = {x['filterType']: x for x in EX[s]['filters']}; return float(f['LOT_SIZE']['stepSize']), float(f['MIN_NOTIONAL']['notional'])
data = {}; events = []; sigcount = collections.Counter(); hashes = {}
for c in SYMS:
    s = c + "USDT"; raw = open(f"{R}/{s}.json", "rb").read(); hashes[s] = hashlib.sha256(raw).hexdigest()
    d = json.loads(raw); k = d['m30']
    T = [x[0] for x in k]; assert all(T[i+1] - T[i] == 1800000 for i in range(len(T) - 1)), s
    O, H, L, C, V = [[x[i] for x in k] for i in range(1, 6)]
    m1 = d['m1']; assert len(m1) == 10080 and m1[0][0] == START, s
    mk = json.load(open(f"{R}/{s}.mark.json")); assert len(mk) == 10080 and mk[0][0] == START, s
    data[s] = dict(m1={x[0]: x for x in m1}, mark={x[0]: x for x in mk}, fund=collections.defaultdict(list))
    for f in d['funding']:
        data[s]['fund'][int(f['fundingTime']) // 60000 * 60000].append(float(f['fundingRate']))
    for e in run(O, H, L, C, V):
        t = T[e['bar']] + 1800000            # signal candle closed (barstate.isconfirmed) -> enter at the next 1m open
        if START <= t < END:
            events.append(dict(coin=s, side=e['side'], pattern=e['pattern'], signal_time=T[e['bar']], confirm_time=t, sig_close=e['close'])); sigcount[s] += 1
events.sort(key=lambda e: (e['confirm_time'], e['coin']))
byt = collections.defaultdict(list)
for e in events: byt[e['confirm_time']].append(e)
wallet = BAL0; pos = []; trades = []; skipped = []; curve = []
fees = fund_total = 0.0; maxslots = 0; peak = BAL0; maxdd = 0.0; hi = BAL0; lo = BAL0; liq_events = []
def upnl(p, px): return p['dir'] * p['qty'] * (px - p['entry'])
def mm(p, px):
    n = p['qty'] * px; b = bracket(p['coin'], n); return n * b['bracketMaintenanceMarginRate'] - b['cumFastMaintenanceAmount']
def liq_price(p, px):
    """Binance cross-margin liquidation price of one position, other open positions held at px (mark)."""
    oth = [q for q in pos if q is not p]
    u = sum(upnl(q, px[q['coin']]) for q in oth); t = sum(mm(q, px[q['coin']]) for q in oth)
    b = bracket(p['coin'], p['qty'] * p['entry']); mmr, cum = b['bracketMaintenanceMarginRate'], b['cumFastMaintenanceAmount']
    q, d = p['qty'], p['dir']
    return max((wallet - t + u + cum - d * q * p['entry']) / (q * mmr - d * q), 0.0)
def tp_price(p, need):
    q, ent = p['qty'], p['entry']
    return (need + q * ent) / (q * (1 - FEE)) / (1 - SLIP) if p['dir'] > 0 else (q * ent - need) / (q * (1 + FEE)) / (1 + SLIP)
seq = 0
for t in range(START, END, 60000):
    bars = {s: data[s]['m1'][t] for s in data}; marks = {s: data[s]['mark'][t] for s in data}
    o = {s: b[1] for s, b in bars.items()}; mo = {s: b[1] for s, b in marks.items()}
    for p in pos:                                     # 1) funding (paid on mark price)
        for rate in data[p['coin']]['fund'].get(t, []):
            f = p['dir'] * p['qty'] * mo[p['coin']] * rate; p['fund'] += f; wallet -= f; fund_total += f
    for e in byt.get(t, []):                          # 2) entries at this minute's open
        s = e['coin']; seq += 1; e['seq'] = seq
        if len(pos) >= SLOTS: skipped.append({**e, 'reason': 'ALL 7 SLOTS OCCUPIED'}); continue
        d = 1 if e['side'] == 'LONG' else -1; ent = o[s] * (1 + SLIP * d); q = MARGIN * LEV / ent
        if SCEN == "LOT":
            st, mn = step(s); q = math.floor(q / st + 1e-9) * st
            if q * ent < mn or q <= 0: skipped.append({**e, 'reason': 'BELOW BINANCE MIN ORDER'}); continue
        fee_in = FEE * q * ent; margin = q * ent / LEV
        equity = wallet + sum(upnl(p, mo[p['coin']]) for p in pos)
        if equity - sum(p['margin'] for p in pos) < margin + fee_in: skipped.append({**e, 'reason': 'INSUFFICIENT AVAILABLE MARGIN'}); continue
        wallet -= fee_in; fees += fee_in
        p = dict(seq=seq, coin=s, side=e['side'], dir=d, pattern=e['pattern'], signal_time=e['signal_time'], entry_time=t, entry=ent, qty=q,
                 margin=margin, lev=LEV, fee_in=fee_in, fund=0.0)
        pos.append(p); p['liq_at_entry'] = liq_price(p, mo); p['tp_at_entry'] = tp_price(p, TP_NET + fee_in)
    maxslots = max(maxslots, len(pos))
    if pos:                                           # 3) cross-margin liquidation at every position's worst MARK price this minute
        wpx = {id(p): (marks[p['coin']][3] if p['dir'] > 0 else marks[p['coin']][2]) for p in pos}
        ueq = sum(upnl(p, wpx[id(p)]) for p in pos); tmm = sum(mm(p, wpx[id(p)]) for p in pos)
        weq = wallet + ueq; lo = min(lo, weq); maxdd = max(maxdd, peak - weq)
        if weq <= tmm:
            liq_events.append(dict(time=t, positions=len(pos), equity=weq, maint=tmm))
            for p in pos:
                px = bars[p['coin']][3] if p['dir'] > 0 else bars[p['coin']][2]
                trades.append({**p, 'result': 'LIQUIDATED', 'exit_time': t + 60000, 'exit_price': wpx[id(p)], 'gross': upnl(p, wpx[id(p)]), 'fee_out': 0.0})
            wallet = 0.0; pos = []                    # liquidation clearance takes the remaining collateral
    for p in list(pos):                               # 4) take-profit on last price (target re-solved incl. funding paid)
        h, l = bars[p['coin']][2], bars[p['coin']][3]
        p['tp'] = tp_price(p, TP_NET + p['fee_in'] + p['fund'])
        if (p['dir'] > 0 and h >= p['tp']) or (p['dir'] < 0 and l <= p['tp']):
            fill = p['tp'] * (1 - p['dir'] * SLIP); g = upnl(p, fill); fo = FEE * p['qty'] * fill
            wallet += g - fo; fees += fo; pos.remove(p)
            trades.append({**p, 'result': 'TP HIT', 'exit_time': t + 60000, 'exit_price': fill, 'gross': g, 'fee_out': fo})
    mc = {s: b[4] for s, b in marks.items()}
    eq = wallet + sum(upnl(p, mc[p['coin']]) for p in pos)
    peak = max(peak, eq); hi = max(hi, eq); lo = min(lo, eq); maxdd = max(maxdd, peak - eq)
    curve.append((t + 60000, eq, len(pos), wallet))
last = {s: data[s]['m1'][END - 60000][4] for s in data}; lastm = {s: data[s]['mark'][END - 60000][4] for s in data}
for p in list(pos):
    fill = last[p['coin']] * (1 - p['dir'] * SLIP); g = upnl(p, fill); fo = FEE * p['qty'] * fill
    p['liq_now'] = liq_price(p, lastm)
    trades.append({**p, 'result': 'STILL OPEN', 'exit_time': None, 'exit_price': last[p['coin']], 'gross': g, 'fee_out': fo})
for tr in trades: tr['pnl'] = tr['gross'] - tr['fee_in'] - tr['fee_out'] - tr['fund']
trades.sort(key=lambda x: x['seq'])
out = dict(scenario=SCEN, start=START, end=END, events=events, trades=trades, skipped=skipped, sigcount=sigcount, wallet=wallet, fees=fees,
           funding=fund_total, maxslots=maxslots, hi=hi, lo=lo, maxdd=maxdd, liq_events=liq_events, curve=curve, hashes=hashes,
           final_equity=curve[-1][1], brackets={s: BR[s][0] for s in BR})
json.dump(out, open(f"/tmp/r71/out{SCEN}.json", "w"))
print(SCEN, "signals", len(events), "opened", len(trades), collections.Counter(x['result'] for x in trades), collections.Counter(x['reason'] for x in skipped),
      "wallet %.4f equity %.4f fees %.4f fund %.4f maxslots %d lo %.3f hi %.3f dd %.3f" % (wallet, curve[-1][1], fees, fund_total, maxslots, lo, hi, maxdd), liq_events)
