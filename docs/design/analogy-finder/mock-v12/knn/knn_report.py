"""BOA-271 k-NN 3/3: 近傍 800件の一覧・距離の内訳・似ている点・結果の集計 → knn.json・knn.md

入力: work/races.pkl・boats.npz・search.json・nbr_racecard.npz・nbr_with_exh.npz（knn_build.py）、
      work/outcomes_raw.json（fetch_outcomes.mjs、DB の SELECT）
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "model-prep" / "code-at-train"))
import features as F  # noqa: E402

NS = [20, 50, 100, 200, 400, 800]
CLASS = {1: "B2", 2: "B1", 3: "A2", 4: "A1"}
WEATHER = {v: k for k, v in F.WEATHER_CODE.items()}
GRADE = {i: g for i, g in enumerate(F.GRADES)}
ROUND = {i: g for i, g in enumerate(F.ROUNDS)}
VENUE = {1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川", 6: "浜名湖", 7: "蒲郡", 8: "常滑", 9: "津",
         10: "三国", 11: "びわこ", 12: "住之江", 13: "尼崎", 14: "鳴門", 15: "丸亀", 16: "児島", 17: "宮島",
         18: "徳山", 19: "下関", 20: "若松", 21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村"}


def nz(v, nd=3):
    if v is None:
        return None
    v = float(v)
    return None if not np.isfinite(v) else round(v, nd)


def gap_band(g):
    """120 の勝率差の帯（境界ちょうどは上の帯）。5=勝率が取れない"""
    if not np.isfinite(g):
        return 5
    return 0 if g < -1.91 else 1 if g < -1.14 else 2 if g < -0.49 else 3 if g < 0.19 else 4


def rank_band(rank):
    return np.where(~np.isfinite(rank), 3, np.where(rank <= 2, 0, np.where(rank <= 4, 1, 2)))


def b1_rank_of(x):
    """120 の motor_rank と同じ式: 1 + (2〜6号艇で 1号艇より大きい艇の数)。1号艇が欠損なら NaN"""
    b1 = x[:, 0]
    rk = 1 + (x[:, 1:] > b1[:, None]).sum(1).astype(float)
    return np.where(np.isfinite(b1), rk, np.nan)


def wind_bin(ws):
    return np.where(~np.isfinite(ws), 3, np.where(ws <= 2, 0, np.where(ws <= 4, 1, 2)))


def wave_bin(w):
    return np.where(~np.isfinite(w), 3, np.where(w <= 2, 0, np.where(w <= 5, 1, 2)))


def mean_abs6(a, q):
    d = np.abs(a - q[None, :])
    with np.errstate(invalid="ignore"):
        m = np.nanmean(np.where(np.isfinite(d), d, np.nan), axis=1)
    return m


def main():
    W = HERE / "work"
    r = pd.read_pickle(W / "races.pkl")
    B = dict(np.load(W / "boats.npz"))
    info = json.loads((W / "search.json").read_text())
    nb = dict(np.load(W / "nbr_racecard.npz"))
    nbx = dict(np.load(W / "nbr_with_exh.npz"))
    raw = json.loads((W / "outcomes_raw.json").read_text())
    qi = int(np.where(r["is_query"])[0][0])
    pool = r["is_pool"].to_numpy()
    npool = int(pool.sum())
    var = info["variants"]["racecard"]
    lam = var["lambda"]
    venue = r["venue_code"].astype(int).to_numpy()
    rid_str = np.array([F.int_to_rid(x) for x in r["race_id"].to_numpy()])

    # ------------------------------------------------ 派生量（全レース）
    nat = B["nat_win"]
    others_max = np.nanmax(np.where(np.isfinite(nat[:, 1:]), nat[:, 1:], -np.inf), axis=1)
    gap = np.round(nat[:, 0] - others_max, 2)
    gap = np.where(np.isfinite(gap), gap, np.nan)
    gapb = np.array([gap_band(g) for g in gap])
    natf = np.where(np.isfinite(nat), nat, -np.inf)
    top_boat = natf.argmax(1) + 1  # 同値は艇番の小さい方（120 と同じ）
    b1_motor_rank = b1_rank_of(B["motor_2"])
    b1_boat_rank = b1_rank_of(B["boat_2"])
    cls = B["cls_ord"]
    nA1 = (cls == 4).sum(1)
    d = {
        "venue": venue, "race_number": r["race_number"].to_numpy(), "grade_code": r["grade_code"].to_numpy(),
        "round_code": r["round_code"].to_numpy(), "weather_code": r["weather_code"].to_numpy(),
        "wind_speed": r["wind_speed"].to_numpy(), "wind_x": r["wind_x"].to_numpy(), "wind_y": r["wind_y"].to_numpy(),
        "wave_height": r["wave_height"].to_numpy(), "series_day": r["series_day"].to_numpy(),
        "is_final_day_num": r["is_final_day_num"].to_numpy(),
    }

    def q(a):
        return a[qi]

    # ------------------------------------------------ 2. 似ている点の帯（項目ごとの指示関数）
    def eq(a):
        a = np.asarray(a, dtype=float)
        return np.where(np.isfinite(a) & np.isfinite(q(a)), a == q(a), ~np.isfinite(a) & ~np.isfinite(q(a)))

    items = []

    def add(key, label, group, in_distance, rule, today, ind):
        items.append({"key": key, "label": label, "group": group, "in_distance": in_distance, "rule": rule,
                      "today": today, "ind": np.asarray(ind, bool)})

    add("venue", "会場", "venue", True, "一致", VENUE[int(q(venue))], venue == q(venue))
    add("race_number_band", "R番号の帯", "raceNumber", True, "1〜4R／5〜8R／9〜12R の帯が一致",
        int(q(d["race_number"])), (d["race_number"] - 1) // 4 == (q(d["race_number"]) - 1) // 4)
    add("race_number", "R番号", "raceNumber", True, "一致", int(q(d["race_number"])), d["race_number"] == q(d["race_number"]))
    add("b1_class", "1号艇の級別", "boat1", True, "一致（b1_cls_ord）", CLASS.get(int(q(cls[:, 0])), None),
        eq(cls[:, 0]))
    add("class_all6", "6艇の級別の並び", "class", True, "6艇とも級別が一致", [CLASS.get(int(x)) for x in q(cls)],
        (np.nan_to_num(cls, nan=-1) == np.nan_to_num(q(cls), nan=-1)).all(1))
    add("n_A1", "A1 の艇数", "class", True, "一致", int(q(nA1)), nA1 == q(nA1))
    add("win_gap_band", "勝率差の帯（1号艇 − 他艇の最大）", "national", True,
        "120 の5帯（帯0 <−1.91、帯1 −1.91〜−1.14、帯2 −1.14〜−0.49、帯3 −0.49〜0.19、帯4 ≥0.19、帯5 勝率なし。境界ちょうどは上の帯）が一致",
        {"gap": nz(q(gap), 2), "band": int(q(gapb))}, gapb == q(gapb))
    add("top_boat", "勝率1位の艇", "national", True, "一致（同値は艇番の小さい方）", int(q(top_boat)), top_boat == q(top_boat))
    add("nat_win_6", "6艇の全国勝率", "national", True, "6艇の |差| の平均 ≤ 0.50",
        [nz(x, 2) for x in q(nat)], mean_abs6(nat, q(nat)) <= 0.5)
    add("nat_win_rank_4", "勝率の順位の並び", "national", True, "勝率順位が一致する艇が4艇以上",
        [nz(x, 0) for x in q(B["nat_win_rank"])], (B["nat_win_rank"] == q(B["nat_win_rank"])).sum(1) >= 4)
    add("b1_nat_win", "1号艇の全国勝率", "boat1", True, "|差| ≤ 0.50", nz(q(nat[:, 0]), 2),
        np.abs(nat[:, 0] - q(nat[:, 0])) <= 0.5)
    add("loc_win_6", "6艇の当地勝率", "local", True, "6艇の |差| の平均 ≤ 0.75（欠損の艇は除く）",
        [nz(x, 2) for x in q(B["loc_win"])], mean_abs6(B["loc_win"], q(B["loc_win"])) <= 0.75)
    add("recent_win30_6", "6艇の直近30走の1着率", "recent", True, "6艇の |差| の平均 ≤ 0.10",
        [nz(x, 3) for x in q(B["recent_win30"])], mean_abs6(B["recent_win30"], q(B["recent_win30"])) <= 0.10)
    add("recent_top3_30_6", "6艇の直近30走の3着内率", "recent", True, "6艇の |差| の平均 ≤ 0.10",
        [nz(x, 3) for x in q(B["recent_top3_30"])], mean_abs6(B["recent_top3_30"], q(B["recent_top3_30"])) <= 0.10)
    add("st_mean30_6", "6艇の過去30走の平均ST", "pastSt", True, "6艇の |差| の平均 ≤ 0.020",
        [nz(x, 3) for x in q(B["st_mean30"])], mean_abs6(B["st_mean30"], q(B["st_mean30"])) <= 0.02)
    stb1 = rank_band(B["st_mean30_rank"][:, 0])
    add("b1_st_rank_band", "1号艇の平均ST順位の帯", "pastSt", True, "1〜2位／3〜4位／5〜6位／欠損 が一致",
        int(q(B["st_mean30_rank"][:, 0])), stb1 == q(stb1))
    mb = rank_band(b1_motor_rank)
    add("b1_motor_rank_band", "1号艇のモーター2連率の順位の帯", "motor", True,
        "120 の motor_rank（1 + 1号艇より高い艇の数）で 1〜2位／3〜4位／5〜6位／欠損 が一致", int(q(b1_motor_rank)), mb == q(mb))
    add("motor_2_6", "6艇のモーター2連率", "motor", True, "6艇の |差| の平均 ≤ 5.0",
        [nz(x, 1) for x in q(B["motor_2"])], mean_abs6(B["motor_2"], q(B["motor_2"])) <= 5)
    bb = rank_band(b1_boat_rank)
    add("b1_boat_rank_band", "1号艇のボート2連率の順位の帯", "boat", True, "motor と同じ式で 1〜2位／3〜4位／5〜6位／欠損 が一致",
        int(q(b1_boat_rank)), bb == q(bb))
    add("boat_2_6", "6艇のボート2連率", "boat", True, "6艇の |差| の平均 ≤ 5.0",
        [nz(x, 1) for x in q(B["boat_2"])], mean_abs6(B["boat_2"], q(B["boat_2"])) <= 5)
    add("weather", "天候", "weather", True, "一致（欠損同士も一致）", WEATHER.get(int(q(d["weather_code"]))), eq(d["weather_code"]))
    wb = wind_bin(d["wind_speed"])
    add("wind_bin", "風速の帯", "wind", True, "MD-6 の風速ビン 0〜2／3〜4／5m以上／欠損 が一致", nz(q(d["wind_speed"]), 1), wb == q(wb))
    wdist = np.sqrt((d["wind_x"] - q(d["wind_x"])) ** 2 + (d["wind_y"] - q(d["wind_y"])) ** 2)
    add("wind_vector", "風（向き×速さ）", "wind", True, "風ベクトル（wind_x・wind_y、m/s）の差 ≤ 1.5（欠損は不一致）",
        [nz(q(d["wind_x"]), 2), nz(q(d["wind_y"]), 2)], wdist <= 1.5)
    wvb = wave_bin(d["wave_height"])
    add("wave_bin", "波高の帯", "wave", True, "0〜2cm／3〜5cm／6cm以上／欠損 が一致", nz(q(d["wave_height"]), 0), wvb == q(wvb))
    add("grade", "グレード", "grade", True, "一致（不明同士も一致）", GRADE.get(int(q(d["grade_code"]))), eq(d["grade_code"]))
    gb = np.where(~np.isfinite(d["grade_code"]), 2, np.where(d["grade_code"] == 0, 0, 1))
    add("grade_bin", "グレード区分", "grade", True, "MD-6 の区分 一般／G3以上／不明 が一致", int(q(gb)), gb == q(gb))
    add("round", "ラウンド", "round", True, "一致（不明同士も一致）", ROUND.get(int(q(d["round_code"]))), eq(d["round_code"]))
    add("series_day", "節の日目", "seriesDay", True, "一致", nz(q(d["series_day"]), 0), eq(d["series_day"]))
    add("is_final_day", "最終日か", "seriesDay", True, "一致（欠損同士も一致）", nz(q(d["is_final_day_num"]), 0),
        eq(d["is_final_day_num"]))
    add("age_6", "6艇の年齢", "age", True, "6艇の |差| の平均 ≤ 3",
        [nz(x, 0) for x in q(B["age"])], mean_abs6(B["age"], q(B["age"])) <= 3)
    add("weight_6", "6艇の体重", "weight", True, "6艇の |差| の平均 ≤ 2.0kg",
        [nz(x, 1) for x in q(B["weight"])], mean_abs6(B["weight"], q(B["weight"])) <= 2)
    nloc = np.nansum(B["is_local"], 1)
    add("n_local", "地元の艇数", "branch", True, "一致", int(q(nloc)), nloc == q(nloc))
    add("exh_time_diff_6", "6艇の展示タイムの偏差（参考）", "exhibitionTime", False, "6艇の |差| の平均 ≤ 0.030",
        [nz(x, 3) for x in q(B["exh_time_diff"])], mean_abs6(B["exh_time_diff"], q(B["exh_time_diff"])) <= 0.03)

    order = nb["top"]
    sim_items = []
    for it in items:
        ind = it["ind"]
        rec = {k: it[k] for k in ("key", "label", "group", "in_distance", "rule", "today")}
        rec["pool_rate"] = float(ind[pool].mean())
        rec["pool_n"] = int(ind[pool].sum())
        rec["knn_rate"] = {str(n): float(ind[order[:n]].mean()) for n in NS}
        rec["knn_count"] = {str(n): int(ind[order[:n]].sum()) for n in NS}
        rec["lift"] = {str(n): (float(ind[order[:n]].mean() / ind[pool].mean()) if ind[pool].mean() > 0 else None)
                       for n in NS}
        sim_items.append(rec)

    # ------------------------------------------------ 結果（DB）
    kbr = {x["race_id"]: x for x in raw["kb_races"]}
    kbb = {}
    for x in raw["kb_boats"]:
        kbb.setdefault(x["race_id"], {})[x["boat_number"]] = x
    res = {x["race_id"]: x for x in raw["results"]}
    stt = {}
    for x in raw["start_timings"]:
        stt.setdefault(x["race_id"], {})[x["boat_number"]] = x
    ent = {}
    for x in raw["entries"]:
        ent.setdefault(x["race_id"], {})[x["boat_number"]] = x
    exa = {}
    for x in raw["exhibition"]:
        exa.setdefault(x["race_id"], {})[x["boat_number"]] = x
    cond = {x["race_id"]: x for x in raw["conditions"]}

    def outcome(rid: str) -> dict:
        boats = []
        if rid in kbr:
            k = kbr[rid]
            bb_ = kbb.get(rid, {})
            for b in range(1, 7):
                x = bb_.get(b, {})
                fr = x.get("finish_raw")
                disp = str(int(fr)) if isinstance(fr, str) and fr.isdigit() else fr
                boats.append({"boat": b, "finish": disp, "finish_raw": fr, "st": x.get("start_timing"),
                              "returned": bool(x.get("is_flying") or x.get("is_late_start")),
                              "course": x.get("course")})
            order3 = k.get("combo_3tan")
            tech, pay, pop = k.get("technique"), k.get("payout_3tan"), k.get("popularity_3tan")
            stage = k.get("stage")
            stage_kind = k.get("stage_kind")
            src = "kb_archive"
        else:
            x = res.get(rid, {})
            ranks = [x.get(f"rank{i}") for i in range(1, 7)]
            st_ = stt.get(rid, {})
            en = ent.get(rid, {})
            ex = exa.get(rid, {})
            for b in range(1, 7):
                s = st_.get(b, {})
                if s.get("is_flying"):
                    fin = "F"
                elif s.get("is_late_start"):
                    fin = "L"
                elif en.get(b, {}).get("is_absent") or ex.get(b, {}).get("is_absent"):
                    fin = "欠"
                elif b in ranks:
                    fin = str(ranks.index(b) + 1)
                else:
                    fin = "失"  # 着順に無く F/L/欠 でもない（転覆・失格・妨害等。区別は DB に無い）
                boats.append({"boat": b, "finish": fin, "st": s.get("start_timing"),
                              "returned": bool(s.get("is_flying") or s.get("is_late_start")),
                              "course": x.get(f"actual_course_{b}") or x.get(f"course_{b}")})
            order3 = "-".join(str(v) for v in ranks[:3]) if all(ranks[:3]) else None
            tech, pay, pop = x.get("winning_technique"), x.get("payout_trifecta"), x.get("popularity_trifecta")
            stage = cond.get(rid, {}).get("race_stage")
            stage_kind = None
            src = "race_results"
        sts = [(bt["st"], bt["boat"]) for bt in boats if bt["st"] is not None and not bt["returned"]]
        srt = sorted(sts)
        for bt in boats:
            bt["st_rank"] = (1 + sum(1 for s, _ in sts if s < bt["st"])) if (bt["st"] is not None and not bt["returned"]) else None
        return {"source": src, "trifecta": order3, "technique": tech, "payout_3tan": pay, "popularity_3tan": pop,
                "stage": stage, "stage_kind": stage_kind, "boats": boats, "st_fastest_boat": srt[0][1] if srt else None}

    # ------------------------------------------------ 各レースの値（画面の ○△× 用）
    def values(i: int) -> dict:
        def b6(name, nd=2):
            return [nz(x, nd) for x in B[name][i]]
        return {
            "venue": {"venue_code": int(venue[i]), "venue_name": VENUE[int(venue[i])]},
            "raceNumber": {"race_number": int(d["race_number"][i])},
            "class": {"class_6": [CLASS.get(int(x)) if np.isfinite(x) else None for x in cls[i]], "n_A1": int(nA1[i])},
            "national": {"nat_win_6": b6("nat_win"), "nat_2_6": b6("nat_2", 1), "nat_win_rank_6": b6("nat_win_rank", 0),
                         "win_gap": nz(gap[i], 2), "win_gap_band": int(gapb[i]), "top_boat": int(top_boat[i])},
            "local": {"loc_win_6": b6("loc_win"), "loc_2_6": b6("loc_2", 1)},
            "recent": {"recent_win30_6": b6("recent_win30", 3), "recent_top3_30_6": b6("recent_top3_30", 3)},
            "boat1": {"b1_class": CLASS.get(int(cls[i, 0])) if np.isfinite(cls[i, 0]) else None,
                      "b1_nat_win": nz(nat[i, 0], 2)},
            "pastSt": {"st_mean30_6": b6("st_mean30", 3), "st_mean30_rank_6": b6("st_mean30_rank", 0)},
            "motor": {"motor_2_6": b6("motor_2", 1), "motor_2_rank_6": b6("motor_2_rank", 0),
                      "b1_motor_rank": nz(b1_motor_rank[i], 0)},
            "boat": {"boat_2_6": b6("boat_2", 1), "boat_2_rank_6": b6("boat_2_rank", 0),
                     "b1_boat_rank": nz(b1_boat_rank[i], 0)},
            "weather": {"weather": WEATHER.get(int(d["weather_code"][i])) if np.isfinite(d["weather_code"][i]) else None},
            "wind": {"wind_speed": nz(d["wind_speed"][i], 1), "wind_x": nz(d["wind_x"][i], 2),
                     "wind_y": nz(d["wind_y"][i], 2)},
            "wave": {"wave_height": nz(d["wave_height"][i], 0)},
            "grade": {"grade": GRADE.get(int(d["grade_code"][i])) if np.isfinite(d["grade_code"][i]) else None},
            "round": {"round": ROUND.get(int(d["round_code"][i])) if np.isfinite(d["round_code"][i]) else None},
            "seriesDay": {"series_day": nz(d["series_day"][i], 0), "is_final_day": nz(d["is_final_day_num"][i], 0)},
            "age": {"age_6": b6("age", 0)},
            "weight": {"weight_6": b6("weight", 1)},
            "branch": {"branch_code_6": b6("branch_code", 0), "is_local_6": b6("is_local", 0)},
            "exhibitionTime_not_in_distance": {"exh_time_6": b6("exh_time", 2), "exh_time_rank_6": b6("exh_time_rank", 0)},
        }

    groups = [str(g) for g in nb["groups"]]
    neighbors = []
    for k, i in enumerate(order):
        i = int(i)
        gd = nb["group_d2"][k]
        d2p = float(nb["d2p"][k])
        pen = lam if venue[i] != venue[qi] else 0.0
        contrib = {g: float(gd[j]) for j, g in enumerate(groups)}
        contrib["venuePenalty"] = pen
        rid = rid_str[i]
        neighbors.append({
            "rank": k + 1, "race_id": rid, "date": rid[:10], "venue_code": int(venue[i]), "venue_name": VENUE[int(venue[i])],
            "race_number": int(d["race_number"][i]),
            "grade": GRADE.get(int(d["grade_code"][i])) if np.isfinite(d["grade_code"][i]) else None,
            "round": ROUND.get(int(d["round_code"][i])) if np.isfinite(d["round_code"][i]) else None,
            "distance": float(np.sqrt(d2p)), "distance_unpenalized": float(np.sqrt(nb["d2"][k])),
            "top_pct": (k + 1) / npool * 100,
            "d2_by_group": contrib, "d2_share_by_group": {g: v / d2p for g, v in contrib.items()},
            "values": values(i), "result": outcome(rid),
            "rank123_features": [int(r["rank1"].iloc[i]), int(r["rank2"].iloc[i]), int(r["rank3"].iloc[i])],
        })

    # ------------------------------------------------ 3. 近傍 N件の結果の集計
    agg = {}
    for n in NS:
        sub = neighbors[:n]
        win = Counter(x["rank123_features"][0] for x in sub)
        tech = Counter(x["result"]["technique"] or "不明" for x in sub)
        tri = Counter("-".join(map(str, x["rank123_features"])) for x in sub)
        bt = {b: {"win": 0, "top2": 0, "top3": 0} for b in range(1, 7)}
        for x in sub:
            r1, r2, r3 = x["rank123_features"]
            bt[r1]["win"] += 1
            for b in (r1, r2):
                bt[b]["top2"] += 1
            for b in (r1, r2, r3):
                bt[b]["top3"] += 1
        agg[str(n)] = {"n": n, "winner_boat": {str(b): win.get(b, 0) for b in range(1, 7)},
                       "technique": dict(tech.most_common()), "trifecta": dict(sorted(tri.items(), key=lambda t: (-t[1], t[0]))),
                       "boat_finish": {str(b): v for b, v in bt.items()},
                       "venue_match": int(sum(1 for x in sub if x["venue_code"] == venue[qi])),
                       "kb_vs_main": {"kb": int(sum(1 for x in sub if x["date"] <= "2025-12-02")),
                                      "main": int(sum(1 for x in sub if x["date"] > "2025-12-02"))}}
    # 全母集団の1着艇（比較用）
    win_pool = Counter(r.loc[pool, "rank1"].astype(int))
    pool_ref = {"winner_boat_rate": {str(b): win_pool.get(b, 0) / npool for b in range(1, 7)}}

    # ------------------------------------------------ 5. 展示あり版との重なり
    overlap = {str(n): int(len(set(nb["top"][:n].tolist()) & set(nbx["top"][:n].tolist())))
               for n in (20, 50, 100, 200, 400, 800)}

    # ------------------------------------------------ 距離の内訳の平均（N件）
    gshare = {}
    for n in NS:
        sub = neighbors[:n]
        keys = list(sub[0]["d2_by_group"])
        tot = sum(x["distance"] ** 2 for x in sub)
        gshare[str(n)] = {g: sum(x["d2_by_group"][g] for x in sub) / tot for g in keys}

    rq = rid_str[qi]
    out = {
        "query": {"race_id": rq, "values": values(qi), "result": outcome(rq)},
        "method": {
            "base": "MD-6 knn_p（scripts/analysis/analogy-finder-md6）。詳細は knn_build.py の docstring",
            "weights_model": info["model_version"] + "/model_win.txt（寄与度用の本番モデル）",
            "lambda_mult": info["lambda_mult"], "L": var["L"], "lambda": lam,
            "excluded_from_distance": var["excluded"],
            "groups_in_distance": groups,
            "missing_handling": ("数値は母集団（2019-04-01〜2026-09-26）で z 化し、欠損は0（＝母集団の平均。MD-6 の prep.py と同じ "
                                 "np.nan_to_num）。カテゴリ（会場・天候・グレード・ラウンド・支部）の欠損は -1 という1つのカテゴリの one-hot。"
                                 "データの穴の月（2025-12・2026-01）は wind_x・wind_y・is_final_day_num がほぼ全部欠損なので、その月のレースは"
                                 "これらが平均値として扱われる（今日のレースの値との差は |今日の z| になる）。MD-6 は穴の期間を母集団から除いていた"),
        },
        "pool": {"period": info["pool_period"], "n": npool, "by_source": info["n_pool_by_source"],
                 "compare_120_pool": {"n_120": 408723, "kb_120": 362763, "main_120": 45960,
                                      "diff": npool - 408723,
                                      "diff_kb": info["n_pool_by_source"]["kb_le_2025-12-02"] - 362763,
                                      "diff_main": info["n_pool_by_source"]["main_ge_2025-12-03"] - 45960}},
        "neighbors": neighbors,
        "similarity": sim_items,
        "outcome_agg": agg, "pool_reference": pool_ref,
        "d2_share_by_group_mean": gshare,
        "distance_distribution": {
            "racecard": {k: var[k] for k in ("dist_at_rank_penalized", "dist_rank_unpenalized_sorted",
                                             "random_pair_median", "random_pair_median_penalized",
                                             "query_to_pool_median", "query_to_pool_median_penalized")},
            "with_exh": {k: info["variants"]["with_exh"][k] for k in ("dist_at_rank_penalized", "random_pair_median",
                                                                    "random_pair_median_penalized", "L", "lambda")},
        },
        "overlap_with_exh": overlap,
        "search_info": info,
    }
    (HERE / "knn.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("wrote knn.json", len(neighbors))
    print("overlap", overlap)
    print("dist", var["dist_at_rank_penalized"], var["random_pair_median"])
    for s in sim_items:
        print(s["key"], round(s["pool_rate"], 3), {k: round(v, 3) for k, v in s["knn_rate"].items()})
    print(json.dumps(agg["800"]["winner_boat"]), json.dumps(agg["800"]["technique"], ensure_ascii=False))
    print(json.dumps(gshare["800"]))


if __name__ == "__main__":
    main()
