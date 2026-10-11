# boats.pkl -> 母数・順位ごとの着順率・相関・展示タイムとの組み合わせ・条件付きロジット・時系列の分割（節 0〜3d）
# 結果は stdout と data/analysis/original-exhibition/result-logit.json。次の analyze2.py 用に boats_f.pkl を保存
import pandas as pd, numpy as np, os, json, hashlib
from scipy.optimize import minimize
from scipy.stats import spearmanr
from common import WORK, OUT_DIR, VEN, ITEMS, JA, wil, fmt, grp

b=pd.read_pickle(os.path.join(WORK,'boats.pkl'))
P=print
P('## 0 母数'); P('採用レース',b.race_id.nunique(),'期間',b.race_date.min(),b.race_date.max(),'日数',b.race_date.nunique())
for it in ITEMS+['exhibition_time']:
  P(it,'6艇そろうR',b[b[it+'_rank'].notna()].race_id.nunique())
P('\n## 1 会場別×項目別 6艇そろうレース数')
tab=b.groupby('venue_code').apply(lambda x:pd.Series({it:x[x[it+'_rank'].notna()].race_id.nunique() for it in ITEMS}|{'採用R':x.race_id.nunique(),'日数':x.race_date.nunique()}),include_groups=False)
tab.index=[VEN[i] for i in tab.index]; P(tab.to_string())
P('\n同値の扱い: rank(method=min)。1位が2艇以上のレースの割合')
for it in ITEMS+['exhibition_time']:
  x=b[b[it+'_rank'].notna()]; t=x[x[it+'_rank']==1].groupby('race_id').size(); P(it, f"{(t>1).mean():.3f}", '平均1位艇数',f"{t.mean():.2f}")
P('\n## 2 順位ごとの着順率（全艇 / 1号艇 / 2〜6号艇、進入コース別）')
for it in ITEMS+['exhibition_time']:
  x=b[b[it+'_rank'].notna()]
  P(f'\n### {JA[it]}（{x.race_id.nunique()}R）')
  rows=[]
  for rk in range(1,7):
    s=x[x[it+'_rank']==rk]; rows.append([rk,len(s),fmt(s.win.sum(),len(s)),fmt(s.top2.sum(),len(s)),fmt(s.top3.sum(),len(s))])
  P(pd.DataFrame(rows,columns=['順位','艇数','1着率','2着以内','3着以内']).to_string(index=False))
  for lab,m in [('1コース',x.entry_course==1),('2〜6コース',x.entry_course>=2)]+[(f'{c}コース',x.entry_course==c) for c in range(2,7)]:
    y=x[m]; rows=[]
    for gname in ['上位1-2','中位3-4','下位5-6']:
      s=y[grp(y[it+'_rank'])==gname]; rows.append(f"{gname}: 1着 {fmt(s.win.sum(),len(s))} / 3着内 {wil(s.top3.sum(),len(s))[0]:.3f}")
    P(f'  [{lab}] '+' | '.join(rows))
P('\n## 3a 相関（レース内のSpearman、レースごとに計算した平均と、レース内z の全体相関）')
V=['lap','mawari','straight','exhibition_time']
for i in range(4):
  for j in range(i+1,4):
    a,c=V[i],V[j]; x=b[b[a+'_rank'].notna()&b[c+'_rank'].notna()]
    rr=[spearmanr(g[a],g[c])[0] for _,g in x.groupby('race_id') if g[a].nunique()>1 and g[c].nunique()>1]
    zz=np.corrcoef(x[a+'_z'],x[c+'_z'])[0,1]
    P(f'{JA[a]} × {JA[c]}: 平均ρ={np.nanmean(rr):.3f}（{len(rr)}R） 全体z相関={zz:.3f}')
# 勝率・モーター2連率との相関は欠けを除いた値を analyze2.py で出す（ここの勝率の値は同じ、モーターは欠けがあり nan になる）
for it in ITEMS:
  x=b[b[it+'_rank'].notna()&b.win_rate_rank.notna()]
  P(f'{JA[it]} × 勝率 z相関={np.corrcoef(-x[it+"_z"],x.win_rate_z)[0,1]:.3f}')
P('\n## 3b 展示タイム順位区分 × 項目順位区分 の1着率（2〜6コース / 1コース）')
for it in ITEMS:
  x=b[b[it+'_rank'].notna()&b.exhibition_time_rank.notna()].copy(); x['eg']=grp(x.exhibition_time_rank); x['og']=grp(x[it+'_rank'])
  for lab,m in [('1コース',x.entry_course==1),('2〜6コース',x.entry_course>=2)]:
    P(f'\n### {JA[it]} [{lab}] 行=展示タイム区分 列={JA[it]}区分')
    y=x[m]; T=pd.DataFrame({og:{eg:fmt(y[(y.eg==eg)&(y.og==og)].win.sum(),((y.eg==eg)&(y.og==og)).sum()) for eg in ['上位1-2','中位3-4','下位5-6']} for og in ['上位1-2','中位3-4','下位5-6']})
    P(T.to_string())
# 条件付きロジット（6艇softmax）
def fit(df,feats):
  df=df.sort_values(['race_id','boat_number']); X=df[feats].to_numpy(float).reshape(-1,6,len(feats)); y=df.win.to_numpy().reshape(-1,6)
  def nll(w):
    s=X@w; s=s-s.max(1,keepdims=True); ls=s-np.log(np.exp(s).sum(1,keepdims=True)); p=np.exp(ls)
    return -(ls*y).sum(), -((y-p)[:,:,None]*X).sum((0,1))
  r=minimize(nll,np.zeros(len(feats)),jac=True,method='BFGS')
  return r.x,X,y
def race_ll(w,X,y):
  s=X@w; s=s-s.max(1,keepdims=True); ls=s-np.log(np.exp(s).sum(1,keepdims=True)); return -(ls*y).sum(1)
rng=np.random.default_rng(0)
def bootcoef(df,feats,B=300):
  w0,_,_=fit(df,feats); bs=[]
  # 日単位ブートストラップ（同じ日の会場・レースの相関を残す）
  days=df.race_date.unique(); gd={k:v for k,v in df.groupby('race_date')}
  for _ in range(B):
    pick=rng.choice(days,len(days)); parts=[]
    for i,dd in enumerate(pick): t=gd[dd].copy(); t['race_id']=t.race_id+f'#{i}'; parts.append(t)
    bs.append(fit(pd.concat(parts),feats)[0])
  bs=np.array(bs); return w0,np.percentile(bs,2.5,0),np.percentile(bs,97.5,0)
P('\n## 3c 条件付きロジット（レース内6艇softmax、1着）。特徴量は「速いほど+」に符号をそろえたレース内z（±3で切る）。CIは日単位ブートストラップ300回')
for c in range(2,7): b[f'c{c}']=(b.entry_course==c).astype(float)
for c in ['lap','mawari','straight','exhibition_time','win_rate','motor_2rate']:
  sg=-1 if c in ('lap','mawari','straight','exhibition_time') else 1
  b[c+'_f']=(sg*b[c+'_z']).clip(-3,3)
CO=[f'c{c}' for c in range(2,7)]
res3={}
for it in ITEMS:
  x=b[b[it+'_z'].notna()&b.exhibition_time_z.notna()].copy()
  x[it+'_f']=x[it+'_f'].fillna(0); x['exhibition_time_f']=x.exhibition_time_f.fillna(0)
  hasctl=x.groupby('race_id').win_rate_z.transform(lambda s:s.notna().all())&x.groupby('race_id').motor_2rate_z.transform(lambda s:s.notna().all())
  for name,feats,dd in [('単独(コース+項目)',CO+[it+'_f'],x),('展示タイムをそろえる',CO+['exhibition_time_f',it+'_f'],x),
                        ('展示+勝率+モーター',CO+['exhibition_time_f','win_rate_f','motor_2rate_f',it+'_f'],x[hasctl]),
                        ('参考: 展示タイムだけ',CO+['exhibition_time_f'],x)]:
    w,l,u=bootcoef(dd,feats); k=len(feats)-1
    P(f'{JA[it]} [{name}] R={dd.race_id.nunique()} 係数={w[k]:+.3f} [{l[k]:+.3f}, {u[k]:+.3f}]  オッズ比/1SD={np.exp(w[k]):.2f}'+ (f'  (展示タイム係数 {w[5]:+.3f} [{l[5]:+.3f},{u[5]:+.3f}])' if 'exhibition_time_f' in feats and k!=5 else ''))
    res3[f'{it}|{name}']={'coef':float(w[k]),'ci95':[float(l[k]),float(u[k])],'races':int(dd.race_id.nunique())}
  # 1コースとそれ以外で別の傾き
  x['it_c1']=x[it+'_f']*(x.entry_course==1); x['it_out']=x[it+'_f']*(x.entry_course!=1)
  w,l,u=bootcoef(x,CO+['exhibition_time_f','it_c1','it_out'])
  P(f'   └ 展示タイムをそろえた上で 1コース={w[6]:+.3f} [{l[6]:+.3f},{u[6]:+.3f}] / 2〜6コース={w[7]:+.3f} [{l[7]:+.3f},{u[7]:+.3f}]')
  res3[f'{it}|展示タイムをそろえる|1コース']={'coef':float(w[6]),'ci95':[float(l[6]),float(u[6])],'races':int(x.race_id.nunique())}
  res3[f'{it}|展示タイムをそろえる|2〜6コース']={'coef':float(w[7]),'ci95':[float(l[7]),float(u[7])],'races':int(x.race_id.nunique())}
P('\n## 3d 時系列の分割（学習 〜10/03 / 検証 10/04〜）での対数損失の差（込み−抜き、1レースあたり nats、負=改善）')
for it in ITEMS:
  x=b[b[it+'_z'].notna()&b.exhibition_time_z.notna()].copy(); x[it+'_f']=x[it+'_f'].fillna(0); x['exhibition_time_f']=x.exhibition_time_f.fillna(0)
  tr=x[x.race_date<='2026-10-03']; te=x[x.race_date>'2026-10-03']
  f0=CO+['exhibition_time_f']; f1=f0+[it+'_f']
  w0,_,_=fit(tr,f0); w1,_,_=fit(tr,f1)
  _,X0,y0=fit(te,f0); _,X1,y1=fit(te,f1)  # 行列を作るため（係数は使わない）
  d=race_ll(w1,X1,y1)-race_ll(w0,X0,y0)
  bs=[d[rng.integers(0,len(d),len(d))].mean() for _ in range(2000)]
  P(f'{JA[it]}: 学習{tr.race_id.nunique()}R 検証{te.race_id.nunique()}R 差={d.mean():+.4f} [{np.percentile(bs,2.5):+.4f}, {np.percentile(bs,97.5):+.4f}]  (抜きLL={race_ll(w0,X0,y0).mean():.4f})')
raw=os.path.join(WORK,'raw.json')
meta={'races':int(b.race_id.nunique()),'boats':int(len(b)),'date_min':str(b.race_date.min()),'date_max':str(b.race_date.max()),
      'raw_sha256':hashlib.sha256(open(raw,'rb').read()).hexdigest(),'raw_fetched_at':json.load(open(raw)).get('fetched_at')}
json.dump({'dataset':meta,'logit':res3},open(os.path.join(OUT_DIR,'result-logit.json'),'w'),ensure_ascii=False,indent=1)
b.to_pickle(os.path.join(WORK,'boats_f.pkl'))
