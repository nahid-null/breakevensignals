"""prompt-68 causal indicators (value at index i uses bars 0..i only). Offline research only."""
def rma(x, n):
    out = [None]*len(x); s = None
    for i, v in enumerate(x):
        if i == n-1: s = sum(x[:n])/n
        elif i >= n: s = (s*(n-1) + v)/n
        out[i] = s
    return out
def ema(x, n):
    out = [None]*len(x); a = 2/(n+1); s = None
    for i, v in enumerate(x):
        if i == n-1: s = sum(x[:n])/n
        elif i >= n: s = a*v + (1-a)*s
        out[i] = s
    return out
def sma(x, n):
    out = [None]*len(x); acc = 0.0
    for i, v in enumerate(x):
        acc += v
        if i >= n: acc -= x[i-n]
        if i >= n-1: out[i] = acc/n
    return out
def rsi(C, n=14):
    up = [0.0] + [max(C[i]-C[i-1], 0) for i in range(1, len(C))]; dn = [0.0] + [max(C[i-1]-C[i], 0) for i in range(1, len(C))]
    ru, rd = rma(up[1:], n), rma(dn[1:], n); out = [None]
    for u, d in zip(ru, rd): out.append(None if u is None else (100.0 if d == 0 else 100 - 100/(1+u/d)))
    return out
def adx(H, L, C, n=14):
    N = len(C); tr = [H[0]-L[0]]; pdm = [0.0]; mdm = [0.0]
    for i in range(1, N):
        tr.append(max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])))
        u, d = H[i]-H[i-1], L[i-1]-L[i]
        pdm.append(u if u > d and u > 0 else 0.0); mdm.append(d if d > u and d > 0 else 0.0)
    atr = rma(tr, n); sp = rma(pdm, n); sm = rma(mdm, n)
    pdi = [None]*N; mdi = [None]*N; dx = [None]*N
    for i in range(N):
        if atr[i]:
            pdi[i] = 100*sp[i]/atr[i]; mdi[i] = 100*sm[i]/atr[i]; s = pdi[i]+mdi[i]
            dx[i] = 100*abs(pdi[i]-mdi[i])/s if s else 0.0
    first = next(i for i, v in enumerate(dx) if v is not None)
    a = rma(dx[first:], n); adxv = [None]*first + a
    return adxv, pdi, mdi, atr
def pivots(H, L, n):
    """confirmed pivots: (confirm_index, pivot_index, price) — a pivot at c is known only at c+n."""
    hi, lo = [], []
    for c in range(n, len(H)-n):
        if all(H[c] > H[i] for i in range(c-n, c+n+1) if i != c): hi.append((c+n, c, H[c]))
        if all(L[c] < L[i] for i in range(c-n, c+n+1) if i != c): lo.append((c+n, c, L[c]))
    return hi, lo
