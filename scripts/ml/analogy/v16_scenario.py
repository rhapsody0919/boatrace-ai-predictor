"""BOA-271 v16 展開シナリオ（タブ3）の範囲ごとの集計 scenario（tasks T2-3。plan「範囲ごとに作るもの」）。

母集団は v16_pool の tab3_ok（返還艇なし・6艇の実進入あり）。1つの範囲のマスクについて:
- cells: 進入の型（all＋7つ）×形（any＋7つ）ごとに、件数・1〜3着の艇・決まり手・万舟・3連単・1号艇の1着、
  30件未満なら1件ずつの行（モックの entry-slit/prep9 の集計と同じ。tests で prep9b.json と突き合わせる）
- hints: 手がかりの8条件ごとに、当てはまる・当てはまらないレースでの各形の件数（このコース・全体の2通り。
  枠なりのレースだけ。slit-hint/hint2.py と同じ。tests で t1-4-hint-threshold.json と突き合わせる）
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from v16_defs import HINTS, SLIT_FORMS, _round_half_up, exh_form_st, slit_forms_matrix

ENTRY_TYPES = ("all", "waku", "inlost", "mae", "mae6", "mae5", "mae56", "maeOther")
FORMS = ("any",) + SLIT_FORMS
TECHNIQUES = ("逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ", "その他")
MANSHU = 10000
MAX_ROWS = 30
# 手がかりの条件ごとに見る形（slit-hint/hint2.py。条件はその形の手がかり）
HINT_FORM = {"kado4": "kado", "kado4_02": "kado", "in_slow02": "d1", "in_fastest": "d1",
             "d2_slow01": "d2", "d3_slow01": "d3", "dash03": "dash", "flat03": "flat"}


def matrix(col: pd.Series) -> np.ndarray:
    """リストの列（6要素、None あり）→ (n,6) float"""
    return np.array([[np.nan if v is None else v for v in row] for row in col], dtype=float)


def entry_types(course: np.ndarray) -> dict[str, np.ndarray]:
    """(n,6) の艇番順の実進入 → 進入の型ごとの (n,) bool（mae は mae6〜maeOther の和）"""
    boats = np.arange(1, 7)
    inside = course < boats  # 前付け: 艇番より内のコース
    waku = (course == boats).all(axis=1)
    inlost = course[:, 0] != 1
    mae = ~inlost & ~waku
    six, five = inside[:, 5], inside[:, 4]
    others = inside[:, :4].any(axis=1)
    out = {"all": np.ones(len(course), bool), "waku": waku, "inlost": inlost, "mae": mae,
           "mae6": mae & six & ~five & ~others, "mae5": mae & five & ~six & ~others,
           "mae56": mae & five & six & ~others}
    out["maeOther"] = mae & ~out["mae6"] & ~out["mae5"] & ~out["mae56"]
    return out


def form_masks(st: np.ndarray) -> dict[str, np.ndarray]:
    return {"any": np.ones(len(st), bool)} | slit_forms_matrix(st)


def _cell(m: np.ndarray, d: dict, entry: str) -> dict:
    ranks, tech, pay = d["ranks"], d["tech_code"], d["pay"]  # 決まり手は整数の符号（文字列の比較は遅い）
    n = int(m.sum())
    out = {"n": n}
    for k, name in enumerate(("first_boat", "second_boat", "third_boat")):
        out[name] = [int((m & (ranks[:, k] == b)).sum()) for b in range(1, 7)]
    out["technique"] = {t: int((m & (tech == k)).sum()) for k, t in enumerate(TECHNIQUES)}
    known = m & ~np.isnan(pay)
    out["payout_known"] = int(known.sum())
    out["manshu"] = int((known & (pay >= MANSHU)).sum())
    out["b1_win"] = int((m & (ranks[:, 0] == 1)).sum())
    codes, counts = np.unique(d["tri_code"][m], return_counts=True)
    out["tri"] = {f"{c // 100}-{c // 10 % 10}-{c % 10}": int(k) for c, k in zip(codes, counts)}
    out["win_tech"] = {str(b): {t: int((m & (ranks[:, 0] == b) & (tech == k)).sum()) for k, t in enumerate(TECHNIQUES)}
                       for b in range(1, 7)}
    if 0 < n < MAX_ROWS:
        out["races"] = [r | {"entry_type": entry} for r in d["rows"].loc[m].to_dict("records")]
    return out


def prepare(races: pd.DataFrame) -> dict:
    """範囲によらない配列（tab3_ok のレースだけを渡す）"""
    st = matrix(races["st_by_course"])
    course = matrix(races["course_by_boat"])
    forms = form_masks(st)
    rows = pd.DataFrame({
        "race_id": races["race_id"].to_numpy(), "date": races["race_date"].astype(str).str[:10].to_numpy(),
        "venue_code": races["venue_code"].to_numpy(),
        "finish_1_2_3": [f"{a}-{b}-{c}" for a, b, c in races[["rank1", "rank2", "rank3"]].to_numpy()],
        "technique": races["winning_technique"].where(races["winning_technique"].notna(), None).to_numpy(),
        "payout_3tan": [None if pd.isna(v) else int(v) for v in races["payout_3tan"]],
        "course_by_boat": list(races["course_by_boat"]),
        "forms": [[f for f in SLIT_FORMS if forms[f][i]] for i in range(len(races))],
    })
    return {
        "ranks": races[["rank1", "rank2", "rank3"]].to_numpy(dtype=float),
        "tri_code": races[["rank1", "rank2", "rank3"]].to_numpy(dtype=int) @ np.array([100, 10, 1]),
        "tech": races["winning_technique"].fillna("その他").to_numpy(dtype=object),
        "tech_code": races["winning_technique"].fillna("その他").map({t: k for k, t in enumerate(TECHNIQUES)})
        .to_numpy(dtype=int),
        "pay": races["payout_3tan"].to_numpy(dtype=float),
        "entries": entry_types(course), "forms": forms, "st": st, "rows": rows,
    }


def _take(d: dict, idx: np.ndarray) -> dict:
    """prepare() の戻り値を、範囲のレース（idx）だけに絞る（範囲キーごとに全件で数えないため。T2-6）"""
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out[k] = {kk: vv[idx] for kk, vv in v.items()}
        elif isinstance(v, pd.DataFrame):
            out[k] = v.iloc[idx].reset_index(drop=True)
        else:
            out[k] = v[idx]
    return out


def scope_cells(mask: np.ndarray, d: dict) -> dict:
    idx = np.flatnonzero(np.asarray(mask, dtype=bool))
    d = _take(d, idx)
    m = np.ones(len(idx), dtype=bool)
    cells = {}
    for e in ENTRY_TYPES:
        em = m & d["entries"][e]
        cells[e] = {"forms": {f: _cell(em & d["forms"][f], d, e) for f in FORMS}}
    return {"n": int(m.sum()), "cells": cells}


def hint_matrix(avg_st: np.ndarray) -> dict[str, np.ndarray]:
    """(n,6) のコース順の平均ST → 手がかりの8条件の (n,) bool（v16_defs.hint_conditions を配列にしたもの）。
    1艇でも欠ける行はすべて False"""
    ok = ~np.isnan(avg_st).any(axis=1)
    c = _round_half_up(np.nan_to_num(avg_st) * 1000)
    conds = {
        "kado4": c[:, 3] < c[:, :3].min(1),
        "kado4_02": c[:, :3].min(1) - c[:, 3] >= 20,
        "in_slow02": c[:, 0] - c[:, 1] >= 20,
        "in_fastest": c[:, 0] < c[:, 1:].min(1),
        "d2_slow01": c[:, 1] - np.maximum(c[:, 0], c[:, 2]) >= 10,
        "d3_slow01": c[:, 2] - np.maximum(c[:, 1], c[:, 3]) >= 10,
        "dash03": c[:, :3].sum(1) - c[:, 3:].sum(1) >= 30,
        "flat03": c.max(1) - c.min(1) <= 30,
    }
    assert tuple(conds) == HINTS
    return {k: v & ok for k, v in conds.items()}


def scope_hints(mask: np.ndarray, d: dict, avg_st: dict[str, np.ndarray]) -> dict:
    """手がかりの条件×形の［当てはまる・当てはまらない］。avg_st は {"course": (n,6), "overall": (n,6)}（コース順。
    枠なりのレースだけを数え、平均ST が6艇そろわない行は除く）"""
    idx = np.flatnonzero(np.asarray(mask, dtype=bool))
    d = _take(d, idx)
    avg_st = {k: v[idx] for k, v in avg_st.items()}
    base = d["entries"]["waku"]
    out = {}
    for version, a in avg_st.items():
        ok = base & ~np.isnan(a).any(axis=1)
        conds = hint_matrix(a)
        out[version] = {}
        for cond, hit in conds.items():
            out[version][cond] = {f: {"hit": [int((ok & hit & d["forms"][f]).sum()), int((ok & hit).sum())],
                                      "miss": [int((ok & ~hit & d["forms"][f]).sum()), int((ok & ~hit).sum())]}
                                  for f in FORMS}
    return out


# ---------------------------------------------------------------- ③ 攻める艇・1号艇の表（spec C-4。slit-hint/mark1.py）
BANDS = (("top", 1, 2), ("mid", 3, 4), ("low", 5, 6))  # 6艇中の min 順位


def _x(hit: np.ndarray, base: np.ndarray) -> list[int]:
    return [int((hit & base).sum()), int(base.sum())]


def _attack_metrics(sel: np.ndarray, r1: np.ndarray, r2: np.ndarray, tech: np.ndarray, a: int | None) -> dict:
    code = TECHNIQUES.index  # tech は決まり手の整数の符号（−1 は記録なし）
    o = {"n": int(sel.sum()), "winner": [int((sel & (r1 == k)).sum()) for k in range(1, 7)],
         "b1_nige": _x((r1 == 1) & (tech == code("逃げ")), sel), "b1_win": _x(r1 == 1, sel),
         "b1_top2": _x((r1 == 1) | (r2 == 1), sel),
         "tech_known_n": int((sel & (tech >= 0)).sum())}
    if a is not None:
        o["att_win"] = _x(r1 == a, sel)
        o["att_top2"] = _x((r1 == a) | (r2 == a), sel)
        for t, k in (("まくり", "makuri"), ("まくり差し", "makurizashi"), ("差し", "sashi")):
            o[f"att_{k}"] = _x((r1 == a) & (tech == code(t)), sel)
            o[f"att_{k}_of_win"] = _x((r1 == a) & (tech == code(t)), sel & (r1 == a))
        o["inner_boat"] = a - 1
        o["inner_top2"] = _x((r1 == a - 1) | (r2 == a - 1), sel)
    return o


def _bands(rank: np.ndarray) -> dict[str, np.ndarray]:
    return {k: (rank >= lo) & (rank <= hi) for k, lo, hi in BANDS}


def scope_attack(base: np.ndarray, forms: dict[str, np.ndarray], r1, r2, tech, motor_rank: np.ndarray,
                 exh_rank: np.ndarray, st_cent: np.ndarray | None = None) -> dict:
    """形ごとの攻める艇・1号艇の表。base は範囲のマスク∧③の母集団（枠なり・返還なし・本番ST と平均ST が6艇そろう）。
    motor_rank・exh_rank は (n,6) の min 順位（6艇そろわない行は NaN）。st_cent は (n,6) の本番 ST（1/100秒の整数、
    コース順）で、攻める艇が内の艇より 0.05秒以上前に出た割合 att_lead に使う"""
    from v16_defs import ATTACK_BOAT
    idx = np.flatnonzero(np.asarray(base, dtype=bool))  # 範囲のレースだけで数える（T2-6）
    forms = {k: v[idx] for k, v in forms.items()}
    r1, r2 = np.asarray(r1)[idx], np.asarray(r2)[idx]
    tech = np.asarray(tech, dtype=object)[idx]
    motor_rank, exh_rank = motor_rank[idx], exh_rank[idx]
    st_cent = None if st_cent is None else st_cent[idx]
    base = np.ones(len(idx), dtype=bool)
    tech = pd.Series(np.asarray(tech, dtype=object)).map({t: k for k, t in enumerate(TECHNIQUES)}) \
        .fillna(-1).to_numpy(dtype=int)
    motok = ~np.isnan(motor_rank).any(axis=1)
    exok = ~np.isnan(exh_rank).any(axis=1)
    out = {}
    for f in SLIT_FORMS:
        a = ATTACK_BOAT.get(f)
        sel = base & forms[f]
        fo = {"attacker": a, "all": _attack_metrics(sel, r1, r2, tech, a),
              "b1_by_motor": {k: _attack_metrics(sel & motok & v, r1, r2, tech, None)
                              for k, v in _bands(motor_rank[:, 0]).items()},
              "b1_by_exh": {k: _attack_metrics(sel & exok & v, r1, r2, tech, None)
                            for k, v in _bands(exh_rank[:, 0]).items()},
              "overlap": {g: _x(forms[g], sel) for g in SLIT_FORMS if g != f}}
        if a is not None:
            fo["by_motor"] = {k: _attack_metrics(sel & motok & v, r1, r2, tech, a)
                              for k, v in _bands(motor_rank[:, a - 1]).items()}
            fo["by_exh"] = {k: _attack_metrics(sel & exok & v, r1, r2, tech, a)
                            for k, v in _bands(exh_rank[:, a - 1]).items()}
            # 凹み（イン・2コース・カド受け）では出さない（spec C-4）。凹みは「攻める艇の内の艇が両隣より
            # 0.05秒以上遅い」なので、攻める艇が内の艇より前に出た割合は定義から100%になる（2026-10-06 BOA-777）
            if st_cent is not None and f not in ("d1", "d2", "d3"):
                fo["att_lead"] = _x((st_cent[:, a - 2] - st_cent[:, a - 1]) >= 5, sel)
        out[f] = fo
    out["any_form"] = _attack_metrics(base, r1, r2, tech, None)
    return out


# ---------------------------------------------------------------- 展示→本番の一致（spec C-1・C-3 の注記）
def exhibition_agreement(races: pd.DataFrame, exh: pd.DataFrame) -> dict:
    """races（v16_pool.load_races の行。tab3_ok のレースを渡す）と exh（v16_pool.load_exhibition_layout）から、全国の
    「展示の進入の型が t のとき、本番も t だった」[件数, 母数] と、「展示の形が f のとき・f でないとき、本番が f だった」。
    期間は exh のある本体のレース（展示の進入の記録がある期間）"""
    m = races.merge(exh, on="race_id", how="inner")
    out = {"n": int(len(m)), "period": [str(m["race_date"].min())[:10] if len(m) else None,
                                       str(m["race_date"].max())[:10] if len(m) else None]}
    if len(m) == 0:
        return out | {"entry": {}, "forms": {}}
    act = entry_types(matrix(m["course_by_boat"]))
    exe = entry_types(matrix(m["exh_course_by_boat"]))
    out["entry"] = {t: [int((exe[t] & act[t]).sum()), int(exe[t].sum())] for t in ENTRY_TYPES if t != "all"}
    # 展示の形は今日の展示と同じ扱い（F.05 までは .00、F.06 以上の艇がいる展示は数えない。Q-F6）
    ast, est = matrix(m["st_by_course"]), exh_form_st(matrix(m["exh_st_by_course"]))
    both = ~np.isnan(ast).any(axis=1) & ~np.isnan(est).any(axis=1)
    af, ef = slit_forms_matrix(ast), slit_forms_matrix(est)
    out["forms_n"] = int(both.sum())
    out["forms"] = {f: {"hit": [int((both & ef[f] & af[f]).sum()), int((both & ef[f]).sum())],
                        "miss": [int((both & ~ef[f] & af[f]).sum()), int((both & ~ef[f]).sum())]}
                    for f in SLIT_FORMS}
    return out
