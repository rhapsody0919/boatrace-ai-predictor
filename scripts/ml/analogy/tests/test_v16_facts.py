"""v16 タブ1の範囲ごとの集計 facts（tasks T2-2）"""
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import v16_facts as F


def test_scope_facts_small():
    # 3レース。全国勝率（大きいほど良い）、1号艇の値: 最良・最悪・欠損
    nat = np.array([[7.0, 6, 5, 4, 3, 2], [2.0, 6, 5, 4, 3, 7], [np.nan, 6, 5, 4, 3, 2]])
    ranks = np.array([[1, 2, 3], [2, 1, 3], [1, 3, 2]])
    prep = F.prepare({"nat_win": nat})
    f = F.scope_facts(np.array([True, True, True]), prep, ranks, wind_speed=np.array([0, 3, 7]))
    assert f["n"] == 3
    assert f["usual"]["1"]["win"] == [2, 3]
    by = f["by"]["1"]["nat_win"]
    assert by["1"]["win"] == [1, 1]          # 最良のレース（1つ）で1着
    assert by["6"]["top2"] == [1, 1]         # 最悪のレースで2着
    assert by["2"]["win"] == [0, 0]
    # 来たときの平均の順位: 1着は1レース目（1位）だけ（3レース目は値が無い）
    assert f["typ"]["1"]["nat_win"]["win"] == 1.0
    assert f["typ"]["1"]["nat_win"]["top3"] == pytest.approx((1 + 6) / 2)
    assert f["wind"]["0-1"]["1"]["win"] == [1, 1]
    assert f["wind"]["6+"]["1"]["win"] == [1, 1]
    assert f["wind"]["4-5"]["1"]["win"] == [0, 0]


def test_scope_facts_mask_and_empty():
    nat = np.array([[7.0, 6, 5, 4, 3, 2]] * 2)
    f = F.scope_facts(np.array([False, False]), F.prepare({"nat_win": nat}), np.array([[1, 2, 3]] * 2))
    assert f["n"] == 0 and f["typ"]["1"]["nat_win"]["win"] is None
    assert "wind" not in f


# ---- モックの入力（アーカイブ）があるときだけ: 同じ入力で mock-v16/tab1_facts.py の出力 tab1.json と一致する
MOCK = Path(os.environ["ANALOGY_MOCK_DIR"]) if os.environ.get("ANALOGY_MOCK_DIR") else None


@pytest.mark.skipif(MOCK is None, reason="モックの入力（knn/work2・tab1）が無い")
def test_matches_mock_tab1_json():
    r = pd.read_pickle(MOCK / "knn/work2/races.pkl")
    B = dict(np.load(MOCK / "knn/work2/boats.npz"))
    sr = pd.read_pickle(MOCK / "tab1/series_score_rows.pkl")
    ss = np.full((len(r), 6), np.nan)
    pos_of = pd.Series(np.arange(len(r)), index=r["race_id"].to_numpy())
    sub = sr[sr["race_id"].isin(pos_of.index)]
    ss[pos_of[sub["race_id"]].to_numpy(), sub["boat_number"].astype(int).to_numpy() - 1] = sub["value"].to_numpy()
    values = {item: B[item] for item, _ in F.ITEMS if item in B} | {"series_score": ss}
    prep = F.prepare(values)
    ranks = np.stack([r["rank1"], r["rank2"], r["rank3"]], 1)
    pool = r["is_pool"].to_numpy()
    venue = r["venue_code"].astype(int).to_numpy()
    a1 = (B["cls_ord"] == 4).all(1)
    scopes = {"wk": pool & (venue == 20), "wkA1": pool & (venue == 20) & a1, "natA1": pool & a1,
              "natA1Y": pool & a1 & (r["round"].to_numpy() == "yusho")}
    expected = json.loads((MOCK / "tab1/tab1.json").read_text())["scopes"]
    for key, m in scopes.items():
        got = json.loads(json.dumps(F.scope_facts(m, prep, ranks)))
        exp = expected[key]
        assert got["n"] == exp["n"], key
        assert got["usual"] == exp["usual"], key
        assert got["by"] == exp["by"], key
        for b in exp["typ"]:
            for item in exp["typ"][b]:
                for t, v in exp["typ"][b][item].items():
                    assert got["typ"][b][item][t] == (pytest.approx(v) if v is not None else None), (key, b, item, t)
