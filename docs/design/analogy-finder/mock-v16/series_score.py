"""BOA-271 v16 タブ①の材料「今節の得点率」（series_score）を、全レース・全艇について数える。

定義（series-score.md に詳細）:
  同じ選手が、同じ会場の同じ節で、そのレースより前（日付→レース番号の順）に走ったレースの着順点の平均。
  着順点は 1着10・2着8・3着6・4着4・5着2・6着1（種別による特別配点・準優/優勝戦の除外はしない）。
  F・L・失格（S0/S1/S2: 転覆・落水・妨害失格など）・着順が付かない完走外は 0点で回数に入れる。
  欠場（K0/K1・出走表の is_absent）、結果の無いレース（中止・不成立）、着順コード不明（"00"）は数えない。
  節: race_series（会場・開始日〜終了日）。そこに無い日は、選手ごとに「同じ会場・前走から4日以内・
  series_day が減っていない」で続きとみなす（フォールバック）。
出力: tab1/series_score.npz（race_id×6艇の value・n_prior）と、全走の行（parquet 代わりに pkl）
"""
from __future__ import annotations
from pathlib import Path
import numpy as np, pandas as pd

HERE = Path(__file__).resolve().parent
D = HERE.parent / "model-prep" / "data"
KB_END = pd.Timestamp("2025-12-02")
PTS = {1: 10, 2: 8, 3: 6, 4: 4, 5: 2, 6: 1}


def rid_int(s: pd.Series) -> pd.Series:
    return s.str.replace("-", "", regex=False).astype("int64")


def load_kb() -> pd.DataFrame:
    b = pd.read_csv(D / "kb_boats.csv", usecols=["race_id", "boat_number", "racer_id", "finish_raw"],
                    dtype={"finish_raw": str}, low_memory=False)
    r = pd.read_csv(D / "kb_races.csv", usecols=["race_id", "venue_day_id", "race_date", "venue_code",
                                                 "race_number", "has_result"])
    vd = pd.read_csv(D / "kb_venue_days.csv", usecols=["venue_day_id", "series_day"])
    r = r.merge(vd, on="venue_day_id", how="left")
    r["race_date"] = pd.to_datetime(r["race_date"])
    r = r[r["race_date"] <= KB_END]
    df = b.merge(r, on="race_id", how="inner")
    fr = df["finish_raw"].fillna("")
    has = df["has_result"].astype(str).str.lower() == "true"
    pos = pd.to_numeric(fr, errors="coerce")
    finished = pos.between(1, 6)
    zero = fr.isin(["F", "L0", "L1", "S0", "S1", "S2"])
    df["kind"] = np.select([~has | (fr == ""), finished, zero, fr.str.startswith("K")],
                           ["no_result", "finish", "zero", "absent"], "unknown")
    df["pos"] = pos.where(finished)
    df["code"] = fr
    return df[["race_id", "race_date", "venue_code", "race_number", "series_day", "boat_number",
               "racer_id", "kind", "pos", "code"]]


def load_main() -> pd.DataFrame:
    races = pd.read_csv(D / "races.csv")
    races["race_date"] = pd.to_datetime(races["race_date"])
    races = races[races["race_date"] > KB_END]
    ent = pd.read_csv(D / "entries.csv", usecols=["race_id", "boat_number", "racer_id", "is_absent"])
    exh = pd.read_csv(D / "exhibition.csv", usecols=["race_id", "boat_number", "is_absent"]).rename(
        columns={"is_absent": "exh_absent"})
    res = pd.read_csv(D / "results.csv")
    st = pd.read_csv(D / "start_timings.csv", usecols=["race_id", "boat_number", "is_flying", "is_late_start"])
    cond = pd.read_csv(D / "conditions.csv", usecols=["race_id", "series_day"])
    df = (ent.merge(races, on="race_id", how="inner")
          .merge(exh, on=["race_id", "boat_number"], how="left")
          .merge(res, on="race_id", how="left")
          .merge(st, on=["race_id", "boat_number"], how="left")
          .merge(cond, on="race_id", how="left"))
    t = lambda s: s.astype(str).str.lower() == "true"
    pos = pd.Series(np.nan, index=df.index)
    for k in range(1, 7):
        pos = pos.where(df[f"rank{k}"] != df["boat_number"], k)
    cancelled = df["cancellation_status"].notna() & (df["cancellation_status"].astype(str) != "")
    has = df["rank1"].notna() & ~t(df["is_cancelled"]) & ~t(df["is_no_race"]) & ~cancelled
    absent = t(df["is_absent"]) | t(df["exh_absent"])
    df["kind"] = np.select([~has, absent, pos.notna()], ["no_result", "absent", "finish"], "zero")
    df["pos"] = pos
    df["code"] = np.select([t(df["is_flying"]), t(df["is_late_start"])], ["F", "L"], "")
    return df[["race_id", "race_date", "venue_code", "race_number", "series_day", "boat_number",
               "racer_id", "kind", "pos", "code"]]


def assign_series(df: pd.DataFrame) -> pd.DataFrame:
    rs = pd.read_csv(D / "race_series.csv")
    rs["start_date"] = pd.to_datetime(rs["start_date"]); rs["end_date"] = pd.to_datetime(rs["end_date"])
    rs = rs.reset_index().rename(columns={"index": "sid"})
    keys = df[["venue_code", "race_date"]].drop_duplicates()
    m = keys.merge(rs, on="venue_code")
    m = m[(m["race_date"] >= m["start_date"]) & (m["race_date"] <= m["end_date"])]
    dup = m.duplicated(["venue_code", "race_date"], keep=False)
    print("race_series が重なる会場×日:", int(dup.sum()))
    m = m.sort_values("start_date").drop_duplicates(["venue_code", "race_date"], keep="last")
    df = df.merge(m[["venue_code", "race_date", "sid"]], on=["venue_code", "race_date"], how="left")
    print("race_series に無い会場×日:", int(df.loc[df["sid"].isna(), ["venue_code", "race_date"]].drop_duplicates().shape[0]))
    # フォールバック: 選手ごとの続き（同じ会場・前走から4日以内・series_day が減っていない）
    df = df.sort_values(["racer_id", "race_date", "race_number"]).reset_index(drop=True)
    g = df.groupby("racer_id", sort=False)
    pv = g["venue_code"].shift(); pdt = g["race_date"].shift(); psd = g["series_day"].shift()
    new = (pv != df["venue_code"]) | ((df["race_date"] - pdt).dt.days > 4) | (
        (df["race_date"] != pdt) & (df["series_day"] < psd))
    df["run_id"] = new.cumsum()
    fb_sid = -1 - df["run_id"]
    df["series_key"] = np.where(df["sid"].notna(), df["sid"], fb_sid).astype("int64")
    # 照合: race_series の節と選手の続きの食い違い（同じ race_series の節が選手の中で2つの続きに割れる等）
    both = df[df["sid"].notna()]
    split = both.groupby(["racer_id", "sid"])["run_id"].nunique()
    merge_ = both.groupby(["racer_id", "run_id"])["sid"].nunique()
    print("race_series の1節が選手の続き2つ以上に割れる組:", int((split > 1).sum()), "/", len(split))
    print("選手の続き1つが race_series の2節以上にまたがる組:", int((merge_ > 1).sum()), "/", len(merge_))
    return df


def compute() -> pd.DataFrame:
    df = pd.concat([load_kb(), load_main()], ignore_index=True)
    df["race_id"] = rid_int(df["race_id"])
    print("行の種類:", df["kind"].value_counts().to_dict())
    df = assign_series(df)
    run = df["kind"].isin(["finish", "zero"])
    df["pts"] = np.where(df["kind"] == "finish", df["pos"].map(PTS), 0.0)
    df["cnt"] = run.astype(int)
    df.loc[~run, "pts"] = 0.0
    df = df.sort_values(["racer_id", "series_key", "race_date", "race_number"]).reset_index(drop=True)
    g = df.groupby(["racer_id", "series_key"], sort=False)
    # そのレースより前の合計（自分のレースは含めない）
    df["prior_pts"] = g["pts"].cumsum() - df["pts"]
    df["prior_n"] = g["cnt"].cumsum() - df["cnt"]
    df["value"] = np.where(df["prior_n"] > 0, df["prior_pts"] / df["prior_n"].where(df["prior_n"] > 0), np.nan)
    return df


if __name__ == "__main__":
    df = compute()
    df.to_pickle(HERE / "series_score_rows.pkl")
    print(df.shape)
