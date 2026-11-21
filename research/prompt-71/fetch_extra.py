# prompt-71: public Binance leverage brackets, exchange lot rules and 1m MARK price candles (liquidation uses mark price)
import requests, json, time
from concurrent.futures import ThreadPoolExecutor
SYMS = "ZEN GALA S ETH SOL XRP LINK NEAR BCH LTC ADA AVAX TRX BNB UNI WLD WIF CRV EGLD FIL SAND HBAR".split()
R = "/tmp/r71/raw"; M = json.load(open(f"{R}/meta.json")); START, END = M['start'], M['end']
br = requests.post("https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets", json={}, timeout=30).json()['data']['brackets']
json.dump({b['symbol']: b['riskBrackets'] for b in br if b['symbol'] in [c + "USDT" for c in SYMS]}, open(f"{R}/brackets.json", "w"))
ex = requests.get("https://fapi.binance.com/fapi/v1/exchangeInfo", timeout=30).json()
json.dump({s['symbol']: s for s in ex['symbols'] if s['symbol'] in [c + "USDT" for c in SYMS]}, open(f"{R}/exinfo.json", "w"))
def mark(c):
    s = c + "USDT"; out = []; t = START
    while t < END:
        r = requests.get("https://fapi.binance.com/fapi/v1/markPriceKlines", params=dict(symbol=s, interval="1m", startTime=t, endTime=END - 1, limit=1500), timeout=30).json()
        if not r: break
        out += [[k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4])] for k in r]; t = r[-1][0] + 60000
    json.dump(out, open(f"{R}/{s}.mark.json", "w")); return s, len(out)
with ThreadPoolExecutor(4) as e:
    for r in e.map(mark, SYMS): print(r)
