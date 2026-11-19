import time, pickle, os; t=time.time()
import engine as e, strategies as S
P='/tmp/r57/work/coins.pkl'
if os.path.exists(P): coins=pickle.load(open(P,'rb'))
else: coins=e.load_all(); pickle.dump(coins,open(P,'wb'))
print('load',round(time.time()-t))
lab=e.Labeler(coins); T0,T1=e.ms('2026-08-01'),e.ms('2026-10-01')
for name in S.FAMILIES:
  p=next(S.grid(name)); sg=S.signals(coins,name,p); ch=e.chain(lab,sg,2.0,T0,T1); st=e.stats(ch)
  print(name,p,len(sg),st['completed'],st['win_rate'],st['per_trade'],st['tp_4h'],round(time.time()-t))
