"""BOA-271 FR-1 寄与度プロファイル（SHAP をテーマに集計する）

シェア = スライス内の艇の平均 |SHAP| をテーマごとに合算し、全テーマの合計で割った値（spec FR-1）。
スライスは 会場（0=全会場）× グレード（all＋5）× ラウンド（all＋4）× 艇番（0=全艇）。
グレード・ラウンドが不明のレースは「all」にだけ入る。n が0のセルは作らない。
share_sd はシェアの標準偏差で、2つの揺れを合わせたもの（sqrt(seed² + 日²)）:
  - seed を変えた再学習（同じ行の SHAP）での揺れ
  - 日単位のブートストラップ（表示に使うモデルの SHAP を、test 期間の日を復元抽出して集計し直す）での揺れ。
    同じ日のレースは条件（水面・風・節の進行）が似ていて独立でないので、レース単位でなく日単位で抽出する
画面はこの SD で「隣の順位との差が SD の2倍に満たないなら順位を強調しない」を判定する。

train.py が学習の直後に呼ぶ（SHAP を書き出さずにメモリ上で集計する）。
"""

from __future__ import annotations

import itertools

import numpy as np
import pandas as pd

from themes import THEMES, theme_features

KEY_COLS = ("venue_code", "grade", "round", "boat_number")
ALL = {"venue_code": 0, "grade": "all", "round": "all", "boat_number": 0}


def _check_features(feats: list[str], themes: list[dict]) -> None:
    missing = [f for t in themes for f in theme_features(t) if f not in feats]
    if missing:
        raise ValueError(f"テーマの特徴量がモデルにありません: {missing}")


def _group_index(feats: list[str], themes: list[dict]):
    return [(t["key"], [(g["key"], [feats.index(f) for f in g["features"]]) for g in t["groups"]])
            for t in themes]


def _cells(keys: pd.DataFrame, abs_c: np.ndarray):
    """全スライスの (キー, 特徴量ごとの |SHAP| の和, 艇数, レース数, 期間) を作る。"""
    base = keys[list(KEY_COLS) + ["race_id", "race_date"]].copy()
    feat_cols = [f"_f{i}" for i in range(abs_c.shape[1])]
    base[feat_cols] = abs_c
    out = []
    for gen in itertools.product((False, True), repeat=len(KEY_COLS)):
        d = base.copy()
        for col, g in zip(KEY_COLS, gen):
            if g:
                d[col] = ALL[col]
        # 不明（NaN）は「all」以外のセルに入れない
        d = d.dropna(subset=[c for c in KEY_COLS])
        if d.empty:
            continue
        agg = d.groupby(list(KEY_COLS), sort=False).agg(
            **{c: (c, "sum") for c in feat_cols},
            n_boats=("race_id", "size"), n_races=("race_id", "nunique"),
            period_from=("race_date", "min"), period_to=("race_date", "max"))
        out.append(agg)
    # 全体を表す値（0・"all"）は実在の値と重ならないので、組み合わせの間でキーは重複しない
    cells = pd.concat(out)
    return cells, feat_cols


def _day_bootstrap_shares(keys: pd.DataFrame, theme_abs: np.ndarray, cells: pd.DataFrame,
                          n_boot: int, seed: int = 0) -> np.ndarray:
    """日単位のブートストラップでのシェア（n_boot × セル × テーマ）。セルに入る日が1日も
    抽出されなかった回は NaN。"""
    base = keys[list(KEY_COLS)].copy()
    days, day_code = np.unique(keys["race_date"].to_numpy(), return_inverse=True)
    base["_day"] = day_code
    tcols = [f"_t{k}" for k in range(theme_abs.shape[1])]
    base[tcols] = theme_abs
    cell_pos, entry_day, vals = [], [], []
    for gen in itertools.product((False, True), repeat=len(KEY_COLS)):
        d = base.copy()
        for col, g in zip(KEY_COLS, gen):
            if g:
                d[col] = ALL[col]
        d = d.dropna(subset=list(KEY_COLS))
        if d.empty:
            continue
        g = d.groupby(list(KEY_COLS) + ["_day"], sort=False)[tcols].sum()
        idx = g.index.droplevel("_day")
        pos = cells.index.get_indexer(idx)
        cell_pos.append(pos)
        entry_day.append(g.index.get_level_values("_day").to_numpy())
        vals.append(g.to_numpy())
    cell_pos = np.concatenate(cell_pos)
    entry_day = np.concatenate(entry_day)
    vals = np.vstack(vals)
    n_cells, k = len(cells), theme_abs.shape[1]
    rng = np.random.default_rng(seed)
    weights = rng.multinomial(len(days), np.full(len(days), 1 / len(days)), size=n_boot)
    out = np.empty((n_boot, n_cells, k))
    for b in range(n_boot):
        w = weights[b, entry_day]
        tot = np.column_stack([np.bincount(cell_pos, weights=w * vals[:, t], minlength=n_cells)
                               for t in range(k)])
        with np.errstate(invalid="ignore", divide="ignore"):
            out[b] = tot / tot.sum(axis=1, keepdims=True)
    return out


def slice_profiles(keys: pd.DataFrame, contribs: list[np.ndarray], feats: list[str],
                   themes: list[dict] = THEMES, finish_target: int = 1,
                   n_boot: int = 0, boot_seed: int = 0) -> list[dict]:
    """keys: 艇ごとの race_id・race_date・venue_code・grade・round・boat_number（contrib と同じ行順）。
    contribs: pred_contrib の配列（最後の列は期待値）。先頭が表示に使うモデル、残りは seed 違い。
    n_boot: 日単位のブートストラップの回数（0 なら seed の揺れだけ）。"""
    _check_features(feats, themes)
    gidx = _group_index(feats, themes)
    sums = []
    cells = None
    for c in contribs:
        cl, fcols = _cells(keys, np.abs(c[:, :-1]))
        if cells is None:
            cells = cl
        sums.append(cl[fcols].to_numpy() / cl["n_boats"].to_numpy()[:, None])
    shares_by_seed = []
    for per_feat in sums:
        tot = per_feat.sum(axis=1)
        shares_by_seed.append({tk: sum(per_feat[:, idx].sum(axis=1) for _, idx in groups) / tot
                               for tk, groups in gidx})
    main_feat = sums[0]
    tot = main_feat.sum(axis=1)
    theme_keys = [tk for tk, _ in gidx]
    seed_sd = None
    if len(contribs) > 1:
        seed_sd = np.column_stack([np.std([s[tk] for s in shares_by_seed], axis=0, ddof=1)
                                   for tk in theme_keys])
    boot_sd = None
    if n_boot > 1:
        abs_main = np.abs(contribs[0][:, :-1])
        theme_abs = np.column_stack([sum(abs_main[:, idx].sum(axis=1) for _, idx in groups)
                                     for _, groups in gidx])
        boots = _day_bootstrap_shares(keys, theme_abs, cells, n_boot, boot_seed)
        boot_sd = np.nanstd(boots, axis=0, ddof=1)
    parts = [x for x in (seed_sd, boot_sd) if x is not None]
    sd_all = np.sqrt(sum(x ** 2 for x in parts)) if parts else None
    rows = []
    for j, key in enumerate(cells.index):
        rec = dict(zip(KEY_COLS, key))
        shares = {tk: float(shares_by_seed[0][tk][j]) for tk, _ in gidx}
        sd = None
        if sd_all is not None:
            # 日が1日しかないセルはブートストラップの SD が出ない（NaN）。その場合は seed の分だけ
            sd = {tk: float(np.nan_to_num(sd_all[j, t], nan=seed_sd[j, t] if seed_sd is not None
                                          else 0.0))
                  for t, tk in enumerate(theme_keys)}
        breakdown = {tk: [{"key": gk, "share": float(main_feat[j, idx].sum() / tot[j])}
                          for gk, idx in groups] for tk, groups in gidx}
        c = cells.iloc[j]
        rows.append({
            "finish_target": int(finish_target),
            "venue_code": int(rec["venue_code"]), "grade": str(rec["grade"]),
            "round": str(rec["round"]), "boat_number": int(rec["boat_number"]),
            "n_boats": int(c["n_boats"]), "n_races": int(c["n_races"]),
            "period_from": pd.Timestamp(c["period_from"]).strftime("%Y-%m-%d"),
            "period_to": pd.Timestamp(c["period_to"]).strftime("%Y-%m-%d"),
            "shares": shares, "share_sd": sd, "breakdown": breakdown,
        })
    return rows

