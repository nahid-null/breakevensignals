"""prompt-68 copy of research/prompt-61/ob61.py with ONE addition: an optional `snap` list that records the active order blocks after each bar (read-only, used by the offline filter study for opposing-OB distance). Signal logic is byte-identical otherwise.
Original docstring: prompt-61: line-by-line port of the signal part of the uploaded 'OB STRONG Entry Signals (Long/Short)' Pine v6 script
(research/prompt-61/OB_STRONG_Entry_Signals.pine, default inputs). Drawing code is not ported (limitToNearest = false, so every
logged signal keeps its label). Offline research only: never imported by the website, worker, SQL or Telegram."""
import math
SWING = 5; NBINS = 40; MAX_OBS = 50; SPACING_LOG = 4
MIN_SCORE = 5; MIN_WICK = 40.0; VOL_LEN = 20; VOL_MULT = 1.2; EMA_LEN = 100; MAX_RISK_ATR = 3.0; MIN_DELTA = 55.0; RR = 2.0

def pivot(H, L, b, kind):
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
    minP = min(L[f:t+1]); maxP = max(H[f:t+1])
    if not (minP < maxP): return None
    step = (maxP - minP) / NBINS
    diff = [0.0]*NBINS
    for i in range(f, t+1):
        s = int((L[i]-minP)//step); e = int((H[i]-minP)//step)
        s = min(max(s, 0), NBINS-1); e = min(max(e, 0), NBINS-1)
        diff[s] += 1.0
        if e+1 < NBINS: diff[e+1] -= 1.0
    best, bestc, run = 0, 0.0, 0.0
    for i in range(NBINS):
        run += diff[i]
        if run > bestc: bestc, best = run, i
    return minP + (best + 0.5)*step

def vol_at(H, L, VT, VB, VS, f, t, poc):
    """volumeAtPrice: touches and chart-timeframe volumes (vdTfIn = '' -> bull = volume if close>open, bear if close<open)."""
    k = tv = bv = sv = 0
    if poc is None or t - f < 0: return 0, 0.0, 0.0, 0.0
    for i in range(f, t+1):
        if L[i] <= poc and H[i] >= poc: k += 1; tv += VT[i]; bv += VB[i]; sv += VS[i]
    return k, tv, bv, sv

def has_gap(H, L, a, bos, bull):
    f, t = min(a, bos), max(a, bos)
    for i in range(f+1, t+1):
        if bull and L[i] > H[i-1]: return True
        if not bull and H[i] < L[i-1]: return True
    return False

def pine_round(x): return math.floor(x + 0.5)

def series(H, L, C, V):
    n = len(C)
    tr = [H[0]-L[0]] + [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1, n)]
    atr = [None]*n; ema = [None]*n; vma = [None]*n
    for i in range(n):   # ta.atr(14) = RMA seeded by SMA; ta.ema seeded by SMA; ta.sma
        if i == 13: atr[i] = sum(tr[:14])/14
        elif i > 13: atr[i] = (atr[i-1]*13 + tr[i])/14
        if i == EMA_LEN-1: ema[i] = sum(C[:EMA_LEN])/EMA_LEN
        elif i >= EMA_LEN: a = 2/(EMA_LEN+1); ema[i] = a*C[i] + (1-a)*ema[i-1]
        if i >= VOL_LEN-1: vma[i] = sum(V[i-VOL_LEN+1:i+1])/VOL_LEN
    return atr, ema, vma

class OB:
    __slots__ = ('left','created','top','bottom','bull','active','retested','has_delta','bull_pct','bear_pct')

def run(O, H, L, C, V, upto=None, all_retests=False, snap=None):
    """Returns events (score >= MIN_SCORE signals): bar = bar the alert fires on, retest_bar = signal candle (bar-1),
    entry = close of the signal candle, sl/tp/score as the label shows. all_retests=True also returns the
    spacing-allowed retests below the score threshold (for the report only, never traded)."""
    n = len(C) if upto is None else upto
    VT = V; VB = [V[i] if C[i] > O[i] else 0.0 for i in range(len(C))]; VS = [V[i] if C[i] < O[i] else 0.0 for i in range(len(C))]
    atr, ema, vma = series(H, L, C, V)
    obs = []; events = []; weak = []
    last_bull = last_bear = None; shP = shI = slP = slI = None
    sl_end = [None]*n; sh_end = [None]*n; bbn = [False]*n; bun = [False]*n
    def add(best, top, bot, bull, tv, bv, sv, created):
        o = OB(); o.left, o.created, o.top, o.bottom, o.bull = best, created, top, bot, bull
        o.active, o.retested = True, False; o.has_delta = tv > 0.0
        o.bull_pct = pine_round(bv/tv*100.0) if o.has_delta else 50.0; o.bear_pct = 100.0 - o.bull_pct if o.has_delta else 50.0
        obs.insert(0, o)
    for b in range(n):
        ph = pivot(H, L, b, 'h'); pl = pivot(H, L, b, 'l')
        if ph is not None: shP, shI = ph, b - SWING
        if pl is not None: slP, slI = pl, b - SWING
        bbn[b] = slP is not None and b > slI and b >= 1 and C[b] < slP and C[b-1] >= slP
        bun[b] = shP is not None and b > shI and b >= 1 and C[b] > shP and C[b-1] <= shP
        def prune():
            minLeft = max(0, b - 4999)
            obs[:] = [o for o in obs if not o.left < minLeft]
            while len(obs) > MAX_OBS:
                for j in range(len(obs)-1, -1, -1):
                    if not obs[j].active: del obs[j]; break
                else: obs.pop()
        def overlaps(top, bot):
            zT, zB = max(top, bot), min(top, bot)
            return any(o.active and zT >= min(o.top, o.bottom) and zB <= max(o.top, o.bottom) for o in obs)
        for bear in (True, False):
            if not (b >= 1 and (bbn if bear else bun)[b-1]): continue
            bos = b - 1; f = (sl_end if bear else sh_end)[b-1]; t = b - 1
            poc = most_touched(H, L, f, t) if f is not None else None
            k, tv, bv, sv = vol_at(H, L, VT, VB, VS, f, t, poc) if poc is not None else (0, 0, 0, 0)
            if poc is not None and k > 0:
                best = None; ext = None
                for idx in range(t, f-1, -1):
                    if bear:
                        ext = H[idx] if ext is None else max(ext, H[idx]); ok = H[idx] == ext
                    else:
                        ext = L[idx] if ext is None else min(ext, L[idx]); ok = L[idx] == ext
                    if L[idx] <= poc and H[idx] >= poc and ok: best = idx
                if best is not None and not has_gap(H, L, best, bos, not bear) and not overlaps(H[best], L[best]):
                    add(best, H[best], L[best], not bear, tv, bv, sv, bos); prune()
            if bear: slP = slI = None
            else: shP = shI = None
        for o in obs:
            if not o.active: continue
            invalid = (L[b] < o.bottom) if o.bull else (H[b] > o.top)
            if invalid: o.active = False
            if b == 0: continue
            j = b - 1
            if o.bull: rt = O[j] > o.top and C[j] > o.top and L[j] <= o.top and L[j] >= o.bottom
            else:      rt = O[j] < o.bottom and C[j] < o.bottom and H[j] >= o.bottom and H[j] <= o.top
            if not (rt and j > o.created): continue
            first = not o.retested; o.retested = True
            last = last_bull if o.bull else last_bear
            if not (last is None or j - last >= SPACING_LOG): continue
            o1, h1, l1, c1 = O[j], H[j], L[j], C[j]; rng = h1 - l1
            dir_ok = c1 > o1 if o.bull else c1 < o1
            wick = (min(o1, c1) - l1) if o.bull else (h1 - max(o1, c1)); wpct = wick/rng*100.0 if rng > 0 else 0.0
            s1 = dir_ok and wpct >= MIN_WICK
            s2 = vma[j] is not None and vma[j] > 0 and V[j] >= vma[j]*VOL_MULT
            s3 = ema[j] is not None and (c1 > ema[j] if o.bull else c1 < ema[j])
            s4 = first
            slp = o.bottom if o.bull else o.top; risk = abs(c1 - slp)
            s5 = atr[j] is not None and atr[j] > 0 and risk > 0 and risk <= MAX_RISK_ATR*atr[j]
            s6 = o.has_delta and ((o.bull_pct if o.bull else o.bear_pct) >= MIN_DELTA)
            parts = [s1, s2, s3, s4, s5, s6]; score = sum(parts)
            ev = dict(bar=b, retest_bar=j, side='LONG' if o.bull else 'SHORT', entry=c1, sl=slp,
                      tp=c1 + risk*RR if o.bull else c1 - risk*RR, score=score, parts=parts, ob_top=o.top, ob_bottom=o.bottom, ob_created=o.created)
            if score >= MIN_SCORE:
                events.append(ev)
                if o.bull: last_bull = j
                else: last_bear = j
            elif all_retests: weak.append(ev)
        sl_end[b] = slI; sh_end[b] = shI
        if snap is not None: snap.append(tuple((o.top, o.bottom, o.bull) for o in obs if o.active))
    return (events, weak) if all_retests else events
