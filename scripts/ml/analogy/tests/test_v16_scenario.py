"""v16 展開シナリオ（タブ3）の範囲ごとの集計 scenario（tasks T2-3）"""
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import v16_scenario as SC

WAKU = [1, 2, 3, 4, 5, 6]


def races(rows):
    """(course_by_boat, st_by_course, ranks, technique, payout)"""
    return pd.DataFrame({
        "race_id": [f"2026-09-0{i + 1}-20-12" for i in range(len(rows))],
        "race_date": [f"2026-09-0{i + 1}" for i in range(len(rows))], "venue_code": 20,
        "course_by_boat": [r[0] for r in rows], "st_by_course": [r[1] for r in rows],
        "rank1": [r[2][0] for r in rows], "rank2": [r[2][1] for r in rows], "rank3": [r[2][2] for r in rows],
        "winning_technique": [r[3] for r in rows], "payout_3tan": [r[4] for r in rows],
    })


@pytest.mark.parametrize("course, types", [
    (WAKU, {"all", "waku"}),
    ([2, 1, 3, 4, 5, 6], {"all", "inlost"}),
    ([1, 3, 4, 5, 6, 2], {"all", "mae", "mae6"}),
    ([1, 4, 5, 6, 2, 3], {"all", "mae", "mae56"}),
    ([1, 2, 4, 3, 5, 6], {"all", "mae", "maeOther"}),
    ([1, 2, 3, 6, 4, 5], {"all", "mae", "mae56"}),  # 4号艇は押し出されただけ（前付けに数えない）
])
def test_entry_types(course, types):
    e = SC.entry_types(np.array([course], dtype=float))
    assert {k for k, v in e.items() if v[0]} == types


def test_scope_cells_counts_and_rows():
    flat = [0.15, 0.16, 0.15, 0.17, 0.16, 0.15]
    kado = [0.15, 0.15, 0.16, 0.12, 0.18, 0.18]
    d = SC.prepare(races([
        (WAKU, flat, (1, 2, 3), "逃げ", 1230),
        (WAKU, kado, (4, 1, 5), "まくり", 15600),
        ([1, 3, 4, 5, 6, 2], flat, (1, 6, 2), None, None),
    ]))
    out = SC.scope_cells(np.array([True, True, True]), d)
    assert out["n"] == 3
    any_ = out["cells"]["all"]["forms"]["any"]
    assert any_["n"] == 3 and any_["first_boat"] == [2, 0, 0, 1, 0, 0]
    assert any_["technique"]["その他"] == 1 and any_["technique"]["まくり"] == 1
    assert any_["payout_known"] == 2 and any_["manshu"] == 1
    assert any_["b1_win"] == 2
    assert any_["tri"] == {"1-2-3": 1, "1-6-2": 1, "4-1-5": 1}
    assert any_["win_tech"]["4"]["まくり"] == 1
    assert [r["finish_1_2_3"] for r in any_["races"]] == ["1-2-3", "4-1-5", "1-6-2"]
    assert out["cells"]["waku"]["forms"]["kado"]["n"] == 1
    assert out["cells"]["mae6"]["forms"]["flat"]["n"] == 1
    assert out["cells"]["waku"]["forms"]["kado"]["races"][0]["forms"] == ["flat", "wall", "kado"]  # 形は重なる


def test_scope_cells_no_rows_when_30_or_more():
    d = SC.prepare(races([(WAKU, [0.15] * 6, (1, 2, 3), "逃げ", 500)] * 30))
    assert "races" not in SC.scope_cells(np.ones(30, bool), d)["cells"]["all"]["forms"]["any"]


def test_scope_hints_counts_waku_only():
    kado = [0.15, 0.15, 0.16, 0.12, 0.18, 0.18]
    flat = [0.15, 0.16, 0.15, 0.17, 0.16, 0.15]
    d = SC.prepare(races([(WAKU, kado, (4, 1, 2), "まくり", 900), (WAKU, flat, (1, 2, 3), "逃げ", 300),
                          ([2, 1, 3, 4, 5, 6], kado, (4, 1, 2), "まくり", 900)]))
    avg = np.array([[0.150, 0.150, 0.133, 0.127, 0.142, 0.176],   # kado4 あり
                    [0.150, 0.150, 0.150, 0.160, 0.150, 0.150],   # kado4 なし
                    [0.150, 0.150, 0.133, 0.127, 0.142, 0.176]])  # 枠なりでないので数えない
    out = SC.scope_hints(np.ones(3, bool), d, {"course": avg})
    assert out["course"]["kado4"]["kado"] == {"hit": [1, 1], "miss": [0, 1]}
    assert out["course"]["kado4"]["any"] == {"hit": [1, 1], "miss": [1, 1]}


def test_hint_matrix_matches_scalar_definition():
    import v16_defs as V
    rng = np.random.default_rng(0)
    a = np.round(rng.uniform(0.08, 0.25, size=(200, 6)), 3)
    m = SC.hint_matrix(a)
    for i in range(len(a)):
        assert {k: bool(v[i]) for k, v in m.items()} == V.hint_conditions(a[i])


def test_scope_attack_small():
    forms = {f: np.zeros(3, bool) for f in SC.SLIT_FORMS}
    forms["kado"][:] = [True, True, False]
    r1, r2 = np.array([4, 1, 1]), np.array([1, 4, 2])
    tech = np.array(["まくり", "逃げ", "逃げ"], dtype=object)
    motor = np.array([[6, 5, 4, 1, 3, 2], [1, 2, 3, 6, 4, 5], [1, 2, 3, 4, 5, 6]], dtype=float)
    exh = np.full((3, 6), np.nan)
    cent = np.array([[15, 15, 16, 10, 18, 18], [15, 15, 16, 12, 18, 18], [15] * 6])
    out = SC.scope_attack(np.ones(3, bool), forms, r1, r2, tech, motor, exh, cent)
    k = out["kado"]
    assert k["attacker"] == 4 and k["all"]["att_win"] == [1, 2] and k["all"]["att_makuri"] == [1, 2]
    assert k["all"]["b1_nige"] == [1, 2] and k["all"]["inner_top2"] == [0, 2]
    assert k["by_motor"]["top"]["att_win"] == [1, 1] and k["by_motor"]["low"]["att_win"] == [0, 1]
    assert k["by_exh"]["top"]["n"] == 0  # 展示タイムがそろわない
    assert k["att_lead"] == [1, 2]       # 3号艇より 0.05 秒以上前（16−10=6、16−12=4）
    assert "att_lead" not in out["d1"] and out["flat"]["attacker"] is None
    # 凹みでは出さない（両隣より遅いので、攻める艇が前に出た割合は定義から100%。BOA-777）
    assert all("att_lead" not in out[f] for f in ("d1", "d2", "d3"))



def test_boat_scope_counts_only_the_masked_races_for_the_boat():
    """艇ごとの範囲（BOA-806）: マスクのレースだけで、その艇の1〜3着と、攻める艇の形の③の表・外の艇の1着を持つ"""
    flat = [0.15, 0.16, 0.15, 0.17, 0.16, 0.15]
    kado = [0.15, 0.15, 0.16, 0.12, 0.18, 0.18]
    rs = races([(WAKU, kado, (4, 1, 5), "まくり", 900), (WAKU, kado, (5, 4, 1), "まくり差し", 3000),
                (WAKU, flat, (1, 4, 2), "逃げ", 300), (WAKU, kado, (4, 2, 3), "まくり", 1200)])
    d = SC.prepare(rs)
    m = np.array([True, True, True, False])  # 4レース目は範囲の外（4号艇の級が今日と違う）
    nan = np.full((4, 6), np.nan)
    attack = SC.scope_attack(m & d["entries"]["waku"], d["forms"], d["ranks"][:, 0], d["ranks"][:, 1], d["tech"],
                             nan, nan, np.full((4, 6), 15))
    out = SC.boat_scope(m, d, 4, attack)
    assert out["boat"] == 4 and out["n"] == 3
    assert out["cells"]["all"]["any"] == [3, 1, 2, 0]   # 件数, 1着, 2着, 3着
    assert out["cells"]["waku"]["kado"] == [2, 1, 1, 0]
    assert out["cells"]["waku"]["d1"] == [0, 0, 0, 0]
    assert set(out["attack"]) == {"kado", "d3", "dash"}  # 4号艇が攻める艇の形だけ
    assert out["attack"]["kado"]["all"]["att_win"] == [1, 2]
    assert out["winner"]["kado"] == [1, 2] and out["winner"]["flat"] == [1, 3]  # 形は重なる（カドの2件も平ら）
    assert SC.boat_scope(m, d, 5, attack)["winner"]["kado"] == [1, 2]  # 攻める4号艇のすぐ外


# ---- モックの入力（アーカイブの slitpred・knn/work2）があるときだけ: slit-hint/mark1.py の mark1.json と一致する
MOCK = Path(os.environ["ANALOGY_MOCK_DIR"]) if os.environ.get("ANALOGY_MOCK_DIR") else None


@pytest.mark.skipif(MOCK is None, reason="モックの入力が無い")
def test_scope_attack_matches_mock_mark1():
    import importlib.util
    spec = importlib.util.spec_from_file_location("mock_load", MOCK / "slitpred/load.py")
    L = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(L)
    r, _ = L.load()
    b = np.load(MOCK / "knn/work2/boats.npz", allow_pickle=True)
    sm, sr = b["st_mean30"], b["st_result"]
    ret = (b["is_flying"] | b["is_late"]).any(1)
    pop = ((r.race_date <= pd.Timestamp("2026-09-26")).values & r.waku.values & ~ret
           & ~np.isnan(sr).any(1) & ~np.isnan(sm).any(1))
    tk = {}
    for f, src in (("tkA", "kb"), ("tkB", "kb"), ("tkM", "main")):
        for t in (MOCK / f"slitpred/raw/{f}.txt").read_text().split(","):
            tk[(src, t[:6], int(t[6:8]))] = t[8:]
    ymd = r.race_date.dt.strftime("%y%m%d").values
    srcs = np.where(r.race_date <= pd.Timestamp("2025-12-02"), "kb", "main")
    code = {"N": "逃げ", "M": "まくり", "S": "差し", "X": "まくり差し", "B": "抜き", "E": "恵まれ", "O": "その他"}
    tech = np.full(len(r), None, dtype=object)
    for i in np.where(pop)[0]:
        s = tk.get((srcs[i], ymd[i], int(r.venue_code.values[i])))
        if s is not None:
            tech[i] = code.get(s[int(r.race_number.values[i]) - 1])
    idx = np.where(pop)[0]
    cent = np.full(sr.shape, -999, int)
    cent[idx] = np.round(sr[idx] * 100).astype(int)
    F8 = np.zeros((len(r), 8), bool)
    F8[idx] = L.forms(cent[idx])
    forms = {f: F8[:, j] for j, f in enumerate(SC.SLIT_FORMS)}
    cls = b["cls_ord"]
    scopes = {"nat": pop, "wkA1": pop & (r.venue_code.values == 20) & (cls == 4).all(1)}
    exp = json.loads((MOCK / "slitpred/mark1.json").read_text())
    r1, r2 = r.rank1.values.astype(int), r.rank2.values.astype(int)
    for s, m in scopes.items():
        got = json.loads(json.dumps(SC.scope_attack(m, forms, r1, r2, tech, b["motor_2_rank"], b["exh_time_rank"],
                                                    cent)))
        for f in SC.SLIT_FORMS:
            e = exp["forms"][f]
            for key in ("all", "by_motor", "by_exh", "b1_by_motor", "b1_by_exh"):
                if s in e.get(key, {}):
                    assert got[f][key] == e[key][s], (s, f, key)
            if s == "nat":
                assert got[f]["overlap"] == e["overlap"], f
                if "att_lead" in got[f]:
                    assert got[f]["att_lead"] == e["att_lead"], f
        assert got["any_form"] == exp["any_form"][s]


def test_exhibition_agreement_counts_entry_and_forms():
    races = pd.DataFrame({
        "race_id": ["a", "b", "c"], "race_date": ["2026-04-10", "2026-05-01", "2026-09-26"],
        "course_by_boat": [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 3, 4, 5, 6, 2]],
        "st_by_course": [[0.15, 0.20, 0.15, 0.15, 0.15, 0.15], [0.15] * 6, [0.15] * 6],
    })
    exh = pd.DataFrame({
        "race_id": ["a", "b", "c", "z"],
        "exh_course_by_boat": [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]],
        "exh_st_by_course": [[0.15, 0.21, 0.15, 0.15, 0.15, 0.15], [0.15, 0.21, 0.15, 0.15, 0.15, 0.15], [None] * 6,
                             [0.1] * 6],
    })
    out = SC.exhibition_agreement(races, exh)
    assert out["n"] == 3 and out["period"] == ["2026-04-10", "2026-09-26"]
    assert out["entry"]["waku"] == [2, 3]          # 展示は3件とも枠なり、本番は2件
    assert out["forms_n"] == 2                     # 展示 ST が欠ける c は形の母数に入れない
    assert out["forms"]["d2"] == {"hit": [1, 2], "miss": [0, 0]}


def test_exhibition_agreement_flying_rule():
    # 展示の F.05 までは .00 として形を判定し、F.06 以上の艇がいる展示は形の母数に入れない（Q-F6）
    races = pd.DataFrame({
        "race_id": ["s", "d"], "race_date": ["2026-09-01", "2026-09-02"],
        "course_by_boat": [[1, 2, 3, 4, 5, 6]] * 2,
        "st_by_course": [[0.15, 0.20, 0.15, 0.15, 0.15, 0.15]] * 2,
    })
    exh = pd.DataFrame({
        "race_id": ["s", "d"],
        "exh_course_by_boat": [[1, 2, 3, 4, 5, 6]] * 2,
        # s: 1コース F.05 → .00、2コース .05 は両隣（.00・.00）より .05 遅いので 2コース凹み
        # d: 3コース F.09 → 形を判定しない（旧扱いでは 2コース .01 − min(.07, −.09) で 2コース凹みになっていた）
        "exh_st_by_course": [[-0.05, 0.05, 0.0, 0.10, 0.10, 0.10], [0.07, 0.01, -0.09, 0.12, 0.12, 0.12]],
    })
    out = SC.exhibition_agreement(races, exh)
    assert out["forms_n"] == 1
    assert out["forms"]["d2"] == {"hit": [1, 1], "miss": [0, 0]}

