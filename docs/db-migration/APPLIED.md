# マイグレーション適用状況の台帳

`docs/db-migration/` のマイグレーションSQLは Supabase に手動で適用している（Dashboard の SQL Editor や Management API）。Supabase 側の `list_migrations` は空で、適用履歴が残らないため、この台帳で「どのマイグレーションが本番DBに反映されているか」を記録する。番号の重複検査は `npm run verify:migration-numbers`（`scripts/maintenance/verify-migration-numbers.js`）が担い、このファイルの表に行が無い新規マイグレーション（`origin/master` に無いファイル）があれば失敗にし、既存ファイルの記載漏れは警告する。

## 運用ルール

- 新規マイグレーションを追加するPRでは、この表に行を追加する（適用前は「未適用」、本番へ適用したら「適用済み」に更新し、根拠を書く）
- 番号は着手時とPR作成前に `origin/master` の最大番号を確認する（`npm run verify:migration-numbers` が最大番号と次の番号を表示する）
- 既存の番号重複は、参照が壊れるためリネームしない。新規の重複は `verify-migration-numbers.js` が失敗にする

## 状態の定義

| 状態 | 意味 |
|---|---|
| 適用済み | このマイグレーションが作るテーブル・列・索引・制約・関数、または RPC 関数に入れた変更が、本番DBに存在する |
| 未適用 | このマイグレーションの変更が本番DBに存在しない |
| 不明 | スキーマの突合では確認できない（データ投入・データ更新のみ、COMMENTのみ、RLSポリシー、または後続マイグレーションの `CREATE OR REPLACE` で定義が置換され単独では検証不能） |

「適用済み」は「変更が現行DBに存在する」ことの確認であり、適用した日時・回数の記録ではない。RPC（`CREATE OR REPLACE FUNCTION`）は後続の定義で置換されるため、現行定義（`pg_proc.prosrc`）にそのマイグレーション固有の識別子（JSONのキー名など）が含まれることをもって「適用済み」とした。

## 突合の方法と範囲

- 突合日: 2026-09-19、本番DB（Supabase）に対する読み取り専用の SELECT のみ（4回）
- 参照したもの: `information_schema.tables` / `information_schema.columns`（テーブル・列の存在）、`pg_proc`（関数の存在と `prosrc` 内の識別子）、`pg_class` / `pg_index`（索引の存在と有効性 `indisvalid`）、`pg_constraint`（制約の存在）
- 参照していないもの: RLSポリシー（`pg_policies`）、トリガー、`pg_description`（COMMENT）、データ行（シード・UPDATE/INSERT の結果）。これらのみが変更内容のマイグレーションは「不明」とした
- 列を追加するマイグレーションのうち、追加列が多いもの（032・050・063）は一部の列のみ確認した（該当行に確認した列を明記）

## 突合結果の集計（番号付き80ファイル）

| 状態 | 件数 |
|---|---|
| 適用済み | 65 |
| 未適用 | 1 |
| 不明 | 14 |

番号のない `add-defense-distribution.sql` も突合した（列 `racer_aggregated_stats.defense_distribution`・`course_race_counts` が存在するため適用済み。ただし対象テーブル `racer_aggregated_stats` の CREATE 文は `docs/db-migration/` に無い、下記参照）。

### 注目すべきもの

- **048_add_cancellation_status_to_predictions_rpc.sql は現行DBに反映されていない。** `get_predictions_by_date` / `get_predictions_by_date_light` / `get_today_races` のいずれの `prosrc` にも `cancellation` を含まない。後続の 051・062・066 が 048 より前の定義を土台に `CREATE OR REPLACE` したため上書きされたとみられる（048 自体が一度も適用されなかった可能性も残る）。フロント（`RaceDetailPage.jsx` 等）は `cancellationStatus` を参照しているため、RPC 経由の経路では値が届かない可能性がある。修正する場合は、最新定義（066）に `'cancellationStatus'` を追加する新しいマイグレーションを作る
- 索引 `idx_race_entries_racer_id`（050）・`idx_race_entries_racer_id_race_id`（055）は `CREATE INDEX CONCURRENTLY` で作る索引だが、どちらも存在し有効（`indisvalid = true`）
- 番号の重複は 15 番号ある（008・009・020・021・022・029・030・035・039・047・048・050・054・059・064）。これらは `verify-migration-numbers.js` の `ALLOWED_DUPLICATES` で凍結している。欠番は 024 のみ（002〜006 は番号付きの設計資料 `.md` で、SQL ではない）

### 台帳に載らない実スキーマ

- `race_start_timings`・`racer_aggregated_stats` はDBに存在するが、`docs/db-migration/` に CREATE 文が無い（DDL案は `docs/design/expected-value-feature.md`・`docs/design/first-mark-animation-design.md` 等にのみ存在）。作成元のDDLが特定できないため、再構築時の手順に穴がある

## 台帳

| 番号 | ファイル | 適用状況 | 確認した根拠（実スキーマ） |
|---|---|---|---|
| 001 | 001_schema.sql | 適用済み | 主要15表（venues/races/race_entries/models/predictions/race_results/race_conditions/race_odds/exhibition_data/bet_filters/bet_recommendations/user_visible_summary/model_performance_daily/model_experiments/daily_bet_summary）・ビュー4本（v_*）・関数 update_prediction_results/update_venue_stats が存在。トリガー・RLSポリシーは未確認 |
| 007 | 007_RPC_FUNCTIONS.sql | 不明 | get_today_races / get_predictions_by_date は存在するが、後続マイグレーション（062・066等）の CREATE OR REPLACE で定義が置換済みのため、単独の適用は検証不能 |
| 008 | 008_ADD_EXHIBITION_TO_RPC.sql | 適用済み | get_predictions_by_date の現行定義（prosrc）に exhibition を含む |
| 008 | 008_accuracy_rpc.sql | 適用済み | 関数 get_accuracy_summary が存在 |
| 008 | 008_venue_rules.sql | 適用済み | テーブル venue_rules・rule_applications、関数 update_updated_at_column が存在。トリガー・シード行は未確認 |
| 009 | 009_RACE_HISTORY_RPC.sql | 適用済み | 関数 get_race_history_summary が存在 |
| 009 | 009_add_first_boat_avg_st.sql | 適用済み | 列 races.first_boat_avg_st が存在 |
| 010 | 010_PREDICTIONS_LIGHT_RPC.sql | 不明 | get_predictions_by_date_light は存在するが、後続マイグレーションで定義が置換済みのため単独の適用は検証不能 |
| 011 | 011_prediction_odds.sql | 適用済み | テーブル prediction_odds が存在。get_predictions_by_date / _light の現行定義に prediction_odds を含む |
| 012 | 012_add_volatility_to_get_today_races.sql | 不明 | get_today_races は存在し volatility を含むが、034・038・052・062 で定義が置換済みのため単独の適用は検証不能 |
| 013 | 013_accuracy_cache_table.sql | 適用済み | テーブル accuracy_cache が存在 |
| 013b | 013b_accuracy_cache_rls_policy.sql | 不明 | RLS有効化・ポリシーの存在は pg_policies を参照していないため未確認（対象テーブル accuracy_cache は存在） |
| 014 | 014_add_race_grade_to_races.sql | 適用済み | 列 races.race_grade が存在 |
| 015 | 015_add_race_grade_to_get_today_races.sql | 適用済み | get_today_races の現行定義に raceGrade を含む |
| 016 | 016_bulk_update_race_grade.sql | 不明 | races.race_grade の一括UPDATE（データ更新のみ、スキーマ変更なし）。スキーマの突合では確認できない |
| 017 | 017_drop_race_grade_from_race_conditions.sql | 適用済み | 列 race_conditions.race_grade が存在しない（DROP後の状態と一致） |
| 018 | 018_add_race_grade_to_predictions_rpc.sql | 適用済み | get_predictions_by_date の現行定義に raceGrade を含む（_light は未確認） |
| 019 | 019_restore_prediction_odds_to_rpc.sql | 適用済み | get_predictions_by_date / _light の現行定義に prediction_odds を含む |
| 020 | 020_outcome_distribution.sql | 適用済み | テーブル outcome_distribution が存在。RLSポリシーは未確認 |
| 020 | 020_race_history_cache.sql | 適用済み | テーブル race_history_cache が存在。シード行は未確認 |
| 020b | 020b_race_history_cache_rls_policy.sql | 不明 | RLS有効化・ポリシーの存在は未確認（対象テーブルは存在） |
| 021 | 021_external_predictions.sql | 適用済み | テーブル external_predictions が存在、関数 trg_external_predictions_updated_at が存在 |
| 021 | 021_poirot_predictions.sql | 適用済み | テーブル poirot_predictions が存在 |
| 022 | 022_moriarty_setup.sql | 適用済み | 列 bet_recommendations.bet_fraction が存在。models へのINSERT行は未確認 |
| 022 | 022_race_odds_trifecta_all.sql | 適用済み | 列 race_odds.trifecta_all が存在 |
| 023 | 023_winning_technique_stats.sql | 適用済み | テーブル winning_technique_stats が存在 |
| 025 | 025_top_start_stats.sql | 適用済み | テーブル top_start_stats が存在 |
| 026 | 026_losing_technique_stats.sql | 適用済み | テーブル losing_technique_stats が存在 |
| 027 | 027_nige_outcome_distribution.sql | 適用済み | テーブル nige_outcome_distribution が存在 |
| 028 | 028_exhibition_time_top_stats.sql | 適用済み | テーブル exhibition_time_top_stats が存在 |
| 029 | 029_race_analysis_rpc.sql | 適用済み | 関数 get_race_st_predictability / get_race_exhibition_trend / get_race_technique_profile / get_race_return_rate の4本が存在 |
| 029 | 029_watson_predictions.sql | 適用済み | テーブル watson_predictions が存在 |
| 030 | 030_ai_model_redesign_schema.sql | 適用済み | テーブル race_outcome_frequencies・model_bet_candidates が存在。models へのINSERT行は未確認 |
| 030 | 030_mycroft_predictions.sql | 適用済み | テーブル mycroft_predictions が存在 |
| 031 | 031_add_unified_fields_to_predictions_rpc.sql | 適用済み | get_predictions_by_date / _light の現行定義に unified を含む |
| 032 | 032_add_place_odds_to_race_odds.sql | 適用済み | 列 race_odds.odds_place_1_low・odds_place_3_high が存在（追加6列のうち2列を確認） |
| 033 | 033_add_is_hit_turn_to_predictions.sql | 適用済み | 列 predictions.is_hit_turn が存在 |
| 034 | 034_get_today_races_unified_volatility.sql | 適用済み | get_today_races の現行定義に unified を含む |
| 035 | 035_create_racer_profiles.sql | 適用済み | テーブル racer_profiles が存在 |
| 035 | 035_sns_marketing_hub_schema.sql | 適用済み | テーブル sns_template_variants・sns_approvers・sns_drafts・sns_draft_metrics が存在。sns_approvers のシード行は未確認 |
| 036 | 036_create_racer_news.sql | 適用済み | テーブル racer_news が存在 |
| 037 | 037_add_racer_id_to_predictions_rpc.sql | 適用済み | get_predictions_by_date / _light の現行定義に racerId を含む |
| 038 | 038_add_series_day_to_race_rpcs.sql | 適用済み | get_today_races・get_predictions_by_date・_light の現行定義に seriesDay を含む |
| 039 | 039_fix_volatility_percentile_in_predictions_rpc.sql | 不明 | 現行定義に volatilityPercentile を含むが、041 で同関数が再定義されており、039 固有の変更を識別できない |
| 039 | 039_sns_strategy_insights.sql | 適用済み | テーブル sns_strategy_insights、列 sns_drafts.referenced_insight_ids・sns_template_variants.created_by、索引 idx_sns_drafts_referenced_insights が存在 |
| 040 | 040_sns_strategy_insights_source_comment.sql | 不明 | COMMENT ON COLUMN のみ。pg_description を参照していないため未確認 |
| 041 | 041_get_predictions_by_date_unified_volatility.sql | 不明 | get_predictions_by_date / _light の現行定義に volatilityPercentile を含むが、後続の再定義（048・051・062・066）で置換済みのため単独の適用は検証不能 |
| 042 | 042_content_drafts_columns.sql | 適用済み | 列 sns_drafts.title・embed_video_url・pr_url が存在 |
| 043 | 043_sns_topic_gate_schema.sql | 適用済み | テーブル sns_content_types・sns_target_accounts・sns_topics・sns_topic_targets が存在。シード行は未確認 |
| 044 | 044_sns_topic_categories.sql | 適用済み | テーブル sns_topic_categories・sns_topic_category_channels が存在。シード行は未確認 |
| 045 | 045_sns_topics_rejection_reason.sql | 適用済み | 列 sns_topics.rejection_reason が存在 |
| 046 | 046_sns_topic_categories_exclusion_notes.sql | 不明 | sns_topic_categories のデータ更新のみ（スキーマ変更なし）。今回のスキーマ突合では確認できない |
| 047 | 047_race_cancellation_status.sql | 適用済み | 列 races.cancellation_status・cancellation_check_streak、索引 idx_races_cancellation_status（有効）が存在 |
| 047 | 047_sns_topic_categories_feature_intro_repurpose.sql | 不明 | sns_topic_categories のデータ更新のみ（スキーマ変更なし）。確認できない |
| 048 | 048_add_cancellation_status_to_predictions_rpc.sql | 未適用 | get_predictions_by_date / _light / get_today_races のいずれの現行定義にも cancellation を含まない。051・062・066 が本マイグレーション前の定義を土台に再定義したため上書きされたとみられる（本マイグレーションが一度も適用されなかった可能性も残る）。フロント（RaceDetailPage等）は cancellationStatus を参照している。要対応 |
| 048 | 048_drop_venues_avg_volatility_score.sql | 適用済み | 列 venues.avg_volatility_score が存在しない（DROP後の状態と一致） |
| 049 | 049_sns_topic_categories_trivia_connect.sql | 不明 | sns_topic_categories のデータ更新のみ（スキーマ変更なし）。確認できない |
| 050 | 050_race_entries_racer_id_index.sql | 適用済み | 索引 idx_race_entries_racer_id が存在し有効（indisvalid=true） |
| 050 | 050_race_results_full_order_and_payouts.sql | 適用済み | race_results に rank4・rank6・race_time_1・race_time_6・payout_exacta・payout_quinella・payout_wide_1・payout_wide_3・popularity_trifecta・popularity_wide_3 が存在（追加列のうち10列を確認）。051 の RPC も rank4 を含む |
| 050 | 050_sns_topic_categories_humor.sql | 不明 | sns_topic_categories・sns_topic_category_channels へのINSERTのみ（スキーマ変更なし）。確認できない |
| 051 | 051_get_predictions_by_date_full_order.sql | 適用済み | get_predictions_by_date / _light の現行定義に rank4 を含む |
| 052 | 052_get_today_races_add_turn_prediction.sql | 適用済み | get_today_races の現行定義に turnPrediction を含む |
| 053 | 053_sns_approvers_auto_merge.sql | 不明 | sns_approvers へのINSERTのみ（スキーマ変更なし）。確認できない |
| 054 | 054_racer_grade_cache_table.sql | 適用済み | テーブル racer_grade_cache、索引 idx_racer_grade_cache_updated_at が存在。シード行は未確認 |
| 054 | 054_sns_campaigns_schema.sql | 適用済み | テーブル sns_campaigns・sns_campaign_entries、列 sns_topics.campaign_id、索引 idx_sns_topics_campaign が存在 |
| 055 | 055_get_latest_racer_grades_rpc.sql | 適用済み | 関数 get_latest_racer_grades、索引 idx_race_entries_racer_id_race_id（有効）が存在 |
| 056 | 056_exhibition_data_tilt_parts.sql | 適用済み | 列 exhibition_data.tilt・propeller_change・parts_changed・adjustment_weight が存在 |
| 057 | 057_venue_motor_stats.sql | 適用済み | テーブル venue_motor_stats、索引 idx_venue_motor_stats_latest が存在 |
| 058 | 058_race_conditions_race_stage.sql | 適用済み | 列 race_conditions.race_stage が存在 |
| 059 | 059_exhibition_data_weight_prev_result.sql | 適用済み | 列 exhibition_data.today_weight・prev_race_no・prev_entry_course・prev_start_timing・prev_finish_rank が存在 |
| 059 | 059_venue_grade_boat_stats.sql | 適用済み | テーブル venue_grade_boat_stats、索引 idx_venue_grade_boat_stats_venue が存在 |
| 060 | 060_race_special_notes.sql | 適用済み | テーブル race_special_notes・race_notices_health、索引2本、制約 uq_race_special_notes_dedup が存在 |
| 061 | 061_racer_profiles_season_stats.sql | 適用済み | 列 racer_profiles.ability_index・flying_count_period・false_start_count_period・period_label・official_win_rate_period・official_updated_at が存在（列の存在のみ。値の充足は別） |
| 062 | 062_add_race_stage_to_race_rpcs.sql | 適用済み | get_today_races・get_predictions_by_date・_light の現行定義に raceStage を含む |
| 063 | 063_race_results_actual_course_kfile.sql | 適用済み | 列 race_results.actual_course_1・actual_course_6 が存在（追加6列のうち2列を確認） |
| 064 | 064_racer_series_points.sql | 適用済み | テーブル racer_series_points、索引 idx_racer_series_points_racer が存在（行数は別。ベースライン実測では0件） |
| 064 | 064_venue_entry_course_stats.sql | 適用済み | テーブル venue_entry_course_stats、索引2本が存在 |
| 065 | 065_race_odds_all_combinations.sql | 適用済み | 列 race_odds.trio_all・exacta_all・quinella_all・wide_all が存在 |
| 066 | 066_add_weather_to_predictions_rpc.sql | 適用済み | get_predictions_by_date / _light の現行定義に weather を含む |
| 067 | 067_venues_course_entry_baseline.sql | 適用済み | 列 venues.course_entry_baseline・course_entry_baseline_updated_at、関数 compute_venue_course_entry_baseline が存在 |
| 068 | 068_restore_cancellation_status_in_rpcs.sql | 適用済み | 2026-09-19にユーザーが適用。get_predictions_by_date / _light / get_today_races の3関数の`prosrc`に`cancellationStatus`を含み、`get_predictions_by_date_light('2026-09-12')`の156レース中、`cancellationStatus='confirmed'`が34件（DBの`races.cancellation_status='confirmed'`の34件と一致） |
| 069 | 069_race_conditions_weather_observed_at.sql | 適用済み | 2026-09-19にユーザーが適用。列 race_conditions.weather_observed_at（`timestamp with time zone`）が存在（information_schema.columns で確認） |
| 070 | 070_add_weather_observed_at_to_rpcs.sql | 適用済み | 2026-09-19にユーザーが適用。get_predictions_by_date / _light の現行定義（pg_proc.prosrc）に observedAt を含み、get_predictions_by_date_light('2026-09-19')の156レース中、weatherを持つ142レースの全てで weather.observedAt のキーが存在（適用前は142件中142件が欠落）。get_today_races は weather を返さないため対象外 |
| （番号なし） | add-defense-distribution.sql | 適用済み | 列 racer_aggregated_stats.defense_distribution・course_race_counts が存在 |
