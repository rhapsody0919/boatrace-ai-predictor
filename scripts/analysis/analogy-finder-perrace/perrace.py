"""探索的（事前登録なし・記述のみ）。レースごとの寄与度（テーマ別）がどれだけ変わるか。モデルは分析レーンの main_win_F5（FR-1 と同じ44特徴量）。
読み取りのみ。test 2026-04-01〜09-30 の完全レース"""
import sys, json, time, numpy as np, pandas as pd, lightgbm as lgb
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../ml/analogy'))
from themes import THEMES, FEATURES, theme_features
# 入力: ANALOGY_DATA_DIR（boats.pkl と main_win_F5.txt。features.py の出力と分析レーンの F5 モデル）
D = os.environ['ANALOGY_DATA_DIR'].rstrip('/') + '/'
OUT = os.environ.get('PERRACE_OUT', 'perrace.json')
cols = ['race_id', 'race_date', 'boat_number', 'race_ok', 'venue_code', 'grade', 'round'] + [f for f in FEATURES if f not in ('boat_number', 'venue_code')]
df = pd.read_pickle(D + 'boats.pkl')
df = df[df['race_ok'] & (df['race_date'] >= '2026-04-01') & (df['race_date'] <= '2026-09-30')]
df = df.sort_values(['race_id', 'boat_number'])
df = df[df.groupby('race_id')['boat_number'].transform('size') == 6]
m = lgb.Booster(model_file=D + 'main_win_F5.txt')
X = df[FEATURES].astype('float32')
R = len(df) // 6
TK = [t['key'] for t in THEMES]
idx = {t['key']: [FEATURES.index(f) for f in theme_features(t)] for t in THEMES}
LIVE = ['exh_time', 'exh_time_diff', 'exh_time_rank', 'weather_code', 'wind_x', 'wind_y', 'wind_speed', 'wave_height']

def shares(Xm, centered):
    c = m.predict(Xm, pred_contrib=True)[:, :-1].reshape(R, 6, -1)
    if centered: c = c - c.mean(1, keepdims=True)
    a = np.abs(c).sum(1)                              # R × F
    th = np.stack([a[:, idx[k]].sum(1) for k in TK], 1)
    return th / th.sum(1, keepdims=True)

out = {'n_races': R}
for name, cen in [('uncentered', False), ('centered', True)]:
    S = shares(X, cen)
    rank = (-S).argsort(1)
    out[name] = {
        'mean': dict(zip(TK, S.mean(0).round(4).tolist())),
        'p10': dict(zip(TK, np.percentile(S, 10, 0).round(4).tolist())),
        'p90': dict(zip(TK, np.percentile(S, 90, 0).round(4).tolist())),
        'top1_rate': {k: round(float((rank[:, 0] == i).mean()), 4) for i, k in enumerate(TK)},
        'top2_rate': {k: round(float(((rank[:, 0] == i) | (rank[:, 1] == i)).mean()), 4) for i, k in enumerate(TK)},
        'top3_rate': {k: round(float((rank[:, :3] == i).any(1).mean()), 4) for i, k in enumerate(TK)},
    }
    if cen:
        Sc = S
# 出走表時点: 直前情報の列を欠損にして計算し直す（中心化）
X2 = X.copy(); X2[LIVE] = np.nan
S2 = shares(X2, True)
r1 = (-Sc).argsort(1)[:, 0]; r2 = (-S2).argsort(1)[:, 0]
out['racecard_vs_full_centered'] = {
    'mean_racecard': dict(zip(TK, S2.mean(0).round(4).tolist())),
    'top1_same_rate': round(float((r1 == r2).mean()), 4),
    'mean_abs_diff': dict(zip(TK, np.abs(S2 - Sc).mean(0).round(4).tolist())),
    'top1_rate_racecard': {k: round(float((r2 == i).mean()), 4) for i, k in enumerate(TK)},
}
# 計算時間: 168R 分（1,008艇）× 3本相当
Xs = X.iloc[:1008]
t = time.time()
for _ in range(3): m.predict(Xs, pred_contrib=True)
out['seconds_168R_x3models'] = round(time.time() - t, 2)
out['scale'] = 'full'
out['data'] = {'boats_pkl_mtime': 'data/ml/analogy/boats.pkl (2026-10-01 17:05)', 'model': 'main_win_F5.txt（44特徴量、FR-1 と同じ）', 'period': '2026-04-01〜2026-09-30（test）'}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
