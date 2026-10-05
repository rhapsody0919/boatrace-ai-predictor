"""BOA-271 boat-profile2: 艇番の中の寄与度の2版目（第6回の検証の指摘による）

1版目（boat_profile.py）からの変更:
  1. 二重の中心化: グループ単位の SHAP（グループ内の特徴量の pred_contrib を符号つきで足す）を、まずレースの中で中心化
     （6艇の平均を引く）してから、艇番の中で中心化（スライス内のその艇番の平均を引く）する。テーマはグループの和。
     割合・向き・cube・例のレースのすべてをこの値で出す（6艇で同じ値の材料で、6艇がそろって動く分を除くため）
  2. 1号艇の行だけ、boat1（1号艇の級別・勝率）を national に足して1つのグループ「national」（全国勝率・2連率、1号艇の格を含む）
     にする。向きもその和で出す。2〜6号艇はそのまま
  3. 向き: national・local・recent・exhibitionTime・pastSt・motor・boat は、生の値に加えて 6艇の中の差（_diff）と
     順位（_rank）との相関も出す（rank は 1＝最上位。exh_time・st_mean30 の rank は速いほど1）。体重は3分位の値と SHAP の平均
  4. 大きさ: 艇番×着順ごとに7テーマの大きさの和（log-odds）。cube の各セルにも
  5. 枠の残り: 二重の中心化後の boat_number の SHAP が、級別・全国勝率・会場でどれだけ説明できるか（最小二乗の R²。
     級別と会場は one-hot、全国勝率は1次と2次）
  6. 1版目との比較
その他（期間・母集団・SD・300R の下限・定義）は1版目と同じ（boat_profile.py の docstring）
出力: boat-profile2.json・boat-profile2.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from boat_profile import (CAT_LABEL, END, GKEYS, GRADES, GROUPS, HOLES, MIN_CAT, MIN_N, MODELS, N_BOOT,  # noqa: E402
                          QUERY, REP_CAT, ROUNDS, THEMES_BP, TKEYS, VERSION)

REP_NUM2 = {"raceNumber": ["race_number"], "class": ["cls_ord"],
            "national": ["nat_win", "nat_win_diff", "nat_win_rank"], "local": ["loc_win", "loc_win_diff", "loc_win_rank"],
            "recent": ["recent_win30", "recent_win30_diff", "recent_win30_rank"], "boat1": ["b1_nat_win"],
            "exhibitionTime": ["exh_time", "exh_time_diff", "exh_time_rank"],
            "pastSt": ["st_mean30", "st_mean30_diff", "st_mean30_rank"],
            "motor": ["motor_2", "motor_2_diff", "motor_2_rank"], "boat": ["boat_2", "boat_2_diff", "boat_2_rank"],
            "wind": ["wind_speed"], "wave": ["wave_height"], "seriesDay": ["series_day"], "age": ["age"],
            "weight": ["weight"], "branch": ["is_local"]}
B1_IDX = GKEYS.index("boat1")
NAT_IDX = GKEYS.index("national")


def groups_for(b):
    """艇番 b（0始まり）の材料のグループの添字。1号艇は boat1 を national に足したので boat1 を除く"""
    return [i for i in range(len(GKEYS)) if not (b == 0 and i == B1_IDX)]


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
    fnames = {f for fs in REP_NUM2.values() for f in fs} | set(REP_CAT.values())
    feat = {c: test[c].to_numpy().astype("float64").reshape(nr, 6) for c in fnames}

    G, T, BN = {}, {}, {}
    for mk in MODELS:
        m = lgb.Booster(model_file=str(HERE / "models" / VERSION / f"model_{mk}.txt"))
        names = m.feature_name()
        idx = {f: i for i, f in enumerate(names)}
        c = np.load(W / f"contrib_{mk}.npy")[:, :-1].astype("float64").reshape(nr, 6, len(names))
        g = np.stack([c[:, :, [idx[f] for f in gr["features"]]].sum(2) for gr in GROUPS], axis=2)
        g = g - g.mean(axis=1, keepdims=True)                       # レースの中で中心化
        g[:, 0, NAT_IDX] += g[:, 0, B1_IDX]                          # 1号艇: boat1 を national に足す
        g[:, 0, B1_IDX] = 0.0
        G[mk] = g
        T[mk] = np.stack([g[:, :, [GKEYS.index(x["key"]) for x in t["groups"]]].sum(2) for t in THEMES_BP], axis=2)
        bn = c[:, :, idx["boat_number"]]
        BN[mk] = bn - bn.mean(axis=1, keepdims=True)

    def profile(mask, mk, b, boot=False):
        gi = groups_for(b)
        gv, tv = G[mk][mask, b, :][:, gi], T[mk][mask, b, :]
        gdev = np.abs(gv - gv.mean(0))
        tdev = np.abs(tv - tv.mean(0))
        tmag, gmag = tdev.mean(0), gdev.mean(0)
        res = {"theme_share": tmag / tmag.sum(), "group_share": gmag / gmag.sum(), "theme_mag": tmag, "gkeys": [GKEYS[i] for i in gi]}
        if boot:
            dc = day_code[mask]
            st = np.zeros((len(days), len(TKEYS)))
            sg = np.zeros((len(days), len(gi)))
            np.add.at(st, dc, tdev)
            np.add.at(sg, dc, gdev)
            bt, bg = Wb @ st, Wb @ sg
            res["theme_sd"] = (bt / bt.sum(1, keepdims=True)).std(0, ddof=1)
            res["group_sd"] = (bg / bg.sum(1, keepdims=True)).std(0, ddof=1)
            cnt = np.bincount(dc, minlength=len(days)).astype(float)
            res["mag_sum_sd"] = float((bt / (Wb @ cnt)[:, None]).sum(1).std(ddof=1))
        return res

    out = {"model_version": VERSION, "definition": __doc__,
           "population": {"period": [str(first.loc[keep, "race_date"].min().date()), END], "excluded_months": HOLES,
                          "n_races": int(keep.sum()), "n_days": int(len(np.unique(day_code[keep])))},
           "themes": [{"key": t["key"], "name": t["name"], "groups": [g["key"] for g in t["groups"]]} for t in THEMES_BP],
           "boat1_note": "1号艇の national は boat1（1号艇の級別・勝率）を足したもの。1号艇の group_share に boat1 は無い",
           "national": {}, "direction": {}, "frame_residual": {}, "cube": {}, "example_race": {}}
    for mk in MODELS:
        out["national"][mk], out["direction"][mk], out["frame_residual"][mk] = {}, {}, {}
        for b in range(6):
            p = profile(keep, mk, b, boot=True)
            out["national"][mk][str(b + 1)] = {
                "theme_share": {k: [round(float(p["theme_share"][i]), 4), float(p["theme_sd"][i])] for i, k in enumerate(TKEYS)},
                "group_share": {k: [round(float(p["group_share"][i]), 4), float(p["group_sd"][i])]
                                for i, k in enumerate(p["gkeys"])},
                "theme_mag_logodds": {k: float(p["theme_mag"][i]) for i, k in enumerate(TKEYS)},
                "theme_mag_sum_logodds": [float(p["theme_mag"].sum()), float(p["mag_sum_sd"])],
            }
            # 向き（二重の中心化後の値）
            gall = G[mk][keep, b, :]
            gcen = gall - gall.mean(0)
            dirs = {}
            for gk, fs in REP_NUM2.items():
                if b == 0 and gk == "boat1":
                    continue
                y = gcen[:, GKEYS.index(gk)]
                d = {"features": {}}
                for fname in fs:
                    x = feat[fname][keep, b]
                    ok = np.isfinite(x)
                    if ok.sum() < 30 or np.nanstd(x[ok]) == 0:
                        d["features"][fname] = {"note": "値が一定か欠損で相関なし"}
                        continue
                    s = pd.Series(x[ok])
                    rec = {"spearman": float(s.rank().corr(pd.Series(y[ok]).rank())), "n": int(ok.sum())}
                    tert = pd.qcut(s.rank(method="first"), 3, labels=["低", "中", "高"])
                    rec["bands"] = {lab: {"n": int((tert == lab).sum()),
                                          "value_range": [float(s[(tert == lab).to_numpy()].min()),
                                                          float(s[(tert == lab).to_numpy()].max())],
                                          "mean_shap": float(y[ok][(tert == lab).to_numpy()].mean())}
                                    for lab in ["低", "中", "高"]}
                    d["features"][fname] = rec
                if gk == "weight":
                    x = feat["weight"][keep, b]
                    ok = np.isfinite(x)
                    qs = pd.qcut(pd.Series(x[ok]).rank(method="first"), 3, labels=False)
                    d["tertile_values"] = [{"band": int(q), "value_min": float(x[ok][qs == q].min()),
                                            "value_median": float(np.median(x[ok][qs == q])),
                                            "value_max": float(x[ok][qs == q].max()),
                                            "mean_shap": float(y[ok][(qs == q).to_numpy()].mean())} for q in range(3)]
                if b == 0 and gk == "national":
                    d["note"] = "1号艇は national に boat1 を足した値"
                dirs[gk] = d
            for gk, fname in REP_CAT.items():
                x = feat[fname][keep, b]
                y = gcen[:, GKEYS.index(gk)]
                agg = pd.DataFrame({"v": x, "y": y}).dropna().groupby("v")["y"].agg(["mean", "size"])
                agg = agg[agg["size"] >= MIN_CAT].sort_values("mean")
                lab = CAT_LABEL[fname]
                fmt = lambda a: [{"value": lab.get(int(v), str(v)), "mean_shap": float(r["mean"]), "n": int(r["size"])}  # noqa: E731
                                 for v, r in a.iterrows()]
                dirs[gk] = {"feature": fname, "all_values": fmt(agg.iloc[::-1]), "top3": fmt(agg.iloc[::-1].head(3)),
                            "bottom3": fmt(agg.head(3))}
            out["direction"][mk][str(b + 1)] = dirs
            # 枠の残り
            y = BN[mk][keep, b]
            y = y - y.mean()
            cls = feat["cls_ord"][keep, b]
            nat = feat["nat_win"][keep, b]
            v = venue[keep]

            def onehot(a):
                a = np.nan_to_num(a, nan=-1)
                u = np.unique(a)
                return (a[:, None] == u[None, 1:]).astype(float)

            natf = np.nan_to_num(nat, nan=np.nanmean(nat))
            Xs = {"class": onehot(cls), "nat_win": np.column_stack([natf, natf ** 2]), "venue": onehot(v.astype(float))}

            def r2(X):
                X = np.column_stack([np.ones(len(y)), X])
                beta, *_ = np.linalg.lstsq(X, y, rcond=None)
                res = y - X @ beta
                return float(1 - (res ** 2).sum() / ((y - y.mean()) ** 2).sum())
            out["frame_residual"][mk][str(b + 1)] = {
                "mag_logodds": float(np.abs(y).mean()),
                "ratio_to_theme_mag_sum": float(np.abs(y).mean() / p["theme_mag"].sum()),
                "r2": {"class": r2(Xs["class"]), "nat_win": r2(Xs["nat_win"]), "venue": r2(Xs["venue"]),
                       "all3": r2(np.column_stack([Xs["class"], Xs["nat_win"], Xs["venue"]]))}}
    # cube
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
                                          for i, k in enumerate(p["gkeys"])},
                                "theme_mag_sum_logodds": [float(p["theme_mag"].sum()), float(p["mag_sum_sd"])]}
                out["cube"][key] = cell
    # 例のレース（全国の同じ艇番の平均で中心化）
    for mk in MODELS:
        rows = []
        for b in range(6):
            gi = groups_for(b)
            gm = G[mk][keep, b, :].mean(0)
            tm = T[mk][keep, b, :].mean(0)
            rows.append({"boat": b + 1, "theme": {k: float(T[mk][qi, b, i] - tm[i]) for i, k in enumerate(TKEYS)},
                         "group": {GKEYS[i]: float(G[mk][qi, b, i] - gm[i]) for i in gi},
                         "theme_sum": float((T[mk][qi, b, :] - tm).sum())})
        out["example_race"][mk] = rows
    # 1版目との比較
    v1 = json.loads((HERE / "boat-profile.json").read_text())
    env = json.loads((HERE / "env-check.json").read_text())
    comp = {"boat1_direction_top3_boats2to6": {}, "grade_top3_by_boat": {}, "boat1_G1_sign": {}, "theme_share_win": {}}
    for mk in MODELS:
        comp["boat1_direction_top3_boats2to6"][mk] = {
            str(b): {"v1_spearman": v1["direction"][mk][str(b)]["boat1"]["spearman"],
                     "v2_spearman": out["direction"][mk][str(b)]["boat1"]["features"]["b1_nat_win"]["spearman"]}
            for b in range(2, 7)}
        comp["grade_top3_by_boat"][mk] = {
            str(b): {"v1": [x["value"] for x in v1["direction"][mk][str(b)]["grade"]["top3"]],
                     "v2": [x["value"] for x in out["direction"][mk][str(b)]["grade"]["top3"]]} for b in range(1, 7)}
        g1v2 = next((x for x in out["direction"][mk]["1"]["grade"]["all_values"] if x["value"] == "G1"), None)
        envrow = next(x for x in env["models"][mk]["by_band"]["grade"]["rows"] if x["band"] == "G1")
        comp["boat1_G1_sign"][mk] = {"v2_boat1_G1_mean_shap": g1v2["mean_shap"] if g1v2 else None,
                                     "env_check_boat1_G1_mean": envrow["mean"][0],
                                     "same_sign": (g1v2 is not None) and (np.sign(g1v2["mean_shap"]) == np.sign(envrow["mean"][0]))}
        comp["theme_share_win"][mk] = {str(b): {k: [v1["national"][mk][str(b)]["theme_share"][k][0],
                                                    out["national"][mk][str(b)]["theme_share"][k][0]] for k in TKEYS}
                                       for b in range(1, 7)}
    comp["boat1_G1_sign"]["note"] = ("env-check はレースの中で中心化しただけの G1 帯の平均（艇番の中の中心化なし）。2版目は艇番の中でも"
                                     "中心化しているので、1号艇の G1 の値は「1号艇の平均（全グレード）からの差」")
    out["compare_v1"] = comp
    (HERE / "boat-profile2.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), default=bool))
    write_md(out)
    print("done", sum("shares" in c for c in out["cube"].values()))


def write_md(o):
    L = []
    a = L.append
    p = o["population"]
    names = {t["key"]: t["name"] for t in o["themes"]}
    a("# BOA-271 boat-profile2: 艇番の中の寄与度（二重の中心化）\n")
    a(f"- モデル: 版 {o['model_version']}。母集団: {p['period'][0]}〜{p['period'][1]} から {', '.join(p['excluded_months'])} を除いた"
      f" {p['n_races']:,}R・{p['n_days']}日")
    a("- 定義: boat_profile2.py の docstring。グループ単位の SHAP をレースの中で中心化 → 艇番の中で中心化。1号艇は boat1 を national に足した。"
      "SD は日単位ブートストラップ 200回（丸めない値は JSON）")
    a("- 出典（全表共通）: 版=2026-10-02／母集団=上の母集団／キー `national`・`direction`・`frame_residual`・`cube`・`example_race`・`compare_v1`\n")
    for mk, lab in (("win", "1着"), ("top2", "2着以内"), ("top3", "3着以内")):
        a(f"## 全国・{lab}（{mk}）\n")
        a("| 艇 | 大きさの和（log-odds） | " + " | ".join(names[k] for k in names) + " |")
        a("|---|---|" + "---|" * len(names))
        for b in range(1, 7):
            d = o["national"][mk][str(b)]
            a(f"| {b} | {d['theme_mag_sum_logodds'][0]:.3f} | " + " | ".join(f"{d['theme_share'][k][0]:.3f}" for k in names) + " |")
        a("")
        for b in range(1, 7):
            gs = o["national"][mk][str(b)]["group_share"]
            top = sorted(gs.items(), key=lambda t: -t[1][0])[:8]
            a(f"- {b}号艇: " + "、".join(f"{k} {v[0]:.3f}" for k, v in top))
        a("")
        a("向き（スピアマン。生の値／6艇の中の差 _diff／6艇の中の順位 _rank。rank は1が最上位なので、負＝上位ほど押し上げ）:\n")
        a("| グループ | 特徴量 | " + " | ".join(f"{b}号艇" for b in range(1, 7)) + " |")
        a("|---|---|" + "---|" * 6)
        for gk, fs in REP_NUM2.items():
            for f in fs:
                cells = []
                for b in range(1, 7):
                    d = o["direction"][mk][str(b)].get(gk)
                    if d is None or "spearman" not in d["features"].get(f, {}):
                        cells.append("—")
                    else:
                        cells.append(f"{d['features'][f]['spearman']:+.2f}")
                a(f"| {gk} | {f} | " + " | ".join(cells) + " |")
        a("\n体重の3分位（中央値 kg: SHAP の平均）: " + "　".join(
            f"{b}号艇 " + "／".join(f"{t['value_median']:.1f}:{t['mean_shap']:+.3f}" for t in o["direction"][mk][str(b)]["weight"]["tertile_values"])
            for b in range(1, 7)))
        a("\nカテゴリ（上位3／下位3）:\n")
        for g in ("venue", "grade", "round", "weather"):
            for b in range(1, 7):
                d = o["direction"][mk][str(b)][g]
                a(f"- {g} {b}号艇: ＋ " + "、".join(f"{x['value']} {x['mean_shap']:+.3f}" for x in d["top3"])
                  + "／− " + "、".join(f"{x['value']} {x['mean_shap']:+.3f}" for x in d["bottom3"]))
        a("")
    a("## 枠の残り（二重の中心化後の boat_number の SHAP を、級別・全国勝率・会場で説明する R²）\n")
    a("| 着順 | 艇 | |値| の平均 | 7テーマの和に対する比 | R² 級別 | R² 全国勝率 | R² 会場 | R² 3つ |")
    a("|---|---|---|---|---|---|---|---|")
    for mk in ("win", "top2", "top3"):
        for b in range(1, 7):
            f = o["frame_residual"][mk][str(b)]
            a(f"| {mk} | {b} | {f['mag_logodds']:.4f} | {f['ratio_to_theme_mag_sum']:.1%} | {f['r2']['class']:.3f} | "
              f"{f['r2']['nat_win']:.3f} | {f['r2']['venue']:.3f} | {f['r2']['all3']:.3f} |")
    a("\n## 例のレース（若松12R、全国の同じ艇番の平均で中心化）\n")
    for mk in ("win", "top2", "top3"):
        a(f"**{mk}**\n")
        a("| 艇 | " + " | ".join(names) + " | 合計 |")
        a("|---|" + "---|" * (len(names) + 1))
        for r in o["example_race"][mk]:
            a(f"| {r['boat']} | " + " | ".join(f"{r['theme'][k]:+.3f}" for k in names) + f" | {r['theme_sum']:+.3f} |")
        a("")
    c = o["compare_v1"]
    a("## 1版目との比較\n")
    a("### 2〜6号艇の boat1（1号艇の格）の向き（スピアマン、1版目→2版目）\n")
    for mk in ("win", "top2", "top3"):
        a(f"- {mk}: " + "、".join(f"{b}号艇 {v['v1_spearman']:+.2f}→{v['v2_spearman']:+.2f}"
                                  for b, v in c["boat1_direction_top3_boats2to6"][mk].items()))
    a("\n### グレードの上位3（1版目→2版目）\n")
    for mk in ("win", "top2", "top3"):
        a(f"- {mk}: " + "、".join(f"{b}号艇 {'/'.join(v['v1'])}→{'/'.join(v['v2'])}" for b, v in c["grade_top3_by_boat"][mk].items()))
    a("\n### 1号艇の G1 の符号（2版目 と env-check）\n")
    for mk in ("win", "top2", "top3"):
        v = c["boat1_G1_sign"][mk]
        a(f"- {mk}: 2版目 {v['v2_boat1_G1_mean_shap']:+.4f}、env-check {v['env_check_boat1_G1_mean']:+.4f}、同じ符号 {v['same_sign']}")
    a(f"\n注: {c['boat1_G1_sign']['note']}")
    a("\n### テーマの割合（1着、1版目→2版目）\n")
    a("| 艇 | " + " | ".join(names[k] for k in names) + " |")
    a("|---|" + "---|" * len(names))
    for b in range(1, 7):
        v = c["theme_share_win"]["win"][str(b)]
        a(f"| {b} | " + " | ".join(f"{v[k][0]:.3f}→{v[k][1]:.3f}" for k in names) + " |")
    (HERE / "boat-profile2.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
