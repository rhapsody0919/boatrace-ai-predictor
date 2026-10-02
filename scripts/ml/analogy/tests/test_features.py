"""as-of・リーク防止・ラウンド区分・ラベルの約束（plan「as-of」、tasks T2-3）"""

import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import features as F
from themes import FEATURES, THEMES, theme_features

ROOT = Path(__file__).resolve().parents[4]


def boats(rows):
    """(racer_id, race_date, race_number, finish_rank, st) の行から、履歴の計算に要る最小の表を作る。"""
    df = pd.DataFrame(rows, columns=["racer_id", "race_date", "race_number", "finish_rank", "st_result"])
    df["race_date"] = pd.to_datetime(df["race_date"])
    df["race_id"] = (df["race_date"].dt.strftime("%Y%m%d").astype("int64") * 10000
                     + 100 + df["race_number"])
    df["is_flying"] = False
    df["is_late"] = False
    return df


# ---------------------------------------------------------------- as-of（日単位でずらす）
def test_same_day_earlier_race_result_is_not_used():
    """同じ日の前のレースの結果は、同じ日の後のレースの特徴量に入らない。"""
    hist = [(1, f"2026-01-{d:02d}", 1, 6, 0.20) for d in range(1, 11)]  # 前日までは10走すべて6着
    today = [(1, "2026-01-11", 2, 1, 0.01), (1, "2026-01-11", 9, 1, 0.01)]  # 当日は1着・ST 0.01
    df = F.add_history(boats(hist + today))
    d = df[df["race_date"] == "2026-01-11"].sort_values("race_number")
    assert d["recent_win30"].tolist() == [0.0, 0.0]
    assert d["st_mean30"].tolist() == pytest.approx([0.2, 0.2])
    assert d["st_n"].tolist() == [10, 10]


def test_previous_day_results_are_used():
    hist = [(1, f"2026-01-{d:02d}", 1, 1 if d % 2 else 4, 0.10) for d in range(1, 11)]
    df = F.add_history(boats(hist + [(1, "2026-01-11", 1, 1, 0.3)]))
    last = df[df["race_date"] == "2026-01-11"].iloc[0]
    assert last["recent_win30"] == pytest.approx(0.5)
    assert last["recent_top3_30"] == pytest.approx(0.5)


def test_history_ignores_flying_and_late_st():
    rows = [(1, f"2026-01-{d:02d}", 1, 3, 0.15) for d in range(1, 5)]
    df = boats(rows + [(1, "2026-01-05", 1, 3, -0.02), (1, "2026-01-06", 1, 3, 0.15)])
    df.loc[df["race_date"] == "2026-01-05", "is_flying"] = True
    out = F.add_history(df)
    assert out.loc[out["race_date"] == "2026-01-06", "st_mean30"].iloc[0] == pytest.approx(0.15)


def test_history_does_not_mix_racers():
    df = boats([(1, "2026-01-01", 1, 1, 0.1)] * 5 + [(2, "2026-01-02", 1, 6, 0.2)])
    df.loc[df.index[:5], "race_date"] = pd.to_datetime(
        ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"])
    df["race_id"] = np.arange(len(df))
    out = F.add_history(df)
    assert np.isnan(out.loc[out["racer_id"] == 2, "recent_win30"].iloc[0])


# ---------------------------------------------------------------- 特徴量に結果側の列を入れない
RESULT_COLUMNS = {"finish_rank", "st_result", "is_flying", "is_late", "actual_course",
                  "course", "winning_technique", "technique", "y_win", "y_top2", "y_top3",
                  "payout_3tan", "payout_trio"}


def test_features_have_no_result_columns():
    assert not RESULT_COLUMNS & set(FEATURES)


def test_theme_features_are_unique():
    all_f = [f for t in THEMES for f in theme_features(t)]
    assert len(all_f) == len(set(all_f))
    assert len({t["key"] for t in THEMES}) == len(THEMES)


# ---------------------------------------------------------------- ラウンド区分（raceStageConfig.js と一致）
STAGES = ["予選", "一般戦", "準優勝戦", "優勝戦", "準々優勝戦", "準優進出戦", "ツッキー優勝戦",
          "ＭＤ優勝戦", "ドリーム戦", "ペイペイDR", "予選特賞", "予選特選", "一般特選", "一般特賞",
          "選抜戦", "記者選抜戦", "特別選抜戦", "予選ドリーム戦", "予選選抜", "一般選抜",
          "朝からセンプル", "サンライズX戦", "カタメン１予選", "特選", "団体・優勝戦", "一般", ""]

CATEGORY_TO_ROUND = {"qualifier": "yosen", "qualifierSpecial": "yosen", "semifinal": "junyu",
                     "final": "yusho"}


def js_categories(stages):
    script = (
        "import { getRaceStageCategory } from './src/constants/raceStageConfig.js';"
        "const input = JSON.parse(process.argv[1]);"
        "console.log(JSON.stringify(input.map((s) => getRaceStageCategory(s)?.key ?? null)));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script, json.dumps(stages)],
                         cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_round_matches_race_stage_config_js():
    cats = js_categories(STAGES)
    for stage, cat in zip(STAGES, cats):
        expected = None if cat is None and stage == "" else CATEGORY_TO_ROUND.get(cat, "other")
        assert F.round_from_stage(stage) == expected, (stage, cat)


def test_round_unknown_stage_is_none():
    assert F.round_from_stage(None) is None
    assert F.round_from_stage(np.nan) is None


def test_round_from_kb_stage_kind():
    assert F.round_from_kb_kind("qualifier") == "yosen"
    assert F.round_from_kb_kind("semifinal") == "junyu"
    assert F.round_from_kb_kind("final") == "yusho"
    assert F.round_from_kb_kind("other") == "other"
    assert F.round_from_kb_kind(None) is None


# ---------------------------------------------------------------- ラベル・完全レース
def race(finish, flying=()):
    df = pd.DataFrame({"race_id": 1, "boat_number": range(1, 7), "finish_rank": finish,
                       "is_flying": [b in flying for b in range(1, 7)], "is_late": False,
                       "race_ok": True})
    return df


def test_labels_complete_race():
    out = F.add_labels(race([1, 2, 3, 4, 5, 6]))
    assert out["race_ok"].all()
    assert out["y_win"].tolist() == [1, 0, 0, 0, 0, 0]
    assert out["y_top2"].sum() == 2 and out["y_top3"].sum() == 3


def test_race_with_returned_boat_in_top3_is_excluded():
    """本体の rank は返還艇も公式の並びのまま入る（例 2026-03-02-24-09 は F の1号艇が rank3）。"""
    out = F.add_labels(race([3, 1, 2, 4, 5, 6], flying=(1,)))
    assert not out["race_ok"].any()


def test_race_with_returned_boat_outside_top3_is_kept():
    out = F.add_labels(race([1, 2, 3, np.nan, 4, 5], flying=(4,)))
    assert out["race_ok"].all()
    assert out["y_win"].tolist() == [1, 0, 0, 0, 0, 0]


def test_race_without_single_winner_is_excluded():
    out = F.add_labels(race([np.nan, 2, 3, 4, 5, 6]))
    assert not out["race_ok"].any()


# ---------------------------------------------------------------- グレード
def test_grade_prefers_kb_venue_day_then_series():
    df = pd.DataFrame({"venue_code": [1, 1, 2], "race_date": pd.to_datetime(
        ["2020-01-01", "2020-01-02", "2020-01-01"]), "grade": ["G1", None, None]})
    series = pd.DataFrame({"venue_code": [1, 2], "start_date": ["2019-12-28", "2020-01-05"],
                           "end_date": ["2020-01-02", "2020-01-10"], "grade": ["G3", "SG"]})
    out = F.attach_grade_from_series(df, series)
    assert out["grade"].tolist() == ["G1", "G3", None]
