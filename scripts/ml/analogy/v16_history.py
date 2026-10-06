"""BOA-271 v16: 選手の履歴から作る値（tasks T2-1。plan「定義」の「今節の平均着順点（前日まで）」「コース別の平均ST」）。

どちらも「前日まで」（同じ日の前の走を含めない。spec Q6、ほかの項目の as-of と同じ）。

今節の平均着順点（mock-v16/series-score.md・series_score.py を前日までに直したもの）:
- 着順点 1着10・2着8・3着6・4着4・5着2・6着1。種別による特別配点・準優/優勝戦の除外はしない
- F・L・失格（S0/S1/S2: 転覆・落水・妨害失格など）・本体で結果があるのに着順に載らない艇は 0点で回数に入れる
- 欠場（K0/K1・is_absent）、結果の無いレース（中止・不成立）、着順コード不明は数えない
- 節は race_series（会場・開始日〜終了日、重なれば開始日が新しいほう）。無い日は、選手ごとに「同じ会場・前走から
  4日以内・日付が変わっても series_day が減っていない」で続きとみなす

コース別の平均ST（slit-hint/build2.py・slitpred2.md の C）: 選手×コースの直近30走。コースが分かるのは枠なりの
レースの走だけ（枠なりは実進入で判定する。分析は K ファイルの枠なりの印を使っていたので、件数がわずかに違う）。
F・出遅れの走（features.py の is_flying・is_late）は平均から除き、窓には数える。窓に入れる走の集合は features.py の
st_mean30 と同じ（欠場の行も含む）。n は窓の中の F・出遅れでない走の数。5走未満の埋め方は v16_defs.fill_course_st。
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from features import D, KB_END, _bool, rid_to_int

PTS = {1: 10, 2: 8, 3: 6, 4: 4, 5: 2, 6: 1}
WINDOW = 30
ZERO_CODES = ("F", "L0", "L1", "S0", "S1", "S2")


# ---------------------------------------------------------------- 今節の平均着順点
def _read(src: Path, name: str, cols: list[str]) -> pd.DataFrame:
    return pd.read_csv(src / f"{name}.csv", usecols=cols, low_memory=False,
                       dtype={"race_id": str, "finish_raw": str})


def series_runs(src: Path = D) -> pd.DataFrame:
    """全走の行: racer_id・race_id・race_date・venue_code・race_number・series_day・boat_number・kind・pos。
    kind は finish（着あり）／zero（0点で数える）／absent／no_result／unknown"""
    b = _read(src, "kb_boats", ["race_id", "boat_number", "racer_id", "finish_raw"])
    r = _read(src, "kb_races", ["race_id", "venue_day_id", "race_date", "venue_code", "race_number", "has_result"])
    vd = pd.read_csv(src / "kb_venue_days.csv", usecols=["venue_day_id", "series_day"])
    r = r.merge(vd, on="venue_day_id", how="left")
    r["race_date"] = pd.to_datetime(r["race_date"])
    kb = b.merge(r[r["race_date"] <= KB_END], on="race_id", how="inner")
    fr = kb["finish_raw"].fillna("")
    pos = pd.to_numeric(fr, errors="coerce")
    finished = pos.between(1, 6)
    kb["kind"] = np.select([~_bool(kb["has_result"]) | (fr == ""), finished, fr.isin(ZERO_CODES),
                            fr.str.startswith("K")], ["no_result", "finish", "zero", "absent"], "unknown")
    kb["pos"] = pos.where(finished)

    races = _read(src, "races", ["race_id", "race_date", "venue_code", "race_number", "cancellation_status"])
    races["race_date"] = pd.to_datetime(races["race_date"])
    races = races[races["race_date"] > KB_END]
    ent = _read(src, "entries", ["race_id", "boat_number", "racer_id", "is_absent"])
    exh = _read(src, "exhibition", ["race_id", "boat_number", "is_absent"]).rename(columns={"is_absent": "x_absent"})
    res = _read(src, "results", ["race_id", "is_cancelled", "is_no_race", "race_status"]
                + [f"rank{k}" for k in range(1, 7)])
    cond = _read(src, "conditions", ["race_id", "series_day"])
    m = (ent.merge(races, on="race_id", how="inner").merge(exh, on=["race_id", "boat_number"], how="left")
         .merge(res, on="race_id", how="left").merge(cond, on="race_id", how="left"))
    mpos = pd.Series(np.nan, index=m.index)
    for k in range(1, 7):
        mpos = mpos.where(m[f"rank{k}"] != m["boat_number"], k)
    has = (m["rank1"].notna() & ~_bool(m["is_cancelled"]) & ~_bool(m["is_no_race"])
           & m["race_status"].ne("no_race") & m["cancellation_status"].isna())
    absent = _bool(m["is_absent"]) | _bool(m["x_absent"])
    m["kind"] = np.select([~has, absent, mpos.notna()], ["no_result", "absent", "finish"], "zero")
    m["pos"] = mpos
    cols = ["racer_id", "race_id", "race_date", "venue_code", "race_number", "series_day", "boat_number", "kind",
            "pos"]
    return pd.concat([kb[cols], m[cols]], ignore_index=True)


def assign_series(runs: pd.DataFrame, race_series: pd.DataFrame) -> pd.DataFrame:
    """series_key（race_series の行番号、無い日は選手ごとの続きの負の番号）を付ける"""
    rs = race_series.copy()
    rs["start_date"] = pd.to_datetime(rs["start_date"])
    rs["end_date"] = pd.to_datetime(rs["end_date"])
    rs = rs.reset_index().rename(columns={"index": "sid"})
    keys = runs[["venue_code", "race_date"]].drop_duplicates()
    m = keys.merge(rs, on="venue_code")
    m = m[(m["race_date"] >= m["start_date"]) & (m["race_date"] <= m["end_date"])]
    m = m.sort_values("start_date").drop_duplicates(["venue_code", "race_date"], keep="last")
    df = runs.merge(m[["venue_code", "race_date", "sid"]], on=["venue_code", "race_date"], how="left")
    df = df.sort_values(["racer_id", "race_date", "race_number"]).reset_index(drop=True)
    g = df.groupby("racer_id", sort=False)
    pv, pdt, psd = g["venue_code"].shift(), g["race_date"].shift(), g["series_day"].shift()
    new = ((pv != df["venue_code"]) | ((df["race_date"] - pdt).dt.days > 4)
           | ((df["race_date"] != pdt) & (df["series_day"] < psd)))
    df["series_key"] = np.where(df["sid"].notna(), df["sid"], -1 - new.cumsum()).astype("int64")
    return df.drop(columns="sid")


def series_score_asof(runs: pd.DataFrame) -> pd.DataFrame:
    """各走に、同じ選手・同じ節の前日までの平均着順点 value と走数 n_prior を付ける（走数0なら value は NaN）"""
    df = runs.copy()
    counted = df["kind"].isin(["finish", "zero"])
    df["_pts"] = np.where(df["kind"] == "finish", df["pos"].map(PTS), 0.0) * counted
    df["_cnt"] = counted.astype(int)
    day = (df.groupby(["racer_id", "series_key", "race_date"], sort=True)[["_pts", "_cnt"]].sum().reset_index())
    g = day.groupby(["racer_id", "series_key"], sort=False)
    day["prior_pts"] = g["_pts"].cumsum() - day["_pts"]
    day["n_prior"] = g["_cnt"].cumsum() - day["_cnt"]
    df = df.drop(columns=["_pts", "_cnt"]).merge(
        day[["racer_id", "series_key", "race_date", "prior_pts", "n_prior"]],
        on=["racer_id", "series_key", "race_date"], how="left")
    df["value"] = df["prior_pts"] / df["n_prior"].where(df["n_prior"] > 0)
    return df.drop(columns="prior_pts")


# ---------------------------------------------------------------- 直近 N 走の平均ST（前日まで）
def rolling_st_asof(hist: pd.DataFrame, targets: pd.DataFrame, keys: list[str],
                    window: int = WINDOW) -> pd.DataFrame:
    """hist（keys・race_date・race_number・st_ok。F・出遅れの走は st_ok が NaN で窓に数える）から、targets の各行
    （keys・race_date）について、race_date より前の日の直近 window 走の st_ok の平均 mean と、窓の中の値のある走数 n。
    走が無ければ mean は NaN・n は0"""
    h = hist.sort_values(keys + ["race_date", "race_number"]).reset_index(drop=True)
    ok = h["st_ok"].notna()
    g = h.groupby(keys, sort=False)
    h["_k"] = g.cumcount()                                    # 群の中の通し番号（0始まり）
    h["_cs"] = h["st_ok"].fillna(0).groupby([h[k] for k in keys], sort=False).cumsum()
    h["_cn"] = ok.astype(int).groupby([h[k] for k in keys], sort=False).cumsum()
    # 前日まで: その日より前の最後の走（同じ日の走は含めない）
    last = h.groupby(keys + ["race_date"], sort=False).tail(1)[keys + ["race_date", "_k", "_cs", "_cn"]]
    t = targets[keys + ["race_date"]].copy()
    for k in keys:  # 例: hist の course は欠損を含むので float
        t[k] = t[k].astype(h[k].dtype)
    t["_row"] = np.arange(len(t))
    t = t.sort_values("race_date")
    last = last.sort_values("race_date")
    m = pd.merge_asof(t, last, on="race_date", by=keys, allow_exact_matches=False)
    # 窓の始まりの1つ前の走（通し番号 k−window）の累積を引く
    m["_j"] = m["_k"] - window
    start = h[keys + ["_k", "_cs", "_cn"]].rename(columns={"_k": "_j", "_cs": "_cs0", "_cn": "_cn0"})
    m = m.merge(start, on=keys + ["_j"], how="left")
    s = m["_cs"] - m["_cs0"].fillna(0)
    n = (m["_cn"] - m["_cn0"].fillna(0)).fillna(0).astype(int)
    m["mean"] = (s / n.where(n > 0)).round(4)
    m["n"] = n
    return m.sort_values("_row").reset_index(drop=True)[["mean", "n"]]


def venue_course_st(hist: pd.DataFrame, venue: int, date) -> dict[str, list]:
    """会場のコース別の全選手の平均ST（前日まで、枠なりの走、F・出遅れを除く。タブ3の手がかりの表「{会場}の全選手」。
    分析 slit-hint/build2.py の E と同じ）。{"mean": [6], "n": [6]}"""
    h = hist[(hist["venue_code"] == venue) & hist["waku"] & (hist["race_date"] < pd.Timestamp(date))
             & hist["st_ok"].notna()]
    g = h.groupby("course")["st_ok"].agg(["mean", "size"])
    return {"mean": [None if c not in g.index else round(float(g.at[c, "mean"]), 4) for c in range(1, 7)],
            "n": [0 if c not in g.index else int(g.at[c, "size"]) for c in range(1, 7)]}


def st_history(rows: pd.DataFrame, races: pd.DataFrame) -> pd.DataFrame:
    """ST の履歴。rows は features.load_kb・load_main を縦につないだ艇の行（窓に入れる走の集合を features.py の
    st_mean30 とそろえる。欠場・結果の無い行も ST が NaN の走として窓に数える）。waku は v16_pool のレースの行の
    実進入で6艇とも枠なりか（実進入が分からないレースは False）"""
    waku = races["course_by_boat"].map(lambda cb: list(cb) == [1, 2, 3, 4, 5, 6])
    waku.index = rid_to_int(races["race_id"]).to_numpy()
    st_ok = rows["st_result"].where(~rows["is_flying"].astype(bool) & ~rows["is_late"].astype(bool))
    return pd.DataFrame({
        "racer_id": rows["racer_id"], "race_id": rows["race_id"], "race_date": pd.to_datetime(rows["race_date"]),
        "race_number": rows["race_number"], "boat_number": rows["boat_number"],
        "venue_code": pd.to_numeric(rows["venue_code"], errors="coerce").astype("float64"),
        "st_ok": pd.to_numeric(st_ok, errors="coerce").astype("float64"),
        "waku": rows["race_id"].map(waku).fillna(False).astype(bool).to_numpy(),
    }).assign(course=lambda d: d["boat_number"].astype("float64").where(d["waku"]))  # 枠なりならコース＝艇番
