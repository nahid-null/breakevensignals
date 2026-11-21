"""prompt-71: line-by-line Python port of the attached Pine v5 indicator
"Candle Signals - Trend Filter (3m)" v4 Strong Trend (CSTF), default inputs.
Offline research only: never imported by the website, worker, SQL or Telegram.
Comparisons follow Pine's nine-fractional-digit operand rounding (see src/lib/engine/pine-numbers.ts)."""
import math
NA = None
def pn(x): return round(x * 1e9) / 1e9 if abs(x) * 1e9 < 9007199254740991 else x
def gt(a, b): return a is not NA and b is not NA and pn(a) > pn(b)
def lt(a, b): return a is not NA and b is not NA and pn(a) < pn(b)
def ge(a, b): return a is not NA and b is not NA and pn(a) >= pn(b)
def le(a, b): return a is not NA and b is not NA and pn(a) <= pn(b)

# default inputs (unchanged from the script)
emaFastLen, emaSlowLen, sideFilter = 20, 50, 0.15
longMult, smallMult, minRange = 0.8, 0.6, 0.5
strictGap = strictWicks = False
usePB, pbLen, useVol, volMult, needConfirm = False, 9, False, 1.0, False
useEmaFilter, emaSlopeLen, fastSlopeMin, slowSlopeMin, minEmaSep, noCrossBars = True, 5, 0.05, 0.02, 0.30, 5
useStrong, strLen, strFastSlope, strSlowSlope, strSep, strConsist, strShrink = True, 10, 0.10, 0.05, 0.60, 90, 0.90
strParMin, strParMax, strAge, useAngle, strAngle = 0.40, 2.50, 20, True, 5.0

def sma(x, n):
    out = [NA] * len(x)
    for i in range(n - 1, len(x)):
        w = x[i - n + 1:i + 1]
        if all(v is not NA for v in w): out[i] = sum(w) / n
    return out
def ema(x, n):      # Pine ta.ema: na until n values, seeded with their SMA
    out = [NA] * len(x); a = 2 / (n + 1)
    for i in range(len(x)):
        if i == n - 1: out[i] = sum(x[:n]) / n
        elif i >= n: out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out
def rma(x, n):
    out = [NA] * len(x); a = 1 / n
    for i in range(len(x)):
        if i == n - 1: out[i] = sum(x[:n]) / n
        elif i >= n: out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out

def run(O, H, L, C, V):
    N = len(C)
    tr = [H[0] - L[0]] + [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, N)]
    atr = rma(tr, 14)
    body = [abs(C[i] - O[i]) for i in range(N)]
    rng = [H[i] - L[i] for i in range(N)]
    upW = [H[i] - max(O[i], C[i]) for i in range(N)]
    loW = [min(O[i], C[i]) - L[i] for i in range(N)]
    avgBody = sma(body, 14)
    emaF, emaS = ema(C, emaFastLen), ema(C, emaSlowLen)
    def g(arr, i, k=0): return arr[i - k] if i - k >= 0 else NA
    isBull = lambda i: i >= 0 and gt(C[i], O[i])
    isBear = lambda i: i >= 0 and lt(C[i], O[i])
    longB = lambda i: i >= 0 and avgBody[i] is not NA and ge(body[i], avgBody[i] * longMult)
    smallB = lambda i: i >= 0 and avgBody[i] is not NA and le(body[i], avgBody[i] * smallMult)
    lastCross = NA; upq = []; dnq = []; events = []
    for i in range(N):
        a = atr[i]; F, S = emaF[i], emaS[i]
        # ta.cross on every bar (barssince must be updated each bar)
        if i >= 1 and F is not NA and S is not NA and emaF[i-1] is not NA and emaS[i-1] is not NA:
            if (gt(F, S) and le(emaF[i-1], emaS[i-1])) or (lt(F, S) and ge(emaF[i-1], emaS[i-1])): lastCross = i
        barsCross = NA if lastCross is NA else i - lastCross
        up = 1 if (i >= 1 and gt(F, emaF[i-1]) and gt(S, emaS[i-1])) else 0
        dn = 1 if (i >= 1 and lt(F, emaF[i-1]) and lt(S, emaS[i-1])) else 0
        upq.append(up if (i >= 1 and F is not NA and emaF[i-1] is not NA and S is not NA and emaS[i-1] is not NA) else NA)
        dnq.append(dn if upq[-1] is not NA else NA)
        if a is NA or F is NA or S is NA or i < strLen + 2 or avgBody[i] is NA or emaS[i - strLen] is NA: continue
        tol = a * 0.1; sizeOK = ge(rng[i], a * minRange)
        midPrev = (O[i-1] + C[i-1]) / 2; mid2 = (O[i-2] + C[i-2]) / 2
        gapOK = gt(abs(F - S), a * sideFilter)
        trend = 1 if (gt(F, S) and gt(C[i], S) and gapOK) else (-1 if (lt(F, S) and lt(C[i], S) and gapOK) else 0)
        fastSlope = (F - emaF[i-emaSlopeLen]) / emaSlopeLen; slowSlope = (S - emaS[i-emaSlopeLen]) / emaSlopeLen
        emaSepOK = ge(abs(F - S), a * minEmaSep)
        noRecentX = noCrossBars == 0 or barsCross is NA or barsCross > noCrossBars
        emaBullOK = gt(F, S) and gt(F, emaF[i-1]) and gt(S, emaS[i-1]) and ge(fastSlope, a*fastSlopeMin) and ge(slowSlope, a*slowSlopeMin) and emaSepOK and noRecentX
        emaBearOK = lt(F, S) and lt(F, emaF[i-1]) and lt(S, emaS[i-1]) and le(fastSlope, -a*fastSlopeMin) and le(slowSlope, -a*slowSlopeMin) and emaSepOK and noRecentX
        sF = (F - emaF[i-strLen]) / strLen / a; sS = (S - emaS[i-strLen]) / strLen / a
        sGap = abs(F - S); sHalf = max(1, int(strLen / 2)); sGapH = abs(emaF[i-sHalf] - emaS[i-sHalf])
        wu = upq[i-strLen+1:i+1]; wd = dnq[i-strLen+1:i+1]
        upC = NA not in wu and ge(sum(wu), strLen * strConsist / 100.0)
        dnC = NA not in wd and ge(sum(wd), strLen * strConsist / 100.0)
        sGapOK = ge(sGap, a * strSep); sNoShrink = ge(sGap, sGapH * strShrink)
        sPar = ge(abs(sS), abs(sF) * strParMin) and le(abs(sS), abs(sF) * strParMax)
        sAgeOK = strAge == 0 or barsCross is NA or barsCross >= strAge
        sAngleOK = (not useAngle) or ge(math.atan(abs(sF)) * 180.0 / math.pi, strAngle)
        strongBull = gt(F, S) and ge(sF, strFastSlope) and ge(sS, strSlowSlope) and upC and sGapOK and sNoShrink and sPar and sAgeOK and sAngleOK
        strongBear = lt(F, S) and le(sF, -strFastSlope) and le(sS, -strSlowSlope) and dnC and sGapOK and sNoShrink and sPar and sAgeOK and sAngleOK
        b, b1, b2, ab = body[i], body[i-1], body[i-2], avgBody[i]
        o, c, o1, c1, o2, c2 = O[i], C[i], O[i-1], C[i-1], O[i-2], C[i-2]
        pats_b = []; pats_s = []
        if sizeOK and gt(b, 0) and le(b, rng[i]*0.35) and ge(loW[i], 2*b) and le(upW[i], rng[i]*0.2): pats_b.append("Hammer")
        if sizeOK and isBear(i-1) and isBull(i) and le(o, c1) and ge(c, o1) and gt(b, b1): pats_b.append("Bullish Engulfing")
        if isBear(i-2) and longB(i-2) and smallB(i-1) and le(max(o1, c1), o2 - b2*0.4) and isBull(i) and ge(b, ab*0.7) and gt(c, mid2): pats_b.append("Morning Star")
        if isBear(i-1) and longB(i-1) and isBull(i) and (lt(o, L[i-1]) if strictGap else lt(o, c1)) and gt(c, midPrev) and lt(c, o1) and sizeOK: pats_b.append("Piercing Line")
        sold = isBull(i) and isBull(i-1) and isBull(i-2) and ge(b, ab*0.6) and ge(b1, ab*0.6) and ge(body[i-2], ab*0.6) and gt(c, c1) and gt(c1, c2) and gt(o, o1) and gt(o1, o2) and le(o, c1+tol) and le(o1, c2+tol)
        if sizeOK and gt(b, 0) and le(b, rng[i]*0.35) and ge(upW[i], 2*b) and le(loW[i], rng[i]*0.2): pats_s.append("Shooting Star")
        if sizeOK and isBull(i-1) and isBear(i) and ge(o, c1) and le(c, o1) and gt(b, b1): pats_s.append("Bearish Engulfing")
        if isBull(i-2) and longB(i-2) and smallB(i-1) and ge(min(o1, c1), o2 + b2*0.4) and isBear(i) and ge(b, ab*0.7) and lt(c, mid2): pats_s.append("Evening Star")
        if isBull(i-1) and longB(i-1) and isBear(i) and (gt(o, H[i-1]) if strictGap else ge(o, c1 - tol)) and lt(c, midPrev) and gt(c, o1) and sizeOK: pats_s.append("Dark Cloud Cover")
        crows = isBear(i) and isBear(i-1) and isBear(i-2) and ge(b, ab*0.6) and ge(b1, ab*0.6) and ge(body[i-2], ab*0.6) and lt(c, c1) and lt(c1, c2) and lt(o, o1) and lt(o1, o2) and ge(o, c1-tol) and ge(o1, c2-tol)
        if sold: pats_b.append("Three White Soldiers")
        if crows: pats_s.append("Three Black Crows")
        longOK = (not useEmaFilter or emaBullOK) and (not useStrong or strongBull)
        shortOK = (not useEmaFilter or emaBearOK) and (not useStrong or strongBear)
        if trend == 1 and pats_b and longOK: events.append(dict(bar=i, side="LONG", pattern=", ".join(pats_b), close=c, atr=a))
        if trend == -1 and pats_s and shortOK: events.append(dict(bar=i, side="SHORT", pattern=", ".join(pats_s), close=c, atr=a))
    return events
