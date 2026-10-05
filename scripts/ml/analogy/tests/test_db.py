"""寄与度の古い版の消し方（db.py。レビュー指摘: 途中で失敗した版がロールバック先を押し出さない）"""

import db


def m(v, t, active=False):
    return {"model_version": v, "trained_at": t, "is_active": active}


def test_keeps_active_and_previous_success_drops_failed_leftover():
    # A が表示中だった → B が途中で失敗（is_active にならなかった）→ C が成功して表示中
    models = [m("C", "2026-10-19", True), m("B", "2026-10-12"), m("A", "2026-10-05")]
    # B は A より新しいが、表示されたことのない版。ロールバック先は A
    assert db.profile_versions_to_delete(models, previous_active="A") == ["B"]


def test_drops_versions_older_than_previous_active():
    models = [m("D", "2026-10-26", True), m("C", "2026-10-19"), m("B", "2026-10-12"),
              m("A", "2026-10-05")]
    assert db.profile_versions_to_delete(models, previous_active="C") == ["B", "A"]


def test_first_version_deletes_nothing():
    assert db.profile_versions_to_delete([m("A", "2026-10-05", True)], previous_active=None) == []


def overall(ft, shares):
    return {"finish_target": ft, "venue_code": 0, "grade": "all", "round": "all",
            "boat_number": 0, "shares": shares}


def test_share_drift_flags_large_change_between_versions():
    prev = [overall(1, {"a": 0.40, "b": 0.60})]
    new = [overall(1, {"a": 0.45, "b": 0.55}), overall(1, {"a": 0.9, "b": 0.1}) | {"venue_code": 3}]
    d = db.share_drift(prev, new, threshold=0.03)
    assert d["flagged"]
    assert d["changes"][0]["finish_target"] == 1
    assert abs(d["changes"][0]["max_abs_change"] - 0.05) < 1e-9


def test_share_drift_small_change_is_not_flagged_and_new_theme_counts_from_zero():
    prev = [overall(2, {"a": 0.50, "b": 0.50})]
    new = [overall(2, {"a": 0.49, "b": 0.49, "market": 0.02})]
    d = db.share_drift(prev, new, threshold=0.03)
    assert not d["flagged"]


def test_share_drift_without_previous_version():
    assert db.share_drift([], [overall(1, {"a": 1.0})], threshold=0.03) == {
        "flagged": False, "changes": [], "previous": None}


def test_share_drift_compares_same_stage_and_old_rows_are_exhibition():
    # 132 の前に書いた版の行には stage が無い（展示後）。出走表時点の段は前の版に無いので比べない
    prev = [overall(1, {"a": 0.50, "b": 0.50})]
    new = [overall(1, {"a": 0.51, "b": 0.49}) | {"stage": "exhibition"},
           overall(1, {"a": 0.9, "b": 0.1}) | {"stage": "racecard"}]
    d = db.share_drift(prev, new, threshold=0.03)
    assert not d["flagged"]
    assert [(c["stage"], c["finish_target"]) for c in d["changes"]] == [("exhibition", 1)]
