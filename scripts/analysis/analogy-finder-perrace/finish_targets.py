"""探索的（事前登録なし）。BOA-271 案B「レースごとの寄与度を着順別（1着／2着以内／3着以内）に出す」が成り立つかの計算。

ablate.py と同じ縮小設定（学習 2025-06-01〜11-02、温度合わせ 2025-11-03〜12-02、test 2026-04-01〜09-30 の完全レース、
train.py の PARAMS・TARGETS の木の数、seed 0）で、出走表時点（直前情報8列なし）と展示後（44列）× win/top2/top3 の6本と、
雑音の床のための win の seed 1 を段ごとに1本ずつ学習する。読み取りのみ（データディレクトリには書かない）。

入力: 環境変数 ANALOGY_DATA_DIR（boats.pkl）。任意: FT_MODEL_DIR（学習したモデルの置き場。既定は一時ディレクトリ）、
TH（スレッド数）、NSHAP（寄与度の標本レース数、既定 5000）、NABL（e のレース数、既定 1000）
出力: docs/design/analogy-finder/analysis/perrace/finish-targets.json
特徴量は必ず booster.feature_name() の並びで渡す（themes.FEATURES の並びとは違うことがある）。
"""
import sys, os, json, time, gzip, tempfile
from collections import Counter
import numpy as np, pandas as pd, lightgbm as lgb

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '../../ml/analogy'))
from themes import THEMES, FEATURES, CATEGORICAL, theme_features  # noqa: E402
from train import PARAMS, TARGETS  # noqa: E402
import metrics as M  # noqa: E402

A = os.environ['ANALOGY_DATA_DIR'].rstrip('/') + '/'
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
OUTF = os.path.join(ROOT, 'docs/design/analogy-finder/analysis/perrace/finish-targets.json')
BENCH = os.path.join(ROOT, 'docs/design/analogy-finder/analysis/perrace/')
MD = os.environ.get('FT_MODEL_DIR', os.path.join(tempfile.gettempdir(), 'analogy-finish-models')).rstrip('/') + '/'
os.makedirs(MD, exist_ok=True)
load0 = os.getloadavg()
TH = int(os.environ.get('TH', '6' if load0[0] <= 30 else '2'))
NSHAP = int(os.environ.get('NSHAP', '5000')); NABL = int(os.environ.get('NABL', '1000'))
LIVE = ['exh_time', 'exh_time_diff', 'exh_time_rank', 'weather_code', 'wind_x', 'wind_y', 'wind_speed', 'wave_height']
STAGES = {'racecard': [f for f in FEATURES if f not in LIVE], 'exhib': list(FEATURES)}
ROUNDS = {n: r for n, _, _, r in TARGETS}; LABEL = {n: l for n, l, _, _ in TARGETS}
TK = [t['key'] for t in THEMES]
VENUE = {1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖', 7: '蒲郡', 8: '常滑', 9: '津', 10: '三国',
         11: 'びわこ', 12: '住之江', 13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山', 19: '下関',
         20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'}
CLS = {1.0: 'B2', 2.0: 'B1', 3.0: 'A2', 4.0: 'A1'}
t0 = time.time()
out = {'note': '探索的分析（事前登録なし）。記述のみで、仮説検定の結論としては使わない',
       'load_start': load0, 'threads': TH, 'lightgbm': lgb.__version__,
       'data': {'boats_pkl': A + 'boats.pkl',
                'boats_pkl_mtime': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(os.path.getmtime(A + 'boats.pkl')))},
       'settings': {'params': {k: v for k, v in PARAMS.items() if k != 'num_threads'}, 'rounds': ROUNDS, 'seed_main': 0,
                    'seed_noise_floor': 1, 'stages': {k: len(v) for k, v in STAGES.items()}, 'live_features': LIVE}}


def r4(x, d=4):
    if isinstance(x, dict): return {k: r4(v, d) for k, v in x.items()}
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
out['data'].update({'rows_complete_races': int(len(df)), 'max_race_date': str(df.race_date.max().date()),
                    'scale': f'縮小学習（ablate.py と同じ）。寄与度は test から等間隔 {NSHAP}R、e は {NABL}R、対数損失は test 全レース'})
del df
import hashlib  # noqa: E402
_h = hashlib.md5()
with open(A + 'boats.pkl', 'rb') as f_:
    for ch in iter(lambda: f_.read(1 << 24), b''): _h.update(ch)
out['data']['boats_pkl_md5'] = _h.hexdigest()
nR =lambda d: int(d.race_id.nunique())  # noqa: E731
out['periods'] = {'fit': ['2025-06-01', '2025-11-02', nR(fit)], 'temp': ['2025-11-03', '2025-12-02', nR(temp)],
                  'test': ['2026-04-01', '2026-09-30', nR(test)]}
log(out['periods'])
R = nR(test)
days = test.loc[test.boat_number == 1, 'race_date'].to_numpy()
Y = {t: test[LABEL[t]].to_numpy().reshape(-1, 6) for t in ROUNDS}
ywin = M.winner_index(test)


# ---------- モデル ----------
def get_model(stage, tgt, seed):
    path = MD + f'{stage}_{tgt}_s{seed}.txt'
    feats = STAGES[stage]
    if os.path.exists(path):
        m = lgb.Booster(model_file=path)
    else:
        p = {k: v for k, v in {**PARAMS, 'seed': seed, 'num_threads': TH}.items() if v is not None}
        d = lgb.Dataset(fit[feats].astype('float32'), fit[LABEL[tgt]],
                        categorical_feature=[c for c in CATEGORICAL if c in feats], free_raw_data=True)
        m = lgb.train(p, d, ROUNDS[tgt]); m.save_model(path)
        log('trained', stage, tgt, seed)
    assert sorted(m.feature_name()) == sorted(feats), (stage, tgt)
    return m


def Xm(m, d):
    return d[m.feature_name()].astype('float32')  # モデルの並びで渡す


def raw(m, d):
    return m.predict(Xm(m, d), raw_score=True, num_threads=TH).reshape(-1, 6)


def sig(z):
    return 1 / (1 + np.exp(-z))


def harville(p):
    """p: R×6 の1着確率（各行の合計1）。Harville（Plackett–Luce）で、2着以内・3着以内の確率を6艇の順列で正確に出す"""
    t2 = p.copy(); t3 = p.copy()
    for a in range(6):
        for b in range(6):
            if b == a: continue
            pab = p[:, a] * p[:, b] / np.clip(1 - p[:, a], 1e-12, None)
            t2[:, b] += pab; t3[:, b] += pab
            for c in range(6):
                if c in (a, b): continue
                t3[:, c] += pab * p[:, c] / np.clip(1 - p[:, a] - p[:, b], 1e-12, None)
    return {'top2': t2, 'top3': t3}


models, Z, TEMP = {}, {}, {}
for stage in STAGES:
    for tgt in ROUNDS:
        models[(stage, tgt, 0)] = get_model(stage, tgt, 0)
    models[(stage, 'win', 1)] = get_model(stage, 'win', 1)
    for key in [k for k in models if k[0] == stage]:
        Z[key] = raw(models[key], test)
    for s in (0, 1):
        TEMP[(stage, s)] = M.fit_temperature(raw(models[(stage, 'win', s)], temp), M.winner_index(temp))
log('models ready')
out['temperature_win'] = {f'{st}_s{s}': v for (st, s), v in TEMP.items()}
PW = {st: M.softmax_rows(Z[(st, 'win', 0)], TEMP[(st, 0)]) for st in STAGES}
HV = {st: harville(PW[st]) for st in STAGES}


def dist(x):
    return {'mean': x.mean(), 'sd': x.std(), 'p5': np.percentile(x, 5), 'p95': np.percentile(x, 95),
            'min': x.min(), 'max': x.max()}


# ---------- a. 独立な2値モデルの確率の合計、Harville との比較 ----------
a = {'prob_sum_per_race': {}, 'direct_vs_harville': {}}
for st in STAGES:
    for tgt, th in [('win', 1), ('top2', 2), ('top3', 3)]:
        s = sig(Z[(st, tgt, 0)]).sum(1)
        a['prob_sum_per_race'][f'{st}_{tgt}'] = {**r4(dist(s)), 'theory': th, 'mean_abs_dev_from_theory': r4(np.abs(s - th).mean())}
    for tgt in ('top2', 'top3'):
        pd_, ph = sig(Z[(st, tgt, 0)]), HV[st][tgt]
        a['direct_vs_harville'][f'{st}_{tgt}'] = r4({
            'mean_abs_diff_per_boat': np.abs(pd_ - ph).mean(), 'p95_abs_diff_per_boat': np.percentile(np.abs(pd_ - ph), 95),
            'corr': np.corrcoef(pd_.ravel(), ph.ravel())[0, 1],
            'mean_direct_minus_harville_by_boat_number': (pd_ - ph).mean(0).tolist(),
            'harville_sum_check_max_abs_dev': np.abs(ph.sum(1) - int(tgt[-1])).max()})
out['a'] = a

# ---------- b. レースごとのテーマ別シェア（中心化した |SHAP|） ----------
pick = np.linspace(0, R - 1, min(NSHAP, R)).astype(int)
rows = (pick[:, None] * 6 + np.arange(6)).ravel()
T = test.iloc[rows].reset_index(drop=True)
n = len(pick)


def contrib(m, d):
    """d の行×（特徴量・モデル順 + bias）。中心化前"""
    return m.predict(Xm(m, d), pred_contrib=True, num_threads=TH)


C, SH, TB, BIAS = {}, {}, {}, {}
for key, m in models.items():
    c = contrib(m, T)
    fn = m.feature_name()
    raw_ = c.sum(1).reshape(n, 6)
    cc = c[:, :-1].reshape(n, 6, -1)
    cc = cc - cc.mean(1, keepdims=True)
    # 恒等式の確認: 中心化 SHAP の艇ごとの合計 = 生スコアのレース内の差
    zc = raw_ - raw_.mean(1, keepdims=True)
    BIAS[key] = float(np.abs(cc.sum(2) - zc).max())
    idx = [[fn.index(f) for f in theme_features(t) if f in fn] for t in THEMES]
    ab = np.abs(cc).sum(1)
    th = np.stack([ab[:, ix].sum(1) for ix in idx], 1)
    SH[key] = th / th.sum(1, keepdims=True)
    TB[key] = np.stack([cc[:, :, ix].sum(2) for ix in idx], 2)  # n×6艇×6テーマ（符号付き）
    C[key] = cc
    # 予測と合っているか（モデルの並びで渡せているか）
    assert np.abs(raw_ - Z[key][pick]).max() < 1e-6, key
log('shap done')
out['a']['centered_shap_identity_max_abs_err'] = {f'{k[0]}_{k[1]}_s{k[2]}': v for k, v in BIAS.items()}
out['a']['centered_shap_identity_note'] = '中心化した SHAP の艇ごとの合計 − (生スコア − レース内の生スコアの平均) の最大絶対誤差。log-odds の空間の差であり、確率の差ではない'


def rankrows(S):
    return (-S).argsort(1).argsort(1).astype(float)


def compare(Sa, Sb):
    oa, ob = (-Sa).argsort(1), (-Sb).argsort(1)
    ra, rb = rankrows(Sa), rankrows(Sb)
    ra -= ra.mean(1, keepdims=True); rb -= rb.mean(1, keepdims=True)
    sp = (ra * rb).sum(1) / np.sqrt((ra ** 2).sum(1) * (rb ** 2).sum(1))
    sw = oa[:, 0] != ob[:, 0]
    combos = Counter(f'{TK[i]}→{TK[j]}' for i, j in zip(oa[sw, 0], ob[sw, 0]))
    return r4({'mean_diff_b_minus_a': dict(zip(TK, (Sb - Sa).mean(0).tolist())),
               'mean_abs_diff': dict(zip(TK, np.abs(Sb - Sa).mean(0).tolist())),
               'total_variation_mean': (0.5 * np.abs(Sb - Sa).sum(1)).mean(),
               'top1_same_rate': (oa[:, 0] == ob[:, 0]).mean(),
               'top2_ordered_same_rate': ((oa[:, 0] == ob[:, 0]) & (oa[:, 1] == ob[:, 1])).mean(),
               'spearman_median': np.median(sp), 'spearman_p10': np.percentile(sp, 10),
               'top1_swap_rate': sw.mean(), 'top1_swap_combos': dict(combos.most_common())})


def sign_flip(Va, Vb, thr=0.1):
    big = (np.abs(Va) >= thr) & (np.abs(Vb) >= thr)
    return r4({'rate_all_boats': (np.sign(Va) != np.sign(Vb)).mean(),
               f'rate_both_abs_ge_{thr}': (np.sign(Va[big]) != np.sign(Vb[big])).mean(), f'n_both_abs_ge_{thr}': int(big.sum()),
               'a_neg_b_pos_rate': ((Va < 0) & (Vb > 0)).mean(), 'a_pos_b_neg_rate': ((Va > 0) & (Vb < 0)).mean()})


b = {'n_races': n, 'sample': 'test の完全レースから等間隔'}
for st in STAGES:
    k0, k1, k2, k3 = (st, 'win', 0), (st, 'win', 1), (st, 'top2', 0), (st, 'top3', 0)
    V = {k: C[k].sum(2) for k in (k0, k1, k2, k3)}
    b[st] = {
        'share_mean': {f'{k[1]}_s{k[2]}': dict(zip(TK, r4(SH[k].mean(0).tolist()))) for k in (k0, k1, k2, k3)},
        'top1_rate': {f'{k[1]}_s{k[2]}': dict(zip(TK, r4([((-SH[k]).argsort(1)[:, 0] == i).mean() for i in range(6)])))
                      for k in (k0, k1, k2, k3)},
        'win_vs_top2': compare(SH[k0], SH[k2]),
        'win_vs_top3': compare(SH[k0], SH[k3]),
        'noise_floor_win_s0_vs_win_s1': compare(SH[k0], SH[k1]),
        'boat_total_sign_flip': {'win_vs_top2': sign_flip(V[k0], V[k2]), 'win_vs_top3': sign_flip(V[k0], V[k3]),
                                 'noise_floor_win_s0_vs_s1': sign_flip(V[k0], V[k1])},
        'boat_theme_sign_flip_rate_abs_ge_0.05': {
            nm: dict(zip(TK, r4([(lambda x, y: (np.sign(x[(np.abs(x) >= .05) & (np.abs(y) >= .05)]) !=
                                                np.sign(y[(np.abs(x) >= .05) & (np.abs(y) >= .05)])).mean())(TB[ka][:, :, i], TB[kb][:, :, i])
                                 for i in range(6)])))
            for nm, ka, kb in [('win_vs_top3', k0, k3), ('noise_floor_win_s0_vs_s1', k0, k1)]},
    }

# 入れ替わりの具体例（展示後、win と top3 で1位のテーマが違い、その差が大きいレース。組み合わせが重ならないように）
st = 'exhib'; k0, k3 = (st, 'win', 0), (st, 'top3', 0)
o0, o3 = (-SH[k0]).argsort(1)[:, 0], (-SH[k3]).argsort(1)[:, 0]
sw = np.where(o0 != o3)[0]
margin = np.minimum(SH[k0][sw, o0[sw]] - SH[k0][sw, o3[sw]], SH[k3][sw, o3[sw]] - SH[k3][sw, o0[sw]])
order = sw[np.argsort(-margin)]
chosen, seen = [], set()
for i in order:  # まず組み合わせが重ならないように選び、足りなければマージン順に足す
    if (o0[i], o3[i]) not in seen: chosen.append(i); seen.add((o0[i], o3[i]))
    if len(chosen) == 3: break
chosen += [i for i in order if i not in chosen][:3 - len(chosen)]
ex = []
for i in chosen:
    g = T.iloc[i * 6:(i + 1) * 6]
    top = lambda S: [[TK[j], round(float(S[i, j]), 3)] for j in (-S[i]).argsort()[:3]]  # noqa: E731
    ex.append({'race_id': g.race_id.iloc[0], 'race_date': str(g.race_date.iloc[0].date()),
               'venue': f"{int(g.venue_code.iloc[0]):02d} {VENUE.get(int(g.venue_code.iloc[0]), '')}",
               'race_number': int(g.race_number.iloc[0]), 'grade': str(g.grade.iloc[0]),
               'boats': [{'boat_number': int(r.boat_number), 'class': CLS.get(r.cls_ord, None),
                          'nat_win': None if pd.isna(r.nat_win) else round(float(r.nat_win), 2),
                          'finish_rank': None if pd.isna(r.finish_rank) else int(r.finish_rank)} for r in g.itertuples()],
               'win_top3_themes': top(SH[k0]), 'top3_top3_themes': top(SH[k3]),
               'win_boat_total_logodds_diff': r4(C[k0][i].sum(1).tolist(), 3),
               'top3_boat_total_logodds_diff': r4(C[k3][i].sum(1).tolist(), 3),
               'win_boat_by_theme': {TK[j]: r4(TB[k0][i, :, j].tolist(), 3) for j in range(6)},
               'top3_boat_by_theme': {TK[j]: r4(TB[k3][i, :, j].tolist(), 3) for j in range(6)},
               'p_win_softmax': r4(PW[st][pick[i]].tolist(), 3), 'p_top3_direct': r4(sig(Z[k3][pick[i]]).tolist(), 3)})
b['swap_examples_exhib_win_vs_top3'] = ex
b['swap_examples_note'] = '値は中心化した SHAP（log-odds、レース内6艇の平均との差）。正＝押し上げ、負＝押し下げ。選び方: 1位のテーマが入れ替わり、両方のモデルで差（マージン）が大きい順、組み合わせが重ならないように'
out['b'] = b
log('b done')

# ---------- c. 2着以内・3着以内が基準に勝つか（test 全レース） ----------
train_all = pd.concat([fit, temp], ignore_index=True)


def calib(p, y):
    q = pd.qcut(p.ravel(), 10, labels=False, duplicates='drop')
    t = pd.DataFrame({'q': q, 'p': p.ravel(), 'y': y.ravel()}).groupby('q').agg(pred=('p', 'mean'), actual=('y', 'mean'), n=('y', 'size'))
    return {'deciles': r4(t.reset_index().to_dict('records')), 'max_abs_gap': r4((t.pred - t.actual).abs().max())}


c = {'n_races': R, 'baseline': 'metrics.baseline_topk（会場×1号艇級別×艇番の過去率。学習は fit+temp の期間）'}
llr = {}
for tgt in ('top2', 'top3'):
    pb = M.baseline_topk(train_all, test, LABEL[tgt]).reshape(-1, 6)
    y = Y[tgt]
    llb = M.binary_ll(pb, y).sum(1)
    c[tgt] = {'baseline': {'logloss_per_boat': r4(llb.mean() / 6, 5), 'calibration': calib(pb, y)}}
    for st in STAGES:
        pdir, ph = sig(Z[(st, tgt, 0)]), HV[st][tgt]
        lld, llh = M.binary_ll(pdir, y).sum(1), M.binary_ll(ph, y).sum(1)
        llr[(st, tgt)] = lld
        c[tgt][st] = {'logloss_per_boat_direct': r4(lld.mean() / 6, 5), 'logloss_per_boat_harville': r4(llh.mean() / 6, 5),
                      'paired_race_direct_minus_baseline': r4(M.paired_ci(lld - llb, days), 5),
                      'paired_race_harville_minus_baseline': r4(M.paired_ci(llh - llb, days), 5),
                      'paired_race_direct_minus_harville': r4(M.paired_ci(lld - llh, days), 5),
                      'calibration_direct': calib(pdir, y), 'calibration_harville': calib(ph, y)}
    c[tgt]['paired_race_racecard_minus_exhib_direct'] = r4(M.paired_ci(llr[('racecard', tgt)] - llr[('exhib', tgt)], days), 5)
pbw = M.baseline_winner(train_all, test); llbw = M.per_race_logloss(pbw, ywin)
c['win'] = {'baseline_logloss': r4(llbw.mean(), 5)}
for st in STAGES:
    ll = M.per_race_logloss(PW[st], ywin)
    c['win'][st] = {'logloss_softmax_temp': r4(ll.mean(), 5), 'top1_acc': r4((PW[st].argmax(1) == ywin).mean()),
                    'paired_model_minus_baseline': r4(M.paired_ci(ll - llbw, days), 5)}
c['note'] = 'レース単位の対数損失＝6艇の2値 logloss の和。ペア差の95%CI は日単位のクラスタ・ブートストラップ（metrics.paired_ci、2000回）。Harville は同じ段の win モデル（温度合わせ済みの softmax）から導いた確率'
out['c'] = c
log('c done')

# ---------- d. 計算時間と保存量 ----------
one = test.iloc[0:6]; r168 = test.iloc[0:1008]
Xone = {k: Xm(m, one).to_numpy() for k, m in models.items()}
X168 = {k: Xm(m, r168).to_numpy() for k, m in models.items()}
SETS = {'two_models_now': [('racecard', 'win', 0), ('exhib', 'win', 0)],
        'six_models_planB': [(st, t, 0) for st in STAGES for t in ROUNDS]}


def bench(keys, X, reps):
    for k in keys: models[k].predict(X[k], pred_contrib=True, num_threads=1)
    cpu, wall = [], []
    for _ in range(reps):
        c0, w0 = time.process_time(), time.perf_counter()
        for k in keys:
            models[k].predict(X[k], raw_score=True, num_threads=1)
            models[k].predict(X[k], pred_contrib=True, num_threads=1)
        cpu.append(time.process_time() - c0); wall.append(time.perf_counter() - w0)
    return r4({'cpu_ms_med': np.median(cpu) * 1000, 'cpu_ms_min': np.min(cpu) * 1000, 'wall_ms_med': np.median(wall) * 1000}, 2)


d = {'load_before': os.getloadavg()}
for nm, ks in SETS.items():
    d[nm] = {'1R': bench(ks, Xone, 50), '168R': bench(ks, X168, 3), 'models': [f'{k[0]}_{k[1]}' for k in ks]}
d['load_after'] = os.getloadavg()
bj = json.load(open(BENCH + 'bench.json')); tc = json.load(open(BENCH + 'timing_cpu.json'))
ratio1 = bj['race1']['cpu_ms_med'] / tc['1R_contrib']['cpu_med_ms']
ratio168 = bj['races168']['cpu_ms_med'] / tc['168R_contrib']['cpu_med_ms']
d['js_ratio'] = r4({'1R': ratio1, '168R': ratio168, 'source': 'bench.json の JS の CPU 中央値 ÷ timing_cpu.json の Python pred_contrib の CPU 中央値（main_win_F5 1本、高負荷時）'})
for nm in SETS:
    d[nm]['js_estimate_ms'] = r4({'1R': d[nm]['1R']['cpu_ms_med'] * ratio1, '168R': d[nm]['168R']['cpu_ms_med'] * ratio168}, 1)
sizes = {}
for k, m in models.items():
    if k[2] != 0: continue
    s = m.model_to_string().encode()
    sizes[f'{k[0]}_{k[1]}'] = {'n_trees': m.num_trees(), 'text_bytes': len(s), 'text_gzip_bytes': len(gzip.compress(s)),
                               'n_features': m.num_feature()}
d['model_sizes'] = sizes
for nm, ks in SETS.items():
    d[nm]['total_trees'] = sum(sizes[f'{k[0]}_{k[1]}']['n_trees'] for k in ks)
    d[nm]['total_text_bytes'] = sum(sizes[f'{k[0]}_{k[1]}']['text_bytes'] for k in ks)
    d[nm]['total_text_gzip_bytes'] = sum(sizes[f'{k[0]}_{k[1]}']['text_gzip_bytes'] for k in ks)
races_per_day = R / len(np.unique(days))
store = {'races_per_day_test': r4(races_per_day, 1)}
for nm, nt in [('now_1target', 1), ('planB_3targets', 3)]:
    vals = 6 * 6 * 2 * nt
    rows_ = 6 * 2 * nt  # 1行＝（レース・段・目的・艇）にテーマ6列
    js = json.dumps({st: {t: [[round(0.1234, 4)] * 6 for _ in range(6)] for t in list(ROUNDS)[:nt]} for st in STAGES})
    store[nm] = {'values_per_race': vals, 'rows_per_race_if_row_per_boat': rows_, 'float32_bytes_per_race': vals * 4,
                 'json_bytes_per_race_4digits': len(js), 'json_bytes_per_year': int(len(js) * races_per_day * 365)}
d['storage'] = store
out['d'] = d
log('d done')

# ---------- e. Harville で1着モデルから導いた寄与の分解 ----------
sub = np.arange(0, n, max(1, n // NABL))[:NABL]
e = {'n_races': int(len(sub)), 'method': 'テーマのアブレーション: P_topk(s) − P_topk(s − φ_テーマ)。s は win の生スコア、P は温度付き softmax→Harville。'
     '一次近似: Σ_j ∂P_i/∂s_j × φ_j,テーマ（中心差分 h=1e-4）。シェア＝Σ_艇 |寄与| をテーマ合計で割る'}
for st in STAGES:
    k0 = (st, 'win', 0); tmp = TEMP[(st, 0)]
    zr = Z[k0][pick[sub]]                       # m×6 の生スコア
    phi = TB[k0][sub]                           # m×6艇×6テーマ（中心化。softmax は定数のずれに不変なので中心化しても同じ）
    P = lambda s: harville(M.softmax_rows(s, tmp))  # noqa: E731
    base = P(zr)
    res = {}
    for tgt in ('top2', 'top3'):
        k = int(tgt[-1])
        dP = np.stack([base[tgt] - P(zr - phi[:, :, j])[tgt] for j in range(6)], 2)   # m×6×6
        # 一次近似
        h = 1e-4; J = np.zeros((len(sub), 6, 6))
        for jb in range(6):
            dz = np.zeros(6); dz[jb] = h
            J[:, :, jb] = (P(zr + dz)[tgt] - P(zr - dz)[tgt]) / (2 * h)
        lin = np.einsum('rij,rjt->rit', J, phi)
        resid_abl = (base[tgt] - k / 6) - dP.sum(2)
        resid_lin = (base[tgt] - k / 6) - lin.sum(2)
        scale = np.abs(base[tgt] - k / 6).mean()
        sh = lambda x: np.abs(x).sum(1) / np.abs(x).sum(1).sum(1, keepdims=True)  # noqa: E731
        Sabl, Slin = sh(dP), sh(lin)
        Sdir, Swin = SH[(st, tgt, 0)][sub], SH[k0][sub]
        res[tgt] = {'share_mean_ablation': dict(zip(TK, r4(Sabl.mean(0).tolist()))),
                    'share_mean_linear': dict(zip(TK, r4(Slin.mean(0).tolist()))),
                    'share_mean_direct_model': dict(zip(TK, r4(Sdir.mean(0).tolist()))),
                    'share_mean_win_model': dict(zip(TK, r4(Swin.mean(0).tolist()))),
                    'ablation_vs_direct': compare(Sdir, Sabl), 'ablation_vs_win': compare(Swin, Sabl),
                    'linear_vs_ablation': compare(Sabl, Slin), 'direct_vs_win': compare(Swin, Sdir),
                    'additivity_residual': r4({'ablation_mean_abs': np.abs(resid_abl).mean(), 'linear_mean_abs': np.abs(resid_lin).mean(),
                                               'mean_abs_P_minus_uniform': scale,
                                               'ablation_relative': np.abs(resid_abl).mean() / scale,
                                               'linear_relative': np.abs(resid_lin).mean() / scale}, 5)}
    e[st] = res
out['e'] = e
out['seconds'] = round(time.time() - t0); out['load_end'] = os.getloadavg(); out['model_dir'] = MD
json.dump(out, open(OUTF, 'w'), ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
log('done', OUTF)
