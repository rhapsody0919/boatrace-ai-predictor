"""品質ゲート（plan「品質ゲート（MD-7）」）"""

import train as T


def win(ci_hi, model=1.20):
    return {"logloss_model": model, "paired_logloss_model_minus_baseline": {"ci95": [-0.2, ci_hi]}}


def test_passes_when_beating_baseline_without_previous_version():
    g = T.quality_gate(win(-0.1), prev_logloss=None)
    assert g["passed"] and g["previous"] == "none"


def test_fails_when_not_significantly_better_than_baseline():
    g = T.quality_gate(win(0.001), prev_logloss=None)
    assert not g["passed"]
    assert "基準1" in g["reasons"][0]


def test_fails_when_worse_than_active_version_by_threshold():
    g = T.quality_gate(win(-0.1, model=1.206), prev_logloss=1.200)
    assert not g["passed"]
    assert "前の版" in g["reasons"][0]


def test_small_degradation_is_allowed():
    g = T.quality_gate(win(-0.1, model=1.204), prev_logloss=1.200)
    assert g["passed"]
