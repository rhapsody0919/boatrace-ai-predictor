"""BOA-635 T0-2: スリット7形×2段の全国の出現率と、2形 AND の件数。

母集団: BOA-271 v16 の layer の行と同じ（scripts/ml/analogy/v16_pool.py の layer_ok）のうち、
st_by_course の6コースがそろうレース（F・出遅れ・欠場の艇がいれば ST が null になるので自然に外れる）。
期間は export の全期間（2019-04〜）と、直近6か月・2026-03〜09（spec の旧表と同じ月）。

データ源: ANALOGY_DATA_DIR（scripts/ml/analogy/export_pool.js の CSV）。v16 の列がそろっていれば
v16_pool.load_races をそのまま使う。そろわない古い export（2026-10-01 版など）では互換の読み込みに落とす:
- 長期: kb_races.payout_3tan が無い → 払戻は NaN（形の判定には使わない）
- 本体: results の actual_course_* が無い → actual_courses.csv から取る。refund_boats が無い → 返還は
  start_timings の is_flying・is_late_start だけで判定。finish_mark が無い → 「欠」は entries・exhibition の is_absent だけ
読み取りだけ。DB には接続しない。

実行: ANALOGY_DATA_DIR=<export の場所> python3 scripts/analysis/past-rate-check/slit-pattern-rates.py
出力: data/analysis/past-rate-check/slit-pattern-rates.json
"""
from __future__ import annotations

import itertools
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(os.environ.get("REPO_ROOT", Path(__file__).resolve().parents[3]))
sys.path.insert(0, str(ROOT / "scripts" / "ml" / "analogy"))

import v16_pool  # noqa: E402
from features import D, KB_END  # noqa: E402
from v16_defs import SLIT_FORMS, entry_type, slit_forms_matrix, st_cent  # noqa: E402

STAGES = {1: {"dent": 5, "kado": 3, "out": 5}, 2: {"dent": 8, "kado": 5, "out": 8}}
OUT = Path(os.environ.get("SLIT_OUT", ROOT / "data" / "analysis" / "past-rate-check" / "slit-pattern-rates.json"))


def forms(c: np.ndarray, dent: int, kado: int, out: int) -> dict[str, np.ndarray]:
    """c は (n,6) の 1/100秒の整数（6艇そろう行だけ）。spec「スリットの判定」と同じ式"""
    inner = c[:, :3]
    return {
        "flat": c.max(1) - c.min(1) <= 6,
        "wall": inner.max(1) - inner.min(1) <= 2,
        "d2": c[:, 1] - np.maximum(c[:, 0], c[:, 2]) >= dent,
        "d3": c[:, 2] - np.maximum(c[:, 1], c[:, 3]) >= dent,
        "kado": inner.min(1) - c[:, 3] >= kado,
        "d1": c[:, 0] - c[:, 1] >= dent,
        "dash": inner.sum(1) - c[:, 3:].sum(1) >= 3 * out,
    }


# ---------------------------------------------------------------- 古い export 用の互換の読み込み

def _read(src: Path, name: str, cols: list[str]) -> pd.DataFrame:
    have = set(pd.read_csv(src / f"{name}.csv", nrows=0).columns)
    return pd.read_csv(src / f"{name}.csv", usecols=[c for c in cols if c in have], low_memory=False,
                       dtype={"race_id": str, "finish_raw": str, "finish_mark": str, "class": str, "grade": str})


def compat_kb(src: Path):
    r = _read(src, "kb_races", ["race_id", "race_date", "venue_code", "race_number", "has_result", "technique",
                                "payout_3tan"])
    if "payout_3tan" not in r:
        r["payout_3tan"] = np.nan
    orig = v16_pool._csv
    v16_pool._csv = lambda s, n, c: r if n == "kb_races" else orig(s, n, c)  # noqa: E731
    try:
        return v16_pool.load_kb_boats(src)
    finally:
        v16_pool._csv = orig


def compat_main(src: Path):
    races = _read(src, "races", ["race_id", "race_date", "venue_code", "race_number", "cancellation_status"])
    res = _read(src, "results", ["race_id", "rank1", "rank2", "rank3", "rank4", "rank5", "rank6", "is_cancelled",
                                 "is_no_race", "race_status", "refund_boats", "winning_technique", "payout_trio"]
                + [f"actual_course_{i}" for i in range(1, 7)])
    if "actual_course_1" not in res:
        ac = pd.read_csv(src / "actual_courses.csv", dtype={"race_id": str})
        res = res.merge(ac, on="race_id", how="left")
    for col, val in (("refund_boats", "[]"), ("payout_trio", np.nan)):
        if col not in res:
            res[col] = val
    st = _read(src, "start_timings", ["race_id", "boat_number", "start_timing", "is_flying", "is_late_start",
                                      "finish_mark"])
    if "finish_mark" not in st:
        st["finish_mark"] = None
    tables = {"races": races, "results": res, "start_timings": st}
    orig = v16_pool._csv
    v16_pool._csv = lambda s, n, c: tables[n] if n in tables else orig(s, n, c)  # noqa: E731
    try:
        return v16_pool.load_main_boats(src)
    finally:
        v16_pool._csv = orig


def load(src: Path) -> tuple[pd.DataFrame, str]:
    try:
        return v16_pool.load_races(src), "v16_pool.load_races（v16 の列がそろう export）"
    except ValueError as e:
        print(f"v16 の列が足りないので互換の読み込みにする: {e}", file=sys.stderr)
    parts = [v16_pool.build_races(*compat_kb(src)), v16_pool.build_races(*compat_main(src))]
    df = pd.concat(parts, ignore_index=True).sort_values("race_id").reset_index(drop=True)
    return df, "互換の読み込み（本体の返還は is_flying・is_late_start のみ、実進入は actual_courses.csv）"


# ---------------------------------------------------------------- 集計

def summarize(c: np.ndarray) -> dict:
    n = len(c)
    out = {"n": n, "stages": {}}
    for s, p in STAGES.items():
        f = forms(c, **p)
        single = {k: {"count": int(v.sum()), "rate": round(float(v.mean()) * 100, 2) if n else None}
                  for k, v in f.items()}
        pairs = {}
        for a, b in itertools.combinations(SLIT_FORMS, 2):
            both = int((f[a] & f[b]).sum())
            pairs[f"{a}+{b}"] = {"count": both, "rate": round(both / n * 100, 3) if n else None}
        out["stages"][str(s)] = {"single": single, "pairs": pairs}
    return out


def main() -> None:
    df, how = load(D)
    df["race_date"] = pd.to_datetime(df["race_date"])
    st = np.array([[np.nan if v is None else v for v in row] for row in df["st_by_course"]], dtype=float)
    six = ~np.isnan(st).any(axis=1)
    c_all = st_cent(np.nan_to_num(st))

    # 1段目が共用の実装（v16_defs.slit_forms_matrix）と一致するか
    ref = slit_forms_matrix(st[six])
    mine = forms(c_all[six], **STAGES[1])
    for k in SLIT_FORMS:
        assert (ref[k] == mine[k]).all(), f"1段目の {k} が v16_defs と一致しない"

    last = df["race_date"].max()
    end6 = (last.to_period("M") - 1).to_timestamp(how="end")  # 最後の完全な月の末
    start6 = (end6.to_period("M") - 5).to_timestamp()
    waku = df["course_by_boat"].map(lambda cb: entry_type(cb) == "waku").to_numpy()
    scopes = {
        "layer_all": ("layer_ok・全期間", df["layer_ok"].to_numpy()),
        "layer_6m": (f"layer_ok・{start6:%Y-%m}〜{end6:%Y-%m}",
                     df["layer_ok"].to_numpy() & (df["race_date"] >= start6).to_numpy()
                     & (df["race_date"] <= end6).to_numpy()),
        "layer_2603_09": ("layer_ok・2026-03〜09（spec の旧表と同じ月）",
                          df["layer_ok"].to_numpy() & (df["race_date"] >= "2026-03-01").to_numpy()
                          & (df["race_date"] <= "2026-09-30").to_numpy()),
        "tab3_waku_all": ("tab3_ok・枠なり・全期間（dent-max.md との照合用）", df["tab3_ok"].to_numpy() & waku),
    }
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_dir": str(D), "loader": how,
        "date_range": [f"{df['race_date'].min():%Y-%m-%d}", f"{last:%Y-%m-%d}"],
        "kb_end": f"{KB_END:%Y-%m-%d}", "stages_def": STAGES, "scopes": {},
    }
    for key, (label, m) in scopes.items():
        sel = m & six
        r = summarize(c_all[sel])
        d = df.loc[sel, "race_date"]
        r.update({"label": label, "n_scope": int(m.sum()), "n_excluded_st": int((m & ~six).sum()),
                  "period": [f"{d.min():%Y-%m-%d}", f"{d.max():%Y-%m-%d}"]})
        result["scopes"][key] = r
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(json.dumps({k: {"n": v["n"], "n_scope": v["n_scope"], "period": v["period"],
                          **{f"s{s}": {f: x["rate"] for f, x in v["stages"][s]["single"].items()} for s in "12"}}
                      for k, v in result["scopes"].items()}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
