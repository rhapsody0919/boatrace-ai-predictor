"""model-prep 3b: 計算2「テーマが見込みを動かした量（全国=100）」

定義（2026-10-03 の統計の検証 P0-1 を受けたもの）:
  1. 艇ごとに、テーマ内の特徴量の SHAP（pred_contrib、log-odds）を符号つきで足す（テーマの SHAP）
  2. レース内で中心化（6艇の平均を引く）
  3. 6艇の |値| を足す → そのレースのテーマの L1（log-odds）
  4. スライス内のレースで平均し、全国（同じ母集団の変種の全レース）の平均で割って ×100
  合計・順位は作らない。テーマは7（環境を 天候・水面／グレード・ラウンド・節 に分ける）と、6テーマの「環境」
  （環境の9列を1テーマとして足してから中心化。7テーマの2つの L1 の和とは一致しない）。
誤差: 日単位のブートストラップ（test 期間の日を復元抽出、同じ日のレースはまとめて）200回。各回でスライスの平均と
  全国の平均を両方計算し直して指数を出し、SD と 2.5/97.5 パーセンタイルを返す。
スライス: 全国、会場24、グレード5、ラウンド4（grade・round は train.py の profile_keys と同じ列。不明は全国にだけ入る）、
  若松×G1×優勝戦。
データの穴: 月ごとの欠損率（展示タイム exh_time・過去の平均ST st_mean30・当該レースの ST st_result・風 wind_x・
  最終日 is_final_day_num・グレード grade_code）を出し、基準（HOLE_RULE）で穴の月を決める。穴の月を含む（all_months）・
  除く（excl_hole_months）・依頼で言われた 2025-12〜2026-03 を除く（excl_2025-12_to_2026-03）の3つで全部出す。
参考: スライスの実際の1号艇の1着率と、1着モデルの予測1位の平均確率（softmax(温度×生スコア) の6艇最大の平均）、
  1号艇の予測1着確率の平均。

入力: work/test.pkl・work/contrib_*.npy・work/pred_raw_win.npy
出力: work/calc2.json・work/missing_by_month.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "code-at-train"))
import lightgbm as lgb  # noqa: E402
from calc1_race import THEMES7  # noqa: E402
from themes import THEMES  # noqa: E402

VERSION = "2026-10-02"
MODELS = {"win": 1, "top2": 2, "top3": 3}
N_BOOT = 200
BOOT_SEED = 0
GRADES = ["ippan", "G3", "G2", "G1", "SG"]
ROUNDS = ["yosen", "junyu", "yusho", "other"]
# 穴の月の基準: 展示タイムか当該レースの ST の欠損率が 5% を超える月（データが揃っている月はどちらも 1% 未満。
# 実際の値は missing_by_month.json）。過去の平均ST（st_mean30）は前の30走から作るので穴の後も尾を引くため、
# 判定には使わず参考として出す
HOLE_THRESHOLD = 0.05
# 版 2026-10-02 の特徴量（学習時のコード）では、展示タイム・ST は K/B 補完で埋まっていて穴が出ない（全月 0.2% 以下）。
# 穴は風（wind_x・wind_y）と最終日（is_final_day_num）に出る（2025-12 は 95%、2026-01 は 100% 欠損。他の月の風は
# 無風の扱いで 9〜15%、最終日は 1% 未満）。そこで、展示・ST に加えて、レース単位の列（風・最終日・グレード）の
# 欠損率が HOLE_RACE_THRESHOLD を超える月も穴とする
HOLE_RACE_THRESHOLD = 0.5
HOLE_RACE_COLS = ["wind_x", "is_final_day_num", "grade_code"]
# 参考: 依頼で言われた穴の期間（2025-12〜2026-03）をまるごと除く版も出す
USER_HOLE_MONTHS = ["2025-12", "2026-01", "2026-02", "2026-03"]
CUBE_MIN_N = 300
HOLE_RULE = ("月ごとの艇単位の欠損率（完全レース）で、exh_time（展示タイム）か st_result（そのレースの ST）が"
             f" {HOLE_THRESHOLD:.0%} を超える、または wind_x・is_final_day_num・grade_code のどれかが"
             f" {HOLE_RACE_THRESHOLD:.0%} を超える月を「穴の月」とする")


def theme_signed(contrib: np.ndarray, names: list[str], themes: list[dict]) -> np.ndarray:
    """(N艇, テーマ) の符号つきのテーマの SHAP。"""
    idx = {f: i for i, f in enumerate(names)}
    c = contrib[:, :-1].astype("float64")
    return np.column_stack([c[:, [idx[f] for g in t["groups"] for f in g["features"]]].sum(axis=1)
                            for t in themes])


def race_l1(ts: np.ndarray) -> np.ndarray:
    r = ts.reshape(-1, 6, ts.shape[1])
    return np.abs(r - r.mean(axis=1, keepdims=True)).sum(axis=1)


def missing_by_month(test: pd.DataFrame) -> dict:
    m = test["race_date"].dt.strftime("%Y-%m")
    out = {}
    for mon, d in test.groupby(m):
        out[mon] = {"n_races": int(d["race_id"].nunique()),
                    "exh_time_missing": float(d["exh_time"].isna().mean()),
                    "st_result_missing": float(d["st_result"].isna().mean()),
                    "st_mean30_missing": float(d["st_mean30"].isna().mean()),
                    "exh_race_all6_missing": float(d["exh_time"].isna().to_numpy().reshape(-1, 6).all(1).mean()),
                    **{f"{c}_missing": float(d[c].isna().mean()) for c in HOLE_RACE_COLS}}
    return out


def main():
    work = HERE / "work"
    test = pd.read_pickle(work / "test.pkl")
    for c in ("grade", "round"):
        test[c] = test[c].astype(object).where(test[c].notna(), None)
    first = test[test["boat_number"] == 1].reset_index(drop=True)
    if not (test["boat_number"].to_numpy().reshape(-1, 6) == np.arange(1, 7)).all():
        raise RuntimeError("test の行が レース×艇番1〜6 の順に並んでいない")
    mbm = missing_by_month(test)
    (work / "missing_by_month.json").write_text(json.dumps(mbm, ensure_ascii=False, indent=1))
    holes = sorted(k for k, v in mbm.items()
                   if v["exh_time_missing"] > HOLE_THRESHOLD or v["st_result_missing"] > HOLE_THRESHOLD
                   or any(v[f"{c}_missing"] > HOLE_RACE_THRESHOLD for c in HOLE_RACE_COLS))
    print("hole months:", holes, flush=True)

    meta = json.loads((HERE / "models" / VERSION / "train_meta.json").read_text())
    temp = meta["metrics"]["win"]["temperature"]
    raw_win = np.load(work / "pred_raw_win.npy").astype("float64").reshape(-1, 6)
    z = temp * raw_win
    p = np.exp(z - z.max(axis=1, keepdims=True))
    p = p / p.sum(axis=1, keepdims=True)
    pred_top_prob = p.max(axis=1)
    pred_b1_prob = p[:, 0]
    pred_top_is_b1 = p.argmax(axis=1) == 0
    actual_b1_win = test["y_win"].to_numpy().reshape(-1, 6)[:, 0] == 1

    names_by_model, l1 = {}, {}
    theme_keys7 = [t["key"] for t in THEMES7]
    for name in MODELS:
        m = lgb.Booster(model_file=str(HERE / "models" / VERSION / f"model_{name}.txt"))
        names = m.feature_name()
        contrib = np.load(work / f"contrib_{name}.npy")
        l7 = race_l1(theme_signed(contrib, names, THEMES7))
        l6 = race_l1(theme_signed(contrib, names, [t for t in THEMES]))
        env6 = l6[:, [t["key"] for t in THEMES].index("environment")]
        l1[name] = np.column_stack([l7, env6])  # 7テーマ＋環境（6テーマの定義）
        names_by_model[name] = names
    keys_out = theme_keys7 + ["environment(6テーマ)"]

    days, day_code = np.unique(first["race_date"].to_numpy(), return_inverse=True)
    month = first["race_date"].dt.strftime("%Y-%m").to_numpy()
    rng = np.random.default_rng(BOOT_SEED)
    W = rng.multinomial(len(days), np.full(len(days), 1 / len(days)), size=N_BOOT).astype("float64")

    slices = {"national": np.ones(len(first), bool)}
    for v in range(1, 25):
        slices[f"venue_{v:02d}"] = (first["venue_code"].astype(int) == v).to_numpy()
    for g in GRADES:
        slices[f"grade_{g}"] = (first["grade"] == g).to_numpy()
    for r in ROUNDS:
        slices[f"round_{r}"] = (first["round"] == r).to_numpy()
    slices["venue_20_G1_yusho"] = ((first["venue_code"].astype(int) == 20) & (first["grade"] == "G1")
                                   & (first["round"] == "yusho")).to_numpy()

    def day_sums(mask, vals):
        """日ごとの和 (日, k) とレース数 (日,)。"""
        s = np.zeros((len(days), vals.shape[1]))
        np.add.at(s, day_code[mask], vals[mask])
        n = np.bincount(day_code[mask], minlength=len(days)).astype("float64")
        return s, n

    out = {"model_version": VERSION, "definition": __doc__, "n_boot": N_BOOT, "boot_seed": BOOT_SEED,
           "hole_rule": HOLE_RULE, "hole_months": holes, "temperature_win": temp,
           "theme_keys": keys_out, "themes7_def": [{"key": t["key"], "name": t["name"],
                                                     "groups": [g["key"] for g in t["groups"]]} for t in THEMES7],
           "variants": {}}
    for variant, keep in (("all_months", np.ones(len(first), bool)),
                          ("excl_hole_months", ~np.isin(month, holes)),
                          ("excl_2025-12_to_2026-03", ~np.isin(month, USER_HOLE_MONTHS))):
        vout = {"period": [str(first.loc[keep, "race_date"].min().date()),
                           str(first.loc[keep, "race_date"].max().date())],
                "excluded_months": {"all_months": [], "excl_hole_months": holes}.get(variant, USER_HOLE_MONTHS),
                "slices": {}}
        nat_mask = keep
        for sname, smask in slices.items():
            mask = smask & keep
            n_r = int(mask.sum())
            rec = {"n_races": n_r, "n_days": int(len(np.unique(day_code[mask]))) if n_r else 0}
            if n_r == 0:
                vout["slices"][sname] = rec
                continue
            rec["actual_boat1_win_rate"] = float(actual_b1_win[mask].mean())
            rec["pred_top1_mean_prob_win"] = float(pred_top_prob[mask].mean())
            rec["pred_boat1_mean_prob_win"] = float(pred_b1_prob[mask].mean())
            rec["pred_top1_is_boat1_rate"] = float(pred_top_is_b1[mask].mean())
            rec["models"] = {}
            for name in MODELS:
                v = l1[name]
                s_sum, s_n = day_sums(mask, v)
                a_sum, a_n = day_sums(nat_mask, v)
                mean_s = s_sum.sum(0) / s_n.sum()
                mean_a = a_sum.sum(0) / a_n.sum()
                idx = 100 * mean_s / mean_a
                with np.errstate(invalid="ignore", divide="ignore"):
                    bs = (W @ s_sum) / (W @ s_n)[:, None]
                    ba = (W @ a_sum) / (W @ a_n)[:, None]
                    bidx = 100 * bs / ba
                ok = np.isfinite(bidx).all(axis=1)
                bidx = bidx[ok]
                rec["models"][name] = {
                    k: {"index": float(idx[j]), "sd": float(bidx[:, j].std(ddof=1)),
                        "ci95": [float(np.percentile(bidx[:, j], 2.5)), float(np.percentile(bidx[:, j], 97.5))],
                        "mean_l1_logodds": float(mean_s[j]), "national_mean_l1_logodds": float(mean_a[j])}
                    for j, k in enumerate(keys_out)}
                rec["models"][name]["_boot_valid"] = int(ok.sum())
            vout["slices"][sname] = rec
        out["variants"][variant] = vout
    # cube: 会場（0＝全国＋24）×グレード（all＋5）×ラウンド（all＋4）の全組み合わせ。穴の月を除く版だけ。
    # n_races >= CUBE_MIN_N のセルだけ7テーマ×着順3つの指数（全国=100、全国も穴の月を除く）と日単位ブートストラップの SD。
    # 値は小数1桁。キー "venue|grade|round"
    keep = ~np.isin(month, holes)
    venue = first["venue_code"].astype(int).to_numpy()
    grade = first["grade"].to_numpy()
    rnd = first["round"].to_numpy()
    nat_sums = {name: day_sums(keep, l1[name][:, :7]) for name in MODELS}
    cube = {}
    for v in [0] + list(range(1, 25)):
        for g in ["all"] + GRADES:
            for r in ["all"] + ROUNDS:
                mask = keep.copy()
                if v:
                    mask &= venue == v
                if g != "all":
                    mask &= grade == g
                if r != "all":
                    mask &= rnd == r
                n_r = int(mask.sum())
                cell = {"n": n_r}
                if n_r >= CUBE_MIN_N:
                    cell["n_days"] = int(len(np.unique(day_code[mask])))
                    for name in MODELS:
                        s_sum, s_n = day_sums(mask, l1[name][:, :7])
                        a_sum, a_n = nat_sums[name]
                        idx = 100 * (s_sum.sum(0) / s_n.sum()) / (a_sum.sum(0) / a_n.sum())
                        with np.errstate(invalid="ignore", divide="ignore"):
                            bidx = 100 * ((W @ s_sum) / (W @ s_n)[:, None]) / ((W @ a_sum) / (W @ a_n)[:, None])
                        bidx = bidx[np.isfinite(bidx).all(axis=1)]
                        cell[name] = {k: [round(float(idx[j]), 1), round(float(bidx[:, j].std(ddof=1)), 1)]
                                      for j, k in enumerate(theme_keys7)}
                cube[f"{v}|{g}|{r}"] = cell
    out["cube"] = {"variant": "excl_hole_months", "min_n": CUBE_MIN_N,
                   "value_format": "{model: {theme: [index（全国=100）, 日単位ブートストラップの SD]}}、小数1桁",
                   "national_basis": "穴の月を除いた test の全レース", "theme_keys": theme_keys7,
                   "cells": cube}
    print("cube cells", len(cube), "with values", sum(1 for c in cube.values() if "win" in c))
    (work / "calc2.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    w = out["variants"]["all_months"]["slices"]["venue_20_G1_yusho"]
    print("wakamatsu G1 yusho n", w["n_races"], {k: round(v["index"]) for k, v in w["models"]["win"].items()
                                                  if not k.startswith("_")})


if __name__ == "__main__":
    main()
