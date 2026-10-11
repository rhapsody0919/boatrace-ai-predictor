"""BOA-271 v16 T1-3: 返還レースの除外が展開シナリオ（スリット7形）の割合に与える影響。

事前登録: docs/design/analogy-finder/analysis/t1/preregistration-t1.md（「共通」「T1-3」、レビュー表の指摘1・9・11）、
コミット 238e0bb5a。事前登録は変えずにそのとおり数える。

- 版A（今の定義）: 返還（F・L・発走後の欠場）のあったレースを除く
- 版B: F だけのレースを戻す。F の艇の ST は -abs(ST)。F の艇は着に入らない（着順は返還で無い）
- 返還の判定: 長期 finish_raw が F・L0・L1（K0・K1・空は欠場＝母集団外）。本体 is_flying・is_late_start、
  finish_mark が F・L・欠、race_results.refund_boats
- 形: BOA-635 の7形の1段目（round(ST×100) の整数をコース順に並べて比べる。entry-slit/prep7.md の slit_rule）
- 範囲: 全国（NA）、全国・6艇ともA1、若松・6艇ともA1。2019-04-01〜2026-09-26
- 母集団（完全レース）は entry-slit/prep9/p9b_pool_*.sql と同じ条件（6艇・欠場なし・返還艇が3着以内でない・1着1艇・2着3着あり）

入力: $ANALOGY_SCRATCH/model-prep/data/*.csv（fetch_manifest.json）と、t1_3_refund.mjs が本番 DB から SELECT した
$ANALOGY_SCRATCH/t1/t1_3_*.csv（進入・返還の列）。
出力: docs/design/analogy-finder/analysis/t1/t1-3-refund.json、中間データ $ANALOGY_SCRATCH/t1/t1_3_races.pkl

使い方: ANALOGY_SCRATCH=... $ANALOGY_SCRATCH/model-prep/venv/bin/python scripts/analysis/analogy-finder-t1/t1_3_refund.py
"""
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

SCRATCH = Path(os.environ.get("ANALOGY_SCRATCH") or "")
if not os.environ.get("ANALOGY_SCRATCH"):
    raise SystemExit("ANALOGY_SCRATCH が未設定")
DATA = SCRATCH / "model-prep" / "data"
T1 = SCRATCH / "t1"
REPO = Path(__file__).resolve().parents[3]
OUT_JSON = REPO / "docs/design/analogy-finder/analysis/t1/t1-3-refund.json"

START, KB_END, END = "2019-04-01", "2025-12-02", "2026-09-26"
FORMS = [("flat", "横一線"), ("wall", "内3艇そろう"), ("d2", "2コース凹み"), ("d3", "カド受け凹み"),
         ("kado", "カド一撃"), ("d1", "イン凹み"), ("dash", "ダッシュ勢先行")]
FORM_KEYS = ["any"] + [f for f, _ in FORMS]
SCOPES = {"NA": "全国", "NA_allA1": "全国・6艇ともA1", "v20_allA1": "若松・6艇ともA1"}
MOCK = {"NA_allA1": 24871, "v20_allA1": 1117}  # spec・tasks T1-0b（prep9b の版A の件数）
PREP_REF = {  # prep7・prep9b の除外前の母集団・返還艇あり・対象（進入不明は0）
    "NA": {"n_pool": 408723, "ret": 7480, "n_ok": 401243, "src": "entry-slit/prep7.md 全国"},
    "NA_allA1": {"n_pool": 25282, "ret": 411, "n_ok": 24871, "src": "entry-slit/prep9/prep9b.md 全国×A1"},
    "v20_allA1": {"n_pool": 1134, "ret": 17, "n_ok": 1117, "src": "entry-slit/prep9/prep9b.md 若松×A1"},
}
# 版A の形ごとの件数・1号艇・4号艇の1着数（prep7.md「2 スリット7形」、prep9b.md「全部」の行の一部）。独立経路（本番 DB の SQL）との照合
PREP_FORMS = {
    "NA": {"flat": (57159, 37122, 3240), "kado": (59850, 20208, 17098), "dash": (61173, 19954, 14234)},
    "NA_allA1": {"flat": (5396, 3943, 221), "kado": (3317, 1460, 780), "d1": (2280, 785, 258), "dash": (3053, 1239, 628)},
    "v20_allA1": {"any": (1117, 737, 80), "flat": (271, 203, 10), "kado": (137, 71, 28), "d1": (121, 44, 15), "dash": (123, 55, 22)},
}
THRESH_PT = 2.0
N_BOOT, SEED = 200, 0
Z = 1.959964


def fail(msg):
    raise SystemExit("検査に失敗: " + msg)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def wilson(x, n):
    if n == 0:
        return {"x": int(x), "n": 0, "p": None, "lo": None, "hi": None}
    p = x / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * np.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return {"x": int(x), "n": int(n), "p": round(p, 4), "lo": round(c - h, 4), "hi": round(c + h, 4)}


def to_bool(s):
    return s.map(lambda v: v is True or str(v).strip().lower() == "true").astype(bool)


def forms_of(cst):
    """cst: (n,6) 整数（1/100秒、コース順）。BOA-635 の7形の1段目。形は重なりうる"""
    c = cst
    return {
        "flat": c.max(1) - c.min(1) <= 6,
        "wall": c[:, :3].max(1) - c[:, :3].min(1) <= 2,
        "d2": c[:, 1] - np.minimum(c[:, 0], c[:, 2]) >= 5,
        "d3": c[:, 2] - np.minimum(c[:, 1], c[:, 3]) >= 5,
        "kado": c[:, :3].min(1) - c[:, 3] >= 3,
        "d1": c[:, 0] - c[:, 1] >= 5,
        "dash": c[:, :3].sum(1) - c[:, 3:].sum(1) >= 15,
    }


# ---------- 長期（kb） ----------
def load_kb(inputs):
    p_b, p_r, p_c = DATA / "kb_boats.csv", DATA / "kb_races.csv", T1 / "t1_3_kb_course.csv"
    b = pd.read_csv(p_b, usecols=["race_id", "boat_number", "class", "start_timing", "is_flying", "is_late_start",
                                  "finish_raw", "finish_rank"], dtype={"finish_raw": str, "class": str}, low_memory=False)
    r = pd.read_csv(p_r, usecols=["race_id", "race_date", "venue_code", "has_result"])
    c = pd.read_csv(p_c)
    for p, df in [(p_b, b), (p_r, r), (p_c, c)]:
        inputs[str(p.relative_to(SCRATCH))] = {"rows": len(df), "sha256_file": sha256_file(p)}
    inputs[str(p_r.relative_to(SCRATCH))]["max_date"] = str(r.race_date.max())
    b["is_flying"] = to_bool(b["is_flying"])
    b["is_late_start"] = to_bool(b["is_late_start"])
    r = r[to_bool(r["has_result"]) & (r.race_date >= START) & (r.race_date <= KB_END)]
    b = b.merge(r[["race_id", "race_date", "venue_code"]], on="race_id", how="inner")
    nb = len(b)
    b = b.merge(c, on=["race_id", "boat_number"], how="left")
    if len(b) != nb:
        fail("kb_course の結合で行数が変わった")
    fr = b["finish_raw"]
    b["absent"] = fr.isna() | fr.str.startswith("K", na=False)
    b["is_F"] = fr.eq("F")
    b["is_L"] = fr.isin(["L0", "L1"])
    b["ret_other"] = False  # 長期は発走後の欠場の判定コードが無い（K0・K1 は出走前の欠場とみなす。事前登録）
    b["returned"] = b["is_F"] | b["is_L"]
    b["frank"] = pd.to_numeric(b["finish_rank"], errors="coerce")
    b["cls"] = b["class"]
    b["src"] = "kb"
    # 参考: 事前登録の判定（finish_raw）と、prep の SQL の判定（is_flying・is_late_start）の一致
    agree = {
        "finish_raw_F_vs_is_flying": pd.crosstab(b["is_F"], b["is_flying"]).to_dict(),
        "finish_raw_L_vs_is_late_start": pd.crosstab(b["is_L"], b["is_late_start"]).to_dict(),
    }
    return b, agree


# ---------- 本体（main） ----------
def load_main(inputs):
    p_races, p_e, p_x = DATA / "races.csv", DATA / "entries.csv", DATA / "exhibition.csv"
    p_res, p_st = T1 / "t1_3_main_results.csv", T1 / "t1_3_main_st.csv"
    races = pd.read_csv(p_races, usecols=["race_id", "race_date", "venue_code", "cancellation_status"])
    e = pd.read_csv(p_e, usecols=["race_id", "boat_number", "grade", "is_absent"], dtype={"grade": str})
    x = pd.read_csv(p_x, usecols=["race_id", "boat_number", "is_absent"])
    res = pd.read_csv(p_res)
    st = pd.read_csv(p_st, dtype={"finish_mark": str, "official_finish_code": str})
    for p, df in [(p_races, races), (p_e, e), (p_x, x), (p_res, res), (p_st, st)]:
        inputs[str(p.relative_to(SCRATCH))] = {"rows": len(df), "sha256_file": sha256_file(p)}
    inputs[str(p_races.relative_to(SCRATCH))]["max_date"] = str(races.race_date.max())
    inputs[str(p_res.relative_to(SCRATCH))]["max_race_id"] = str(res.race_id.max())
    races = races[(races.race_date > KB_END) & (races.race_date <= END)
                  & races.cancellation_status.fillna("").eq("")]
    res = res[res.rank1.notna() & ~to_bool(res.is_cancelled) & ~to_bool(res.is_no_race)
              & res.race_status.fillna("normal").ne("no_race")]
    rr = races.merge(res, on="race_id", how="inner")
    e = e.merge(rr[["race_id"]], on="race_id", how="inner")
    e = e.merge(x.rename(columns={"is_absent": "x_absent"}), on=["race_id", "boat_number"], how="left")
    e = e.merge(st[["race_id", "boat_number", "start_timing", "is_flying", "is_late_start", "finish_mark"]],
                on=["race_id", "boat_number"], how="left")
    e = e.merge(rr, on="race_id", how="left")
    bn = e["boat_number"].astype(int).values
    ranks = e[[f"rank{i}" for i in range(1, 7)]].values
    e["frank"] = [float(np.where(rw == b)[0][0] + 1) if (rw == b).any() else np.nan for rw, b in zip(ranks, bn)]
    ac = e[[f"actual_course_{i}" for i in range(1, 7)]].values
    e["course"] = ac[np.arange(len(e)), bn - 1]
    refund = e["refund_boats"].fillna("[]").map(json.loads)
    e["in_refund"] = [b in rb for b, rb in zip(bn, refund)]
    fm = e["finish_mark"]
    e["is_flying"] = to_bool(e["is_flying"].fillna(False))
    e["is_late_start"] = to_bool(e["is_late_start"].fillna(False))
    e["absent"] = to_bool(e["is_absent"].fillna(False)) | to_bool(e["x_absent"].fillna(False))
    e["returned"] = e["is_flying"] | e["is_late_start"] | fm.isin(["F", "L", "欠"]) | e["in_refund"]
    e["is_F"] = e["is_flying"] | fm.eq("F")
    e["is_L"] = e["is_late_start"] | fm.eq("L")
    # F でも L でもない返還（欠＝発走後の欠場、または refund_boats だけ）は版B でも除く
    e["ret_other"] = e["returned"] & ~e["is_F"] & ~e["is_L"]
    e["cls"] = e["grade"]
    e["src"] = "main"
    return e


def build_races(b):
    """艇の行 → レースの行（母集団の条件と、版A・版B の可否、ST・進入）"""
    b = b.sort_values(["race_id", "boat_number"])
    g = b.groupby("race_id", sort=True)
    agg = g.agg(race_date=("race_date", "first"), venue_code=("venue_code", "first"), src=("src", "first"),
                n_boats=("boat_number", "size"), has_absent=("absent", "any"),
                n_F=("is_F", "sum"), n_L=("is_L", "sum"), n_other=("ret_other", "sum"), n_ret=("returned", "sum"))
    agg["returned_top3"] = (b["returned"] & (b["frank"] <= 3)).groupby(b["race_id"]).any()
    agg["n_win"] = ((b["frank"] == 1) & ~b["returned"]).groupby(b["race_id"]).sum()
    agg["has_r2"] = (b["frank"] == 2).groupby(b["race_id"]).any()
    agg["has_r3"] = (b["frank"] == 3).groupby(b["race_id"]).any()
    agg["all_a1"] = b["cls"].eq("A1").groupby(b["race_id"]).all()
    pool = agg[(agg.n_boats == 6) & ~agg.has_absent & ~agg.returned_top3 & (agg.n_win == 1) & agg.has_r2 & agg.has_r3]
    ids = pool.index
    bb = b[b.race_id.isin(ids)].sort_values(["race_id", "boat_number"])
    if len(bb) != 6 * len(ids):
        fail("6艇そろわない")
    course = pd.to_numeric(bb["course"], errors="coerce").values.reshape(-1, 6)
    st = pd.to_numeric(bb["start_timing"], errors="coerce").values.reshape(-1, 6)
    isF = bb["is_F"].values.reshape(-1, 6)
    ret = bb["returned"].values.reshape(-1, 6)
    frank = bb["frank"].values.reshape(-1, 6)
    out = pool.copy()
    ok_course = np.all((course >= 1) & (course <= 6), axis=1)
    cs = np.sort(np.where(np.isnan(course), 0, course), axis=1)
    out["course_unknown"] = ~ok_course
    out["course_not_perm"] = ok_course & ~np.all(cs == np.arange(1, 7), axis=1)
    out["rank1"] = np.argmax(frank == 1, axis=1) + 1
    # ST: 版A は返還艇の ST を使わない（そのレースは除く）。版B は F の艇を -abs(ST)
    stA = np.where(ret, np.nan, st)
    stB = np.where(isF, -np.abs(st), stA)
    # F の艇は着に入らない（返還）。1着は返還でない艇（n_win==1 で保証）。F の艇に着順の値が入っている件数は記録だけ
    out["n_F_with_rank"] = (isF & ~np.isnan(frank)).sum(axis=1)
    if np.any(isF & (frank == 1)):
        fail("F の艇が1着になっている")
    cidx = np.where(ok_course[:, None], course, np.arange(1, 7)[None, :]).astype(int) - 1
    for ver, s in [("A", stA), ("B", stB)]:
        cst = np.full((len(out), 6), np.nan)
        rows = np.repeat(np.arange(len(out)), 6)
        cst[rows, cidx.ravel()] = s.ravel()  # コース順に並べる（進入が順列のときだけ意味がある）
        st_ok = ok_course & ~np.isnan(cst).any(axis=1)
        ci = np.rint(np.nan_to_num(cst) * 100).astype(int)
        fm = forms_of(ci)
        out[f"st_ok_{ver}"] = st_ok
        for f, _ in FORMS:
            out[f"{ver}_{f}"] = fm[f] & st_ok
    out["vA"] = (out.n_ret == 0) & ~out.course_unknown
    out["vB"] = ((out.n_ret == 0) | ((out.n_F == out.n_ret) & (out.n_L == 0) & (out.n_other == 0))) & ~out.course_unknown
    # F の艇の進入コース・艇番（版B で戻したレースだけ）
    fcourse = np.where(isF, course, np.nan)
    fboat = np.where(isF, np.arange(1, 7)[None, :], 0)
    fst_raw = np.where(isF, st, np.nan)
    return out, fcourse, fboat, fst_raw


def scope_masks(R):
    return {"NA": np.ones(len(R), bool), "NA_allA1": R.all_a1.values, "v20_allA1": (R.all_a1 & (R.venue_code == 20)).values}


def main():
    inputs = {}
    mf = json.loads((DATA / "fetch_manifest.json").read_text())
    inputs["model-prep/data/fetch_manifest.json"] = {"sha256_file": sha256_file(DATA / "fetch_manifest.json"),
                                                     "tables": mf["tables"]}
    t1mf = T1 / "t1_3_fetch_manifest.json"
    inputs["t1/t1_3_fetch_manifest.json"] = {"sha256_file": sha256_file(t1mf), "tables": json.loads(t1mf.read_text())}
    kb, agree = load_kb(inputs)
    mn = load_main(inputs)
    cols = ["race_id", "race_date", "venue_code", "src", "boat_number", "cls", "course", "start_timing", "absent",
            "returned", "is_F", "is_L", "ret_other", "frank"]
    allb = pd.concat([kb[cols], mn[cols]], ignore_index=True)

    # ---- F の ST の符号（出どころ別。判定の前に出す） ----
    sign = {}
    for src, df in [("kb", kb), ("main", mn)]:
        f = df[df.is_F]
        s = pd.to_numeric(f.start_timing, errors="coerce")
        sign[src] = {"n_F_boats": int(len(f)), "negative": int((s < 0).sum()), "zero": int((s == 0).sum()),
                     "positive": int((s > 0).sum()), "null": int(s.isna().sum()),
                     "def": "長期 finish_raw=F（2019-04-01〜2025-12-02、has_result）" if src == "kb"
                     else "本体 is_flying または finish_mark=F（2025-12-03〜2026-09-26、中止・不成立を除く）"}

    R, fcourse, fboat, fst_raw = build_races(allb)
    R = R.reset_index()
    R.to_pickle(T1 / "t1_3_races.pkl")

    # 版B に入るレースの F の艇の ST、-abs 変換後の検査
    inB_F = R.vB.values & (R.n_F.values > 0)
    raw = fst_raw[inB_F][~np.isnan(fst_raw[inB_F])]
    srcB = np.repeat(R.src.values[inB_F], 6).reshape(-1, 6)[~np.isnan(fst_raw[inB_F])]
    conv = -np.abs(raw)
    neg_check = {"n_F_boats_in_versionB": int(len(raw)),
                 "n_F_boats_st_null_in_versionB": int((np.isnan(fst_raw[inB_F]) & (fboat[inB_F] > 0)).sum()),
                 "by_src_raw_sign": {s: {"negative": int((raw[srcB == s] < 0).sum()), "zero": int((raw[srcB == s] == 0).sum()),
                                         "positive": int((raw[srcB == s] > 0).sum())} for s in ["kb", "main"]},
                 "after_minus_abs_all_negative": bool(np.all(conv < 0)),
                 "after_minus_abs_non_negative_count": int((conv >= 0).sum())}
    if not neg_check["after_minus_abs_all_negative"]:
        fail("-abs 変換後に負でない F の ST がある")

    masks = scope_masks(R)
    days = R.race_date.values
    uday, dix = np.unique(days, return_inverse=True)
    rng = np.random.default_rng(SEED)
    W = np.stack([np.bincount(rng.integers(0, len(uday), len(uday)), minlength=len(uday)) for _ in range(N_BOOT)])

    res, checks = {}, {}
    for sk, label in SCOPES.items():
        m = masks[sk]
        sub = R[m]
        exc = {"n_pool": int(m.sum()), "ret_any": int((sub.n_ret > 0).sum()),
               "ret_F_only": int(((sub.n_ret > 0) & (sub.n_F == sub.n_ret) & (sub.n_L == 0) & (sub.n_other == 0)).sum()),
               "ret_with_L_or_other": int(((sub.n_L > 0) | (sub.n_other > 0)).sum()),
               "course_unknown": int(sub.course_unknown.sum()),
               "F_boats_with_rank_value_in_pool": int(sub.n_F_with_rank.sum()),
               "course_unknown_in_A_or_B_candidates": int((sub.course_unknown & ((sub.n_ret == 0) | ((sub.n_F == sub.n_ret) & (sub.n_L == 0) & (sub.n_other == 0)))).sum()),
               "course_not_perm_in_B": int((sub.vB & sub.course_not_perm).sum()),
               "n_A": int(sub.vA.sum()), "n_B": int(sub.vB.sum()),
               "st_missing_A": int((sub.vA & ~sub.st_ok_A).sum()), "st_missing_B": int((sub.vB & ~sub.st_ok_B).sum()),
               "by_src": {s: {"n_pool": int((sub.src == s).sum()), "n_A": int((sub.vA & (sub.src == s)).sum()),
                              "n_B": int((sub.vB & (sub.src == s)).sum())} for s in ["kb", "main"]}}
        forms = {}
        for fk in FORM_KEYS:
            row = {}
            per_day = {}
            for ver in ["A", "B"]:
                sel = sub[f"v{ver}"].values if fk == "any" else (sub[f"v{ver}"] & sub[f"{ver}_{fk}"]).values
                s2 = sub[sel]
                n = len(s2)
                r1 = np.bincount(s2.rank1.values, minlength=7)[1:]
                row[ver] = {"n": int(n), "winner_boat_1to6": r1.tolist(), "b1_win": wilson(r1[0], n), "b4_win": wilson(r1[3], n)}
                di = dix[m][sel]
                per_day[ver] = (np.bincount(di, minlength=len(uday)).astype(float),
                                np.bincount(di, weights=(s2.rank1.values == 1), minlength=len(uday)),
                                np.bincount(di, weights=(s2.rank1.values == 4), minlength=len(uday)))
            for bk, idx in [("b1", 1), ("b4", 2)]:
                pa, pb = row["A"][f"{bk}_win"]["p"], row["B"][f"{bk}_win"]["p"]
                d = None if pa is None or pb is None else (row["B"][f"{bk}_win"]["x"] / row["B"]["n"] - row["A"][f"{bk}_win"]["x"] / row["A"]["n"]) * 100
                nA, nB = W @ per_day["A"][0], W @ per_day["B"][0]
                with np.errstate(invalid="ignore", divide="ignore"):
                    bd = ((W @ per_day["B"][idx]) / nB - (W @ per_day["A"][idx]) / nA) * 100
                bd = bd[np.isfinite(bd)]
                row[f"diff_{bk}_pt"] = None if d is None else {"d": round(d, 3),
                                                               "boot95": [round(float(np.percentile(bd, 2.5)), 3), round(float(np.percentile(bd, 97.5)), 3)] if len(bd) else None,
                                                               "boot_valid": int(len(bd))}
            row["label"] = "どの形でも" if fk == "any" else dict(FORMS)[fk]
            forms[fk] = row
        # F の艇の進入コース別・艇番別（版B で戻したレースだけ）
        addB = (sub.vB & ~sub.vA).values
        fc = fcourse[m][addB]
        fb = fboat[m][addB]
        fcount = {"races_added_in_B": int(addB.sum()),
                  "F_boats_by_course": {str(k): int((fc == k).sum()) for k in range(1, 7)},
                  "F_boats_by_boat_number": {str(k): int((fb == k).sum()) for k in range(1, 7)},
                  "F_boats_per_race": {str(k): int(v) for k, v in pd.Series((fb > 0).sum(1)).value_counts().sort_index().items()}}
        res[sk] = {"label": label, "exclusions": exc, "forms": forms, "F_boats_added": fcount}
        # 照合
        ref = PREP_REF[sk]
        checks[sk] = {"ref": ref, "n_pool": exc["n_pool"], "ret_any": exc["ret_any"], "n_A": exc["n_A"],
                      "match_n_pool": exc["n_pool"] == ref["n_pool"], "match_ret": exc["ret_any"] == ref["ret"],
                      "match_n_A": exc["n_A"] == ref["n_ok"],
                      "diff_n_A": exc["n_A"] - ref["n_ok"]}
        checks[sk]["forms_vs_prep_A"] = {
            fk: {"prep_n_b1_b4": list(v), "ours_n_b1_b4": [forms[fk]["A"]["n"], forms[fk]["A"]["winner_boat_1to6"][0], forms[fk]["A"]["winner_boat_1to6"][3]],
                 "match": list(v) == [forms[fk]["A"]["n"], forms[fk]["A"]["winner_boat_1to6"][0], forms[fk]["A"]["winner_boat_1to6"][3]]}
            for fk, v in PREP_FORMS[sk].items()}
        # 検算: 形ごとの 1着艇番の合計＝n、版A ⊂ 版B
        for fk, row in forms.items():
            for ver in ["A", "B"]:
                if sum(row[ver]["winner_boat_1to6"]) != row[ver]["n"]:
                    fail(f"1着艇番の合計 {sk} {fk} {ver}")
        if (sub.vA & ~sub.vB).any():
            fail("版A にあって版B に無いレースがある")

    mock = {sk: {"mock": v, "n_A": res[sk]["exclusions"]["n_A"], "diff": res[sk]["exclusions"]["n_A"] - v,
                 "match": res[sk]["exclusions"]["n_A"] == v} for sk, v in MOCK.items()}

    # ---- 判定（事前登録）: NA か NA_allA1 で、カド一撃の4号艇 または どれかの形（7形）の1号艇の |B−A| ≥ 2pt ----
    hits = []
    for sk in ["NA", "NA_allA1"]:
        d4 = res[sk]["forms"]["kado"]["diff_b4_pt"]
        if d4 and abs(d4["d"]) >= THRESH_PT:
            hits.append({"scope": sk, "form": "kado", "boat": 4, "A": res[sk]["forms"]["kado"]["A"]["b4_win"]["p"],
                         "B": res[sk]["forms"]["kado"]["B"]["b4_win"]["p"], "diff_pt": d4["d"]})
        for f, _ in FORMS:
            d1 = res[sk]["forms"][f]["diff_b1_pt"]
            if d1 and abs(d1["d"]) >= THRESH_PT:
                hits.append({"scope": sk, "form": f, "boat": 1, "A": res[sk]["forms"][f]["A"]["b1_win"]["p"],
                             "B": res[sk]["forms"][f]["B"]["b1_win"]["p"], "diff_pt": d1["d"]})
    verdict = {
        "rule": "全国（NA）か 全国・6艇ともA1 のどちらかで、カド一撃の4号艇の1着率、またはどれかの形（7形）の1号艇の1着率の |版B − 版A| が 2pt 以上なら脚注の案をユーザーに出す。2pt 未満なら記録だけ（事前登録 T1-3）",
        "hits": hits,
        "result": "脚注の案をユーザーに出す" if hits else "記録だけ（画面は変えない）",
        "note": "若松・6艇ともA1 は判定に使わない（参考）。どの形でも（any）の1号艇も判定の対象外（参考）",
    }

    try:
        head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    except Exception as ex:  # noqa: BLE001
        head = f"取得失敗: {ex}"
    out = {
        "_meta": {
            "analysis": "BOA-271 v16 T1-3 返還レースの除外が展開シナリオの割合に与える影響",
            "preregistration": "docs/design/analogy-finder/analysis/t1/preregistration-t1.md（コミット 238e0bb5a）",
            "script": "scripts/analysis/analogy-finder-t1/t1_3_refund.py（取得 t1_3_refund.mjs）",
            "repo_head_at_run": head,
            "run_at": datetime.now(timezone.utc).isoformat(),
            "period": f"{START}〜{END}（長期 〜{KB_END}、本体 2025-12-03〜）",
            "in_sample": "モックの数字と同じ期間・同じデータの記述（モデルの評価ではない。in-sample）",
            "data_version": "D-a: model-prep/data（本番 DB 書き出し 2026-10-02T22:28Z、fetch_manifest.json）＋ 本番 DB の SELECT（t1/t1_3_fetch_manifest.json の fetchedAt）",
            "population": "完全レース（entry-slit/prep9/p9b_pool_*.sql と同じ条件: 6艇・欠場なし・返還艇が3着以内でない・1着1艇・2着3着あり。長期 has_result、本体 中止・不成立を除く）",
            "versions": {"A": "返還（F・L・発走後の欠場）のあったレースを除く（今の定義）",
                         "B": "F だけのレースを戻す。F の艇の ST は -abs(ST)、着には入らない。L・欠・refund_boats だけの返還のあるレースは除く"},
            "refund_rule": "長期 finish_raw が F・L0・L1（K0・K1・空は出走前の欠場＝母集団外）。本体 is_flying・is_late_start、finish_mark が F・L・欠、refund_boats（F＝is_flying または finish_mark F、L＝is_late_start または finish_mark L、それ以外の返還は版B でも除く）",
            "course": "長期 kb_archive_boats.course、本体 race_results.actual_course_1..6（i号艇のコース）。進入不明は両方の版で除く",
            "slit_rule": "BOA-635 の7形の1段目（round(ST×100) の整数をコース順に並べる）: 横一線 max−min≤6／内3艇そろう max(c1..c3)−min≤2／2コース凹み c2−min(c1,c3)≥5／カド受け凹み c3−min(c2,c4)≥5／カド一撃 min(c1,c2,c3)−c4≥3／イン凹み c1−c2≥5／ダッシュ勢先行 (c1+c2+c3)−(c4+c5+c6)≥15。形は重なりうる",
            "boats": "4号艇・1号艇は艇番（コースではない）",
            "ci": "割合は Wilson 95%。差（pt、版B−版A）の幅は日単位のブートストラップ 200回 seed 0 の 2.5・97.5 パーセンタイル（版A・版B を同じ日の再標本で数える）",
            "inputs": inputs,
        },
        "F_st_sign_by_source": sign,
        "F_st_after_minus_abs_check": neg_check,
        "refund_rule_agreement_kb": agree,
        "mock_count_check": mock,
        "prep_count_check": checks,
        "scopes": res,
        "verdict": verdict,
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    print("wrote", OUT_JSON)
    print(json.dumps({"sign": sign, "neg": neg_check, "mock": mock, "checks": checks, "verdict": verdict}, ensure_ascii=False, indent=1, default=str))
    for sk in SCOPES:
        for fk in FORM_KEYS:
            r = res[sk]["forms"][fk]
            print(sk, fk, r["A"]["n"], r["B"]["n"], "b4", r["A"]["b4_win"]["p"], r["B"]["b4_win"]["p"], r["diff_b4_pt"],
                  "b1", r["A"]["b1_win"]["p"], r["B"]["b1_win"]["p"], r["diff_b1_pt"])


if __name__ == "__main__":
    main()
