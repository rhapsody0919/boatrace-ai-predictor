"""品質ゲート（plan「品質ゲート（MD-7）」）。

比較の相手は「直前の版」ではなく「固定した参照版」（reference.json）。直前の版と比べると、
許容幅の中の小さな悪化が週ごとに積み重なっても止まらない（データサイエンス体制のレビュー、2026-10-02）。
1着だけでなく2着以内・3着以内にもゲートを置く。
"""

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
