"""探索的（事前登録なし）。BOA-271 案a「レース単位のモデル（6艇分の特徴量 → 1着の艇）＋ SHAP で他艇の寄与を見せる」が成り立つかの計算。

1. 今の艇単位モデル（展示後 win、44列）の SHAP のうち、他艇の情報を含む特徴量（*_diff・*_rank・b1_*）に乗っているシェア
2. レース単位の LightGBM multiclass（6クラス＝1着の艇番）。特徴量は b{k}_<艇ごとの生の値>（k=1..6）とレース共通の値1回ずつ。
   レース内の相対値（*_diff・*_rank・b1_*）は入れない。対数損失を艇単位モデルと比べ、クラス k の SHAP を
   自艇／他艇／レース共通に分ける。seed を変えた安定性と、優勝戦×G2以上に絞った小標本の揺れ
3. 費用（学習時間・推論＋SHAP の時間・サイズ）と、JS の TreeSHAP（treeshap.mjs）にクラスごとの木を渡したときの一致

期間・データは finish_targets.py と同じ（学習 2025-06-01〜11-02、温度合わせ 2025-11-03〜12-02、test 2026-04-01〜09-30 の完全レース）。
木の数は、学習期間の最後の1か月（2025-10-03〜11-02）を検証にした早期終了で決め、学習期間全体で学習し直す。
読み取りのみ（データディレクトリには書かない）。

入力: ANALOGY_DATA_DIR（boats.pkl）、FT_MODEL_DIR（finish_targets.py が保存した艇単位モデル。無ければ同じ設定で学習する）。
任意: RL_MODEL_DIR（レース単位モデルの置き場、既定は FT_MODEL_DIR）、TH、NSHAP（既定 5000）
出力: docs/design/analogy-finder/analysis/perrace/race-level.json
"""
import sys, os, json, time, gzip, subprocess
import numpy as np, pandas as pd, lightgbm as lgb

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '../../ml/analogy'))
from themes import THEMES, FEATURES, CATEGORICAL, theme_features  # noqa: E402
from train import PARAMS, TARGETS  # noqa: E402
import metrics as M  # noqa: E402

A = os.environ['ANALOGY_DATA_DIR'].rstrip('/') + '/'
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
OUTF = os.path.join(ROOT, 'docs/design/analogy-finder/analysis/perrace/race-level.json')
FTMD = os.environ['FT_MODEL_DIR'].rstrip('/') + '/'
MD = os.environ.get('RL_MODEL_DIR', FTMD).rstrip('/') + '/'
os.makedirs(MD, exist_ok=True)
load0 = os.getloadavg()
TH = int(os.environ.get('TH', '6' if load0[0] <= 30 else '2'))
NSHAP = int(os.environ.get('NSHAP', '5000'))
TK = [t['key'] for t in THEMES]
THEME_OF = {f: t['key'] for t in THEMES for f in theme_features(t)}
ROUNDS = {n: r for n, _, _, r in TARGETS}
LIVE = ['exh_time', 'exh_time_diff', 'exh_time_rank', 'weather_code', 'wind_x', 'wind_y', 'wind_speed', 'wave_height']

# 艇単位モデルの44列の分類
OTHER_INFO = [f for f in FEATURES if f.endswith('_diff') or f.endswith('_rank') or f.startswith('b1_')]
COMMON = ['venue_code', 'race_number', 'weather_code', 'wind_x', 'wind_y', 'wind_speed', 'wave_height',
          'grade_code', 'round_code', 'series_day', 'is_final_day_num']
OWN = [f for f in FEATURES if f not in OTHER_INFO and f not in COMMON]  # boat_number を含む17列
OWN_RL = [f for f in OWN if f != 'boat_number']  # レース単位では艇番は列の位置で決まる
assert len(OTHER_INFO) + len(COMMON) + len(OWN) == len(FEATURES) == 44
RL_FEATS = COMMON + [f'b{k}_{f}' for k in range(1, 7) for f in OWN_RL]
RL_CAT = [c for c in COMMON if c in CATEGORICAL] + [f'b{k}_{f}' for k in range(1, 7) for f in OWN_RL if f in CATEGORICAL]


def rl_theme(f):
    return THEME_OF[f.split('_', 1)[1] if f[0] == 'b' and f[1].isdigit() and f[2] == '_' else f]


def rl_boat(f):
    return int(f[1]) if f[0] == 'b' and f[1].isdigit() and f[2] == '_' else 0  # 0＝レース共通


t0 = time.time()
out = {'note': '探索的分析（事前登録なし）。記述のみで、仮説検定の結論としては使わない。test 期間は finish_targets.py と同じ（使い回し3回目）',
       'load_start': load0, 'threads': TH, 'lightgbm': lgb.__version__,
       'feature_classes_boat_model': {'other_boat_info': OTHER_INFO, 'race_common': COMMON, 'own': OWN,
                                      'note': 'other_boat_info＝レース内の平均との差（*_diff）・順位（*_rank）・1号艇の値を全艇に配る b1_*。1号艇では b1_* は自艇の値'},
       'race_level_features': {'n': len(RL_FEATS), 'common': COMMON, 'per_boat': OWN_RL, 'categorical': RL_CAT}}


def r4(x, d=4):
    if isinstance(x, dict): return {k: r4(v, d) for k, v in x.items()}
    if isinstance(x, np.ndarray): x = x.tolist()
    if isinstance(x, (list, tuple)): return [r4(v, d) for v in x]
    if isinstance(x, (float, np.floating)): return round(float(x), d)
    if isinstance(x, np.integer): return int(x)
    return x


def log(*a):
    print(f'[{time.time() - t0:6.0f}s load {os.getloadavg()[0]:.1f}]', *a, flush=True)


# ---------- データ ----------
df = pd.read_pickle(A + 'boats.pkl')
df = df[df['race_ok']].sort_values(['race_date', 'race_id', 'boat_number'])
df = df[df.groupby('race_id')['boat_number'].transform('size') == 6].reset_index(drop=True)
fit = df[(df.race_date >= '2025-06-01') & (df.race_date <= '2025-11-02')].reset_index(drop=True)
temp = df[(df.race_date >= '2025-11-03') & (df.race_date <= '2025-12-02')].reset_index(drop=True)
test = df[(df.race_date >= '2026-04-01') & (df.race_date <= '2026-09-30')].reset_index(drop=True)
out['data'] = {'boats_pkl': A + 'boats.pkl',
               'boats_pkl_mtime': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(os.path.getmtime(A + 'boats.pkl')))}
del df
nR = lambda d: int(d.race_id.nunique())  # noqa: E731
out['periods'] = {'fit': ['2025-06-01', '2025-11-02', nR(fit)], 'temp': ['2025-11-03', '2025-12-02', nR(temp)],
                  'test': ['2026-04-01', '2026-09-30', nR(test)]}
log(out['periods'])
for d_ in (fit, temp, test):
    assert (d_.boat_number.to_numpy().reshape(-1, 6) == np.arange(1, 7)).all()

# レース共通の列が本当にレース内で同じか
chk = {}
for c in COMMON:
    g = test.groupby('race_id', sort=False)[c]
    chk[c] = int((g.nunique(dropna=False) > 1).sum())
out['race_common_check_test_races_with_varying_value'] = chk


def to_race(d):
    n = len(d) // 6
    own = d[OWN_RL].to_numpy(dtype='float32').reshape(n, 6, len(OWN_RL)).reshape(n, -1)
    com = d.loc[d.boat_number == 1, COMMON].to_numpy(dtype='float32')
    X = pd.DataFrame(np.hstack([com, own]), columns=RL_FEATS)
    return X, M.winner_index(d)


Xfit, yfit = to_race(fit)
Xtemp, ytemp = to_race(temp)
Xtest, ytest = to_race(test)
fit_days = fit.loc[fit.boat_number == 1, 'race_date'].to_numpy()
days = test.loc[test.boat_number == 1, 'race_date'].to_numpy()
R = len(ytest)
log('pivot done', Xfit.shape, Xtest.shape)

# ---------- 2. レース単位モデルの学習 ----------
BASE = {k: v for k, v in PARAMS.items() if k not in ('objective', 'num_threads') and v is not None}
BASE.update(objective='multiclass', num_class=6, num_threads=TH)
inner = fit_days < np.datetime64('2025-10-03')
grid = []
t_grid = time.time()
for mdl in (50, 200, 500):
    p = {**BASE, 'min_data_in_leaf': mdl, 'seed': 0}
    dtr = lgb.Dataset(Xfit[inner], yfit[inner], categorical_feature=RL_CAT, free_raw_data=False)
    dva = lgb.Dataset(Xfit[~inner], yfit[~inner], categorical_feature=RL_CAT, reference=dtr, free_raw_data=False)
    ev = {}
    m = lgb.train(p, dtr, 2000, valid_sets=[dva], callbacks=[lgb.early_stopping(50, verbose=False), lgb.record_evaluation(ev)])
    grid.append({'min_data_in_leaf': mdl, 'best_iteration': m.best_iteration,
                 'valid_multi_logloss': float(ev['valid_0']['multi_logloss'][m.best_iteration - 1])})
    log('grid', grid[-1])
t_grid = time.time() - t_grid
best = min(grid, key=lambda g: g['valid_multi_logloss'])
out['race_level_training'] = {
    'params': {k: v for k, v in BASE.items() if k != 'num_threads'}, 'grid': r4(grid, 5), 'chosen': best,
    'early_stopping': '学習期間の 2025-06-01〜10-02 で学習、2025-10-03〜11-02 を検証にして早期終了（50回）。'
                      '選んだ min_data_in_leaf と木の数で、学習期間全体（2025-06-01〜11-02）で学習し直す',
    'n_races': {'inner_train': int(inner.sum()), 'inner_valid': int((~inner).sum()), 'fit': int(len(yfit))},
    'grid_seconds': round(t_grid, 1)}


def get_rl(seed):
    path = MD + f'race_level_s{seed}.txt'
    if os.path.exists(path):
        return lgb.Booster(model_file=path), None
    p = {**BASE, 'min_data_in_leaf': best['min_data_in_leaf'], 'seed': seed}
    t = time.time()
    m = lgb.train(p, lgb.Dataset(Xfit, yfit, categorical_feature=RL_CAT, free_raw_data=False), best['best_iteration'])
    sec = time.time() - t
    m.save_model(path)
    return m, sec


RL = {}
for s in (0, 1):
    RL[s], sec = get_rl(s)
    out['race_level_training'][f'fit_seconds_s{s}'] = None if sec is None else round(sec, 1)
    assert RL[s].feature_name() == RL_FEATS
log('race-level trained')

# ---------- 艇単位モデル（finish_targets と同じ。展示後 win） ----------
BOAT_STAGES = {'racecard': [f for f in FEATURES if f not in LIVE], 'exhib': list(FEATURES)}
LABEL = {n: l for n, l, _, _ in TARGETS}


def get_boat(stage, tgt, seed):
    path = FTMD + f'{stage}_{tgt}_s{seed}.txt'
    if not os.path.exists(path):
        p = {k: v for k, v in {**PARAMS, 'seed': seed, 'num_threads': TH}.items() if v is not None}
        f = BOAT_STAGES[stage]
        m = lgb.train(p, lgb.Dataset(fit[f].astype('float32'), fit[LABEL[tgt]],
                                     categorical_feature=[c for c in CATEGORICAL if c in f]), ROUNDS[tgt])
        m.save_model(path)
    m = lgb.Booster(model_file=path)
    assert sorted(m.feature_name()) == sorted(BOAT_STAGES[stage])
    return m


BM = {(st, t): get_boat(st, t, 0) for st in BOAT_STAGES for t in ROUNDS}
bw = BM[('exhib', 'win')]


def Xb(m, d):
    return d[m.feature_name()].astype('float32')


zb_temp = bw.predict(Xb(bw, temp), raw_score=True, num_threads=TH).reshape(-1, 6)
zb_test = bw.predict(Xb(bw, test), raw_score=True, num_threads=TH).reshape(-1, 6)
tb = M.fit_temperature(zb_temp, ytemp)
pb = M.softmax_rows(zb_test, tb)
llb = M.per_race_logloss(pb, ytest)

ev = {'n_races': R, 'n_days': int(len(np.unique(days))),
      'boat_level_exhib_win': {'temperature': tb, 'logloss': llb.mean(), 'top1_acc': (pb.argmax(1) == ytest).mean(),
                               'source': 'finish_targets.py と同じモデル（exhib_win_s0）。finish-targets.json#c.win.exhib.logloss_softmax_temp=1.19993 の再現'}}
ZR, PR, LLR = {}, {}, {}
for s in (0, 1):
    zt = RL[s].predict(Xtemp, raw_score=True, num_threads=TH)
    ZR[s] = RL[s].predict(Xtest, raw_score=True, num_threads=TH)
    trl = M.fit_temperature(zt, ytemp)
    PR[s] = M.softmax_rows(ZR[s], trl)
    LLR[s] = M.per_race_logloss(PR[s], ytest)
    p_raw = M.softmax_rows(ZR[s], 1.0)
    ev[f'race_level_s{s}'] = {'temperature': trl, 'logloss_temp': LLR[s].mean(),
                             'logloss_no_temp': M.per_race_logloss(p_raw, ytest).mean(),
                             'top1_acc': (PR[s].argmax(1) == ytest).mean(),
                             'paired_race_level_minus_boat_level': M.paired_ci(LLR[s] - llb, days)}
ev['mean_prob_by_boat'] = {'race_level_s0': PR[0].mean(0).tolist(), 'boat_level': pb.mean(0).tolist(),
                           'actual_win_rate': np.bincount(ytest, minlength=6) / R}
ev['note'] = 'レースあたりの6クラス対数損失（温度合わせ済みの softmax）。ペア差の95%CI は日単位のクラスタ・ブートストラップ（metrics.paired_ci、2000回）。負＝レース単位のほうが良い'
out['logloss'] = r4(ev, 5)
log('logloss', out['logloss']['race_level_s0']['logloss_temp'], out['logloss']['boat_level_exhib_win']['logloss'])

# ---------- 1. 艇単位モデルの SHAP のうち、他艇の情報を含む特徴量のシェア ----------
pick = np.linspace(0, R - 1, min(NSHAP, R)).astype(int)
n = len(pick)
rows = (pick[:, None] * 6 + np.arange(6)).ravel()
T = test.iloc[rows].reset_index(drop=True)
cb = bw.predict(Xb(bw, T), pred_contrib=True, num_threads=TH)
fnb = bw.feature_name()
assert np.abs(cb.sum(1).reshape(n, 6) - zb_test[pick]).max() < 1e-6
cc = cb[:, :-1].reshape(n, 6, -1)
s1 = {}
for nm, arr in (('centered', cc - cc.mean(1, keepdims=True)), ('uncentered', cc)):
    ab = np.abs(arr)  # n×6×f
    cls_ix = {k: [fnb.index(f) for f in v] for k, v in (('other_boat_info', OTHER_INFO), ('race_common', COMMON), ('own', OWN))}
    tot = ab.sum(2)  # n×6
    per = {k: ab[:, :, ix].sum(2) for k, ix in cls_ix.items()}
    s1[nm] = {
        'share_of_total_mean_over_boats': {k: (v / tot).mean() for k, v in per.items()},
        'share_of_total_by_boat_number': {k: (v / tot).mean(0).tolist() for k, v in per.items()},
        'by_theme': {}}
    for t in THEMES:
        fs = [f for f in theme_features(t) if f in fnb]
        oi = [f for f in fs if f in OTHER_INFO]
        th = ab[:, :, [fnb.index(f) for f in fs]].sum(2)
        o = ab[:, :, [fnb.index(f) for f in oi]].sum(2) if oi else np.zeros_like(th)
        s1[nm]['by_theme'][t['key']] = {
            'other_info_features': oi,
            'other_info_share_within_theme': float(o.sum() / th.sum()),
            'other_info_share_within_theme_boat6': float(o[:, 5].sum() / th[:, 5].sum()),
            'theme_share_of_total': float((th / tot).mean())}
    # 特徴量ごとの |SHAP| の平均（上位）
    mf = ab.mean((0, 1))
    s1[nm]['top_features'] = [[fnb[i], float(mf[i]), 'other' if fnb[i] in OTHER_INFO else ('common' if fnb[i] in COMMON else 'own')]
                              for i in np.argsort(-mf)[:15]]
s1['n_races'] = n
s1['note'] = ('展示後 win（exhib_win_s0）。centered＝finish_targets と同じくレース内で6艇の平均を引いた |SHAP|（艇間の差に効く分）。'
              'シェアは艇ごとに |SHAP| の合計で割り、レース×艇で平均。by_theme の within は |SHAP| の総和の比')
out['boat_level_other_info_share'] = r4(s1)
log('1 done')

# ---------- 2. レース単位モデルの SHAP（クラス k ＝ k号艇が1着） ----------
Xs = Xtest.iloc[pick].reset_index(drop=True)
nf = len(RL_FEATS)
BOAT = np.array([rl_boat(f) for f in RL_FEATS])
THM = np.array([rl_theme(f) for f in RL_FEATS])


def rl_contrib(m, X):
    c = m.predict(X, pred_contrib=True, num_threads=TH).reshape(len(X), 6, nf + 1)
    return c


CR, CC = {}, {}
for s in (0, 1):
    c = rl_contrib(RL[s], Xs)
    assert np.abs(c.sum(2) - ZR[s][pick]).max() < 1e-6
    CR[s] = c[:, :, :-1]
    CC[s] = CR[s] - CR[s].mean(1, keepdims=True)  # クラス間で中心化（softmax に効く分）
zc = ZR[0][pick] - ZR[0][pick].mean(1, keepdims=True)
bc = rl_contrib(RL[0], Xs)[:, :, -1]
ident = float(np.abs(CC[0].sum(2) + (bc - bc.mean(1, keepdims=True)) - zc).max())


def split_share(C):
    """C: n×6クラス×nf。クラス k ごとに自艇・他艇・共通の |SHAP| シェア（レースごとの比の平均）"""
    ab = np.abs(C)
    tot = ab.sum(2)
    res = {}
    for k in range(6):
        own = ab[:, k, BOAT == k + 1].sum(1); oth = ab[:, k, (BOAT != k + 1) & (BOAT != 0)].sum(1); com = ab[:, k, BOAT == 0].sum(1)
        bys = [ab[:, k, BOAT == j].sum(1) / tot[:, k] for j in range(7)]
        res[f'class{k + 1}'] = {'own': (own / tot[:, k]).mean(), 'other_boats': (oth / tot[:, k]).mean(),
                                'race_common': (com / tot[:, k]).mean(),
                                'by_source_boat': {('common' if j == 0 else f'b{j}'): bys[j].mean() for j in range(7)}}
    return res


s2 = {'n_races': n, 'identity_max_abs_err': ident,
      'identity_note': 'クラス間で中心化した SHAP（特徴量）＋中心化した bias の合計 − (z_k − mean_j z_j) の最大絶対誤差',
      'share_centered_s0': split_share(CC[0]), 'share_uncentered_s0': split_share(CR[0]),
      'share_centered_s1': split_share(CC[1]),
      'note': 'centered＝6クラスの logit の平均を引いた SHAP（softmax の確率に効く分。全クラスを同じだけ動かす分を除く）。'
              '列数は自艇16・他艇80・共通11なので、他艇のシェアは列数の多さも含む'}


def top_feats(C, k, mask=None, top=10):
    ab = np.abs(C[:, k, :]).mean(0)
    sg = C[:, k, :].mean(0)
    idx = np.argsort(-ab)
    if mask is not None: idx = [i for i in idx if mask[i]]
    res = []
    for i in idx[:top]:
        x = Xs.iloc[:, i].to_numpy(); v = C[:, k, i]; ok = ~np.isnan(x)
        rho = pd.Series(x[ok]).rank().corr(pd.Series(v[ok]).rank()) if ok.sum() > 10 and np.nanstd(x) > 0 else None
        res.append({'feature': RL_FEATS[i], 'mean_abs': float(ab[i]), 'mean': float(sg[i]),
                    'spearman_value_vs_shap': None if rho is None or pd.isna(rho) else float(rho)})
    return res


s2['top_features'] = {}
for k in range(6):
    s2['top_features'][f'class{k + 1}'] = {
        'all': top_feats(CC[0], k, top=15),
        'other_boats': top_feats(CC[0], k, mask=(BOAT != k + 1) & (BOAT != 0), top=10)}
# クラス k の他艇の寄与を（艇 j × テーマ）で
s2['other_boat_by_theme_class'] = {}
for k in range(6):
    ab = np.abs(CC[0][:, k, :]); tot = ab.sum(1)
    mat = {}
    for j in range(1, 7):
        if j == k + 1: continue
        mat[f'b{j}'] = {t: float((ab[:, (BOAT == j) & (THM == t)].sum(1) / tot).mean()) for t in TK}
    flat = sorted(((jb, t, v) for jb, d_ in mat.items() for t, v in d_.items()), key=lambda x: -x[2])
    s2['other_boat_by_theme_class'][f'class{k + 1}'] = {'matrix_share': mat, 'top5': [list(x) for x in flat[:5]]}
# 依頼にあった例（クラス6 で 1号艇の ST・展示が効いているか）の順位
_om = np.where((BOAT != 6) & (BOAT != 0))[0]
_a = np.abs(CC[0][:, 5, :]).mean(0)
_ord = list(_om[np.argsort(-_a[_om])])
s2['class6_probe'] = {f: {'rank_among_other_boat_cols': _ord.index(RL_FEATS.index(f)) + 1, 'n_other_boat_cols': len(_om),
                          'mean_abs': float(_a[RL_FEATS.index(f)]), 'mean': float(CC[0][:, 5, RL_FEATS.index(f)].mean())}
                      for f in ('b1_st_mean30', 'b1_exh_time', 'b1_nat_win', 'b1_cls_ord', 'b5_st_mean30', 'b5_exh_time')}
s2['other_boat_by_theme_note'] = 'クラス k の中心化 |SHAP| のうち、他艇 j のテーマ t の列に乗っている割合（レースごとの比の平均）'

# 安定性: seed 0 と 1
stab = {}
for k in (0, 5):
    a0 = np.abs(CC[0][:, k, :]).mean(0); a1 = np.abs(CC[1][:, k, :]).mean(0)
    t0_, t1_ = set(np.argsort(-a0)[:10]), set(np.argsort(-a1)[:10])
    o0 = split_share(CC[0])[f'class{k + 1}']['other_boats']; o1 = split_share(CC[1])[f'class{k + 1}']['other_boats']
    om = (BOAT != k + 1) & (BOAT != 0)
    oi = np.where(om)[0]
    to0 = set(oi[np.argsort(-a0[oi])[:10]]); to1 = set(oi[np.argsort(-a1[oi])[:10]])
    # レースごとの他艇シェアの seed 間相関
    def per_race_other(C):
        ab = np.abs(C[:, k, :]); return ab[:, om].sum(1) / ab.sum(1)
    pr0, pr1 = per_race_other(CC[0]), per_race_other(CC[1])
    # レースごと・特徴量ごとの SHAP の seed 間相関（他艇の列）
    stab[f'class{k + 1}'] = {
        'other_boats_share_s0': o0, 'other_boats_share_s1': o1,
        'top10_all_overlap': len(t0_ & t1_), 'top10_all_s0': [RL_FEATS[i] for i in np.argsort(-a0)[:10]],
        'top10_all_s1': [RL_FEATS[i] for i in np.argsort(-a1)[:10]],
        'top10_other_overlap': len(to0 & to1),
        'top10_other_s0': [RL_FEATS[i] for i in oi[np.argsort(-a0[oi])[:10]]],
        'top10_other_s1': [RL_FEATS[i] for i in oi[np.argsort(-a1[oi])[:10]]],
        'per_race_other_share_corr': float(np.corrcoef(pr0, pr1)[0, 1]),
        'per_race_other_share_mean_abs_diff': float(np.abs(pr0 - pr1).mean()),
        'per_race_feature_shap_corr_other_cols': float(np.corrcoef(CC[0][:, k, om].ravel(), CC[1][:, k, om].ravel())[0, 1]),
        'per_race_top_other_feature_same_rate': float((np.argmax(np.abs(CC[0][:, k, om]), 1) == np.argmax(np.abs(CC[1][:, k, om]), 1)).mean())}
s2['stability_seed0_vs_seed1'] = stab

# 優勝戦 × G2以上
sub = (Xtest.round_code == 2) & (Xtest.grade_code >= 2)
Xf = Xtest[sub.to_numpy()].reset_index(drop=True)
nfin = len(Xf)
fin = {'n_races': nfin, 'filter': 'round_code==2（yusho）かつ grade_code>=2（G2・G1・SG）、test 期間の全レース',
       'boat6_win_count': int((ytest[sub.to_numpy()] == 5).sum())}
if nfin:
    C0 = rl_contrib(RL[0], Xf)[:, 5, :-1]; C1 = rl_contrib(RL[1], Xf)[:, 5, :-1]
    C0 = C0 - rl_contrib(RL[0], Xf)[:, :, :-1].mean(1); C1 = C1 - rl_contrib(RL[1], Xf)[:, :, :-1].mean(1)
    m0, m1 = C0.mean(0), C1.mean(0)
    se = np.sqrt((C0.std(0) ** 2 + C1.std(0) ** 2) / 2 / nfin)
    a0 = np.abs(m0)
    top = np.argsort(-a0)[:10]
    fin.update({
        'class6_mean_shap_seed_diff': {'max_abs': float(np.abs(m0 - m1).max()), 'mean_abs': float(np.abs(m0 - m1).mean()),
                                       'corr': float(np.corrcoef(m0, m1)[0, 1]),
                                       'top10_by_abs_mean_overlap': len(set(top) & set(np.argsort(-np.abs(m1))[:10])),
                                       'sign_disagree_in_top10_s0': int((np.sign(m0[top]) != np.sign(m1[top])).sum())},
        'top10_s0': [{'feature': RL_FEATS[i], 'mean_s0': float(m0[i]), 'mean_s1': float(m1[i]), 'se_between_races': float(se[i])}
                     for i in top],
        'class6_prob_mean_s0_s1': [float(M.softmax_rows(RL[0].predict(Xf, raw_score=True), out['logloss']['race_level_s0']['temperature'])[:, 5].mean()),
                                   float(M.softmax_rows(RL[1].predict(Xf, raw_score=True), out['logloss']['race_level_s1']['temperature'])[:, 5].mean())],
        'other_boats_share_class6_s0_s1': [split_share(np.repeat(C0[:, None, :], 6, 1))['class6']['other_boats'],
                                           split_share(np.repeat(C1[:, None, :], 6, 1))['class6']['other_boats']],
        'note': 'クラス6の中心化 SHAP を小標本で平均したときの、seed 間の差。se_between_races はレース間のばらつきから出した平均の標準誤差（2 seed の平均）'})
s2['final_g2plus'] = fin
s2['top3_design'] = {
    'note': '学習していない。3着以内は「6艇のうちどの3艇か」の多ラベルで、softmax の1本では出せない',
    'options': [
        {'name': '艇ごとの2値を6本', 'models': 6, 'shape': '入力は同じ107列、目的は「k号艇が3着以内」の2値（k=1..6）。SHAP はクラス k と同じ形で自艇・他艇・共通に分けられる。6本の確率の合計は3に拘束されない'},
        {'name': '3艇の組を20クラス', 'models': 1, 'shape': 'multiclass 20クラス（C(6,3)）。k号艇が3着以内の確率は、k を含む10クラスの確率の和。SHAP はクラスごとの logit には加法的だが、10クラスの確率の和には加法的でない（分解には近似が要る）'},
        {'name': '1着モデルから Harville', 'models': 0, 'shape': '今回の6クラスモデルから順列で導く。追加の学習は要らないが、寄与は finish_targets.e と同じくアブレーションか一次近似で分ける'}]}
out['race_level_shap'] = r4(s2)
log('2 done')

# ---------- 3. 費用 ----------
one_b = test.iloc[0:6]; b168 = test.iloc[0:1008]
one_r = Xtest.iloc[0:1]; r168 = Xtest.iloc[0:168]


def bench(pairs, reps):
    for m, X in pairs: m.predict(X, pred_contrib=True, num_threads=1)
    cpu, wall = [], []
    for _ in range(reps):
        c0, w0 = time.process_time(), time.perf_counter()
        for m, X in pairs:
            m.predict(X, raw_score=True, num_threads=1); m.predict(X, pred_contrib=True, num_threads=1)
        cpu.append(time.process_time() - c0); wall.append(time.perf_counter() - w0)
    return r4({'cpu_ms_med': np.median(cpu) * 1000, 'wall_ms_med': np.median(wall) * 1000}, 2)


cost = {'load_before': os.getloadavg()}
sets = {'race_level_1model': lambda X6, Xr: [(RL[0], Xr.to_numpy())],
        'boat_level_win_1model': lambda X6, Xr: [(bw, Xb(bw, X6).to_numpy())],
        'boat_level_6models_planB': lambda X6, Xr: [(m, Xb(m, X6).to_numpy()) for m in BM.values()]}
for nm, f in sets.items():
    cost[nm] = {'1R': bench(f(one_b, one_r), 50), '168R': bench(f(b168, r168), 3)}
cost['load_after'] = os.getloadavg()


def size(m):
    s = m.model_to_string().encode()
    return {'n_trees': m.num_trees(), 'text_bytes': len(s), 'text_gzip_bytes': len(gzip.compress(s)), 'n_features': m.num_feature()}


cost['model_sizes'] = {'race_level': size(RL[0]), 'boat_level_exhib_win': size(bw),
                       'boat_level_6models_total_text_bytes': sum(size(m)['text_bytes'] for m in BM.values()),
                       'boat_level_6models_total_gzip_bytes': sum(size(m)['text_gzip_bytes'] for m in BM.values())}
# 学習時間の比較用に、艇単位の展示後 win（seed 0、250本）を同じスレッド数で1回学習し直す（保存しない）
_t = time.time()
lgb.train({k: v for k, v in {**PARAMS, 'seed': 0, 'num_threads': TH}.items() if v is not None},
          lgb.Dataset(fit[FEATURES].astype('float32'), fit['y_win'], categorical_feature=[c for c in CATEGORICAL if c in FEATURES]),
          ROUNDS['win'])
cost['fit_seconds_boat_level_exhib_win'] = time.time() - _t
cost['fit_seconds_race_level'] = out['race_level_training']['fit_seconds_s0']
cost['fit_threads'] = TH
cost['note'] = '推論＋SHAP＝raw_score と pred_contrib を1回ずつ、1スレッド。1R は艇単位なら6行、レース単位なら1行'
out['cost'] = r4(cost)
log('cost done')

# JS（treeshap.mjs）にクラス k の木だけを渡したときの一致
SCR = os.environ.get('RL_SCRATCH', MD)
dump = RL[0].dump_model()
js = {'num_class': dump.get('num_class'), 'num_tree_per_iteration': dump.get('num_tree_per_iteration'),
      'n_trees': len(dump['tree_info'])}
ti = dump['tree_info']
js['tree_index_class_rule_ok'] = all(t['tree_index'] == i for i, t in enumerate(ti))
nchk = 200
Xj = Xs.iloc[:nchk].to_numpy()
full = rl_contrib(RL[0], Xs.iloc[:nchk])
for k in (0, 5):
    dk = {**dump, 'tree_info': [t for i, t in enumerate(ti) if i % 6 == k], 'num_class': 1, 'num_tree_per_iteration': 1}
    pth = SCR + f'rl_dump_class{k + 1}.json'
    json.dump(dk, open(pth, 'w'))
    xp = SCR + 'rl_X.json'
    json.dump([[None if np.isnan(v) else float(v) for v in r] for r in Xj], open(xp, 'w'))
    code = (f"import {{load, contrib, predictRaw}} from '{os.path.join(HERE, 'treeshap.mjs')}';"
            f"import {{readFileSync}} from 'node:fs';"
            f"const m=load('{pth}');const X=JSON.parse(readFileSync('{xp}','utf8'));"
            f"const t0=performance.now();const C=X.map(x=>Array.from(contrib(m.trees,x,m.nf)));const ms=performance.now()-t0;"
            f"console.log(JSON.stringify({{C,R:X.map(x=>predictRaw(m.trees,x)),ms}}));")
    # treeshap.mjs は process.argv[1] を見るので、-e ではなくファイルにして実行する
    runner = SCR + 'rl_js_check.mjs'
    open(runner, 'w').write(code)
    r = subprocess.run(['node', runner], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'JS の TreeSHAP の実行に失敗: {r.stderr[-2000:]}')
    o = json.loads(r.stdout)
    Cj = np.array(o['C']); Rj = np.array(o['R'])
    js[f'class{k + 1}'] = {'max_abs_diff_contrib_vs_python': float(np.abs(Cj - full[:, k, :]).max()),
                           'max_abs_diff_raw_vs_python': float(np.abs(Rj - full[:, k, :].sum(1)).max()),
                           'js_ms_per_race_this_class': o['ms'] / nchk}
js['n_races_checked'] = nchk
js['note'] = ('treeshap.mjs は tree_info の全木を1つのスコアとして足すので、multiclass をそのまま渡すと6クラスを混ぜる。'
              'tree_index % num_class == k の木だけを渡すとクラス k の値になる（ここで確かめたのはこの分け方）。'
              'src/utils/analogyTreeShap.js（master e524a150a）の compileModel は num_class!=1 を明示的に拒否する')
out['js_treeshap'] = r4(js, 8)
out['seconds'] = round(time.time() - t0); out['load_end'] = os.getloadavg(); out['model_dir'] = MD
json.dump(out, open(OUTF, 'w'), ensure_ascii=False, indent=1, default=lambda o: o.tolist() if hasattr(o, 'tolist') else str(o))
log('done', OUTF)
