# 表示カバレッジ台帳（機械生成）

**このファイルは手で編集しない。PRにも含めない。** `node scripts/maintenance/generate-display-coverage.js` が生成し、
masterへのマージ後に `regenerate-generated-docs.yml` が作り直してコミットする（ADR-0078）。

ゴール「公式サイト・各会場の公式サイト・ボートレース日和で取得しているデータを全て表示できるようにする」に対し、
**取得したデータが画面に繋がっているか**を、マイグレーションと `src/` の静的な突き合わせで見る。
本番DBの実際の権限は見ない（それは `scripts/maintenance/check-anon-access.js`、実接続が要るため manual tier）。

## 集計

| 区分 | 件数 |
|---|---|
| テーブル・ビューの定義 | 80 |
| 読んでいる（テーブルを直接） | 53 |
| 読んでいる（RPC経由のみ） | 0 |
| 画面から読んでいない（例外登録あり） | 23 |
| **画面から読んでいない（例外登録なし＝要判断）** | **4** |
| 画面から読んでいるが匿名SELECT権限の記述が無い | 0 |

「例外登録なし」は、取得したのに表示に繋がっていない候補。表示するか、`scripts/maintenance/display-coverage-exceptions.json` に理由を書いて例外にするかのどちらかを選ぶ。

「匿名SELECT権限の記述が無い」は、**画面（`src/`）が匿名キーで直接読んでいるのに** `GRANT SELECT … TO anon` もSELECTポリシーもマイグレーションに無いもの。076（BOA-370）が新規テーブルの既定権限を剥奪したため、**076以降に定義されたテーブル**に限って見る。`api/` のEdge Functions経由の読み取りと、RPC経由（`SECURITY DEFINER` がありうる）は対象外。

画面が呼んでいるRPC: `get_race_exhibition_trend` / `get_race_return_rate` / `get_race_st_predictability` / `get_race_technique_profile` / `get_today_races`

## 要判断: 画面から読んでいない（例外登録なし）（4件）

| 名前 | 種別 | 定義元 | 画面からの参照 | 匿名SELECT | 備考 |
|---|---|---|---|---|---|
| `external_predictions` | 表 | 021_external_predictions.sql | なし | GRANT（021_external_predictions.sql） |  |
| `race_payouts` | 表 | 079_race_payouts.sql | なし | GRANT（109_predictions_rpc_race_status_payouts.sql） |  |
| `race_series` | 表 | 084_race_series.sql | なし | GRANT（095_phase_a_numeric_public_read.sql） |  |
| `race_special_notes` | 表 | 060_race_special_notes.sql | なし | 記述なし |  |

## 画面から読んでいない（例外登録あり）（23件）

| 名前 | 種別 | 定義元 | 画面からの参照 | 匿名SELECT | 備考 |
|---|---|---|---|---|---|
| `bet_filters` | 表 | 001_schema.sql | なし | 記述なし | 001_schema.sql の初期設計に由来する運用・実験用。読み手は scripts/ のみ |
| `daily_bet_summary` | 表 | 001_schema.sql | なし | 記述なし | 001_schema.sql の初期設計に由来する運用・実験用。読み手は scripts/ のみ |
| `kb_archive_boats` | 表 | 074_kb_archive_tables.sql | なし | 記述なし | K/Bファイルの生アーカイブ（074）。上と同じ |
| `kb_archive_races` | 表 | 074_kb_archive_tables.sql | なし | 記述なし | K/Bファイルの生アーカイブ（074、2019-04以降）。学習・検証・バックフィルの入力で、画面は本体テーブル（races・race_results 等）を読む |
| `kb_archive_venue_days` | 表 | 074_kb_archive_tables.sql | なし | 記述なし | K/Bファイルの生アーカイブ（074）。上と同じ |
| `model_bet_candidates` | 表 | 030_ai_model_redesign_schema.sql | なし | ポリシー（030_ai_model_redesign_schema.sql） | 030（AI予想モデル刷新）の中間テーブル。読み手は scripts/ のみ |
| `model_experiments` | 表 | 001_schema.sql | なし | 記述なし | 001_schema.sql の初期設計に由来するモデル実験用。読み手は scripts/ のみ |
| `race_notices_health` | 表 | 060_race_special_notes.sql | なし | 記述なし | 取得監視の健全性指標（060）。画面ではなく data_health とSlack通知が使う |
| `race_outcome_frequencies` | 表 | 030_ai_model_redesign_schema.sql | なし | ポリシー（030_ai_model_redesign_schema.sql） | 030（AI予想モデル刷新）の中間テーブル。読み手は scripts/ のみ |
| `racer_course_technique_stats` | 表 | 098_morning_data_digest.sql | なし | GRANT（098_morning_data_digest.sql） | /today（morning digest）の集計の中間テーブル（098）。画面は集計結果の morning_digest_rows を読む |
| `racer_news_pending` | 表 | 080_racer_news_pending.sql | なし | 記述なし | 選手ニュースの承認待ちキュー（080、運用）。承認を経て公開側に入る。セッション開始チェックが読む |
| `scrape_job_state` | 表 | 075_scrape_slots_and_job_state.sql | なし | 記述なし | 取得基盤の内部状態（ジョブのモード live/shadow/off と最終成功時刻、075）。画面ではなく data_health と orchestration.md が使う |
| `scrape_slots` | 表 | 075_scrape_slots_and_job_state.sql | なし | 記述なし | 取得基盤の内部状態（Cronの実行スロット、075）。画面に出す性質のデータではない |
| `sns_campaign_entries` | 表 | 054_sns_campaigns_schema.sql | なし | 記述なし | SNS運用（sns-hub）。上と同じ |
| `sns_campaigns` | 表 | 054_sns_campaigns_schema.sql | なし | 記述なし | SNS運用（sns-hub）。他の sns_* は管理API（api/admin/sns-hub）経由で読まれており、公開サイトの表示対象ではない |
| `sns_target_accounts` | 表 | 043_sns_topic_gate_schema.sql | なし | 記述なし | SNS運用（sns-hub）。上と同じ |
| `user_visible_summary` | 表 | 001_schema.sql | なし | ポリシー（001_schema.sql） | 001_schema.sql の初期設計に由来。読み手は scripts/ のみ |
| `v_performance_comparison` | ビュー | 001_schema.sql | なし | 記述なし | 001_schema.sql のモデル評価用ビュー。読み手は scripts/ のみ |
| `v_prediction_performance` | ビュー | 001_schema.sql | なし | 記述なし | 001_schema.sql のモデル評価用ビュー。読み手は scripts/ のみ |
| `v_production_models` | ビュー | 001_schema.sql | なし | 記述なし | 001_schema.sql のモデル管理用ビュー。読み手は scripts/ のみ |
| `v_todays_recommendations` | ビュー | 001_schema.sql | なし | 記述なし | 001_schema.sql の初期設計に由来するビュー。scripts/ にも読み手が無い（廃止候補） |
| `venue_course_technique_baseline` | 表 | 098_morning_data_digest.sql | なし | GRANT（098_morning_data_digest.sql） | 会場×グレード×実進入コースの決まり手ベースライン（098）。上と同じく集計の中間テーブル |
| `venue_entry_course_stats` | 表 | 064_venue_entry_course_stats.sql | なし | 記述なし | 「表示には使わず、自前計算の全国値の検証にのみ使う」とユーザー判断済み（BOA-293、orchestration.md）。読み手が無いことは既知 |

## 画面から読んでいる（53件）

| 名前 | 種別 | 定義元 | 画面からの参照 | 匿名SELECT | 備考 |
|---|---|---|---|---|---|
| `accuracy_cache` | 表 | 013_accuracy_cache_table.sql | API・画面が直接 | GRANT（013_accuracy_cache_table.sql） |  |
| `bet_recommendations` | 表 | 001_schema.sql | 画面が直接 | ポリシー（001_schema.sql） |  |
| `exhibition_data` | 表 | 001_schema.sql | 画面が直接 / RPC経由: get_race_exhibition_trend(画面), get_race_st_predictability(画面) | ポリシー（076_enable_rls_on_public_tables.sql） |  |
| `exhibition_time_top_stats` | 表 | 028_exhibition_time_top_stats.sql | 画面が直接 | GRANT（028_exhibition_time_top_stats.sql） |  |
| `losing_technique_stats` | 表 | 026_losing_technique_stats.sql | 画面が直接 | GRANT（026_losing_technique_stats.sql） |  |
| `model_performance_daily` | 表 | 001_schema.sql | 画面が直接 | ポリシー（076_enable_rls_on_public_tables.sql） |  |
| `models` | 表 | 001_schema.sql | 画面が直接 | ポリシー（001_schema.sql） |  |
| `morning_digest_days` | 表 | 098_morning_data_digest.sql | 画面が直接 | GRANT（098_morning_data_digest.sql） |  |
| `morning_digest_rows` | 表 | 098_morning_data_digest.sql | 画面が直接 | GRANT（098_morning_data_digest.sql） |  |
| `motor_pretest_stats` | 表 | 090_motor_pretest_stats.sql | 画面が直接 | GRANT（095_phase_a_numeric_public_read.sql） |  |
| `mycroft_predictions` | 表 | 030_mycroft_predictions.sql | 画面が直接 | ポリシー（030_mycroft_predictions.sql） |  |
| `nige_outcome_distribution` | 表 | 027_nige_outcome_distribution.sql | 画面が直接 | GRANT（027_nige_outcome_distribution.sql） |  |
| `nige_second_by_course` | 表 | 094_course_baselines.sql | 画面が直接 | GRANT（094_course_baselines.sql） |  |
| `outcome_distribution` | 表 | 020_outcome_distribution.sql | API・画面が直接 | GRANT（020_outcome_distribution.sql） |  |
| `poirot_predictions` | 表 | 021_poirot_predictions.sql | 画面が直接 | ポリシー（021_poirot_predictions.sql） |  |
| `prediction_odds` | 表 | 011_prediction_odds.sql | 画面が直接 | ポリシー（011_prediction_odds.sql） |  |
| `predictions` | 表 | 001_schema.sql | 画面が直接 / RPC経由: get_today_races(API) | ポリシー（001_schema.sql） |  |
| `race_conditions` | 表 | 001_schema.sql | 画面が直接 / RPC経由: get_today_races(API) | ポリシー（076_enable_rls_on_public_tables.sql） |  |
| `race_entries` | 表 | 001_schema.sql | 画面が直接 / RPC経由: get_race_exhibition_trend(画面), get_race_return_rate(画面), get_race_st_predictability(画面), get_race_technique_profile(画面), get_today_races(API) | ポリシー（001_schema.sql） |  |
| `race_history_cache` | 表 | 020_race_history_cache.sql | API・画面が直接 | GRANT（020_race_history_cache.sql） |  |
| `race_odds` | 表 | 001_schema.sql | 画面が直接 | ポリシー（076_enable_rls_on_public_tables.sql） |  |
| `race_odds_final` | 表 | 108_race_odds_final.sql | 画面が直接 | GRANT（108_race_odds_final.sql） |  |
| `race_original_exhibition` | 表 | 091_boatcast_original_exhibition.sql | 画面が直接 | GRANT（096_original_exhibition_public_read.sql） |  |
| `race_original_exhibition_values` | 表 | 091_boatcast_original_exhibition.sql | 画面が直接 | GRANT（096_original_exhibition_public_read.sql） |  |
| `race_pit_comments` | 表 | 085_race_pit_reports.sql | 画面が直接 | GRANT（086_race_pit_reports_public_read.sql） |  |
| `race_pit_reports` | 表 | 085_race_pit_reports.sql | 画面が直接 | GRANT（086_race_pit_reports_public_read.sql） |  |
| `race_results` | 表 | 001_schema.sql | 画面が直接 / RPC経由: get_race_return_rate(画面), get_race_technique_profile(画面), get_today_races(API) | ポリシー（001_schema.sql） |  |
| `racer_grade_cache` | 表 | 054_racer_grade_cache_table.sql | 画面が直接 | GRANT（054_racer_grade_cache_table.sql） |  |
| `racer_news` | 表 | 036_create_racer_news.sql | 画面が直接 | ポリシー（036_create_racer_news.sql） |  |
| `racer_period_stats` | 表 | 083_racer_period_stats.sql | 画面が直接 | GRANT（095_phase_a_numeric_public_read.sql） |  |
| `racer_profiles` | 表 | 035_create_racer_profiles.sql | 画面が直接 | ポリシー（035_create_racer_profiles.sql） |  |
| `racer_series_points` | 表 | 064_racer_series_points.sql | 画面が直接 | ポリシー（076_enable_rls_on_public_tables.sql） |  |
| `races` | 表 | 001_schema.sql | 画面が直接 / RPC経由: get_today_races(API) | ポリシー（001_schema.sql） |  |
| `rule_applications` | 表 | 008_venue_rules.sql | 画面が直接 | 記述なし |  |
| `sns_approvers` | 表 | 035_sns_marketing_hub_schema.sql | APIが直接 | 記述なし |  |
| `sns_content_types` | 表 | 043_sns_topic_gate_schema.sql | APIが直接 | 記述なし |  |
| `sns_draft_metrics` | 表 | 035_sns_marketing_hub_schema.sql | APIが直接 | 記述なし |  |
| `sns_drafts` | 表 | 035_sns_marketing_hub_schema.sql | APIが直接 | 記述なし |  |
| `sns_strategy_insights` | 表 | 039_sns_strategy_insights.sql | APIが直接 | 記述なし |  |
| `sns_template_variants` | 表 | 035_sns_marketing_hub_schema.sql | APIが直接 | 記述なし |  |
| `sns_topic_categories` | 表 | 044_sns_topic_categories.sql | APIが直接 | 記述なし |  |
| `sns_topic_category_channels` | 表 | 044_sns_topic_categories.sql | APIが直接 | 記述なし |  |
| `sns_topic_targets` | 表 | 043_sns_topic_gate_schema.sql | APIが直接 | 記述なし |  |
| `sns_topics` | 表 | 043_sns_topic_gate_schema.sql | APIが直接 | 記述なし |  |
| `st_course_baseline` | 表 | 094_course_baselines.sql | 画面が直接 | GRANT（094_course_baselines.sql） |  |
| `top_start_stats` | 表 | 025_top_start_stats.sql | 画面が直接 | GRANT（025_top_start_stats.sql） |  |
| `venue_grade_boat_stats` | 表 | 059_venue_grade_boat_stats.sql | 画面が直接 | ポリシー（059_venue_grade_boat_stats.sql） |  |
| `venue_motor_start_dates` | 表 | 091_boatcast_original_exhibition.sql | 画面が直接 | GRANT（104_venue_motor_start_dates_public_read.sql） |  |
| `venue_motor_stats` | 表 | 057_venue_motor_stats.sql | 画面が直接 | ポリシー（076_enable_rls_on_public_tables.sql） |  |
| `venue_rules` | 表 | 008_venue_rules.sql | 画面が直接 | 記述なし |  |
| `venues` | 表 | 001_schema.sql | 画面が直接 | ポリシー（001_schema.sql） |  |
| `watson_predictions` | 表 | 029_watson_predictions.sql | 画面が直接 | ポリシー（029_watson_predictions.sql） |  |
| `winning_technique_stats` | 表 | 023_winning_technique_stats.sql | 画面が直接 | GRANT（023_winning_technique_stats.sql） |  |

