"""BOA-271 FR-1 寄与度プロファイル（SHAP をテーマに集計する）

シェア = スライス内の艇の平均 |SHAP| をテーマごとに合算し、全テーマの合計で割った値（spec FR-1）。
スライスは 会場（0=全会場）× グレード（all＋5）× ラウンド（all＋4）× 艇番（0=全艇）。
グレード・ラウンドが不明のレースは「all」にだけ入る。n が0のセルは作らない。
share_sd は seed を変えた再学習（同じ行の SHAP）でのシェアの標準偏差。

train.py が書いた SHAP（data/ml/analogy/out/shap_*.npz）を読み、profiles.json に書く。
"""

from __future__ import annotations

import itertools
import json

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
    cells = pd.concat(out)
    cells = cells[~cells.index.duplicated()]  # 艇番・会場が1種類しかない場合の重複を除く
    return cells, feat_cols


def slice_profiles(keys: pd.DataFrame, contribs: list[np.ndarray], feats: list[str],
                   themes: list[dict] = THEMES, finish_target: int = 1) -> list[dict]:
    """keys: 艇ごとの race_id・race_date・venue_code・grade・round・boat_number（contrib と同じ行順）。
    contribs: pred_contrib の配列（最後の列は期待値）。先頭が表示に使うモデル、残りは seed 違い。"""
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
    rows = []
    for j, key in enumerate(cells.index):
        rec = dict(zip(KEY_COLS, key))
        shares = {tk: float(shares_by_seed[0][tk][j]) for tk, _ in gidx}
        sd = None
        if len(contribs) > 1:
            sd = {tk: float(np.std([s[tk][j] for s in shares_by_seed], ddof=1)) for tk, _ in gidx}
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


def main():
    from train import OUT  # noqa: WPS433 （train.py と同じ出力先）

    meta = json.loads((OUT / "train_meta.json").read_text())
    keys = pd.read_pickle(OUT / "shap_keys.pkl")
    rows = []
    for target in meta["targets"]:
        z = np.load(OUT / f"shap_{target['name']}.npz")
        contribs = [z[k] for k in sorted(z.files)]
        rows += slice_profiles(keys, contribs, meta["features"], THEMES, target["finish_target"])
        print(f"{target['name']}: {len(contribs)} モデル、累計 {len(rows):,} セル", flush=True)
    (OUT / "profiles.json").write_text(json.dumps(rows, ensure_ascii=False))


if __name__ == "__main__":
    main()
