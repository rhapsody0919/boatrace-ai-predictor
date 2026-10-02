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
