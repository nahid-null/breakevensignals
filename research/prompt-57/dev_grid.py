import time, pickle, json; t=time.time()
import engine as e, strategies as S
coins=pickle.load(open('/tmp/r57/work/coins.pkl','rb')); lab=e.Labeler(coins)
T0,T1=e.ms('2026-08-01'),e.ms('2026-10-01')
rows=[]
for name in S.FAMILIES:
  for p in S.grid(name):
    sg=S.signals(coins,name,p); ch=e.chain(lab,sg,2.0,T0,T1); st=e.stats(ch)
    rows.append(dict(family=name,params={k:(list(v) if isinstance(v,tuple) else v) for k,v in p.items()},**{k:st[k] for k in ['completed','win_rate','per_trade','net','emergency','tp_4h','tp_med_h','mae_med']}))
    print(name,p,st['completed'],round(st['win_rate'] or 0,4),round(st['per_trade'] or 0,4),flush=True)
json.dump(rows,open('/tmp/r57/work/dev_grid.json','w'),default=float)
print('secs',round(time.time()-t))
