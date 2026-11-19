import pickle, json, numpy as np
import engine as e, strategies as S, features as F
coins=pickle.load(open('/tmp/r57/work/coins.pkl','rb')); lab=e.Labeler(coins)
pool=set()
for name in S.FAMILIES:
  for p in S.grid(name):
    for s in S.signals(coins,name,p): pool.add((s,name))
cand={}
for (s,name) in pool: cand.setdefault(s,set()).add(name)
print('unique candidates',len(cand))
X=[];Y=[];META=[]
for (sym,i5,side),fams in cand.items():
  r=lab.get(sym,i5,side,2.0)
  if r is None: continue
  X.append(F.feats(coins[sym],i5,side)); Y.append(r['kind']); META.append(dict(sym=sym,i5=i5,side=side,sig_t=r['sig_t'],fams=sorted(fams),kind=r['kind'],exit_t=r['exit_t'],net_m=r['net_m'],mins=r['mins'],mae=r['mae']))
X=np.nan_to_num(np.array(X,float))
pickle.dump(dict(X=X,meta=META),open('/tmp/r57/work/pool.pkl','wb'))
T1=e.ms('2026-10-01'); dev=np.array([m['sig_t']<T1 for m in META]); done=np.array([m['kind']!='OPEN' for m in META])
win=np.array([m['kind']=='TP' for m in META])
d=dev&done; print('dev resolved',d.sum(),'win',win[d].mean())
for j,nm in enumerate(F.NAMES):
  x=X[d,j]; qs=np.quantile(x,[0,.2,.4,.6,.8,1])
  out=[]
  for a,b in zip(qs[:-1],qs[1:]):
    m=(x>=a)&(x<=b); out.append(f"[{a:.2f},{b:.2f}] n={m.sum()} w={win[d][m].mean():.3f}")
  print(nm,' | '.join(out))
