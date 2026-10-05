import pickle, numpy as np, pandas as pd, os
H=os.path.dirname(os.path.abspath(__file__))
FORMS=['flat','wall','d2','d3','kado','d1','dash']
JA={'flat':'横一線','wall':'内3艇そろう','d2':'2コース凹み','d3':'カド受け凹み','kado':'カド一撃','d1':'イン凹み','dash':'ダッシュ勢先行','none':'どの形にも当たらない'}
def forms(c):
    c=np.asarray(c)
    f=np.stack([c.max(1)-c.min(1)<=6,
        c[:,:3].max(1)-c[:,:3].min(1)<=2,
        c[:,1]-np.minimum(c[:,0],c[:,2])>=5,
        c[:,2]-np.minimum(c[:,1],c[:,3])>=5,
        c[:,:3].min(1)-c[:,3]>=3,
        c[:,0]-c[:,1]>=5,
        c[:,:3].sum(1)-c[:,3:].sum(1)>=15],1)
    return np.concatenate([f,~f.any(1,keepdims=True)],1)  # 8th col = none
def wilson(k,n,z=1.96):
    if n==0: return (np.nan,np.nan,np.nan)
    p=k/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; h=z*np.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return p,c-h,c+h
def load():
    r=pickle.load(open(H+'/../knn/work2/races.pkl','rb'))
    b=np.load(H+'/../knn/work2/boats.npz',allow_pickle=True)
    B={k:b[k] for k in ['st_mean30','st_result','is_flying','is_late','cls_ord','boat_number','st_n']}
    # waku masks
    mask={}
    for f in ['kbA','kbB','main']:
        for t in open(H+f'/raw/{f}.txt').read().split(','):
            k=(t[:6],int(t[6:8])); v=int(t[8:],16)
            src='kb' if f!='main' else 'main'
            mask[(src,)+k]=v
    ymd=r.race_date.dt.strftime('%y%m%d').values
    src=np.where(r.race_date<=pd.Timestamp('2025-12-02'),'kb','main')
    waku=np.zeros(len(r),bool); known=np.zeros(len(r),bool)
    for i,(s,d,v,rn) in enumerate(zip(src,ymd,r.venue_code.values,r.race_number.values)):
        m=mask.get((s,d,int(v)))
        if m is not None:
            known[i]=True; waku[i]=bool((m>>(int(rn)-1))&1)
    r['waku']=waku; r['mask_known']=known
    return r,B
