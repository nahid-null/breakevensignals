import json,sys,csv,collections
sys.path.insert(0,"/dev-server/research/prompt-61")
from ob61 import run
SYMS="W ZEN GALA S A FF ETH SOL XRP LINK NEAR BCH LTC ADA AVAX".split()
M=json.load(open("/tmp/r69/raw/meta.json"));START,END=M['start'],M['end']
FEE,SLIP,LEV,MMR=0.0005,0.0002,75,0.005
trades=[];sigs=collections.Counter();skipped=collections.Counter()
for c in SYMS:
    s=c+"USDT";d=json.load(open(f"/tmp/r69/raw/{s}.json"))
    k=d['m30'];T=[x[0] for x in k];O,H,L,C,V=[[x[i] for x in k] for i in range(1,6)]
    m1=d['m1'];idx={x[0]:i for i,x in enumerate(m1)}
    fund=[(int(f['fundingTime']),float(f['fundingRate'])) for f in d['funding']]
    ev=[e for e in run(O,H,L,C,V) if START<=T[e['retest_bar']]+1800000<END]
    bal=10.0;openp=[];evq=sorted(ev,key=lambda e:e['retest_bar'])
    # event-driven over 1m bars
    pend={T[e['retest_bar']]+1800000:e for e in evq}
    sigs[s]=len(evq)
    for i,b in enumerate(m1):
        t,o,h,l,cl=b[0],b[1],b[2],b[3],b[4]
        if t in pend:
            e=pend[t]
            if len(openp)>=7: skipped[s]+=1
            else:
                dr=1 if e['side']=='LONG' else -1
                ent=o*(1+SLIP*dr);mg=bal*0.05;q=mg*LEV/ent
                liq=ent*(1-dr*(1/LEV-MMR))
                openp.append(dict(coin=s,side=e['side'],signal_time=t,entry=ent,margin=mg,qty=q,liq=liq,fund=0.0,fee_in=FEE*q*ent))
        for f in fund:
            if f[0]==t:
                for p in openp:
                    dr=1 if p['side']=='LONG' else -1;p['fund']+=dr*p['qty']*o*f[1]
        for p in list(openp):
            dr=1 if p['side']=='LONG' else -1;q,E=p['qty'],p['entry']
            tgt=0.5*p['margin']+p['fund']+p['fee_in']
            tp=(tgt+q*E*(1+0)*1)/q if False else None
            # price where net = +50%margin: dr*q*(fill-E)-fee_in-FEE*q*fill-fund = 0.5*mg
            if dr>0: tp=(tgt+q*E)/(q*(1-FEE))/(1-SLIP)
            else: tp=(q*E-tgt)/(q*(1+FEE))/(1+SLIP)
            hitL=(l<=p['liq']) if dr>0 else (h>=p['liq'])
            hitT=(h>=tp) if dr>0 else (l<=tp)
            if hitL or hitT:
                if hitL: pnl=-p['margin']-p['fund']-p['fee_in'];res='LIQUIDATED';px=p['liq']
                else: pnl=0.5*p['margin'];res='COMPLETED (TP)';px=tp
                bal+=pnl;openp.remove(p)
                trades.append({**p,'result':res,'exit_time':t+60000,'exit_price':px,'pnl':pnl,'mins':(t+60000-p['signal_time'])/60000})
    last=m1[-1][4]
    for p in openp:
        dr=1 if p['side']=='LONG' else -1;fill=last*(1-dr*SLIP)
        un=dr*p['qty']*(fill-p['entry'])-p['fee_in']-FEE*p['qty']*fill-p['fund']
        trades.append({**p,'result':'STILL OPEN','exit_time':None,'exit_price':last,'pnl':un,'mins':(END-p['signal_time'])/60000})
json.dump(dict(trades=trades,sigs=sigs,skipped=skipped,start=START,end=END),open("/tmp/r69/out.json","w"))
print(len(trades),sum(sigs.values()),dict(skipped),collections.Counter(t['result'] for t in trades))
