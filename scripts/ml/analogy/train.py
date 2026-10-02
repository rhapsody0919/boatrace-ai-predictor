"""BOA-271 FR-1 主モデルの学習・品質ゲート・寄与度プロファイル

艇単位の LightGBM（二値）を3本（1着・2着以内・3着以内）学習し、SHAP（pred_contrib）を
テーマに集計して寄与度プロファイルを作る。Phase M（phase-m-result.md）の F5 と同じ設定を本番化した。

時系列の分け方（版ごとに同じ規則）:
  test  = データの最終日から遡る12か月。品質ゲートの評価と、寄与度の集計（spec「直近12か月」）に使う
  train = それより前（2019-04〜）。末尾3か月は温度合わせにだけ使い、学習には入れない
  寄与度は表示に使うモデルが学習していない期間で数える（Phase M の F5 と同じく、すべて標本外）

木の数は固定（Phase M の F4・F5 の best_iteration から決めた値。early stopping で版ごとに揺らさない）。
seed を変えた再学習（SEEDS）で、同じ行の SHAP からシェアの SD を出す。

品質ゲート（MD-7）: (1) 1着モデルが基準1（会場×1号艇の級別の過去の1着艇分布）に、レース単位の
ペア差の日クラスタ・ブートストラップ95%CI で有意に勝つ、(2) 今の is_active の版（storage.js
download-active が out/prev/ に置く）を同じ test で評価し直し、対数損失が 0.005 以上悪化しない。
満たさなければ何も書かずに exit 1。

使い方: python train.py   （features.py の後）
出力: data/ml/analogy/out/{model_win,model_top2,model_top3}.txt・train_meta.json・profiles.json
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd

import features as F
import metrics as M
from profiles import slice_profiles
from themes import CATEGORICAL, FEATURES, THEMES, themes_for_db

OUT = F.D / "out"
PREV = OUT / "prev"

TEST_MONTHS = 12
TEMPERATURE_MONTHS = 3
SEEDS = [0, 1, 2, 3, 4]
GATE_MAX_DEGRADATION = 0.005
PARAMS = dict(objective="binary", learning_rate=0.08, num_leaves=31, min_data_in_leaf=500,
              feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
              verbosity=-1, num_threads=int(os.environ.get("ANALOGY_THREADS", "0")) or None)
# name, ラベル列, finish_target, 木の数（Phase M の best_iteration: 1着 F4 194/F5 313、
# 2着以内 290/223、3着以内 367/294 の間で丸めた）
TARGETS = [("win", "y_win", 1, 250), ("top2", "y_top2", 2, 250), ("top3", "y_top3", 3, 330)]
# 学習に使う train のレースの割合。Phase M はマシン負荷のため0.35で検証した（spec MD-1 の妥協点）
TRAIN_FRAC = float(os.environ.get("ANALOGY_TRAIN_FRAC", "1.0"))


def quality_gate(win_metrics: dict, prev_logloss: float | None) -> dict:
    reasons = []
    ci_hi = win_metrics["paired_logloss_model_minus_baseline"]["ci95"][1]
    if not ci_hi < 0:
        reasons.append(f"基準1に有意に勝っていない（対数損失の差の95%CI上限 {ci_hi:+.5f}）")
    previous = "none"
    if prev_logloss is not None:
        delta = win_metrics["logloss_model"] - prev_logloss
        previous = {"logloss": prev_logloss, "delta": delta}
        if delta >= GATE_MAX_DEGRADATION:
            reasons.append(f"前の版より対数損失が {delta:+.5f} 悪化（許容 {GATE_MAX_DEGRADATION}）")
    return {"passed": not reasons, "reasons": reasons, "previous": previous}


def split(df: pd.DataFrame):
    end = df["race_date"].max()
    test_from = end - pd.DateOffset(months=TEST_MONTHS) + pd.Timedelta(days=1)
    train = df[df["race_date"] < test_from]
    test = df[df["race_date"] >= test_from]
    temp_from = test_from - pd.DateOffset(months=TEMPERATURE_MONTHS)
    fit, temp = train[train["race_date"] < temp_from], train[train["race_date"] >= temp_from]
    if TRAIN_FRAC < 1:
        ids = fit["race_id"].unique()
        keep = np.random.default_rng(0).choice(ids, int(len(ids) * TRAIN_FRAC), replace=False)
        fit = fit[fit["race_id"].isin(keep)]
    return train, fit, temp, test


def fit_model(fit: pd.DataFrame, label: str, rounds: int, seed: int) -> lgb.Booster:
    params = {k: v for k, v in {**PARAMS, "seed": seed}.items() if v is not None}
    cats = [c for c in CATEGORICAL if c in FEATURES]
    data = lgb.Dataset(fit[FEATURES].astype("float32"), fit[label], categorical_feature=cats,
                       free_raw_data=True)
    return lgb.train(params, data, rounds)


def raw(m: lgb.Booster, df: pd.DataFrame) -> np.ndarray:
    return m.predict(df[m.feature_name()].astype("float32"), raw_score=True)


def evaluate_win(m, train, temp, test):
    t = M.fit_temperature(raw(m, temp).reshape(-1, 6), M.winner_index(temp))
    y = M.winner_index(test)
    p = M.softmax_rows(raw(m, test).reshape(-1, 6), t)
    pb = M.baseline_winner(train, test)
    ll, llb = M.per_race_logloss(p, y), M.per_race_logloss(pb, y)
    days = test.loc[test["boat_number"] == 1, "race_date"].to_numpy()
    return {"temperature": t, "logloss_model": float(ll.mean()), "logloss_baseline": float(llb.mean()),
            "top1_acc_model": float((p.argmax(1) == y).mean()),
            "paired_logloss_model_minus_baseline": M.paired_ci(ll - llb, days)}


def evaluate_topk(m, train, test, label):
    y = test[label].to_numpy()
    p = 1 / (1 + np.exp(-raw(m, test)))
    pb = M.baseline_topk(train, test, label)
    ll = M.binary_ll(p, y).reshape(-1, 6).sum(1)
    llb = M.binary_ll(pb, y).reshape(-1, 6).sum(1)
    days = test.loc[test["boat_number"] == 1, "race_date"].to_numpy()
    return {"logloss_per_boat_model": float(ll.mean() / 6),
            "logloss_per_boat_baseline": float(llb.mean() / 6),
            "paired_race_logloss_model_minus_baseline": M.paired_ci(ll - llb, days)}


def previous_win_logloss(test: pd.DataFrame) -> float | None:
    """今の is_active の版の1着モデルを、同じ test で評価し直す。無ければ None。"""
    path, meta_path = PREV / "model_win.txt", PREV / "train_meta.json"
    if not path.exists() or not meta_path.exists():
        return None
    m = lgb.Booster(model_file=str(path))
    missing = [f for f in m.feature_name() if f not in test.columns]
    if missing:
        raise RuntimeError(f"前の版のモデルが使う特徴量がデータにありません: {missing}")
    t = json.loads(meta_path.read_text())["metrics"]["win"]["temperature"]
    p = M.softmax_rows(raw(m, test).reshape(-1, 6), t)
    return float(M.per_race_logloss(p, M.winner_index(test)).mean())


def profile_keys(test: pd.DataFrame) -> pd.DataFrame:
    k = test[["race_id", "race_date", "venue_code", "boat_number", "grade", "round"]].copy()
    k["venue_code"] = k["venue_code"].astype(int)
    k["boat_number"] = k["boat_number"].astype(int)
    for c in ("grade", "round"):
        k[c] = k[c].astype(object).where(k[c].notna(), np.nan)
    return k


def main():
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    df = F.complete_races(pd.read_pickle(F.D / "boats.pkl"))
    train, fit, temp, test = split(df)
    jst = timezone(timedelta(hours=9))
    version = os.environ.get("ANALOGY_MODEL_VERSION") or datetime.now(jst).strftime("%Y-%m-%d")
    n = lambda d: int(d["race_id"].nunique())  # noqa: E731
    print(f"version {version}  fit {n(fit):,}R  temperature {n(temp):,}R  test {n(test):,}R "
          f"({test['race_date'].min().date()}〜{test['race_date'].max().date()})", flush=True)

    keys = profile_keys(test)
    metrics, profiles = {}, []
    for name, label, finish_target, rounds in TARGETS:
        contribs = []
        for seed in SEEDS:
            m = fit_model(fit, label, rounds, seed)
            if seed == SEEDS[0]:
                metrics[name] = (evaluate_win(m, train, temp, test) if name == "win"
                                 else evaluate_topk(m, train, test, label))
                m.save_model(str(OUT / f"model_{name}.txt"))
                print(f"  {name}: {json.dumps(metrics[name], ensure_ascii=False)[:300]}", flush=True)
                if name == "win":
                    gate = quality_gate(metrics["win"], previous_win_logloss(test))
                    metrics["gate"] = gate
                    if not gate["passed"]:
                        (OUT / "gate_failed.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=1))
                        sys.exit("品質ゲートで止めた: " + " / ".join(gate["reasons"]))
            contribs.append(m.predict(test[FEATURES].astype("float32"), pred_contrib=True)
                            .astype("float32"))
            print(f"    seed {seed} ({time.time() - t0:.0f}s)", flush=True)
        profiles += slice_profiles(keys, contribs, FEATURES, THEMES, finish_target)

    meta = {
        "model_version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "features": FEATURES,
        "themes": themes_for_db(),
        "targets": [{"name": n_, "finish_target": ft, "rounds": r} for n_, _, ft, r in TARGETS],
        "metrics": {**metrics, "seeds": SEEDS, "train_frac": TRAIN_FRAC,
                    "periods": {"fit": [str(fit["race_date"].min().date()), str(fit["race_date"].max().date())],
                                "temperature": [str(temp["race_date"].min().date()),
                                                str(temp["race_date"].max().date())],
                                "test": [str(test["race_date"].min().date()), str(test["race_date"].max().date())]},
                    "n_races": {"fit": n(fit), "temperature": n(temp), "test": n(test)}},
    }
    (OUT / "train_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    (OUT / "profiles.json").write_text(json.dumps(profiles, ensure_ascii=False))
    print(f"done: {len(profiles):,} セル ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
