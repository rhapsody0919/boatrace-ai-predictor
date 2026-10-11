"""BOA-271 FR-2「類似レース検索」方式比較（時系列ホールドアウト）

予測対象（レース単位の分布）:
  tech   : 決まり手6分類（逃げ/差し/まくり/まくり差し/抜き/恵まれ）
  boat   : 1着艇番(1〜6)
  course : 1着艇の進入コース(1〜6)。race_results.actual_course_{rank1}
           （export-training-data.js の actual_course 列は course_1〜6 由来で艇番と恒等の無効値 = BOA-257 のため使わない）

方式:
  base     学習期間全体の周辺分布
  venue    会場別（全体へ Dirichlet 平滑化、α は cal で選択）
  g1only   1号艇級別のみ（参考、Dirichlet）
  strat_d  層別・階層 Dirichlet: 全体→会場→×1号艇級別→×風速ビン→×グレード区分
  strat_b  層別・ハードバックオフ: n>=nmin の最も細かい層（その層は親へ α=1 で平滑化）
  strat_dw strat_d に風向粗ビン（4方位）を足したもの（参考）
  knn      SHAP重み k-NN（全会場プール）、近傍分布は会場分布を事前分布に Dirichlet 平滑化
  knn_v    同一会場内 k-NN（ハイブリッド）

前提:
  - 特徴量は発走前情報のみ（features.FEATURE_COLS）。結果・払戻・進入コースは使わない
  - 重み用 LambdaRank は学習期間だけで学習（early stopping も学習期間末尾 15% で行う）
  - cal のチューニングは train プール、test の評価は train+cal プール（固定プール）

実行（リポジトリ直下で）:
  node --env-file=.env.local scripts/ml/export-training-data.js
  # data/ml/actual_courses.csv（race_results.actual_course_1〜6）も必要。取得方法は fr2-holdout-result.md
  scripts/ml/.venv/bin/python scripts/analysis/analogy-finder-fr2-holdout.py
環境変数 ANALOGY_ROOT / ANALOGY_OUT_DIR でリポジトリ位置・出力先を上書きできる。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(os.environ.get("ANALOGY_ROOT", Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(ROOT / "scripts" / "ml"))
import features as F  # noqa: E402

OUT_DIR = Path(os.environ.get("ANALOGY_OUT_DIR", ROOT / "docs" / "design" / "analogy-finder" / "analysis"))

TRAIN_END = pd.Timestamp("2026-06-30")
CAL_END = pd.Timestamp("2026-07-31")
TEST_START = pd.Timestamp("2026-08-01")

TECHS = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"]
TARGETS = ["tech", "boat", "course"]
K_GRID = [50, 100, 200, 400]
KNN_ALPHA_GRID = [1, 2, 5, 10, 20, 50, 100]
STRAT_ALPHA_GRID = [1, 2, 5, 10, 20, 50, 100, 200, 500]
NMIN_GRID = [10, 20, 30, 50, 100, 200]
N_BOOT = 1000
RNG = np.random.default_rng(271)

# LambdaRank 設定は train_watson.py と同一（import するとモデル保存先の mkdir 等が走るため転記）
LGB_PARAMS = dict(
    objective="lambdarank", metric="ndcg", ndcg_eval_at=[1, 3],
    learning_rate=0.03, num_leaves=63, min_data_in_leaf=50,
    feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1,
    lambda_l2=1.0, verbosity=-1, seed=42,
)
RELEVANCE = {1: 3, 2: 2, 3: 1, 0: 0}

RACE_NUM = ["race_number", "wind_speed", "wave_height", "temperature",
            "water_temperature", "series_day", "is_final_day_num"]
RACE_CAT = ["venue_code", "wind_direction_code", "weather_code", "race_grade_code"]
BOAT_FEATS = [c for c in F.FEATURE_COLS
              if c not in RACE_NUM + RACE_CAT + ["boat_number"]]

THEMES = {  # 近傍の性質チェック用（z 単位の平均絶対差）
    "1号艇の実力(win_rate,grade,local_win_rate)": [("win_rate", 1), ("grade_ord", 1), ("local_win_rate", 1)],
    "2〜6号艇の実力(win_rate)": [("win_rate", b) for b in range(2, 7)],
    "機力(motor_2rate 全艇)": [("motor_2rate", b) for b in range(1, 7)],
    "展示(exhibition_time/st 全艇)": [(f, b) for f in ("exhibition_time", "exhibition_st") for b in range(1, 7)],
    "ST履歴(st_hist_mean 全艇)": [("st_hist_mean", b) for b in range(1, 7)],
    "気象(wind_speed,wave_height)": [("wind_speed", 0), ("wave_height", 0)],
    "節・R番号(series_day,race_number)": [("series_day", 0), ("race_number", 0)],
}


# ---------------------------------------------------------------------------
# データ
# ---------------------------------------------------------------------------

def load():
    cache = os.environ.get("ANALOGY_CACHE")
    if cache and Path(cache).exists():
        df = pd.read_pickle(cache)
    else:
        df = F.load_dataset(include_backfill=False)
        if cache:
            df.to_pickle(cache)
    ac = pd.read_csv(F.DATA_DIR / "actual_courses.csv")
    races = df.drop_duplicates("race_id")[[
        "race_id", "race_date", "venue_code", "race_grade", "wind_speed",
        "wind_direction_code", "winning_technique", "rank1"]].copy()
    b1 = df[df["boat_number"] == 1][["race_id", "grade"]].rename(columns={"grade": "g1"})
    races = races.merge(b1, on="race_id", how="left").merge(ac, on="race_id", how="left")

    tech_raw = races["winning_technique"].astype("string").str.strip()
    tech_map = {t: i for i, t in enumerate(TECHS)}
    races["y_tech"] = tech_raw.map(tech_map).astype("float").fillna(-1).astype(int)
    races["y_boat"] = races["rank1"].astype(int) - 1
    ac_mat = races[[f"actual_course_{i}" for i in range(1, 7)]].to_numpy(dtype=float)
    win_course = ac_mat[np.arange(len(races)), races["rank1"].astype(int).to_numpy() - 1]
    races["y_course"] = np.where(np.isnan(win_course), -1, win_course - 1).astype(int)

    races["g1"] = races["g1"].fillna("na").astype(str)
    ws = races["wind_speed"]
    races["wind_bin"] = np.select([ws.isna(), ws <= 2, ws <= 4], ["na", "0-2", "3-4"], "5+")
    races["grade_cls"] = np.where(races["race_grade"].isna(), "na",
                                  np.where(races["race_grade"] == "ippan", "ippan", "G3+"))
    wd = races["wind_direction_code"]
    # 16方位→4方位（0=北寄り(北北西〜北東手前) / 1=東寄り / 2=南寄り / 3=西寄り）。欠損は na
    races["wdir4"] = np.where(wd.isna(), "na", (((wd.fillna(0) + 2) % 16) // 4).astype(int).astype(str))
    races["venue"] = races["venue_code"].astype(int).astype(str)
    races = races.sort_values(["race_date", "race_id"]).reset_index(drop=True)
    ok_c = races["y_course"] >= 0
    label_audit = {
        "winning_technique_raw_counts": {str(k): int(v) for k, v in tech_raw.fillna("<NA>").value_counts().items()},
        "tech_excluded(欠損・逃げ抜き)": int((races["y_tech"] < 0).sum()),
        "course_missing(actual_course欠損)": int((~ok_c).sum()),
        "winner_course_ne_boat_rate": round(float((races.loc[ok_c, "y_course"] != races.loc[ok_c, "y_boat"]).mean()), 5),
    }
    return df, races, label_audit


# ---------------------------------------------------------------------------
# SHAP 重み
# ---------------------------------------------------------------------------

def train_rank(df_tr: pd.DataFrame, seed: int = 42, fixed_rounds: int | None = None):
    d = df_tr.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)
    rid = d["race_id"].drop_duplicates().tolist()
    cut = set(rid[int(len(rid) * 0.85):])
    fit, val = d[~d["race_id"].isin(cut)], d[d["race_id"].isin(cut)]
    cat_idx = [F.FEATURE_COLS.index(c) for c in F.CATEGORICAL_COLS]

    def ds(x, ref=None):
        return lgb.Dataset(x[F.FEATURE_COLS].astype(float),
                           x["finish_pos"].map(RELEVANCE).fillna(0).astype(int),
                           group=x.groupby("race_id", sort=False).size().tolist(),
                           categorical_feature=cat_idx, reference=ref)
    params = dict(LGB_PARAMS, seed=seed)
    if fixed_rounds:
        m = lgb.train(params, ds(d), fixed_rounds)
        m.best_iteration = fixed_rounds
        return m
    dtr = ds(fit)
    return lgb.train(params, dtr, 3000, valid_sets=[ds(val, dtr)],
                     callbacks=[lgb.early_stopping(100, verbose=False)])


def shap_weights(model, df_tr: pd.DataFrame, n_races=8000, seed=0):
    """レース内で中心化した |SHAP| の平均を (特徴量, 艇番) ごとに求める。

    LambdaRank はレース内の相対スコアだけが意味を持つため、レース内で一様にずれる
    寄与（会場・気象の主効果）は順位に効かない。中心化はその部分を除くため。
    """
    rid = df_tr["race_id"].drop_duplicates()
    pick = set(rid.sample(min(n_races, len(rid)), random_state=seed))
    d = df_tr[df_tr["race_id"].isin(pick)].sort_values(["race_id", "boat_number"])
    phi = model.predict(d[F.FEATURE_COLS].astype(float), num_iteration=model.best_iteration,
                        pred_contrib=True)[:, :-1]
    raw_abs = pd.Series(np.abs(phi).mean(0), index=F.FEATURE_COLS)
    ph = pd.DataFrame(phi, columns=F.FEATURE_COLS)
    ph["race_id"] = d["race_id"].to_numpy()
    cen = (ph[F.FEATURE_COLS] - ph.groupby("race_id")[F.FEATURE_COLS].transform("mean")).abs()
    cen["boat_number"] = d["boat_number"].to_numpy()
    w_fb = cen.groupby("boat_number")[F.FEATURE_COLS].mean()  # index=boat, cols=feat
    return w_fb, raw_abs, int(model.best_iteration)


# ---------------------------------------------------------------------------
# レース単位ベクトル
# ---------------------------------------------------------------------------

class RaceVec:
    def __init__(self, df, races, ref_ids):
        wide = df.set_index(["race_id", "boat_number"])[BOAT_FEATS].astype(float).unstack("boat_number")
        rc = df.drop_duplicates("race_id").set_index("race_id")
        num = rc[RACE_NUM].astype(float)
        num.columns = pd.MultiIndex.from_tuples([(c, 0) for c in RACE_NUM])
        X = pd.concat([wide, num], axis=1).reindex(races["race_id"])
        ref = X.loc[list(ref_ids)]
        self.mu, self.sd = ref.mean(), ref.std().replace(0, 1).fillna(1)
        self.Z = (X - self.mu) / self.sd  # NaN を含む（性質チェック用）
        self.cats = rc[RACE_CAT].reindex(races["race_id"]).astype("string").fillna("na")
        self.cols = list(X.columns)

    def matrix(self, w_fb: pd.DataFrame | None):
        """w_fb=None は等重み（全次元 1、カテゴリ不一致=1SD）のアブレーション。"""
        if w_fb is None:
            w_fb = pd.DataFrame(1.0, index=range(1, 7), columns=F.FEATURE_COLS)
            race_level = 1.0 / 6  # レース共通の和が 1 になるように
            w_fb[RACE_NUM + RACE_CAT] = race_level
        wcol = np.array([w_fb.loc[b, f] if b > 0 else w_fb[f].sum() for f, b in self.cols])
        blocks = [np.nan_to_num(self.Z.to_numpy(), nan=0.0) * wcol]
        wcat = {}
        for c in RACE_CAT:
            oh = pd.get_dummies(self.cats[c]).to_numpy(dtype=float)
            wcat[c] = float(w_fb[c].sum())
            blocks.append(oh * (wcat[c] / np.sqrt(2)))  # 不一致で距離^2 に w^2（=1SD差と同等）
        return (np.hstack(blocks).astype(np.float32),
                dict(zip([f"{f}@{b}" for f, b in self.cols], wcol)), wcat)


def knn(Q, P, kmax, chunk=1024):
    pp = (P.astype(np.float64) ** 2).sum(1)
    out_i = np.empty((len(Q), kmax), dtype=np.int64)
    out_d = np.empty((len(Q), kmax))
    for s in range(0, len(Q), chunk):
        q = Q[s:s + chunk]
        d2 = pp[None, :] + (q.astype(np.float64) ** 2).sum(1)[:, None] - 2 * (q @ P.T).astype(np.float64)
        idx = np.argpartition(d2, kmax - 1, axis=1)[:, :kmax]
        dd = np.take_along_axis(d2, idx, 1)
        o = np.argsort(dd, axis=1)
        out_i[s:s + chunk] = np.take_along_axis(idx, o, 1)
        out_d[s:s + chunk] = np.sqrt(np.maximum(np.take_along_axis(dd, o, 1), 0))
    return out_i, out_d


def knn_by_venue(Q, P, qv, pv, kmax):
    """同一会場内 k-NN。返す index は P 全体の index（不足分は -1）。"""
    out = np.full((len(Q), kmax), -1, dtype=np.int64)
    for v in np.unique(qv):
        qi, pi = np.where(qv == v)[0], np.where(pv == v)[0]
        k = min(kmax, len(pi))
        if k == 0:
            continue
        ii, _ = knn(Q[qi], P[pi], k)
        out[qi, :k] = pi[ii]
    return out


# ---------------------------------------------------------------------------
# 分布推定
# ---------------------------------------------------------------------------

def onehot_counts(keys_pool, y_pool, keys_q):
    m = y_pool >= 0
    tab = pd.crosstab(pd.Series(keys_pool[m], name="k"), pd.Series(y_pool[m], name="y"))
    tab = tab.reindex(columns=range(6), fill_value=0)
    C = tab.reindex(pd.Index(keys_q)).fillna(0).to_numpy(dtype=float)
    return C, C.sum(1)


def global_dist(y_pool):
    c = np.bincount(y_pool[y_pool >= 0], minlength=6).astype(float)
    return (c + 0.5) / (c.sum() + 3.0)


def hier_dirichlet(levels_pool, levels_q, y_pool, alpha):
    """levels_*: 細かくなる順の key 配列リスト。p_L = (c_L + α p_{L-1}) / (n_L + α)"""
    p = np.tile(global_dist(y_pool), (len(levels_q[0]), 1))
    ns = []
    for kp, kq in zip(levels_pool, levels_q):
        C, n = onehot_counts(kp, y_pool, kq)
        p = (C + alpha * p) / (n + alpha)[:, None]
        ns.append(n)
    return p, ns


def hard_backoff(levels_pool, levels_q, y_pool, nmin):
    chain, ns = [], []
    p = np.tile(global_dist(y_pool), (len(levels_q[0]), 1))
    for kp, kq in zip(levels_pool, levels_q):
        C, n = onehot_counts(kp, y_pool, kq)
        p = (C + 1.0 * p) / (n + 1.0)[:, None]
        chain.append(p)
        ns.append(n)
    out, n_used = chain[0].copy(), ns[0].copy()
    for L in range(1, len(chain)):
        ok = ns[L] >= nmin
        out[ok] = chain[L][ok]
        n_used[ok] = ns[L][ok]
    return out, n_used


def knn_probs(nb, k, y_pool, prior, alpha):
    sub = nb[:, :k]
    lab = np.where(sub >= 0, y_pool[np.maximum(sub, 0)], -1)
    C = np.stack([(lab == c).sum(1) for c in range(6)], 1).astype(float)
    n = C.sum(1)
    return (C + alpha * prior) / (n + alpha)[:, None], n


def losses(p, y):
    m = y >= 0
    p, y = p[m], y[m]
    ll = -np.log(np.clip(p[np.arange(len(y)), y], 1e-12, None))
    oh = np.zeros_like(p)
    oh[np.arange(len(y)), y] = 1
    return ll, ((p - oh) ** 2).sum(1), m


def boot_ci(diff):
    idx = RNG.integers(0, len(diff), (N_BOOT, len(diff)))
    bs = diff[idx].mean(1)
    return float(diff.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def nstat(n):
    n = np.asarray(n, dtype=float)
    return {"median": float(np.median(n)), "p10": float(np.percentile(n, 10)),
            "p90": float(np.percentile(n, 90)), "share_lt30": round(float((n < 30).mean()), 4)}


# ---------------------------------------------------------------------------
# 本体
# ---------------------------------------------------------------------------

def strat_levels_g1first(r):
    v, g, w, c = r["venue"], r["g1"], r["wind_bin"], r["grade_cls"]
    lv = [g, g + "|" + v, g + "|" + v + "|" + w, g + "|" + v + "|" + w + "|" + c]
    return [x.to_numpy() for x in lv]


def strat_levels(r, with_wdir=False):
    v, g, w, c = r["venue"], r["g1"], r["wind_bin"], r["grade_cls"]
    lv = [v, v + "|" + g, v + "|" + g + "|" + w, v + "|" + g + "|" + w + "|" + c]
    if with_wdir:
        lv.append(lv[-1] + "|" + r["wdir4"])
    return [x.to_numpy() for x in lv]


def run(df, races, pool_start, label, do_extras):
    print(f"\n===== {label}: pool_start={pool_start.date()} =====", flush=True)
    races = races[races["race_date"] >= pool_start].reset_index(drop=True)
    df = df[df["race_id"].isin(set(races["race_id"]))]
    is_tr = (races["race_date"] <= TRAIN_END).to_numpy()
    is_ca = ((races["race_date"] > TRAIN_END) & (races["race_date"] <= CAL_END)).to_numpy()
    is_te = (races["race_date"] >= TEST_START).to_numpy()
    split = {k: {"races": int(m.sum()), "from": str(races.loc[m, "race_date"].min().date()),
                 "to": str(races.loc[m, "race_date"].max().date())}
             for k, m in (("train", is_tr), ("cal", is_ca), ("test", is_te))}
    print(split, flush=True)

    tr_ids = races.loc[is_tr, "race_id"]
    df_tr = df[df["race_id"].isin(set(tr_ids))]
    model = train_rank(df_tr)
    w_fb, raw_abs, best_it = shap_weights(model, df_tr)
    rv = RaceVec(df, races, tr_ids)
    X, wcol, wcat = rv.matrix(w_fb)
    print(f"  LambdaRank best_iter={best_it}, dims={X.shape[1]}", flush=True)

    Y = {t: races[f"y_{t}"].to_numpy() for t in TARGETS}
    ven = races["venue"].to_numpy()
    tr_i, ca_i, te_i = np.where(is_tr)[0], np.where(is_ca)[0], np.where(is_te)[0]
    trca_i = np.concatenate([tr_i, ca_i])

    kmax = max(K_GRID)
    nb_cal, _ = knn(X[ca_i], X[tr_i], kmax)
    nb_te, d_te = knn(X[te_i], X[trca_i], kmax)
    nbv_cal = knn_by_venue(X[ca_i], X[tr_i], ven[ca_i], ven[tr_i], kmax)
    nbv_te = knn_by_venue(X[te_i], X[trca_i], ven[te_i], ven[trca_i], kmax)
    # 重みのアブレーション: 等重み / 本番相当の木数(76)固定で学習した SHAP 重み
    X_unif, _, _ = rv.matrix(None)
    m76 = train_rank(df_tr, fixed_rounds=76)
    w76, _, _ = shap_weights(m76, df_tr)
    X76, _, _ = rv.matrix(w76)
    extra_nb = {}
    for nm, XX in (("knn_unif", X_unif), ("knn_r76", X76)):
        extra_nb[nm] = (knn(XX[ca_i], XX[tr_i], kmax)[0], knn(XX[te_i], XX[trca_i], kmax)[0])
    print("  kNN done", flush=True)

    def venue_prior(pool_i, q_i, y):
        g = global_dist(y[pool_i])
        C, n = onehot_counts(ven[pool_i], y[pool_i], ven[q_i])
        return (C + 1.0 * g) / (n + 1.0)[:, None]

    results, tuning, per_race, nstats = {}, {}, {}, {}
    for t in TARGETS:
        y = Y[t]
        P, tun = {}, {}
        P["base"] = (np.tile(global_dist(y[trca_i]), (len(te_i), 1)), None)
        lv_all = {"venue": [ven], "g1only": [races["g1"].to_numpy()],
                  "strat_d": strat_levels(races), "strat_dw": strat_levels(races, True),
                  "strat_g": strat_levels_g1first(races)}
        for name, lv in lv_all.items():
            best, grid = None, {}
            for a in STRAT_ALPHA_GRID:
                p, _ = hier_dirichlet([l[tr_i] for l in lv], [l[ca_i] for l in lv], y[tr_i], a)
                ll = float(losses(p, y[ca_i])[0].mean())
                grid[f"a{a}"] = round(ll, 5)
                if best is None or ll < best[1]:
                    best = (a, ll)
            tun[name] = {"alpha": best[0], "cal_logloss": round(best[1], 5), "grid": grid}
            p, ns = hier_dirichlet([l[trca_i] for l in lv], [l[te_i] for l in lv], y[trca_i], best[0])
            P[name] = (p, ns[-1])
        lv = strat_levels(races)
        best, grid = None, {}
        for nm in NMIN_GRID:
            p, _ = hard_backoff([l[tr_i] for l in lv], [l[ca_i] for l in lv], y[tr_i], nm)
            ll = float(losses(p, y[ca_i])[0].mean())
            grid[f"nmin{nm}"] = round(ll, 5)
            if best is None or ll < best[1]:
                best = (nm, ll)
        tun["strat_b"] = {"nmin": best[0], "cal_logloss": round(best[1], 5), "grid": grid}
        P["strat_b"] = hard_backoff([l[trca_i] for l in lv], [l[te_i] for l in lv], y[trca_i], best[0])
        pr_cal, pr_te = venue_prior(tr_i, ca_i, y), venue_prior(trca_i, te_i, y)
        for name, nc, nt in (("knn", nb_cal, nb_te), ("knn_v", nbv_cal, nbv_te),
                             ("knn_unif",) + extra_nb["knn_unif"], ("knn_r76",) + extra_nb["knn_r76"]):
            best, grid = None, {}
            for k in K_GRID:
                for a in KNN_ALPHA_GRID:
                    p, _ = knn_probs(nc, k, y[tr_i], pr_cal, a)
                    ll = float(losses(p, y[ca_i])[0].mean())
                    grid[f"k{k}_a{a}"] = round(ll, 5)
                    if best is None or ll < best[2]:
                        best = (k, a, ll)
            tun[name] = {"k": best[0], "alpha": best[1], "cal_logloss": round(best[2], 5), "grid": grid}
            P[name] = knn_probs(nt, best[0], y[trca_i], pr_te, best[1])
        tuning[t] = tun

        yt = y[te_i]
        res, per = {}, {}
        for name, (p, _) in P.items():
            ll, br, m = losses(p, yt)
            per[name] = (ll, br)
            res[name] = {"n_eval": int(m.sum()), "logloss": round(float(ll.mean()), 5),
                         "brier": round(float(br.mean()), 5)}
        results[t], per_race[t] = res, per
        nstats[t] = {name: nstat(n) for name, (p, n) in P.items() if n is not None}
        print(f"  [{t}] " + " ".join(f"{k}={v['logloss']:.4f}" for k, v in res.items()), flush=True)

    primary = min(("strat_d", "strat_b"), key=lambda s: tuning["tech"][s]["cal_logloss"])
    pairs = [("knn", primary), ("knn_v", primary), ("knn", "venue"), (primary, "venue"),
             ("strat_d", "strat_b"), ("strat_dw", "strat_d"), ("knn", "knn_v"),
             ("g1only", "base"), ("venue", "base"),
             ("knn", "g1only"), ("knn", "strat_g"), ("g1only", primary), ("strat_g", primary),
             ("knn", "knn_unif"), ("knn_r76", "knn"), ("knn_r76", primary), ("knn_unif", primary)]
    diffs = {}
    for t in TARGETS:
        diffs[t] = {}
        for a, b in pairs:
            for mi, mname in ((0, "logloss"), (1, "brier")):
                mean, lo, hi = boot_ci(per_race[t][a][mi] - per_race[t][b][mi])
                diffs[t][f"{a} - {b} ({mname})"] = {"mean": round(mean, 5), "ci95": [round(lo, 5), round(hi, 5)]}
    best_any = min(("strat_d", "strat_b", "strat_dw", "strat_g", "g1only"),
                   key=lambda s: tuning["tech"][s]["cal_logloss"])
    for t in TARGETS:
        for mi, mname in ((0, "logloss"), (1, "brier")):
            key = f"knn - {best_any} (logloss)".replace("logloss", mname)
            if key not in diffs[t]:
                mean, lo, hi = boot_ci(per_race[t]["knn"][mi] - per_race[t][best_any][mi])
                diffs[t][key] = {"mean": round(mean, 5), "ci95": [round(lo, 5), round(hi, 5)]}
    d_main = diffs["tech"][f"knn - {primary} (logloss)"]
    out = {"label": label, "pool_start": str(pool_start.date()), "split": split,
           "lambdarank_best_iter": best_it, "primary_strat": primary,
           "best_strat_any_on_cal(参考・事後)": best_any,
           "results": results, "tuning": tuning, "paired_diff": diffs,
           "verdict": {"rule": "knn - 層別(cal で strat_d/strat_b の良い方) の tech 対数損失ペア差 95%CI 上限 < 0 なら k-NN、それ以外は層別",
                       "diff": d_main, "winner": "k-NN" if d_main["ci95"][1] < 0 else "層別"},
           "n_display": nstats}
    print("  verdict:", out["verdict"], flush=True)

    if do_extras:
        out["weights"] = weight_report(raw_abs, wcol, wcat)
        k_t = tuning["tech"]["knn"]["k"]
        kv_t = tuning["tech"]["knn_v"]["k"]
        out["neighbor_profile_knn"] = neighbor_profile(rv, races, te_i, trca_i, nb_te, k_t, ven)
        out["neighbor_profile_knn_v"] = neighbor_profile(rv, races, te_i, trca_i, nbv_te, kv_t, ven)
        out["neighbor_distance_knn"] = {"median_dist_1st": float(np.median(d_te[:, 0])),
                                        f"median_dist_{k_t}th": float(np.median(d_te[:, k_t - 1]))}
        out["stability"] = stability(df, races, rv, nb_te, te_i, trca_i, k_t)
    return out


def weight_report(raw_abs, wcol, wcat):
    total = sum(wcol.values()) + sum(wcat.values())
    items = list(wcol.items()) + [(f"{c}@cat", v) for c, v in wcat.items()]
    by_feat, by_slot = {}, {}
    for k, v in items:
        f, s = k.split("@")
        by_feat[f] = by_feat.get(f, 0) + v
        by_slot[s] = by_slot.get(s, 0) + v
    return {
        "note": "重み=レース内中心化|SHAP|の平均。艇別特徴量は(特徴量,艇番)ごと、レース共通特徴量は6艇分の和。"
                "boat_number はレース単位ベクトルでは全レース同じ並びで次元にできないため除外",
        "boat_number_raw_mean_abs_shap": round(float(raw_abs["boat_number"]), 5),
        "raw_mean_abs_shap_by_feature": {k: round(float(v), 5) for k, v in raw_abs.sort_values(ascending=False).items()},
        "share_by_feature": {k: round(v / total, 4) for k, v in sorted(by_feat.items(), key=lambda x: -x[1])},
        "share_by_slot(0=レース共通数値, cat=カテゴリ)": {k: round(v / total, 4) for k, v in sorted(by_slot.items())},
        "top20_dims": [[k, round(v / total, 4)] for k, v in sorted(items, key=lambda x: -x[1])[:20]],
    }


def neighbor_profile(rv, races, te_i, pool_i, nb, k, ven):
    rng = np.random.default_rng(7)
    rand = pool_i[rng.integers(0, len(pool_i), (len(te_i), k))]
    sub = nb[:, :k]
    nbg = np.where(sub >= 0, pool_i[np.maximum(sub, 0)], -1)
    valid = nbg >= 0
    prof = {}
    for th, cols in THEMES.items():
        zc = rv.Z[cols].to_numpy()
        q = zc[te_i][:, None, :]

        def gap(idx, msk):
            v = zc[np.maximum(idx, 0)].copy()
            v[~msk] = np.nan
            return float(np.nanmean(np.abs(v - q)))
        g_nb, g_rd = gap(nbg, valid), gap(rand, np.ones_like(valid))
        prof[th] = {"neighbor_abs_z_gap": round(g_nb, 4), "random_abs_z_gap": round(g_rd, 4),
                    "ratio": round(g_nb / g_rd, 4)}
    for name, col in (("会場一致率", ven), ("1号艇級別一致率", races["g1"].to_numpy()),
                      ("グレード区分一致率", races["grade_cls"].to_numpy()),
                      ("風速ビン一致率", races["wind_bin"].to_numpy())):
        qv = np.broadcast_to(col[te_i][:, None], nbg.shape)
        m_nb = float(np.mean(col[np.maximum(nbg, 0)][valid] == qv[valid]))
        m_rd = float(np.mean(col[rand] == col[te_i][:, None]))
        prof[name] = {"neighbor": round(m_nb, 4), "random": round(m_rd, 4)}
    prof["k"] = k
    return prof


def stability(df, races, rv, nb_base, te_i, trca_i, k):
    """週次再学習を模す: 学習期間 +7日 / seed 違いで重みを学習し直し、近傍の Jaccard を見る。"""
    out = {}
    for name, end, seed in (("train_end+7d(2026-07-07)_seed42", pd.Timestamp("2026-07-07"), 42),
                            ("same_period_seed43", TRAIN_END, 43)):
        ids = races.loc[races["race_date"] <= end, "race_id"]
        d_tr = df[df["race_id"].isin(set(ids))]
        m = train_rank(d_tr, seed=seed)
        w_fb, _, _ = shap_weights(m, d_tr, seed=seed)
        X2, _, _ = rv.matrix(w_fb)
        nb2, _ = knn(X2[te_i], X2[trca_i], k)
        jac = np.array([len(set(a) & set(b)) / len(set(a) | set(b))
                        for a, b in zip(nb_base[:, :k], nb2[:, :k])])
        out[name] = {"k": k, "best_iter": int(m.best_iteration), "jaccard_mean": round(float(jac.mean()), 4),
                     "jaccard_median": round(float(np.median(jac)), 4),
                     "jaccard_p10": round(float(np.percentile(jac, 10)), 4)}
        print(f"  stability {name}: {out[name]}", flush=True)
    return out


def main():
    df, races, audit = load()
    print(audit, flush=True)
    main_res = run(df, races, races["race_date"].min(), "main(全期間プール)", True)
    sens = run(df, races, pd.Timestamp("2026-03-01"),
               "sensitivity(プール2026-03以降: 展示・風速の欠損期間を除外)", False)
    out = {"data": {"races_total": int(len(races)),
                    "date_range": [str(races["race_date"].min().date()), str(races["race_date"].max().date())],
                    "label_audit": audit},
           "main": main_res, "sensitivity_pool_from_2026_03": sens}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / "fr2-holdout-result.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    print("saved", path)


if __name__ == "__main__":
    main()
