"""model-prep 3a: 計算1「このレースの寄与度」（実在のレース 2026-09-27-20-12 若松 G1 優勝戦）

定義（perrace.py の centered_theme_shares・src/utils/analogyRaceContribution.js と同じ）:
  - SHAP: pred_contrib（最後の列＝期待値は使わない）。列の並びは booster.feature_name()
  - 中心化: 特徴量ごとに6艇の平均を引く
  - 6艇全体のテーマのシェア: 中心化した |SHAP| を6艇ぶん・テーマ内の特徴量ぶん足し、全テーマの合計で割る
  - 艇ごとのテーマ・グループの値: 中心化した SHAP の符号つきの合計（log-odds）
  - 艇ごとのテーマのシェア（本計算で足した定義）: その艇のテーマの符号つきの値の |値| を、その艇の全テーマの |値| の和で割る
    （参考に、特徴量単位の |中心化 SHAP| をテーマに足した割合 boat_theme_share_featureabs も出す）
  - 艇ごとの合計の符号: 中心化した SHAP の全特徴量の和（＝その艇の生スコア − 6艇の平均の生スコア）
テーマは (a) 6テーマ（themes.py）、(b) 7テーマ（環境 → 天候・水面〔weather・wind・wave〕と
グレード・ラウンド・節〔grade・round・seriesDay〕）。
予測確率（参考）: 1着は softmax(温度 × 生スコア)（温度は版の metrics.win.temperature。train.py の評価と同じ）、
2着以内・3着以内は sigmoid（艇ごとの二値。6艇の和は2・3にそろわない）。

出力: work/calc1.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "code-at-train"))

from themes import THEMES  # noqa: E402

VERSION = "2026-10-02"
RACE_ID = "2026-09-27-20-12"
MODELS = {"win": 1, "top2": 2, "top3": 3}

SPLIT_ENV = [
    {"key": "weatherWater", "name": "天候・水面", "groups": ["weather", "wind", "wave"]},
    {"key": "raceFormat", "name": "グレード・ラウンド・節", "groups": ["grade", "round", "seriesDay"]},
]


def themes7() -> list[dict]:
    out = []
    for t in THEMES:
        if t["key"] != "environment":
            out.append({"key": t["key"], "name": t["name"], "groups": t["groups"]})
            continue
        byk = {g["key"]: g for g in t["groups"]}
        for s in SPLIT_ENV:
            out.append({"key": s["key"], "name": s["name"], "groups": [byk[k] for k in s["groups"]]})
    return out


THEMES6 = [{"key": t["key"], "name": t["name"], "groups": t["groups"]} for t in THEMES]
THEMES7 = themes7()

# 実際の値と6艇中の順位を出す特徴量（グループごと）。direction: desc＝大きいほど1位、asc＝小さいほど1位、
# none＝順位に良し悪しの向きが無い（昇順で番号を振る）
VALUE_FEATURES = {
    "venue": [("venue_code", "none")], "boatNumber": [("boat_number", "asc")],
    "raceNumber": [("race_number", "none")],
    "class": [("cls_ord", "desc")],
    "national": [("nat_win", "desc"), ("nat_2", "desc"), ("nat_win_diff", "desc"), ("nat_win_rank", "asc")],
    "local": [("loc_win", "desc"), ("loc_2", "desc"), ("loc_win_diff", "desc"), ("loc_win_rank", "asc")],
    "recent": [("recent_win30", "desc"), ("recent_top3_30", "desc"), ("recent_win30_diff", "desc"),
               ("recent_win30_rank", "asc")],
    "boat1": [("b1_cls_ord", "none"), ("b1_nat_win", "none")],
    "exhibitionTime": [("exh_time", "asc"), ("exh_time_diff", "asc"), ("exh_time_rank", "asc")],
    "pastSt": [("st_mean30", "asc"), ("st_n", "desc"), ("st_mean30_diff", "asc"), ("st_mean30_rank", "asc")],
    "motor": [("motor_2", "desc"), ("motor_2_diff", "desc"), ("motor_2_rank", "asc")],
    "boat": [("boat_2", "desc"), ("boat_2_diff", "desc"), ("boat_2_rank", "asc")],
    "weather": [("weather_code", "none")], "wind": [("wind_x", "none"), ("wind_y", "none"),
                                                     ("wind_speed", "none")],
    "wave": [("wave_height", "none")], "grade": [("grade_code", "none")], "round": [("round_code", "none")],
    "seriesDay": [("series_day", "none"), ("is_final_day_num", "none")],
    "age": [("age", "asc")], "weight": [("weight", "asc")],
    "branch": [("branch_code", "none"), ("is_local", "desc")],
}


def fnum(v):
    v = float(v)
    return None if not np.isfinite(v) else v


def rank6(vals: np.ndarray, direction: str):
    s = pd.Series(vals.astype("float64"))
    if direction == "none" or s.nunique(dropna=True) <= 1:
        r = s.rank(ascending=True, method="min") if direction == "none" else pd.Series([np.nan] * len(s))
    else:
        r = s.rank(ascending=(direction == "asc"), method="min")
    return [None if pd.isna(x) else int(x) for x in r]


def aggregate(contrib: np.ndarray, names: list[str], themes: list[dict], boats: list[int]) -> dict:
    c = contrib[:, :-1].astype("float64")
    cen = c - c.mean(axis=0, keepdims=True)
    idx = {f: i for i, f in enumerate(names)}
    gcols = {g["key"]: [idx[f] for f in g["features"]] for t in themes for g in t["groups"]}
    tcols = {t["key"]: [i for g in t["groups"] for i in gcols[g["key"]]] for t in themes}
    covered = sorted(i for v in tcols.values() for i in v)
    if covered != list(range(len(names))):
        raise RuntimeError("テーマに入っていない列、または重複がある")
    abs_theme = {k: float(np.abs(cen[:, v]).sum()) for k, v in tcols.items()}
    tot = sum(abs_theme.values())
    out = {"theme_shares": {k: v / tot for k, v in abs_theme.items()},
           "theme_abs_sum_logodds": abs_theme, "total_abs_sum_logodds": tot, "boats": []}
    for i, b in enumerate(boats):
        th = {k: float(cen[i, v].sum()) for k, v in tcols.items()}
        gr = {k: float(cen[i, v].sum()) for k, v in gcols.items()}
        thabs = sum(abs(x) for x in th.values())
        fabs = {k: float(np.abs(cen[i, v]).sum()) for k, v in tcols.items()}
        fabs_t = sum(fabs.values())
        total = float(cen[i].sum())
        out["boats"].append({
            "boat_number": b, "themes_logodds": th, "groups_logodds": gr,
            "boat_theme_share": {k: abs(v) / thabs for k, v in th.items()},
            "boat_theme_share_featureabs": {k: v / fabs_t for k, v in fabs.items()},
            "total_logodds": total, "total_sign": "+" if total > 0 else ("-" if total < 0 else "0"),
            "top_theme_by_abs": max(th, key=lambda k: abs(th[k])),
        })
    return out


def main():
    work = HERE / "work"
    test = pd.read_pickle(work / "test.pkl")
    rid = int(RACE_ID.replace("-", ""))
    rows = test[test["race_id"] == rid].sort_values("boat_number")
    source = "test.pkl（版の test 期間・完全レース）"
    if len(rows) != 6:
        alt = pd.read_pickle(work / "test_all_rows.pkl")
        rows = alt[alt["race_id"] == rid].sort_values("boat_number")
        source = "test_all_rows.pkl（完全レースでない）"
    if len(rows) != 6:
        raise RuntimeError(f"{RACE_ID} の6艇が特徴量に無い（{len(rows)}艇）")
    boats = [int(b) for b in rows["boat_number"]]
    meta = json.loads((HERE / "models" / VERSION / "train_meta.json").read_text())
    temp = meta["metrics"]["win"]["temperature"]
    res = {"race_id": RACE_ID, "model_version": VERSION, "features_source": source,
           "race_ok": bool(rows["race_ok"].all()), "boats": boats, "models": {}}
    for name, ft in MODELS.items():
        m = lgb.Booster(model_file=str(HERE / "models" / VERSION / f"model_{name}.txt"))
        names = m.feature_name()
        x = rows[names].astype("float32")
        contrib = m.predict(x, pred_contrib=True)
        raw = m.predict(x, raw_score=True)
        if not np.allclose(contrib.sum(axis=1), raw, atol=1e-4):
            raise RuntimeError("pred_contrib の和が生スコアと合わない")
        if name == "win":
            prob = np.exp(temp * raw - (temp * raw).max())
            prob = prob / prob.sum()
            prob_def = f"softmax(温度 {temp:.6f} × 生スコア)（6艇の和=1）"
        else:
            prob = 1 / (1 + np.exp(-raw))
            prob_def = "sigmoid(生スコア)（艇ごと）"
        res["models"][name] = {
            "finish_target": ft, "feature_names": names,
            "expected_value_logodds": float(contrib[0, -1]),
            "raw_score": [float(v) for v in raw], "prob": [float(v) for v in prob], "prob_def": prob_def,
            "contrib_raw": [[float(v) for v in r] for r in contrib],
            "contrib_centered": [[float(v) for v in r] for r in
                                 (contrib[:, :-1] - contrib[:, :-1].mean(axis=0, keepdims=True))],
            "themes6": aggregate(contrib, names, THEMES6, boats),
            "themes7": aggregate(contrib, names, THEMES7, boats),
        }
    vals = {}
    for g, feats in VALUE_FEATURES.items():
        vals[g] = {f: {"values": [fnum(v) for v in rows[f]], "rank_in_race": rank6(rows[f].to_numpy(), d),
                       "rank_direction": d} for f, d in feats}
    res["feature_values"] = vals
    res["themes6_def"] = [{"key": t["key"], "name": t["name"], "groups": [g["key"] for g in t["groups"]]}
                          for t in THEMES6]
    res["themes7_def"] = [{"key": t["key"], "name": t["name"], "groups": [g["key"] for g in t["groups"]]}
                          for t in THEMES7]
    res["racecard"] = {"available": False,
                       "reason": "版 2026-10-02 の Storage に model_win_racecard.txt が無い（この版は出走表時点専用モデルを"
                                 "足す前のコード dc6d02084 で学習された。train_meta.json にも racecard が無い）"}
    (work / "calc1.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    w = res["models"]["win"]
    print(source, "prob win", [round(p, 3) for p in w["prob"]])
    print("theme6 shares", {k: round(v, 3) for k, v in w["themes6"]["theme_shares"].items()})


if __name__ == "__main__":
    main()
