"""prompt-62: Binance SPOT data for the 7-day OB STRONG test (spot 5m signal candles with 14-day warm-up, spot 1m for
take-profit/liquidation checks) plus futures tick sizes used by the live cost model. Offline; read-only public endpoints."""
import json, time, hashlib, sys, requests
from pathlib import Path
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
END = int(sys.argv[2]); START = END - 7*86400000; WARM0 = START - 14*86400000
SYMS = ["ETHUSDT","SOLUSDT","XRPUSDT","LINKUSDT","NEARUSDT","BCHUSDT","LTCUSDT","ADAUSDT","AVAXUSDT"]
S = 'https://api.binance.com'; F = 'https://fapi.binance.com'
def klines(sym, interval, t0, t1):
    rows = []; t = t0; span = 300000 if interval == '5m' else 60000
    while t < t1:
        for k in range(6):
            try:
                r = requests.get(S+'/api/v3/klines', params=dict(symbol=sym, interval=interval, startTime=t, endTime=t1-1, limit=1000), timeout=20); r.raise_for_status(); break
            except Exception:
                time.sleep(2)
        d = r.json()
        if not d: break
        rows += d; t = d[-1][0] + 1
    return [k for k in rows if k[0] + span <= t1]
hashes = {}
for s in SYMS:
    out = dict(spot5=klines(s, '5m', WARM0, END), spot1=klines(s, '1m', START, END))
    b = json.dumps(out).encode(); (OUT/f'{s}.json').write_bytes(b); hashes[s] = hashlib.sha256(b).hexdigest()
    print(s, len(out['spot5']), len(out['spot1']), flush=True)
info = requests.get(F+'/fapi/v1/exchangeInfo', timeout=20).json()
tick = {x['symbol']: float(next(f for f in x['filters'] if f['filterType'] == 'PRICE_FILTER')['tickSize']) for x in info['symbols'] if x['symbol'] in SYMS}
(OUT/'ticks.json').write_text(json.dumps(tick))
(OUT/'hashes.json').write_text(json.dumps(dict(end=END, start=START, warmup_start=WARM0, files=hashes), indent=1))
