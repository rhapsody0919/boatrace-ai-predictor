"""BOA-271 share-cube: 「AIの見立て」タブ用の、会場×グレード×ラウンドごとの材料の割合（テーマ単位・レース内中心化）

定義（このレースの割合と同じテーマ単位。本番 profiles.py の特徴量単位・中心化しない定義とは違う）:
  1. 艇ごとに、テーマ内の特徴量の SHAP（pred_contrib、log-odds）を符号つきで足す
  2. レース内で中心化（6艇の平均を引く）
  3. 全艇（boat0）: 6艇の |値| の和をスライス内のレースで平均し、全テーマの和で割る
     艇番 b（boat1〜6）: その艇の |テーマ値| の和（スライス内のレース）を、その艇の全テーマの |値| の和で割る
  - テーマは7（環境を 天候・水面 weatherWater と グレード・ラウンド・節 raceFormat に分ける）。7テーマの割合は7テーマの和で割る
  - environment6 は6テーマ（環境を1テーマ）で同じ計算をしたときの環境の割合（分母は6テーマの和）。7テーマの2つの和とは一致しない
- モデル: 版 2026-10-02 の model_win・top2・top3（展示あり）。pred_contrib は work/contrib_*.npy
- 母集団: test（2025-10-03〜2026-10-02 の完全レース）から 2025-12・2026-01 を除いたもの
- スライス: 会場（0＝全国＋24）×グレード（all＋5）×ラウンド（all＋4）。グレード・ラウンドが不明のレースは all にだけ入る
  （train.py の profile_keys と同じ）。n_races ≥ 300 のセルだけ値を出し、300 未満は n だけ
- SD: 日単位のブートストラップ 200回（同じ日のレースをまとめて復元抽出、seed 0）でのシェアの SD
- 2版目（SC_END あり）は vs_national に相対差（|差| ÷ 全国の割合）を5番目の要素として足す
- 「ほぼ同じ」の判定用に、各セル・各値で全国（0|all|all）との差と、|差| < 2×セルの SD かどうか、
  差の SD（同じブートストラップの回で セル − 全国 を取った値の SD）と |差| < 2×差の SD かどうか、を vs_national に出す
出力: share-cube.json（値は小数3桁）・share-cube.md
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "code-at-train"))
from calc1_race import THEMES7  # noqa: E402
from themes import THEMES  # noqa: E402

VERSION = "2026-10-02"
# 版の切り替え: 既定（1版目）は test 全期間・SD 小数3桁、出力 share-cube.*。
# 2版目（第5回の検証の指摘）: SC_END=2026-09-26 SC_OUT=share-cube2 SC_SD_DIGITS=6
END = os.environ.get("SC_END")
OUT_NAME = os.environ.get("SC_OUT", "share-cube")
SD_DIGITS = int(os.environ.get("SC_SD_DIGITS", "3"))
HOLES = ["2025-12", "2026-01"]
N_BOOT = 200
MIN_N = 300
GRADES = ["ippan", "G3", "G2", "G1", "SG"]
ROUNDS = ["yosen", "junyu", "yusho", "other"]
MODELS = ["win", "top2", "top3"]
T7 = [t["key"] for t in THEMES7]
T6 = [t["key"] for t in THEMES]
OUT_KEYS = T7 + ["environment6"]
BOATS = ["boat0"] + [f"boat{b}" for b in range(1, 7)]


def r3(x):
    return round(float(x), 3)


def rsd(x):
    return round(float(x), SD_DIGITS)


def theme_abs(contrib, names, themes):
    """(R, 6, T) の |中心化したテーマの値|"""
    idx = {f: i for i, f in enumerate(names)}
    n = len(contrib) // 6
    c = contrib[:, :-1].astype("float64").reshape(n, 6, len(names))
    c = c - c.mean(axis=1, keepdims=True)
    return np.abs(np.stack([c[:, :, [idx[f] for g in t["groups"] for f in g["features"]]].sum(axis=2)
                            for t in themes], axis=2))


def main():
    W = HERE / "work"
    test = pd.read_pickle(W / "test.pkl")
    first = test[test["boat_number"] == 1].reset_index(drop=True)
    month = first["race_date"].dt.strftime("%Y-%m").to_numpy()
    keep = ~np.isin(month, HOLES)
    if END:
        keep &= (first["race_date"] <= pd.Timestamp(END)).to_numpy()
    days, day_code = np.unique(first["race_date"].to_numpy(), return_inverse=True)
    Wb = np.random.default_rng(0).multinomial(len(days), np.full(len(days), 1 / len(days)), size=N_BOOT).astype("float64")
    venue = first["venue_code"].astype(int).to_numpy()
    grade = first["grade"].astype(object).to_numpy()
    rnd = first["round"].astype(object).to_numpy()

    # 各モデル: レースごとの分子 (R, 7艇モード, 8値) と分母 (R, 7艇モード, 2: 7テーマの和・6テーマの和)
    num, den = {}, {}
    for mk in MODELS:
        m = lgb.Booster(model_file=str(HERE / "models" / VERSION / f"model_{mk}.txt"))
        names = m.feature_name()
        contrib = np.load(W / f"contrib_{mk}.npy")
        a7 = theme_abs(contrib, names, THEMES7)          # (R, 6, 7)
        a6 = theme_abs(contrib, names, THEMES)           # (R, 6, 6)
        env6 = a6[:, :, T6.index("environment")]
        per_boat = np.concatenate([a7, env6[:, :, None]], axis=2)            # (R, 6, 8)
        nm = np.concatenate([per_boat.sum(axis=1, keepdims=True), per_boat], axis=1)  # (R, 7, 8)
        d7 = a7.sum(axis=2)
        d6 = a6.sum(axis=2)
        dn = np.stack([np.concatenate([d7.sum(1, keepdims=True), d7], 1),
                       np.concatenate([d6.sum(1, keepdims=True), d6], 1)], axis=2)  # (R, 7, 2)
        num[mk], den[mk] = nm, dn

    def cell_values(mask):
        res = {}
        for mk in MODELS:
            nm, dn = num[mk], den[mk]
            s_num = np.zeros((len(days), 7 * 8))
            s_den = np.zeros((len(days), 7 * 2))
            np.add.at(s_num, day_code[mask], nm[mask].reshape(-1, 56))
            np.add.at(s_den, day_code[mask], dn[mask].reshape(-1, 14))
            tot_num = s_num.sum(0).reshape(7, 8)
            tot_den = s_den.sum(0).reshape(7, 2)
            share = np.concatenate([tot_num[:, :7] / tot_den[:, :1], tot_num[:, 7:] / tot_den[:, 1:]], axis=1)
            bn = (Wb @ s_num).reshape(N_BOOT, 7, 8)
            bd = (Wb @ s_den).reshape(N_BOOT, 7, 2)
            with np.errstate(invalid="ignore", divide="ignore"):
                bs = np.concatenate([bn[:, :, :7] / bd[:, :, :1], bn[:, :, 7:] / bd[:, :, 1:]], axis=2)
            sd = np.nanstd(bs, axis=0, ddof=1)
            res[mk] = (share, sd, bs)
        return res

    cells, raw = {}, {}
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
                key = f"{v}|{g}|{r}"
                n = int(mask.sum())
                cells[key] = {"n": n, "n_days": int(len(np.unique(day_code[mask])))}
                if n < MIN_N:
                    continue
                raw[key] = cell_values(mask)
    nat = raw["0|all|all"]
    for key, vals in raw.items():
        sh, nearflag = {}, {}
        for mk in MODELS:
            share, sd, bs = vals[mk]
            nshare, _, nbs = nat[mk]
            # 差の SD: 同じブートストラップの回で（セル − 全国）を取った値の SD（セルと全国は同じ日を含むので相関がある）
            sdd = np.nanstd(bs - nbs, axis=0, ddof=1)
            sh[mk] = {BOATS[b]: {OUT_KEYS[t]: [r3(share[b, t]), rsd(sd[b, t])] for t in range(8)} for b in range(7)}
            nearflag[mk] = {BOATS[b]: {OUT_KEYS[t]: [r3(share[b, t] - nshare[b, t]) if SD_DIGITS == 3
                                                     else rsd(share[b, t] - nshare[b, t]),
                                                     bool(abs(share[b, t] - nshare[b, t]) < 2 * sd[b, t]),
                                                     rsd(sdd[b, t]),
                                                     bool(abs(share[b, t] - nshare[b, t]) < 2 * sdd[b, t])]
                                       + ([rsd(abs(share[b, t] - nshare[b, t]) / nshare[b, t])] if END else [])
                                       for t in range(8)} for b in range(7)}
        cells[key]["shares"] = sh
        cells[key]["vs_national"] = nearflag

    # 本番 profiles（特徴量単位・中心化しない、穴の月を含む test 全期間）との比較: 全国と若松の 全×全、艇0、6テーマ
    dbn = json.loads((HERE / "db_profiles_national.json").read_text())
    dbv = json.loads((HERE / "db_profiles_venue20.json").read_text())
    cmp = {}
    for key, rows in (("0|all|all", dbn), ("20|all|all", [x for x in dbv if x["grade"] == "all" and x["round"] == "all"])):
        cmp[key] = {}
        for mk, ft in zip(MODELS, (1, 2, 3)):
            row = next(x for x in rows if x["finish_target"] == ft)
            share = raw[key][mk][0]
            ours6 = {t: (share[0, OUT_KEYS.index(t)] if t != "environment" else share[0, 7]) for t in T6}
            # 6テーマの割合（分母は6テーマの和）に直す: 環境以外の5テーマは7テーマの割合×(7テーマの和/6テーマの和)
            d7 = den[mk][:, 0, 0]
            d6 = den[mk][:, 0, 1]
            mask = keep & ((venue == 20) if key.startswith("20|") else True)
            f = d7[mask].sum() / d6[mask].sum()
            ours6 = {t: (v * f if t != "environment" else v) for t, v in ours6.items()}
            cmp[key][mk] = {t: {"theme_centered": r3(ours6[t]), "db_feature_uncentered": r3(row["shares"][t]),
                                "diff": r3(ours6[t] - row["shares"][t])} for t in T6}
            cmp[key][mk]["_db_n_races"] = row["n_races"]
    out = {"model_version": VERSION, "definition": __doc__,
           "population": {"excluded_months": HOLES, "n_races": int(keep.sum()),
                          "period": [str(first.loc[keep, "race_date"].min().date()),
                                     str(first.loc[keep, "race_date"].max().date())]},
           "sd_digits": SD_DIGITS,
           "n_boot": N_BOOT, "min_n": MIN_N, "theme_keys": OUT_KEYS, "boat_keys": BOATS,
           "format": "cells[\"venue|grade|round\"] = {n, n_days, shares: {model: {boat: {theme: [share, sd]}}}, "
                     "vs_national: {model: {boat: {theme: [差, |差|<2×セルのSD, 差のSD, |差|<2×差のSD"
                     + (", 相対差（|差| ÷ 全国の割合）" if END else "") + "]}}}}",
           "cells": cells, "compare_db_profiles": cmp}
    (HERE / f"{OUT_NAME}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    write_md(out)
    print("cells", len(cells), "with values", len(raw))


def write_md(o):
    L = []
    a = L.append
    a("# BOA-271 share-cube（AIの見立て: 会場×グレード×ラウンドごとの材料の割合、テーマ単位）\n")
    a("- 定義: share_cube.py の docstring。要点: テーマ内の SHAP を艇ごとに符号つきで足す → レース内で中心化 → 6艇の |値| の和を"
      "スライス内で平均 → 全テーマの和で割る。艇番ごとはその艇の |テーマ値| の和 ÷ その艇の全テーマの |値| の和")
    a(f"- モデル: 版 {o['model_version']} の model_win・top2・top3。母集団: test {o['population']['period'][0]}〜{o['population']['period'][1]}"
      f" から {', '.join(o['population']['excluded_months'])} を除いた"
      f" {o['population']['n_races']:,}R。SD: 日単位ブートストラップ {o['n_boot']}回（SD・差の SD は小数{o['sd_digits']}桁で保存、割合は3桁）")
    nval = sum(1 for c in o["cells"].values() if "shares" in c)
    a(f"- セル: {len(o['cells'])} 中、n ≥ {o['min_n']} の {nval} セルに値。形式: {o['format']}")
    a("- 出典: 指標=テーマのシェア（テーマ単位・中心化）／比較=全国（0|all|all）／版=2026-10-02／キー `cells`\n")
    for key in ("0|all|all", "20|all|all", "0|G1|all", "0|all|yusho"):
        c = o["cells"][key]
        a(f"## {key}（n={c['n']}、{c.get('n_days', '—')}日）\n")
        if "shares" not in c:
            a("n < 300 のため値なし\n")
            continue
        a("| 着順 | 艇 | " + " | ".join(o["theme_keys"]) + " |（値: 割合±SD）")
        a("|---|---|" + "---|" * len(o["theme_keys"]))
        for mk in ("win", "top2", "top3"):
            for b in ("boat0", "boat1", "boat4"):
                v = c["shares"][mk][b]
                a(f"| {mk} | {b} | " + " | ".join(f"{v[t][0]:.3f}±{v[t][1]:.{min(o['sd_digits'], 5)}f}" for t in o["theme_keys"]) + " |")
        a("\n（全艇番・全セルは JSON）\n")
    a("## 本番 profiles（特徴量単位）との違い（艇0、6テーマ）\n")
    a("本番 analogy_contribution_profiles は特徴量ごとの |SHAP|（中心化しない）をテーマに足した割合で、test 全期間（穴の月を含む）。"
      "ここの値はテーマ単位・レース内中心化、穴の月を除く。比較のため、ここの値も6テーマの和で割り直した\n")
    for key, d in o["compare_db_profiles"].items():
        a(f"### {key}\n")
        a("| 着順 | テーマ | テーマ単位・中心化 | 本番（特徴量単位） | 差 |")
        a("|---|---|---|---|---|")
        for mk, rows in d.items():
            for t, v in rows.items():
                if t.startswith("_"):
                    continue
                a(f"| {mk} | {t} | {v['theme_centered']:.3f} | {v['db_feature_uncentered']:.3f} | {v['diff']:+.3f} |")
        a("")
    a("キー `compare_db_profiles`")
    (HERE / f"{OUT_NAME}.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
