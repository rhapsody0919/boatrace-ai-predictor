"""BOA-271 MD-6 準備: レース単位の表（ラベル・層のキー）と k-NN 用の行列を作る

Phase M の中間データ（data/ml/analogy/boats.pkl・kb_boats.csv・kb_races.csv・results.csv）と、
export-actual-course.js の actual_courses.csv を使う。特徴量は Phase M 主モデルと同じ
common.BASE_FEATURES（長期に取れている発走前の項目だけ）。実進入は目的変数(c)にだけ使う。

出力（data/ml/analogy/md6/）:
  races.pkl   レース単位の表（日付順。期間・ラベル・層のキー）
  Z.npy       k-NN 用の行列（数値は pool 期間で z 化・欠損0、カテゴリは one-hot）。重みは掛けていない
  cols.json   Z の列の定義（特徴量・艇番スロット・種類）
  shap_rows.pkl  重み（pred_contrib）を計算する標本レースの艇単位の行
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analogy-finder-phase-m"))
import common as C  # noqa: E402
from build_dataset import rid_to_int  # noqa: E402

D = C.D
OUT = D / "md6"
OUT.mkdir(exist_ok=True)

HOLE = (pd.Timestamp("2025-12-03"), pd.Timestamp("2026-03-31"))
POOL_TEST = ("2019-04-01", "2025-12-02")
POOL_CAL = ("2019-04-01", "2025-05-31")
CAL = ("2025-06-01", "2025-12-02")
TEST = ("2026-04-01", "2026-09-30")
TECHS = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"]

RACE_NUM = ["race_number", "wind_x", "wind_y", "wind_speed", "wave_height", "series_day",
            "is_final_day_num", "b1_cls_ord", "b1_nat_win"]
RACE_CAT = ["venue_code", "weather_code", "grade_code", "round_code"]
BOAT_CAT = ["branch_code"]
EXCLUDED = ["boat_number"]  # 全レース同じ並びなので次元にしない（スロット別の重みとして間接的に入る）
BOAT_NUM = [f for f in C.BASE_FEATURES if f not in RACE_NUM + RACE_CAT + BOAT_CAT + EXCLUDED]
SHAP_SAMPLE = ("2025-01-01", "2025-12-02")  # 重みを計算する標本（pool の末尾。test は使わない）
SHAP_RACES = 5000


def period(s, a, b):
    return (s >= pd.Timestamp(a)) & (s <= pd.Timestamp(b))


def main():
    cols = ["race_id", "race_date", "boat_number", "race_ok", "y_win"] + C.BASE_FEATURES
    df = pd.read_pickle(D / "boats.pkl")[list(dict.fromkeys(cols))]
    df = C.complete_races(df)
    df = df[~period(df["race_date"], *HOLE) & (df["race_date"] <= pd.Timestamp(TEST[1]))]
    df = df.reset_index(drop=True)
    assert (df.groupby("race_id").size() == 6).all()
    n = len(df) // 6
    print(f"races {n:,}", flush=True)

    r = df[df["boat_number"] == 1][["race_id", "race_date"] + RACE_NUM + RACE_CAT].reset_index(drop=True)
    win = C.race_matrix(df, "y_win").argmax(1) + 1
    r["win_boat"] = win.astype("int8")
    r["period"] = np.select(
        [period(r["race_date"], *POOL_CAL), period(r["race_date"], *CAL), period(r["race_date"], *TEST)],
        ["pool_cal", "cal", "test"], "other")
    assert (r["period"] != "other").all()

    # ---- 目的変数 (a) 決まり手 ----
    kr = pd.read_csv(D / "kb_races.csv", usecols=["race_id", "technique"])
    kr["race_id"] = rid_to_int(kr["race_id"])
    mr = pd.read_csv(D / "results.csv", usecols=["race_id", "winning_technique"]).rename(
        columns={"winning_technique": "technique"})
    mr["race_id"] = rid_to_int(mr["race_id"])
    tech = pd.concat([kr, mr]).drop_duplicates("race_id", keep="last")
    r = r.merge(tech, on="race_id", how="left")
    r["y_tech"] = r["technique"].map({t: i for i, t in enumerate(TECHS)}).fillna(-1).astype("int8")

    # ---- 目的変数 (c) 1着の進入コース（結果側のみ） ----
    kb = pd.read_csv(D / "kb_boats.csv", usecols=["race_id", "boat_number", "course", "finish_rank"],
                     dtype={"race_id": "category"})
    kb = kb[kb["finish_rank"] == 1]
    kb["race_id"] = rid_to_int(kb["race_id"].astype(str))
    kb = kb.drop_duplicates("race_id")[["race_id", "boat_number", "course"]].rename(
        columns={"boat_number": "kb_win_boat", "course": "course_kb"})
    ac = pd.read_csv(D / "actual_courses.csv")
    ac["race_id"] = rid_to_int(ac["race_id"])
    r = r.merge(kb, on="race_id", how="left").merge(ac, on="race_id", how="left")
    main_c = np.full(len(r), np.nan)
    for b in range(1, 7):
        main_c = np.where(r["win_boat"] == b, r[f"actual_course_{b}"], main_c)
    is_kb = r["race_date"] <= pd.Timestamp(POOL_TEST[1])
    c = np.where(is_kb, r["course_kb"], main_c)
    c = pd.to_numeric(pd.Series(c), errors="coerce")
    r["y_course"] = c.where(c.between(1, 6)).fillna(0).astype("int8") - 1  # -1 = 欠損
    kb_mismatch = int(((r["kb_win_boat"] != r["win_boat"]) & is_kb & r["kb_win_boat"].notna()).sum())
    r = r.drop(columns=["kb_win_boat", "course_kb"] + [f"actual_course_{b}" for b in range(1, 7)])

    # ---- 層のキー ----
    ws = r["wind_speed"]
    r["wind_bin"] = np.select([ws.isna(), ws <= 2, ws <= 4], [3, 0, 1], 2).astype("int8")
    g = r["grade_code"]
    r["grade_bin"] = np.select([g.isna(), g == 0], [2, 0], 1).astype("int8")
    r["b1_cls"] = r["b1_cls_ord"].fillna(0).astype("int8")

    # ---- k-NN 行列 ----
    pool_mask = (r["period"].isin(["pool_cal", "cal"])).to_numpy()
    blocks, meta = [], []
    X = df[BOAT_NUM].to_numpy(np.float32).reshape(n, 6, len(BOAT_NUM))
    mu = np.nanmean(X[pool_mask], axis=(0, 1))
    sd = np.nanstd(X[pool_mask], axis=(0, 1))
    sd[sd == 0] = 1
    Zb = np.nan_to_num((X - mu) / sd).astype(np.float32)
    for j, f in enumerate(BOAT_NUM):
        for b in range(6):
            blocks.append(Zb[:, b, j][:, None])
            meta.append({"feature": f, "slot": b + 1, "kind": "boat_num"})
    del X, Zb
    for f in RACE_NUM:
        v = r[f].to_numpy(np.float32)
        m, s = np.nanmean(v[pool_mask]), np.nanstd(v[pool_mask]) or 1.0
        blocks.append(np.nan_to_num((v - m) / s)[:, None].astype(np.float32))
        meta.append({"feature": f, "slot": 0, "kind": "race_num"})
    for f in RACE_CAT:
        v = r[f].fillna(-1).to_numpy()
        for cat in np.unique(v):
            blocks.append((v == cat).astype(np.float32)[:, None])
            meta.append({"feature": f, "slot": 0, "kind": "race_cat", "cat": float(cat)})
    bc = df["branch_code"].fillna(-1).to_numpy().reshape(n, 6)
    for b in range(6):
        for cat in np.unique(bc):
            blocks.append((bc[:, b] == cat).astype(np.float32)[:, None])
            meta.append({"feature": "branch_code", "slot": b + 1, "kind": "boat_cat", "cat": float(cat)})
    Z = np.hstack(blocks).astype(np.float32)
    del blocks
    np.save(OUT / "Z.npy", Z)
    (OUT / "cols.json").write_text(json.dumps(meta, ensure_ascii=False))
    r.to_pickle(OUT / "races.pkl")

    # ---- 重み計算用の標本（艇単位の行） ----
    rng = np.random.default_rng(7)
    cand = r.loc[period(r["race_date"], *SHAP_SAMPLE), "race_id"].to_numpy()
    ids = rng.choice(cand, SHAP_RACES, replace=False)
    df[df["race_id"].isin(ids)].reset_index(drop=True).to_pickle(OUT / "shap_rows.pkl")

    summ = {
        "n_races": int(n), "by_period": r["period"].value_counts().to_dict(),
        "periods": {"pool_cal": POOL_CAL, "cal": CAL, "pool_test": POOL_TEST, "test": TEST,
                    "excluded_hole": [str(HOLE[0].date()), str(HOLE[1].date())]},
        "Z_shape": list(Z.shape), "boat_num_features": BOAT_NUM, "race_num_features": RACE_NUM,
        "race_cat_features": RACE_CAT, "boat_cat_features": BOAT_CAT, "excluded": EXCLUDED,
        "tech_missing_by_period": r.assign(m=r["y_tech"] < 0).groupby("period")["m"].sum().to_dict(),
        "course_missing_by_period": r.assign(m=r["y_course"] < 0).groupby("period")["m"].sum().to_dict(),
        "kb_winner_boat_mismatch": kb_mismatch,
        "tech_dist_by_period": {p: g["technique"].value_counts(dropna=False).to_dict()
                                for p, g in r.groupby("period")},
        "winner_course_ne_boat_rate": {p: float((g.loc[g["y_course"] >= 0, "y_course"] + 1
                                                 != g.loc[g["y_course"] >= 0, "win_boat"]).mean())
                                       for p, g in r.groupby("period")},
    }
    (OUT / "prep_summary.json").write_text(json.dumps(summ, ensure_ascii=False, indent=1, default=str))
    print(json.dumps(summ, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
