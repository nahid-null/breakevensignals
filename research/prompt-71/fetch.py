# prompt-71: Binance USD-M Futures data (30m signals + 1m exits + funding), offline research only
import requests, json, time
from concurrent.futures import ThreadPoolExecutor
SYMS="ZEN GALA S ETH SOL XRP LINK NEAR BCH LTC ADA AVAX TRX BNB UNI WLD WIF CRV EGLD FIL SAND HBAR".split()
END=(int(time.time()*1000)//3600000)*3600000
START=END-7*86400000; WARM=START-30*86400000
def kl(sym,iv,a,b,step):
    out=[];t=a
    while t<b:
        for k in range(5):
            try:
                r=requests.get("https://fapi.binance.com/fapi/v1/klines",params=dict(symbol=sym,interval=iv,startTime=t,endTime=b-1,limit=1500),timeout=30).json();break
            except Exception: time.sleep(2)
        if not r: break
        out+=r; t=r[-1][0]+step
    return [[k[0],float(k[1]),float(k[2]),float(k[3]),float(k[4]),float(k[5])] for k in out]
def fr(sym):
    return requests.get("https://fapi.binance.com/fapi/v1/fundingRate",params=dict(symbol=sym,startTime=START-86400000,endTime=END,limit=1000),timeout=30).json()
def job(c):
    s=c+"USDT"
    d=dict(m30=kl(s,"30m",WARM,END,1800000),m1=kl(s,"1m",START,END,60000),funding=fr(s))
    json.dump(d,open(f"/tmp/r71/raw/{s}.json","w")); return s,len(d['m30']),len(d['m1']),len(d['funding'])
json.dump(dict(start=START,end=END),open("/tmp/r71/raw/meta.json","w"))
with ThreadPoolExecutor(4) as ex:
    for r in ex.map(job,SYMS): print(r)
