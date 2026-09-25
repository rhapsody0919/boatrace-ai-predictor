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
| 071 | 071_add_scraped_timestamps.sql | 適用済み | 2026-09-19 23:4x JSTに、親がユーザーの承認のもと、Management API経由でトランザクション内（`BEGIN`〜`COMMIT`）で適用。exhibition_data・race_entries・race_start_timings に created_at・updated_at（timestamptz、NULL可）が存在。created_at の column_default は now()、updated_at は DEFAULT なし。適用前の9/18分の既存行（各約1,080行）は、created_at・updated_at とも NULL のまま（適用後に確認）（WS2） |
| 074 | 074_kb_archive_tables.sql | 適用済み | 2026-09-20 21:1x JSTに、親がユーザーの承認のもと、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: kb_archive_venue_days・kb_archive_races・kb_archive_boats の3表が存在し、3表ともRLS有効・anonのSELECT権限なし（K/Bファイル長期バックフィル用。設計: docs/design/kb-longterm-backfill/plan.md）。表は空で、データの取得・投入はユーザー承認後（K3: 生LZHの取得を先行） |
| 075 | 075_scrape_slots_and_job_state.sql | 適用済み | 2026-09-20 11:4x JSTに、親がユーザーの承認のもと、Management API経由でトランザクション内（`BEGIN`〜`COMMIT`、マイグレーション内の適用検査DOブロックも通過）で適用（WS4a・T4a-03）。適用後の実測: scrape_slots 18列・scrape_job_state 14列、race_odds.window_min（smallint、NULL可）・source（text、NOT NULL、DEFAULT 'gha'）、索引 idx_scrape_slots_active・idx_scrape_slots_race_date・uq_race_odds_race_window の3本、RPC ensure_scrape_slots・claim_scrape_slots は anon=false・service_role=true、両テーブルのRLS有効で anon の SELECT 権限なし。race_odds の既存134,858行は全て source='gha'・window_min NULL |
| 076 | 076_enable_rls_on_public_tables.sql | 適用済み | 2026-09-20 12:12 JSTに、親がユーザーの承認のもと、Management API経由で1トランザクション（マイグレーション内の`BEGIN`〜`COMMIT`）で適用（BOA-370）。適用後の実測: RLS無効のテーブルは0件（適用前16件）、anon/authenticatedの非SELECT権限は0件（適用前720件）、ビュー4本は`security_invoker=true`。anonキーで、画面・分析ツールが読む14テーブルと、RPC `get_today_races`・`get_predictions_by_date_light`が読める（HTTP 200・行あり）。読ませない設計の10テーブル（venue_rules・rule_applications・bet_filters・daily_bet_summary・model_experiments・race_notices_health・race_special_notes・venue_entry_course_stats・scrape_slots・sns_drafts）は、anonからHTTP 401。service_roleの書き込みは影響なし（適用の約4分後に、race_odds・exhibition_data・race_resultsへの新しい書き込みを確認）。`npm run`外の確認は`scripts/maintenance/check-anon-access.js --expect-applied`で再現できる。`race_special_notes`は、特記事項ページの実装PRでSELECTポリシーとGRANT SELECTを追加すること |
| 077 | 077_race_start_timings_boat_result.sql | 適用済み | 2026-09-20 21:1x JSTに、親がユーザーの承認のもと、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: race_start_timings に finish_mark・finish_rank・entry_course・race_seconds の4列が存在（NULL可・DEFAULTなし。CHECK制約はNOT VALID→VALIDATE済み） |
| 078 | 078_race_results_status_refund.sql | 適用済み | 2026-09-20 21:1x JSTに、親がユーザーの承認のもと、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: race_results に race_status・refund_boats・remark の3列が存在（NULL可・DEFAULTなし。CHECK制約 chk_race_results_status はVALIDATE済み）。行のUPDATEは発生せず、trg_update_predictions は発火しない |
| 079 | 079_race_payouts.sql | 適用済み | 2026-09-20 21:1x JSTに、親がユーザーの承認のもと、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: race_payouts が存在し、RLS有効・anonのSELECT権限なし（読み手ができたらSELECTポリシーを追加する） |
| 080 | 080_racer_news_pending.sql | 適用済み | 2026-09-20 21:1x JSTに、親がユーザーの承認のもと、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: racer_news_pending が存在し、RLS有効・anonのSELECT権限なし。適用後の全体確認: RLS無効のテーブル0件、anon/authenticatedの非SELECT権限0件、`scripts/maintenance/check-anon-access.js --expect-applied` が ALL OK |
| 081 | 081_race_entries_racelist_fields.sql | 適用済み | 2026-09-21 11:2x JSTに、親がユーザーの承認のもと（開催時間帯でも、本番が壊れなければ適用してよい、という方針）、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: race_entries に weight_kg・branch・hometown・f_count・l_count・is_absent、race_conditions に race_distance_m・race_labels が存在（全列NULL可・DEFAULTなし。CHECK制約はNOT VALID→VALIDATE済み） |
| 082 | 082_exhibition_data_beforeinfo_fields.sql | 適用済み | 2026-09-21 11:2x JSTに、親がユーザーの承認のもと（開催時間帯でも、本番が壊れなければ適用してよい、という方針）、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: exhibition_data に exhibition_course・start_flag・prev_finish_mark・is_absent が存在（全列NULL可・DEFAULTなし。CHECK制約はVALIDATE済み） |
| 083 | 083_racer_period_stats.sql | 適用済み | 2026-09-21 11:2x JSTに、親がユーザーの承認のもと（開催時間帯でも、本番が壊れなければ適用してよい、という方針）、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: racer_period_stats が存在し、RLS有効・anonのSELECT権限なし。racer_profiles に sex・training_term が存在 |
| 084 | 084_race_series.sql | 適用済み | 2026-09-21 11:2x JSTに、親がユーザーの承認のもと（開催時間帯でも、本番が壊れなければ適用してよい、という方針）、Management API経由で、ファイルごとに別のトランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: race_series が存在し、RLS有効・anonのSELECT権限なし。全体確認: RLS無効のテーブル0件、anon/authenticatedの非SELECT権限0件、`check-anon-access.js --expect-applied` が ALL OK |
| 085 | 085_race_pit_reports.sql | 適用済み | 2026-09-21 11:5x JSTに、親がユーザーの承認のもと、Management API経由で、1トランザクション（`BEGIN`〜`COMMIT`）で適用（BOA-379）。適用前に、長時間クエリが0件であることを確認。適用後: race_pit_reports・race_pit_comments が存在し、2表ともRLS有効・anonのSELECT権限なし。同時に、Storageの非公開バケット`raw-pages`（public=false）を、ユーザーの承認のもと作成した。086（匿名へのSELECT）は、画面の実装後に適用する |
| 086 | 086_race_pit_reports_public_read.sql | 適用済み | 2026-09-23 08:5x JSTに、ユーザーの承認のもと（画面の実装・自己検証の完了後、ローカルでの確認のため）、Management API経由で、1トランザクション（`BEGIN`〜`COMMIT`）で適用。適用前に、長時間クエリが0件であることを確認。適用後: race_pit_reports・race_pit_comments とも anon の SELECT=true・INSERT/UPDATE/DELETE=false、RLS有効、公開読み取りポリシー各1件を確認。advisorの `rls_disabled_in_public`・`security_definer_view` は0件。**公式コンテンツの再表示を始める境目**（docs/adr/0067 の追記案、BOA-379）。ロールバックはファイル冒頭のコメント参照 |
| 091 | 091_boatcast_original_exhibition.sql | 適用済み | 2026-09-22 19:0x JSTに、親がユーザーの承認のもと、Management API経由で、1トランザクション（`BEGIN`〜`COMMIT`）で適用。BOATCASTのオリジナル展示（N25）・モーター使用開始日（N26）の保存先: race_original_exhibition・race_original_exhibition_values・venue_motor_start_dates の3表を新設（RLS有効・anonの権限なし。公式コンテンツの再表示を含むため匿名のSELECTは付けない。ADR-0067）。適用後の確認: 3表が存在しRLS有効・anonのSELECT権限なし。docs/design/boatcast-original-exhibition/ |
| 090 | 090_motor_pretest_stats.sql | 適用済み | 2026-09-22 19:0x JSTに、親がユーザーの承認のもと、Management API経由で、1トランザクション（`BEGIN`〜`COMMIT`）で適用。新規テーブル motor_pretest_stats（前検タイム・前検順位・節時点のモーター/ボートの番号と2連対率の日次スナップショット。公式 race/rankingmotor。N23、tasks.md T4b-20。設計: docs/design/scraping-vercel-consolidation/plan.md §15）。RLS有効・anon/authenticatedの全権限を剥奪。適用後の確認: テーブル・RLS有効・anonのSELECT権限なしを確認済み |
| 089 | 089_data_health_functions.sql | 適用済み | 2026-09-22 19:0x JSTに、親がユーザーの承認のもと、Management API経由で、1トランザクション（`BEGIN`〜`COMMIT`）で適用。汎用の日次監視（data_health、完了の定義C）が呼ぶ、読み取り専用の集計関数7本（`data_health_coverage`・`data_health_pre_race_fields`・`data_health_pit_reports`・`data_health_race_series`・`data_health_racer_period_stats`・`data_health_monthly_result`・`data_health_table_rows`）。テーブル・データの変更なし。SECURITY INVOKER・STABLE・service_roleのみEXECUTE。適用後の確認: 7関数が存在しsecurity_definer=false・volatility=STABLE・anon/authenticatedのEXECUTE権限なし・service_roleのみEXECUTE可を確認済み |
| 092 | 092_claim_scrape_slots_by_offset.sql | 適用済み | 2026-09-22 19:0x JSTに、親がユーザーの承認のもと、Management API経由で、1トランザクション（`BEGIN`〜`COMMIT`）で適用（PR #782、未マージのブランチ`feat/odds-60-window-extend`から内容を取得して適用。マージはコード側のフォールバックにより順序を問わない）。既存の`claim_scrape_slots`（075）のコピーに、offset_minごとの許容幅の上書き（`p_grace_by_offset`）を足した新関数`claim_scrape_slots_by_offset`を追加（既存の関数・テーブル・列は無変更）。オッズの発走60分前の窓（-60）が未公開の間だけ許容幅を延ばす用途（完了の定義Bの見直し）。適用後の確認: 関数が2本（既存・新規）とも anon/authenticatedのEXECUTE権限なし・service_roleのみEXECUTE可を確認済み |
| 093 | 093_race_special_notes_unique_by_racer.sql | 未適用 | race_special_notes の一意索引 (venue_code, race_date, category, detail_text) に racer_name を追加し、同日・同内容の別選手の通知が1行に潰れる問題を解消（BOA-371）。適用時点で本番は0件（本番実測で確認済み）のためデータ移行なしで直せる。対応コード: scripts/daily/scrape-race-information.js（onConflictを5列に変更） |
| 094 | 094_course_baselines.sql | 2026-09-24 適用 | コース×級別ベースラインの事前集計テーブル2つ（`st_course_baseline` **24行**＝コース6×級別4・`nige_second_by_course` **120行**＝24会場×5コース）と、日次バッチが呼ぶ集計RPC 2つ（`compute_st_course_baseline` / `compute_nige_second_by_course`、service_role専用・匿名はREVOKE）を新設。UI/UX刷新 phase a のST考察の「同コース平均との差」と逃げシミュレーション用。どちらもRLS有効・匿名はSELECTのみ。既存の`nige_outcome_distribution`（027、BOA-158が使用中）は変更しない。設計: docs/design/analysis-visualization-upgrade/plan.md §2.1 / docs/adr/0068。**画面の実装より先に適用が要る**（バッチが書き込むため）。適用後に `scripts/daily/update-course-baseline-stats.js` を本番実行し24行＋120行を投入済み。2回目の実行で全144行が「変更なしスキップ」になることも確認済み |
| 095 | 095_phase_a_numeric_public_read.sql | 未適用 | 数値・事実データ3表（`motor_pretest_stats`・`racer_period_stats`・`race_series`）を匿名（画面）から読めるようにする SELECT のみのポリシーと GRANT。phase a の FR-4a・FR-4c・FR-4d。3表は数値・事実データでADR-0067の追記は要さないが、**匿名への公開そのものはユーザー承認が要る**（086と同じ手続き）。画面の実装・自己検証の後に適用する |
| 096 | 096_original_exhibition_public_read.sql | 未適用 | オリジナル展示2表（`race_original_exhibition`・`_values`）を匿名から読めるようにする。phase a の FR-4b。**091が匿名の権限を意図的に剥奪している**ため、ADR-0067のBOATCAST追記どおり「出典表記の設計とモック承認」＋「ADR-0067への追記」が適用の前提。ピットレポートの086と同じ手続き |
| 097 | 097_limit_trg_update_predictions_columns.sql | 未適用 | `race_results`のトリガー`trg_update_predictions`を`UPDATE OF rank1〜3・payout_win/payout_place_1/payout_place_2/payout_trifecta/payout_trio`の8列限定にする（BOA-405/BOA-409、WS8(c)-2）。トリガー関数`update_prediction_results()`自体は無変更、`CREATE TRIGGER`の発火条件のみ絞る。設計・裏付け: docs/design/scraping-vercel-consolidation/predictions-write-optimization.md 4節、PR #808。ドラフトのみでDDL未適用（BOA-409のスコープ） |
| 098 | 098_morning_data_digest.sql | 2026-09-24 適用 | 「本日のデータ一覧」ページ（BOA-402）の事前集計4表。`venue_course_technique_baseline`（144行＝24会場×6コース）・`racer_course_technique_stats`（約9,000行＝約1,600選手×6コース）・`morning_digest_days`（1行/日）・`morning_digest_rows`（40〜60行/日）。4表ともRLS有効・匿名はSELECTのみ。ページとSNS下書きが `morning_digest_rows` の同じ行を読むことでWeb/SNS間の値の食い違いを構造的に防ぐ（ADR-0070）。率は「実績率−会場構成から期待される率」で会場の交絡を除く（ADR-0071）。設計: docs/design/morning-data-digest/plan.md §2。**日次バッチが書き込むため画面の実装より先に適用が要る**。2026-09-24にユーザーがSupabase Dashboardで1トランザクション適用。適用後の実測: 4表とも RLS有効・anon の SELECT=true / INSERT・UPDATE・DELETE=false・公開読み取りポリシー各1件、`morning_digest_rows` の FK が `morning_digest_days` を ON DELETE CASCADE で参照、集計RPC 2本は anon/authenticated の EXECUTE=false・service_role のみ true・STABLE・security_definer=false。advisorの `rls_disabled_in_public`・`security_definer_view` は0件、`check-anon-access.js --expect-applied` が ALL OK。なお `function_search_path_mutable` のWARNに新RPC 2本が入るが、既存の17関数（094の `compute_st_course_baseline` を含む）すべてが同じ状態でプロジェクト共通の既存課題。次は `scripts/daily/update-racer-course-technique-stats.js` を本番実行して投入し、2回目の実行で全行が「変更なしスキップ」になることを確認する |
| 099 | 099_morning_digest_vercel_cron_jobs.sql | 未適用 | 「本日のデータ一覧」（BOA-402）の2ジョブを Vercel Cron で動かすための `scrape_job_state` の行（`racer_course_technique_stats` / `morning_digest` を `mode='live'`）。**共通ラッパは行が無い・`off` のとき何もしない**ため、この行を入れるまで Vercel Cron は起動しても書き込まない。GitHub Actions の定時実行が実測で2.5〜4.5時間遅れるのが常態で、朝に出ることが価値の中心の `/today` では前提が成立しなかったための移行（plan.md §2.4、ADR-0066 §改訂1）。DDLは無く、行のINSERT/UPDATEのみ（新規テーブル・ビューなし＝RLSの追加規律は対象外）。**Vercelへのデプロイ後に適用する**（関数が先に存在している必要がある）。切り戻しは `mode='off'` に戻すだけで、GitHub Actions 側は `workflow_dispatch` で残してある |
| （番号なし） | add-defense-distribution.sql | 適用済み | 列 racer_aggregated_stats.defense_distribution・course_race_counts が存在 |
