"""BOA-271 FR-1 寄与度のテーマ定義

テーマの一覧はモデルの版と一緒に analogy_models.themes へ保存し、画面はその一覧から描く
（テーマ数を画面に固定しない。MD-3 の再判定で「市場」を7番目に足す場合はここに足すだけ）。

- key: i18n キー（aiPredictionTab.analogy.themes.{key}）と DB のシェアのキー
- name / description: ja の既定値（画面は key から i18n を引く）
- groups: テーマ内の内訳。似た意味の項目（勝率・2連率と、そのレース内の差・順位など）は
  1つにまとめる（多重共線性で個別の値が不安定なため。spec FR-1）
"""

from __future__ import annotations

THEMES: list[dict] = [
    {
        "key": "venueCourse",
        "name": "会場×枠・進入",
        "description": "会場ごとの枠番の有利不利とレース番号",
        "groups": [
            {"key": "venue", "label": "会場", "features": ["venue_code"]},
            {"key": "boatNumber", "label": "枠番", "features": ["boat_number"]},
            {"key": "raceNumber", "label": "レース番号", "features": ["race_number"]},
        ],
    },
    {
        "key": "racerRecord",
        "name": "選手・基礎成績",
        "description": "級別・勝率・当地成績・直近の調子と、1号艇の格",
        "groups": [
            {"key": "class", "label": "級別", "features": ["cls_ord"]},
            {"key": "national", "label": "全国勝率・2連率",
             "features": ["nat_win", "nat_2", "nat_win_diff", "nat_win_rank"]},
            {"key": "local", "label": "当地勝率・2連率",
             "features": ["loc_win", "loc_2", "loc_win_diff", "loc_win_rank"]},
            {"key": "recent", "label": "直近30走の成績",
             "features": ["recent_win30", "recent_top3_30", "recent_win30_diff",
                          "recent_win30_rank"]},
            {"key": "boat1", "label": "1号艇の級別・勝率", "features": ["b1_cls_ord", "b1_nat_win"]},
        ],
    },
    {
        "key": "startExhibition",
        "name": "ST・直前情報",
        "description": "展示タイムと、過去のスタートタイミング",
        "groups": [
            {"key": "exhibitionTime", "label": "展示タイム",
             "features": ["exh_time", "exh_time_diff", "exh_time_rank"]},
            {"key": "pastSt", "label": "過去の平均ST",
             "features": ["st_mean30", "st_n", "st_mean30_diff", "st_mean30_rank"]},
        ],
    },
    {
        "key": "machine",
        "name": "機力",
        "description": "モーターとボートの2連率",
        "groups": [
            {"key": "motor", "label": "モーター2連率",
             "features": ["motor_2", "motor_2_diff", "motor_2_rank"]},
            {"key": "boat", "label": "ボート2連率",
             "features": ["boat_2", "boat_2_diff", "boat_2_rank"]},
        ],
    },
    {
        "key": "environment",
        "name": "環境",
        "description": "天候・風・波と、グレード・ラウンド・節の日目",
        "groups": [
            {"key": "weather", "label": "天候", "features": ["weather_code"]},
            {"key": "wind", "label": "風向・風速", "features": ["wind_x", "wind_y", "wind_speed"]},
            {"key": "wave", "label": "波高", "features": ["wave_height"]},
            {"key": "grade", "label": "グレード", "features": ["grade_code"]},
            {"key": "round", "label": "ラウンド", "features": ["round_code"]},
            {"key": "seriesDay", "label": "節の日目", "features": ["series_day", "is_final_day_num"]},
        ],
    },
    {
        "key": "racerProfile",
        "name": "選手・属性",
        "description": "年齢・体重・支部（地元かどうか）",
        "groups": [
            {"key": "age", "label": "年齢", "features": ["age"]},
            {"key": "weight", "label": "体重", "features": ["weight"]},
            {"key": "branch", "label": "支部・地元", "features": ["branch_code", "is_local"]},
        ],
    },
]


def theme_features(theme: dict) -> list[str]:
    return [f for g in theme["groups"] for f in g["features"]]


FEATURES: list[str] = [f for t in THEMES for f in theme_features(t)]
# 直前情報（展示・気象）の8列。出走表時点専用モデル win_racecard はこれを使わない（ADR-0083、
# plan「学習側の設計」）。展示後の段は、保存した36列にこの8列を推論側の JS が足して win に渡す
LIVE_FEATURES: list[str] = ["exh_time", "exh_time_diff", "exh_time_rank", "weather_code",
                            "wind_x", "wind_y", "wind_speed", "wave_height"]
RACECARD_FEATURES: list[str] = [f for f in FEATURES if f not in LIVE_FEATURES]
CATEGORICAL: list[str] = ["venue_code", "boat_number", "weather_code", "grade_code",
                          "round_code", "branch_code"]


def themes_for_db(themes: list[dict] = THEMES) -> list[dict]:
    """analogy_models.themes に保存する形（features はテーマ内の全特徴量）。"""
    return [{"key": t["key"], "name": t["name"], "description": t["description"],
             "features": theme_features(t),
             "groups": [{"key": g["key"], "label": g["label"]} for g in t["groups"]]}
            for t in themes]
