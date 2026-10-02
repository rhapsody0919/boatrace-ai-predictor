"""BOA-271 アナロジー・ファインダー: 艇単位の特徴量（学習・寄与度の集計で共通）

export_pool.js が書き出した CSV から、長期（kb_archive、〜2025-12-02）と本体テーブル
（2025-12-03〜）を同じ列名にそろえて連結し、as-of の特徴量を作る。
Phase M の scripts/analysis/analogy-finder-phase-m/build_dataset.py を本番用に直したもの。
Phase M からの変更点:
  - 選手の履歴（直近成績・過去 ST）は日単位でずらす。同じ日の前のレースの結果は、同じ日の
    後のレースの特徴量に入れない（出走表時点で分かるのは前日までの成績のため。plan「as-of」）
  - ラウンドは本体が getRaceStageCategory（src/constants/raceStageConfig.js）と同じ規則、
    長期は kb_archive_races.stage_kind（長期の stage の文字列は途中で切れているため）。
    会場の企画レース名など分類できないステージは「その他」、ステージが無いレースは None（「全ラウンド」にだけ入れる）
  - グレードは長期が kb_archive_venue_days.race_grade、本体が races.race_grade を先に使い、
    無ければ race_series の期間で補う
  - 1〜3着に返還艇（F・出遅れ）が入るレースは完全レースから外す（本体の rank は返還艇も
    公式の並びのまま入っている）。データの穴（2025-12〜2026-03）は K/B 補完で埋まったので外さない

使い方: python features.py   → data/ml/analogy/boats.pkl
"""

from __future__ import annotations

import json
import os
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
D = Path(os.environ.get("ANALOGY_DATA_DIR", ROOT / "data" / "ml" / "analogy"))

KB_END = pd.Timestamp("2025-12-02")
HISTORY_WINDOW = 30

CLASS_ORD = {"B2": 1, "B1": 2, "A2": 3, "A1": 4}
WEATHER_CODE = {"晴": 0, "曇り": 1, "雨": 2, "雪": 3, "霧": 4, "台風": 5}
GRADES = ["ippan", "G3", "G2", "G1", "SG"]
GRADE_CODE = {g: i for i, g in enumerate(GRADES)}
ROUNDS = ["yosen", "junyu", "yusho", "other"]
ROUND_CODE = {r: i for i, r in enumerate(ROUNDS)}
DIR16 = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
         "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"]
DIR_ANGLE = {d: i * 22.5 for i, d in enumerate(DIR16)}
VENUE_PREF = {1: "群馬", 2: "埼玉", 3: "東京", 4: "東京", 5: "東京", 6: "静岡",
              7: "愛知", 8: "愛知", 9: "三重", 10: "福井", 11: "滋賀", 12: "大阪",
              13: "兵庫", 14: "徳島", 15: "香川", 16: "岡山", 17: "広島", 18: "山口",
              19: "山口", 20: "福岡", 21: "福岡", 22: "福岡", 23: "佐賀", 24: "長崎"}


# ---------------------------------------------------------------- ラウンド
def _has_special(s: str) -> bool:
    return any(k in s for k in ("特選", "特賞", "特別", "選抜"))


# src/constants/raceStageConfig.js の RACE_STAGE_CATEGORY_RULES と同じ順序（tests で一致を固定）
_STAGE_RULES = [
    ("semifinalQualifier", lambda s: "準々" in s or "準優進出" in s),
    ("semifinal", lambda s: "準優勝戦" in s),
    ("final", lambda s: "優勝戦" in s),
    ("dream", lambda s: "ドリーム" in s or "DR" in s),
    ("qualifierSpecial", lambda s: "予選" in s and _has_special(s)),
    ("generalSpecial", lambda s: "一般" in s and _has_special(s)),
    ("selection", lambda s: "選抜" in s),
    ("special", _has_special),
    ("qualifier", lambda s: "予選" in s),
    ("general", lambda s: "一般" in s),
]
_CATEGORY_ROUND = {"qualifier": "yosen", "qualifierSpecial": "yosen", "semifinal": "junyu",
                   "final": "yusho"}
_KB_KIND_ROUND = {"qualifier": "yosen", "semifinal": "junyu", "final": "yusho", "other": "other"}


def round_from_stage(stage) -> str | None:
    """本体の race_conditions.race_stage → 4区分。ステージが空なら None。"""
    if not isinstance(stage, str) or not stage:
        return None
    s = unicodedata.normalize("NFKC", stage)
    key = next((k for k, test in _STAGE_RULES if test(s)), None)
    return _CATEGORY_ROUND.get(key, "other")


def round_from_kb_kind(kind) -> str | None:
    return _KB_KIND_ROUND.get(kind) if isinstance(kind, str) else None


# ---------------------------------------------------------------- 読み込み
def rid_to_int(s: pd.Series) -> pd.Series:
    """race_id 'YYYY-MM-DD-VV-RR' → int64 YYYYMMDDVVRR（文字列のままだとメモリが足りないため）。"""
    c = s.astype("category")
    cats = pd.Series(c.cat.categories).str.replace("-", "", regex=False).astype("int64").to_numpy()
    return pd.Series(cats[c.cat.codes.to_numpy()], index=s.index)


def int_to_rid(v: int) -> str:
    s = f"{int(v):012d}"
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}-{s[8:10]}-{s[10:12]}"


def read(name: str, src: Path = D, **kw) -> pd.DataFrame:
    path = src / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} がありません。先に export_pool.js を実行してください")
    d = pd.read_csv(path, low_memory=False, **kw)
    if "race_id" in d.columns:
        d["race_id"] = rid_to_int(d["race_id"])
    for c in d.columns:
        if d[c].dtype == "float64":
            d[c] = d[c].astype("float32")
    return d


def _bool(s: pd.Series) -> pd.Series:
    return s.map({True: True, False: False, "true": True, "false": False,
                  "True": True, "False": False}).fillna(False).astype(bool)


def encode_race_level(r: pd.DataFrame, weather, wind_dir, wind_speed, final_day) -> pd.DataFrame:
    out = pd.DataFrame({"race_id": r["race_id"]})
    out["weather_code"] = r[weather].map(WEATHER_CODE).astype("float32")
    ang = r[wind_dir].map(DIR_ANGLE)
    calm = r[wind_dir] == "無風"
    ws = pd.to_numeric(r[wind_speed], errors="coerce")
    # 風向は長期が8方位・本体が16方位なので、角度×風速のベクトル成分にそろえる（無風は0）
    out["wind_x"] = np.where(calm, 0.0, ws * np.sin(np.deg2rad(ang))).astype("float32")
    out["wind_y"] = np.where(calm, 0.0, ws * np.cos(np.deg2rad(ang))).astype("float32")
    out["is_final_day_num"] = r[final_day].map(
        {True: 1, False: 0, "True": 1, "False": 0, "true": 1, "false": 0}).astype("float32")
    return out


def load_kb(src: Path = D) -> pd.DataFrame:
    b = read("kb_boats", src, usecols=[
        "race_id", "boat_number", "racer_id", "class", "age", "branch", "weight",
        "national_win_rate", "national_2rate", "local_win_rate", "local_2rate",
        "motor_2rate", "boat_2rate", "exhibition_time", "start_timing", "is_flying",
        "is_late_start", "finish_raw", "finish_rank"],
             dtype={"branch": "category", "class": "category", "finish_raw": "category",
                    "race_id": "category"})
    r = read("kb_races", src)
    r = r[_bool(r["has_result"]) & (pd.to_datetime(r["race_date"]) <= KB_END)]
    vd = pd.read_csv(src / "kb_venue_days.csv", low_memory=False)
    r = r.merge(vd[["venue_day_id", "series_day", "is_final_day", "race_grade"]],
                on="venue_day_id", how="left")
    enc = encode_race_level(r, "weather", "wind_direction", "wind_speed", "is_final_day")
    rr = pd.DataFrame({"race_id": r["race_id"], "race_date": pd.to_datetime(r["race_date"]),
                       "venue_code": r["venue_code"], "race_number": r["race_number"],
                       "wind_speed": r["wind_speed"], "wave_height": r["wave_height"],
                       "series_day": r["series_day"],
                       "grade": r["race_grade"].where(r["race_grade"].isin(GRADES)),
                       "round": r["stage_kind"].map(round_from_kb_kind)}).merge(enc, on="race_id")
    # 欠場（K0/K1）・不明は、そのレースごと除外する（発走前に分かる欠場を含む6艇比較にしない）
    kcat = [c for c in b["finish_raw"].cat.categories if str(c).startswith("K")]
    bad = set(b.loc[b["finish_raw"].isin(kcat) | b["finish_raw"].isna(), "race_id"])
    b = b.drop(columns=["finish_raw"])
    b = b.rename(columns={"class": "cls", "national_win_rate": "nat_win", "national_2rate": "nat_2",
                          "local_win_rate": "loc_win", "local_2rate": "loc_2",
                          "motor_2rate": "motor_2", "boat_2rate": "boat_2",
                          "exhibition_time": "exh_time", "start_timing": "st_result",
                          "is_late_start": "is_late"})
    b["is_flying"] = _bool(b["is_flying"])
    b["is_late"] = _bool(b["is_late"])
    df = b.merge(rr, on="race_id", how="inner")
    df["race_ok"] = ~df["race_id"].isin(bad)
    return df


def load_main(src: Path = D) -> pd.DataFrame:
    races = read("races", src)
    ent = read("entries", src)
    exh = read("exhibition", src)
    cond = read("conditions", src)
    res = read("results", src)
    st = read("start_timings", src)
    races["race_date"] = pd.to_datetime(races["race_date"])
    races = races[races["race_date"] > KB_END]
    df = ent.merge(races, on="race_id", how="inner")
    df = df.merge(exh[["race_id", "boat_number", "exhibition_time", "is_absent"]]
                  .rename(columns={"is_absent": "exh_absent"}),
                  on=["race_id", "boat_number"], how="left")
    enc = encode_race_level(cond, "weather", "wind_direction", "wind_speed", "is_final_day")
    enc["round"] = cond["race_stage"].map(round_from_stage)
    df = df.merge(cond[["race_id", "wind_speed", "wave_height", "series_day"]],
                  on="race_id", how="left").merge(enc, on="race_id", how="left")
    df = df.merge(st[["race_id", "boat_number", "start_timing", "is_flying", "is_late_start"]],
                  on=["race_id", "boat_number"], how="left")
    df = df.merge(res, on="race_id", how="left")
    # rank1..rank6 は「その着の艇番」
    fr = pd.Series(np.nan, index=df.index)
    for k in range(1, 7):
        fr = fr.where(df[f"rank{k}"] != df["boat_number"], k)
    has_res = (df["rank1"].notna() & ~_bool(df["is_cancelled"]) & ~_bool(df["is_no_race"])
               & ~races_cancelled(df))
    absent = _bool(df["is_absent"]) | _bool(df["exh_absent"])
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
        "grade": df["race_grade"].where(df["race_grade"].isin(GRADES)),
        "series_day": df["series_day"],
        "weather_code": df["weather_code"], "wind_x": df["wind_x"], "wind_y": df["wind_y"],
        "round": df["round"], "is_final_day_num": df["is_final_day_num"],
        "finish_rank": fr,
        "st_result": df["start_timing"], "is_flying": _bool(df["is_flying"]),
        "is_late": _bool(df["is_late_start"]),
    })
    out["race_ok"] = ~out["race_id"].isin(bad)
    return out


def races_cancelled(df: pd.DataFrame) -> pd.Series:
    """races.cancellation_status が入っている（中止・順延）レース。"""
    if "cancellation_status" not in df.columns:
        return pd.Series(False, index=df.index)
    return df["cancellation_status"].notna() & (df["cancellation_status"].astype(str) != "")


def attach_grade_from_series(df: pd.DataFrame, series: pd.DataFrame) -> pd.DataFrame:
    """グレードが無いレースを race_series の期間（会場・開始日〜終了日）で補う。"""
    s = series.dropna(subset=["grade"]).copy()
    s["start_date"] = pd.to_datetime(s["start_date"])
    s["end_date"] = pd.to_datetime(s["end_date"])
    keys = df[["venue_code", "race_date"]].drop_duplicates()
    m = keys.merge(s[["venue_code", "start_date", "end_date", "grade"]], on="venue_code")
    m = m[(m["race_date"] >= m["start_date"]) & (m["race_date"] <= m["end_date"])]
    m = m.drop_duplicates(["venue_code", "race_date"])
    out = df.merge(m[["venue_code", "race_date", "grade"]].rename(columns={"grade": "grade_series"}),
                   on=["venue_code", "race_date"], how="left")
    g = out["grade"].astype(object).where(out["grade"].notna(), out["grade_series"])
    out["grade"] = g.where(g.isin(GRADES), None)
    return out.drop(columns=["grade_series"])


# ---------------------------------------------------------------- 選手の履歴（日単位でずらす）
def _rolling_before(df: pd.DataFrame, col: str, min_periods: int, how: str) -> pd.Series:
    """その走より前の HISTORY_WINDOW 走の集計（df は racer_id・日付・R番号順）。"""
    prev = df.groupby("racer_id", sort=False)[col].shift(1)
    roll = prev.groupby(df["racer_id"], sort=False).rolling(HISTORY_WINDOW, min_periods=min_periods)
    r = roll.mean() if how == "mean" else roll.count()
    return r.reset_index(level=0, drop=True).sort_index()


def _first_of_day(df: pd.DataFrame, s: pd.Series) -> pd.Series:
    """その日の最初の走の値を、同じ日の全走に配る（＝前日までの走だけの集計）。
    transform("first") は NaN を飛ばして2走目以降の値（当日1走目の結果を含む）を配るので使わない。
    最初の走が NaN（min_periods に届かない）なら、その日は全走 NaN のまま"""
    keys = [df["racer_id"], df["race_date"]]
    first = s.where(df.groupby(keys, sort=False).cumcount() == 0)
    return first.groupby(keys, sort=False).transform("max")


def add_history(df: pd.DataFrame) -> pd.DataFrame:
    """過去 ST の平均・本数と直近成績。必要な列: racer_id, race_date, race_number, race_id,
    finish_rank, st_result, is_flying, is_late。"""
    df = df.sort_values(["racer_id", "race_date", "race_number", "race_id"]).reset_index(drop=True)
    st_ok = df["st_result"].where(~df["is_flying"].astype(bool) & ~df["is_late"].astype(bool))
    work = pd.DataFrame({"racer_id": df["racer_id"], "race_date": df["race_date"],
                         "_st": pd.to_numeric(st_ok, errors="coerce")})
    fr = df["finish_rank"]
    work["_win"] = np.where(fr.notna(), (fr == 1).astype(float), np.nan)
    work["_top3"] = np.where(fr.notna(), (fr <= 3).astype(float), np.nan)
    for name, col, mp, how in (("st_mean30", "_st", 3, "mean"), ("st_n", "_st", 1, "count"),
                               ("recent_win30", "_win", 5, "mean"),
                               ("recent_top3_30", "_top3", 5, "mean")):
        df[name] = _first_of_day(work, _rolling_before(work, col, mp, how)).astype("float32")
    return df


def forward_fill_profile(df: pd.DataFrame) -> pd.DataFrame:
    """体重・支部の前方補完（出走表の値が無い期間がある）。前の走の既知値だけを使う。"""
    for c in ("weight", "branch"):
        prev = df.groupby("racer_id", sort=False)[c].shift(1)
        prev = prev.groupby(df["racer_id"], sort=False).ffill()
        df[c] = df[c].fillna(prev)
    return df


# ---------------------------------------------------------------- レース内の相対値・ラベル
def add_relative(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)
    grp = df.groupby("race_id", sort=False)
    for c, asc in (("nat_win", False), ("loc_win", False), ("motor_2", False),
                   ("boat_2", False), ("exh_time", True), ("st_mean30", True),
                   ("recent_win30", False)):
        df[f"{c}_diff"] = (df[c] - grp[c].transform("mean")).astype("float32")
        df[f"{c}_rank"] = grp[c].rank(ascending=asc, method="min").astype("float32")
    b1 = df.loc[df["boat_number"] == 1, ["race_id", "cls_ord", "nat_win"]].rename(
        columns={"cls_ord": "b1_cls_ord", "nat_win": "b1_nat_win"})
    return df.merge(b1, on="race_id", how="left")


def add_labels(df: pd.DataFrame) -> pd.DataFrame:
    """1着／2着以内／3着以内のラベルと、完全レース（6艇・1着が1艇・1〜3着に返還艇なし）の印。"""
    df = df.copy()
    returned = df["is_flying"].astype(bool) | df["is_late"].astype(bool)
    fr = df["finish_rank"].where(~returned)
    returned_top3 = returned & (df["finish_rank"] <= 3)
    df["finish_rank"] = fr
    df["y_win"] = (fr == 1).astype("int8")
    df["y_top2"] = (fr <= 2).astype("int8")
    df["y_top3"] = (fr <= 3).astype("int8")
    g = df.groupby("race_id", sort=False)
    n1 = g["y_win"].transform("sum")
    nb = g["boat_number"].transform("size")
    bad = returned_top3.groupby(df["race_id"], sort=False).transform("any")
    df["race_ok"] = df["race_ok"] & (n1 == 1) & (nb == 6) & ~bad
    return df


def build(src: Path = D) -> pd.DataFrame:
    df = pd.concat([load_kb(src), load_main(src)], ignore_index=True)
    for c in df.columns:
        if df[c].dtype == "float64":
            df[c] = df[c].astype("float32")
    df = attach_grade_from_series(df, pd.read_csv(src / "race_series.csv"))
    df = df.sort_values(["racer_id", "race_date", "race_number", "race_id"]).reset_index(drop=True)
    df = forward_fill_profile(df)
    df = add_history(df)

    df["cls_ord"] = df["cls"].astype(object).map(CLASS_ORD).astype("float32")
    df["grade_code"] = df["grade"].map(GRADE_CODE).astype("float32")
    df["round_code"] = df["round"].map(ROUND_CODE).astype("float32")
    br = df["branch"].astype(object)
    df["is_local"] = np.where(br.isna(), np.nan,
                              (br == df["venue_code"].map(VENUE_PREF)).astype(float)).astype("float32")
    df["branch_code"] = df["branch"].astype("category").cat.codes.astype("float32").where(br.notna())

    df = add_relative(df)
    df = add_labels(df)
    return df.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)


def complete_races(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["race_ok"]].sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)


def main():
    df = build()
    df.to_pickle(D / "boats.pkl")
    ok = df[df["race_ok"] & (df["boat_number"] == 1)]
    summary = {"rows": int(len(df)), "races": int(df["race_id"].nunique()),
               "races_ok": int(len(ok)),
               "date_range": [str(df["race_date"].min().date()), str(df["race_date"].max().date())],
               "races_ok_by_month": ok["race_date"].dt.strftime("%Y-%m").value_counts().sort_index()
               .to_dict()}
    (D / "dataset_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps({k: summary[k] for k in ("rows", "races", "races_ok", "date_range")},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
