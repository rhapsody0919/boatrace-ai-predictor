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


def test_first_race_of_day_below_min_periods_does_not_take_later_race_values():
    """その日の最初の走が min_periods に届かず NaN のとき、同じ日の2走目以降の値（当日1走目の結果を含む）を
    配らない（レビュー指摘 P1。pandas の transform("first") は NaN を飛ばす）。"""
    hist = [(1, f"2026-01-0{d}", 1, 6, 0.20) for d in range(1, 5)]  # 前日までは4走（min_periods=5 に届かない）
    today = [(1, "2026-01-05", 1, 1, 0.01), (1, "2026-01-05", 9, 1, 0.01)]
    df = F.add_history(boats(hist + today))
    d = df[df["race_date"] == "2026-01-05"]
    assert d["recent_win30"].isna().all()


def test_debut_day_st_mean_is_not_filled_from_same_day():
    rows = [(1, "2026-01-01", r, 3, st) for r, st in ((1, 0.05), (3, 0.07), (5, 0.09), (7, 0.11))]
    df = F.add_history(boats(rows))
    assert df["st_mean30"].isna().all()


# ---------------------------------------------------------------- 朝 6:40 に分かる値（レースごとの寄与度 B、plan「学習側の設計」）
RATES = [44.44, 44.25, 44.35, 0.05, 33.333, 12.45, 100.0, 0.0, 9.95, 57.15]


def js_to_fixed1(values):
    script = "console.log(JSON.stringify(JSON.parse(process.argv[1]).map((v) => parseFloat(v.toFixed(1)))))"
    out = subprocess.run(["node", "-e", script, json.dumps(values)], capture_output=True, text=True,
                         check=True)
    return json.loads(out.stdout)


def test_round1_matches_js_to_fixed():
    """朝の経路（generate-predictions.js）は2連率を toFixed(1) で丸めて書く。学習も同じ丸めにする。"""
    got = F.round1_like_js(pd.Series(RATES, dtype="float64")).tolist()
    assert got == js_to_fixed1(RATES)
    assert F.round1_like_js(pd.Series([np.nan])).isna().all()


def test_series_day_and_final_day_from_race_series():
    df = pd.DataFrame({"venue_code": [1, 1, 1, 2], "race_date": pd.to_datetime(
        ["2026-03-01", "2026-03-03", "2026-03-06", "2026-03-01"])})
    series = pd.DataFrame({"venue_code": [1, 1], "start_date": ["2026-03-01", "2026-03-06"],
                           "end_date": ["2026-03-03", "2026-03-10"], "grade": [None, "G1"]})
    out = F.series_day_from_series(df, series)
    assert out["series_day"].tolist()[:3] == [1, 3, 1]
    assert out["is_final_day_num"].tolist()[:3] == [0, 1, 0]
    assert np.isnan(out["series_day"].iloc[3]) and np.isnan(out["is_final_day_num"].iloc[3])


def test_series_day_prefers_latest_start_when_series_overlap():
    df = pd.DataFrame({"venue_code": [1], "race_date": pd.to_datetime(["2026-03-05"])})
    series = pd.DataFrame({"venue_code": [1, 1], "start_date": ["2026-03-01", "2026-03-04"],
                           "end_date": ["2026-03-06", "2026-03-09"], "grade": [None, None]})
    out = F.series_day_from_series(df, series)
    assert out["series_day"].tolist() == [2]


def test_profile_uses_values_known_before_the_day():
    """体重・支部は当日の値（発走60分前に入る）を使わず、前日までに分かっている最後の値にする。"""
    df = pd.DataFrame({"racer_id": 1, "race_date": pd.to_datetime(
        ["2026-01-01", "2026-01-02", "2026-01-02", "2026-01-03"]), "race_number": [1, 1, 5, 1],
        "race_id": [1, 2, 3, 4], "weight": [50.0, 51.0, np.nan, np.nan],
        "branch": ["東京", "大阪", None, None]})
    out = F.profile_as_of_previous_day(df)
    assert np.isnan(out["weight"].iloc[0]) and out["branch"].iloc[0] is None or pd.isna(out["branch"].iloc[0])
    assert out["weight"].tolist()[1:] == [50.0, 50.0, 51.0]
    assert out["branch"].tolist()[1:] == ["東京", "東京", "大阪"]


def test_wind_calm_rules():
    r = pd.DataFrame({"race_id": [1, 2, 3, 4, 5], "weather": "晴",
                      "wind_direction": ["無風", None, None, "北", None],
                      "wind_speed": [0, 0, 3, 2, None], "is_final_day": False})
    out = F.encode_race_level(r, "weather", "wind_direction", "wind_speed", "is_final_day")
    assert out["wind_x"].tolist()[:2] == [0.0, 0.0] and out["wind_y"].tolist()[:2] == [0.0, 0.0]
    assert np.isnan(out["wind_x"].iloc[2]) and np.isnan(out["wind_x"].iloc[4])
    assert out["wind_y"].iloc[3] == pytest.approx(2.0)


def test_branch_map_matches_category_codes_and_unseen_is_nan():
    br = pd.Series(["東京", "大阪", None, "福岡", "東京"], dtype=object)
    m = F.make_branch_map(br)
    assert F.encode_branch(br, m).fillna(-1).tolist() == \
        br.astype("category").cat.codes.astype("float32").where(br.notna()).fillna(-1).tolist()
    assert np.isnan(F.encode_branch(pd.Series(["沖縄"], dtype=object), m).iloc[0])


def test_live_features_are_the_eight_exhibition_columns():
    from themes import FEATURES, LIVE_FEATURES, RACECARD_FEATURES
    assert LIVE_FEATURES == ["exh_time", "exh_time_diff", "exh_time_rank", "weather_code",
                             "wind_x", "wind_y", "wind_speed", "wave_height"]
    assert set(LIVE_FEATURES) <= set(FEATURES)
    assert len(RACECARD_FEATURES) == 36 and not set(LIVE_FEATURES) & set(RACECARD_FEATURES)


def test_kb_final_day_precondition():
    """BOA-696 の前の長期データ（最終日がすべて false）では学習しない（事前登録5 の前提）。"""
    with pytest.raises(RuntimeError, match="BOA-696"):
        F.check_final_day(pd.Series([False] * 100))
    F.check_final_day(pd.Series([True] * 18 + [False] * 82))
    F.check_final_day(pd.Series(["true"] * 18 + ["false"] * 82))


def test_wind_basis_file_covers_all_venues():
    """回転の表は24会場すべてにあり、除外した会場は表の会場（wind_basis.json、estimate-wind-basis.js）"""
    b = F.load_wind_basis()
    assert sorted(int(v) for v in b["offsets_deg"]) == list(range(1, 25))
    assert set(b["excluded_venues"]) <= set(range(1, 25))


def test_main_wind_rotates_fills_and_excludes(tmp_path):
    """本体の風向: 会場の回転を引く・除外した会場は欠損・DB が空で風速>0 は K の値（回転なし）・無風は0"""
    basis = {"offsets_deg": {"3": 90.0, "13": 10.0}, "excluded_venues": [13]}
    fill = tmp_path / "fill.csv"
    fill.write_text("race_id,wind_direction\n2025-12-10-03-02,南\n")
    cond = pd.DataFrame({
        "race_id": F.rid_to_int(pd.Series(["2025-12-10-03-01", "2025-12-10-03-02", "2025-12-10-13-01",
                                           "2025-12-10-13-02", "2025-12-10-03-03"])),
        "weather": "晴", "wind_direction": ["東", None, "北", None, None],
        "wind_speed": [2.0, 3.0, 3.0, 0.0, 4.0], "is_final_day": False})
    c, off = F.main_wind(cond, basis, fill)
    out = F.encode_race_level(c, "weather", "wind_direction", "wind_speed", "is_final_day", wind_offset=off)
    # 03 の「東」−90° → 北（K の基準）
    assert out["wind_y"].iloc[0] == pytest.approx(2.0) and out["wind_x"].iloc[0] == pytest.approx(0.0, abs=1e-6)
    # 空で風速>0 → K の「南」をそのまま（回転しない）
    assert out["wind_y"].iloc[1] == pytest.approx(-3.0)
    # 除外した会場の風は欠損、無風は0
    assert np.isnan(out["wind_x"].iloc[2])
    assert out["wind_x"].iloc[3] == 0.0
    # K の値が無い空・風速>0 は欠損のまま
    assert np.isnan(out["wind_x"].iloc[4])


def test_k_wind_fill_is_limited_to_gap_months():
    """K で埋めるのは DB の風向がほぼ全件空の 2025-12・2026-01 だけ（他の月の空は推論と同じく欠損）"""
    f = pd.read_csv(F.K_WIND_FILL_FILE, dtype=str)
    assert len(f) > 0 and f["race_id"].str.slice(0, 7).isin(["2025-12", "2026-01"]).all()
    assert f["wind_direction"].isin(F.DIR16 + ["無風"]).all()
