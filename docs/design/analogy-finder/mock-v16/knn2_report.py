"""BOA-271 k-NN 2版目のまとめ → knn2.json（knn.json と同じ形式＋追加項目）

knn.json からの追加・変更:
  - 距離から 天候・風・波（weather_code・wind_x・wind_y・wind_speed・wave_height）と is_final_day_num を外した版
    （knn_build.py を KNN_TAG=knn2 KNN_DROP=... で実行した work2/ を読む）
  - 近傍ごとに same_series（例のレースと同じ節か）
  - 近傍ごとに item_match（似ている点の31項目それぞれに 2＝同じ帯／1＝近い／0＝違う／null＝どちらかが欠損）と
    item_disp（表示用の短い文字列）。今日の item_disp は query.item_disp
  - 近傍ごとの出力は表示に使う値に絞り、小数は2桁まで（距離だけ順位の区別のため3桁）
  - knn.json との比較（重なり・似ている点の差）、母集団の差（120 との +165R）の内訳

入力: work2/（knn_build.py・fetch_outcomes.mjs の出力）、work/nbr_racecard.npz（1版目の近傍）、knn.json（1版目の似ている点）
"""
from __future__ import annotations

import json
import math
import os
import sys
import warnings
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
ROUND_JA = {"yosen": "予選", "junyu": "準優", "yusho": "優勝戦", "other": "その他"}
VENUE = {1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川", 6: "浜名湖", 7: "蒲郡", 8: "常滑", 9: "津",
         10: "三国", 11: "びわこ", 12: "住之江", 13: "尼崎", 14: "鳴門", 15: "丸亀", 16: "児島", 17: "宮島",
         18: "徳山", 19: "下関", 20: "若松", 21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村"}
GAP_LABEL = {0: "帯0", 1: "帯1", 2: "帯2", 3: "帯3", 4: "帯4", 5: "帯5"}
BAND_LABEL = {0: "1〜2位", 1: "3〜4位", 2: "5〜6位"}
WIND_BIN_LABEL = {0: "0〜2m", 1: "3〜4m", 2: "5m以上"}
WAVE_BIN_LABEL = {0: "0〜2cm", 1: "3〜5cm", 2: "6cm以上"}


def r2(v):
    if v is None:
        return None
    v = float(v)
    return None if not math.isfinite(v) else round(v, 2)


def fmt(v, nd=2):
    if v is None or not np.isfinite(v):
        return "—"
    v = round(float(v), nd) + 0.0  # -0.0 を 0 にする
    s = f"{v:.{nd}f}"
    if s.startswith("-") and float(s) == 0:
        s = s[1:]
    return s.rstrip("0").rstrip(".") if nd > 0 and "." in s else s


def gap_band(g):
    if not np.isfinite(g):
        return 5
    return 0 if g < -1.91 else 1 if g < -1.14 else 2 if g < -0.49 else 3 if g < 0.19 else 4


def rank_band(rank):
    return np.where(~np.isfinite(rank), -1, np.where(rank <= 2, 0, np.where(rank <= 4, 1, 2)))


def b1_rank_of(x):
    b1 = x[:, 0]
    rk = 1 + (x[:, 1:] > b1[:, None]).sum(1).astype(float)
    return np.where(np.isfinite(b1), rk, np.nan)


def wind_dir_name(x, y, ws):
    if not (np.isfinite(x) and np.isfinite(y)):
        return f"風{fmt(ws, 0)}m" if np.isfinite(ws) else "風—"
    if (np.isfinite(ws) and ws == 0) or (x == 0 and y == 0):
        return "無風"
    ang = (math.degrees(math.atan2(x, y)) + 360) % 360
    return f"{F.DIR16[int(round(ang / 22.5)) % 16]}{fmt(ws, 0)}m"


TAG = os.environ.get("KNN_TAG", "knn2")
BASE = {"knn2": "knn", "knn3": "knn2", "knn4": "knn3", "knn5": "knn3", "knn6": "knn4"}[TAG]  # 比較する1つ前の版
# 近傍に使う距離の版。knn4（展示後の段）は with_exh（展示タイム・天候・風・波を含む）。もう一方は参考の重なりに使う
PRIMARY = {"knn4": "with_exh", "knn6": "with_exh"}.get(TAG, "racecard")
BASE_PRIMARY = {"knn4": "with_exh", "knn6": "with_exh"}.get(BASE, "racecard")
OTHER = "racecard" if PRIMARY == "with_exh" else "with_exh"
OVK = "overlap_with_exh" if OTHER == "with_exh" else f"overlap_with_{OTHER}"  # knn3 と同じキー名


def wdir(tag):
    return HERE / ("work" if tag == "knn" else f"work{tag[3:]}")


def main():
    W = wdir(TAG)
    r = pd.read_pickle(W / "races.pkl")
    B = dict(np.load(W / "boats.npz"))
    info = json.loads((W / "search.json").read_text())
    nb = dict(np.load(W / f"nbr_{PRIMARY}.npz"))
    nbx = dict(np.load(W / f"nbr_{OTHER}.npz"))
    nb1 = dict(np.load(wdir(BASE) / f"nbr_{BASE_PRIMARY}.npz"))
    k1 = json.loads((HERE / f"{BASE}.json").read_text())
    lm = np.load(W / "layer_mask.npy") if (W / "layer_mask.npy").exists() else None
    raw = json.loads((W / "outcomes_raw.json").read_text())
    qi = int(np.where(r["is_query"])[0][0])
    pool = r["is_pool"].to_numpy()
    npool = int(pool.sum())
    var = info["variants"][PRIMARY]
    lam = var["lambda"]
    venue = r["venue_code"].astype(int).to_numpy()
    rdate = r["race_date"].to_numpy()
    is_kb = r["race_date"].to_numpy() <= np.datetime64(F.KB_END)
    rid_str = np.array([F.int_to_rid(x) for x in r["race_id"].to_numpy()])
    order = nb["top"]
    ktop = len(order)
    # 層が 800件に届かないときは、その件数までの段＋層の全件（ktop）の段だけ出す
    NSK = [n for n in NS if n < ktop] + [ktop]

    # ------------------------------------------------ 派生量
    nat = B["nat_win"]
    others_max = np.nanmax(np.where(np.isfinite(nat[:, 1:]), nat[:, 1:], -np.inf), axis=1)
    gap = np.round(nat[:, 0] - others_max, 2)
    gap = np.where(np.isfinite(gap), gap, np.nan)
    gapb = np.array([gap_band(g) for g in gap])
    natf = np.where(np.isfinite(nat), nat, -np.inf)
    top_boat = natf.argmax(1) + 1
    second_boat = np.argsort(-natf, axis=1, kind="stable")[:, 1] + 1
    b1_motor_rank = b1_rank_of(B["motor_2"])
    b1_boat_rank = b1_rank_of(B["boat_2"])
    cls = B["cls_ord"]
    nA1 = (cls == 4).sum(1)
    rn = r["race_number"].to_numpy().astype(float)
    gc = r["grade_code"].to_numpy()
    rc = r["round_code"].to_numpy()
    wc = r["weather_code"].to_numpy()
    ws = r["wind_speed"].to_numpy()
    wx = r["wind_x"].to_numpy()
    wy = r["wind_y"].to_numpy()
    wave = r["wave_height"].to_numpy()
    sday = r["series_day"].to_numpy()
    fin = r["is_final_day_num"].to_numpy()
    nloc = np.nansum(B["is_local"], 1)
    # 会場クラスタ（MD-6 と同じ: 母集団の1号艇1着率で24場を6場ずつ4群）
    p_in = r[pool].groupby("venue_code")["rank1"].apply(lambda s: (s == 1).mean()).sort_values()
    clu = {int(v): gi for gi, g in enumerate(np.array_split(p_in.index.to_numpy(), 4)) for v in g}
    vclu = np.array([clu[int(v)] for v in venue])

    def q(a):
        return a[qi]

    def mean_abs6(a):
        d = np.abs(a - a[qi][None, :])
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            return np.nanmean(np.where(np.isfinite(d), d, np.nan), axis=1)

    def lv(same, near, null):
        out = np.where(same, 2, np.where(near, 1, 0)).astype(np.int8)
        return np.where(null, -1, out).astype(np.int8)

    def thr_item(a, t_same, t_near):
        m = mean_abs6(a)
        return lv(m <= t_same, m <= t_near, ~np.isfinite(m))

    def b6(a, nd=2):
        return lambda i: "/".join(fmt(x, nd) for x in a[i])

    def band_adj(b, labels, missing=-1):
        """b: 帯の番号（missing は欠損）。同じ=一致、近い=隣の帯"""
        null = (b == missing) | (q(b) == missing)
        return lv(b == q(b), np.abs(b - q(b)) == 1, null)

    def cls6(i):
        c = [CLASS.get(int(x)) if np.isfinite(x) else "—" for x in cls[i]]
        return f"{c[0]}×6" if len(set(c)) == 1 else "/".join(c)

    fin_null = ~np.isfinite(fin) | is_kb  # 長期の最終日は全部 false で使えないので null 扱い
    items = []

    def add(key, label, group, rule, near_rule, level, disp, pool_ind=None):
        items.append({"key": key, "label": label, "group": group, "rule": rule, "near_rule": near_rule,
                      "level": level, "disp": disp})

    add("venue", "会場", "venue", "一致", "同じ会場クラスタ（MD-6: 母集団の1号艇1着率で24場を6場ずつ4群）",
        lv(venue == q(venue), vclu == q(vclu), np.zeros(len(r), bool)), lambda i: VENUE[int(venue[i])])
    rb = ((rn - 1) // 4)
    add("race_number_band", "R番号の帯", "raceNumber", "1〜4R／5〜8R／9〜12R の帯が一致", "隣の帯",
        band_adj(rb, None), lambda i: f"{['1〜4R', '5〜8R', '9〜12R'][int(rb[i])]}（{int(rn[i])}R）")
    add("race_number", "R番号", "raceNumber", "一致", "|差| ≤ 2",
        lv(rn == q(rn), np.abs(rn - q(rn)) <= 2, np.zeros(len(r), bool)), lambda i: f"{int(rn[i])}R")
    c1 = cls[:, 0]
    add("b1_class", "1号艇の級別", "boat1", "一致", "隣の級別（A1↔A2 等）",
        lv(c1 == q(c1), np.abs(c1 - q(c1)) == 1, ~np.isfinite(c1) | ~np.isfinite(q(c1))),
        lambda i: CLASS.get(int(c1[i]), "—") if np.isfinite(c1[i]) else "—")
    same_cls = (np.nan_to_num(cls, nan=-1) == np.nan_to_num(q(cls), nan=-1)).sum(1)
    add("class_all6", "6艇の級別の並び", "class", "6艇とも級別が一致", "4〜5艇が一致",
        lv(same_cls == 6, same_cls >= 4, np.isnan(cls).all(1)), cls6)
    add("n_A1", "A1 の艇数", "class", "一致", "|差| = 1",
        lv(nA1 == q(nA1), np.abs(nA1 - q(nA1)) == 1, np.zeros(len(r), bool)), lambda i: f"A1 {int(nA1[i])}艇")
    add("win_gap_band", "勝率差の帯（1号艇 − 他艇の最大）", "national",
        "120 の5帯（帯0 <−1.91、帯1 −1.91〜−1.14、帯2 −1.14〜−0.49、帯3 −0.49〜0.19、帯4 ≥0.19。境界ちょうどは上の帯）が一致",
        "隣の帯", band_adj(gapb, None, missing=5),
        lambda i: f"{fmt(gap[i], 2)}（{GAP_LABEL[int(gapb[i])]}）" if gapb[i] != 5 else "—")
    add("top_boat", "勝率1位の艇", "national", "一致（同値は艇番の小さい方）", "今日の勝率1位の艇が、そのレースの勝率2位",
        lv(top_boat == q(top_boat), second_boat == q(top_boat), ~np.isfinite(nat).any(1)), lambda i: f"{int(top_boat[i])}号艇")
    add("nat_win_6", "6艇の全国勝率", "national", "6艇の |差| の平均 ≤ 0.50", "≤ 0.80",
        thr_item(nat, 0.5, 0.8), b6(nat))
    nr = B["nat_win_rank"]
    same_nr = (nr == q(nr)).sum(1)
    add("nat_win_rank_4", "勝率の順位の並び", "national", "勝率順位が一致する艇が4艇以上", "2〜3艇",
        lv(same_nr >= 4, same_nr >= 2, ~np.isfinite(nr).any(1)), b6(nr, 0))
    add("b1_nat_win", "1号艇の全国勝率", "boat1", "|差| ≤ 0.50", "≤ 1.00",
        lv(np.abs(nat[:, 0] - q(nat[:, 0])) <= 0.5, np.abs(nat[:, 0] - q(nat[:, 0])) <= 1.0, ~np.isfinite(nat[:, 0])),
        lambda i: fmt(nat[i, 0]))
    add("loc_win_6", "6艇の当地勝率", "local", "6艇の |差| の平均 ≤ 0.75（欠損の艇は除く）", "≤ 1.20",
        thr_item(B["loc_win"], 0.75, 1.2), b6(B["loc_win"]))
    add("recent_win30_6", "6艇の直近30走の1着率", "recent", "6艇の |差| の平均 ≤ 0.10", "≤ 0.15",
        thr_item(B["recent_win30"], 0.10, 0.15), b6(B["recent_win30"]))
    add("recent_top3_30_6", "6艇の直近30走の3着内率", "recent", "6艇の |差| の平均 ≤ 0.10", "≤ 0.15",
        thr_item(B["recent_top3_30"], 0.10, 0.15), b6(B["recent_top3_30"]))
    add("st_mean30_6", "6艇の過去30走の平均ST", "pastSt", "6艇の |差| の平均 ≤ 0.020", "≤ 0.030",
        thr_item(B["st_mean30"], 0.02, 0.03), b6(B["st_mean30"]))
    stb = rank_band(B["st_mean30_rank"][:, 0])
    add("b1_st_rank_band", "1号艇の平均ST順位の帯", "pastSt", "1〜2位／3〜4位／5〜6位 が一致", "隣の帯",
        band_adj(stb, None), lambda i: f"{fmt(B['st_mean30_rank'][i, 0], 0)}位" if stb[i] >= 0 else "—")
    mb = rank_band(b1_motor_rank)
    add("b1_motor_rank_band", "1号艇のモーター2連率の順位の帯", "motor",
        "120 の motor_rank（1 + 1号艇より高い艇の数）で 1〜2位／3〜4位／5〜6位 が一致", "隣の帯",
        band_adj(mb, None), lambda i: f"{fmt(b1_motor_rank[i], 0)}位" if mb[i] >= 0 else "—")
    add("motor_2_6", "6艇のモーター2連率", "motor", "6艇の |差| の平均 ≤ 5.0", "≤ 8.0",
        thr_item(B["motor_2"], 5, 8), b6(B["motor_2"], 1))
    bb = rank_band(b1_boat_rank)
    add("b1_boat_rank_band", "1号艇のボート2連率の順位の帯", "boat", "motor と同じ式で 1〜2位／3〜4位／5〜6位 が一致", "隣の帯",
        band_adj(bb, None), lambda i: f"{fmt(b1_boat_rank[i], 0)}位" if bb[i] >= 0 else "—")
    add("boat_2_6", "6艇のボート2連率", "boat", "6艇の |差| の平均 ≤ 5.0", "≤ 8.0",
        thr_item(B["boat_2"], 5, 8), b6(B["boat_2"], 1))
    rain = np.isin(wc, [2, 3])
    dry = np.isin(wc, [0, 1])
    add("weather", "天候", "weather", "一致", "晴・曇り同士、または雨・雪同士",
        lv(wc == q(wc), (rain & q(rain)) | (dry & q(dry)), ~np.isfinite(wc) | ~np.isfinite(q(wc))),
        lambda i: WEATHER.get(int(wc[i]), "—") if np.isfinite(wc[i]) else "—")
    wb = np.where(~np.isfinite(ws), -1, np.where(ws <= 2, 0, np.where(ws <= 4, 1, 2)))
    add("wind_bin", "風速の帯", "wind", "MD-6 の風速ビン 0〜2／3〜4／5m以上 が一致", "隣の帯",
        band_adj(wb, None), lambda i: f"{fmt(ws[i], 0)}m" if np.isfinite(ws[i]) else "—")
    wd = np.sqrt((wx - q(wx)) ** 2 + (wy - q(wy)) ** 2)
    add("wind_vector", "風（向き×速さ）", "wind", "風ベクトル（wind_x・wind_y、m/s）の差 ≤ 1.5", "≤ 2.5",
        lv(wd <= 1.5, wd <= 2.5, ~np.isfinite(wd)), lambda i: wind_dir_name(wx[i], wy[i], ws[i]))
    wvb = np.where(~np.isfinite(wave), -1, np.where(wave <= 2, 0, np.where(wave <= 5, 1, 2)))
    add("wave_bin", "波高の帯", "wave", "0〜2cm／3〜5cm／6cm以上 が一致", "隣の帯",
        band_adj(wvb, None), lambda i: f"{fmt(wave[i], 0)}cm" if np.isfinite(wave[i]) else "—")
    add("grade", "グレード", "grade", "一致", "隣のグレード（一般・G3・G2・G1・SG の並びで1つ違い）",
        lv(gc == q(gc), np.abs(gc - q(gc)) == 1, ~np.isfinite(gc) | ~np.isfinite(q(gc))),
        lambda i: GRADE.get(int(gc[i]), "—") if np.isfinite(gc[i]) else "—")
    gb = np.where(~np.isfinite(gc), -1, np.where(gc == 0, 0, 1))
    add("grade_bin", "グレード区分", "grade", "MD-6 の区分 一般／G3以上 が一致", "無し（2区分のため）",
        lv(gb == q(gb), np.zeros(len(r), bool), (gb == -1) | (q(gb) == -1)),
        lambda i: {0: "一般", 1: "G3以上"}.get(int(gb[i]), "—"))
    # ラウンドの並び: 予選(0)・準優(1)・優勝戦(2)。その他(3)は近いを持たない
    add("round", "ラウンド", "round", "一致", "予選↔準優、準優↔優勝戦（その他は近い無し）",
        lv(rc == q(rc), (np.abs(rc - q(rc)) == 1) & (rc != 3) & (q(rc) != 3), ~np.isfinite(rc) | ~np.isfinite(q(rc))),
        lambda i: ROUND_JA.get(ROUND.get(int(rc[i])), "—") if np.isfinite(rc[i]) else "—")
    add("series_day", "節の日目", "seriesDay", "一致", "|差| = 1",
        lv(sday == q(sday), np.abs(sday - q(sday)) == 1, ~np.isfinite(sday) | ~np.isfinite(q(sday))),
        lambda i: f"{fmt(sday[i], 0)}日目" if np.isfinite(sday[i]) else "—")
    add("is_final_day", "最終日か", "seriesDay", "一致", "無し（2値のため）。長期のレースは値が使えないので null",
        lv(fin == q(fin), np.zeros(len(r), bool), fin_null),
        lambda i: "—" if fin_null[i] else ("最終日" if fin[i] == 1 else "最終日でない"))
    add("age_6", "6艇の年齢", "age", "6艇の |差| の平均 ≤ 3", "≤ 5", thr_item(B["age"], 3, 5), b6(B["age"], 0))
    add("weight_6", "6艇の体重", "weight", "6艇の |差| の平均 ≤ 2.0kg", "≤ 3.0kg", thr_item(B["weight"], 2, 3),
        b6(B["weight"], 1))
    add("n_local", "地元の艇数", "branch", "一致", "|差| = 1",
        lv(nloc == q(nloc), np.abs(nloc - q(nloc)) == 1, np.isnan(B["is_local"]).all(1)), lambda i: f"地元 {int(nloc[i])}艇")
    add("exh_time_diff_6", "6艇の展示タイムの偏差（参考）", "exhibitionTime", "6艇の |差| の平均 ≤ 0.030", "≤ 0.050",
        thr_item(B["exh_time_diff"], 0.03, 0.05), b6(B["exh_time_diff"]))

    groups_in = set(var["groups_in_distance"])
    sim_items = []
    for it in items:
        L = it["level"]
        ind = L == 2
        rec = {k: it[k] for k in ("key", "label", "group", "rule", "near_rule")}
        rec["in_distance"] = it["group"] in groups_in and not (it["key"] == "is_final_day")
        rec["today"] = it["disp"](qi)
        rec["pool_rate"] = float(ind[pool].mean())
        rec["pool_n"] = int(ind[pool].sum())
        rec["knn_rate"] = {str(n): float(ind[order[:n]].mean()) for n in NSK}
        rec["knn_count"] = {str(n): int(ind[order[:n]].sum()) for n in NSK}
        rec["knn_near_or_same_rate"] = {str(n): float((L[order[:n]] >= 1).mean()) for n in NSK}
        rec["knn_null_count"] = {str(n): int((L[order[:n]] == -1).sum()) for n in NSK}
        rec["pool_near_or_same_rate"] = float((L[pool] >= 1).mean())
        if lm is not None:
            rec["layer_rate"] = float(ind[lm].mean())
            rec["layer_n"] = int(ind[lm].sum())
            rec["layer_near_or_same_rate"] = float((L[lm] >= 1).mean())
        rec["lift"] = {str(n): (float(ind[order[:n]].mean() / ind[pool].mean()) if ind[pool].mean() > 0 else None)
                       for n in NSK}
        sim_items.append(rec)

    # ------------------------------------------------ 同じ節
    series = pd.read_csv(HERE.parent / "model-prep" / "data" / "race_series.csv",
                         parse_dates=["start_date", "end_date"])
    qd = pd.Timestamp(rdate[qi])
    qs = series[(series["venue_code"] == q(venue)) & (series["start_date"] <= qd) & (series["end_date"] >= qd)]
    qs = qs.sort_values("start_date", ascending=False).iloc[0]
    vd = pd.read_csv(HERE.parent / "model-prep" / "data" / "kb_venue_days.csv", parse_dates=["race_date"])

    def kb_series_days(v, d):
        """長期: 同じ会場で、その日から前後に連続した開催日（kb_archive_venue_days に行がある日）で、グレードが同じ日の集合"""
        x = vd[vd["venue_code"] == v].set_index("race_date")["race_grade"]
        if d not in x.index:
            return set()
        g = x[d]
        days = {d}
        for step in (-1, 1):
            cur = d + pd.Timedelta(days=step)
            while cur in x.index and x[cur] == g:
                days.add(cur)
                cur += pd.Timedelta(days=step)
        return days

    q_kb_days = kb_series_days(int(q(venue)), qd) if is_kb[qi] else set()

    def same_series(i):
        if venue[i] != q(venue):
            return False
        d = pd.Timestamp(rdate[i])
        if not is_kb[qi]:
            return bool(qs["start_date"] <= d <= qs["end_date"])
        return d in q_kb_days

    # ------------------------------------------------ 結果（DB）
    kbr = {x["race_id"]: x for x in raw["kb_races"]}
    kbb, stt, ent, exa = {}, {}, {}, {}
    for x in raw["kb_boats"]:
        kbb.setdefault(x["race_id"], {})[x["boat_number"]] = x
    for x in raw["start_timings"]:
        stt.setdefault(x["race_id"], {})[x["boat_number"]] = x
    for x in raw["entries"]:
        ent.setdefault(x["race_id"], {})[x["boat_number"]] = x
    for x in raw["exhibition"]:
        exa.setdefault(x["race_id"], {})[x["boat_number"]] = x
    res = {x["race_id"]: x for x in raw["results"]}
    cond = {x["race_id"]: x for x in raw["conditions"]}

    def outcome(rid: str) -> dict:
        fins, sts, rets, courses = [], [], [], []
        if rid in kbr:
            k = kbr[rid]
            for b in range(1, 7):
                x = kbb.get(rid, {}).get(b, {})
                fr = x.get("finish_raw")
                fins.append(str(int(fr)) if isinstance(fr, str) and fr.isdigit() else fr)
                sts.append(x.get("start_timing"))
                rets.append(bool(x.get("is_flying") or x.get("is_late_start")))
                courses.append(x.get("course"))
            tri, tech, pay, pop, stage = (k.get("combo_3tan"), k.get("technique"), k.get("payout_3tan"),
                                          k.get("popularity_3tan"), k.get("stage"))
        else:
            x = res.get(rid, {})
            ranks = [x.get(f"rank{i}") for i in range(1, 7)]
            for b in range(1, 7):
                s = stt.get(rid, {}).get(b, {})
                if s.get("is_flying"):
                    f_ = "F"
                elif s.get("is_late_start"):
                    f_ = "L"
                elif ent.get(rid, {}).get(b, {}).get("is_absent") or exa.get(rid, {}).get(b, {}).get("is_absent"):
                    f_ = "欠"
                elif b in ranks:
                    f_ = str(ranks.index(b) + 1)
                else:
                    f_ = "失"
                fins.append(f_)
                sts.append(s.get("start_timing"))
                rets.append(bool(s.get("is_flying") or s.get("is_late_start")))
                courses.append(x.get(f"actual_course_{b}") or x.get(f"course_{b}"))
            tri = "-".join(str(v) for v in ranks[:3]) if all(ranks[:3]) else None
            tech, pay, pop = x.get("winning_technique"), x.get("payout_trifecta"), x.get("popularity_trifecta")
            stage = cond.get(rid, {}).get("race_stage")
        valid = [s for s, rt in zip(sts, rets) if s is not None and not rt]
        st_rank = [(1 + sum(1 for v in valid if v < s)) if (s is not None and not rt) else None for s, rt in zip(sts, rets)]
        return {"trifecta": tri, "technique": tech, "payout_3tan": pay, "popularity_3tan": pop, "stage": stage,
                "finish": fins, "st": [r2(s) for s in sts], "st_rank": st_rank, "course": courses}

    def match(i):
        return {it["key"]: (None if it["level"][i] < 0 else int(it["level"][i])) for it in items}

    def disp(i):
        return {it["key"]: it["disp"](i) for it in items}

    groups = [str(g) for g in nb["groups"]]
    neighbors = []
    for k, i in enumerate(order):
        i = int(i)
        d2p = float(nb["d2p"][k])
        pen = lam if venue[i] != venue[qi] else 0.0
        contrib = {g: float(nb["group_d2"][k][j]) for j, g in enumerate(groups)}
        contrib["venuePenalty"] = pen
        rid = rid_str[i]
        neighbors.append({
            "rank": k + 1, "race_id": rid, "date": rid[:10], "venue_code": int(venue[i]), "venue_name": VENUE[int(venue[i])],
            "race_number": int(rn[i]), "grade": GRADE.get(int(gc[i])) if np.isfinite(gc[i]) else None,
            "round": ROUND.get(int(rc[i])) if np.isfinite(rc[i]) else None,
            "distance": round(float(np.sqrt(d2p)), 3), "top_pct": float(f"{(k + 1) / npool * 100:.2g}"),
            "same_series": same_series(i),
            "d2_share_by_group": {g: round(v / d2p, 2) for g, v in contrib.items() if round(v / d2p, 2) > 0},
            "item_match": match(i), "item_disp": disp(i), "result": outcome(rid),
            "rank123": [int(r["rank1"].iloc[i]), int(r["rank2"].iloc[i]), int(r["rank3"].iloc[i])],
        })

    # ------------------------------------------------ 集計
    agg = {}
    for n in NSK:
        if n > len(neighbors):
            continue
        sub = neighbors[:n]
        win = Counter(x["rank123"][0] for x in sub)
        tech = Counter(x["result"]["technique"] or "不明" for x in sub)
        tri = Counter("-".join(map(str, x["rank123"])) for x in sub)
        bt = {b: {"win": 0, "top2": 0, "top3": 0} for b in range(1, 7)}
        for x in sub:
            a1, a2, a3 = x["rank123"]
            bt[a1]["win"] += 1
            for b in (a1, a2):
                bt[b]["top2"] += 1
            for b in (a1, a2, a3):
                bt[b]["top3"] += 1
        agg[str(n)] = {"n": n, "winner_boat": {str(b): win.get(b, 0) for b in range(1, 7)},
                       "technique": dict(tech.most_common()),
                       "trifecta": dict(sorted(tri.items(), key=lambda t: (-t[1], t[0]))),
                       "boat_finish": {str(b): v for b, v in bt.items()},
                       "venue_match": int(sum(1 for x in sub if x["venue_code"] == venue[qi])),
                       "same_series": int(sum(1 for x in sub if x["same_series"])),
                       "round_yusho": int(sum(1 for x in sub if x["round"] == "yusho")),
                       "round": dict(Counter(x["round"] or "不明" for x in sub).most_common()),
                       "kb_vs_main": {"kb": int(sum(1 for x in sub if x["date"] <= "2025-12-02")),
                                      "main": int(sum(1 for x in sub if x["date"] > "2025-12-02"))}}
    win_pool = Counter(r.loc[pool, "rank1"].astype(int))
    gshare = {}
    for n in NSK:
        top = order[:n]
        tot = float(nb["d2p"][:n].sum())
        sums = nb["group_d2"][:n].sum(0)
        pen = float(((venue[top] != venue[qi]) * lam).sum())
        gshare[str(n)] = {**{g: float(sums[j] / tot) for j, g in enumerate(groups)}, "venuePenalty": pen / tot}

    # ------------------------------------------------ knn.json との比較
    k1_sim = {s["key"]: s for s in k1["similarity"]}
    sim_diff = []
    for s in sim_items:
        o = k1_sim.get(s["key"])
        sim_diff.append({"key": s["key"], "label": s["label"],
                         "knn2": s["knn_rate"], "knn1": o["knn_rate"] if o else None,
                         "diff": {n: s["knn_rate"][n] - o["knn_rate"][n] for n in s["knn_rate"] if n in o["knn_rate"]} if o else None,
                         "pool_rate_knn2": s["pool_rate"], "pool_rate_knn1": o["pool_rate"] if o else None})
    overlap_knn1 = {str(n): int(len(set(order[:n].tolist()) & set(nb1["top"][:n].tolist()))) for n in NSK}

    # ------------------------------------------------ 母集団の差の内訳（120 との +165R）
    kb_m = pool & is_kb
    no23 = pool & ((r["rank2"].to_numpy() == 0) | (r["rank3"].to_numpy() == 0))
    pool_diff = {
        "n_ours": npool, "n_120": 408723, "diff": npool - 408723,
        "no_rank2_or_rank3": {"total": int(no23.sum()), "kb": int((no23 & kb_m).sum()), "main": int((no23 & ~is_kb & pool).sum()),
                              "no_rank2": int((pool & (r["rank2"].to_numpy() == 0)).sum()),
                              "no_rank3": int((pool & (r["rank3"].to_numpy() == 0)).sum())},
        "main_race_status_no_race_in_ours": ["2025-12-22-09-05"],
        "explanation": ("120 の analogy_pool_rows_kb / _main は rank2・rank3 が無いレース（2着同着で3着が無い、"
                        "完走が2艇以下 等）を外す（WHERE ... AND rank2 IS NOT NULL AND rank3 IS NOT NULL）。features.py の完全レースは"
                        "6艇・1着1艇・1〜3着に返還艇なし・欠場なしだけで、2・3着の有無は見ない。これが kb の 164R（すべて rank3 が無い。"
                        "うち rank2 も無いもの 3R）。残る本体の 1R は 2025-12-22-09-05 で、race_results.race_status = 'no_race'"
                        "（is_no_race は false）。120 は race_status <> 'no_race' で外すが、features.py は race_status を読まない"
                        "（export_pool.js が列を書き出さない）。164 + 1 = 165 で差を全部説明できる"),
    }

    rq = rid_str[qi]
    out = {
        "query": {"race_id": rq, "item_disp": disp(qi), "result": outcome(rq),
                  "series": {"venue_code": int(q(venue)), "start_date": str(qs["start_date"].date()),
                             "end_date": str(qs["end_date"].date()), "grade": qs["grade"]}},
        "method": {
            "base": f"MD-6 knn_p。knn_build.py（KNN_TAG={TAG if TAG in ('knn5', 'knn6') else 'knn2'}）",
            "weights_model": info["model_version"] + "/model_win.txt",
            "lambda_mult": info["lambda_mult"], "L": var["L"], "lambda": lam,
            "excluded_from_distance": var["excluded"], "groups_in_distance": var["groups_in_distance"],
            "race_num_features": var["race_num_features"], "race_cat_features": var["race_cat_features"],
            "same_series_rule": ("例のレースが本体期間（2025-12-03〜）なら race_series の、例のレースの会場・日付を含む節"
                                 "（重なるときは開始日が新しい方。features.series_day_from_series と同じ）の開始〜終了日に入る同じ会場のレース。"
                                 "例のレースが長期期間なら kb_archive_venue_days で、同じ会場・その日から前後に連続した開催日でグレードが同じ日。"
                                 "今回は本体期間なので race_series（若松 2026-09-22〜2026-09-27、G1）で判定。長期のレースは日付が"
                                 "2025-12-02 以前なので同じ節にならない"),
            "item_match_values": "2=同じ帯（similarity の rule）、1=近い（near_rule）、0=違う、null=今日か近傍のどちらかが欠損",
            "missing_handling": ("数値は母集団で z 化し欠損は0（平均）、カテゴリの欠損は -1 の one-hot（MD-6 と同じ）。天候・風・波・最終日を"
                                 "距離から外したので、データの穴の月（風・最終日がほぼ全部欠損）の影響は距離には残らない"),
        },
        "pool": {"period": info["pool_period"], "n": npool, "by_source": info["n_pool_by_source"],
                 **({"layer_n": int(lm.sum()), "n_ranked": ktop,
                     "note": (f"探した母集団は {npool:,}R。層（{'ラウンド＋' if 'round_code' in info['layer']['key'] else ''}勝率差の帯・1号艇の級別・"
                              f"勝率1位の艇が今日と同じ）は {int(lm.sum()):,}R。近傍（neighbors）は"
                              + (f"層の全件 {ktop:,}R を似ている順に並べたもの（800件に届かない）" if ktop < 800
                                 else f"層の中を似ている順に並べた先頭 {ktop:,}R"))}
                    if lm is not None else {})},
        "pool_diff_vs_120": pool_diff,
        "neighbors": neighbors,
        "similarity": sim_items,
        "outcome_agg": agg,
        "pool_reference": {"winner_boat_rate": {str(b): win_pool.get(b, 0) / npool for b in range(1, 7)}},
        "d2_share_by_group_mean": gshare,
        "distance_distribution": {
            PRIMARY: {k: var[k] for k in ("dist_at_rank_penalized", "dist_rank_unpenalized_sorted",
                                             "random_pair_median", "random_pair_median_penalized",
                                             "query_to_pool_median", "query_to_pool_median_penalized")},
            f"{OTHER}": {k: info["variants"][OTHER][k] for k in ("dist_at_rank_penalized", "random_pair_median",
                                                                    "random_pair_median_penalized", "L", "lambda")},
        },
        OVK: {str(n): int(len(set(order[:n].tolist()) & set(nbx["top"][:n].tolist()))) for n in NSK},
        "compare_knn1" if TAG == "knn2" else f"compare_{BASE}": {"base": BASE, "overlap": overlap_knn1, "similarity_diff": sim_diff},
        "search_info": info,
    }
    if lm is not None:
        lw = Counter(r.loc[lm, "rank1"].astype(int))
        nl = int(lm.sum())
        out["layer"] = {**info.get("layer", {}), "winner_boat_rate": {str(b): lw.get(b, 0) / nl for b in range(1, 7)},
                        "round_yusho": int((rc[lm] == 2).sum())}
    (HERE / f"{TAG}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    ss = [x["rank"] for x in neighbors if x["same_series"]]
    print("same_series", len(ss), ss[:40])
    print("overlap base", overlap_knn1, OTHER, out[OVK])
    print("dist", var["dist_at_rank_penalized"], var["random_pair_median"])
    print(json.dumps(agg[str(ktop)]["winner_boat"]), json.dumps(agg[str(ktop)]["technique"], ensure_ascii=False))
    print(neighbors[0]["item_disp"], neighbors[0]["item_match"])
    print(out["query"]["item_disp"])


if __name__ == "__main__":
    main()
