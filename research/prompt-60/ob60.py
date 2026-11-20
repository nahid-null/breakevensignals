"""prompt-60: line-by-line port of the signal part of the uploaded 'OB Entry Signals (Long/Short)' Pine v6 script
(research/prompt-60/OB_Entry_Signals.pine, default inputs). Drawing code is not ported, except the final
label-visibility filter (drawRetestLabels), which is used only to show which signals TradingView still displays.
Offline research only: never imported by the website, worker, SQL or Telegram."""
SWING = 5          # swingLen
NBINS = 40         # calcMostTouchedPriceVol(..., 40)
MAX_OBS = 50       # MAX_STORED_OBS
SHOW_NEAREST = 3   # showNearestX
SPACING_LOG = 4    # retestBar - lastSideBar >= 4
SPACING_LBL = 3    # labels closer than 3 bars are not drawn

def pivot(H, L, b, kind):
    """ta.pivothigh/pivotlow(len,len) at bar b (centre b-len): equal left values allowed, equal right values reject
    (same rule as the verified live port src/lib/engine/ob-vp.ts)."""
    n = SWING
    if b < 2*n: return None
    c = b - n
    if kind == 'h':
        v = H[c]
        return v if all(H[i] <= v for i in range(c-n, c)) and all(H[i] < v for i in range(c+1, b+1)) else None
    v = L[c]
    return v if all(L[i] >= v for i in range(c-n, c)) and all(L[i] > v for i in range(c+1, b+1)) else None

def most_touched(H, L, f, t):
    if f is None or t is None or t - f <= 0: return None
    minP, maxP = 1e10, -1e10
    for i in range(f, t+1):
        if L[i] < minP: minP = L[i]
        if H[i] > maxP: maxP = H[i]
    if not (minP < maxP): return None
    step = (maxP - minP) / NBINS
    diff = [0.0]*NBINS
    for i in range(f, t+1):
        s = int((L[i]-minP)//step); e = int((H[i]-minP)//step)
        s = 0 if s < 0 else NBINS-1 if s > NBINS-1 else s
        e = 0 if e < 0 else NBINS-1 if e > NBINS-1 else e
        diff[s] += 1.0
        if e+1 < NBINS: diff[e+1] -= 1.0
    best, bestc, run = 0, 0.0, 0.0
    for i in range(NBINS):
        run += diff[i]
        if run > bestc: bestc, best = run, i
    return minP + (best + 0.5)*step

def touches_at(H, L, f, t, poc):
    return sum(1 for i in range(f, t+1) if L[i] <= poc and H[i] >= poc) if poc is not None and t - f >= 0 else 0

def has_gap(H, L, a, bos, bull):
    f, t = min(a, bos), max(a, bos)
    for i in range(f+1, t+1):
        if i-1 < 0: continue
        if bull and L[i] > H[i-1]: return True
        if not bull and H[i] < L[i-1]: return True
    return False

class OB:
    __slots__ = ('left', 'created', 'top', 'bottom', 'bull', 'active', 'invalid_idx')
    def __init__(s, left, created, top, bottom, bull):
        s.left, s.created, s.top, s.bottom, s.bull, s.active, s.invalid_idx = left, created, top, bottom, bull, True, None

def run(O, H, L, C, upto=None):
    """Runs the script over bars 0..upto-1. Returns (events, state). events: list of dicts with
    bar = index of the bar on which the script fires the alert, retest_bar = bar the label sits on (bar-1),
    entry = close of retest_bar (evEntryPrice), side LONG/SHORT, ob = (leftIndex, createdIndex)."""
    n = len(C) if upto is None else upto
    obs = []; retests = []; events = []
    last_bull = last_bear = None
    shP = shI = slP = slI = None
    sl_end = [None]*n; sh_end = [None]*n; bos_bear_now = [False]*n; bos_bull_now = [False]*n
    for b in range(n):
        ph = pivot(H, L, b, 'h'); pl = pivot(H, L, b, 'l')
        if ph is not None: shP, shI = ph, b - SWING
        if pl is not None: slP, slI = pl, b - SWING
        bos_bear_now[b] = slP is not None and b > slI and b >= 1 and C[b] < slP and C[b-1] >= slP
        bos_bull_now[b] = shP is not None and b > shI and b >= 1 and C[b] > shP and C[b-1] <= shP
        bos_bear = b >= 1 and bos_bear_now[b-1]
        bos_bull = b >= 1 and bos_bull_now[b-1]

        def prune():
            minLeft = max(0, b - 4999)
            obs[:] = [o for o in obs if not o.left < minLeft]
            while len(obs) > MAX_OBS:
                for j in range(len(obs)-1, -1, -1):
                    if not obs[j].active: del obs[j]; break
                else:
                    obs.pop()
        def overlaps(top, bot):
            zT, zB = max(top, bot), min(top, bot)
            return any(o.active and zT >= min(o.top, o.bottom) and zB <= max(o.top, o.bottom) for o in obs)

        if bos_bear:
            bos = b - 1; f = sl_end[b-1]; t = b - 1
            poc = most_touched(H, L, f, t) if f is not None else None
            if poc is not None and touches_at(H, L, f, t, poc) > 0:
                best = None; runmax = None
                for idx in range(t, f-1, -1):
                    runmax = H[idx] if runmax is None else max(runmax, H[idx])
                    if L[idx] <= poc and H[idx] >= poc and H[idx] == runmax: best = idx
                if best is not None and not has_gap(H, L, best, bos, False):
                    if not overlaps(H[best], L[best]):
                        obs.insert(0, OB(best, bos, H[best], L[best], False)); prune()
            slP = slI = None
        if bos_bull:
            bos = b - 1; f = sh_end[b-1]; t = b - 1
            poc = most_touched(H, L, f, t) if f is not None else None
            if poc is not None and touches_at(H, L, f, t, poc) > 0:
                best = None; runmin = None
                for idx in range(t, f-1, -1):
                    runmin = L[idx] if runmin is None else min(runmin, L[idx])
                    if L[idx] <= poc and H[idx] >= poc and L[idx] == runmin: best = idx
                if best is not None and not has_gap(H, L, best, bos, True):
                    if not overlaps(H[best], L[best]):
                        obs.insert(0, OB(best, bos, H[best], L[best], True)); prune()
            shP = shI = None

        for o in obs:
            if not o.active: continue
            invalid = (L[b] < o.bottom) if o.bull else (H[b] > o.top)   # invMethod = "Wick"
            if invalid: o.active = False; o.invalid_idx = b
            if b > 0:
                if o.bull: rt = O[b-1] > o.top and C[b-1] > o.top and L[b-1] <= o.top and L[b-1] >= o.bottom
                else:      rt = O[b-1] < o.bottom and C[b-1] < o.bottom and H[b-1] >= o.bottom and H[b-1] <= o.top
                if rt and b - 1 > o.created:
                    rb = b - 1; last = last_bull if o.bull else last_bear
                    if last is None or rb - last >= SPACING_LOG:
                        retests.insert(0, (rb, o.bull, o.left, o.created))
                        events.append(dict(bar=b, retest_bar=rb, side='LONG' if o.bull else 'SHORT', entry=C[rb],
                                           ob_left=o.left, ob_created=o.created, ob_top=o.top, ob_bottom=o.bottom,
                                           invalidated_same_bar=invalid))
                        if o.bull: last_bull = rb
                        else: last_bear = rb
        sl_end[b] = slI; sh_end[b] = shI
    return events, dict(obs=obs, retests=retests, last=n-1, C=C)

def visible_labels(state):
    """drawRetestLabels on the last bar (hideInvalid = true): a label stays on the chart only if its parent OB is one of the
    3 nearest ACTIVE OBs of its side at the chart's last bar."""
    obs, b, close = state['obs'], state['last'], state['C'][state['last']]
    def nearest(bull):
        c = [(max(close - o.top, o.bottom - close, 0.0) if not (o.bottom <= close <= o.top) else 0.0, i) for i, o in enumerate(obs) if o.bull == bull and o.active]
        out = []
        for d, i in c:   # insertBest: stable, strictly-less inserts before
            pos = len(out)
            for j, (dj, _) in enumerate(out):
                if d < dj: pos = j; break
            out.insert(pos, (d, i)); out = out[:SHOW_NEAREST]
        return [(obs[i].left, obs[i].created) for _, i in out]
    act = {True: set(nearest(True)), False: set(nearest(False))}
    shown = set(); last = {True: None, False: None}
    for rb, bull, left, created in reversed(state['retests']):
        if rb < b - 4999 or rb > b: continue
        if (left, created) not in act[bull]: continue
        if last[bull] is not None and rb - last[bull] < SPACING_LBL: continue
        last[bull] = rb; shown.add((rb, bull))
    return shown
