"""探索的。直前情報8列あり／なしの1着モデルの対数損失差と、中心化 |SHAP| のテーマ別シェア。読み取りのみ"""
import sys, os, json, time, numpy as np, pandas as pd, lightgbm as lgb
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../ml/analogy'))
from themes import THEMES, FEATURES, CATEGORICAL, theme_features
from train import PARAMS
import metrics as M
A = os.environ['ANALOGY_DATA_DIR'].rstrip('/') + '/'  # boats.pkl と main_win_F5.txt
S = os.path.dirname(os.path.abspath(__file__)) + '/'
LIVE = ['exh_time', 'exh_time_diff', 'exh_time_rank', 'weather_code', 'wind_x', 'wind_y', 'wind_speed', 'wave_height']
TH = int(os.environ.get('TH', '4')); ROUNDS = 250; NSHAP = int(os.environ.get('NSHAP', '5000'))
t0 = time.time(); out = {'load_start': os.getloadavg(), 'threads': TH, 'rounds': ROUNDS}
df = pd.read_pickle(A + 'boats.pkl')
df = df[df['race_ok']].sort_values(['race_date', 'race_id', 'boat_number'])
df = df[df.groupby('race_id')['boat_number'].transform('size') == 6].reset_index(drop=True)
out['data_range'] = [str(df.race_date.min().date()), str(df.race_date.max().date())]
fit = df[(df.race_date >= '2025-06-01') & (df.race_date <= '2025-11-02')]
temp = df[(df.race_date >= '2025-11-03') & (df.race_date <= '2025-12-02')]
test = df[(df.race_date >= '2026-04-01') & (df.race_date <= '2026-09-30')]
n = lambda d: int(d.race_id.nunique())
out['periods'] = {'fit': ['2025-06-01', '2025-11-02', n(fit)], 'temp': ['2025-11-03', '2025-12-02', n(temp)], 'test': ['2026-04-01', '2026-09-30', n(test)]}
out['live_nan_rate'] = {k: {c: round(float(d[c].isna().mean()), 4) for c in LIVE} for k, d in [('fit', fit), ('test', test)]}
del df
print(json.dumps(out, ensure_ascii=False), flush=True)
y = M.winner_index(test); days = test.loc[test.boat_number == 1, 'race_date'].to_numpy()
models, res = {}, {}
for name, feats in [('with', FEATURES), ('without', [f for f in FEATURES if f not in LIVE])]:
    p = {k: v for k, v in {**PARAMS, 'seed': 0, 'num_threads': TH}.items() if v is not None}
    d = lgb.Dataset(fit[feats].astype('float32'), fit['y_win'], categorical_feature=[c for c in CATEGORICAL if c in feats], free_raw_data=True)
    m = lgb.train(p, d, ROUNDS); models[name] = (m, feats)
    zt = m.predict(temp[feats].astype('float32'), raw_score=True).reshape(-1, 6)
    t = M.fit_temperature(zt, M.winner_index(temp))
    z = m.predict(test[feats].astype('float32'), raw_score=True).reshape(-1, 6)
    ll = M.per_race_logloss(M.softmax_rows(z, t), y); ll1 = M.per_race_logloss(M.softmax_rows(z, 1.0), y)
    res[name] = {'temperature': t, 'll': ll, 'll_t1': ll1, 'top1': float((z.argmax(1) == y).mean())}
    print(name, round(float(ll.mean()), 5), f'{time.time()-t0:.0f}s', os.getloadavg(), flush=True)
pb = M.baseline_winner(fit, test); llb = M.per_race_logloss(pb, y)
out['logloss'] = {k: {'ll_temp': float(v['ll'].mean()), 'll_temp1': float(v['ll_t1'].mean()), 'temperature': v['temperature'], 'top1_acc': v['top1']} for k, v in res.items()}
out['logloss']['baseline1'] = float(llb.mean())
out['paired_without_minus_with'] = M.paired_ci(res['without']['ll'] - res['with']['ll'], days)
out['paired_without_minus_with_temp1'] = M.paired_ci(res['without']['ll_t1'] - res['with']['ll_t1'], days)
# 2026-04以降で直前情報が欠けていないレースに限った差
ok = ~test[LIVE[:3]].isna().any(axis=1).to_numpy().reshape(-1, 6).any(1)
out['paired_live_complete_races'] = M.paired_ci((res['without']['ll'] - res['with']['ll'])[ok], days[ok])
print(json.dumps(out['paired_without_minus_with']), flush=True)
# SHAP 中心化シェア（test の先頭から等間隔に NSHAP レース）
R = n(test); pick = np.linspace(0, R - 1, min(NSHAP, R)).astype(int)
rows = (pick[:, None] * 6 + np.arange(6)).ravel(); T = test.iloc[rows]
TK = [t['key'] for t in THEMES]
def shares(m, feats, X):
    c = m.predict(X[feats].astype('float32'), pred_contrib=True, num_threads=TH)[:, :-1].reshape(len(pick), 6, -1)
    c = c - c.mean(1, keepdims=True); a = np.abs(c).sum(1)
    th = np.stack([a[:, [feats.index(f) for f in theme_features(t) if f in feats]].sum(1) if any(f in feats for f in theme_features(t)) else np.zeros(len(a)) for t in THEMES], 1)
    return th / th.sum(1, keepdims=True)
sh = {}
sh['with'] = shares(*models['with'], T)
T2 = T.copy(); T2[LIVE] = np.nan
sh['with_live_nan'] = shares(*models['with'], T2)
sh['without'] = shares(*models['without'], T)
# 参考: 分析レーン main_win_F5 を正しい列順で／perrace.py と同じ FEATURES 順で
f5 = lgb.Booster(model_file=A + 'main_win_F5.txt'); fn = f5.feature_name()
def f5shares(X, order):
    Xa = X[order].astype('float32').to_numpy()
    c = f5.predict(Xa, pred_contrib=True, num_threads=TH)[:, :-1].reshape(len(pick), 6, -1)
    c = c - c.mean(1, keepdims=True); a = np.abs(c).sum(1)
    th = np.stack([a[:, [fn.index(f) for f in theme_features(t)]].sum(1) for t in THEMES], 1)
    return th / th.sum(1, keepdims=True)
sh['F5_correct_order'] = f5shares(T, fn); sh['F5_correct_order_live_nan'] = f5shares(T2, fn)
sh['F5_perrace_order'] = f5shares(T, FEATURES); sh['F5_perrace_order_live_nan'] = f5shares(T2, FEATURES)
out['shap_n_races'] = int(len(pick))
out['centered_share_mean'] = {k: dict(zip(TK, v.mean(0).round(4).tolist())) for k, v in sh.items()}
out['top1_rate'] = {k: {t: round(float(((-v).argsort(1)[:, 0] == i).mean()), 4) for i, t in enumerate(TK)} for k, v in sh.items()}
out['top1_same_with_vs_without'] = round(float(((-sh['with']).argsort(1)[:, 0] == (-sh['without']).argsort(1)[:, 0]).mean()), 4)
out['mean_abs_diff_with_vs_without'] = dict(zip(TK, np.abs(sh['with'] - sh['without']).mean(0).round(4).tolist()))
out['seconds'] = round(time.time() - t0); out['load_end'] = os.getloadavg()
json.dump(out, open(S + 'ablate.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
