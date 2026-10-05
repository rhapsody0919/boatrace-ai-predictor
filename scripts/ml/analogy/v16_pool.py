"""BOA-271 v16: 過去レースの結果の行（BOA-635 の layer の行・展開シナリオの母集団）。

export_pool.js の CSV（長期 kb_*・本体）から、レースごとに1行を作る。値の約束は plan「BOA-635 との接続」の D-1〜D-5:
- D-1 payout_3tan は3連単の払戻（本体 race_results.payout_trio は列名と券種が逆、長期 kb_archive_races.payout_3tan）
- D-2 F・出遅れ・欠場の艇の ST は null（st_by_course の該当コース）
- D-3 不成立・特払いの払戻は null（DB の null をそのまま使う。艇の値で埋めない）
- D-4 実進入が分からない艇の course_by_boat は null（艇番で埋めない）
- D-5 1〜3着に返還艇が入るレースと不成立のレースは layer の行に入れない（layer_ok）

返還の判定（T1-3 の事前登録と同じ）: 本体は is_flying・is_late_start・finish_mark が F・L・欠・refund_boats のどれか。
長期は finish_raw が F・L0・L1 か is_flying・is_late_start（K0・K1 は出走前の欠場で、返還ではなく欠場として扱う）。
事故の転・落・妨は返還ではない。

展開シナリオ（タブ3）の母集団 tab3_ok は T1-3 の版A（entry-slit/prep9 の SQL と同じ）: 6艇・欠場なし・1着が1艇・
2着3着あり・返還艇なし・6艇の実進入が 1〜6 で分かる。
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from features import D, KB_END, _bool

TECHNIQUES = ("逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ")


def _csv(src: Path, name: str, cols: list[str]) -> pd.DataFrame:
    path = src / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} がありません。先に export_pool.js を実行してください")
    missing = set(cols) - set(pd.read_csv(path, nrows=0).columns)
    if missing:
        raise ValueError(f"{path} に列 {sorted(missing)} がありません（v16 の列を足す前の export_pool.js の出力）")
    return pd.read_csv(path, usecols=cols, low_memory=False,
                       dtype={"race_id": str, "finish_raw": str, "finish_mark": str, "class": str, "grade": str})


def _technique(s: pd.Series) -> pd.Series:
    return s.where(s.isin(TECHNIQUES))


def load_kb_boats(src: Path = D) -> tuple[pd.DataFrame, pd.DataFrame]:
    """長期（〜2025-12-02、has_result のレース）の艇の行とレースの行"""
    r = _csv(src, "kb_races", ["race_id", "race_date", "venue_code", "race_number", "has_result", "technique",
                               "payout_3tan"])
    r = r[_bool(r["has_result"]) & (pd.to_datetime(r["race_date"]) <= KB_END)]
    races = pd.DataFrame({"race_id": r["race_id"], "race_date": r["race_date"], "venue_code": r["venue_code"],
                          "race_number": r["race_number"], "winning_technique": _technique(r["technique"]),
                          "payout_3tan": pd.to_numeric(r["payout_3tan"], errors="coerce")})
    b = _csv(src, "kb_boats", ["race_id", "boat_number", "racer_id", "class", "course", "start_timing", "is_flying",
                               "is_late_start", "finish_raw", "finish_rank"])
    b = b.merge(races[["race_id", "race_date", "venue_code", "race_number"]], on="race_id", how="inner")
    fr = b["finish_raw"]
    returned = fr.isin(["F", "L0", "L1"]) | _bool(b["is_flying"]) | _bool(b["is_late_start"])
    absent = (fr.isna() | fr.str.startswith("K", na=False)) & ~returned
    boats = pd.DataFrame({
        "race_id": b["race_id"], "race_date": b["race_date"], "venue_code": b["venue_code"],
        "race_number": b["race_number"], "racer_id": b["racer_id"],
        "boat_number": b["boat_number"].astype(int), "cls": b["class"],
        "course": pd.to_numeric(b["course"], errors="coerce"),
        "st": pd.to_numeric(b["start_timing"], errors="coerce"),
        "finish_rank": pd.to_numeric(b["finish_rank"], errors="coerce").where(~returned & ~absent),
        "absent": absent, "returned": returned,
        "_raw_rank": pd.to_numeric(b["finish_rank"], errors="coerce"),
    })
    return boats, races


def load_main_boats(src: Path = D) -> tuple[pd.DataFrame, pd.DataFrame]:
    """本体（2025-12-03〜）の艇の行とレースの行。中止・順延・不成立のレースは入れない"""
    races = _csv(src, "races", ["race_id", "race_date", "venue_code", "race_number", "cancellation_status"])
    res = _csv(src, "results", ["race_id", "rank1", "rank2", "rank3", "rank4", "rank5", "rank6", "is_cancelled",
                                "is_no_race", "race_status", "refund_boats", "winning_technique", "payout_trio"]
               + [f"actual_course_{i}" for i in range(1, 7)])
    races = races[(pd.to_datetime(races["race_date"]) > KB_END) & races["cancellation_status"].isna()]
    res = res[res["rank1"].notna() & ~_bool(res["is_cancelled"]) & ~_bool(res["is_no_race"])
              & res["race_status"].ne("no_race")]
    rr = races.drop(columns="cancellation_status").merge(res, on="race_id", how="inner")
    e = _csv(src, "entries", ["race_id", "boat_number", "racer_id", "grade", "is_absent"])
    x = _csv(src, "exhibition", ["race_id", "boat_number", "is_absent"]).rename(columns={"is_absent": "x_absent"})
    st = _csv(src, "start_timings", ["race_id", "boat_number", "start_timing", "is_flying", "is_late_start",
                                     "finish_mark"])
    e = (e.merge(rr, on="race_id", how="inner")
          .merge(x, on=["race_id", "boat_number"], how="left")
          .merge(st, on=["race_id", "boat_number"], how="left"))
    bn = e["boat_number"].astype(int).to_numpy()
    ranks = e[[f"rank{k}" for k in range(1, 7)]].to_numpy(dtype=float)
    hit = ranks == bn[:, None]
    raw_rank = np.where(hit.any(axis=1), hit.argmax(axis=1) + 1, np.nan)
    course = e[[f"actual_course_{i}" for i in range(1, 7)]].to_numpy(dtype=float)[np.arange(len(e)), bn - 1]
    refund = e["refund_boats"].fillna("[]").map(json.loads)
    in_refund = np.array([b in rb for b, rb in zip(bn, refund)], dtype=bool)
    fm = e["finish_mark"]
    returned = (_bool(e["is_flying"]) | _bool(e["is_late_start"]) | fm.isin(["F", "L", "欠"])).to_numpy() | in_refund
    absent = (_bool(e["is_absent"]) | _bool(e["x_absent"])).to_numpy()
    boats = pd.DataFrame({
        "race_id": e["race_id"], "race_date": e["race_date"], "venue_code": e["venue_code"],
        "race_number": e["race_number"], "racer_id": e["racer_id"],
        "boat_number": bn, "cls": e["grade"], "course": course,
        "st": pd.to_numeric(e["start_timing"], errors="coerce"),
        "finish_rank": np.where(returned | absent, np.nan, raw_rank),
        "absent": absent, "returned": returned, "_raw_rank": raw_rank,
    })
    out_races = pd.DataFrame({"race_id": rr["race_id"], "race_date": rr["race_date"],
                              "venue_code": rr["venue_code"], "race_number": rr["race_number"],
                              "winning_technique": _technique(rr["winning_technique"]),
                              "payout_3tan": pd.to_numeric(rr["payout_trio"], errors="coerce")})
    return boats, out_races


def build_races(boats: pd.DataFrame, races: pd.DataFrame) -> pd.DataFrame:
    """艇の行 → レースの行（layer の行の値・layer_ok・tab3_ok）"""
    b = boats.sort_values(["race_id", "boat_number"]).reset_index(drop=True)
    rid = b["race_id"]
    g = b.groupby("race_id", sort=True)
    returned_top3 = (b["returned"] & (b["_raw_rank"] <= 3)).groupby(rid).any()
    agg = pd.DataFrame({
        "n_boats": g.size(), "has_absent": g["absent"].any(), "n_ret": g["returned"].sum(),
        "returned_top3": returned_top3,
        "n_win": (b["finish_rank"] == 1).groupby(rid).sum(),
        "has_r2": (b["finish_rank"] == 2).groupby(rid).any(),
        "has_r3": (b["finish_rank"] == 3).groupby(rid).any(),
        "all_a1": b["cls"].eq("A1").groupby(rid).all() & (g.size() == 6),
    })
    # 1〜3着の艇番は、着のある艇を (着, 艇番) の順に並べた先頭3艇。長期の同着は着を 1,1,3 と付けるので、
    # 「着が k の艇」で引くと2着が欠ける。本体の rank1..6 は同着も順に並べている（同じ結果になる）
    placed = b[b["finish_rank"].notna()].sort_values(["race_id", "finish_rank", "boat_number"])
    pos = placed.groupby("race_id", sort=False).cumcount()
    for k in (1, 2, 3):
        hit = placed[pos == k - 1]
        agg[f"rank{k}"] = hit.set_index("race_id")["boat_number"].reindex(agg.index).astype("Int64")

    # D-4: 実進入が分からない艇は null。D-2: 返還・欠場の艇の ST は null。艇番×レースの (n,6) に並べる
    wide = lambda col: (b.pivot(index="race_id", columns="boat_number", values=col)  # noqa: E731
                        .reindex(index=agg.index, columns=range(1, 7)).to_numpy(dtype=float, copy=True))
    course = wide("course")
    course[(course < 1) | (course > 6)] = np.nan
    st = wide("st")
    st[(wide("returned") == 1) | (wide("absent") == 1)] = np.nan
    cnt = np.stack([(course == c).sum(axis=1) for c in range(1, 7)], axis=1)
    r, bo = np.nonzero(~np.isnan(course))
    ci = course[r, bo].astype(int) - 1
    keep = (cnt[r, ci] == 1) & ~np.isnan(st[r, bo])
    by_course = np.full(course.shape, np.nan)
    by_course[r[keep], ci[keep]] = np.round(st[r[keep], bo[keep]], 2)
    to_list = lambda a, f: [[None if np.isnan(v) else f(v) for v in row] for row in a]  # noqa: E731
    agg["course_by_boat"] = to_list(course, int)
    agg["st_by_course"] = to_list(by_course, float)
    agg["course_known"] = (np.sort(np.nan_to_num(course), axis=1) == np.arange(1, 7)).all(axis=1)

    out = races.set_index("race_id")[["race_date", "venue_code", "race_number", "winning_technique", "payout_3tan"]].join(
        agg, how="inner")
    # D-5（不成立は load_* で除いた）
    out["layer_ok"] = ~out["returned_top3"] & out["rank1"].notna() & out["rank2"].notna() & out["rank3"].notna()
    out["tab3_ok"] = ((out["n_boats"] == 6) & ~out["has_absent"] & ~out["returned_top3"] & (out["n_win"] == 1)
                      & out["has_r2"] & out["has_r3"] & (out["n_ret"] == 0) & out["course_known"])
    return out.reset_index().rename(columns={"index": "race_id"})


def load_races(src: Path = D) -> pd.DataFrame:
    parts = [build_races(*load_kb_boats(src)), build_races(*load_main_boats(src))]
    return pd.concat(parts, ignore_index=True).sort_values("race_id").reset_index(drop=True)


def layer_row(r: pd.Series) -> dict:
    """layer ファイルの rows の1行（plan「layer ファイル」）。layer_ok のレースだけに使う"""
    nul = lambda v: None if pd.isna(v) else v  # noqa: E731
    return {
        "race_id": r["race_id"], "race_date": str(r["race_date"])[:10],
        "rank1": int(r["rank1"]), "rank2": int(r["rank2"]), "rank3": int(r["rank3"]),
        "winning_technique": nul(r["winning_technique"]),
        "course_by_boat": list(r["course_by_boat"]), "st_by_course": list(r["st_by_course"]),
        "payout_3tan": None if pd.isna(r["payout_3tan"]) else int(r["payout_3tan"]),
    }


def load_exhibition_layout(src: Path = D) -> pd.DataFrame:
    """本体の展示の進入と展示 ST（レースごと）: race_id・exh_course_by_boat（艇番順）・exh_st_by_course（コース順、F は負、
    出遅れ・欠場・欠けは null）。展示→本番の一致率（spec C-1・C-3 の注記）に使う。6艇の展示の進入がそろうレースだけ"""
    x = _csv(src, "exhibition", ["race_id", "boat_number", "exhibition_course", "start_timing", "start_flag",
                                 "is_absent"])
    x = x[~_bool(x["is_absent"])]
    course = x.pivot(index="race_id", columns="boat_number", values="exhibition_course").reindex(columns=range(1, 7))
    st = pd.to_numeric(x["start_timing"], errors="coerce")
    # F は負、出遅れ（L）は欠け（展示の形を判定しない。Q-F6）
    x = x.assign(_st=np.where(x["start_flag"].eq("F"), -st.abs(), np.where(x["start_flag"].eq("L"), np.nan, st)))
    stw = x.pivot(index="race_id", columns="boat_number", values="_st").reindex(columns=range(1, 7))
    c = course.to_numpy(dtype=float)
    ok = (np.sort(np.nan_to_num(c), axis=1) == np.arange(1, 7)).all(axis=1)
    c, s, ids = c[ok], stw.to_numpy(dtype=float)[ok], course.index[ok]
    by_course = np.full(c.shape, np.nan)
    rows = np.arange(len(c))[:, None]
    by_course[rows, c.astype(int) - 1] = s
    return pd.DataFrame({"race_id": ids,
                         "exh_course_by_boat": [[int(v) for v in row] for row in c],
                         "exh_st_by_course": [[None if np.isnan(v) else round(float(v), 2) for v in row]
                                              for row in by_course]})
