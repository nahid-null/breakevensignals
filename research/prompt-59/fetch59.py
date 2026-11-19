"""prompt-59: download Binance USD-M futures data for the last-7-day Scalp Pro backtest (offline research only)."""
import json, time, hashlib, sys, requests
from pathlib import Path
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/r59/raw'); OUT.mkdir(parents=True, exist_ok=True)
SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","LINKUSDT","NEARUSDT","BCHUSDT","LTCUSDT","ADAUSDT","AVAXUSDT"]
F = 'https://fapi.binance.com'
END = int(sys.argv[2]); WARM0 = END - 10*86400000; START1 = END - 7*86400000 - 3600000
def klines(path, sym, interval, t0, t1):
    rows = []; t = t0
    while t < t1:
        for k in range(5):
            try:
                r = requests.get(F+path, params=dict(symbol=sym, interval=interval, startTime=t, endTime=t1-1, limit=1500), timeout=20); r.raise_for_status(); break
            except Exception as e:
                time.sleep(2)
        d = r.json()
        if not d: break
        rows += d; t = d[-1][0] + 1
    return rows
hashes = {}
for s in SYMS:
    out = dict(
        k5=klines('/fapi/v1/klines', s, '5m', WARM0, END),
        k1=klines('/fapi/v1/klines', s, '1m', START1, END),
        m1=klines('/fapi/v1/markPriceKlines', s, '1m', START1, END),
        fund=requests.get(F+'/fapi/v1/fundingRate', params=dict(symbol=s, startTime=START1, endTime=END, limit=1000), timeout=20).json())
    b = json.dumps(out).encode(); (OUT/f'{s}.json').write_bytes(b); hashes[s] = hashlib.sha256(b).hexdigest()
    print(s, len(out['k5']), len(out['k1']), len(out['m1']), len(out['fund']), flush=True)
info = requests.get(F+'/fapi/v1/exchangeInfo', timeout=20).json()
(OUT/'exchangeInfo.json').write_text(json.dumps({x['symbol']: x for x in info['symbols'] if x['symbol'] in SYMS}))
(OUT/'hashes.json').write_text(json.dumps(hashes, indent=1))
