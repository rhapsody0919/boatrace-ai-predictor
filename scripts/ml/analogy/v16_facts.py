"""BOA-271 v16 来る艇の条件（タブ1）の範囲ごとの集計 facts（tasks T2-2。plan「範囲ごとに作るもの」）。

1つの範囲（VC・NC・NCR・VA の母集団のマスク）について、6艇すべての:
- usual: 艇番×着順の全体の件数［当たり, 母数］
- by: 艇番×項目×6つの順位（v16_defs.position_masks）×着順の［当たり, その順位のレース数］
- typ: 艇番×項目×着順の「来たときの平均の順位」（min 順位の平均。値の無い艇は除く）
- wind（VA だけ）: 風速区分×艇番×着順の［当たり, 母数］（spec A-9。0〜1m／2〜3m／4〜5m／6m以上）
集計はモックの mock-v16/tab1_facts.py と同じ（同じ入力で tab1.json と一致することを tests で確かめる）。
"""
from __future__ import annotations

import numpy as np

from v16_defs import min_rank, position_masks

# 項目と向き（True は大きいほど良い）。spec A-4。展示タイムは展示後だけ画面に出すが、集計は常に作る
ITEMS = (("series_score", True), ("exh_time", False), ("loc_win", True), ("nat_win", True),
         ("st_mean30", False), ("recent_win30", True), ("motor_2", True), ("boat_2", True))
TARGETS = ("win", "top2", "top3")
WIND_BANDS = (("0-1", 0, 1), ("2-3", 2, 3), ("4-5", 4, 5), ("6+", 6, np.inf))


def finish_masks(ranks: np.ndarray) -> dict[int, dict[str, np.ndarray]]:
    """ranks: (n,3) の1〜3着の艇番 → {艇番: {win/top2/top3: (n,) bool}}"""
    r = np.asarray(ranks, dtype=float)
    return {b: {"win": r[:, 0] == b, "top2": (r[:, :2] == b).any(axis=1), "top3": (r[:, :3] == b).any(axis=1)}
            for b in range(1, 7)}


def wind_band(wind_speed) -> np.ndarray:
    w = np.asarray(wind_speed, dtype=float)
    out = np.full(w.shape, None, dtype=object)
    for label, lo, hi in WIND_BANDS:
        out[(w >= lo) & (w <= hi)] = label
    return out


def _pair(hit: np.ndarray, base: np.ndarray) -> list[int]:
    return [int((hit & base).sum()), int(base.sum())]


def prepare(values: dict[str, np.ndarray]) -> dict[str, tuple[dict, np.ndarray]]:
    """項目ごとの順位のマスクと min 順位（範囲によらないので1回だけ作る）"""
    return {item: (position_masks(values[item], hib), min_rank(values[item], hib))
            for item, hib in ITEMS if item in values}


def scope_facts(mask: np.ndarray, prepared: dict, ranks: np.ndarray, wind_speed=None) -> dict:
    """mask の範囲の facts。prepared は prepare() の戻り値、ranks は (n,3) の1〜3着"""
    m = np.asarray(mask, dtype=bool)
    fin = finish_masks(ranks)
    out = {"n": int(m.sum()), "usual": {}, "by": {}, "typ": {}}
    for b in range(1, 7):
        i = b - 1
        out["usual"][str(b)] = {t: _pair(fin[b][t], m) for t in TARGETS}
        out["by"][str(b)], out["typ"][str(b)] = {}, {}
        for item, (pos, rk) in prepared.items():
            out["by"][str(b)][item] = {k: {t: _pair(fin[b][t], m & p[:, i]) for t in TARGETS} for k, p in pos.items()}
            ok = ~np.isnan(rk[:, i])
            out["typ"][str(b)][item] = {}
            for t in TARGETS:
                sel = m & fin[b][t] & ok
                out["typ"][str(b)][item][t] = float(rk[sel, i].mean()) if sel.any() else None
    if wind_speed is not None:
        band = wind_band(wind_speed)
        out["wind"] = {label: {str(b): {t: _pair(fin[b][t], m & (band == label)) for t in TARGETS}
                               for b in range(1, 7)} for label, _, _ in WIND_BANDS}
    return out
