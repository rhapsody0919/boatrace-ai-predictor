"""BOA-271 Phase M — MD-1/MD-5 主モデル（艇単位の着順モデル）の検証

- 長期に取れている項目だけで作る（common.THEMES）
- 時系列の拡張窓5分割。各分割の train の末尾3か月を early stopping と温度合わせに使う
- 最低限のハイパーパラメータ調整は、分割1の train 期間内の時系列 CV（2分割）で行う
- 合格判定: 1着艇の6クラス対数損失で、基準1（会場×1号艇の級別の過去の1着艇分布）に
  レース単位ペア差のブートストラップ95%CIで有意に勝つか
- SHAP（pred_contrib）を6テーマに集約したシェアを、全体・グレード別・ラウンド別に出す

出力: data/ml/analogy/main_result.json（結果ファイルは report.py が docs 側にまとめる）
"""

from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd

import common as C

PERIOD_HOLE = (pd.Timestamp("2025-12-03"), pd.Timestamp("2026-03-31"))
FOLDS = [
    ("F1", "2019-04-01", "2021-12-31", "2022-01-01", "2022-12-31"),
    ("F2", "2019-04-01", "2022-12-31", "2023-01-01", "2023-12-31"),
    ("F3", "2019-04-01", "2023-12-31", "2024-01-01", "2024-12-31"),
    ("F4", "2019-04-01", "2024-12-31", "2025-01-01", "2025-12-02"),
    # 穴の期間（2025-12-03〜2026-03-31）は train にも test にも入れない
    ("F5", "2019-04-01", "2025-12-02", "2026-04-01", "2026-09-30"),
]
TUNE_FOLDS = [("2019-04-01", "2020-12-31", "2021-01-01", "2021-06-30"),
              ("2019-04-01", "2021-06-30", "2021-07-01", "2021-12-31")]
# 実行環境の負荷（load average 200〜300、スワップ15GB使用）で計算が約20倍遅いため、
# 調整は2候補・学習は train レースの無作為抽出（TRAIN_FRAC）に絞る（妥協点として報告に書く）
GRID = [dict(num_leaves=31, min_data_in_leaf=500), dict(num_leaves=127, min_data_in_leaf=2000)]
TRAIN_FRAC = 0.35
TOPK_FOLDS = ("F4", "F5")  # 2着以内・3着以内は SHAP を出す分割だけ
SHAP_FOLDS = ("F4", "F5")
SHAP_RANDOM_RACES = 2000
SHAP_SLICE_CAP = 600


def sl(df, a, b):
    return df[(df["race_date"] >= a) & (df["race_date"] <= b)]


def split_inner(train, months=3, frac=TRAIN_FRAC, seed=0):
    """末尾 months か月を early stopping・温度合わせに。残りからレースを frac だけ無作為抽出して学習。"""
    cut = train["race_date"].max() - pd.DateOffset(months=months)
    tr, es = train[train["race_date"] <= cut], train[train["race_date"] > cut]
    if frac < 1:
        ids = tr["race_id"].unique()
        keep = np.random.default_rng(seed).choice(ids, int(len(ids) * frac), replace=False)
        tr = tr[tr["race_id"].isin(keep)]
    return tr, es


def win_probs(m, df, feats, a):
    z = C.raw_score(m, df, feats).reshape(-1, 6)
    return C.softmax_rows(z, a)


def tune(df, feats):
    res = []
    for params in GRID:
        lls = []
        for a, b, c, d in TUNE_FOLDS:
            tr, va = sl(df, a, b), sl(df, c, d)
            tr_in, es = split_inner(tr, 3)
            m = C.fit_lgb(tr_in, es, feats, "y_win", params)
            z = C.raw_score(m, es, feats).reshape(-1, 6)
            t = C.fit_temperature(z, C.winner_index(es))
            p = win_probs(m, va, feats, t)
            lls.append(float(C.per_race_logloss(p, C.winner_index(va)).mean()))
        res.append({"params": params, "val_logloss": lls, "mean": float(np.mean(lls))})
        print("  tune", params, [round(x, 5) for x in lls])
    best = min(res, key=lambda r: r["mean"])
    return best["params"], res


def shap_sample(te, rng):
    races = te[te["boat_number"] == 1][["race_id", "grade", "round"]].copy()
    for col in ("grade", "round"):
        races[col] = races[col].astype(object).fillna("不明")
    rnd = set(rng.choice(races["race_id"], min(SHAP_RANDOM_RACES, len(races)), replace=False))
    extra = set()
    for col in ("grade", "round"):
        for _, g in races.groupby(col):
            ids = g["race_id"].to_numpy()
            extra |= set(rng.choice(ids, min(SHAP_SLICE_CAP, len(ids)), replace=False))
    ids = rnd | extra
    s = te[te["race_id"].isin(ids)].copy()
    for col in ("grade", "round"):
        s[col] = s[col].astype(object).fillna("不明")
    s["in_random"] = s["race_id"].isin(rnd)
    return s


def shares_block(m, s, feats):
    contrib = m.predict(s[feats].astype(float), num_iteration=m.best_iteration,
                        pred_contrib=True)
    out = {}
    sh, fsh, n = C.theme_shares(contrib, feats, mask=s["in_random"].to_numpy())
    out["overall"] = {"shares": sh, "n_boats": n, "feature_shares": fsh}
    for col in ("grade", "round"):
        out[col] = {}
        for k in s[col].unique():
            mask = (s[col] == k).to_numpy()
            sh, _, n = C.theme_shares(contrib, feats, mask=mask)
            out[col][str(k)] = {"shares": sh, "n_boats": n, "n_races": n // 6}
    return out


def main():
    t0 = time.time()
    df = pd.read_pickle(C.D / "boats.pkl")
    df = C.complete_races(df)
    df = df[~((df["race_date"] >= PERIOD_HOLE[0]) & (df["race_date"] <= PERIOD_HOLE[1]))]
    feats = C.BASE_FEATURES
    print(f"races={df['race_id'].nunique():,}  rows={len(df):,}")

    print("== ハイパーパラメータ調整（F1 train 期間内の時系列CV） ==")
    best, tune_res = tune(sl(df, "2019-04-01", "2021-12-31"), feats)
    print("  best", best)

    rng = np.random.default_rng(42)
    results = {"features": feats, "themes": C.THEMES, "tuning": {"grid": tune_res, "best": best},
               "folds": []}
    for name, a, b, c, d in FOLDS:
        tr, te = sl(df, a, b), sl(df, c, d)
        tr_in, es = split_inner(tr, 3)
        fold = {"fold": name, "train": [a, b], "test": [c, d],
                "n_train_races": int(tr["race_id"].nunique()),
                "n_test_races": int(te["race_id"].nunique()), "targets": {}}
        print(f"== {name}: train {a}..{b} ({fold['n_train_races']:,}R)  test {c}..{d} ({fold['n_test_races']:,}R)")
        fold["n_train_races_used"] = int(tr_in["race_id"].nunique())
        fold["n_es_races"] = int(es["race_id"].nunique())
        for tname, ycol in C.TARGETS.items():
            if tname != "win" and name not in TOPK_FOLDS:
                continue
            m = C.fit_lgb(tr_in, es, feats, ycol, best)
            info = {"best_iteration": int(m.best_iteration)}
            if tname == "win":
                z_es = C.raw_score(m, es, feats).reshape(-1, 6)
                temp = C.fit_temperature(z_es, C.winner_index(es))
                y_te, y_tr = C.winner_index(te), C.winner_index(tr_in)
                p_te = win_probs(m, te, feats, temp)
                p_tr = win_probs(m, tr_in, feats, temp)
                p_b = C.baseline_winner(tr, te)
                ll_m = C.per_race_logloss(p_te, y_te)
                ll_b = C.per_race_logloss(p_b, y_te)
                ll_tr = C.per_race_logloss(p_tr, y_tr)
                br_m, br_b = C.per_race_brier(p_te, y_te), C.per_race_brier(p_b, y_te)
                days = te[te["boat_number"] == 1]["race_date"].to_numpy()
                info.update({
                    "temperature": temp,
                    "logloss_model": float(ll_m.mean()), "logloss_baseline": float(ll_b.mean()),
                    "logloss_train": float(ll_tr.mean()),
                    "overfit_gap_test_minus_train": float(ll_m.mean() - ll_tr.mean()),
                    "brier_model": float(br_m.mean()), "brier_baseline": float(br_b.mean()),
                    "top1_acc_model": float((p_te.argmax(1) == y_te).mean()),
                    "top1_acc_baseline": float((p_b.argmax(1) == y_te).mean()),
                    "uniform_logloss": float(np.log(6)),
                    "paired_logloss_model_minus_baseline": C.paired_ci(ll_m - ll_b, clusters=days),
                    "paired_brier_model_minus_baseline": C.paired_ci(br_m - br_b, clusters=days),
                    "calibration_model": C.calibration_deciles(p_te.ravel(), te["y_win"].to_numpy()),
                    "calibration_baseline": C.calibration_deciles(p_b.ravel(), te["y_win"].to_numpy()),
                })
                ci = info["paired_logloss_model_minus_baseline"]["ci95"]
                print(f"   win: model {ll_m.mean():.4f} / base {ll_b.mean():.4f} / train {ll_tr.mean():.4f}"
                      f"  diff CI {ci[0]:+.4f}..{ci[1]:+.4f}")
            else:
                p_te = 1 / (1 + np.exp(-C.raw_score(m, te, feats)))
                p_tr = 1 / (1 + np.exp(-C.raw_score(m, tr_in, feats)))
                p_b = C.baseline_topk(tr, te, ycol)
                y = te[ycol].to_numpy()
                # レース単位にまとめてペア差（6艇の和）
                ll_m = C.binary_ll(p_te, y).reshape(-1, 6).sum(1)
                ll_b = C.binary_ll(p_b, y).reshape(-1, 6).sum(1)
                ll_tr = C.binary_ll(p_tr, tr_in[ycol].to_numpy()).reshape(-1, 6).sum(1)
                br_m = ((p_te - y) ** 2).reshape(-1, 6).sum(1)
                br_b = ((p_b - y) ** 2).reshape(-1, 6).sum(1)
                info.update({
                    "logloss_per_boat_model": float(ll_m.mean() / 6),
                    "logloss_per_boat_baseline": float(ll_b.mean() / 6),
                    "logloss_per_boat_train": float(ll_tr.mean() / 6),
                    "overfit_gap_test_minus_train": float((ll_m.mean() - ll_tr.mean()) / 6),
                    "brier_per_boat_model": float(br_m.mean() / 6),
                    "brier_per_boat_baseline": float(br_b.mean() / 6),
                    "paired_race_logloss_model_minus_baseline": C.paired_ci(ll_m - ll_b),
                    "calibration_model": C.calibration_deciles(p_te, y),
                })
                print(f"   {tname}: model {ll_m.mean()/6:.4f} / base {ll_b.mean()/6:.4f} / train {ll_tr.mean()/6:.4f}")
            if name in SHAP_FOLDS:
                s = shap_sample(te, rng)
                info["shap"] = shares_block(m, s, feats)
                print("   shap", {k: round(v, 3) for k, v in info["shap"]["overall"]["shares"].items()})
            fold["targets"][tname] = info
            if name == "F5" and tname == "win":
                m.save_model(str(C.D / "main_win_F5.txt"), num_iteration=m.best_iteration)
                results["F5_win_temperature"] = info["temperature"]
        results["folds"].append(fold)
        (C.D / "main_result.json").write_text(json.dumps(results, ensure_ascii=False, indent=1, default=str))
    results["elapsed_sec"] = time.time() - t0
    (C.D / "main_result.json").write_text(json.dumps(results, ensure_ascii=False, indent=1, default=str))
    print(f"done {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
