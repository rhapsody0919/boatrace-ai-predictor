import sys, os, json, time, numpy as np, pandas as pd, lightgbm as lgb
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../ml/analogy'))
from themes import FEATURES
A = os.environ['ANALOGY_DATA_DIR'].rstrip('/') + '/'  # boats.pkl と main_win_F5.txt
S=os.path.dirname(os.path.abspath(__file__))+'/'
out={'lightgbm':lgb.__version__,'numpy':np.__version__,'load_before':os.getloadavg()}
t=time.time(); m=lgb.Booster(model_file=A+'main_win_F5.txt'); out['model_load_s']=time.time()-t
out['n_trees']=m.num_trees(); out['features_match']=m.feature_name()==FEATURES; out['n_feat']=len(m.feature_name())
d=m.dump_model()
def depth(n): return 0 if 'leaf_value' in n else 1+max(depth(n['left_child']),depth(n['right_child']))
ds=[depth(t['tree_structure']) for t in d['tree_info']]
out['depth_mean']=float(np.mean(ds)); out['depth_max']=int(max(ds)); out['depth_p50']=float(np.median(ds))
lv=[t['num_leaves'] for t in d['tree_info']]; out['leaves_total']=int(sum(lv)); out['leaves_max']=int(max(lv))
js=json.dumps(d); out['json_dump_bytes']=len(js)
open(S+'model_dump.json','w').write(js)
import gzip; out['txt_gzip_bytes']=len(gzip.compress(open(A+'main_win_F5.txt','rb').read())); out['json_gzip_bytes']=len(gzip.compress(js.encode()))
if not os.path.exists(S+'sample.pkl'):
    df=pd.read_pickle(A+'boats.pkl')
    df=df[df['race_ok']&(df['race_date']>='2026-04-01')].sort_values(['race_id','boat_number'])
    df=df[df.groupby('race_id')['boat_number'].transform('size')==6]
    df.iloc[:6*400][FEATURES].to_pickle(S+'sample.pkl')
X=pd.read_pickle(S+'sample.pkl').astype('float32')
for nm,n in [('1R',6),('168R',1008)]:
    Xs=X.iloc[:n]; Xa=Xs.to_numpy()
    m.predict(Xa,pred_contrib=True)
    for kind,kw in [('predict',{}),('contrib',{'pred_contrib':True})]:
        ts=[]
        for _ in range(20 if n==6 else 5):
            t=time.perf_counter(); m.predict(Xa,num_threads=1,**kw); ts.append(time.perf_counter()-t)
        out[f'{nm}_{kind}_1thread_median_ms']=float(np.median(ts)*1000); out[f'{nm}_{kind}_1thread_min_ms']=float(np.min(ts)*1000)
out['load_after']=os.getloadavg()
json.dump(out,open(S+'timing.json','w'),indent=1); print(json.dumps(out,indent=1))
