"""BOA-271 寄与度プロファイル（AIの見立て、spec FR-E の Version 14）

量（spec FR-E、2026-10-03 Version 14）:
  1. グループ単位の SHAP（グループ内の特徴量の pred_contrib を符号つきで足す）を、レースの中で中心化する
     （6艇の平均を引く。6艇がそろって動く分を除く）
  2. 1号艇の行だけ、boat1（1号艇の級別・勝率）を national に足す（1号艇の格は1号艇自身の実力の分）
  3. スライスの中で、艇番ごとの平均を引く（艇番の中で中心化）。テーマはグループの和
  4. テーマ（グループ）の大きさ = |中心化した値| の平均。割合 = 大きさ ÷ 全テーマ（全グループ）の大きさの和
  枠番（boat_number）はどのテーマにも入れないので割合に入らない。その大きさ（同じ二重の中心化をした
  boat_number の SHAP の |値| の平均）を、テーマの大きさの和に対する比 frame_ratio として行に残す（画面の
  1号艇の注記「枠の有利さと選手の格がまざる分（約15%）」の数字）。
スライスは 会場（0=全会場）× グレード（all＋5）× ラウンド（all＋4）× 艇番（0=全艇）。艇番0 は、艇番ごとに
中心化した値を6艇ぶん合わせたもの。グレード・ラウンドが不明のレースは「all」にだけ入る。n が0のセルは作らない。
share_sd はテーマの割合の標準偏差で、2つの揺れを合わせたもの（sqrt(seed² + 日²)）:
  - seed を変えた再学習（同じ行の SHAP）での揺れ
  - 日単位のブートストラップ（表示に使うモデルの SHAP を、test 期間の日を復元抽出して集計し直す）での揺れ。
    中心化の平均はスライス全体の値に固定する（平均の取り直しの影響は 1/n の大きさで無視できる）
向き（plan「向きの計算」）: 全国（0・all・all）の艇番1〜6の行だけ、内訳のグループごとに direction を付ける。

train.py が学習の直後に呼ぶ（SHAP を書き出さずにメモリ上で集計する）。
"""

from __future__ import annotations

import itertools
import warnings

import numpy as np
import pandas as pd

import features as F
from themes import FRAME_FEATURES, THEMES

KEY_COLS = ("venue_code", "grade", "round", "boat_number")
ALL = {"venue_code": 0, "grade": "all", "round": "all", "boat_number": 0}
NATIONAL = (0, "all", "all")

# ---------------------------------------------------------------- 向きの定数（変えるときは学習を1回流す）
DIFF_MIN = 0.01          # 区分の平均の差（log-odds）
RHO_MIN = 0.3            # スピアマンの順位相関
AGREE_MIN = 0.8          # ブートストラップで全体と同じ判定になった割合
CAT_MIN_N = 200          # カテゴリの値ごとの件数の下限
CAT_SIDE = 0.005         # カテゴリの「上がる・下がる」の平均の下限
DIRECTION_N_BOOT = 200   # 向きの揺れの確認の回数（日単位）
DIRECTION_BOOT_SEED = 0

# グループ → 向きを見る代表の特徴量（6艇の中の差がある項目は差。plan「向きの計算」の表）
DIRECTION_FEATURE = {
    "national": "nat_win_diff", "local": "loc_win_diff", "recent": "recent_win30_diff",
    "exhibitionTime": "exh_time_diff", "pastSt": "st_mean30_diff",
    "motor": "motor_2_diff", "boat": "boat_2_diff", "class": "cls_ord",
    "raceNumber": "race_number", "seriesDay": "series_day",
    "wind": "wind_speed", "wave": "wave_height", "age": "age", "weight": "weight",
    "branch": "is_local",
}
CATEGORY_FEATURE = {"venue": "venue_code", "weather": "weather_code", "grade": "grade_code",
                    "round": "round_code"}
# 向きを計算せず、固定の文にするグループ（2〜6号艇の boat1。どちらに動くかは艇番・着順による）
VARIES = {"boat1"}
_WEATHER = {v: k for k, v in F.WEATHER_CODE.items()}
CATEGORY_LABEL = {
    "venue_code": lambda v: int(v),
    "weather_code": lambda v: _WEATHER.get(int(v), str(int(v))),
    "grade_code": lambda v: F.GRADES[int(v)],
    "round_code": lambda v: F.ROUNDS[int(v)],
}


# ---------------------------------------------------------------- テーマ・グループ
def available_themes(feats: list[str], themes: list[dict]) -> list[dict]:
    """モデルにあるグループだけのテーマ（出走表時点のモデルは直前情報のグループが無い）。
    グループの特徴量が一部だけ無いのは定義の食い違いなので失敗させる。"""
    out = []
    for t in themes:
        groups = []
        for g in t["groups"]:
            have = [f in feats for f in g["features"]]
            if all(have):
                groups.append(g)
            elif any(have):
                missing = [f for f, h in zip(g["features"], have) if not h]
                raise ValueError(f"グループ {g['key']} の特徴量がモデルに一部しかありません: {missing}")
        if groups:
            out.append({**t, "groups": groups})
    if not out:
        missing = sorted({f for t in themes for g in t["groups"] for f in g["features"]} - set(feats))
        raise ValueError(f"テーマの特徴量がモデルにありません: {missing}")
    return out


def _race_shape(keys: pd.DataFrame) -> int:
    """行が「レースごとに艇番1〜6の順」に並んでいるか。レース数を返す。"""
    n = len(keys)
    if n % 6:
        raise ValueError("行数が6の倍数でない（完全レースだけを渡す）")
    b = keys["boat_number"].to_numpy().reshape(-1, 6)
    r = keys["race_id"].to_numpy().reshape(-1, 6)
    if not (b == np.arange(1, 7)).all() or not (r == r[:, :1]).all():
        raise ValueError("行がレースごとに艇番1〜6の順に並んでいない")
    return n // 6


def group_values(contrib: np.ndarray, feats: list[str], themes: list[dict]):
    """(グループの値 (行, G), テーマの値 (行, T), 枠の値 (行, 1), グループのキー, テーマのキー)。
    値はレースの中で中心化し、1号艇の行は boat1 を national に足した（boat1 は0）もの。"""
    c = contrib[:, :-1].astype("float64")
    groups = [g for t in themes for g in t["groups"]]
    gkeys = [g["key"] for g in groups]
    gv = np.column_stack([c[:, [feats.index(f) for f in g["features"]]].sum(axis=1) for g in groups])
    gv = gv.reshape(-1, 6, len(groups))
    gv = gv - gv.mean(axis=1, keepdims=True)
    if "boat1" in gkeys and "national" in gkeys:
        b1, nat = gkeys.index("boat1"), gkeys.index("national")
        gv[:, 0, nat] += gv[:, 0, b1]
        gv[:, 0, b1] = 0.0
    gv = gv.reshape(-1, len(groups))
    tv = np.column_stack([gv[:, [gkeys.index(g["key"]) for g in t["groups"]]].sum(axis=1)
                          for t in themes])
    fv = c[:, [feats.index(f) for f in FRAME_FEATURES]].sum(axis=1).reshape(-1, 6)
    fv = (fv - fv.mean(axis=1, keepdims=True)).reshape(-1, 1)
    return gv, tv, fv, gkeys, [t["key"] for t in themes]


# ---------------------------------------------------------------- スライス
def _patterns(keys: pd.DataFrame):
    """スライスの組み合わせごとに (セルのキーの DataFrame（行は keys の位置）, 中心化のキー列)。"""
    base = keys[list(KEY_COLS) + ["race_id", "race_date"]].reset_index(drop=True)
    base["_boat"] = base["boat_number"]
    for gen in itertools.product((False, True), repeat=len(KEY_COLS)):
        d = base.copy()
        for col, g in zip(KEY_COLS, gen):
            if g:
                d[col] = ALL[col]
        # 不明（NaN）は「all」以外のセルに入れない
        d = d.dropna(subset=list(KEY_COLS))
        if d.empty:
            continue
        yield d


def _deviations(d: pd.DataFrame, vals: np.ndarray) -> np.ndarray:
    """セルの中で、実際の艇番ごとの平均を引いた |値|（d の行の順）。"""
    cen = [c for c in KEY_COLS if c != "boat_number"] + ["_boat"]
    code = d.groupby(cen, sort=False).ngroup().to_numpy()
    v = vals[d.index.to_numpy()]
    n = np.bincount(code).astype("float64")
    mean = np.column_stack([np.bincount(code, weights=v[:, i]) / n for i in range(v.shape[1])])
    return np.abs(v - mean[code])


def _cells(keys: pd.DataFrame, vals: np.ndarray, with_boot: bool = True):
    """全セルの (キーの index, |中心化した値| の和 (セル, 列), 艇数, レース数, 期間) と、
    ブートストラップ用の (セルの位置, 日, セル×日の和)（with_boot が False なら None）。"""
    days, day_code = np.unique(keys["race_date"].to_numpy(), return_inverse=True)
    parts, boot = [], []
    for d in _patterns(keys):
        dev = _deviations(d, vals)
        cols = [f"_v{i}" for i in range(dev.shape[1])]
        f = d[list(KEY_COLS) + ["race_id", "race_date"]].copy()
        f[cols] = dev
        f["_day"] = day_code[d.index.to_numpy()]
        agg = f.groupby(list(KEY_COLS), sort=False).agg(
            **{c: (c, "sum") for c in cols},
            n_boats=("race_id", "size"), n_races=("race_id", "nunique"),
            period_from=("race_date", "min"), period_to=("race_date", "max"))
        parts.append(agg)
        if with_boot:
            boot.append(f.groupby(list(KEY_COLS) + ["_day"], sort=False)[cols].sum())
    # 全体を表す値（0・"all"）は実在の値と重ならないので、組み合わせの間でキーは重複しない
    cells = pd.concat(parts)
    sums = cells[[f"_v{i}" for i in range(vals.shape[1])]].to_numpy()
    if not with_boot:
        return cells, sums, None
    bt = pd.concat(boot)
    pos = cells.index.get_indexer(bt.index.droplevel("_day"))
    return cells, sums, (pos, bt.index.get_level_values("_day").to_numpy(), bt.to_numpy(), len(days))


def _shares(m: np.ndarray) -> np.ndarray:
    with np.errstate(invalid="ignore", divide="ignore"):
        return m / m.sum(axis=-1, keepdims=True)


def _boot_theme_sd(boot, n_cells: int, n_boot: int, seed: int) -> np.ndarray:
    """日単位のブートストラップでのテーマの割合の SD（セル × テーマ）。抽出された回が1回以下のセルは NaN。"""
    pos, day, vals, n_days = boot
    w_all = np.random.default_rng(seed).multinomial(n_days, np.full(n_days, 1 / n_days), size=n_boot)
    out = np.empty((n_boot, n_cells, vals.shape[1]))
    for b in range(n_boot):
        w = w_all[b, day]
        tot = np.column_stack([np.bincount(pos, weights=w * vals[:, t], minlength=n_cells)
                               for t in range(vals.shape[1])])
        out[b] = _shares(tot)
    # 抽出された回が1回以下のセルは NaN（呼び出し側で seed の SD だけにする）。そのときの警告は出さない
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanstd(out, axis=0, ddof=1)


# ---------------------------------------------------------------- 向き
def _bands(x: np.ndarray):
    """値の順位で3等分した区分（0=低・1=中・2=高）。同じ値は同じ区分に入れ、区分の境目は
    その値の後ろにずらす。値の種類が3以下なら値ごと（一番小さい値を低、一番大きい値を高、ほかは
    区分に入れない＝-1）。(区分, 中の区分があるか)"""
    u, inv, cnt = np.unique(x, return_inverse=True, return_counts=True)
    if len(u) <= 3:
        band = np.full(len(u), -1)
        band[0], band[-1] = 0, 2
        return band[inv], False
    before = np.concatenate([[0], np.cumsum(cnt)[:-1]])
    n = len(x)
    band = (before >= n / 3).astype(int) + (before >= 2 * n / 3).astype(int)
    return band[inv], True


def judge(m_lo: float, m_mid: float, m_hi: float, rho: float) -> str:
    """plan「向きの計算」の判定（上から順に最初に当てはまるもの）。"""
    if not (np.isfinite(m_lo) and np.isfinite(m_hi) and np.isfinite(rho)):
        return "none"
    if np.isfinite(m_mid):
        if m_mid - max(m_lo, m_hi) >= DIFF_MIN:
            return "middle"
        if min(m_lo, m_hi) - m_mid >= DIFF_MIN:
            return "none"  # 両端で上がる形（Q-B: 「はっきりしない」にまとめる）
    if abs(rho) < RHO_MIN or abs(m_hi - m_lo) < DIFF_MIN:
        return "none"
    return "higher" if rho > 0 else "lower"


def _num(v: float) -> float | None:
    """JSON に書ける数（NaN・±Inf は null）。値ごとの区分の m_mid や、y が一定の項目の ρ は NaN になる。
    Python の json は NaN を素のまま書き、PostgREST が「invalid json」で拒む（run 37278559069）"""
    v = float(v)
    return v if np.isfinite(v) else None


def _rank(a: np.ndarray) -> np.ndarray:
    return pd.Series(a).rank(method="average").to_numpy()


def _weighted_corr(W: np.ndarray, day: np.ndarray, rx: np.ndarray, ry: np.ndarray,
                   n_days: int) -> np.ndarray:
    """日ごとの重み（ブートストラップの回 × 日）での rx・ry の重み付きピアソン相関（回ごと）。"""
    def s(v):
        return W @ np.bincount(day, weights=v, minlength=n_days)
    n, sx, sy = s(np.ones_like(rx)), s(rx), s(ry)
    sxx, syy, sxy = s(rx * rx), s(ry * ry), s(rx * ry)
    cov = sxy / n - (sx / n) * (sy / n)
    vx, vy = sxx / n - (sx / n) ** 2, syy / n - (sy / n) ** 2
    with np.errstate(invalid="ignore", divide="ignore"):
        return cov / np.sqrt(vx * vy)


def _band_means(W: np.ndarray, day: np.ndarray, band: np.ndarray, y: np.ndarray, n_days: int):
    out = []
    for k in range(3):
        sel = band == k
        if not sel.any():
            out.append(np.full(W.shape[0], np.nan))
            continue
        num = W @ np.bincount(day[sel], weights=y[sel], minlength=n_days)
        den = W @ np.bincount(day[sel], minlength=n_days).astype("float64")
        with np.errstate(invalid="ignore", divide="ignore"):
            out.append(num / den)
    return out


def numeric_direction(x: np.ndarray, y: np.ndarray, day: np.ndarray, W: np.ndarray,
                      n_days: int) -> dict:
    ok = np.isfinite(x) & np.isfinite(y)
    x, y, day = x[ok], y[ok], day[ok]
    if len(x) < 30 or len(np.unique(x)) < 2:
        return {"direction": "none", "basis": {"n": int(len(x)), "note": "値が一定か件数不足"}}
    band, has_mid = _bands(x)
    rx, ry = _rank(x), _rank(y)
    rho = float(np.corrcoef(rx, ry)[0, 1])
    m = [float(y[band == k].mean()) if (band == k).any() else float("nan") for k in range(3)]
    if not has_mid:
        m[1] = float("nan")
    overall = judge(m[0], m[1], m[2], rho)
    bl, bm, bh = _band_means(W, day, band, y, n_days)
    if not has_mid:
        bm = np.full(W.shape[0], np.nan)
    brho = _weighted_corr(W, day, rx, ry, n_days)
    reps = [judge(bl[i], bm[i], bh[i], brho[i]) for i in range(W.shape[0])]
    agree = float(np.mean([r == overall for r in reps]))
    final = overall if overall == "none" or agree >= AGREE_MIN else "none"
    ranges = [[float(x[band == k].min()), float(x[band == k].max())] if (band == k).any() else None
              for k in range(3)]
    return {"direction": final, "basis": {
        "rho": _num(rho), "m_low": _num(m[0]), "m_mid": _num(m[1]), "m_high": _num(m[2]),
        "band_ranges": ranges, "band_n": [int((band == k).sum()) for k in range(3)], "n": int(len(x)),
        "overall": overall, "boot_agree": _num(agree)}}


def category_direction(x: np.ndarray, y: np.ndarray, day: np.ndarray, W: np.ndarray,
                       n_days: int, label) -> dict:
    ok = np.isfinite(x) & np.isfinite(y)
    x, y, day = x[ok], y[ok], day[ok]
    vals, cnt = np.unique(x, return_counts=True)
    vals = vals[cnt >= CAT_MIN_N]
    means = {v: float(y[x == v].mean()) for v in vals}
    order = sorted(vals, key=lambda v: means[v])
    top, bottom = order[::-1][:3], order[:3]
    basis = {"values": [{"value": label(v), "mean": _num(means[v]), "n": int((x == v).sum())}
                        for v in order[::-1]]}
    if not order or max(abs(means[v]) for v in set(top) | set(bottom)) < DIFF_MIN:
        return {"direction": "none", "basis": basis}

    def stable(v):
        sel = x == v
        num = W @ np.bincount(day[sel], weights=y[sel], minlength=n_days)
        den = W @ np.bincount(day[sel], minlength=n_days).astype("float64")
        with np.errstate(invalid="ignore", divide="ignore"):
            bm = num / den
        return float(np.mean(np.sign(bm) == np.sign(means[v])))
    up = [v for v in top if means[v] > CAT_SIDE and stable(v) >= AGREE_MIN]
    down = [v for v in bottom if means[v] < -CAT_SIDE and stable(v) >= AGREE_MIN]
    return {"direction": {"up": [label(v) for v in up], "down": [label(v) for v in down]},
            "basis": basis}


def national_directions(keys: pd.DataFrame, gv: np.ndarray, gkeys: list[str],
                        values: pd.DataFrame) -> dict[int, dict]:
    """艇番 → {グループ: {direction, basis}}。全国（全レース）の、艇番の中で中心化した値で。"""
    days, day_code = np.unique(keys["race_date"].to_numpy(), return_inverse=True)
    n_days = len(days)
    W = np.random.default_rng(DIRECTION_BOOT_SEED).multinomial(
        n_days, np.full(n_days, 1 / n_days), size=DIRECTION_N_BOOT).astype("float64")
    boat = keys["boat_number"].to_numpy()
    out = {}
    for b in range(1, 7):
        sel = boat == b
        res = {}
        for i, gk in enumerate(gkeys):
            if gk in VARIES:
                if b != 1:
                    res[gk] = {"direction": "varies", "basis": None}
                continue
            y = gv[sel, i] - gv[sel, i].mean()
            if gk in CATEGORY_FEATURE:
                f = CATEGORY_FEATURE[gk]
                res[gk] = category_direction(values[f].to_numpy("float64")[sel], y, day_code[sel], W,
                                             n_days, CATEGORY_LABEL[f])
            elif gk in DIRECTION_FEATURE:
                res[gk] = numeric_direction(values[DIRECTION_FEATURE[gk]].to_numpy("float64")[sel], y,
                                            day_code[sel], W, n_days)
        out[b] = res
    return out


# ---------------------------------------------------------------- 本体
def nonfinite_to_null(rows: list[dict]) -> tuple[list[dict], dict[str, int]]:
    """書き出す前に、有限でない数（NaN・±Inf）を null にし、場所（キーの並び）ごとの件数を返す。
    原因の分かっている NaN（1レースだけのセル・向きの根拠）は手前で扱っているので、ここで拾うのは想定外の値。
    割合（shares）が有限でないのは集計の不具合なので失敗させる（null にすると画面が壊れる）"""
    counts: dict[str, int] = {}

    def clean(o, path):
        if isinstance(o, float) and not np.isfinite(o):
            counts[path] = counts.get(path, 0) + 1
            return None
        if isinstance(o, dict):
            return {k: clean(v, f"{path}.{k}" if path else k) for k, v in o.items()}
        if isinstance(o, list):
            return [clean(v, f"{path}[]") for v in o]
        return o
    out = [clean(r, "") for r in rows]
    bad = {k: v for k, v in counts.items() if k.split(".")[0] == "shares"}
    if bad:
        raise ValueError(f"割合（shares）に有限でない値がある: {bad}")
    return out, counts


def slice_profiles(keys: pd.DataFrame, contribs: list[np.ndarray], feats: list[str],
                   themes: list[dict] = THEMES, finish_target: int = 1,
                   n_boot: int = 0, boot_seed: int = 0, stage: str = "exhibition",
                   values: pd.DataFrame | None = None, report: dict | None = None) -> list[dict]:
    """keys: 艇ごとの race_id・race_date・venue_code・grade・round・boat_number（contrib と同じ行順。
    レースごとに艇番1〜6の順）。contribs: pred_contrib の配列（最後の列は期待値）。先頭が表示に使う
    モデル、残りは seed 違い。n_boot: 日単位のブートストラップの回数（0 なら seed の揺れだけ）。
    values: 向きの代表の特徴量（keys と同じ行順）。None なら向きを付けない。
    1レースだけのセル（艇番の中で中心化すると全部0になり、割合が 0/0 で決まらない）は書かない。読み手は
    レース数の少ないセルを一段広げて読む（analogyContribution.js）ので、無いセルも同じく広げる。
    report を渡すと、書かなかったセルの数を report["undefined_cells"] に足す。"""
    keys = keys.reset_index(drop=True)
    _race_shape(keys)
    themes = available_themes(feats, themes)
    per_seed = [group_values(c, feats, themes) for c in contribs]
    gv0, _, _, gkeys, tkeys = per_seed[0]
    nt = len(tkeys)
    theme_shares, group_shares = [], []
    cells = boot = frame_ratio = None
    for k, (gv, tv, fv, _, _) in enumerate(per_seed):
        cl, sums, bt = _cells(keys, np.hstack([tv, gv, fv]), with_boot=(k == 0 and n_boot > 1))
        if cells is not None and not cl.index.equals(cells.index):
            raise RuntimeError("seed の間でセルの並びが違う")
        if cells is None:
            cells, boot = cl, bt
            with np.errstate(invalid="ignore", divide="ignore"):
                frame_ratio = sums[:, -1] / sums[:, :nt].sum(axis=1)
        theme_shares.append(_shares(sums[:, :nt]))
        group_shares.append(sums[:, nt:-1])
    seed_sd = np.std(theme_shares, axis=0, ddof=1) if len(contribs) > 1 else None
    boot_sd = None
    if n_boot > 1:
        pos, day, vals, n_days = boot
        boot_sd = _boot_theme_sd((pos, day, vals[:, :nt], n_days), len(cells), n_boot, boot_seed)
    dirs = (national_directions(keys, gv0, gkeys, values) if values is not None else {})
    meta = cells[["n_boats", "n_races", "period_from", "period_to"]].to_dict("records")
    rows = []
    undefined = 0
    for j, key in enumerate(cells.index):
        rec = dict(zip(KEY_COLS, key))
        if not np.all(np.isfinite(theme_shares[0][j])):
            undefined += 1
            continue
        boat = int(rec["boat_number"])
        sd = None
        if seed_sd is not None or boot_sd is not None:
            parts = [x[j] for x in (seed_sd, boot_sd) if x is not None]
            # ブートストラップの SD が NaN（抽出された回が1回以下）のセルは seed の分だけにする
            sq = sum(np.nan_to_num(p) ** 2 for p in parts)
            sd = {tk: float(np.sqrt(sq[t])) for t, tk in enumerate(tkeys)}
        # 1号艇の行は boat1 を national に足したので、boat1 を内訳から除く
        gi = [i for i, gk in enumerate(gkeys) if not (boat == 1 and gk == "boat1")]
        gm = group_shares[0][j]
        gtot = gm[gi].sum()
        nat_dirs = dirs.get(boat) if tuple(key[:3]) == NATIONAL else None
        breakdown = {}
        for t in themes:
            items = []
            for g in t["groups"]:
                i = gkeys.index(g["key"])
                if i not in gi:
                    continue
                item = {"key": g["key"], "share": float(gm[i] / gtot) if gtot > 0 else 0.0}
                if nat_dirs is not None and g["key"] in nat_dirs:
                    item["direction"] = nat_dirs[g["key"]]["direction"]
                    item["direction_basis"] = nat_dirs[g["key"]]["basis"]
                items.append(item)
            breakdown[t["key"]] = items
        c = meta[j]
        rows.append({
            "stage": stage, "finish_target": int(finish_target),
            "venue_code": int(rec["venue_code"]), "grade": str(rec["grade"]),
            "round": str(rec["round"]), "boat_number": boat,
            "n_boats": int(c["n_boats"]), "n_races": int(c["n_races"]),
            "period_from": pd.Timestamp(c["period_from"]).strftime("%Y-%m-%d"),
            "period_to": pd.Timestamp(c["period_to"]).strftime("%Y-%m-%d"),
            "shares": {tk: float(theme_shares[0][j, t]) for t, tk in enumerate(tkeys)},
            "share_sd": sd, "breakdown": breakdown,
            "frame_ratio": float(frame_ratio[j]) if np.isfinite(frame_ratio[j]) else None,
        })
    if report is not None:
        report["undefined_cells"] = report.get("undefined_cells", 0) + undefined
    return rows
