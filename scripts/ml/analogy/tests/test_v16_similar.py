"""v16 類似レースの層と距離（tasks T2-4）"""
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import v16_similar as S


def test_gap_band_edges_and_missing():
    nat = np.array([
        [5.00, 6.91, 1, 1, 1, 1],   # −1.91 → 帯1（ちょうどは上の帯）
        [5.00, 6.92, 1, 1, 1, 1],   # −1.92 → 帯0
        [6.19, 6.00, 1, 1, 1, 1],   # +0.19 → 帯4
        [6.18, 6.00, 1, 1, 1, 1],   # +0.18 → 帯3
        [np.nan, 6.0, 1, 1, 1, 1],  # 勝率なし → 5
    ])
    assert S.gap_band(nat).tolist() == [1, 0, 4, 3, 5]


def test_top_boat_ties_to_smaller_number():
    assert S.top_boat(np.array([[5.0, 7.0, 7.0, 1, np.nan, 2]])).tolist() == [2]


def test_layer_conditions_round_and_grade_only_when_relevant():
    c = S.layer_conditions("A1", 1, 4, "yusho", "G1")
    assert c == {"b1_class": "A1", "gap_band": 1, "top_boat": 4, "round": "yusho", "grade_g1plus": True}
    c = S.layer_conditions("A1", 1, 4, "yosen", "G2")
    assert c["round"] is None and c["grade_g1plus"] is False


def test_layer_mask():
    cond = S.layer_conditions("A1", 1, 4, "yusho", "SG")
    m = S.layer_mask(cond, ["A1", "A1", "A1", "A2", "A1"], [1, 1, 1, 1, 1], [4, 4, 4, 4, 4],
                     ["yusho", "yusho", "junyu", "yusho", "yusho"], ["G1", None, "SG", "SG", "G2"])
    assert m.tolist() == [True, False, False, False, False]


def test_rank_layer_venue_penalty_and_k():
    X = np.array([[0.0], [0.1], [0.2], [0.3]], np.float32)
    idx, d2, d2p = S.rank_layer(X, np.array([0.0], np.float32), np.array([1, 2, 1, 1]), 1, lam=1.0,
                                mask=np.array([False, True, True, True]), k=2)
    assert idx.tolist() == [2, 3]  # 会場が違う1は +1 で後ろへ
    assert d2p.tolist() == pytest.approx([0.04, 0.09])


def test_shap_weights_center_within_race():
    contrib = np.array([[1.0, 0], [3.0, 0], [2, 0], [2, 0], [2, 0], [2, 0]])  # 1特徴量＋bias、1レース
    w = S.shap_weights(contrib, ["f"])
    assert w["f"] == pytest.approx([1.0, 1.0, 0, 0, 0, 0])


# ---- モックの入力（アーカイブの knn/work5）があるときだけ: knn7（展示前）の例のレースの層14件の並びと距離を再現する
MOCK = Path(os.environ["ANALOGY_MOCK_DIR"]) if os.environ.get("ANALOGY_MOCK_DIR") else None


@pytest.mark.skipif(MOCK is None, reason="モックの入力が無い")
def test_matches_mock_knn7():
    W = MOCK / "knn/work5"
    r = pd.read_pickle(W / "races.pkl")
    B = dict(np.load(W / "boats.npz"))
    search = json.loads((W / "search.json").read_text())
    weights = json.loads((W / "weights.json").read_text())["weights"]
    boat_num = search["variants"]["racecard"]["boat_num_features"]
    pool = r["is_pool"].to_numpy()
    qi = int(np.where(r["is_query"])[0][0])
    X0, meta, norm, cats = S.build_z(B, r, boat_num, "racecard", pool)
    X = X0 * S.weight_vector(meta, weights)
    rd = r["race_date"]
    pool_cal = np.where((rd >= "2019-04-01") & (rd <= "2025-05-31") & pool)[0]
    cal = np.where((rd >= "2025-06-01") & (rd <= "2025-12-02") & pool)[0]
    L = S.lambda_base(X, pool_cal, cal)
    assert L == pytest.approx(0.3534, abs=1e-4)
    cls = {4.0: "A1", 3.0: "A2", 2.0: "B1", 1.0: "B2"}
    b1 = pd.Series(B["cls_ord"][:, 0]).map(cls).to_numpy()
    gap, top = S.gap_band(B["nat_win"]), S.top_boat(B["nat_win"])
    grade = r["grade"].to_numpy(dtype=object)
    cond = S.layer_conditions(b1[qi], gap[qi], top[qi], r["round"].iat[qi], grade[qi])
    m = S.layer_mask(cond, b1, gap, top, r["round"].to_numpy(), grade) & pool
    idx, _, d2p = S.rank_layer(X, X[qi], r["venue_code"].astype(int).to_numpy(), int(r["venue_code"].iat[qi]),
                               L * S.LAM_MULT, m, 800)
    exp = json.loads((MOCK / "knn/knn7.json").read_text())["neighbors"]
    ids = [S_id for S_id in r["race_id"].iloc[idx].map(lambda v: f"{str(v)[:4]}-{str(v)[4:6]}-{str(v)[6:8]}-"
                                                                 f"{str(v)[8:10]}-{str(v)[10:12]}")]
    assert ids == [n["race_id"] for n in exp]
    assert np.round(np.sqrt(d2p), 3).tolist() == pytest.approx([n["distance"] for n in exp], abs=1e-3)


@pytest.mark.skipif(MOCK is None, reason="モックの入力が無い")
def test_item_levels_match_mock_knn7():
    W = MOCK / "knn/work5"
    r = pd.read_pickle(W / "races.pkl")
    B = dict(np.load(W / "boats.npz"))
    pool = r["is_pool"].to_numpy()
    qi = int(np.where(r["is_query"])[0][0])
    venue = r["venue_code"].astype(int).to_numpy()
    clusters = S.venue_clusters(venue, r["rank1"].to_numpy(), pool)
    is_kb = r["race_date"].to_numpy() <= np.datetime64("2025-12-02")
    lv = S.item_levels(r, B, qi, clusters, is_kb)
    exp = json.loads((MOCK / "knn/knn7.json").read_text())
    assert list(lv) == [s["key"] for s in exp["similarity"]]
    pos = pd.Series(np.arange(len(r)), index=r["race_id"].map(lambda v: f"{str(v)[:4]}-{str(v)[4:6]}-{str(v)[6:8]}-"
                                                                          f"{str(v)[8:10]}-{str(v)[10:12]}"))
    for nb in exp["neighbors"]:
        i = pos[nb["race_id"]]
        got = {k: (None if v[i] == -1 else int(v[i])) for k, v in lv.items()}
        assert got == nb["item_match"], nb["race_id"]
    for s in exp["similarity"]:
        assert float((lv[s["key"]][pool] == 2).mean()) == pytest.approx(s["pool_rate"]), s["key"]


def test_compare_conditions():
    c = S.layer_conditions("A1", 1, 4, "yusho", "G1")
    assert S.compare_conditions(c) == (c | {"grade_g1plus": False}, "grade")
    c = S.layer_conditions("A1", 1, 4, "junyu", "ippan")
    assert S.compare_conditions(c) == (c | {"round": None}, "round")
    c = S.layer_conditions("B1", 2, 1, "yosen", "ippan")
    assert S.compare_conditions(c) == (c, "none")


def test_display_columns_rounds_and_hides_final_day_of_long_term():
    races = pd.DataFrame({"race_number": [12.0, 1.0], "series_day": [6.0, 1.0], "is_final_day_num": [1.0, 0.0],
                          "weather_code": [1.0, np.nan], "wind_speed": [1.4, 3.0], "wind_x": [-1.04, 0.0],
                          "wind_y": [0.0, 2.0], "wave_height": [1.0, 5.0], "grade": ["G1", None],
                          "round": ["yusho", "yosen"], "venue_code": [20, 2]})
    six = lambda a, b: np.array([[a] * 6, [b] * 6], dtype=float)  # noqa: E731
    boats = {c: six(1.234, np.nan) for _, c, _ in S.DISPLAY_BOAT}
    cols = S.display_columns(races, boats, np.array([1, 0]), np.array([False, True]))
    assert cols["final"] == [None, 1]            # 長期（is_kb）の最終日は使えない
    assert cols["nat"][1] == [1.23] * 6 and cols["nat"][0] == [None] * 6
    assert cols["weather"] == [None, 1] and cols["wx"] == [0.0, -1.0] and cols["grade"] == [None, "G1"]
    assert S.display_row(cols, 1)["rn"] == 12 and S.display_row(cols, 1)["venue"] == 20
