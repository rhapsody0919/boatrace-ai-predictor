"""BOA-271 FR-1b: CI 用の小さな固定モデルと固定データ（treeshap-parity.js の形）を作る

本番の一致検査（学習ジョブが版ごとに作る parity_fixture.json）と同じ形で、合成データから
小さな LightGBM の2本（win・win_racecard）を学習し、DB の行の形の固定データと
Python の特徴量・pred_contrib を書き出す。verify-analogy-treeshap.js（CI）がこれを読む。

直前情報8列は features.py の encode_race_level と add_relative と同じ pandas の式で作る。
風向が空で風速0を無風とする約束（ADR 案（#1134「レースごとの寄与度」）、学習側の features.py の変更）は、features.py に
入るまではここで足す（入った後は何もしない）。

作り直し（lightgbm・pandas は scripts/ml/analogy/requirements の版で）:
    python scripts/ml/analogy/make_treeshap_testdata.py
出力: scripts/ml/analogy/testdata/treeshap-parity/（固定データは parity_fixture.json.gz）
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from features import DIR16, WEATHER_CODE, encode_race_level, load_wind_basis, wind_offset
from perrace import META_THEMES
from themes import CATEGORICAL, FEATURES

OUT = Path(__file__).resolve().parent / "testdata" / "treeshap-parity"
LIVE = ["exh_time", "exh_time_diff", "exh_time_rank", "weather_code", "wind_x", "wind_y",
        "wind_speed", "wave_height"]
RACECARD = [f for f in FEATURES if f not in LIVE]
MODEL_VERSION = "testdata-1"
N_TRAIN_RACES = 3000
N_TREES = 40


def racecard_frame(rng: np.random.Generator, n_races: int) -> pd.DataFrame:
    """出走表時点の36列（合成）。カテゴリは番号、欠損を混ぜる"""
    n = n_races * 6
    d = {}
    for f in RACECARD:
        if f == "venue_code":
            d[f] = np.repeat(rng.integers(1, 25, n_races), 6)
        elif f == "boat_number":
            d[f] = np.tile(np.arange(1, 7), n_races)
        elif f == "race_number":
            d[f] = np.repeat(rng.integers(1, 13, n_races), 6)
        elif f in ("grade_code", "round_code"):
            d[f] = np.repeat(rng.integers(0, 4, n_races), 6).astype(float)
        elif f == "branch_code":
            d[f] = rng.integers(0, 18, n).astype(float)
        elif f.endswith("_rank"):
            d[f] = rng.integers(1, 7, n).astype(float)
        else:
            d[f] = np.round(rng.normal(5, 2, n), 2)
    df = pd.DataFrame(d)
    for f in ("branch_code", "grade_code", "nat_win", "st_mean30", "weight"):
        df.loc[rng.random(n) < 0.05, f] = np.nan
    return df.astype("float32")


def live_raw(rng: np.random.Generator, n_races: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """DB の行の形の展示タイム（exhibition_data）と気象（race_conditions）"""
    exh = np.round(rng.uniform(6.50, 7.00, n_races * 6), 2)
    exh[rng.random(n_races * 6) < 0.25] = 6.78  # 同値
    ex = pd.DataFrame({"race_id": np.repeat(np.arange(n_races), 6),
                       "boat_number": np.tile(np.arange(1, 7), n_races), "exhibition_time": exh})
    dirs = rng.choice(np.array(DIR16 + [None], dtype=object), n_races)
    ws = np.round(rng.uniform(0, 8, n_races), 1)
    ws[rng.random(n_races) < 0.1] = 0.0
    cond = pd.DataFrame({"race_id": np.arange(n_races),
                         "weather": rng.choice(np.array(list(WEATHER_CODE), dtype=object), n_races),
                         "wind_direction": dirs, "wind_speed": ws,
                         "wave_height": rng.integers(0, 10, n_races).astype(float)})
    return ex, cond


def live_features(ex: pd.DataFrame, cond: pd.DataFrame, basis: dict | None = None) -> pd.DataFrame:
    """features.py の load_main・add_relative と同じ式（DB の値 → float32 → 8列）。
    basis を渡すと、cond の venue の回転を風向から引く（features.main_wind と同じ）"""
    ex = ex.copy()
    ex["exh_time"] = pd.to_numeric(ex["exhibition_time"], errors="coerce").astype("float32")
    cond = cond.copy()
    for c in ("wind_speed", "wave_height"):
        cond[c] = pd.to_numeric(cond[c], errors="coerce").astype("float32")
    cond["is_final_day"] = False
    offset = 0.0 if basis is None else wind_offset(cond["venue"], basis)
    enc = encode_race_level(cond, "weather", "wind_direction", "wind_speed", "is_final_day",
                            wind_offset=offset)
    calm = cond["wind_direction"].isna() & (cond["wind_speed"] == 0)
    enc.loc[calm.to_numpy(), ["wind_x", "wind_y"]] = np.float32(0)
    df = ex.merge(cond[["race_id", "wind_speed", "wave_height"]], on="race_id", how="left") \
           .merge(enc[["race_id", "weather_code", "wind_x", "wind_y"]], on="race_id", how="left")
    df = df.sort_values(["race_id", "boat_number"]).reset_index(drop=True)
    grp = df.groupby("race_id", sort=False)
    df["exh_time_diff"] = (df["exh_time"] - grp["exh_time"].transform("mean")).astype("float32")
    df["exh_time_rank"] = grp["exh_time"].rank(ascending=True, method="min").astype("float32")
    return df[LIVE].astype("float32")


def labels(rng: np.random.Generator, X: pd.DataFrame) -> np.ndarray:
    s = (-3 * X["exh_time_diff"].fillna(0) + 0.3 * X["nat_win"].fillna(5)
         - 0.4 * X["boat_number"] + 0.05 * X["wind_x"].fillna(0)
         + 0.2 * (X["branch_code"].fillna(-1) % 3) + rng.normal(0, 0.5, len(X))).to_numpy()
    s = s.reshape(-1, 6)
    y = np.zeros_like(s)
    y[np.arange(len(s)), s.argmax(1)] = 1
    return y.reshape(-1)


def train(X: pd.DataFrame, y: np.ndarray, cols: list[str]) -> lgb.Booster:
    params = {"objective": "binary", "num_leaves": 15, "learning_rate": 0.1, "min_data_in_leaf": 20,
              "seed": 0, "deterministic": True, "num_threads": 1, "verbose": -1}
    ds = lgb.Dataset(X[cols].to_numpy(dtype=np.float32), label=y, feature_name=cols,
                     categorical_feature=[c for c in CATEGORICAL if c in cols], free_raw_data=False)
    return lgb.train(params, ds, num_boost_round=N_TREES)


def fixture_cases(rng: np.random.Generator, ex: pd.DataFrame, cond: pd.DataFrame,
                  rc: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """一致検査で必ず通したい形を、固定データの先頭のレースに入れる"""
    cases = [  # (風向, 風速, 天候)
        (None, 0.0, "晴"),       # 本体の無風（風向が空・風速0）→ 0
        (None, 3.0, "曇り"),     # 風向が空・風速>0 → NaN
        ("無風", 0.0, "雨"),
        ("北", None, "雪"),       # 風速が空 → NaN
        ("南", 4.0, "台風"),
        ("東", 2.0, "霧"),
        ("西北西", 5.5, "不明"),  # 未知の天候 → NaN
        ("北北東", 1.0, None),
    ]
    for i, (d, w, wt) in enumerate(cases):
        cond.loc[i, ["wind_direction", "wind_speed", "weather"]] = [d, w, wt]
    cond.loc[8, "wave_height"] = np.nan          # 学習に欠損が無かった列の欠損（missing_type None）
    ex.loc[ex["race_id"] == 9, "exhibition_time"] = 6.70  # 6艇とも同値
    ex.loc[(ex["race_id"] == 10) & (ex["boat_number"] == 3), "exhibition_time"] = np.nan  # 展示タイムの欠け
    ex = ex[~((ex["race_id"] == 11) & (ex["boat_number"] == 5))]  # 展示の行が無い艇
    rc.loc[0:5, "branch_code"] = 99.0            # 学習に出ないカテゴリ
    rc.loc[6:11, "branch_code"] = -1.0           # 負のカテゴリ（右へ）
    rc.loc[12:17, "venue_code"] = np.nan         # カテゴリの欠損
    return ex, cond, rc


def to_db_number(v):
    """real[] を PostgREST で読んだときの形（float32 の最短の10進）"""
    return None if np.isnan(v) else float(np.format_float_positional(np.float32(v), unique=True))


def json_float(v):
    return None if np.isnan(v) else float(v)


def main():
    rng = np.random.default_rng(0)
    rc = racecard_frame(rng, N_TRAIN_RACES)
    ex, cond = live_raw(rng, N_TRAIN_RACES)
    X = pd.concat([rc, live_features(ex, cond)], axis=1)
    y = labels(rng, X)
    win_cols = FEATURES  # 直前情報が途中に入る並び（入力の組み立てが名前で引くことを確かめる）
    boosters = {"win": train(X, y, win_cols), "win_racecard": train(X, y, RACECARD)}

    n_fix = 24
    frc = racecard_frame(rng, n_fix)
    fex, fcond = live_raw(rng, n_fix)
    fex, fcond, frc = fixture_cases(rng, fex, fcond, frc)
    # 会場はレースごとに1〜24（race_id の VV）。全会場の風向の回転を通す
    fcond["venue"] = np.arange(n_fix) % 24 + 1
    basis = load_wind_basis()
    full_ex = pd.DataFrame({"race_id": np.repeat(np.arange(n_fix), 6),
                            "boat_number": np.tile(np.arange(1, 7), n_fix)}) \
        .merge(fex, on=["race_id", "boat_number"], how="left")
    FX = pd.concat([frc, live_features(full_ex, fcond, basis)], axis=1)

    races = []
    for r in range(n_fix):
        rows = slice(r * 6, r * 6 + 6)
        expected = {}
        for name, cols in (("win_racecard", RACECARD), ("win", win_cols)):
            Xm = FX.iloc[rows][cols].to_numpy(dtype=np.float32)
            contrib = boosters[name].predict(Xm, pred_contrib=True)
            expected[name] = {"features": [[json_float(v) for v in row] for row in Xm],
                              "contrib": [[float(v) for v in row] for row in contrib]}
        c = fcond.iloc[r]
        exh_rows = fex[fex["race_id"] == r]
        races.append({
            "race_id": f"2026-01-01-{int(fcond['venue'].iloc[r]):02d}-01",
            "racecard_features": [{"boat_number": b + 1,
                                   "features": [to_db_number(v) for v in frc.iloc[r * 6 + b][RACECARD]]}
                                  for b in range(6)],
            "live_raw": {
                # DB の numeric は数値でも文字列でも来うるので、奇数レースは文字列にする
                "exhibition": [{"boat_number": int(e.boat_number),
                                "exhibition_time": (None if np.isnan(e.exhibition_time)
                                                    else (f"{e.exhibition_time:.2f}" if r % 2 else float(e.exhibition_time))),
                                "is_absent": False} for e in exh_rows.itertuples()],
                "conditions": {"weather": None if pd.isna(c["weather"]) else c["weather"],
                               "wind_direction": None if pd.isna(c["wind_direction"]) else c["wind_direction"],
                               "wind_speed": (None if pd.isna(c["wind_speed"])
                                              else (f"{c['wind_speed']:.1f}" if r % 2 else float(c["wind_speed"]))),
                               "wave_height": None if pd.isna(c["wave_height"]) else int(c["wave_height"])},
            },
            "expected": expected,
        })

    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"model_version": MODEL_VERSION, "dtype": "float32", "live_features": LIVE,
            "categorical_maps": {"branch_code": {}}, "wind_basis": basis, "themes": META_THEMES, "models": {}}
    for name, b in boosters.items():
        file = f"model_{name}.json.gz"
        with gzip.GzipFile(OUT / file, "wb", mtime=0) as f:
            f.write(json.dumps(b.dump_model()).encode())
        meta["models"][name] = {"file": file, "feature_names": b.feature_name(),
                                "num_trees": b.num_trees(), "objective": "binary"}
    (OUT / "per_race_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    # リポジトリを重くしないよう gzip で置く（treeshap-parity.js は .json と .json.gz の両方を読む）
    with gzip.GzipFile(OUT / "parity_fixture.json.gz", "wb", mtime=0) as f:
        f.write(json.dumps({"model_version": MODEL_VERSION, "races": races}, ensure_ascii=False).encode())
    print(f"{OUT}: {n_fix}R, trees {N_TREES}, pandas {pd.__version__}, lightgbm {lgb.__version__}")


if __name__ == "__main__":
    main()
