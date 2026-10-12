# 追加: 公開時刻の確認（未来情報の混入）・勝率/モーターとの相関・強い土台での時系列検証・会場別の傾き・スリット7形・必要件数
# analyze.py が保存した boats_f.pkl を使う
import pandas as pd, numpy as np, os, json
from scipy.optimize import minimize
from scipy.stats import norm
from common import WORK, VEN, JA, fmt, grp

b=pd.read_pickle(os.path.join(WORK,'boats_f.pkl')); d=json.load(open(os.path.join(WORK,'raw.json')))
P=print
P('## 公開時刻: race_original_exhibition.created_at（初回保存）と races.start_time（JST 発走）')
ox=pd.DataFrame(d['ox']); r=pd.DataFrame(d['races'])
m=ox.merge(r[['race_id','race_date','start_time']],on='race_id')
m['start']=pd.to_datetime(m.race_date+' '+m.start_time).dt.tz_localize('Asia/Tokyo')
m['saved']=pd.to_datetime(m.created_at,format='ISO8601').dt.tz_convert('Asia/Tokyo')
m['lead_min']=(m.start-m.saved).dt.total_seconds()/60
P(m.lead_min.describe(percentiles=[.05,.25,.5,.75,.95]).round(1).to_string())
P('発走前に保存された割合',f"{(m.lead_min>0).mean():.3f}",'発走10分前以前',f"{(m.lead_min>=10).mean():.3f}")
late=set(m[m.lead_min<=0].race_id)
P('保存後の書き換え（updated_at）は check-rewrite.mjs で確認する')
b['pre']=~b.race_id.isin(late)
P('\n## 相関（勝率・モーター2連率、欠けを除く）')
for it in ['lap','mawari','straight','exhibition_time']:
  x=b[b[it+'_z'].notna()]
  for c in ['win_rate','motor_2rate']:
    y=x[x[c+'_z'].notna()]; P(f'{JA[it]}(速い+) × {c}: {np.corrcoef(y[it+"_f"],y[c+"_z"])[0,1]:.3f} n={len(y)}')
def fit(df,feats):
  df=df.sort_values(['race_id','boat_number']); X=df[feats].to_numpy(float).reshape(-1,6,len(feats)); y=df.win.to_numpy().reshape(-1,6)
  def nll(w):
    s=X@w; s=s-s.max(1,keepdims=True); ls=s-np.log(np.exp(s).sum(1,keepdims=True)); p=np.exp(ls)
    return -(ls*y).sum(), -((y-p)[:,:,None]*X).sum((0,1))
  r=minimize(nll,np.zeros(len(feats)),jac=True,method='BFGS')
  # ヘッセ行列で標準誤差
  s=X@r.x; s=s-s.max(1,keepdims=True); p=np.exp(s); p/=p.sum(1,keepdims=True)
  mu=(p[:,:,None]*X).sum(1); Hm=np.einsum('rk,rki,rkj->ij',p,X,X)-np.einsum('ri,rj->ij',mu,mu)
  se=np.sqrt(np.diag(np.linalg.inv(Hm)))
  return r.x,se,X,y
def rll(w,X,y):
  s=X@w; s=s-s.max(1,keepdims=True); ls=s-np.log(np.exp(s).sum(1,keepdims=True)); return -(ls*y).sum(1)
CO=[f'c{c}' for c in range(2,7)]
rng=np.random.default_rng(1)
P('\n## 発走前に保存されたレースだけでの係数（展示タイムをそろえる）')
for it in ['lap','mawari','straight']:
  x=b[b[it+'_z'].notna()&b.pre].copy(); x[it+'_f']=x[it+'_f'].fillna(0); x['exhibition_time_f']=x.exhibition_time_f.fillna(0)
  w,se,_,_=fit(x,CO+['exhibition_time_f',it+'_f']); P(f'{JA[it]} R={x.race_id.nunique()} {w[-1]:+.3f} ±{1.96*se[-1]:.3f}')
P('\n## 時系列分割（学習〜10/03・検証10/04〜）。土台=コース+展示タイム+勝率+モーター2連率')
for it in ['lap','mawari','straight']:
  x=b[b[it+'_z'].notna()].copy()
  ok=x.groupby('race_id').win_rate_z.transform(lambda s:s.notna().all())&x.groupby('race_id').motor_2rate_z.transform(lambda s:s.notna().all())
  x=x[ok]; x['exhibition_time_f']=x.exhibition_time_f.fillna(0)
  tr=x[x.race_date<='2026-10-03']; te=x[x.race_date>'2026-10-03']
  f0=CO+['exhibition_time_f','win_rate_f','motor_2rate_f']; f1=f0+[it+'_f']
  w0=fit(tr,f0)[0]; w1=fit(tr,f1)[0]; X0,y0=fit(te,f0)[2:]; X1,y1=fit(te,f1)[2:]
  dd=rll(w1,X1,y1)-rll(w0,X0,y0); bs=[dd[rng.integers(0,len(dd),len(dd))].mean() for _ in range(2000)]
  P(f'{JA[it]}: 学習{tr.race_id.nunique()}R 検証{te.race_id.nunique()}R 差={dd.mean():+.4f} [{np.percentile(bs,2.5):+.4f}, {np.percentile(bs,97.5):+.4f}] 抜きLL={rll(w0,X0,y0).mean():.4f}')
P('\n## 会場別の傾き（展示タイムをそろえた条件付きロジット、Wald 95%）')
rows=[]
for vc,g in b.groupby('venue_code'):
  row=[VEN[vc]]
  for it in ['lap','mawari','straight']:
    x=g[g[it+'_z'].notna()].copy()
    if x.race_id.nunique()<50: row.append('-'); continue
    x['exhibition_time_f']=x.exhibition_time_f.fillna(0)
    w,se,_,_=fit(x,CO+['exhibition_time_f',it+'_f']); row.append(f'{w[-1]:+.2f}±{1.96*se[-1]:.2f}')
  row.append(g.race_id.nunique()); rows.append(row)
P(pd.DataFrame(rows,columns=['会場','周回','まわり足','直線','R']).to_string(index=False))
P('\n## 4 スリット7形（本番ST、枠なり・発走前保存）× 攻める艇の順位区分 → 攻める艇の1着率')
FORMS=['flat','wall','d2','d3','kado','d1','dash']; FJ={'flat':'横一線','wall':'内3艇そろう','d2':'2コース凹み','d3':'カド受け凹み','kado':'カド一撃','d1':'イン凹み','dash':'ダッシュ勢先行'}
ATT={'d2':3,'d3':4,'kado':4,'d1':2,'dash':4}
w_=b[b.wakunari.astype(bool)].sort_values(['race_id','boat_number'])
c=np.round(w_.start_timing.to_numpy().reshape(-1,6)*100).astype(int); rid=w_.race_id.to_numpy()[::6]
f=np.stack([c.max(1)-c.min(1)<=6, c[:,:3].max(1)-c[:,:3].min(1)<=2, c[:,1]-np.minimum(c[:,0],c[:,2])>=5,
  c[:,2]-np.minimum(c[:,1],c[:,3])>=5, c[:,:3].min(1)-c[:,3]>=3, c[:,0]-c[:,1]>=5, c[:,:3].sum(1)-c[:,3:].sum(1)>=15],1)
FM=pd.DataFrame(f,index=rid,columns=FORMS)
P('枠なりR',len(FM),'形ごとR',FM.sum().to_dict())
bi=w_.set_index(['race_id','boat_number'])
for fm in FORMS:
  ids=FM.index[FM[fm]]
  if fm in ATT:
    a=bi.loc[[(i,ATT[fm]) for i in ids]]; tgt=f'{ATT[fm]}号艇の1着'
  else:
    a=bi.loc[[(i,1) for i in ids]]; tgt='1号艇の1着'
  P(f'\n### {FJ[fm]}（{len(ids)}R、{tgt}、全体 {fmt(a.win.sum(),len(a))}）')
  for it in ['mawari','lap','straight','exhibition_time']:
    y=a[a[it+'_rank'].notna()]; gg=grp(y[it+'_rank'])
    P(f'  {JA[it]}: '+' | '.join(f"{g_}: {fmt(y[gg==g_].win.sum(),(gg==g_).sum())}" for g_ in ['上位1-2','中位3-4','下位5-6']))
P('\n## 5 必要件数（上位1-2 と 下位5-6 の1着率の差を、両側5%・検出力80%で言うのに各区分に要る艇数）')
def nneed(p1,p2):
  if p1==p2: return np.inf
  return (norm.ppf(.975)+norm.ppf(.8))**2*(p1*(1-p1)+p2*(1-p2))/(p1-p2)**2
for lab,p1,p2 in [('2〜6コース 周回 0.131 vs 0.055',0.131,0.055),('2〜6コース まわり足 0.117 vs 0.059',0.117,0.059),('2〜6コース 直線 0.095 vs 0.074',0.095,0.074),
  ('1コース まわり足 0.613 vs 0.477',0.613,0.477),('1コース 直線 0.564 vs 0.567',0.564,0.567),('1コース 直線 差0.03と仮定 0.58 vs 0.55',0.58,0.55),
  ('カド一撃 攻める4号艇: 全国の展示タイム並み 0.40 vs 0.22',0.40,0.22),('カド一撃: その半分 0.35 vs 0.26',0.35,0.26)]:
  P(f'{lab}: 各区分 {nneed(p1,p2):.0f}')
