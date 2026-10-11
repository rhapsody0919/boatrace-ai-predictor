from load import *
import json
r,B=load()
sm=B['st_mean30']; sr=B['st_result']
ret=(B['is_flying']|B['is_late']).any(1)
END=pd.Timestamp('2026-09-26')
inper=(r.race_date<=END).values
waku=r.waku.values; stok=~np.isnan(sr).any(1); mok=~np.isnan(sm).any(1)
cnt={'pkl_all':int(len(r)),'pkl_le_end':int(inper.sum()),'waku':int((inper&waku).sum()),
     'waku_noret':int((inper&waku&~ret).sum()),'waku_noret_st':int((inper&waku&~ret&stok).sum()),
     'final':int((inper&waku&~ret&stok&mok).sum())}
POP=inper&waku&~ret&stok&mok
K=round(float(np.std((sr-np.nanmean(sr,1,keepdims=True))[inper&waku&~ret&stok&mok]) /
         np.std((sm-np.nanmean(sm,1,keepdims=True))[inper&waku&~ret&stok&mok])),2)
def actual(idx): return forms(np.round(sr[idx]*100).astype(int))
def pred_raw(idx): return forms(np.round(sm[idx]*100).astype(int))
def pred_k(idx,k=K):
    m=sm[idx]; mu=m.mean(1,keepdims=True); return forms(np.round((mu+k*(m-mu))*100).astype(int))
NAMES=FORMS+['none']
def W(k,n):
    p,lo,hi=wilson(k,n); return {'x':int(k),'n':int(n),'p':None if n==0 else round(p,3),'lo':None if n==0 else round(lo,3),'hi':None if n==0 else round(hi,3)}
def form_table(P,A):
    out={}
    for j,f in enumerate(NAMES):
        pj=P[:,j]; aj=A[:,j]
        hit=W((pj&aj).sum(),pj.sum()); miss=W((~pj&aj).sum(),(~pj).sum())
        out[f]={'pred':W(pj.sum(),len(pj)),'same':hit,'not_pred':miss,'base':W(aj.sum(),len(aj)),
                'lift':None if not hit['n'] or not miss['n'] or miss['p']==0 else round((hit['x']/hit['n'])/(miss['x']/miss['n']),2)}
    return out
def cross(P,A):
    return [[int((P[:,i]&A[:,j]).sum()) for j in range(8)] for i in range(8)]
M=lambda idx: np.round(sm[idx]*1000).astype(int)  # 1/1000 s
def conds(Mi):
    c=Mi; mn13=c[:,:3].min(1); others=lambda j: np.delete(c,j,1)
    return {
     'kado_a':('4コースの平均STが1〜3コースのどれよりも早い','kado', c[:,3]<mn13),
     'kado_b':('4コースの平均STが6艇で一番早い','kado', c[:,3]<others(3).min(1)),
     'kado_c':('4コースの平均STが1〜3コースの最速より.02以上早い','kado', mn13-c[:,3]>=20),
     'in_a':('1コースの平均STが2コースより遅い','d1', c[:,0]>c[:,1]),
     'in_b':('1コースの平均STが2コースより.02以上遅い','d1', c[:,0]-c[:,1]>=20),
     'in_c':('1コースの平均STが6艇で一番遅い','d1', c[:,0]>others(0).max(1)),
     'd2_a':('2コースの平均STが1・3コースのどちらよりも遅い','d2', c[:,1]>np.maximum(c[:,0],c[:,2])),
     'd2_b':('2コースの平均STが1・3コースのどちらよりも.01以上遅い','d2', c[:,1]-np.maximum(c[:,0],c[:,2])>=10),
     'd3_a':('3コースの平均STが2・4コースのどちらよりも遅い','d3', c[:,2]>np.maximum(c[:,1],c[:,3])),
     'd3_b':('3コースの平均STが2・4コースのどちらよりも.01以上遅い','d3', c[:,2]-np.maximum(c[:,1],c[:,3])>=10),
     'dash_a':('4〜6コースの平均STの和が1〜3コースの和より早い','dash', c[:,3:].sum(1)<c[:,:3].sum(1)),
     'dash_b':('4〜6コースの平均STの和が1〜3コースの和より.03以上早い','dash', c[:,:3].sum(1)-c[:,3:].sum(1)>=30),
     'flat_a':('6艇の平均STの差（最も遅い−最も早い）が.02以内','flat', c.max(1)-c.min(1)<=20),
     'wall_a':('1〜3コースの平均STの差が.01以内','wall', c[:,:3].max(1)-c[:,:3].min(1)<=10),
     'in_fast':('1コースの平均STが6艇で一番早い','d1', c[:,0]<others(0).min(1)),
    }
def cond_table(Mi,A):
    out={}
    for key,(lab,tgt,cm) in conds(Mi).items():
        j=NAMES.index(tgt)
        y=W((cm&A[:,j]).sum(),cm.sum()); n=W((~cm&A[:,j]).sum(),(~cm).sum())
        out[key]={'label':lab,'target':tgt,'cond':W(cm.sum(),len(cm)),'rate_yes':y,'rate_no':n,
                  'lift':None if not y['n'] or not n['n'] or n['p']==0 else round((y['x']/y['n'])/(n['x']/n['n']),2),
                  'all_forms_yes':{f:W((cm&A[:,i]).sum(),cm.sum()) for i,f in enumerate(NAMES)},
                  'b1win_yes':W(((r.rank1.values[IDX_CUR]==1)&cm).sum(),cm.sum()) if False else None}
    return out
res={'meta':{'K':K,'counts':cnt,'period':['2019-04-01',str(END.date())]}}
idx=np.where(POP)[0]; A=actual(idx)
res['actual_counts']={f:int(v) for f,v in zip(NAMES,A.sum(0))}
dm=sm[idx]-sm[idx].mean(1,keepdims=True); da=sr[idx]-sr[idx].mean(1,keepdims=True)
res['meta']['boat_corr_meandev_actualdev']=round(float(np.corrcoef(dm.ravel(),da.ravel())[0,1]),3)
res['meta']['sd_meandev']=round(float(dm.std()),4); res['meta']['sd_actualdev']=round(float(da.std()),4)
# per-course rank agreement: probability fastest-mean boat is fastest actual
fm=np.argmin(sm[idx],1); fa=np.argmin(sr[idx]+np.random.default_rng(0).uniform(0,1e-6,sr[idx].shape),1)
res['meta']['fastest_mean_is_fastest_actual']=W((fm==fa).sum(),len(fm))
Pr=pred_raw(idx); Pk=pred_k(idx)
res['q1']={'raw':form_table(Pr,A),'k':form_table(Pk,A),'cross_k':cross(Pk,A),'cross_raw':cross(Pr,A)}
# sensitivity of k
res['q1']['k_sens']={str(k):{f:v['lift'] for f,v in form_table(pred_k(idx,k),A).items()} for k in [1.0,1.5,K,3.0]}
res['q2']=cond_table(M(idx),A)
# by sub-period stability (2019-2022 vs 2023-2026)
yr=r.race_date.dt.year.values[idx]
res['q2_split']={lab:{k:v['lift'] for k,v in cond_table(M(idx[s]),A[s]).items()} for lab,s in [('2019-2022',yr<=2022),('2023-2026',yr>=2023)]}
res['q1_split']={lab:{f:v['lift'] for f,v in form_table(Pk[s],A[s]).items()} for lab,s in [('2019-2022',yr<=2022),('2023-2026',yr>=2023)]}
# Q3 exhibition
ex={}
for t in open(H+'/raw/exh.txt').read().split(','):
    key,c,st=t.split(':'); ex[(key[:6],int(key[6:8]),int(key[8:10]))]=(c,st)
ymd=r.race_date.dt.strftime('%y%m%d').values
eST=np.full(sr.shape,np.nan); eC=np.array(['']*len(r),dtype=object)
for i in np.where((r.race_date>=pd.Timestamp('2026-04-01')).values)[0]:
    v=ex.get((ymd[i],int(r.venue_code.values[i]),int(r.race_number.values[i])))
    if v is None: continue
    c,st=v; eC[i]=c
    if 'x' not in st: eST[i]=[int(x) for x in st.split('/')]
eok=~np.isnan(eST).any(1)
q3={}
for lab,sel in [('strict',POP&eok&(eC=='123456')),('approx',POP&eok&((eC=='123456')|(eC=='xxxxxx')))]:
    j=np.where(sel)[0]; Aj=actual(j); E=eST[j]
    Pe=forms(E.astype(int)); Pm=pred_k(j)
    m=sm[j]; mu=m.mean(1,keepdims=True); mk=(mu+K*(m-mu))*100
    blend=0.5*(E-E.mean(1,keepdims=True))+0.5*(mk-mk.mean(1,keepdims=True))
    Pb=forms(np.round(blend).astype(int))
    de=E-E.mean(1,keepdims=True); da_=sr[j]*100-(sr[j]*100).mean(1,keepdims=True); dmm=m-mu
    # regression of actual dev on (mean dev, exh dev)
    X=np.stack([dmm.ravel()*100,de.ravel()],1); coef=np.linalg.lstsq(X,da_.ravel(),rcond=None)[0]
    agree=Pe&Pm
    q3[lab]={'n':int(len(j)),'dmin':str(r.race_date.values[j].min())[:10] if len(j) else None,'dmax':str(r.race_date.values[j].max())[:10] if len(j) else None,
      'corr_exhdev_actualdev':round(float(np.corrcoef(de.ravel(),da_.ravel())[0,1]),3),
      'corr_meandev_actualdev':round(float(np.corrcoef(dmm.ravel(),da_.ravel())[0,1]),3),
      'ols_coef_meandev_exhdev':[round(float(x),3) for x in coef],
      'mean_k':form_table(Pm,Aj),'exh':form_table(Pe,Aj),'blend':form_table(Pb,Aj),'agree':form_table(agree,Aj),
      'cond_mean':cond_table(M(j),Aj)}
    # combined conditions with exhibition
    Ei=E.astype(int); Mi=M(j)
    cc={'kado_both':('4コースが平均STでも展示STでも1〜3コースのどれよりも早い','kado',(Mi[:,3]<Mi[:,:3].min(1))&(Ei[:,3]<Ei[:,:3].min(1))),
        'kado_exh':('4コースの展示STが1〜3コースのどれよりも早い','kado',Ei[:,3]<Ei[:,:3].min(1)),
        'kado_mean':('4コースの平均STが1〜3コースのどれよりも早い','kado',Mi[:,3]<Mi[:,:3].min(1)),
        'd2_both':('2コースが平均STでも展示STでも1・3コースのどちらよりも遅い','d2',(Mi[:,1]>np.maximum(Mi[:,0],Mi[:,2]))&(Ei[:,1]>np.maximum(Ei[:,0],Ei[:,2]))),
        'd2_exh':('2コースの展示STが1・3コースのどちらよりも遅い','d2',Ei[:,1]>np.maximum(Ei[:,0],Ei[:,2])),
        'd2_mean':('2コースの平均STが1・3コースのどちらよりも遅い','d2',Mi[:,1]>np.maximum(Mi[:,0],Mi[:,2])),
        'in_both':('1コースが平均STでも展示STでも2コースより遅い','d1',(Mi[:,0]>Mi[:,1])&(Ei[:,0]>Ei[:,1])),
        'in_exh':('1コースの展示STが2コースより遅い','d1',Ei[:,0]>Ei[:,1]),
        'in_mean':('1コースの平均STが2コースより遅い','d1',Mi[:,0]>Mi[:,1]),
        'd3_both':('3コースが平均STでも展示STでも2・4コースのどちらよりも遅い','d3',(Mi[:,2]>np.maximum(Mi[:,1],Mi[:,3]))&(Ei[:,2]>np.maximum(Ei[:,1],Ei[:,3]))),
        'd3_exh':('3コースの展示STが2・4コースのどちらよりも遅い','d3',Ei[:,2]>np.maximum(Ei[:,1],Ei[:,3])),
        'd3_mean':('3コースの平均STが2・4コースのどちらよりも遅い','d3',Mi[:,2]>np.maximum(Mi[:,1],Mi[:,3])),
        }
    out={}
    for key,(lb,tgt,cm) in cc.items():
        jj=NAMES.index(tgt); y=W((cm&Aj[:,jj]).sum(),cm.sum()); n=W((~cm&Aj[:,jj]).sum(),(~cm).sum())
        out[key]={'label':lb,'target':tgt,'cond':W(cm.sum(),len(cm)),'rate_yes':y,'rate_no':n,
                  'lift':None if not y['n'] or not n['n'] or n['p']==0 else round((y['x']/y['n'])/(n['x']/n['n']),2)}
    q3[lab]['cond_combo']=out
res['q3']=q3
# Q4 Wakamatsu & all A1
cls=B['cls_ord']
for lab,sel in [('v20',POP&(r.venue_code.values==20)),('v20_A1x6',POP&(r.venue_code.values==20)&(cls==4).all(1)),('all_A1x6',POP&(cls==4).all(1))]:
    j=np.where(sel)[0]; Aj=actual(j)
    res.setdefault('q4',{})[lab]={'n':int(len(j)),'actual':{f:W(v,len(j)) for f,v in zip(NAMES,Aj.sum(0))},
       'q1k':form_table(pred_k(j),Aj),'q2':cond_table(M(j),Aj),
       'grades':{str(k):int(v) for k,v in pd.Series(r.grade.values[j]).value_counts().items()},
       'rounds':{str(k):int(v) for k,v in pd.Series(r['round'].values[j]).value_counts().items()}}
# Q5 example
i=np.where((r.race_date==pd.Timestamp('2026-09-27')).values&(r.venue_code.values==20)&(r.race_number.values==12))[0][0]
m=sm[i]; mu=m.mean(); mk=mu+K*(m-mu)
ex_res={'st_mean30':[round(float(x),4) for x in m],'raw_int':[int(x) for x in np.round(m*100)],
  'k_int':[int(x) for x in np.round(mk*100)],
  'raw_forms':[f for f,b in zip(NAMES,pred_raw([i])[0]) if b],'k_forms':[f for f,b in zip(NAMES,pred_k([i])[0]) if b],
  'conds_true':[k for k,(lb,t,cm) in conds(M([i])).items() if cm[0]],
  'actual_st':[float(round(x,2)) for x in sr[i]],'actual_forms':[f for f,b in zip(NAMES,actual([i])[0]) if b],
  'waku':bool(r.waku.values[i]),'exh_c':eC[i],'exh_st':[None if np.isnan(x) else int(x) for x in eST[i]],
  'cls':[int(x) for x in cls[i]],'rank':[int(r.rank1.values[i]),int(r.rank2.values[i]),int(r.rank3.values[i])]}
res['q5']=ex_res
json.dump(res,open(H+'/slitpred.json','w'),ensure_ascii=False,indent=1,default=lambda o: o.item() if hasattr(o,'item') else str(o))
print(json.dumps(res['meta'],ensure_ascii=False)); print(json.dumps(res['q5'],ensure_ascii=False))
