"""BOA-845 共通: 母集団（pool.pkl、タブ3の母集団と同じ条件）と、範囲ごとの「軸の艇が1着のときの2着・3着」の数え方。
範囲の定義は scripts/ml/analogy/v16_defs.scope_keys・v16_morning.scope_masks と同じ:
VC=会場×構成×その艇の級、NC=構成×その艇の級、NCR=NC×節（準優・優勝戦のみ）、VA=会場、NA=全国。
足した候補: NB=全国×その艇の級（構成なし）、VB=会場×その艇の級

パス:
  中間データ（pool.pkl・today.json・*.pkl）: 環境変数 BOA845_WORK_DIR（既定 data/analysis/boa845-axis-place/work、gitignore）
  結果の JSON: data/analysis/boa845-axis-place/
"""
from pathlib import Path
import datetime as dt
import json
import os
import sys
import numpy as np, pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT_DIR = ROOT / "data" / "analysis" / "boa845-axis-place"
WORK = Path(os.environ.get("BOA845_WORK_DIR", OUT_DIR / "work"))
ANALOGY_CODE = ROOT / "scripts" / "ml" / "analogy"
if str(ANALOGY_CODE) not in sys.path:
    sys.path.insert(0, str(ANALOGY_CODE))
CUT = pd.Timestamp("2026-03-31")  # 時系列の検証: 学習は〜この日、検証はこの翌日〜
CL = ("A1", "A2", "B1", "B2")


def combo_of(cls_row):
    if any(c not in CL for c in cls_row):
        return None
    return "-".join(str(sum(c == k for c in cls_row)) for k in CL)


def load_pool():
    p = pd.read_pickle(WORK / "pool.pkl")
    cls = p[[f"c{i}" for i in range(1, 7)]].to_numpy(dtype=object)
    p["combo"] = [combo_of(r) for r in cls]
    p = p[p["combo"].notna()].copy()
    cls = p[[f"c{i}" for i in range(1, 7)]].to_numpy(dtype=object)
    p["cw"] = cls[np.arange(len(p)), p["rank1"].to_numpy() - 1]  # 1着の艇の級
    p["race_date"] = pd.to_datetime(p["race_date"])
    p["venue_code"] = p["venue_code"].astype(int)
    return p


# 範囲 → 軸（1着の艇 w）でまとめるときのキー列。w の級は cw、1号艇の級は c1
COND_KEYS = {
    "own_VC": ["venue_code", "combo", "rank1", "cw"],
    "own_NC": ["combo", "rank1", "cw"],
    "own_NCR": ["combo", "rank1", "cw", "round"],
    "b1_VC": ["venue_code", "combo", "c1", "rank1"],
    "b1_NC": ["combo", "c1", "rank1"],
    "NB": ["rank1", "cw"],
    "VB": ["venue_code", "rank1", "cw"],
    "VA": ["venue_code", "rank1"],
    "NA": ["rank1"],
}


def cond_table(p, cols):
    """key → (n, c2[6], c3[6])：範囲∧1着=w のレースの件数と、2着・3着の艇の件数"""
    out = {}
    for k, g in p.groupby(cols, sort=False):
        c2 = np.bincount(g["rank2"].to_numpy(), minlength=7)[1:]
        c3 = np.bincount(g["rank3"].to_numpy(), minlength=7)[1:]
        out[k if isinstance(k, tuple) else (k,)] = (len(g), c2, c3)
    return out


def key_for(scope, r, w):
    """今日のレース r（dict: venue_code, combo, c1..c6, round）と軸 w の範囲キー（cond_table のキー）"""
    cw = r[f"c{w}"]
    return {
        "own_VC": (r["venue_code"], r["combo"], w, cw), "own_NC": (r["combo"], w, cw),
        "own_NCR": (r["combo"], w, cw, r["round"]), "b1_VC": (r["venue_code"], r["combo"], r["c1"], w),
        "b1_NC": (r["combo"], r["c1"], w), "NB": (w, cw), "VB": (r["venue_code"], w, cw),
        "VA": (r["venue_code"], w), "NA": (w,),
    }[scope]


def wilson_half(k, n, z=1.96):
    k, n = np.asarray(k, float), np.asarray(n, float)
    with np.errstate(invalid="ignore", divide="ignore"):
        p = k / n
        d = 1 + z * z / n
        h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
        c = (p + z * z / (2 * n)) / d
    return c - h, c + h


def load_today():
    """today.json（fetch_today.mjs の出力）→ (races の DataFrame 用の行, メタ)"""
    from features import round_from_stage
    d = json.load(open(WORK / "today.json"))
    ent = pd.DataFrame(d["entries"]).pivot(index="race_id", columns="boat_number", values="grade")
    cond = {c["race_id"]: c["race_stage"] for c in d["conds"]}
    rows = []
    for r in d["races"]:
        if r["cancellation_status"] is not None:
            continue
        cls = [ent.loc[r["race_id"], b] for b in range(1, 7)]
        rows.append({"race_id": r["race_id"], "venue_code": int(r["venue_code"]), "combo": combo_of(cls),
                     **{f"c{i}": c for i, c in enumerate(cls, 1)}, "round": round_from_stage(cond.get(r["race_id"]))})
    meta = {k: d.get(k) for k in ("from", "to", "fetched_at")}
    meta["races_fetched"] = len(d["races"])
    return rows, meta


def pool_meta(p):
    return {"races": int(len(p)), "from": str(p["race_date"].min().date()), "to": str(p["race_date"].max().date()),
            "source": "scripts/ml/analogy/export_pool.js → features.py の boats.pkl と races/results 等の CSV（2026-10-01 時点の書き出し）"}


def _jsonable(o):
    if isinstance(o, dict):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, np.ndarray)):
        return [_jsonable(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if np.isnan(o) else round(float(o), 6)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, pd.DataFrame):
        return _jsonable(o.to_dict(orient="index"))
    if isinstance(o, pd.Series):
        return _jsonable(o.to_dict())
    return o


def dump(name, obj):
    """結果を data/analysis/boa845-axis-place/{name}.json に書く（generated_at を足す）"""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    body = {"generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(timespec="seconds"), **obj}
    (OUT_DIR / f"{name}.json").write_text(json.dumps(_jsonable(body), ensure_ascii=False, indent=1) + "\n")
