# raw.json -> boats.pkl（艇単位）。オリジナル展示の項目は 一周/半周ラップ を「周回」にまとめ、レース内6艇の順位（小さい=速い=1位、同値は min）を付ける
import json, os, pandas as pd, numpy as np
from common import WORK

d = json.load(open(os.path.join(WORK, 'raw.json')))
races=pd.DataFrame(d['races']); res=pd.DataFrame(d['res']); st=pd.DataFrame(d['st']); ex=pd.DataFrame(d['exh']); ent=pd.DataFrame(d['ent'])
v=pd.DataFrame(d['oxv']); ox=pd.DataFrame(d['ox'])
v['item']=v.kind.replace({'一周':'lap','半周ラップ':'lap','まわり足':'mawari','直線':'straight'})
w=v.pivot_table(index=['race_id','boat_number'],columns='item',values='value',aggfunc='first').reset_index()
b=st[['race_id','boat_number','start_timing','is_flying','is_late_start','finish_rank','entry_course']].merge(
  ex[['race_id','boat_number','exhibition_time','start_timing','exhibition_course','is_absent']].rename(columns={'start_timing':'exh_st','is_absent':'ex_absent'}),on=['race_id','boat_number'],how='left')
b=b.merge(ent[['race_id','boat_number','grade','win_rate','motor_2rate']],on=['race_id','boat_number'],how='left')
b=b.merge(w,on=['race_id','boat_number'],how='left')
b=b.merge(races[['race_id','race_date','venue_code','race_number','race_grade']],on='race_id',how='left')
b=b.merge(res[['race_id','race_status','winning_technique','rank1']],on='race_id',how='left')
# レースの採用条件: 結果あり・返還なし(normal)・6艇とも着順(1..6)あり・F/L なし・進入コースあり
g=b.groupby('race_id')
ok=(g.size()==6)&g.finish_rank.apply(lambda s:s.notna().all() and set(s.astype(int))=={1,2,3,4,5,6}) \
   &g.is_flying.apply(lambda s:not s.fillna(False).any())&g.is_late_start.apply(lambda s:not s.fillna(False).any()) \
   &g.entry_course.apply(lambda s:s.notna().all())
okr=ok[ok].index
b=b[b.race_id.isin(okr)&(b.race_status=='normal')].copy()
for c in ['lap','mawari','straight','exhibition_time','win_rate','motor_2rate','start_timing']:
  full=b.groupby('race_id')[c].transform(lambda s:s.notna().all())
  b[c+'_rank']=np.where(full,b.groupby('race_id')[c].rank(method='min',ascending=(c not in ('win_rate','motor_2rate'))),np.nan)
  b[c+'_z']=np.where(full,(b[c]-b.groupby('race_id')[c].transform('mean'))/b.groupby('race_id')[c].transform('std').replace(0,np.nan),np.nan)
b['win']=(b.finish_rank==1).astype(int); b['top2']=(b.finish_rank<=2).astype(int); b['top3']=(b.finish_rank<=3).astype(int)
b['wakunari']=b.groupby('race_id').apply(lambda x:(x.entry_course==x.boat_number).all()).reindex(b.race_id).values
b.to_pickle(os.path.join(WORK, 'boats.pkl'))
print('races used',b.race_id.nunique(),'of results',len(res),'ox races',ox.race_id.nunique())
