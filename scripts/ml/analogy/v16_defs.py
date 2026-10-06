"""BOA-271 v16 の定義（plan「定義（バッチ・JS・画面で同じものを使う）」の Python 側。tasks T2-1）。

JS の analogyFacts.js・analogyScenario.js（T6-2）と同じ固定データで一致を検査する。出典は plan の表と、
設計書の資料（docs/design/analogy-finder/）:
- 6艇中の順位: mock-v16/tab1_facts.py
- 進入の型・前付け: entry-slit/prep7.md・prep8/prep8.md（mock-v16/part16_scn.js の ENTRY）
- スリットの7形: entry-slit/prep7.md・slit-hint/load.py（BOA-635 spec「スリットの判定」1段目）
- 手がかりの8条件: slit-hint/hint2.py（しきい値は T1-4 で今の値のまま）
- 攻める艇: slit-hint/mark1.py

資料どうしで食い違っていた点の決め（2026-10-05、実装時）:
- VG（会場の G1 以上）は spec どおり、今日が G1・SG のときに出す（prep8 の v20G1 は G1 だけだった）
- 手がかりの「このコース」の平均ST は、このコースで5走未満なら全体で埋める（plan。T1-4 の Cfill）
- 1/100秒・1/1000秒への丸めは、6桁で丸めてから .5 を上へ（JS の Math.round と同じ）。分析は np.round（偶数丸め）
  だったが、ちょうど .5 になるのはまれで、JS と Python で答えをそろえるほうを取った
"""
from __future__ import annotations

import warnings

import numpy as np

CLASSES = ("A1", "A2", "B1", "B2")
MIN_VC_RACES = 300  # spec「数えるレース」: 会場で300件未満なら既定を全国に

# ---------------------------------------------------------------- 級別の組み合わせ・範囲キー


def class_combo(classes) -> str | None:
    """6艇の級別の構成（艇番を問わない）。A1・A2・B1・B2 の艇数を - でつなぐ。級別が欠けた艇がいれば None"""
    if any(c not in CLASSES for c in classes):
        return None
    return "-".join(str(sum(c == k for c in classes)) for k in CLASSES)


def scope_keys(venue: int, classes, boat: int, round_: str | None, grade: str | None) -> dict:
    """範囲キー（plan「範囲ごとに作るもの」）。boat は選んだ艇（タブ3は1号艇）。級別が欠ければ VC・NC・NCR は出さない"""
    out = {}
    combo = class_combo(classes)
    if combo is not None:
        sel = f"{boat}{classes[boat - 1]}"
        out["VC"] = f"VC:{venue}:{combo}:{sel}"
        out["NC"] = f"NC:{combo}:{sel}"
        if round_ in ("yusho", "junyu"):
            out["NCR"] = f"NCR:{combo}:{sel}:{round_}"
    out["VA"] = f"VA:{venue}"
    if grade in ("G1", "SG"):
        out["VG"] = f"VG:{venue}"
    out["NA"] = "NA"
    return out


def default_scope(n_vc: int) -> str:
    return "VC" if n_vc >= MIN_VC_RACES else "NC"


# ---------------------------------------------------------------- 6艇中の順位と同じ値


def min_rank(values, higher_is_better: bool) -> np.ndarray:
    """(n,6) の各艇の min 順位（欠損を除いて付ける。欠損の艇は NaN）。features.py の *_rank と同じ"""
    v = np.atleast_2d(np.asarray(values, dtype=float))
    s = v if higher_is_better else -v
    ok = ~np.isnan(s)
    better = (s[:, None, :] > s[:, :, None]) & ok[:, None, :]  # [i, 自分, 相手]: 相手のほうが良い
    return np.where(ok, 1 + better.sum(axis=2), np.nan)


def position_masks(values, higher_is_better: bool) -> dict[str, np.ndarray]:
    """6艇中の順位のマスク {"1".."6": (n,6) bool}。1位は最良と同じ値の艇すべて、6位は最悪と同じ値の艇すべて、
    2〜5位は min 順位。最悪に並ぶ艇は min 順位と6位の両方に入る。欠損の艇はどこにも入らない"""
    v = np.atleast_2d(np.asarray(values, dtype=float))
    s = v if higher_is_better else -v
    ok = ~np.isnan(s)
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # 6艇とも欠損の行
        best = np.nanmax(s, axis=1, keepdims=True)
        worst = np.nanmin(s, axis=1, keepdims=True)
    rk = min_rank(v, higher_is_better)
    out = {"1": ok & np.isclose(s, best), "6": ok & np.isclose(s, worst)}
    for k in range(2, 6):
        out[str(k)] = ok & (rk == k)
    return out


def rank_positions(values, higher_is_better: bool) -> list[set[int]]:
    """1レース分（6艇）の position_masks を、艇ごとの順位の集合にしたもの"""
    m = position_masks(values, higher_is_better)
    return [{int(k) for k in m if m[k][0, i]} for i in range(len(values))]


# ---------------------------------------------------------------- 進入の型


def maeduke_boats(course_by_boat) -> list[int]:
    """前付けした艇（艇番より内のコースに入った艇）。艇番の昇順"""
    return [b for b, c in enumerate(course_by_boat, start=1) if c is not None and c < b]


def entry_type(course_by_boat) -> str | None:
    """進入の型（'all' を除く7つ）。1号艇が1コース以外は前付けより優先して inlost。進入が1艇でも不明なら None"""
    if any(c is None or (isinstance(c, float) and np.isnan(c)) for c in course_by_boat):
        return None
    if course_by_boat[0] != 1:
        return "inlost"
    if list(course_by_boat) == [1, 2, 3, 4, 5, 6]:
        return "waku"
    return {(6,): "mae6", (5,): "mae5", (5, 6): "mae56"}.get(tuple(maeduke_boats(course_by_boat)), "maeOther")


# ---------------------------------------------------------------- スリットの7形・ST の符号

SLIT_FORMS = ("flat", "wall", "d2", "d3", "kado", "d1", "dash")


def _round_half_up(x: np.ndarray) -> np.ndarray:
    return np.floor(np.round(x, 6) + 0.5).astype(int)


def st_cent(st) -> np.ndarray:
    """ST を 1/100秒の整数に"""
    return _round_half_up(np.asarray(st, dtype=float) * 100)


def signed_st(st, is_flying) -> np.ndarray:
    """F の ST は負（長期は負、本体・展示は正で入っているので、出どころを問わず −abs にする）"""
    st = np.asarray(st, dtype=float)
    return np.where(np.asarray(is_flying, dtype=bool), -np.abs(st), st)


FLY_SHALLOW_MAX = 5  # 展示の F がこれ以下（1/100秒。F.05 まで）なら .00 として形を判定する（Q-F6）


def exh_form_st(st_by_course) -> np.ndarray:
    """展示 ST（コース順、F は負）→ 形の判定に使う ST（2026-10-06 ユーザー決定 Q-F6）。F.01〜.05 は .00 にし、
    F.06 以上の艇がいる行は全コースを NaN にする（形を判定しない）。展示の F の艇は本番では F でない艇と同じ ST で、
    浅い F は展示 .00〜.05 の艇と、深い F は展示 .11〜.20 の艇と同じくらいの本番 ST になる（3,691R の実測）"""
    st = np.atleast_2d(np.asarray(st_by_course, dtype=float)).copy()
    c = st_cent(np.nan_to_num(st))
    deep = ((c < -FLY_SHALLOW_MAX) & ~np.isnan(st)).any(axis=1)
    st[(c < 0) & ~np.isnan(st)] = 0.0
    st[deep] = np.nan
    return st


def slit_forms_matrix(st_by_course) -> dict[str, np.ndarray]:
    """(n,6) のコース順の ST（F は負）から7形の (n,) bool。1艇でも欠ける行はすべて False。形は重なりうる"""
    st = np.atleast_2d(np.asarray(st_by_course, dtype=float))
    ok = ~np.isnan(st).any(axis=1)
    c = st_cent(np.nan_to_num(st))
    forms = {
        "flat": c.max(1) - c.min(1) <= 6,
        "wall": c[:, :3].max(1) - c[:, :3].min(1) <= 2,
        # 凹み: 両隣より0.05秒以上遅い（遅い方の隣より遅い。2026-10-06 ユーザー決定、BOA-777。以前は早い方の隣＝min）
        "d2": c[:, 1] - np.maximum(c[:, 0], c[:, 2]) >= 5,
        "d3": c[:, 2] - np.maximum(c[:, 1], c[:, 3]) >= 5,
        "kado": c[:, :3].min(1) - c[:, 3] >= 3,
        "d1": c[:, 0] - c[:, 1] >= 5,
        "dash": c[:, :3].sum(1) - c[:, 3:].sum(1) >= 15,
    }
    return {k: v & ok for k, v in forms.items()}


def slit_forms(st_by_course) -> dict[str, bool]:
    """1レース分の slit_forms_matrix"""
    return {k: bool(v[0]) for k, v in slit_forms_matrix(st_by_course).items()}


# ---------------------------------------------------------------- 手がかりの8条件

HINTS = ("kado4", "kado4_02", "in_slow02", "in_fastest", "d2_slow01", "d3_slow01", "dash03", "flat03")
MIN_COURSE_RUNS = 5


def fill_course_st(course_st, course_n, overall_st) -> list[float | None]:
    """このコースの平均ST。このコースで5走未満（または値なし）なら全体の平均ST で埋める"""
    return [c if (c is not None and n is not None and n >= MIN_COURSE_RUNS) else o
            for c, n, o in zip(course_st, course_n, overall_st)]


def hint_conditions(avg_st_by_course) -> dict[str, bool]:
    """コース順の平均ST（1/1000秒に丸める）から手がかりの8条件。1艇でも欠ければすべて False"""
    st = np.asarray([np.nan if x is None else x for x in avg_st_by_course], dtype=float)
    if np.isnan(st).any():
        return {k: False for k in HINTS}
    c = _round_half_up(st * 1000)
    return {
        "kado4": bool(c[3] < c[:3].min()),
        "kado4_02": bool(c[:3].min() - c[3] >= 20),
        "in_slow02": bool(c[0] - c[1] >= 20),
        "in_fastest": bool(c[0] < c[1:].min()),
        "d2_slow01": bool(c[1] - max(c[0], c[2]) >= 10),
        "d3_slow01": bool(c[2] - max(c[1], c[3]) >= 10),
        "dash03": bool(c[:3].sum() - c[3:].sum() >= 30),
        "flat03": bool(c.max() - c.min() <= 30),
    }


# ---------------------------------------------------------------- 攻める艇

ATTACK_BOAT = {"kado": 4, "d3": 4, "dash": 4, "d2": 3, "d1": 2}


def went_ahead(st_by_course, attacker: int) -> bool:
    """攻める艇が、内隣（attacker−1）より 1/100秒で5以上早く出たか（枠なりのレースのコース順の ST）"""
    c = st_cent(st_by_course)
    return bool(c[attacker - 2] - c[attacker - 1] >= 5)


# ---------------------------------------------------------------- 今節の平均着順点の序盤の注記


def early_series_note(runs_before_today) -> bool:
    """序盤の注記（spec A-4・Q-D）: 6艇の前日までの走数の最小が3未満で、最大が1以上"""
    return min(runs_before_today) < 3 and max(runs_before_today) >= 1
