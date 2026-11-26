# Downloads AUD/JPY 1-minute candles (Yahoo Finance AUDJPY=X) for warmup + the 7 completed days Nov 19-25 2026 UTC.
import json, urllib.request, datetime as d, time
def get(a,b):
    u=f"https://query1.finance.yahoo.com/v8/finance/chart/AUDJPY=X?interval=1m&period1={a}&period2={b}"
    r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30)
    return json.load(r)['chart']['result'][0]
T=lambda s:int(d.datetime.fromisoformat(s+'T00:00:00+00:00').timestamp())
rows={}
for a,b in [('2026-11-12','2026-11-19'),('2026-11-19','2026-11-26')]:
    r=get(T(a),T(b)); q=r['indicators']['quote'][0]
    for i,t in enumerate(r['timestamp']):
        rows[t]=[t,q['open'][i],q['high'][i],q['low'][i],q['close'][i]]
    time.sleep(2)
out=[rows[k] for k in sorted(rows)]
json.dump({'source':'Yahoo Finance chart API, symbol AUDJPY=X, interval 1m','downloaded_at':d.datetime.now(d.UTC).isoformat(),'rows':out},open('data/audjpy-1m-yahoo.json','w'))
print(len(out), d.datetime.fromtimestamp(out[0][0],d.UTC), d.datetime.fromtimestamp(out[-1][0],d.UTC))
