# データベース設計書

龍神レーダー Supabaseデータベースの設計仕様。

---

## 目次

1. [概要](#概要)
2. [テーブル一覧と使用状況](#テーブル一覧と使用状況)（機械生成）
3. [コアテーブル詳細](#コアテーブル詳細)（機械生成）
4. [テーブル関係図](#テーブル関係図)
5. [参考: RPC関数](#参考-rpc関数)

---

## 概要

### データベース情報

| 項目 | 値 |
|------|-----|
| プラットフォーム | Supabase (PostgreSQL) |
| スキーマファイル | `docs/db-migration/001_schema.sql` |
| RPC関数 | `docs/db-migration/007_RPC_FUNCTIONS.sql` |

### 設計の経緯

1. **初期設計** (`scripts/db/SCHEMA_DETAIL.md`): 8テーブル構成
2. **拡張設計** (`docs/db-migration/001_schema.sql`): 17テーブル + ビュー構成
3. **追加テーブル** (`docs/db-migration/008_venue_rules.sql`): ルール管理用2テーブル

**現在の運用**: その後の機能追加で表は大きく増えた。現況は下の「テーブル一覧と使用状況」（機械生成）を正とする。

**更新方法**: 「テーブル一覧と使用状況」「コアテーブル詳細」は `node --env-file=.env.local scripts/maintenance/generate-database-design-sections.js` で本番スキーマから作り直す（読み取りのみ）。マーカー `<!-- generated:... -->` の間は手で書き換えない。

---

## テーブル一覧と使用状況

<!-- generated:table-usage:start -->
本番スキーマ（PostgREST の OpenAPI）とコード（表名の出現）から機械生成（2026-10-02、`scripts/maintenance/generate-database-design-sections.js`）。
行数は pg の統計値による推定（概数）。「使用中」は推定行数>0 かつコード参照あり。参照数は表名を含む src/・api/・scripts/ のファイル数（コメントでの言及も数える。docs/db-migration の SQL・RPC は数えない）。「コード参照なし」は確実だが、参照ありは使用の証明ではない。

| テーブル | 種別 | 推定行数 | PK | src | api | scripts | 状態 |
|---|---|---:|---|---:|---:|---:|---|
| `accuracy_cache` | 表 | 3 | key | 2 | 1 | 5 | 使用中 |
| `analogy_contribution_profiles` | 表 | 12180 | model_version, finish_target, venue_code, grade, round, boat_number | 2 | 1 | 0 | 使用中 |
| `analogy_models` | 表 | 1 | model_version | 3 | 1 | 1 | 使用中 |
| `bet_filters` | 表 | 0 | filter_id | 0 | 0 | 2 | 空（参照あり） |
| `bet_recommendations` | 表 | 15424 | race_id, model_id | 4 | 0 | 10 | 使用中 |
| `daily_bet_summary` | 表 | 0 | date, model_id | 0 | 0 | 2 | 空（参照あり） |
| `exhibition_data` | 表 | 286454 | race_id, boat_number | 6 | 1 | 39 | 使用中 |
| `exhibition_time_top_stats` | 表 | 144 | id | 1 | 0 | 2 | 使用中 |
| `external_predictions` | 表 | 20511 | id | 0 | 1 | 10 | 使用中 |
| `kb_archive_boats` | 表 | 2233849 | race_id, boat_number | 0 | 0 | 5 | 使用中 |
| `kb_archive_races` | 表 | 372624 | race_id | 0 | 0 | 2 | 使用中 |
| `kb_archive_venue_days` | 表 | 31023 | venue_day_id | 0 | 0 | 3 | 使用中 |
| `losing_technique_stats` | 表 | 857 | id | 1 | 0 | 2 | 使用中 |
| `model_bet_candidates` | 表 | 0 | race_id, model_id, pattern_index, bet_rank | 0 | 0 | 2 | 空（参照あり） |
| `model_experiments` | 表 | 0 | experiment_id | 0 | 0 | 2 | 空（参照あり） |
| `model_performance_daily` | 表 | 68 | model_id, date | 1 | 0 | 3 | 使用中 |
| `models` | 表 | 5 | model_id | 9 | 1 | 20 | 使用中 |
| `morning_digest_days` | 表 | 11 | digest_date | 3 | 1 | 3 | 使用中 |
| `morning_digest_rows` | 表 | 501 | digest_date, section, rank | 5 | 1 | 4 | 使用中 |
| `motor_pretest_stats` | 表 | 35723 | race_date, venue_code, racer_id | 2 | 1 | 7 | 使用中 |
| `mycroft_predictions` | 表 | 7656 | race_id | 2 | 0 | 3 | 使用中 |
| `nige_outcome_distribution` | 表 | 536 | id | 1 | 0 | 2 | 使用中 |
| `nige_second_by_course` | 表 | 120 | venue_code, second_course | 2 | 0 | 2 | 使用中 |
| `outcome_distribution` | 表 | 2424 | id | 3 | 1 | 9 | 使用中 |
| `poirot_predictions` | 表 | 22771 | race_id, model_version | 1 | 0 | 4 | 使用中 |
| `prediction_odds` | 表 | 24627 | race_id | 0 | 2 | 21 | 使用中 |
| `predictions` | 表 | 139929 | prediction_id | 18 | 1 | 131 | 使用中 |
| `race_conditions` | 表 | 47361 | race_id | 11 | 2 | 72 | 使用中 |
| `race_entries` | 表 | 303068 | race_id, boat_number | 22 | 4 | 121 | 使用中 |
| `race_history_cache` | 表 | 1 | key | 1 | 1 | 2 | 使用中 |
| `race_notices_health` | 表 | 238 | venue_code, check_date | 0 | 0 | 7 | 使用中 |
| `race_odds` | 表 | 151661 | race_id, captured_at | 4 | 2 | 38 | 使用中 |
| `race_odds_final` | 表 | 483 | race_id | 3 | 1 | 2 | 使用中 |
| `race_original_exhibition` | 表 | 1253 | race_id | 1 | 1 | 5 | 使用中 |
| `race_original_exhibition_values` | 表 | 23162 | race_id, boat_number, kind | 1 | 1 | 6 | 使用中 |
| `race_outcome_frequencies` | 表 | 2689 | venue_code, rank1_boat, rank2_boat, rank3_boat, window_days | 0 | 0 | 1 | 使用中 |
| `race_payouts` | 表 | 33860 | race_id, bet_type, seq | 3 | 1 | 16 | 使用中 |
| `race_pit_comments` | 表 | 383 | race_id, boat_number | 1 | 1 | 3 | 使用中 |
| `race_pit_reports` | 表 | 72 | race_id | 1 | 1 | 9 | 使用中 |
| `race_results` | 表 | 46747 | race_id | 16 | 3 | 176 | 使用中 |
| `race_series` | 表 | 6312 | venue_code, start_date | 2 | 1 | 21 | 使用中 |
| `race_special_notes` | 表 | 12 | id | 1 | 0 | 12 | 使用中 |
| `race_start_timings` | 表 | 280754 | race_id, boat_number | 9 | 0 | 49 | 使用中 |
| `racer_aggregated_stats` | 表 | 1639 | racer_id, venue_code | 3 | 0 | 27 | 使用中 |
| `racer_course_technique_stats` | 表 | 9476 | racer_id, course | 0 | 1 | 4 | 使用中 |
| `racer_grade_cache` | 表 | 1 | key | 1 | 0 | 1 | 使用中 |
| `racer_news` | 表 | 6 | id | 1 | 1 | 9 | 使用中 |
| `racer_news_pending` | 表 | 0 | id | 0 | 1 | 6 | 空（参照あり） |
| `racer_period_stats` | 表 | 24165 | racer_id, period_year, period_no | 3 | 0 | 6 | 使用中 |
| `racer_profiles` | 表 | 1628 | racer_id | 5 | 2 | 31 | 使用中 |
| `racer_series_points` | 表 | 153 | id | 2 | 1 | 14 | 使用中 |
| `races` | 表 | 47568 | race_id | 63 | 8 | 225 | 使用中 |
| `rule_applications` | 表 | 0 | id | 1 | 0 | 3 | 空（参照あり） |
| `scrape_job_state` | 表 | 29 | job | 0 | 28 | 44 | 使用中 |
| `scrape_slots` | 表 | 23722 | job, race_id, offset_min | 0 | 9 | 36 | 使用中 |
| `sns_approvers` | 表 | 2 | id | 0 | 3 | 1 | 使用中 |
| `sns_campaign_entries` | 表 | 20 | id | 0 | 0 | 6 | 使用中 |
| `sns_campaigns` | 表 | 1 | id | 0 | 0 | 6 | 使用中 |
| `sns_content_types` | 表 | 3 | id | 1 | 2 | 3 | 使用中 |
| `sns_draft_metrics` | 表 | 0 | id | 0 | 1 | 0 | 空（参照あり） |
| `sns_drafts` | 表 | 299 | id | 1 | 6 | 10 | 使用中 |
| `sns_strategy_insights` | 表 | 3 | id | 0 | 4 | 4 | 使用中 |
| `sns_target_accounts` | 表 | 5 | id | 1 | 3 | 2 | 使用中 |
| `sns_template_variants` | 表 | 88 | id | 2 | 3 | 0 | 使用中 |
| `sns_topic_categories` | 表 | 13 | id | 1 | 2 | 2 | 使用中 |
| `sns_topic_category_channels` | 表 | 64 | id | 1 | 1 | 2 | 使用中 |
| `sns_topic_targets` | 表 | 469 | id | 2 | 6 | 5 | 使用中 |
| `sns_topics` | 表 | 94 | id | 1 | 5 | 12 | 使用中 |
| `st_course_baseline` | 表 | 24 | course, grade | 4 | 0 | 2 | 使用中 |
| `top_start_stats` | 表 | 144 | id | 1 | 0 | 2 | 使用中 |
| `user_visible_summary` | 表 | 0 | summary_id | 0 | 0 | 1 | 空（参照あり） |
| `v_performance_comparison` | ビュー | 0 | — | 0 | 0 | 1 | 空（参照あり） |
| `v_prediction_performance` | ビュー | 933 | — | 0 | 0 | 1 | 使用中 |
| `v_production_models` | ビュー | 1 | model_id | 0 | 0 | 2 | 使用中 |
| `v_todays_recommendations` | ビュー | 672 | race_id | 0 | 0 | 0 | コード参照なし |
| `venue_course_technique_baseline` | 表 | 612 | venue_code, race_grade, course | 2 | 1 | 4 | 使用中 |
| `venue_entry_course_stats` | 表 | 27655 | race_id, waku, entry_course | 0 | 1 | 11 | 使用中 |
| `venue_grade_boat_stats` | 表 | 518 | venue_code, race_grade, boat_number | 2 | 0 | 1 | 使用中 |
| `venue_motor_start_dates` | 表 | 24 | venue_code, start_date | 2 | 1 | 6 | 使用中 |
| `venue_motor_stats` | 表 | 26219 | venue_code, motor_number, scraped_date | 3 | 1 | 15 | 使用中 |
| `venue_rules` | 表 | 10 | id | 1 | 0 | 3 | 使用中 |
| `venues` | 表 | 24 | code | 69 | 1 | 74 | 使用中 |
| `watson_predictions` | 表 | 7968 | race_id | 2 | 0 | 3 | 使用中 |
| `winning_technique_stats` | 表 | 627 | id | 4 | 0 | 3 | 使用中 |
<!-- generated:table-usage:end -->

---

## コアテーブル詳細

<!-- generated:core-tables:start -->
主要なテーブルの列。型・NULL 可否・PK・FK・列コメント（`COMMENT ON COLUMN`）は本番スキーマから機械生成。
列の意味の詳細は、各列を足したマイグレーション（`docs/db-migration/`）と機能の設計（`docs/design/{slug}/plan.md`）を参照。

### races

推定行数: 47568

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `race_id` | character varying | 不可 | PK |  |
| `race_date` | date | 不可 |  |  |
| `venue_code` | smallint | 不可 | FK→venues.code |  |
| `race_number` | smallint | 不可 |  |  |
| `start_time` | time without time zone | 可 |  |  |
| `volatility_score` | smallint | 可 |  |  |
| `volatility_level` | character varying | 可 |  |  |
| `recommended_model` | character varying | 可 |  |  |
| `volatility_reasons` | jsonb | 可 |  |  |
| `first_boat_grade` | character varying | 可 |  |  |
| `first_boat_win_rate` | numeric | 可 |  |  |
| `first_boat_motor_2rate` | numeric | 可 |  |  |
| `win_rate_stddev` | numeric | 可 |  |  |
| `win_rate_avg` | numeric | 可 |  |  |
| `motor_2rate_stddev` | numeric | 可 |  |  |
| `created_at` | timestamp with time zone | 可 |  |  |
| `updated_at` | timestamp with time zone | 可 |  |  |
| `first_boat_avg_st` | numeric | 可 |  |  |
| `race_grade` | character varying | 可 |  |  |
| `cancellation_status` | text | 可 |  |  |
| `cancellation_check_streak` | smallint | 不可 |  |  |

### race_entries

推定行数: 303068

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `race_id` | character varying | 不可 | PK FK→races.race_id | This is a Foreign Key to `races.race_id`.<fk table='races' column='race_id'/> |
| `boat_number` | smallint | 不可 | PK |  |
| `player_name` | character varying | 可 |  |  |
| `grade` | character varying | 可 |  |  |
| `age` | smallint | 可 |  |  |
| `win_rate` | numeric | 可 |  |  |
| `local_win_rate` | numeric | 可 |  |  |
| `motor_number` | smallint | 可 |  |  |
| `motor_2rate` | numeric | 可 |  |  |
| `boat_number_id` | smallint | 可 |  |  |
| `boat_2rate` | numeric | 可 |  |  |
| `ai_score_standard` | integer | 可 |  |  |
| `ai_score_safe_bet` | integer | 可 |  |  |
| `ai_score_upset_focus` | integer | 可 |  |  |
| `global_2rate` | numeric | 可 |  |  |
| `local_2rate` | numeric | 可 |  |  |
| `global_3rate` | numeric | 可 |  |  |
| `local_3rate` | numeric | 可 |  |  |
| `motor_3rate` | numeric | 可 |  |  |
| `boat_3rate` | numeric | 可 |  |  |
| `racer_id` | integer | 可 |  |  |
| `created_at` | timestamp with time zone | 可 |  | 行が最初に保存された時刻（INSERT時のDEFAULT now()）。NULLはこの列の追加前に保存された行（不明）。「発走の何分前に取得できたか」の計測に使う |
| `updated_at` | timestamp with time zone | 可 |  | 行の値が変わった時刻（新規の行は保存時刻）。書き込み側のコードが、変更のある行を書くときだけ設定する（トリガーは使わない）。NULLはこの列の追加前に保存され、以降に一度も変更されていない行 |
| `weight_kg` | numeric | 可 |  | 出走表の選手の当日体重（kg）。登録体重ではない（直前情報の exhibition_data.today_weight と同じ値・同じ時刻に公開される。2026-09-20〜28の実測で99.3%が完全一致）。081以前の行はNULL |
| `branch` | text | 可 |  | 出走表の支部（例: 福岡）。081以前の行はNULL |
| `hometown` | text | 可 |  | 出走表の出身地（例: 北海道）。081以前の行はNULL |
| `f_count` | smallint | 可 |  | 出走表のF数（今期のフライング回数）。取得時点の値。読めなければNULL |
| `l_count` | smallint | 可 |  | 出走表のL数（今期の出遅れ回数）。取得時点の値。読めなければNULL |
| `is_absent` | boolean | 可 |  | 出走表で欠場の表示（tbody の is-miss）があるか。NULL=未判定（081以前の行）、false=表示なし、true=欠場の表示あり |

### race_results

推定行数: 46747

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `race_id` | character varying | 不可 | PK FK→races.race_id | This is a Foreign Key to `races.race_id`.<fk table='races' column='race_id'/> |
| `rank1` | smallint | 不可 |  |  |
| `rank2` | smallint | 不可 |  |  |
| `rank3` | smallint | 不可 |  |  |
| `payout_win` | integer | 可 |  |  |
| `payout_place_1` | integer | 可 |  |  |
| `payout_place_2` | integer | 可 |  |  |
| `payout_trifecta` | integer | 可 |  |  |
| `payout_trio` | integer | 可 |  |  |
| `is_cancelled` | boolean | 可 |  |  |
| `is_no_race` | boolean | 可 |  |  |
| `course_1` | smallint | 可 |  |  |
| `course_2` | smallint | 可 |  |  |
| `course_3` | smallint | 可 |  |  |
| `course_4` | smallint | 可 |  |  |
| `course_5` | smallint | 可 |  |  |
| `course_6` | smallint | 可 |  |  |
| `winning_technique` | character varying | 可 |  |  |
| `result_at` | timestamp with time zone | 可 |  |  |
| `created_at` | timestamp with time zone | 可 |  |  |
| `rank4` | smallint | 可 |  |  |
| `rank5` | smallint | 可 |  |  |
| `rank6` | smallint | 可 |  |  |
| `race_time_1` | character varying | 可 |  |  |
| `race_time_2` | character varying | 可 |  |  |
| `race_time_3` | character varying | 可 |  |  |
| `race_time_4` | character varying | 可 |  |  |
| `race_time_5` | character varying | 可 |  |  |
| `race_time_6` | character varying | 可 |  |  |
| `payout_exacta` | integer | 可 |  |  |
| `payout_quinella` | integer | 可 |  |  |
| `payout_wide_1` | integer | 可 |  |  |
| `payout_wide_2` | integer | 可 |  |  |
| `payout_wide_3` | integer | 可 |  |  |
| `popularity_trifecta` | smallint | 可 |  |  |
| `popularity_trio` | smallint | 可 |  |  |
| `popularity_exacta` | smallint | 可 |  |  |
| `popularity_quinella` | smallint | 可 |  |  |
| `popularity_wide_1` | smallint | 可 |  |  |
| `popularity_wide_2` | smallint | 可 |  |  |
| `popularity_wide_3` | smallint | 可 |  |  |
| `actual_course_1` | smallint | 可 |  |  |
| `actual_course_2` | smallint | 可 |  |  |
| `actual_course_3` | smallint | 可 |  |  |
| `actual_course_4` | smallint | 可 |  |  |
| `actual_course_5` | smallint | 可 |  |  |
| `actual_course_6` | smallint | 可 |  |  |
| `race_status` | text | 可 |  | レースの状態。normal=通常、partial_refund=返還艇あり・一部の勝式が不成立、no_race=全勝式が不成立。NULL=未判定（078以前の行）。読み手は IS DISTINCT FROM 'no_race' で判定する |
| `refund_boats` | smallint[] | 可 |  | 返還艇の枠番（昇順）。返還なしは空配列、NULL=未判定。返還されるのはF・L・欠の艇 |
| `remark` | text | 可 |  | 結果ページの備考（【返還艇あり】【同着あり】等）。空ならNULL |

### race_start_timings

推定行数: 280754

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `race_id` | character varying | 不可 | PK FK→races.race_id | This is a Foreign Key to `races.race_id`.<fk table='races' column='race_id'/> |
| `boat_number` | smallint | 不可 | PK |  |
| `start_timing` | numeric | 可 |  |  |
| `is_flying` | boolean | 可 |  |  |
| `is_late_start` | boolean | 可 |  |  |
| `created_at` | timestamp with time zone | 可 |  | 行が最初に保存された時刻（INSERT時のDEFAULT now()）。NULLはこの列の追加前に保存された行（不明）。「発走の何分前に取得できたか」の計測に使う |
| `updated_at` | timestamp with time zone | 可 |  | 行の値が変わった時刻（新規の行は保存時刻）。書き込み側のコードが、変更のある行を書くときだけ設定する（トリガーは使わない）。NULLはこの列の追加前に保存され、以降に一度も変更されていない行 |
| `finish_mark` | text | 可 |  | 着欄の生表記（NFKC正規化後）。1〜6=完走、F=フライング、L=出遅れ、欠=欠場、落=落水、転=転覆、沈=沈没、妨=妨害失格、エ=エンスト、_=順位なし。全種類は scripts/lib/raceResultParser.js の FINISH_MARKS。077以前の行はNULL |
| `finish_rank` | smallint | 可 |  | 完走した艇の着（1〜6。同着は同じ値が複数艇）。非完走はNULL。race_results.rank1〜6（艇番を着順の位置に並べる旧形式）の正確な代わり |
| `entry_course` | smallint | 可 |  | 進入コース（結果ページのスタート情報の行順。1〜6）。欠場艇はNULL。race_results.course_1〜6（枠番と恒等で無効）の正確な代わり |
| `race_seconds` | numeric | 可 |  | レースタイムの秒（1'50"7 → 110.7）。完走できなかった艇・5〜6着で空欄のことがある |
| `official_finish_code` | text | 可 |  | 公式の成績ファイル（Kファイル）の着順欄の表記のまま（01〜06・F・L0・L1・K0・K1・S0・S1・S2 等）。K0/S0 は選手責任外。NULL＝未取得（BOA-553） |

### race_conditions

推定行数: 47361

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `race_id` | character varying | 不可 | PK FK→races.race_id | This is a Foreign Key to `races.race_id`.<fk table='races' column='race_id'/> |
| `weather` | character varying | 可 |  |  |
| `wind_direction` | character varying | 可 |  |  |
| `wind_speed` | numeric | 可 |  |  |
| `wave_height` | smallint | 可 |  |  |
| `temperature` | numeric | 可 |  |  |
| `water_temperature` | numeric | 可 |  |  |
| `race_title` | character varying | 可 |  |  |
| `series_day` | smallint | 可 |  |  |
| `is_final_day` | boolean | 可 |  |  |
| `created_at` | timestamp with time zone | 可 |  |  |
| `race_stage` | character varying | 可 |  | 公式サイトracelistページの.title16_titleDetail__add2020から抽出したレースステージ名（例: 予選/準優勝戦/優勝戦/カタメン１予選）。正規化されていない生の文字列 |
| `weather_observed_at` | timestamp with time zone | 可 |  | 気象（weather・wind_direction・wind_speed・wave_height・temperature・water_temperature）の観測時刻。公式beforeinfoの「水面気象情報 HH:MM現在」から組み立てる。raceresult由来の値は発走予定時刻。NULLは観測時刻不明 |
| `race_distance_m` | smallint | 可 |  | レースの距離（m。見出しの「1800m」）。1200mのレースがある |
| `race_labels` | text[] | 可 |  | レースのラベル（表記そのまま。例: {安定板使用}）。NULL=未取得、{}=ラベルなしを確認。未観測のラベルも書けるよう、CHECKは付けない |

### exhibition_data

推定行数: 286454

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `race_id` | character varying | 不可 | PK FK→races.race_id | This is a Foreign Key to `races.race_id`.<fk table='races' column='race_id'/> |
| `boat_number` | smallint | 不可 | PK |  |
| `exhibition_time` | numeric | 可 |  |  |
| `start_timing` | numeric | 可 |  |  |
| `tilt` | numeric | 可 |  |  |
| `propeller_change` | text | 可 |  |  |
| `parts_changed` | text[] | 可 |  |  |
| `adjustment_weight` | numeric | 可 |  |  |
| `today_weight` | numeric | 可 |  |  |
| `prev_race_no` | integer | 可 |  |  |
| `prev_entry_course` | integer | 可 |  |  |
| `prev_start_timing` | numeric | 可 |  |  |
| `prev_finish_rank` | integer | 可 |  |  |
| `created_at` | timestamp with time zone | 可 |  | 行が最初に保存された時刻（INSERT時のDEFAULT now()）。NULLはこの列の追加前に保存された行（不明）。「発走の何分前に取得できたか」の計測に使う |
| `updated_at` | timestamp with time zone | 可 |  | 行の値が変わった時刻（新規の行は保存時刻）。書き込み側のコードが、変更のある行を書くときだけ設定する（トリガーは使わない）。NULLはこの列の追加前に保存され、以降に一度も変更されていない行 |
| `exhibition_course` | smallint | 可 |  | スタート展示の進入コース（行順=コース順。1〜6）。展示航走前・欠場艇はNULL。082以前の行もNULL |
| `start_flag` | text | 可 |  | 展示STの表記の頭（F=フライング、L=出遅れ）。それ以外はNULL。start_timing の値は、F表記でも正の数（F.01→0.01） |
| `prev_finish_mark` | text | 可 |  | 前走の着順の生表記（NFKC正規化後。1〜6・F・欠・落・転 等）。前走が無ければNULL。prev_finish_rank は数字のときだけ入る |
| `is_absent` | boolean | 可 |  | 直前情報で欠場の表示（tbody の is-miss）があるか。NULL=未判定（082以前の行）、false=表示なし、true=欠場の表示あり |

### predictions

推定行数: 139929

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `prediction_id` | integer | 不可 | PK |  |
| `race_id` | character varying | 不可 | FK→races.race_id |  |
| `model_id` | character varying | 不可 | FK→models.model_id |  |
| `top_pick` | smallint | 不可 |  |  |
| `top_2nd` | smallint | 可 |  |  |
| `top_3rd` | smallint | 可 |  |  |
| `confidence` | numeric | 可 |  |  |
| `scores` | jsonb | 可 |  |  |
| `feature_contributions` | jsonb | 可 |  |  |
| `is_hit_win` | boolean | 可 |  |  |
| `is_hit_place` | boolean | 可 |  |  |
| `is_hit_trifecta` | boolean | 可 |  |  |
| `is_hit_trio` | boolean | 可 |  |  |
| `payout_win` | integer | 可 |  |  |
| `payout_place` | integer | 可 |  |  |
| `payout_trifecta` | integer | 可 |  |  |
| `payout_trio` | integer | 可 |  |  |
| `is_shadow` | boolean | 可 |  |  |
| `predicted_at` | timestamp with time zone | 可 |  |  |
| `is_hit_turn` | boolean | 可 |  | unifiedモデルの展開予測的中判定。feature_contributions.turnPrediction.patternsのいずれかのwinnerCourseが実際の1着コース（race_results.rank1）と一致すればtrue。結果反映バッチ（scrape-results.js）で計算・保存。旧3モデル（model_id != unified）の行はNULLのまま。 |

### models

推定行数: 5

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `model_id` | character varying | 不可 | PK |  |
| `display_name` | character varying | 可 |  |  |
| `description` | text | 可 |  |  |
| `model_type` | character varying | 可 |  |  |
| `version` | character varying | 可 |  |  |
| `parent_model_id` | character varying | 可 | FK→models.model_id |  |
| `target_venues` | smallint[] | 可 |  |  |
| `target_volatility_min` | smallint | 可 |  |  |
| `target_volatility_max` | smallint | 可 |  |  |
| `trained_at` | timestamp with time zone | 可 |  |  |
| `training_data_from` | date | 可 |  |  |
| `training_data_to` | date | 可 |  |  |
| `training_race_count` | integer | 可 |  |  |
| `hyperparameters` | jsonb | 可 |  |  |
| `feature_list` | jsonb | 可 |  |  |
| `status` | character varying | 可 |  |  |
| `is_public` | boolean | 可 |  |  |
| `total_predictions` | integer | 可 |  |  |
| `hit_rate_win` | numeric | 可 |  |  |
| `recovery_rate_win` | numeric | 可 |  |  |
| `last_evaluated_at` | timestamp with time zone | 可 |  |  |
| `created_at` | timestamp with time zone | 可 |  |  |
| `updated_at` | timestamp with time zone | 可 |  |  |
| `hit_rate_place` | double precision | 可 |  |  |
| `hit_rate_trifecta` | double precision | 可 |  |  |
| `hit_rate_trio` | double precision | 可 |  |  |
| `recovery_rate_place` | double precision | 可 |  |  |
| `recovery_rate_trifecta` | double precision | 可 |  |  |
| `recovery_rate_trio` | double precision | 可 |  |  |

### racer_aggregated_stats

推定行数: 1639

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `racer_id` | integer | 不可 | PK |  |
| `venue_code` | smallint | 不可 | PK |  |
| `avg_st` | numeric | 可 |  |  |
| `avg_st_last_30` | numeric | 可 |  |  |
| `st_stddev` | numeric | 可 |  |  |
| `flying_rate` | numeric | 可 |  |  |
| `motor_st_data` | jsonb | 可 |  |  |
| `attack_distribution` | jsonb | 可 |  |  |
| `course_entry_tendency` | jsonb | 可 |  |  |
| `total_races` | integer | 可 |  |  |
| `calculated_at` | timestamp with time zone | 可 |  |  |
| `defense_distribution` | jsonb | 可 |  |  |
| `course_race_counts` | jsonb | 可 |  |  |

### venues

推定行数: 24

| 列 | 型 | NULL | キー | コメント |
|---|---|---|---|---|
| `code` | smallint | 不可 | PK |  |
| `name` | character varying | 不可 |  |  |
| `water_type` | character varying | 可 |  |  |
| `cluster` | character varying | 可 |  |  |
| `avg_first_win_rate` | numeric | 可 |  |  |
| `updated_at` | timestamp with time zone | 可 |  |  |
| `course_entry_baseline` | jsonb | 可 |  | 会場×枠番→実進入コースの回数（選手非依存、直近12ヶ月）。夜間バッチ(update-venue-course-entry-baseline.js)が更新する。 |
| `course_entry_baseline_updated_at` | timestamp with time zone | 可 |  |  |
<!-- generated:core-tables:end -->

---

## テーブル関係図

DB 全体の関係図は [`schema-er-diagram.md`](schema-er-diagram.md) を見る。本番スキーマの写し（`schema-snapshot.json`、ADR-0102）から `scripts/maintenance/generate-schema-er-diagram.js` が機械で作り、master へのマージ後に CI（regenerate-generated-docs.yml）が作り直す（ADR-0078）。表の名前で機能のまとまり（SNS 配信・選手・予想とモデル・取得と運用・集計・レースと会場）に分け、外部キーの多重度（1対1・NULL を許すか）も写しから出す。

ここに 2026-09-15 に `mcp__supabase__list_tables` から一度だけ作った54表の図を置いていたが、作り直す手段がリポジトリに無く、その後に増えた表（2026-10-27 の写しで 103 表・ビュー4・外部キー67）を欠いていたので外した。DDL の履歴（`docs/db-migration/`）から積み上げない理由は同じ（DROP・RENAME を追えない）。個別機能の新しい表の図は、引き続き各 `docs/design/{slug}/plan.md` に `generate-er-diagram.js {slug}`（DDL から）で貼る。

---

## 参考: RPC関数

RPC（`supabase.rpc(...)`）の定義は `docs/db-migration/` の各マイグレーション（`CREATE OR REPLACE FUNCTION`）が正。適用状況は `docs/db-migration/APPLIED.md`。
