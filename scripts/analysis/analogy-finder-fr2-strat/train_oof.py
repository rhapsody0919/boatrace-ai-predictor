"""F5'（出走表時点のみ）と F5（元の入力）の P を out-of-fold で作る。
pool(=pool_cal) を日単位の連続5ブロックに分け、各ブロックは他4ブロックで学習したモデルで予測。
cal・test は pool 全体で学習したモデルで予測。設定は F5 と同じ（num_leaves31, min_data500, 木313本固定,
学習レースの35%を無作為抽出）。温度は pool の OOF 生スコアで1つ合わせ、cal/test にも同じ温度を使う。
使い方: python train_oof.py F5p|F5
"""
import sys, json, time
import numpy as np, pandas as pd, lightgbm as lgb
sys.path.insert(0, '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/recursing-poincare-93292f/scripts/analysis/analogy-finder-phase-m')
import common as C

SIM = '/private/tmp/claude-501/-Users-terukina-boatrace-ai-predictor/f1ed2ade-b10e-4818-840e-88a5453a7589/scratchpad/sim/'
VAR = sys.argv[1]
DROP = ['exh_time', 'exh_time_diff', 'exh_time_rank', 'weather_code', 'wind_x', 'wind_y', 'wind_speed', 'wave_height']
FEATS = [f for f in C.BASE_FEATURES if (VAR == 'F5' or f not in DROP)]
PARAMS = {**C.DEFAULT_PARAMS, 'num_leaves': 31, 'min_data_in_leaf': 500, 'num_threads': 4}
NTREE = 313; FRAC = 0.35

t0 = time.time()
R = pd.read_pickle(SIM + 'R.pkl')[['race_id', 'race_date', 'period', 'win_boat']]
df = pd.read_pickle(C.D / 'boats.pkl')
df = df[list(dict.fromkeys(['race_id', 'race_date', 'boat_number', 'race_ok', 'y_win'] + C.BASE_FEATURES))]
df = C.complete_races(df)
df = df[df.race_id.isin(set(R.race_id))].reset_index(drop=True)
rid = df.race_id.to_numpy().reshape(-1, 6)[:, 0]
assert (rid == R.race_id.values).all()
print('loaded', len(R), round(time.time() - t0), flush=True)
per = R.period.to_numpy()
pool = np.where(per == 'pool_cal')[0]
days = np.sort(R.race_date.iloc[pool].unique())
blocks = np.array_split(days, 5)
blk = np.full(len(R), -1)
for b, ds in enumerate(blocks):
    blk[pool[np.isin(R.race_date.values[pool], ds)]] = b
X = df[FEATS].astype(np.float32).to_numpy()
y = df.y_win.to_numpy()
Z = np.full((len(R), 6), np.nan, np.float32)
rng = np.random.default_rng(0)
cats = [c for c in C.CATEGORICAL if c in FEATS]


def train(race_idx):
    sel = np.sort(rng.choice(race_idx, int(len(race_idx) * FRAC), replace=False))
    rows = (sel[:, None] * 6 + np.arange(6)).ravel()
    d = lgb.Dataset(X[rows], y[rows], feature_name=FEATS, categorical_feature=cats, free_raw_data=True)
    return lgb.train(PARAMS, d, NTREE), len(sel)


def predict(m, race_idx):
    rows = (race_idx[:, None] * 6 + np.arange(6)).ravel()
    return m.predict(X[rows], raw_score=True, num_threads=4).reshape(-1, 6)


info = {'variant': VAR, 'features': FEATS, 'ntree': NTREE, 'frac': FRAC, 'blocks': [[str(b[0])[:10], str(b[-1])[:10]] for b in blocks]}
for b in range(5):
    tr = pool[blk[pool] != b]; te = pool[blk[pool] == b]
    m, n = train(tr)
    Z[te] = predict(m, te)
    print('fold', b, 'train races used', n, round(time.time() - t0), flush=True)
m, n = train(pool)
info['full_train_races_used'] = n
ct = np.where(np.isin(per, ['cal', 'test']))[0]
Z[ct] = predict(m, ct)
w = R.win_boat.to_numpy() - 1
T = C.fit_temperature(Z[pool].astype(float), w[pool])
P = C.softmax_rows(Z.astype(float), T)
info['temperature'] = T
for p in ['pool_cal', 'cal', 'test']:
    i = per == p
    info[f'win_ll_{p}'] = float(-np.log(P[i][np.arange(i.sum()), w[i]]).mean())
np.save(f'Z_{VAR}.npy', Z); np.save(f'P_{VAR}.npy', P.astype(np.float32))
json.dump(info, open(f'train_{VAR}.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in info.items() if k != 'features'}, ensure_ascii=False), round(time.time() - t0), flush=True)
