"""BOA-635 T0-1: 定番／レアの線の検証（事前登録 docs/design/past-rate-check/analysis/label-threshold-prereg.md）。

test 2026-04-01〜09-30 の各レースについて、朝のバッチ（scripts/ml/analogy/v16_morning.py の write_race）と同じ規則で
「同じ条件の過去レース」（その日より前、新しい順最大2,000件）を作り、選択肢ごとに割合 p・その日の結果 hit・
全国の割合 q を出して、線の候補 (x, y) ごとに小分けの合否を判定する。

層・母集団の作り方は再実装しない: features.build・v16_morning.race_arrays/class_names・v16_similar.gap_band/
top_boat/layer_conditions/layer_mask・v16_pool.load_races（layer_ok・layer_row の値）をそのまま使う。
スリットの形は T0-2 の scripts/analysis/past-rate-check/slit-pattern-rates.py の forms を読み込んで使う。

読み取りだけ（DB・Storage に接続しない）。本番との照合（export の欠け・win_rate の上書き・本番の layer ファイル）は
label-threshold-checks.mjs が先に作る LT_WORK/checks.json・prod_layers.json を読む。

実行:
  node --env-file=.env.local scripts/analysis/past-rate-check/label-threshold-checks.mjs
  ANALOGY_DATA_DIR=<export> python scripts/analysis/past-rate-check/label-threshold.py
  （Python 3.12・scripts/ml/analogy/requirements.txt の版。LT_WORK に中間データ、LT_OUT に結果の JSON）
"""
from __future__ import annotations

import importlib.util
import itertools
import json
import os
import pickle
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(os.environ.get("REPO_ROOT", Path(__file__).resolve().parents[3]))
sys.path.insert(0, str(ROOT / "scripts" / "ml" / "analogy"))

import features as F  # noqa: E402
import v16_pool as P  # noqa: E402
import v16_similar as S  # noqa: E402
from v16_defs import SLIT_FORMS, slit_forms_matrix, st_cent  # noqa: E402
from v16_morning import MAX_LAYER_ROWS, POOL_FROM, class_names, race_arrays  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "slit_pattern_rates", ROOT / "scripts" / "analysis" / "past-rate-check" / "slit-pattern-rates.py")
SPR = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SPR)

WORK = Path(os.environ.get("LT_WORK", ROOT / "data" / "analysis" / "past-rate-check" / "work"))
OUT = Path(os.environ.get("LT_OUT", ROOT / "data" / "analysis" / "past-rate-check" / "label-threshold.json"))
TEST_FROM, TEST_TO = "2026-04-01", "2026-09-30"
MAIN_FROM = "2025-12-03"
CHECK_FROM = "2026-10-06"  # 固定データの検査に使う本番の layer ファイルの日
LINES = [(15, 5), (20, 5), (15, 3), (25, 3), (10, 3)]
MIN_PAIRS, MIN_RACES = 200, 100
N_BOOT, SEED = 1000, 20261013
TECH4 = ("逃げ", "差し", "まくり", "まくり差し")
STAGES = SPR.STAGES
INVARIANT = {"flat", "wall"}
# spec FR-1「定義から同時に起きない2形」（T0-2）
IMPOSSIBLE = {1: {("wall", "d2"), ("wall", "d3"), ("wall", "d1"), ("d2", "d3"), ("d2", "d1")}}
IMPOSSIBLE[2] = IMPOSSIBLE[1] | {("flat", "d2"), ("flat", "d3"), ("flat", "d1"), ("flat", "dash")}
SUBGROUPS = ["order_single", "order_nagashi", "boat1", "tenkai", "slit_form", "slit_custom", "entry", "payout"]
# 判定に要る値（列）: 0 いつも, 1 決まり手, 2 ST 6艇, 3..6 その艇の実進入（3〜6号艇）, 7 払戻
J_ALL, J_TECH, J_ST, J_PAY = 0, 1, 2, 7
t0 = time.time()


def log(*x):
    print(f"[{time.time() - t0:6.0f}s]", *x, flush=True)


# ---------------------------------------------------------------- 母集団と層の条件（朝のバッチと同じ）
def build_tables() -> tuple[pd.DataFrame, pd.DataFrame]:
    """races: features の6艇そろうレース（race_ok か、固定データの検査の日以降）と層の条件。
    cand: その中で race_ok・POOL_FROM 以降・layer_ok のレース（＝比べる行の母集団）と layer_row の値"""
    cache = WORK / "tables.pkl"
    if cache.exists() and not os.environ.get("LT_REBUILD"):
        return pickle.loads(cache.read_bytes())
    df = F.build(F.D)
    log("features", len(df))
    # 朝のバッチの keep（race_ok・POOL_FROM 以降）。検査の日以降は「今日のレース」として race_ok でなくても入れる
    keep = (df["race_ok"] & (df["race_date"] >= POOL_FROM)) | (df["race_date"] >= CHECK_FROM)
    races, arrays = race_arrays(df[keep], ["cls_ord", "nat_win"])
    ok = df[keep].groupby("race_id")["race_ok"].all()
    races = races.assign(race_ok=races["race_id"].map(ok).astype(bool).to_numpy())
    races["b1"] = class_names(arrays["cls_ord"])[:, 0]
    races["gap"] = S.gap_band(arrays["nat_win"])
    races["top"] = S.top_boat(arrays["nat_win"])
    races["rid_str"] = [F.int_to_rid(int(v)) for v in races["race_id"]]
    all_races = P.load_races(F.D)
    log("load_races", len(all_races))
    prl = all_races.assign(_rid=lambda x: F.rid_to_int(x["race_id"])).set_index("_rid")
    m = races["race_ok"].to_numpy() & races["race_id"].isin(prl.index[prl["layer_ok"]]).to_numpy()
    c = races.loc[m, ["race_id", "b1", "gap", "top", "round", "grade"]].reset_index(drop=True)
    pr = prl.loc[c["race_id"].to_numpy()]
    cand = pd.concat([c, pr[["race_id", "race_date", "rank1", "rank2", "rank3", "winning_technique", "course_by_boat",
                             "st_by_course", "payout_3tan"]].rename(columns={"race_id": "rid_str"})
                      .reset_index(drop=True)], axis=1)
    # 朝のバッチの並び: prl の (race_date, race_id) の文字列で並べる（ここでは昇順に持ち、新しい順は末尾から取る）
    cand = cand.sort_values(["race_date", "rid_str"]).reset_index(drop=True)
    WORK.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(pickle.dumps((races, cand)))
    return races, cand


def masks_for(cond: dict, t: pd.DataFrame) -> np.ndarray:
    return S.layer_mask(cond, t["b1"].to_numpy(dtype=object), t["gap"].to_numpy(), t["top"].to_numpy(),
                        t["round"].to_numpy(dtype=object), t["grade"].to_numpy(dtype=object))


def cond_of(r) -> dict:
    return S.layer_conditions(r["b1"], r["gap"], r["top"], r["round"], r["grade"])


# ---------------------------------------------------------------- 固定データの検査
def fixed_data_check(races: pd.DataFrame, cand: pd.DataFrame) -> dict:
    layers = json.loads((WORK / "prod_layers.json").read_text())
    by_rid = races.set_index("rid_str")
    out = []
    for lay in layers:
        rid = lay["race_id"]
        rec = {"race_id": rid, "run_id": lay["run_id"], "pool_cutoff": lay["pool_cutoff"], "n_total_prod": lay["n_total"]}
        if rid not in by_rid.index:
            out.append(rec | {"ok": False, "reason": "features の6艇そろうレースに無い（条件を作れない）"})
            continue
        cond = cond_of(by_rid.loc[rid])
        cutoff = lay["pool_cutoff"]
        mm = masks_for(cond, cand) & (cand["race_date"].to_numpy(dtype=str) <= cutoff)
        rows = cand.loc[mm].iloc[::-1].head(MAX_LAYER_ROWS)
        mine = [P.layer_row(r) for r in rows.rename(columns={"race_id": "_ri", "rid_str": "race_id"})
                .to_dict("records")]
        prod_ids, my_ids = [r["race_id"] for r in lay["rows"]], [r["race_id"] for r in mine]
        same_vals = sum(a == b for a, b in zip(lay["rows"], mine))
        rec |= {"cond_prod": lay["conditions"], "cond_mine": cond, "cond_same": cond == lay["conditions"],
                "n_total_mine": int(mm.sum()), "ids_same": set(prod_ids) == set(my_ids),
                "order_same": prod_ids == my_ids, "rows_same_values": same_vals, "n_rows": len(prod_ids),
                "only_prod": sorted(set(prod_ids) - set(my_ids))[:10], "only_mine": sorted(set(my_ids) - set(prod_ids))[:10]}
        rec["ok"] = bool(rec["ids_same"])
        out.append(rec)
    n_ok = sum(r["ok"] for r in out)
    log("固定データの検査", f"{n_ok}/{len(out)} 一致")
    return {"n": len(out), "n_ok": n_ok, "all_ok": n_ok == len(out), "races": out}


# ---------------------------------------------------------------- 選択肢と判定
def options() -> list[dict]:
    o = []
    for a, b, c in itertools.permutations(range(1, 7), 3):
        o.append({"sub": "order_single", "key": f"{a}-{b}-{c}", "j": J_ALL, "kind": "order", "a": {a}, "b": {b}, "c": {c}})
    for a in range(1, 7):
        rest = [x for x in range(1, 7) if x != a]
        for s2 in itertools.combinations(rest, 2):
            s3 = tuple(x for x in rest if x not in s2)
            o.append({"sub": "order_nagashi", "key": f"{a}-{''.join(map(str, s2))}-{''.join(map(str, s3))}", "j": J_ALL,
                      "kind": "order", "a": {a}, "b": set(s2), "c": set(s3)})
    for k in ("win", "stay", "out"):
        o.append({"sub": "boat1", "key": k, "j": J_ALL, "kind": "boat1", "v": k})
    for b in range(1, 7):
        for t in TECH4:
            o.append({"sub": "tenkai", "key": f"{b}{t}", "j": J_TECH, "kind": "tenkai", "b": b, "t": t})
    for s in (1, 2):
        for f in SLIT_FORMS:
            if f in INVARIANT and s == 2:
                continue
            o.append({"sub": "slit_form", "key": f if f in INVARIANT else f"{f}@{s}", "j": J_ST, "kind": "form",
                      "forms": (f,), "s": s})
        for f1, f2 in itertools.combinations(SLIT_FORMS, 2):
            if (f1, f2) in IMPOSSIBLE[s] or (s == 2 and {f1, f2} <= INVARIANT):
                continue
            inv = {f1, f2} <= INVARIANT
            o.append({"sub": "slit_form", "key": f"{f1}+{f2}" + ("" if inv else f"@{s}"), "j": J_ST, "kind": "form",
                      "forms": (f1, f2), "s": s})
    for k in range(1, 7):
        for d in ("out", "dent"):
            o.append({"sub": "slit_custom", "key": f"{k}{d}", "j": J_ST, "kind": "custom", "spec": ((k, d),)})
    for k1, k2 in itertools.combinations(range(1, 7), 2):
        for d1, d2 in itertools.product(("out", "dent"), repeat=2):
            o.append({"sub": "slit_custom", "key": f"{k1}{d1}+{k2}{d2}", "j": J_ST, "kind": "custom",
                      "spec": ((k1, d1), (k2, d2))})
    for b in range(3, 7):
        for k in ("in3", "in4", "waku"):
            o.append({"sub": "entry", "key": f"{b}{k}", "j": b, "kind": "entry", "b": b, "v": k})
    for k in ("kata", "chuana", "manshu"):
        o.append({"sub": "payout", "key": k, "j": J_PAY, "kind": "payout", "v": k})
    return o


def outcome_matrix(cand: pd.DataFrame, opts: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """H: (n, 選択肢) の一致（0/1、判定できない行は 0）。J: (n, 8) の判定できるか"""
    n = len(cand)
    r1, r2, r3 = (cand[f"rank{k}"].to_numpy(dtype=int) for k in (1, 2, 3))
    tech = cand["winning_technique"].to_numpy(dtype=object)
    st = np.array([[np.nan if v is None else v for v in row] for row in cand["st_by_course"]], dtype=float)
    course = np.array([[np.nan if v is None else v for v in row] for row in cand["course_by_boat"]], dtype=float)
    pay = cand["payout_3tan"].to_numpy(dtype=float)
    six = ~np.isnan(st).any(axis=1)
    c = st_cent(np.nan_to_num(st))
    fm = {s: SPR.forms(c, **p) for s, p in STAGES.items()}
    ref = slit_forms_matrix(st)
    for k in SLIT_FORMS:  # 1段目が共用の実装と同じ
        assert (ref[k] == (fm[1][k] & six)).all(), k
    tot = c.sum(1)
    J = np.zeros((n, 8), bool)
    J[:, J_ALL] = True
    J[:, J_TECH] = pd.notna(tech)
    J[:, J_ST] = six
    for b in range(3, 7):
        J[:, b] = ~np.isnan(course[:, b - 1])
    J[:, J_PAY] = ~np.isnan(pay)
    H = np.zeros((n, len(opts)), np.int8)
    for k, o in enumerate(opts):
        kind = o["kind"]
        if kind == "order":
            h = np.isin(r1, list(o["a"])) & np.isin(r2, list(o["b"])) & np.isin(r3, list(o["c"]))
        elif kind == "boat1":
            in3 = (r1 == 1) | (r2 == 1) | (r3 == 1)
            h = {"win": r1 == 1, "stay": in3, "out": ~in3}[o["v"]]
        elif kind == "tenkai":
            h = (r1 == o["b"]) & (tech == o["t"])
        elif kind == "form":
            h = np.logical_and.reduce([fm[o["s"]][f] for f in o["forms"]])
        elif kind == "custom":
            h = np.ones(n, bool)
            for kk, d in o["spec"]:
                h &= (tot - 6 * c[:, kk - 1] >= 30) if d == "out" else (6 * c[:, kk - 1] - tot >= 30)
        elif kind == "entry":
            cb = course[:, o["b"] - 1]
            h = {"in3": cb <= 3, "in4": cb <= 4, "waku": cb == o["b"]}[o["v"]]
        else:
            h = {"kata": pay < 1000, "chuana": (pay >= 1000) & (pay < 10000), "manshu": pay >= 10000}[o["v"]]
        H[:, k] = h & J[:, o["j"]]
    return H, J


# ---------------------------------------------------------------- 本計算
def compute(cand: pd.DataFrame, H: np.ndarray, J: np.ndarray, jcol: np.ndarray) -> dict:
    dates = cand["race_date"].to_numpy(dtype=str)
    test = np.where((dates >= TEST_FROM) & (dates <= TEST_TO))[0]
    T, K = len(test), H.shape[1]
    C = np.zeros((T, K), np.int32)
    NJ = np.zeros((T, 8), np.int32)
    n_total = np.zeros(T, np.int64)
    main_share = np.full(T, np.nan)
    conds = {}
    for t, i in enumerate(test):
        key = json.dumps(cond_of(cand.iloc[i]), sort_keys=True, default=str)
        conds.setdefault(key, []).append(t)
    log("test", T, "条件の種類", len(conds))
    for key, ts in conds.items():
        idx = np.where(masks_for(json.loads(key), cand))[0]  # 昇順（race_date, race_id）
        d = dates[idx]
        Hc, Jc = H[idx], J[idx]
        isMain = d >= MAIN_FROM
        for t in ts:
            hi = int(np.searchsorted(d, dates[test[t]], "left"))
            lo = max(0, hi - MAX_LAYER_ROWS)
            n_total[t] = hi
            if hi == 0:
                continue
            C[t] = Hc[lo:hi].sum(0)
            NJ[t] = Jc[lo:hi].sum(0)
            main_share[t] = isMain[lo:hi].mean()
    log("層の割合")
    # 全国の割合 q: test の日より前の母集団（日ごとの累積）
    ud, first = np.unique(dates, return_index=True)
    cumH = np.vstack([np.zeros((1, K)), np.add.reduceat(H.astype(np.int64), first, axis=0).cumsum(0)])
    cumJ = np.vstack([np.zeros((1, 8)), np.add.reduceat(J.astype(np.int64), first, axis=0).cumsum(0)])
    pos = np.searchsorted(ud, dates[test], "left")
    Q = cumH[pos] / cumJ[pos][:, jcol]
    return {"test": test, "C": C, "NJ": NJ, "n_total": n_total, "main_share": main_share, "Q": Q,
            "hit": H[test].astype(bool), "tj": J[test][:, jcol]}


def boot_weights(day_codes: np.ndarray, n_days: int) -> np.ndarray:
    rng = np.random.default_rng(SEED)
    draw = rng.integers(0, n_days, size=(N_BOOT, n_days))
    return np.stack([np.bincount(r, minlength=n_days) for r in draw]).astype(float)


def ratio_ci(W: np.ndarray, num_d: np.ndarray, den_d: np.ndarray) -> list:
    with np.errstate(invalid="ignore", divide="ignore"):
        b = (W @ num_d) / (W @ den_d)
    b = b[np.isfinite(b)]
    return [float(np.percentile(b, 2.5)), float(np.percentile(b, 97.5))] if len(b) else [None, None]


def wilson(c: np.ndarray, n: np.ndarray, z: float = 1.959964) -> tuple[np.ndarray, np.ndarray]:
    p = c / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return mid - half, mid + half


def evaluate(cand: pd.DataFrame, R: dict, opts: list[dict]) -> dict:
    test, C, NJ, Q, hit, tj = R["test"], R["C"], R["NJ"], R["Q"], R["hit"], R["tj"]
    jcol = np.array([o["j"] for o in opts])
    N = NJ[:, jcol]
    valid = (N > 0) & tj
    tdates = cand["race_date"].to_numpy(dtype=str)[test]
    days, dcode = np.unique(tdates, return_inverse=True)
    D = len(days)
    W = boot_weights(dcode, D)
    month = np.array([d[:7] for d in tdates])
    trunc = R["n_total"] > MAX_LAYER_ROWS
    sub_of = np.array([o["sub"] for o in opts])
    race_idx = np.broadcast_to(np.arange(len(test))[:, None], C.shape)
    with np.errstate(invalid="ignore", divide="ignore"):
        P_ = np.where(N > 0, C / np.maximum(N, 1), np.nan)

    def per_day(mask: np.ndarray, val: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        dd = np.broadcast_to(dcode[:, None], mask.shape)[mask]
        return np.bincount(dd, weights=val[mask], minlength=D), np.bincount(dd, minlength=D).astype(float)

    lines = []
    C100 = 100 * C
    for x, y in LINES:
        subs = {}
        bands = (("teiban", (C100 >= x * N) & (C100 < (x + 5) * N), x), ("rare", (C100 >= (y - 2) * N) & (C100 < y * N), y))
        for g in SUBGROUPS:
            gm = valid & (sub_of == g)[None, :]
            res = {}
            for lab, band, line in bands:
                m = gm & band
                n_pairs, n_races = int(m.sum()), int(len(np.unique(race_idx[m])))
                mean = float(hit[m].mean()) if n_pairs else None
                s_d, n_d = per_day(m, hit.astype(float))
                ci = ratio_ci(W, s_d, n_d) if n_pairs else [None, None]
                undecided = n_pairs < MIN_PAIRS or n_races < MIN_RACES
                L = line / 100
                if undecided:
                    verdict = "判定不能"
                elif lab == "teiban":
                    verdict = "不合格" if ci[1] < L else ("境界" if mean < L else "合格")
                else:
                    verdict = "不合格" if ci[0] >= L else ("境界" if mean >= L else "合格")
                old = None if undecided else ("合格" if (mean >= L if lab == "teiban" else mean < L) else "不合格")
                months = {}
                for mo in sorted(set(month)):
                    mm = m & (month == mo)[:, None]
                    months[mo] = {"n": int(mm.sum()), "rate": float(hit[mm].mean()) if mm.sum() else None}
                res[lab] = {"band": [line, line + 5] if lab == "teiban" else [line - 2, line], "n_pairs": n_pairs,
                            "n_races": n_races, "rate": mean, "ci95": ci, "verdict": verdict, "verdict_point_rule": old,
                            "by_month": months}
            subs[g] = res
        fails = [f"{g}:{lab}" for g, r in subs.items() for lab, v in r.items() if v["verdict"] == "不合格"]
        fails_old = [f"{g}:{lab}" for g, r in subs.items() for lab, v in r.items() if v["verdict_point_rule"] == "不合格"]
        lines.append({"x": x, "y": y, "subgroups": subs, "failed": fails, "pass": not fails,
                      "failed_point_rule": fails_old, "pass_point_rule": not fails_old})
        log("線", (x, y), "不合格", fails, "旧規則", fails_old)
    adopted = next((ln for ln in lines if ln["pass"]), None)
    adopted_old = next((ln for ln in lines if ln["pass_point_rule"]), None)

    # 報告 (a)(b)(c): 線ごと、小分けごと、切り詰めあり／なし／全体
    splits = {"all": np.ones(len(test), bool), "truncated": trunc, "not_truncated": ~trunc}
    lo_w, hi_w = wilson(C.astype(float), np.maximum(N, 1).astype(float))
    report = {}
    for x, y in LINES:
        rep = {}
        for g in SUBGROUPS:
            rg = {}
            for sname, sm in splits.items():
                m = valid & (sub_of == g)[None, :] & sm[:, None]
                n_all = int(m.sum())
                te = m & (100 * C >= x * N)
                ra = m & (100 * C < y * N)
                n_te, n_ra = int(te.sum()), int(ra.sum())
                stable = int((te & (lo_w >= x / 100)).sum() + (ra & (hi_w < y / 100)).sum())
                rg[sname] = {
                    "n_pairs": n_all, "n_races": int(sm.sum()),
                    "share_teiban": n_te / n_all if n_all else None, "share_rare": n_ra / n_all if n_all else None,
                    "teiban_share_of_labeled": n_te / (n_te + n_ra) if n_te + n_ra else None,
                    "wilson_stable_share": stable / (n_te + n_ra) if n_te + n_ra else None,
                }
            rep[g] = rg
        report[f"{x},{y}"] = rep
    brier = {}
    e_p = (np.nan_to_num(P_) - hit) ** 2
    e_q = (np.nan_to_num(Q) - hit) ** 2
    for g in SUBGROUPS:
        bg = {}
        for sname, sm in splits.items():
            m = valid & (sub_of == g)[None, :] & sm[:, None] & np.isfinite(Q)
            if not m.sum():
                bg[sname] = None
                continue
            sp, _ = per_day(m, e_p)
            sq, _ = per_day(m, e_q)
            bs = 1 - sp.sum() / sq.sum()
            with np.errstate(invalid="ignore", divide="ignore"):
                b = 1 - (W @ sp) / (W @ sq)
            b = b[np.isfinite(b)]
            bg[sname] = {"n_pairs": int(m.sum()), "brier_p": float(sp.sum() / m.sum()),
                         "brier_q": float(sq.sum() / m.sum()), "skill": float(bs),
                         "ci95": [float(np.percentile(b, 2.5)), float(np.percentile(b, 97.5))]}
        brier[g] = bg

    # 手順7（採った線、無ければ (15,5) を参考に）
    ref_line = adopted or lines[0]
    rk = f"{ref_line['x']},{ref_line['y']}"
    step7 = {}
    for g in SUBGROUPS:
        reasons = {}
        for sname in splits:
            a, bb = report[rk][g][sname], brier[g][sname]
            r = []
            if a["wilson_stable_share"] is not None and a["wilson_stable_share"] < 0.5:
                r.append("(b) Wilson で線をまたがない割合が50%未満")
            if bb is not None and (bb["ci95"][0] <= 0 <= bb["ci95"][1] or bb["skill"] < 0.01):
                r.append("(c) Brier skill の CI が0をまたぐか 0.01 未満")
            if a["teiban_share_of_labeled"] is not None and max(a["teiban_share_of_labeled"],
                                                                1 - a["teiban_share_of_labeled"]) >= 0.95:
                r.append("(a) 定番かレアの一方が95%以上")
            reasons[sname] = r
        step7[g] = reasons

    # (d) 本体の行の割合の中央値（選択肢ごとの全国の割合は national_table）
    return {"lines": lines, "adopted": None if adopted is None else [adopted["x"], adopted["y"]],
            "adopted_point_rule": None if adopted_old is None else [adopted_old["x"], adopted_old["y"]],
            "report_abc": report, "brier": brier, "step7_line": [ref_line["x"], ref_line["y"]], "step7": step7,
            "main_share_median": {s: float(np.nanmedian(R["main_share"][sm])) for s, sm in splits.items()},
            "n_test_races": int(len(test)), "n_test_days": D,
            "n_truncated": int(trunc.sum()), "n_empty_layer": int((R["n_total"] == 0).sum()),
            "n_total_quantiles": {q: float(np.quantile(R["n_total"], q)) for q in (0.1, 0.5, 0.9)}}


def national_table(cand: pd.DataFrame, H: np.ndarray, J: np.ndarray, opts: list[dict]) -> list[dict]:
    d = cand["race_date"].to_numpy(dtype=str)
    jcol = np.array([o["j"] for o in opts])
    out = []
    for name, m in (("long", (d >= POOL_FROM) & (d < MAIN_FROM)), ("main", (d >= MAIN_FROM) & (d <= TEST_TO))):
        h, j = H[m].sum(0), J[m].sum(0)[jcol]
        out.append((name, h / j, j))
    return [{"sub": o["sub"], "key": o["key"], "long": float(out[0][1][k]), "long_n": int(out[0][2][k]),
             "main": float(out[1][1][k]), "main_n": int(out[1][2][k])} for k, o in enumerate(opts)]


def main() -> None:
    manifest = json.loads((F.D / "export_manifest.json").read_text())
    checks_path = WORK / "checks.json"
    checks = json.loads(checks_path.read_text()) if checks_path.exists() else None
    races, cand = build_tables()
    log("races", len(races), "cand", len(cand))
    fixed = fixed_data_check(races, cand)
    result = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "data_dir": str(F.D),
              "export_manifest": manifest, "prereg": "docs/design/past-rate-check/analysis/label-threshold-prereg.md",
              "test_period": [TEST_FROM, TEST_TO], "lines_order": LINES, "min_pairs": MIN_PAIRS, "min_races": MIN_RACES,
              "bootstrap": {"n": N_BOOT, "seed": SEED, "unit": "race_date", "method": "percentile"},
              "checks": checks, "fixed_data_check": fixed,
              "pool": {"n_cand": int(len(cand)), "date_range": [cand["race_date"].iat[0], cand["race_date"].iat[-1]]}}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if not fixed["all_ok"] and not os.environ.get("LT_FORCE"):
        result["stopped"] = "固定データの検査が一致しないので本計算に入らない（事前登録）"
        OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str))
        log(result["stopped"])
        return
    opts = options()
    H, J = outcome_matrix(cand, opts)
    jcol = np.array([o["j"] for o in opts])
    log("選択肢", len(opts), {g: sum(o["sub"] == g for o in opts) for g in SUBGROUPS})
    # 定義から同時に起きない組が本当に0件か（T0-2 と同じ）
    zero_pairs = []
    for s in (1, 2):
        f = SPR.forms(st_cent(np.nan_to_num(np.array([[np.nan if v is None else v for v in r]
                                                       for r in cand["st_by_course"]], float))), **STAGES[s])
        for a, b in IMPOSSIBLE[s]:
            assert not (f[a] & f[b] & J[:, J_ST]).any(), (s, a, b)
        zero_pairs += [f"{o['key']}" for k, o in enumerate(opts) if o["kind"] == "form" and o["s"] == s
                       and len(o["forms"]) == 2 and H[:, k].sum() == 0]
    R = compute(cand, H, J, jcol)
    ev = evaluate(cand, R, opts)
    result |= {"n_options": {g: sum(o["sub"] == g for o in opts) for g in SUBGROUPS},
               "options_zero_in_pool": zero_pairs, **ev, "national_rates": national_table(cand, H, J, opts)}
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str))
    log("書いた", OUT, "採った線", ev["adopted"], "旧規則", ev["adopted_point_rule"])


if __name__ == "__main__":
    main()
