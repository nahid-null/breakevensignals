"""prompt-60: download Binance data for the 7-day OB Entry Signals backtest (offline research only).
Spot 5m = signal candles (matches the user's TradingView spot chart, same as the live setup since prompt-52);
futures 5m = sensitivity run; futures 1m + mark 1m + funding = trade settlement."""
import json, time, hashlib, sys, requests
from pathlib import Path
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
END = int(sys.argv[2]); START = END - 7*86400000; WARM0 = START - 14*86400000
SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","LINKUSDT","NEARUSDT","BCHUSDT","LTCUSDT","ADAUSDT","AVAXUSDT"]
F = 'https://fapi.binance.com'; S = 'https://api.binance.com'
def klines(base, path, sym, interval, t0, t1, lim):
    rows = []; t = t0
    while t < t1:
        for k in range(6):
            try:
                r = requests.get(base+path, params=dict(symbol=sym, interval=interval, startTime=t, endTime=t1-1, limit=lim), timeout=20); r.raise_for_status(); break
            except Exception:
                time.sleep(2)
        d = r.json()
        if not d: break
        rows += d; t = d[-1][0] + 1
    return [k for k in rows if k[0] + (300000 if interval == '5m' else 60000) <= t1]
hashes = {}
for s in SYMS:
    out = dict(
        spot5=klines(S, '/api/v3/klines', s, '5m', WARM0, END, 1000),
        fut5=klines(F, '/fapi/v1/klines', s, '5m', WARM0, END, 1500),
        k1=klines(F, '/fapi/v1/klines', s, '1m', START, END, 1500),
        m1=klines(F, '/fapi/v1/markPriceKlines', s, '1m', START, END, 1500),
        fund=requests.get(F+'/fapi/v1/fundingRate', params=dict(symbol=s, startTime=START, endTime=END, limit=1000), timeout=20).json())
    b = json.dumps(out).encode(); (OUT/f'{s}.json').write_bytes(b); hashes[s] = hashlib.sha256(b).hexdigest()
    print(s, len(out['spot5']), len(out['fut5']), len(out['k1']), len(out['m1']), len(out['fund']), flush=True)
info = requests.get(F+'/fapi/v1/exchangeInfo', timeout=20).json()
(OUT/'exchangeInfo.json').write_text(json.dumps({x['symbol']: x for x in info['symbols'] if x['symbol'] in SYMS}))
br = requests.post('https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets', json={}, timeout=20).json()['data']['brackets']
(OUT/'brackets.json').write_text(json.dumps({x['symbol']: x['riskBrackets'] for x in br if x['symbol'] in SYMS}))
(OUT/'hashes.json').write_text(json.dumps(dict(end=END, start=START, warmup_start=WARM0, files=hashes), indent=1))
