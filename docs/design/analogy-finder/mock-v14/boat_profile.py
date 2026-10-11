"""BOA-271 boat-profile: 「k号艇が1着（2着以内・3着以内）になるには、枠以外で何が効くか」（艇番の中で中心化した寄与度）

定義:
  - モデル: 版 2026-10-02 の model_win・top2・top3（展示あり）。pred_contrib は work/contrib_*.npy（test.pkl の行順）
  - 母集団: test 2025-10-03〜2026-09-26 の完全レースから 2025-12・2026-01 を除いたもの（share-cube2 と同じ）
  - 艇番 k の行だけを取り出し、グループ単位（themes.py のグループ内の特徴量の SHAP を符号つきで足す）・テーマ単位
    （テーマ内のグループを足す）の値から、スライス内の艇番 k の平均を引く（レース内の中心化ではない）
  - テーマの大きさ = |中心化した値| の平均。テーマの割合 = テーマの大きさ ÷ 7テーマの大きさの和
  - グループの大きさ = 同じくグループ単位で |中心化した値| の平均。グループの割合 = グループの大きさ ÷ 全グループの大きさの和
    （テーマ内で符号が打ち消すので、グループの割合をテーマで足してもテーマの割合にはならない）
  - テーマは7（venue＝会場・R番号、racerRecord、startExhibition、machine、weatherWater、raceFormat、racerProfile）。
    boat_number（枠番）のグループは材料から外し、艇番の中での大きさを check_boat_number に別に出す
    （艇番 k の中では値が一定だが、木の交互作用で SHAP は揺れる）
  - 向き: 各グループの代表の特徴量について、艇番×着順ごとに、値と グループの SHAP のスピアマン相関、値の3分位（低・中・高。
    順位で3等分）ごとの中心化した SHAP の平均。カテゴリ（会場・天候・グレード・ラウンド）は値ごとの中心化した SHAP の平均の
    上位3・下位3（件数 200 以上の値だけ）
  - cube: 会場（0＝全国＋24）×グレード（all＋5）×ラウンド（all＋4）でレース数 300 以上のセルに、艇番×着順の
    テーマ・グループの割合と SD。中心化はセル内の艇番 k の平均。SD は日単位のブートストラップ 200回（seed 0）。ブートストラップの
    各回では中心化の平均をセル全体の値に固定して計算する（平均の取り直しの影響は 1/n の大きさで無視できる）。SD は丸めない
  - 例のレース: 若松12R（2026-09-27、母集団の期間外）の各艇を、全国の同じ艇番の平均で中心化した値
出力: boat-profile.json・boat-profile.md
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
from calc1_race import THEMES7  # noqa: E402

VERSION = "2026-10-02"
END = "2026-09-26"
HOLES = ["2025-12", "2026-01"]
N_BOOT = 200
MIN_N = 300
MIN_CAT = 200
MODELS = ["win", "top2", "top3"]
GRADES = ["ippan", "G3", "G2", "G1", "SG"]
ROUNDS = ["yosen", "junyu", "yusho", "other"]
QUERY = 202609272012

# テーマ（venueCourse から boatNumber を外し、名前を venue にする）
THEMES_BP = []
for t in THEMES7:
    if t["key"] == "venueCourse":
        THEMES_BP.append({"key": "venue", "name": "会場・R番号", "groups": [g for g in t["groups"] if g["key"] != "boatNumber"]})
    else:
        THEMES_BP.append({"key": t["key"], "name": t["name"], "groups": t["groups"]})
TKEYS = [t["key"] for t in THEMES_BP]
GROUPS = [g for t in THEMES_BP for g in t["groups"]]
GKEYS = [g["key"] for g in GROUPS]
G_THEME = {g["key"]: t["key"] for t in THEMES_BP for g in t["groups"]}
BOATNUM_FEATS = ["boat_number"]
# 向きを見る代表の特徴量（数値）と、カテゴリ
REP_NUM = {"raceNumber": "race_number", "class": "cls_ord", "national": "nat_win", "local": "loc_win",
           "recent": "recent_win30", "boat1": "b1_nat_win", "exhibitionTime": "exh_time", "pastSt": "st_mean30",
           "motor": "motor_2", "boat": "boat_2", "wind": "wind_speed", "wave": "wave_height", "seriesDay": "series_day",
           "age": "age", "weight": "weight", "branch": "is_local"}
REP_CAT = {"venue": "venue_code", "weather": "weather_code", "grade": "grade_code", "round": "round_code"}
CAT_LABEL = {
    "venue_code": {1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川", 6: "浜名湖", 7: "蒲郡", 8: "常滑", 9: "津",
                   10: "三国", 11: "びわこ", 12: "住之江", 13: "尼崎", 14: "鳴門", 15: "丸亀", 16: "児島", 17: "宮島",
                   18: "徳山", 19: "下関", 20: "若松", 21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村"},
    "weather_code": {0: "晴", 1: "曇り", 2: "雨", 3: "雪", 4: "霧", 5: "台風"},
    "grade_code": {0: "ippan", 1: "G3", 2: "G2", 3: "G1", 4: "SG"},
    "round_code": {0: "yosen", 1: "junyu", 2: "yusho", 3: "other"},
}


def main():
    W = HERE / "work"
    test = pd.read_pickle(W / "test.pkl")
    first = test[test["boat_number"] == 1].reset_index(drop=True)
    nr = len(first)
    month = first["race_date"].dt.strftime("%Y-%m").to_numpy()
    keep = ~np.isin(month, HOLES) & (first["race_date"] <= pd.Timestamp(END)).to_numpy()
    qi = int(np.where(first["race_id"].to_numpy() == QUERY)[0][0])
    days, day_code = np.unique(first["race_date"].to_numpy(), return_inverse=True)
    Wb = np.random.default_rng(0).multinomial(len(days), np.full(len(days), 1 / len(days)), size=N_BOOT).astype("float64")
    venue = first["venue_code"].astype(int).to_numpy()
    grade = first["grade"].astype(object).to_numpy()
    rnd = first["round"].astype(object).to_numpy()
    feat = {c: test[c].to_numpy().astype("float64").reshape(nr, 6) for c in set(REP_NUM.values()) | set(REP_CAT.values())}

    G, T, BN = {}, {}, {}
    for mk in MODELS:
        m = lgb.Booster(model_file=str(HERE / "models" / VERSION / f"model_{mk}.txt"))
        names = m.feature_name()
        idx = {f: i for i, f in enumerate(names)}
        c = np.load(W / f"contrib_{mk}.npy")[:, :-1].astype("float64").reshape(nr, 6, len(names))
        G[mk] = np.stack([c[:, :, [idx[f] for f in g["features"]]].sum(2) for g in GROUPS], axis=2)   # (R, 6, nG)
        T[mk] = np.stack([G[mk][:, :, [GKEYS.index(g["key"]) for g in t["groups"]]].sum(2) for t in THEMES_BP], axis=2)
        BN[mk] = c[:, :, idx["boat_number"]]

    def profile(mask, mk, b, boot=False):
        """艇番 b（0始まり）・スライス mask の テーマ・グループの割合（と SD）"""
        gv, tv = G[mk][mask, b, :], T[mk][mask, b, :]
        gdev = np.abs(gv - gv.mean(0))
        tdev = np.abs(tv - tv.mean(0))
        tmag, gmag = tdev.mean(0), gdev.mean(0)
        res = {"theme_share": tmag / tmag.sum(), "group_share": gmag / gmag.sum(), "theme_mag": tmag, "group_mag": gmag}
        if boot:
            dc = day_code[mask]
            st = np.zeros((len(days), len(TKEYS)))
            sg = np.zeros((len(days), len(GKEYS)))
            np.add.at(st, dc, tdev)
            np.add.at(sg, dc, gdev)
            bt, bg = Wb @ st, Wb @ sg
            res["theme_sd"] = (bt / bt.sum(1, keepdims=True)).std(0, ddof=1)
            res["group_sd"] = (bg / bg.sum(1, keepdims=True)).std(0, ddof=1)
        return res

    out = {"model_version": VERSION, "definition": __doc__,
           "population": {"period": [str(first.loc[keep, "race_date"].min().date()), END], "excluded_months": HOLES,
                          "n_races": int(keep.sum()), "n_days": int(len(np.unique(day_code[keep])))},
           "themes": [{"key": t["key"], "name": t["name"], "groups": [g["key"] for g in t["groups"]]} for t in THEMES_BP],
           "national": {}, "direction": {}, "check_boat_number": {}, "cube": {}, "example_race": {}}
    # ---------------- 全国
    for mk in MODELS:
        out["national"][mk] = {}
        out["direction"][mk] = {}
        out["check_boat_number"][mk] = {}
        for b in range(6):
            p = profile(keep, mk, b, boot=True)
            out["national"][mk][str(b + 1)] = {
                "theme_share": {k: [round(float(p["theme_share"][i]), 4), float(p["theme_sd"][i])] for i, k in enumerate(TKEYS)},
                "group_share": {k: [round(float(p["group_share"][i]), 4), float(p["group_sd"][i])] for i, k in enumerate(GKEYS)},
                "theme_mag_logodds": {k: float(p["theme_mag"][i]) for i, k in enumerate(TKEYS)},
            }
            bn = BN[mk][keep, b]
            out["check_boat_number"][mk][str(b + 1)] = {
                "mag_logodds": float(np.abs(bn - bn.mean()).mean()), "mean_logodds": float(bn.mean()),
                "ratio_to_theme_sum": float(np.abs(bn - bn.mean()).mean() / p["theme_mag"].sum())}
            # 向き
            dirs = {}
            gall = G[mk][keep, b, :]
            gcen = gall - gall.mean(0)
            for gk, fname in REP_NUM.items():
                x = feat[fname][keep, b]
                y = gcen[:, GKEYS.index(gk)]
                ok = np.isfinite(x)
                if ok.sum() < 30 or np.nanstd(x[ok]) == 0:
                    dirs[gk] = {"feature": fname, "note": "値が一定か欠損で相関なし"}
                    continue
                s = pd.Series(x[ok])
                rho = float(s.rank().corr(pd.Series(y[ok]).rank()))
                tert = pd.qcut(s.rank(method="first"), 3, labels=["低", "中", "高"])
                bands = {}
                for lab in ["低", "中", "高"]:
                    sel = (tert == lab).to_numpy()
                    bands[lab] = {"n": int(sel.sum()), "value_range": [float(s[sel].min()), float(s[sel].max())],
                                  "mean_shap": float(y[ok][sel].mean())}
                dirs[gk] = {"feature": fname, "spearman": rho, "n": int(ok.sum()), "bands": bands,
                            "missing_mean_shap": float(y[~ok].mean()) if (~ok).sum() >= MIN_CAT else None,
                            "n_missing": int((~ok).sum())}
            for gk, fname in REP_CAT.items():
                x = feat[fname][keep, b]
                y = gcen[:, GKEYS.index(gk)]
                df = pd.DataFrame({"v": x, "y": y})
                agg = df.dropna().groupby("v")["y"].agg(["mean", "size"])
                agg = agg[agg["size"] >= MIN_CAT].sort_values("mean")
                lab = CAT_LABEL[fname]
                fmt = lambda a: [{"value": lab.get(int(v), str(v)), "mean_shap": float(r["mean"]), "n": int(r["size"])}
                                 for v, r in a.iterrows()]  # noqa: E731
                dirs[gk] = {"feature": fname, "top3": fmt(agg.iloc[::-1].head(3)), "bottom3": fmt(agg.head(3)),
                            "n_values": int(len(agg))}
            out["direction"][mk][str(b + 1)] = dirs
    # ---------------- cube
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
                cell = {"n": n, "n_days": int(len(np.unique(day_code[mask])))}
                if n >= MIN_N:
                    cell["shares"] = {}
                    for mk in MODELS:
                        cell["shares"][mk] = {}
                        for b in range(6):
                            p = profile(mask, mk, b, boot=True)
                            cell["shares"][mk][str(b + 1)] = {
                                "theme": {k: [round(float(p["theme_share"][i]), 3), float(p["theme_sd"][i])]
                                          for i, k in enumerate(TKEYS)},
                                "group": {k: [round(float(p["group_share"][i]), 3), float(p["group_sd"][i])]
                                          for i, k in enumerate(GKEYS)}}
                out["cube"][key] = cell
    # ---------------- 例のレース
    for mk in MODELS:
        rows = []
        for b in range(6):
            gm = G[mk][keep, b, :].mean(0)
            tm = T[mk][keep, b, :].mean(0)
            rows.append({"boat": b + 1,
                         "theme": {k: float(T[mk][qi, b, i] - tm[i]) for i, k in enumerate(TKEYS)},
                         "group": {k: float(G[mk][qi, b, i] - gm[i]) for i, k in enumerate(GKEYS)},
                         "theme_sum": float((T[mk][qi, b, :] - tm).sum())})
        out["example_race"][mk] = rows
    # ---------------- 本番 profiles（艇番別、特徴量単位・中心化しない・test 全期間）との比較
    db = json.loads((HERE / "db_profiles_boats.json").read_text())
    cmp = {}
    for mk, ft in zip(MODELS, (1, 2, 3)):
        cmp[mk] = {}
        for b in range(1, 7):
            row = next(x for x in db if x["finish_target"] == ft and x["boat_number"] == b)
            ours = out["national"][mk][str(b)]["theme_share"]
            ours6 = {"racerRecord": ours["racerRecord"][0], "startExhibition": ours["startExhibition"][0],
                     "machine": ours["machine"][0], "racerProfile": ours["racerProfile"][0],
                     "venueCourse(会場・R番号のみ)": ours["venue"][0],
                     "environment(天候・水面＋グレード・ラウンド・節)": ours["weatherWater"][0] + ours["raceFormat"][0]}
            dbs = row["shares"]
            # 本番から枠番グループを抜いて割合を取り直した値（venueCourse は会場・R番号だけ）
            bk = {x["key"]: x["share"] for x in row["breakdown"]["venueCourse"]}
            bnum = bk["boatNumber"]
            rest = 1 - bnum
            db_no_boat = {"racerRecord": dbs["racerRecord"] / rest, "startExhibition": dbs["startExhibition"] / rest,
                          "machine": dbs["machine"] / rest, "racerProfile": dbs["racerProfile"] / rest,
                          "venueCourse(会場・R番号のみ)": (bk["venue"] + bk["raceNumber"]) / rest,
                          "environment(天候・水面＋グレード・ラウンド・節)": dbs["environment"] / rest}
            cmp[mk][str(b)] = {"db_boatNumber_share": bnum, "db_shares": dbs,
                               "db_without_boatNumber": {k: round(v, 4) for k, v in db_no_boat.items()},
                               "ours": {k: round(v, 4) for k, v in ours6.items()},
                               "diff_ours_minus_db_wo_boat": {k: round(ours6[k] - db_no_boat[k], 4) for k in ours6}}
    out["compare_db_profiles"] = cmp
    (HERE / "boat-profile.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    write_md(out)
    print("wrote boat-profile.json / boat-profile.md", sum("shares" in c for c in out["cube"].values()))


def write_md(o):
    L = []
    a = L.append
    p = o["population"]
    a("# BOA-271 boat-profile: 艇番の中で中心化した寄与度（枠以外で何が効くか）\n")
    a(f"- モデル: 版 {o['model_version']} の model_win・top2・top3。母集団: test {p['period'][0]}〜{p['period'][1]} から "
      f"{', '.join(p['excluded_months'])} を除いた {p['n_races']:,}R・{p['n_days']}日（各艇番 {p['n_races']:,}行）")
    a("- 定義: boat_profile.py の docstring。艇番 k の行だけで、テーマ／グループ単位の SHAP からその艇番の平均を引き、|値| の平均を"
      "大きさ、全テーマ（全グループ）の和で割ったものを割合とした。SD は日単位ブートストラップ 200回（丸めない値は JSON）")
    a("- 出典（全表共通）: 版=2026-10-02／母集団=上の母集団／キー `national`・`direction`・`cube`・`example_race`・`compare_db_profiles`\n")
    names = {t["key"]: t["name"] for t in o["themes"]}
    for mk, lab in (("win", "1着"), ("top2", "2着以内"), ("top3", "3着以内")):
        a(f"## 全国・{lab}（{mk}）: テーマの割合（±SD）\n")
        a("| 艇 | " + " | ".join(names[k] for k in names) + " |")
        a("|---|" + "---|" * len(names))
        for b in range(1, 7):
            ts = o["national"][mk][str(b)]["theme_share"]
            a(f"| {b} | " + " | ".join(f"{ts[k][0]:.3f}±{ts[k][1]:.4f}" for k in names) + " |")
        a("\n**グループの割合（上位8）**\n")
        for b in range(1, 7):
            gs = o["national"][mk][str(b)]["group_share"]
            top = sorted(gs.items(), key=lambda t: -t[1][0])[:8]
            a(f"- {b}号艇: " + "、".join(f"{k} {v[0]:.3f}" for k, v in top))
        a("")
    a("## 枠番（boat_number）の SHAP の、艇番の中での揺れ（確認）\n")
    a("| 着順 | 艇 | |中心化した値| の平均 | 7テーマの大きさの和に対する比 |")
    a("|---|---|---|---|")
    for mk in ("win", "top2", "top3"):
        for b in range(1, 7):
            c = o["check_boat_number"][mk][str(b)]
            a(f"| {mk} | {b} | {c['mag_logodds']:.4f} | {c['ratio_to_theme_sum']:.1%} |")
    a("\n## 向き（代表の特徴量と、中心化したグループの SHAP）\n")
    for mk, lab in (("win", "1着"), ("top2", "2着以内"), ("top3", "3着以内")):
        a(f"### {lab}: スピアマン相関（+＝値が高いほど押し上げ）\n")
        gks = list(o["direction"][mk]["1"])
        num = [g for g in gks if "spearman" in o["direction"][mk]["1"][g]]
        a("| グループ（代表） | " + " | ".join(f"{b}号艇" for b in range(1, 7)) + " |")
        a("|---|" + "---|" * 6)
        for g in num:
            f = o["direction"][mk]["1"][g]["feature"]
            a(f"| {g}（{f}） | " + " | ".join(
                f"{o['direction'][mk][str(b)][g]['spearman']:+.2f}" if "spearman" in o["direction"][mk][str(b)][g] else "—"
                for b in range(1, 7)) + " |")
        a("\n3分位ごとの SHAP の平均（低／中／高）:\n")
        for g in num:
            cells = []
            for b in range(1, 7):
                d = o["direction"][mk][str(b)][g]
                cells.append("—" if "bands" not in d else "/".join(f"{d['bands'][x]['mean_shap']:+.3f}" for x in ("低", "中", "高")))
            a(f"- {g}: " + "　".join(f"{b}号艇 {c}" for b, c in zip(range(1, 7), cells)))
        a("\nカテゴリ（中心化した SHAP の平均の上位3・下位3、件数200以上）:\n")
        for g in ("venue", "weather", "grade", "round"):
            for b in range(1, 7):
                d = o["direction"][mk][str(b)][g]
                a(f"- {g} {b}号艇: ＋ " + "、".join(f"{x['value']} {x['mean_shap']:+.3f}" for x in d["top3"])
                  + "／− " + "、".join(f"{x['value']} {x['mean_shap']:+.3f}" for x in d["bottom3"]))
        a("")
    a("## 例のレース（若松12R）: 全国の同じ艇番の平均で中心化したテーマの値（log-odds）\n")
    for mk in ("win", "top2", "top3"):
        a(f"**{mk}**\n")
        a("| 艇 | " + " | ".join(names) + " | 合計 |")
        a("|---|" + "---|" * (len(names) + 1))
        for r in o["example_race"][mk]:
            a(f"| {r['boat']} | " + " | ".join(f"{r['theme'][k]:+.3f}" for k in names) + f" | {r['theme_sum']:+.3f} |")
        a("")
    a("グループの値は `example_race.<model>[].group`\n")
    a("## 本番 profiles（艇番別、特徴量単位・中心化しない）との比較（全国、1着）\n")
    a("本番の割合は枠番のグループを含む。ここでは本番から枠番を抜いて割合を取り直した値と比べる\n")
    keys = list(o["compare_db_profiles"]["win"]["1"]["ours"])
    a("| 艇 | 本番の枠番の割合 | " + " | ".join(f"{k} 本番→艇番内中心化" for k in keys) + " |")
    a("|---|---|" + "---|" * len(keys))
    for b in range(1, 7):
        c = o["compare_db_profiles"]["win"][str(b)]
        a(f"| {b} | {c['db_boatNumber_share']:.3f} | " + " | ".join(
            f"{c['db_without_boatNumber'][k]:.3f}→{c['ours'][k]:.3f}" for k in keys) + " |")
    a("\n2着以内・3着以内は `compare_db_profiles`")
    (HERE / "boat-profile.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
