"""会場・グレード・ラウンドごとの「6艇の差の大きさ」（中心化 |SHAP| の絶対量）を出す（探索的、2026-10-03）。

寄与度のシェアは合計1に正規化するので、条件を変えても形はほとんど変わらない。正規化する前の絶対量
（レース内で中心化した |SHAP| を6艇・テーマごとに足した値、log-odds の単位）を条件ごとに平均し、
六角形の「大きさ」が条件でどう変わるかを見る。モデルは finish_targets.py で学習した展示後の win・top3（縮小学習）。
入力: ANALOGY_DATA_DIR（boats.pkl）、FT_MODEL_DIR（exhib_win_s0.txt・exhib_top3_s0.txt）。
出力: docs/design/analogy-finder/analysis/perrace/venue-magnitude.json
"""
import json, os, sys
import numpy as np, pandas as pd, lightgbm as lgb
ROOT = os.path.dirname(os.path.abspath(__file__)) + '/../../..'
sys.path.insert(0, ROOT + '/scripts/ml/analogy')
from themes import THEMES, theme_features  # noqa: E402

A = os.environ['ANALOGY_DATA_DIR'].rstrip('/') + '/'
MD = os.environ['FT_MODEL_DIR'].rstrip('/') + '/'
df = pd.read_pickle(A + 'boats.pkl')
df = df[df['race_ok']].sort_values(['race_date', 'race_id', 'boat_number'])
df = df[df.groupby('race_id')['boat_number'].transform('size') == 6]
test = df[(df.race_date >= '2026-04-01') & (df.race_date <= '2026-09-30')].reset_index(drop=True)
n = len(test) // 6
r1 = test[test.boat_number == 1].reset_index(drop=True)
GR = {0: 'ippan', 1: 'G3', 2: 'G2', 3: 'G1', 4: 'SG'}
RD = {0: 'yosen', 1: 'junyu', 2: 'yusho', 3: 'other'}
out = {'note': '探索的（事前登録なし）。値は中心化 |SHAP| の6艇合計のレース平均（log-odds）。shares は正規化した割合',
       'population': f'test 2026-04-01〜09-30 の完全レース {n}R', 'models': 'finish_targets.py の exhib_*_s0（縮小学習）'}
for tgt in ('win', 'top3'):
    m = lgb.Booster(model_file=MD + f'exhib_{tgt}_s0.txt')
    fn = m.feature_name()
    c = m.predict(test[fn].astype('float32'), pred_contrib=True, num_threads=4)[:, :-1].reshape(n, 6, -1)
    c = c - c.mean(1, keepdims=True)
    ab = np.abs(c).sum(1)
    th = np.stack([ab[:, [fn.index(f) for f in theme_features(t) if f in fn]].sum(1) for t in THEMES], 1)
    keys = [t['key'] for t in THEMES]
    def summ(mask):
        x = th[mask]
        return {'n_races': int(mask.sum()), 'total': round(float(x.sum(1).mean()), 3),
                'abs': dict(zip(keys, np.round(x.mean(0), 3).tolist())),
                'shares': dict(zip(keys, np.round(x.mean(0) / x.mean(0).sum(), 3).tolist())),
                'b1_win_rate': round(float((r1.loc[mask, 'finish_rank'] == 1).mean()), 3)}
    res = {'all': summ(np.ones(n, bool))}
    res['venue'] = {int(v): summ((r1.venue_code == v).to_numpy()) for v in sorted(r1.venue_code.unique())}
    res['grade'] = {GR.get(int(g), str(g)): summ((r1.grade_code == g).to_numpy()) for g in sorted(r1.grade_code.dropna().unique())}
    res['round'] = {RD.get(int(g), str(g)): summ((r1.round_code == g).to_numpy()) for g in sorted(r1.round_code.dropna().unique())}
    out[tgt] = res
# 会場×艇番の1着率（枠の説明用）
out['win_rate_by_venue_boat'] = {int(v): g.groupby('boat_number')['finish_rank'].apply(lambda s: round(float((s == 1).mean()), 3)).to_dict()
                                  for v, g in test.groupby('venue_code')}
p = ROOT + '/docs/design/analogy-finder/analysis/perrace/venue-magnitude.json'
json.dump(out, open(p, 'w'), ensure_ascii=False, indent=1)
w = out['win']['venue']
print('all', out['win']['all']['total'])
for v, s in sorted(w.items(), key=lambda kv: -kv[1]['total']):
    print(v, s['n_races'], s['total'], s['b1_win_rate'], s['abs']['venueCourse'], s['abs']['racerRecord'])
print('grade', {k: v['total'] for k, v in out['win']['grade'].items()})
print('round', {k: v['total'] for k, v in out['win']['round'].items()})
print('wakamatsu', out['win_rate_by_venue_boat'][20])
