"""prompt-57 research engine (offline only). Loads verified Binance futures data, computes indicators on closed bars,
labels each candidate entry with realistic fills/costs and runs the 6-slot cross-margin portfolio. Never touches the
live database, worker or Telegram."""
import json, numpy as np, pandas as pd
W = '/tmp/r57/work'
SYMS = "BTC ETH SOL XRP BNB DOGE LINK NEAR BCH LTC ADA AVAX".split()
SYMS = [s + 'USDT' for s in SYMS]
LEV, SLOTS, SHARE = 75, 6, 0.05
FEE, SLIP, R = 0.0005, 0.0002, 0.25
MIN = 60_000
BR = json.load(open(f'{W}/../brackets.json')) if False else None

def ms(d): return pd.Timestamp(d, tz='UTC').value // 10**6

def mmr_of(sym):
    b = json.load(open('/tmp/r57/brackets.json'))[sym][0]
    return b['bracketMaintenanceMarginRate'], b['bracketNotionalCap'], b['maxOpenPosLeverage']

def target_trigger(E, side):
    if side > 0: return E * (1 + FEE + R / LEV) / (1 - FEE) / (1 - SLIP)
    return E * (1 - FEE - R / LEV) / (1 + FEE) / (1 + SLIP)

def emergency_trigger(E, side, k):
    if side > 0: return E * (1 + FEE - k / LEV) / (1 - FEE)
    return E * (1 - FEE + k / LEV) / (1 + FEE)

# ------------------------------------------------------------------ indicators
def ema(x, n):
    a = 2 / (n + 1); out = np.empty_like(x); out[0] = x[0]
    for i in range(1, len(x)): out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out

def rma(x, n):
    out = np.empty_like(x); out[:n] = np.nan; out[n - 1] = np.nanmean(x[:n])
    for i in range(n, len(x)): out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out

def rsi(c, n=14):
    d = np.diff(c, prepend=c[0]); up = rma(np.maximum(d, 0), n); dn = rma(np.maximum(-d, 0), n)
    return 100 - 100 / (1 + up / np.where(dn == 0, 1e-12, dn))

def atr(h, l, c, n=14):
    pc = np.concatenate([[c[0]], c[:-1]])
    return rma(np.maximum(h - l, np.maximum(abs(h - pc), abs(l - pc))), n)

def resample(m, k):
    """m: dict of 1m arrays; returns k-minute bars (open time aligned to multiples of k minutes)."""
    n = len(m['t']) // k * k
    sl = lambda a: a[:n].reshape(-1, k)
    return dict(t=m['t'][:n:k], o=sl(m['o'])[:, 0], h=sl(m['h']).max(1), l=sl(m['l']).min(1), c=sl(m['c'])[:, -1],
                v=sl(m['v']).sum(1), tbv=sl(m['tbv']).sum(1), qv=sl(m['qv']).sum(1))

def htf_on_5m(t5, tH, k, vals):
    """Map HTF values to 5m bars using only HTF bars CLOSED at/before the 5m close. k = HTF minutes."""
    close5 = t5 + 5 * MIN; closeH = tH + k * MIN
    idx = np.searchsorted(closeH, close5, side='right') - 1
    out = np.where(idx >= 0, vals[np.clip(idx, 0, None)], np.nan)
    return out

class Coin:
    def __init__(self, sym):
        z = np.load(f'{W}/{sym}.npz'); self.sym = sym
        self.m = {k: z[k] for k in ['t', 'o', 'h', 'l', 'c', 'v', 'qv', 'tbv', 'mo', 'mh', 'ml', 'mc']}
        self.ft, self.fr = z['ft'], z['fr']; self.oit, self.oiv = z['oit'] * (1000 if z['oit'][0] < 10**12 else 1), z['oiv']
        self.mmr, self.cap, self.maxlev = mmr_of(sym)
        b = resample(self.m, 5); self.b = b
        c, h, l, v = b['c'], b['h'], b['l'], b['v']
        f = {}
        f['ema9'], f['ema20'], f['ema50'], f['ema200'] = ema(c, 9), ema(c, 20), ema(c, 50), ema(c, 200)
        f['rsi'] = rsi(c); f['atr'] = atr(h, l, c); f['atrp'] = f['atr'] / c
        m12, m26 = ema(c, 12), ema(c, 26); macd = m12 - m26; f['hist'] = macd - ema(macd, 9)
        f['volz'] = v / pd.Series(v).rolling(20).mean().shift(1).values
        f['delta'] = np.where(v > 0, (2 * b['tbv'] - v) / np.where(v > 0, v, 1), 0)
        day = b['t'] // 86_400_000; tp = (h + l + c) / 3
        pv = pd.Series(tp * v).groupby(day).cumsum().values; vv = pd.Series(v).groupby(day).cumsum().values
        f['vwap'] = pv / np.where(vv > 0, vv, 1)
        for nm, k in [('m15', 15), ('h1', 60), ('h4', 240)]:
            hb = resample(self.m, k); hc = hb['c']
            e20, e50, e200 = ema(hc, 20), ema(hc, 50), ema(hc, 200)
            f[nm + '_c'] = htf_on_5m(b['t'], hb['t'], k, hc)
            f[nm + '_e20'] = htf_on_5m(b['t'], hb['t'], k, e20)
            f[nm + '_e50'] = htf_on_5m(b['t'], hb['t'], k, e50)
            f[nm + '_e200'] = htf_on_5m(b['t'], hb['t'], k, e200)
            f[nm + '_e50s'] = htf_on_5m(b['t'], hb['t'], k, e50 - np.concatenate([np.full(6, np.nan), e50[:-6]]))
            f[nm + '_rsi'] = htf_on_5m(b['t'], hb['t'], k, rsi(hc))
            if nm == 'h1':
                a = atr(hb['h'], hb['l'], hc) / hc
                pr = pd.Series(a).rolling(720, min_periods=200).rank(pct=True).values
                f['h1_atrp'] = htf_on_5m(b['t'], hb['t'], k, a); f['h1_atr_rank'] = htf_on_5m(b['t'], hb['t'], k, pr)
        # open interest change over the last hour (metrics snapshot times <= 5m close)
        close5 = b['t'] + 5 * MIN
        i = np.searchsorted(self.oit, close5, side='right') - 1; j = np.searchsorted(self.oit, close5 - 60 * MIN, side='right') - 1
        ok = (i >= 0) & (j >= 0)
        f['oi_chg'] = np.where(ok, self.oiv[np.clip(i, 0, None)] / self.oiv[np.clip(j, 0, None)] - 1, np.nan)
        k = np.searchsorted(self.ft, close5, side='right') - 1
        f['funding'] = np.where(k >= 0, self.fr[np.clip(k, 0, None)], 0)
        # regimes at signal time
        f['regime'] = np.where((f['h4_c'] > f['h4_e50']) & (f['h4_e50s'] > 0), 1, np.where((f['h4_c'] < f['h4_e50']) & (f['h4_e50s'] < 0), -1, 0))
        f['vol_regime'] = np.where(f['h1_atr_rank'] > 0.7, 1, np.where(f['h1_atr_rank'] < 0.3, -1, 0))
        self.f = f

    # ------------------------------------------------------------- labelling
    def label(self, i5, side, k=2.0):
        """Fill and resolve one entry decided at the close of 5m bar i5. Returns dict or None."""
        m = self.m; close_t = self.b['t'][i5] + 5 * MIN
        fi = int((close_t - m['t'][0]) // MIN) + 1  # 1m bar starting 1 minute after the close
        if fi >= len(m['t']): return None
        E = m['o'][fi] * (1 + SLIP * side)
        T = target_trigger(E, side); X = T * (1 - SLIP * side)
        EM = emergency_trigger(E, side, k) if k else None
        n = len(m['t']); tp_i = em_i = None; start = fi; step = 240
        while start < n and tp_i is None and em_i is None:
            end = min(n, start + step)
            hit = (m['h'][start:end] >= T) if side > 0 else (m['l'][start:end] <= T)
            if hit.any(): tp_i = start + int(hit.argmax())
            if EM is not None:
                eh = (m['ml'][start:end] <= EM) if side > 0 else (m['mh'][start:end] >= EM)
                if eh.any():
                    e = start + int(eh.argmax())
                    if tp_i is None or e <= tp_i: em_i, tp_i = e, None
            start = end; step *= 2
        if tp_i is not None: xi, kind, xp = tp_i, 'TP', X
        elif em_i is not None:
            o = m['o'][em_i]; gap = (o < EM) if side > 0 else (o > EM)
            px = o if gap else EM; xi, kind, xp = em_i, 'EMERGENCY', px * (1 - SLIP * side)
        else: xi, kind, xp = n - 1, 'OPEN', m['c'][n - 1]
        seg = slice(fi, xi + 1)
        mae = (E - m['ml'][seg].min()) / E if side > 0 else (m['mh'][seg].max() - E) / E
        w4 = slice(fi, min(n, fi + 240))
        mfe4 = (m['h'][w4].max() - E) / E if side > 0 else (E - m['l'][w4].min()) / E
        mfe = (m['h'][seg].max() - E) / E if side > 0 else (E - m['l'][seg].min()) / E
        # funding paid while open (per unit of entry notional)
        a, b_ = m['t'][fi], m['t'][xi]
        fs = (self.ft > a) & (self.ft <= b_)
        fund = 0.0
        if fs.any():
            idx = ((self.ft[fs] - m['t'][0]) // MIN).astype(int).clip(0, n - 1)
            fund = float(np.sum(side * self.fr[fs] * m['mc'][idx] / E))
        gross = side * (xp - E) / E
        cost = FEE * (1 + xp / E)
        net_notional = gross - cost - fund if kind != 'OPEN' else gross - cost - fund
        return dict(sym=self.sym, i5=i5, side=side, sig_t=int(close_t), fill_i=fi, fill_t=int(m['t'][fi]), entry=E, exit_i=xi,
                    exit_t=int(m['t'][xi]), exit=xp, kind=kind, net_m=net_notional * LEV, mae=mae, mfe=mfe, mfe4=mfe4,
                    mins=(xi - fi + 1), fund_m=fund * LEV, fee_m=cost * LEV,
                    regime=int(self.f['regime'][i5]), vol=int(self.f['vol_regime'][i5]))

def load_all():
    return {s: Coin(s) for s in SYMS}

# ------------------------------------------------------------------ chains / portfolio
class Labeler:
    def __init__(self, coins): self.coins = coins; self.cache = {}
    def get(self, sym, i5, side, k):
        key = (sym, i5, side, k)
        if key not in self.cache: self.cache[key] = self.coins[sym].label(i5, side, k)
        return self.cache[key]

def chain(lab, sigs, k, t0=None, t1=None, resolve_by=None):
    """Per-coin, one trade at a time (no slot limit): independent entry-quality view. sigs: list of (sym,i5,side)."""
    out = []; busy = {}
    for sym, i5, side in sorted(sigs, key=lambda x: (x[1], x[0])):
        st = lab.coins[sym].b['t'][i5] + 5 * MIN
        if t0 and st < t0: continue
        if t1 and st >= t1: continue
        if busy.get(sym, -1) >= st: continue
        r = lab.get(sym, i5, side, k)
        if r is None: continue
        busy[sym] = r['exit_t'] if r['kind'] != 'OPEN' else 10**15
        if resolve_by and r['kind'] != 'OPEN' and r['exit_t'] >= resolve_by: r = dict(r, kind='OPEN')
        out.append(r)
    return out

def portfolio(lab, sigs, k, t0, t1, wallet0=1000.0, close_at=None):
    """6 slots x 5% of wallet, one per coin, cross margin, minute-level account liquidation on worst mark.
    Trades still open at t1 stay open (unrealized) - never counted as completed."""
    coins = lab.coins; any_c = next(iter(coins.values())); tgrid = any_c.m['t']
    i_end = int(np.searchsorted(tgrid, t1)) - 1
    wallet = wallet0; openp = []; done = []; skipped = {'ALL_SLOTS_IN_USE': 0, 'COIN_ALREADY_OPEN': 0}
    cand = sorted([(coins[s].b['t'][i] + 5 * MIN, s, i, sd) for s, i, sd in sigs], key=lambda x: (x[0], x[1]))
    events = []
    def settle(upto):
        nonlocal wallet
        openp.sort(key=lambda p: p['exit_i'])
        while openp and openp[0]['kind'] != 'OPEN' and openp[0]['exit_i'] <= min(upto, i_end) and openp[0]['exit_t'] <= tgrid[min(upto, i_end)]:
            p = openp.pop(0); wallet += p['pnl']; done.append(p)
    for st, s, i5, sd in cand:
        if st < t0 or st >= t1: continue
        r = lab.get(s, i5, sd, k)
        if r is None or r['fill_i'] > i_end: continue
        settle(r['fill_i'] - 1)
        if any(p['sym'] == s for p in openp): skipped['COIN_ALREADY_OPEN'] += 1; continue
        if len(openp) >= SLOTS: skipped['ALL_SLOTS_IN_USE'] += 1; continue
        p = dict(r); p['margin'] = SHARE * wallet; p['notional'] = p['margin'] * LEV; p['pnl'] = p['net_m'] * p['margin']
        if p['kind'] != 'OPEN' and p['exit_i'] > i_end: p['kind'] = 'OPEN'
        openp.append(p); events.append(p)
    # positions not resolved by t1
    for p in events:
        if p['exit_i'] > i_end and p['kind'] != 'OPEN': p['kind'] = 'OPEN'
    settle(i_end)
    # ---------------- minute-level account check (worst mark) ----------------
    n = i_end + 1; unreal = np.zeros(n); maint = np.zeros(n); notl = np.zeros(n); wal = np.full(n, wallet0)
    realized = np.zeros(n)
    for p in events:
        c = coins[p['sym']].m; a = p['fill_i']; b = (p['exit_i'] if p['kind'] != 'OPEN' else i_end + 1)
        b = min(b, n)
        worst = c['ml'][a:b] if p['side'] > 0 else c['mh'][a:b]
        q = p['notional'] / p['entry']
        unreal[a:b] += p['side'] * (worst - p['entry']) * q - FEE * p['notional']
        maint[a:b] += coins[p['sym']].mmr * q * worst; notl[a:b] += q * worst
        if p['kind'] != 'OPEN' and p['exit_i'] < n: realized[p['exit_i']] += p['pnl']
    wal = wallet0 + np.cumsum(realized)
    eq = wal + unreal
    liq = np.where((notl > 0) & (eq <= maint))[0]
    liquidation = None
    if len(liq):
        t = int(liq[0]); victims = [p for p in events if p['fill_i'] <= t and (p['kind'] == 'OPEN' or p['exit_i'] > t)]
        liquidation = dict(time=int(tgrid[t]), positions=[(v['sym'], v['side']) for v in victims], equity=float(eq[t]), maint=float(maint[t]))
        # truncate history: trades exiting after t never happened; victims liquidated, account wiped
        done = [p for p in done if p['exit_i'] < t]
        tot = sum(v['notional'] for v in victims)
        for v in victims: v['kind'] = 'LIQUIDATED'; v['exit_i'] = t; v['exit_t'] = int(tgrid[t]); v['mins'] = t - v['fill_i'] + 1; v['pnl'] = -float(wal[t]) * v['notional'] / tot
        done += victims; events = [p for p in events if p['fill_i'] <= t]
        eq = eq[:t + 1]; wallet = 0.0; openp = []
        notl = notl[:t + 1]; maint = maint[:t + 1]
    peak = np.maximum.accumulate(np.concatenate([[wallet0], eq])[1:]) if len(eq) else np.array([wallet0])
    dd = float(np.max((peak - eq) / peak)) if len(eq) else 0.0
    m = notl > 0
    liqdist = float(np.min((eq[m] - maint[m]) / notl[m])) if m.any() else None
    opened_at_end = [p for p in openp if p['kind'] == 'OPEN']
    unreal_end = 0.0
    for p in opened_at_end:
        c = coins[p['sym']].m; px = c['c'][i_end]; q = p['notional'] / p['entry']
        p['unreal_end'] = p['side'] * (px - p['entry']) * q - FEE * p['notional']; unreal_end += p['unreal_end']
    return dict(trades=sorted(done, key=lambda p: p['fill_t']), open=opened_at_end, wallet=wallet, wallet0=wallet0,
                equity_end=wallet + unreal_end, max_dd=dd, min_liq_dist=liqdist, max_unreal_loss=float(-unreal.min()) if len(unreal) else 0.0,
                liquidation=liquidation, skipped=skipped)

def stats(trs, open_=None, wallet0=None):
    c = [t for t in trs if t['kind'] in ('TP', 'EMERGENCY', 'LIQUIDATED')]
    pn = np.array([t['pnl'] if 'pnl' in t else t['net_m'] for t in c])
    win = pn > 0; tp = [t for t in c if t['kind'] == 'TP']
    mins = np.array([t['mins'] for t in tp]) if tp else np.array([np.nan])
    gp = pn[win].sum() if len(pn) else 0; gl = -pn[~win].sum() if len(pn) else 0
    return dict(completed=len(c), wins=int(win.sum()), losses=int((~win).sum()), win_rate=float(win.mean()) if len(c) else None,
                tp=len(tp), emergency=sum(t['kind'] == 'EMERGENCY' for t in c), liquidated=sum(t['kind'] == 'LIQUIDATED' for t in c),
                net=float(pn.sum()), gross_profit=float(gp), gross_loss=float(gl), pf=float(gp / gl) if gl > 0 else None,
                avg_win=float(pn[win].mean()) if win.any() else None, avg_loss=float(pn[~win].mean()) if (~win).any() else None,
                per_trade=float(pn.mean()) if len(c) else None,
                mae_max=float(max(t['mae'] for t in c)) if c else None, mae_med=float(np.median([t['mae'] for t in c])) if c else None,
                mfe_max=float(max(t['mfe'] for t in c)) if c else None,
                dur_mean_h=float(np.mean([t['mins'] for t in c]) / 60) if c else None, dur_med_h=float(np.median([t['mins'] for t in c]) / 60) if c else None,
                tp_mean_h=float(np.nanmean(mins) / 60), tp_med_h=float(np.nanmedian(mins) / 60),
                tp_30m=float(np.mean(mins <= 30)) if tp else None, tp_1h=float(np.mean(mins <= 60)) if tp else None,
                tp_2h=float(np.mean(mins <= 120)) if tp else None, tp_4h=float(np.mean(mins <= 240)) if tp else None,
                tp_over_4h=float(np.mean(mins > 240)) if tp else None,
                pct_reach_target=float(len(tp) / len(c)) if c else None,
                pct_target_within_4h_of_all=float(np.sum(mins <= 240) / len(c)) if c else None,
                still_open=len(open_) if open_ is not None else None)
