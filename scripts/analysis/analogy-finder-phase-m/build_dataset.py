"""BOA-271 Phase M: 艇単位データセットの構築（export-data.js の CSV から）

長期（kb_archive、2019-04-01〜2025-12-02）と本体テーブル（2025-12-03〜）を
同じ列名にそろえて連結し、as-of の特徴量を作る。

as-of の原則:
  - 出走表時点: 級別・勝率・2連率・当地・モーター/ボート2連率・体重・支部・年齢・グレード・ステージ・節日目
  - 直前情報時点: 展示タイム・気象
  - 選手の履歴（過去ST・直近成績）は shift(1)（そのレースより前の走だけ）
  - 着順・決まり手・実進入・本番ST・払戻は特徴量に入れない（ラベル／履歴の材料のみ）

出力: data/ml/analogy/boats.pkl
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
D = ROOT / "data" / "ml" / "analogy"

KB_END = pd.Timestamp("2025-12-02")

CLASS_ORD = {"B2": 1, "B1": 2, "A2": 3, "A1": 4}
WEATHER_CODE = {"晴": 0, "曇り": 1, "雨": 2, "雪": 3, "霧": 4, "台風": 5}
GRADE_CODE = {"ippan": 0, "G3": 1, "G2": 2, "G1": 3, "SG": 4}
ROUND_CODE = {"予選": 0, "準優勝戦": 1, "優勝戦": 2, "その他": 3}
DIR16 = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
         "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"]
DIR_ANGLE = {d: i * 22.5 for i, d in enumerate(DIR16)}
VENUE_PREF = {1: "群馬", 2: "埼玉", 3: "東京", 4: "東京", 5: "東京", 6: "静岡",
              7: "愛知", 8: "愛知", 9: "三重", 10: "福井", 11: "滋賀", 12: "大阪",
              13: "兵庫", 14: "徳島", 15: "香川", 16: "岡山", 17: "広島", 18: "山口",
              19: "山口", 20: "福岡", 21: "福岡", 22: "福岡", 23: "佐賀", 24: "長崎"}


def round_of(stage) -> str:
    """src/constants/raceStageConfig.js getRaceStageCategory を4区分にまとめる。"""
    if not isinstance(stage, str) or not stage:
        return "その他"
    s = unicodedata.normalize("NFKC", stage)
    if "準々" in s or "準優進出" in s:
        return "その他"
    if "準優勝戦" in s:
        return "準優勝戦"
    if "優勝戦" in s:
        return "優勝戦"
    if "ドリーム" in s or "DR" in s:
        return "その他"
    if "予選" in s:  # qualifierSpecial / qualifier
        return "予選"
    return "その他"


def rid_to_int(s: pd.Series) -> pd.Series:
    """race_id 'YYYY-MM-DD-VV-RR' → int64 YYYYMMDDVVRR（文字列のままだとメモリが足りないため）。"""
    c = s.astype("category")
    cats = pd.Series(c.cat.categories).str.replace("-", "", regex=False).astype("int64").to_numpy()
    return pd.Series(cats[c.cat.codes.to_numpy()], index=s.index)


def read(name: str, **kw) -> pd.DataFrame:
    d = pd.read_csv(D / f"{name}.csv", low_memory=False, **kw)
    if "race_id" in d.columns:
        d["race_id"] = rid_to_int(d["race_id"])
    for c in d.columns:
        if d[c].dtype == "float64":
            d[c] = d[c].astype("float32")
    return d


def encode_race_level(r: pd.DataFrame, weather, wind_dir, wind_speed, stage, final_day) -> pd.DataFrame:
    """レース単位の文字列項目を数値にしてから艇に結合する（メモリ節約）。"""
    out = pd.DataFrame({"race_id": r["race_id"]})
    out["weather_code"] = r[weather].map(WEATHER_CODE).astype("float32")
    ang = r[wind_dir].map(DIR_ANGLE)
    calm = r[wind_dir] == "無風"
    ws = pd.to_numeric(r[wind_speed], errors="coerce")
    # 風向は長期が8方位・本体が16方位なので、角度×風速のベクトル成分にそろえる（無風は0）
    out["wind_x"] = np.where(calm, 0.0, ws * np.sin(np.deg2rad(ang))).astype("float32")
    out["wind_y"] = np.where(calm, 0.0, ws * np.cos(np.deg2rad(ang))).astype("float32")
    out["round"] = r[stage].map(round_of)
    out["round_code"] = out["round"].map(ROUND_CODE).astype("float32")
    out["is_final_day_num"] = r[final_day].map(
        {True: 1, False: 0, "True": 1, "False": 0, "true": 1, "false": 0}).astype("float32")
    return out


def load_kb() -> pd.DataFrame:
    b = read("kb_boats", usecols=[
        "race_id", "boat_number", "racer_id", "class", "age", "branch", "weight",
        "national_win_rate", "national_2rate", "local_win_rate", "local_2rate",
        "motor_2rate", "boat_2rate", "exhibition_time", "start_timing", "is_flying",
        "is_late_start", "finish_raw", "finish_rank"],
             dtype={"branch": "category", "class": "category", "finish_raw": "category",
                    "race_id": "category"})
    r = read("kb_races")
    r = r[(r["has_result"] == True) & (pd.to_datetime(r["race_date"]) <= KB_END)]  # noqa: E712
    vd = pd.read_csv(D / "kb_venue_days.csv", low_memory=False)
    r = r.merge(vd[["venue_day_id", "series_day", "is_final_day"]], on="venue_day_id", how="left")
    enc = encode_race_level(r, "weather", "wind_direction", "wind_speed", "stage", "is_final_day")
    rr = pd.DataFrame({"race_id": r["race_id"], "race_date": pd.to_datetime(r["race_date"]),
                       "venue_code": r["venue_code"], "race_number": r["race_number"],
                       "wind_speed": r["wind_speed"], "wave_height": r["wave_height"],
                       "series_day": r["series_day"], "grade": None}).merge(enc, on="race_id")
    # 欠場（K0/K1）・不明は、そのレースごと除外する（発走前に分かる欠場を含む6艇比較にしない）
    kcat = [c for c in b["finish_raw"].cat.categories if str(c).startswith("K")]
    bad = set(b.loc[b["finish_raw"].isin(kcat) | b["finish_raw"].isna(), "race_id"])
    b = b.drop(columns=["finish_raw"])
    b = b.rename(columns={"class": "cls", "national_win_rate": "nat_win", "national_2rate": "nat_2",
                          "local_win_rate": "loc_win", "local_2rate": "loc_2",
                          "motor_2rate": "motor_2", "boat_2rate": "boat_2",
                          "exhibition_time": "exh_time", "start_timing": "st_result",
                          "is_late_start": "is_late"})
    df = b.merge(rr, on="race_id", how="inner")
    df["src"] = "kb"
    df["race_ok"] = ~df["race_id"].isin(bad)
    return df


def load_main() -> pd.DataFrame:
    races = read("races")
    ent = read("entries")
    exh = read("exhibition")
    cond = read("conditions")
    res = read("results")
    st = read("start_timings")
    races["race_date"] = pd.to_datetime(races["race_date"])
    races = races[races["race_date"] > KB_END]
    df = ent.merge(races, on="race_id", how="inner")
    df = df.merge(exh.rename(columns={"is_absent": "exh_absent", "start_timing": "exh_st"}),
                  on=["race_id", "boat_number"], how="left")
    enc = encode_race_level(cond, "weather", "wind_direction", "wind_speed", "race_stage", "is_final_day")
    df = df.merge(cond[["race_id", "wind_speed", "wave_height", "temperature", "water_temperature",
                        "series_day"]], on="race_id", how="left").merge(enc, on="race_id", how="left")
    df = df.merge(st.rename(columns={"start_timing": "st_result"}),
                  on=["race_id", "boat_number"], how="left")
    df = df.merge(res, on="race_id", how="left")
    # 着順: rank1..rank6 は「その着の艇番」
    fr = pd.Series(np.nan, index=df.index)
    for k in range(1, 7):
        fr = fr.where(df[f"rank{k}"] != df["boat_number"], k)
    has_res = df["rank1"].notna() & ~(df["is_cancelled"] == True) & ~(df["is_no_race"] == True)  # noqa: E712
    absent = (df["is_absent"] == True) | (df["exh_absent"] == True)  # noqa: E712
    bad = set(df.loc[absent | ~has_res, "race_id"])
    out = pd.DataFrame({
        "race_id": df["race_id"], "race_date": df["race_date"],
        "venue_code": df["venue_code"], "race_number": df["race_number"],
        "boat_number": df["boat_number"], "racer_id": df["racer_id"],
        "cls": df["grade"], "age": df["age"], "branch": df["branch"],
        "weight": df["weight_kg"], "nat_win": df["win_rate"],
        "nat_2": df["global_2rate"], "loc_win": df["local_win_rate"],
        "loc_2": df["local_2rate"], "motor_2": df["motor_2rate"],
        "boat_2": df["boat_2rate"], "exh_time": df["exhibition_time"],
        "wind_speed": df["wind_speed"], "wave_height": df["wave_height"],
        "grade": df["race_grade"], "series_day": df["series_day"],
        "weather_code": df["weather_code"], "wind_x": df["wind_x"], "wind_y": df["wind_y"],
        "round": df["round"], "round_code": df["round_code"],
        "is_final_day_num": df["is_final_day_num"],
        "finish_rank": fr,
        "st_result": df["st_result"], "is_flying": df["is_flying"],
        "is_late": df["is_late_start"],
        "src": "main",
        # 本体テーブルだけにある項目（MD-4 用）
        "nat_3": df["global_3rate"], "loc_3": df["local_3rate"],
        "motor_3": df["motor_3rate"], "boat_3": df["boat_3rate"],
        "temperature": df["temperature"], "water_temp": df["water_temperature"],
        "exh_st": df["exh_st"], "exh_course": df["exhibition_course"],
        "tilt": df["tilt"], "f_count": df["f_count"], "l_count": df["l_count"],
        "weight_fresh": df["weight_kg"], "start_time": df["start_time"],
    })
    out["race_ok"] = ~out["race_id"].isin(bad)
    return out


def attach_grade_from_series(df: pd.DataFrame) -> pd.DataFrame:
    s = pd.read_csv(D / "race_series.csv")
    s["start_date"] = pd.to_datetime(s["start_date"])
    s["end_date"] = pd.to_datetime(s["end_date"])
    keys = df[["venue_code", "race_date"]].drop_duplicates()
    m = keys.merge(s[["venue_code", "start_date", "end_date", "grade"]], on="venue_code")
    m = m[(m["race_date"] >= m["start_date"]) & (m["race_date"] <= m["end_date"])]
    m = m.dropna(subset=["grade"]).drop_duplicates(["venue_code", "race_date"])
    df = df.merge(m[["venue_code", "race_date", "grade"]].rename(columns={"grade": "grade_series"}),
                  on=["venue_code", "race_date"], how="left")
    df["grade"] = df["grade"].astype(object).where(df["grade"].notna(), df["grade_series"])
    return df.drop(columns=["grade_series"])


def shifted_rolling(df, col, window, min_periods, how="mean"):
    """df は racer_id, 日時順に並んでいる前提。そのレースより前の window 走の集計。"""
    prev = df.groupby("racer_id", sort=False)[col].shift(1)
    roll = prev.groupby(df["racer_id"], sort=False).rolling(window, min_periods=min_periods)
    r = roll.mean() if how == "mean" else roll.count()
    return r.reset_index(level=0, drop=True).sort_index()


def build() -> pd.DataFrame:
    import time
    t0 = time.time()
    kb = load_kb()
    print(f"kb loaded {len(kb):,} ({time.time()-t0:.0f}s)", flush=True)
    main = load_main()
    print(f"main loaded {len(main):,} ({time.time()-t0:.0f}s)", flush=True)
    df = pd.concat([kb, main], ignore_index=True)
    del kb, main
    for c in df.columns:
        if df[c].dtype == "float64":
            df[c] = df[c].astype("float32")
    df["branch"] = df["branch"].astype("category")
    df["src"] = df["src"].astype("category")
    df["round"] = df["round"].astype("category")
    df = attach_grade_from_series(df)
    print(f"grade attached ({time.time()-t0:.0f}s)", flush=True)

    # ---- 選手の履歴の並び（racer, 日付, R番号） ----
    df = df.sort_values(["racer_id", "race_date", "race_number", "race_id"]).reset_index(drop=True)
    # 体重・支部の as-of 前方補完（本体テーブルは 2026-03〜09-21 に racelist 由来の値がほぼ無い）。
    # そのレースより前の最後の既知値だけを使う（リークなし）。補完したかは flag に残す
    for c in ("weight", "branch"):
        df[f"{c}_was_missing"] = df[c].isna()
        prev = df.groupby("racer_id", sort=False)[c].shift(1)
        prev = prev.groupby(df["racer_id"], sort=False).ffill()
        df[c] = df[c].fillna(prev)
    print(f"ffill ({time.time()-t0:.0f}s)", flush=True)

    st_ok = df["st_result"].where(~(df["is_flying"] == True) & ~(df["is_late"] == True))  # noqa: E712
    df["_st"] = pd.to_numeric(st_ok, errors="coerce")
    df["st_mean30"] = shifted_rolling(df, "_st", 30, 3)
    df["st_n"] = shifted_rolling(df, "_st", 30, 1, how="count")
    fr = df["finish_rank"]
    df["_win"] = np.where(fr.notna(), (fr == 1).astype(float), np.nan)
    df["_top3"] = np.where(fr.notna(), (fr <= 3).astype(float), np.nan)
    df["recent_win30"] = shifted_rolling(df, "_win", 30, 5)
    df["recent_top3_30"] = shifted_rolling(df, "_top3", 30, 5)
    df = df.drop(columns=["_st", "_win", "_top3"])
    print(f"history ({time.time()-t0:.0f}s)", flush=True)

    # ---- 基本変換 ----
    df["cls_ord"] = df["cls"].astype(object).map(CLASS_ORD).astype("float32")
    df["grade_code"] = df["grade"].map(GRADE_CODE).astype("float32")
    pref = df["venue_code"].map(VENUE_PREF)
    br = df["branch"].astype(object)
    df["is_local"] = np.where(br.isna(), np.nan, (br == pref).astype(float)).astype("float32")
    df["branch_code"] = df["branch"].cat.codes.astype("float32").where(br.notna())

    # ---- レース内の相対値 ----
    df = df.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)
    grp = df.groupby("race_id", sort=False)
    for c, asc in (("nat_win", False), ("loc_win", False), ("motor_2", False),
                   ("boat_2", False), ("exh_time", True), ("st_mean30", True),
                   ("recent_win30", False)):
        df[f"{c}_diff"] = (df[c] - grp[c].transform("mean")).astype("float32")
        df[f"{c}_rank"] = grp[c].rank(ascending=asc, method="min").astype("float32")
    b1 = df.loc[df["boat_number"] == 1, ["race_id", "cls_ord", "nat_win"]].rename(
        columns={"cls_ord": "b1_cls_ord", "nat_win": "b1_nat_win"})
    df = df.merge(b1, on="race_id", how="left")
    print(f"relative ({time.time()-t0:.0f}s)", flush=True)

    # ---- ラベル ----
    df["y_win"] = (df["finish_rank"] == 1).astype("int8")
    df["y_top2"] = (df["finish_rank"] <= 2).astype("int8")
    df["y_top3"] = (df["finish_rank"] <= 3).astype("int8")
    n1 = df.groupby("race_id", sort=False)["y_win"].transform("sum")
    nb = df.groupby("race_id", sort=False)["boat_number"].transform("size")
    df["race_ok"] = df["race_ok"] & (n1 == 1) & (nb == 6)
    return df.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)


def main():
    df = build()
    df.to_pickle(D / "boats.pkl")
    ok = df[df["race_ok"]]
    summary = {
        "rows": int(len(df)), "races": int(df["race_id"].nunique()),
        "races_ok": int(ok["race_id"].nunique()),
        "by_src": ok.groupby("src", observed=True)["race_id"].nunique().to_dict(),
        "date_range": [str(df["race_date"].min().date()), str(df["race_date"].max().date())],
        "races_ok_by_month": ok[ok["boat_number"] == 1]["race_date"].dt.strftime("%Y-%m")
        .value_counts().sort_index().to_dict(),
        "fill_rate_by_src": {s: {c: float(g[c].notna().mean()) for c in
                                 ["cls_ord", "nat_win", "nat_2", "loc_win", "motor_2", "boat_2",
                                  "exh_time", "st_mean30", "weather_code", "wind_x", "wave_height",
                                  "grade_code", "series_day", "is_final_day_num", "age", "weight",
                                  "branch_code"]}
                             for s, g in ok.groupby("src", observed=True)},
    }
    (D / "dataset_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps({k: summary[k] for k in ("rows", "races", "races_ok", "by_src", "date_range")},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
