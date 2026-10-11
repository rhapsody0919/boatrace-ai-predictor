"""profiles の段を、少量の本番と同じ形のデータで最後まで通す（allow_nan=False の書き出しまで）。

2026-10-05 に、2.5時間の学習の最後の書き出しで NaN が2回続けて見つかり、約5時間を失った（run 37278559069・
37304986570）。原因はどちらも、合成データのテストに無い形の値だった（地元 0/1 のような値の種類が少ない項目、
1レースだけのセル）。ここでは本番に出る形をわざと入れたデータで、学習の段の出力（モデルと train_meta）から
profiles.json・profiles_record.json の書き出しまでを ml-tests で毎回通す。
"""

import json

import numpy as np
import pandas as pd
import pytest

import features as F
import train as T
from themes import FEATURES

N_DAYS = 560  # test 12か月＋温度合わせ3か月＋学習の分
RACES_PER_DAY = 2


def production_shaped(seed: int = 0) -> pd.DataFrame:
    """本番に出る形を入れた完全レースの表（complete_races の後と同じ並び）"""
    rng = np.random.default_rng(seed)
    n_races = N_DAYS * RACES_PER_DAY
    rows = n_races * 6
    df = pd.DataFrame({f: rng.normal(size=rows).astype("float32") for f in FEATURES})
    day = np.repeat(np.arange(n_races) // RACES_PER_DAY, 6)
    df["race_date"] = pd.Timestamp("2024-06-01") + pd.to_timedelta(day, unit="D")
    df["race_id"] = np.repeat(np.arange(n_races), 6) + 202406010101
    df["boat_number"] = np.tile(np.arange(1, 7), n_races)
    venue = rng.integers(1, 6, n_races)
    venue[-1] = 24  # 会場24 は最後の1レースだけ → 1レースだけのセル（割合が決まらない）
    df["venue_code"] = np.repeat(venue, 6).astype("float32")
    df["is_local"] = (rng.random(rows) < 0.2).astype("float32")             # 0/1（中の区分が無い）
    df["cls_ord"] = rng.integers(1, 5, rows).astype("float32")              # 4値・同じ値が多い
    df["branch_code"] = rng.integers(0, 18, rows).astype("float32")
    df["weather_code"] = np.repeat(rng.integers(0, 3, n_races), 6).astype("float32")
    df["wind_speed"] = np.repeat(np.where(rng.random(n_races) < 0.3, 0, rng.integers(1, 8, n_races)),
                                 6).astype("float32")
    df["st_n"] = np.float32(30)                                             # 一定の列
    df.loc[rng.random(rows) < 0.05, "nat_win"] = np.nan                     # 欠損
    grade = np.array(F.GRADES + [None], dtype=object)[rng.integers(0, 6, n_races)]
    rnd = np.array(F.ROUNDS + [None], dtype=object)[rng.integers(0, 5, n_races)]
    df["grade"] = np.repeat(grade, 6)
    df["round"] = np.repeat(rnd, 6)
    df["grade_code"] = df["grade"].map(F.GRADE_CODE).astype("float32")
    df["round_code"] = df["round"].map(F.ROUND_CODE).astype("float32")
    df["round_code_v1"] = df["round_code"]
    win = np.zeros(rows, dtype="int8")
    order = np.argsort(rng.random((n_races, 6)), axis=1)
    finish = np.empty((n_races, 6), dtype="int8")
    finish[np.arange(n_races)[:, None], order] = np.arange(1, 7)
    finish = finish.reshape(-1)
    df["y_win"] = (finish == 1).astype("int8")
    df["y_top2"] = (finish <= 2).astype("int8")
    df["y_top3"] = (finish <= 3).astype("int8")
    df["race_ok"] = True
    return df


@pytest.fixture
def trained(tmp_path, monkeypatch):
    """学習の段（train.py --train-only）が置くものを、小さなモデルで作る"""
    monkeypatch.setattr(F, "D", tmp_path)
    monkeypatch.setattr(T, "OUT", tmp_path / "out")
    T.OUT.mkdir()
    production_shaped().to_pickle(tmp_path / "boats.pkl")
    _, fit, _, test = T.load_data()
    old = T.PARAMS["min_data_in_leaf"]
    T.PARAMS["min_data_in_leaf"] = 20
    try:
        seeds = [0, 1]
        for name, label, _, _ in T.TARGETS + T.RACECARD:
            for s in seeds:
                file = f"model_{name}.txt" if s == seeds[0] else f"model_{name}_seed{s}.txt"
                T.fit_model(fit, label, 15, s, T._features_for(name)).save_model(str(T.OUT / file))
    finally:
        T.PARAMS["min_data_in_leaf"] = old
    meta = {"model_version": "2099-01-01",
            "metrics": {"seeds": seeds, "n_boot": 20,
                        "periods": {"test": [str(test["race_date"].min().date()),
                                             str(test["race_date"].max().date())]},
                        "n_races": {"test": int(test["race_id"].nunique())}}}
    (T.OUT / "train_meta.json").write_text(json.dumps(meta))
    return T.OUT


def _strict(text: str):
    def bad(c):
        raise ValueError(f"JSON に {c} がある")
    return json.loads(text, parse_constant=bad)


def test_profiles_phase_writes_strict_json_with_production_shapes(trained):
    T.profiles_phase()
    rows = _strict((trained / "profiles.json").read_text())
    rec = _strict((trained / T.PROFILES_RECORD).read_text())
    assert {r["stage"] for r in rows} == {"exhibition", "racecard"}
    assert {r["finish_target"] for r in rows} == {1, 2, 3}
    # 1レースだけのセルは書かずに数える。null にした値は無い（原因の分かっている NaN は手前で扱う）
    assert rec["undefined_cells"] > 0
    assert rec["nonfinite_to_null"] == {}
    assert not any(r["venue_code"] == 24 and r["n_races"] == 1 for r in rows)
    # 全国の艇番1〜6には向きが付き、地元（0/1）の根拠の m_mid は null
    nat = [r for r in rows if (r["venue_code"], r["grade"], r["round"]) == (0, "all", "all")
           and r["boat_number"] > 0]
    assert len(nat) == 2 * 3 * 6
    branch = next(g for g in nat[0]["breakdown"]["racerProfile"] if g["key"] == "branch")
    assert "direction" in branch and branch["direction_basis"]["m_mid"] is None
    assert all(r["frame_ratio"] is not None for r in nat)
    assert set(rec["profiles_by_stage"]["directions"]) == {
        f"{s}|{ft}" for s in ("exhibition", "racecard") for ft in (1, 2, 3)}
