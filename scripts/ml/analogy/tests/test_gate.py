"""品質ゲート（plan「品質ゲート（MD-7）」）。

比較の相手は「直前の版」ではなく「固定した参照版」（reference.json）。直前の版と比べると、
許容幅の中の小さな悪化が週ごとに積み重なっても止まらない（データサイエンス体制のレビュー、2026-10-02）。
1着だけでなく2着以内・3着以内にもゲートを置く。
"""

import pytest

import train as T


def win(ci_hi=-0.1, model=1.20):
    return {"logloss_model": model,
            "paired_logloss_model_minus_baseline": {"ci95": [-0.2, ci_hi]}}


def topk(ci_hi=-0.1, model=0.50):
    return {"logloss_per_boat_model": model,
            "paired_race_logloss_model_minus_baseline": {"ci95": [-0.3, ci_hi]}}


def metrics(w=None, t2=None, t3=None):
    return {"win": w or win(), "top2": t2 or topk(), "top3": t3 or topk(model=0.56)}


def test_passes_when_beating_baselines_without_reference():
    g = T.quality_gate(metrics(), reference=None)
    assert g["passed"] and g["reference"] == "none"


def test_fails_when_win_not_significantly_better_than_baseline():
    g = T.quality_gate(metrics(w=win(ci_hi=0.001)), reference=None)
    assert not g["passed"]
    assert any("1着" in r and "基準" in r for r in g["reasons"])


def test_fails_when_top3_not_significantly_better_than_baseline():
    g = T.quality_gate(metrics(t3=topk(ci_hi=0.0)), reference=None)
    assert not g["passed"]
    assert any("3着以内" in r for r in g["reasons"])


def test_fails_when_worse_than_reference_version():
    ref = {"version": "2026-10-02", "win": 1.200, "top2": 0.50, "top3": 0.56}
    g = T.quality_gate(metrics(w=win(model=1.206)), reference=ref)
    assert not g["passed"]
    assert any("参照版" in r and "1着" in r for r in g["reasons"])


def test_fails_when_top2_worse_than_reference_version():
    ref = {"version": "2026-10-02", "win": 1.200, "top2": 0.50, "top3": 0.56}
    g = T.quality_gate(metrics(t2=topk(model=0.503)), reference=ref)
    assert not g["passed"]
    assert any("参照版" in r and "2着以内" in r for r in g["reasons"])


def test_small_degradation_against_reference_is_allowed():
    ref = {"version": "2026-10-02", "win": 1.200, "top2": 0.50, "top3": 0.56}
    g = T.quality_gate(metrics(w=win(model=1.204), t2=topk(model=0.5015)), reference=ref)
    assert g["passed"]
    assert g["reference"]["version"] == "2026-10-02"


def test_stale_reference_warns_but_does_not_fail():
    """参照版は時間とともに見ていないデータが増え、評価が自然に悪くなる（ゲートが実質緩む）。
    学習の終わりから半年を過ぎたら更新を促す（止めはしない。レビュー指摘 P2）。"""
    ref = {"version": "2026-10-02", "win": 1.200, "top2": 0.50, "top3": 0.56, "age_days": 200}
    g = T.quality_gate(metrics(), reference=ref)
    assert g["passed"]
    assert any("参照版" in w and "更新" in w for w in g["warnings"])


def test_fresh_reference_has_no_warning():
    ref = {"version": "2026-10-02", "win": 1.200, "top2": 0.50, "top3": 0.56, "age_days": 90}
    assert T.quality_gate(metrics(), reference=ref)["warnings"] == []


# ---------------------------------------------------------------- 出走表時点専用モデル win_racecard（ADR 案（#1134「レースごとの寄与度」））
def with_racecard(rc=None):
    m = metrics()
    m["win_racecard"] = rc or win(model=1.21)
    return m


def test_racecard_not_beating_baseline_fails():
    g = T.quality_gate(with_racecard(win(ci_hi=0.001)), reference=None)
    assert not g["passed"] and any("出走表時点" in r for r in g["reasons"])


def test_racecard_missing_from_reference_is_skipped_with_warning():
    ref = {"version": "2026-10-02", "win": 1.20, "top2": 0.50, "top3": 0.56, "win_racecard": None}
    g = T.quality_gate(with_racecard(), reference=ref)
    assert g["passed"]
    assert g["reference"]["deltas"]["win_racecard"] is None
    assert any("比較なし" in w for w in g["warnings"])


def test_racecard_worse_than_reference_fails_once_reference_has_it():
    ref = {"version": "2026-11-01", "win": 1.20, "top2": 0.50, "top3": 0.56, "win_racecard": 1.20}
    g = T.quality_gate(with_racecard(win(model=1.21)), reference=ref)
    assert not g["passed"]


def test_win_missing_from_reference_is_still_an_error():
    ref = {"version": "2026-10-02", "win": None, "top2": 0.50, "top3": 0.56}
    with pytest.raises(RuntimeError, match="黙って省かない"):
        T.quality_gate(metrics(), reference=ref)


def test_racecard_models_are_separate_from_targets():
    """出走表時点の3本は TARGETS と別（profiles は段ごとに着順1〜3を1回ずつ作る）"""
    rc = [n for n, *_ in T.RACECARD]
    assert rc == ["win_racecard", "top2_racecard", "top3_racecard"]
    assert not set(rc) & {n for n, *_ in T.TARGETS}
    assert sorted(ft for _, _, ft, _ in T.RACECARD) == sorted(ft for _, _, ft, _ in T.TARGETS) == [1, 2, 3]
    # 追記B: 木の数は展示後の同じ着順と同じ
    assert [r for *_, r in T.RACECARD] == [r for *_, r in T.TARGETS]


def test_top_racecard_not_beating_baseline_fails():
    m = metrics()
    m["top3_racecard"] = topk(ci_hi=0.002)
    g = T.quality_gate(m, reference=None)
    assert not g["passed"] and any("3着以内（出走表時点）" in r for r in g["reasons"])


def test_top_racecard_missing_from_reference_is_skipped():
    m = metrics()
    m["top2_racecard"] = topk()
    ref = {"version": "2026-10-02", "win": 1.20, "top2": 0.50, "top3": 0.56}
    g = T.quality_gate(m, reference=ref)
    assert g["passed"] and g["reference"]["deltas"]["top2_racecard"] is None


def test_reference_age_is_between_training_period_ends():
    """参照版の古さは学習期間の終わり同士で測る。同じ週に学習した版は0日近くで、警告は出ない
    （以前は今回の test の最終日までで測り、同じ週の版でも約456日で毎週警告が出ていた）"""
    import pandas as pd
    current_fit_end = pd.Timestamp("2025-07-05")
    assert T.reference_age_days("2025-07-05", current_fit_end) == 0
    assert T.reference_age_days("2025-07-05", pd.Timestamp("2026-01-10")) == 189
    ref = {"version": "2026-10-06", "win": 1.200, "top2": 0.50, "top3": 0.56,
           "age_days": T.reference_age_days("2025-07-05", current_fit_end)}
    assert T.quality_gate(metrics(), reference=ref)["warnings"] == []
