# データの読み手の台帳

> 機械生成（`node scripts/maintenance/generate-data-readers.js`）。手で書き換えない。表・列・RPC を変える・消す前に、ここで読み手と書き手を確かめる。master へのマージ後に CI（regenerate-generated-docs.yml）が作り直す。PR には含めない（ADR-0078）。作業中の枝の影響を見るときは手元で作り直して読み、コミットせずに戻す。機械で拾えない repo の外の読み手（hq 等）は `docs/reference/data-readers.extra.json` に手で足す。
>
> 入力: `src/`・`api/`・`scripts/`・`sns-video-studio/` の JS/TS（構文木で `.from()`・`.select()`・`.rpc()` 等と `/rest/v1/` を拾う）と、本番スキーマの写し（`docs/reference/schema-snapshot.json`、取得 2026-10-27T08:16:33.412Z）。権限・RPC の本体はこの写しの時点のもの。

## 件数

| 項目 | 件数 |
|---|---|
| 表・ビュー（写し） | 107 |
| RPC（写しの関数） | 68 |
| 読んだファイル | 2369 |
| 読み書きのあるファイル | 298 |
| 表の読み手（箇所） | 948 |
| 表の書き手（箇所） | 195 |
| RPC の呼び手（箇所） | 55 |
| 名前の文字列だけの箇所（呼ぶ経路は式） | 265 |
| 読み手の見つからない表（RPC・ビュー経由・名前の文字列・外も無し。data_health_* の監視だけのものは含む） | 21 |
| 呼び手の見つからない RPC（RPC 経由・名前の文字列・トリガー・外も無し） | 7 |
| 外の読み手（手で足した行） | 1 |
| コードが使うのに写しに無い名前 | 8 |
| 名前が式で拾えなかった箇所 | 34 |
| 構文木にできなかったファイル | 0 |
| 対象外の言語のファイル（Python 等） | 55 |

## 表

読み手・書き手は箇所の数。権限の「anon 可」は anon に SELECT の GRANT があり、RLS が無いか anon・PUBLIC 向けの SELECT のポリシーがあるもの。service_role は RLS を通らないので「service だけ」でも service のキーからは読める。

| 表 | 種類 | 権限 | 読み手 | 書き手 | 本体で読む RPC・ビュー | 本体で書く RPC | 取得のジョブ | 外の読み手 |
|---|---|---|---|---|---|---|---|---|
| [accuracy_cache](#t-accuracy_cache) | table | anon 可 | 5 | 3 | data_health_nightly_freshness |  |  |  |
| [analogy_contribution_profiles](#t-analogy_contribution_profiles) | table | anon 可 | 2 | 0 |  |  |  |  |
| [analogy_feedback](#t-analogy_feedback) | table | service だけ | 0 | 1 | analogy_feedback_guard |  |  |  |
| [analogy_models](#t-analogy_models) | table | anon 可 | 4 | 0 | activate_analogy_model | activate_analogy_model |  |  |
| [analogy_v16_snapshots](#t-analogy_v16_snapshots) | table | anon 可 | 12 | 1 | data_health_morning_freshness |  | analogy_v16_exhibition |  |
| [bet_filters](#t-bet_filters) | table | service だけ | 0 | 0 |  |  |  |  |
| [bet_recommendations](#t-bet_recommendations) | table | anon 可 | 5 | 4 | data_health_morning_freshness, data_health_nightly_freshness | update_prediction_results |  |  |
| [daily_bet_summary](#t-daily_bet_summary) | table | service だけ | 0 | 0 |  |  |  |  |
| [exhibition_data](#t-exhibition_data) | table | anon 可 | 48 | 4 | data_health_coverage, data_health_table_rows, get_predictions_by_date ほか3 |  | exhibition, race_info, races_init |  |
| [exhibition_time_top_stats](#t-exhibition_time_top_stats) | table | anon 可 | 1 | 2 | data_health_nightly_freshness |  |  |  |
| [external_predictions](#t-external_predictions) | table | anon 可 | 1 | 1 | data_health_table_rows |  | pcexpect |  |
| [fetch_counts](#t-fetch_counts) | table | service だけ | 0 | 0 | fetch_counts_daily | add_fetch_counts |  |  |
| [fetch_counts_minute](#t-fetch_counts_minute) | table | service だけ | 0 | 0 |  | add_fetch_counts |  |  |
| [in_caution_gap_band_daily](#t-in_caution_gap_band_daily) | table | service だけ | 0 | 0 | get_in_caution_band_rates |  |  |  |
| [kb_archive_boats](#t-kb_archive_boats) | table | service だけ | 2 | 0 |  |  |  |  |
| [kb_archive_races](#t-kb_archive_races) | table | service だけ | 5 | 0 |  |  |  |  |
| [kb_archive_venue_days](#t-kb_archive_venue_days) | table | service だけ | 2 | 0 |  |  |  |  |
| [losing_technique_stats](#t-losing_technique_stats) | table | anon 可 | 2 | 2 | data_health_nightly_freshness |  |  |  |
| [model_bet_candidates](#t-model_bet_candidates) | table | anon 可 | 0 | 0 |  |  |  |  |
| [model_experiments](#t-model_experiments) | table | service だけ | 0 | 0 |  |  |  |  |
| [model_performance_daily](#t-model_performance_daily) | table | anon 可 | 3 | 1 | data_health_nightly_freshness |  |  |  |
| [models](#t-models) | table | anon 可 | 2 | 1 | get_accuracy_summary, view:v_production_models |  |  |  |
| [morning_digest_days](#t-morning_digest_days) | table | anon 可 | 2 | 2 |  |  | morning_digest |  |
| [morning_digest_rows](#t-morning_digest_rows) | table | anon 可 | 2 | 3 |  |  | morning_digest |  |
| [motor_pretest_stats](#t-motor_pretest_stats) | table | anon 可 | 7 | 0 |  |  |  |  |
| [mycroft_predictions](#t-mycroft_predictions) | table | anon 可 | 1 | 1 |  |  |  |  |
| [nige_outcome_distribution](#t-nige_outcome_distribution) | table | anon 可 | 1 | 2 | data_health_nightly_freshness |  | outcome_distribution_update |  |
| [nige_second_by_course](#t-nige_second_by_course) | table | anon 可 | 2 | 1 | data_health_nightly_freshness |  |  |  |
| [outcome_distribution](#t-outcome_distribution) | table | anon 可 | 5 | 2 | data_health_nightly_freshness |  | outcome_distribution_update |  |
| [poirot_predictions](#t-poirot_predictions) | table | anon 可 | 2 | 1 | data_health_morning_freshness |  |  |  |
| [prediction_odds](#t-prediction_odds) | table | anon 可 | 4 | 2 | get_predictions_by_date, get_predictions_by_date_light |  | odds |  |
| [predictions](#t-predictions) | table | anon 可 | 44 | 10 | get_accuracy_summary, get_admin_rule_performance, get_predictions_by_date ほか6 | update_prediction_results | exhibition, kfile_sync, race_info ほか4 | hq:platform/finals_sheet.py |
| [race_conditions](#t-race_conditions) | table | anon 可 | 44 | 6 | data_health_coverage, data_health_nightly_freshness, data_health_pre_race_fields ほか5 |  | exhibition, kfile_sync, race_info ほか4 |  |
| [race_entries](#t-race_entries) | table | anon 可 | 146 | 17 | compute_racer_course_technique_stats, compute_st_course_baseline, compute_today_course_win_stats ほか16 |  | exhibition, race_info, races_init |  |
| [race_history_cache](#t-race_history_cache) | table | anon 可 | 2 | 1 | data_health_nightly_freshness |  |  |  |
| [race_notices_health](#t-race_notices_health) | table | service だけ | 2 | 1 |  |  | race_notices |  |
| [race_odds](#t-race_odds) | table | anon 可 | 15 | 3 | data_health_coverage, data_health_table_rows |  | odds, odds_final |  |
| [race_odds_final](#t-race_odds_final) | table | anon 可 | 3 | 1 |  |  | odds_final |  |
| [race_original_exhibition](#t-race_original_exhibition) | table | anon 可 | 5 | 1 |  |  | boatcast_oriten |  |
| [race_original_exhibition_values](#t-race_original_exhibition_values) | table | anon 可 | 5 | 2 |  |  | boatcast_oriten |  |
| [race_outcome_frequencies](#t-race_outcome_frequencies) | table | anon 可 | 0 | 1 |  |  |  |  |
| [race_payouts](#t-race_payouts) | table | anon 可 | 3 | 2 | data_health_table_rows, get_predictions_by_date, get_predictions_by_date_light |  | kfile_sync, race_status, result ほか1 |  |
| [race_pit_comments](#t-race_pit_comments) | table | anon 可 | 2 | 2 |  |  | pit_reports |  |
| [race_pit_reports](#t-race_pit_reports) | table | anon 可 | 4 | 1 | data_health_pit_reports, data_health_table_rows |  | pit_reports |  |
| [race_results](#t-race_results) | table | anon 可 | 111 | 10 | compute_nige_second_by_course, compute_racer_course_technique_stats, compute_st_course_baseline ほか17 |  | kfile_sync, race_status, result ほか1 |  |
| [race_series](#t-race_series) | table | anon 可 | 15 | 0 | data_health_race_series, data_health_table_rows |  |  |  |
| [race_special_notes](#t-race_special_notes) | table | service だけ | 1 | 1 | data_health_table_rows |  | race_notices |  |
| [race_start_timings](#t-race_start_timings) | table | anon 可 | 28 | 6 | compute_st_course_baseline, data_health_coverage, data_health_table_rows ほか2 |  | kfile_sync, race_status, result ほか1 |  |
| [racer_aggregated_stats](#t-racer_aggregated_stats) | table | anon 可 | 12 | 1 | data_health_nightly_freshness |  |  |  |
| [racer_course_technique_stats](#t-racer_course_technique_stats) | table | anon 可 | 4 | 1 |  |  | racer_course_technique_stats |  |
| [racer_grade_cache](#t-racer_grade_cache) | table | anon 可 | 2 | 1 | data_health_nightly_freshness |  |  |  |
| [racer_news](#t-racer_news) | table | anon 可 | 3 | 2 |  |  | racer_news |  |
| [racer_news_pending](#t-racer_news_pending) | table | service だけ | 2 | 2 |  |  | racer_news |  |
| [racer_period_stats](#t-racer_period_stats) | table | anon 可 | 8 | 0 | data_health_racer_period_stats, data_health_table_rows |  |  |  |
| [racer_profiles](#t-racer_profiles) | table | anon 可 | 15 | 3 | data_health_table_rows |  | racer_profiles |  |
| [racer_series_points](#t-racer_series_points) | table | anon 可 | 5 | 1 | data_health_nightly_freshness, data_health_table_rows |  | point_rank |  |
| [races](#t-races) | table | anon 可 | 156 | 18 | claim_scrape_slots, claim_scrape_slots_by_offset, compute_nige_second_by_course ほか24 |  | exhibition, kfile_sync, race_info ほか4 |  |
| [raw_snapshots](#t-raw_snapshots) | table | service だけ | 0 | 1 |  |  | fan_period |  |
| [rule_applications](#t-rule_applications) | table | service だけ | 1 | 2 |  |  |  |  |
| [scrape_job_state](#t-scrape_job_state) | table | service だけ | 13 | 14 |  | scrape_breaker_open | analogy_dispatch_morning, analogy_dispatch_train, analogy_v16_exhibition ほか45 |  |
| [scrape_slots](#t-scrape_slots) | table | service だけ | 10 | 9 | claim_scrape_slots, claim_scrape_slots_by_offset | claim_scrape_slots, claim_scrape_slots_by_offset, ensure_scrape_slots | analogy_dispatch_morning, analogy_dispatch_train, analogy_v16_exhibition ほか45 |  |
| [sns_approvers](#t-sns_approvers) | table | service だけ | 2 | 0 | approve_sns_x_send |  |  |  |
| [sns_auto_send_control](#t-sns_auto_send_control) | table | service だけ | 18 | 0 | approve_sns_x_send, transition_sns_send_139, transition_sns_x_send |  |  |  |
| [sns_auto_send_incidents](#t-sns_auto_send_incidents) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_auto_send_items](#t-sns_auto_send_items) | table | service だけ | 19 | 4 | approve_sns_x_send, sns_bundle_send_allowed, sns_x_slot_room ほか3 | stop_sns_auto_item, transition_sns_x_send | sns_auto_plan |  |
| [sns_bundle_imports](#t-sns_bundle_imports) | table | service だけ | 2 | 0 | guard_sns_preview_bundle_draft, import_sns_preview_bundle, sns_bundle_send_allowed | import_sns_preview_bundle |  |  |
| [sns_campaign_entries](#t-sns_campaign_entries) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_campaigns](#t-sns_campaigns) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_channel_daily](#t-sns_channel_daily) | table | service だけ | 1 | 1 |  |  | sns_daily |  |
| [sns_content_types](#t-sns_content_types) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_draft_metrics](#t-sns_draft_metrics) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_drafts](#t-sns_drafts) | table | service だけ | 35 | 6 | append_sns_metric_observation, approve_sns_x_send, enqueue_sns_metric_jobs ほか10 | approve_sns_x_send, import_sns_preview_bundle, save_sns_draft_diff ほか7 | sns_auto_plan, sns_daily, sns_metrics ほか1 |  |
| [sns_metric_jobs](#t-sns_metric_jobs) | table | service だけ | 3 | 2 |  | enqueue_sns_metric_jobs | sns_metrics |  |
| [sns_metric_observations](#t-sns_metric_observations) | table | service だけ | 4 | 0 | append_sns_metric_observation | append_sns_metric_observation |  |  |
| [sns_oauth_tokens](#t-sns_oauth_tokens) | table | service だけ | 1 | 4 |  |  | sns_metrics, sns_send |  |
| [sns_post_tracking](#t-sns_post_tracking) | table | service だけ | 1 | 1 |  |  | sns_auto_plan |  |
| [sns_strategy_insights](#t-sns_strategy_insights) | table | service だけ | 4 | 2 |  |  | sns_auto_plan, sns_daily, sns_metrics ほか1 |  |
| [sns_target_accounts](#t-sns_target_accounts) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_template_variants](#t-sns_template_variants) | table | service だけ | 1 | 0 |  |  |  |  |
| [sns_today_type_schedule](#t-sns_today_type_schedule) | table | service だけ | 3 | 1 |  |  |  |  |
| [sns_topic_categories](#t-sns_topic_categories) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_topic_category_channels](#t-sns_topic_category_channels) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_topic_targets](#t-sns_topic_targets) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_topics](#t-sns_topics) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_x_kind_reserves](#t-sns_x_kind_reserves) | table | service だけ | 1 | 0 | sns_x_slot_room |  |  |  |
| [sns_x_send_control](#t-sns_x_send_control) | table | service だけ | 6 | 1 | approve_sns_x_send, reserve_sns_x_read, roll_sns_x_send_period ほか3 | renew_sns_x_send_period, reserve_sns_x_read, roll_sns_send_baselines ほか2 | sns_auto_plan, sns_send |  |
| [sns_x_send_jobs](#t-sns_x_send_jobs) | table | service だけ | 29 | 0 | approve_sns_x_send, guard_sns_diff_approval, guard_sns_preview_bundle_draft ほか5 | approve_sns_x_send, guard_sns_x_approval, sweep_sns_deadline_queue ほか2 |  |  |
| [sns_youtube_quota_attempts](#t-sns_youtube_quota_attempts) | table | service だけ | 1 | 0 | transition_sns_x_send | transition_sns_x_send |  |  |
| [sns_youtube_quota_control](#t-sns_youtube_quota_control) | table | service だけ | 1 | 0 | transition_sns_x_send | roll_sns_send_baselines |  |  |
| [sns_youtube_quota_reads](#t-sns_youtube_quota_reads) | table | service だけ | 1 | 0 | transition_sns_x_send | transition_sns_x_send |  |  |
| [st_course_baseline](#t-st_course_baseline) | table | anon 可 | 2 | 1 | data_health_nightly_freshness |  |  |  |
| [top_start_stats](#t-top_start_stats) | table | anon 可 | 1 | 2 | data_health_nightly_freshness |  |  |  |
| [user_visible_summary](#t-user_visible_summary) | table | anon 可 | 0 | 0 | view:v_performance_comparison |  |  |  |
| [v_performance_comparison](#t-v_performance_comparison) | view | anon 可 | 0 | 0 |  |  |  |  |
| [v_prediction_performance](#t-v_prediction_performance) | view | anon 可 | 0 | 0 |  |  |  |  |
| [v_production_models](#t-v_production_models) | view | anon 可 | 0 | 0 |  |  |  |  |
| [v_todays_recommendations](#t-v_todays_recommendations) | view | anon 可 | 0 | 0 |  |  |  |  |
| [venue_course_technique_baseline](#t-venue_course_technique_baseline) | table | anon 可 | 5 | 1 | compute_racer_course_technique_stats |  | racer_course_technique_stats |  |
| [venue_entry_course_stats](#t-venue_entry_course_stats) | table | service だけ | 0 | 1 | data_health_table_rows |  | entry_course_stats |  |
| [venue_grade_boat_stats](#t-venue_grade_boat_stats) | table | anon 可 | 3 | 1 | data_health_nightly_freshness |  |  |  |
| [venue_motor_start_dates](#t-venue_motor_start_dates) | table | anon 可 | 3 | 1 |  |  | boatcast_motor_start |  |
| [venue_motor_stats](#t-venue_motor_stats) | table | anon 可 | 4 | 1 | data_health_table_rows |  | venue_motor_stats |  |
| [venue_rules](#t-venue_rules) | table | service だけ | 0 | 0 |  |  |  |  |
| [venue_technique_period_stats](#t-venue_technique_period_stats) | table | anon 可 | 1 | 2 | data_health_nightly_freshness |  |  |  |
| [venues](#t-venues) | table | anon 可 | 6 | 2 | data_health_nightly_freshness | update_venue_stats |  |  |
| [watson_predictions](#t-watson_predictions) | table | anon 可 | 1 | 1 |  |  |  |  |
| [winning_technique_stats](#t-winning_technique_stats) | table | anon 可 | 2 | 2 | data_health_nightly_freshness |  |  |  |

## RPC

| RPC | 権限 | definer | 呼び手 | 呼ぶ RPC | 本体が読む表 | 本体が書く表 | 外の読み手 |
|---|---|---|---|---|---|---|---|
| activate_analogy_model | service だけ |  | 名前の文字列: scripts/ml/analogy/db.py:136 |  | analogy_models | analogy_models |  |
| add_fetch_counts | service だけ |  | scripts/lib/scrapeJobs/fetchCounter.js:140 / 名前の文字列: scripts/lib/scrapeJobs/fetchCounter.js:15, scripts/maintenance/verifyData/fetch-counter-scenes.js:155, scripts/maintenance/verifyData/fetch-counter-scenes.js:168 ほか2 |  |  | fetch_counts, fetch_counts_minute |  |
| analogy_feedback_guard | service だけ | yes | トリガー: analogy_feedback |  | analogy_feedback |  |  |
| append_sns_metric_observation | service だけ |  | api/admin/sns-hub/observations.js:198, scripts/lib/snsDailyRunnerStore.js:28, scripts/lib/snsMetricsRunnerStore.js:94, scripts/maintenance/verify-sns-daily-runner.js:1278 |  | sns_drafts, sns_metric_observations | sns_metric_observations |  |
| approve_sns_x_send | service だけ |  | api/_lib/snsXSendStore.js:115, scripts/lib/snsTodayPlannerStore.js:110, scripts/sns/pushFinalsImageStore.js:183, scripts/sns/pushFullPictureStore.js:101 | sns_bundle_send_allowed | sns_approvers, sns_auto_send_control, sns_auto_send_items, sns_drafts, sns_x_send_control, sns_x_send_jobs | sns_drafts, sns_x_send_jobs |  |
| claim_scrape_slots | service だけ |  | scripts/lib/scrapeJobs/store.js:216, scripts/maintenance/verify-scrape-slots-on-db.js:47 / 名前の文字列: scripts/lib/scrapeJobs/schemaErrors.js:17 |  | races, scrape_slots | scrape_slots |  |
| claim_scrape_slots_by_offset | service だけ |  | scripts/lib/scrapeJobs/store.js:197 |  | races, scrape_slots | scrape_slots |  |
| compute_nige_second_by_course | service だけ |  | scripts/daily/update-course-baseline-stats.js:184 |  | race_results, races |  |  |
| compute_racer_course_technique_stats | service だけ |  | scripts/daily/update-racer-course-technique-stats.js:304 |  | race_entries, race_results, races, venue_course_technique_baseline |  |  |
| compute_st_course_baseline | service だけ |  | scripts/daily/update-course-baseline-stats.js:170 |  | race_entries, race_results, race_start_timings, races |  |  |
| compute_today_course_win_stats | service だけ |  | scripts/daily/generate-morning-digest.js:253 |  | race_entries, race_results, races |  |  |
| compute_venue_course_entry_baseline | service だけ |  | なし |  | race_entries, race_results, races |  |  |
| compute_venue_course_technique_baseline | service だけ |  | scripts/daily/update-racer-course-technique-stats.js:222 |  | race_entries, race_results, races |  |  |
| data_health_cancellation_with_result | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:343, scripts/lib/dataHealth/functions.js:517 |  | race_results, races |  |  |
| data_health_coverage | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:66, scripts/lib/dataHealth/functions.js:452, scripts/maintenance/verifyData/data-health-job-fixtures.js:76 ほか5 |  | exhibition_data, race_conditions, race_odds, race_results, race_start_timings, races |  |  |
| data_health_entries_duplicates | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:323, scripts/lib/dataHealth/functions.js:508 |  | race_entries, race_results, races |  |  |
| data_health_monthly_result | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:370, scripts/lib/dataHealth/functions.js:497, scripts/maintenance/verifyData/data-health-job-for-job.js:42 ほか1 |  | race_results, races |  |  |
| data_health_morning_freshness | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:199, scripts/lib/dataHealth/checks.js:208, scripts/lib/dataHealth/checks.js:218 ほか4 |  | analogy_v16_snapshots, bet_recommendations, poirot_predictions, races |  |  |
| data_health_nightly_freshness | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:105, scripts/lib/dataHealth/functions.js:526, scripts/maintenance/verifyData/data-health-job-scenes-2.js:39 ほか2 |  | accuracy_cache, bet_recommendations, exhibition_time_top_stats, losing_technique_stats, model_performance_daily, nige_outcome_distribution, nige_second_by_course, outcome_distribution, race_conditions, race_history_cache, race_results, racer_aggregated_stats, racer_grade_cache, racer_series_points, races, st_course_baseline, top_start_stats, venue_grade_boat_stats, venue_technique_period_stats, venues, winning_technique_stats |  |  |
| data_health_pit_reports | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:268, scripts/lib/dataHealth/functions.js:470, scripts/maintenance/verifyData/data-health-job-scenes-1.js:231 ほか2 |  | race_pit_reports, races |  |  |
| data_health_pre_race_fields | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:242, scripts/lib/dataHealth/checks.js:255, scripts/lib/dataHealth/functions.js:461 ほか1 |  | race_conditions, race_entries, races |  |  |
| data_health_race_series | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:293, scripts/lib/dataHealth/functions.js:479, scripts/maintenance/verifyData/data-health-job-scenes-1.js:250 ほか3 |  | race_series, races |  |  |
| data_health_racer_period_stats | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:304, scripts/lib/dataHealth/functions.js:488, scripts/maintenance/verifyData/data-health-job-scenes-1.js:267 |  | race_entries, racer_period_stats, races |  |  |
| data_health_table_rows | service だけ |  | 名前の文字列: scripts/lib/dataHealth/functions.js:546, scripts/lib/dataHealth/jobParts.js:10, scripts/maintenance/verifyData/data-health-job-fixtures.js:77 ほか2 |  | exhibition_data, external_predictions, race_conditions, race_entries, race_odds, race_payouts, race_pit_reports, race_results, race_series, race_special_notes, race_start_timings, racer_period_stats, racer_profiles, racer_series_points, races, venue_entry_course_stats, venue_motor_stats |  |  |
| enqueue_sns_metric_jobs | service だけ |  | トリガー: sns_x_send_jobs |  | sns_drafts | sns_metric_jobs |  |
| ensure_scrape_slots | service だけ |  | scripts/lib/scrapeJobs/store.js:175, scripts/maintenance/verify-scrape-slots-on-db.js:58 / 名前の文字列: scripts/lib/scrapeJobs/schemaErrors.js:16, scripts/maintenance/verifyData/morning-init-jobs-scenes-3.js:133 |  | races | scrape_slots |  |
| fetch_counts_daily | service だけ |  | なし |  | fetch_counts |  |  |
| get_accuracy_summary | service だけ |  | なし |  | models, predictions |  |  |
| get_admin_rule_performance | service だけ |  | api/admin/rules/performance.js:41, scripts/maintenance/verify-admin-rule-performance.js:211 |  | predictions, race_results |  |  |
| get_in_caution_band_rates | service だけ |  | scripts/daily/generate-unified-predictions.js:196, scripts/lib/inCautionHealth.js:107 / 名前の文字列: scripts/maintenance/verifyData/morning-init-jobs-scenes-3.js:154 |  | in_caution_gap_band_daily |  |  |
| get_latest_racer_grades | service だけ |  | scripts/daily/update-racer-grade-cache.js:17 |  | race_entries |  |  |
| get_predictions_by_date | anon 可 |  | api/predictions/[date].js:61, src/services/predictionQueries2.js:216 / 名前の文字列: api/predictions/[date].js:57, scripts/maintenance/check-anon-access.js:103 |  | exhibition_data, prediction_odds, predictions, race_conditions, race_entries, race_payouts, race_results, races |  |  |
| get_predictions_by_date_light | anon 可 |  | api/predictions/[date].js:61, scripts/maintenance/verify-predictions-response.js:156, src/services/predictionQueries2.js:216 / 名前の文字列: api/predictions/[date].js:57, scripts/maintenance/check-anon-access.js:104, scripts/maintenance/check-anon-access.js:180 |  | exhibition_data, prediction_odds, predictions, race_conditions, race_entries, race_payouts, race_results, races |  |  |
| get_race_exhibition_trend | anon 可 |  | scripts/lib/raceIndicatorData.js:47, src/services/raceQueries2.js:126 / 名前の文字列: scripts/analysis/verify-race-analysis-rpc.js:333, scripts/maintenance/check-anon-access.js:105 |  | exhibition_data, race_entries |  |  |
| get_race_history_summary | service だけ |  | なし |  | predictions, races |  |  |
| get_race_return_rate | anon 可 |  | scripts/lib/raceIndicatorData.js:37, src/services/raceQueries3.js:221 / 名前の文字列: scripts/analysis/verify-race-analysis-rpc.js:358, scripts/maintenance/check-anon-access.js:106 |  | race_entries, race_results |  |  |
| get_race_st_predictability | anon 可 |  | scripts/lib/raceIndicatorData.js:32, src/services/raceQueries.js:348 / 名前の文字列: scripts/analysis/verify-race-analysis-rpc.js:324, scripts/maintenance/check-anon-access.js:107 |  | exhibition_data, race_entries, race_start_timings |  |  |
| get_race_technique_profile | anon 可 |  | scripts/lib/raceIndicatorData.js:42, src/services/raceQueries3.js:301 / 名前の文字列: scripts/analysis/verify-race-analysis-rpc.js:342, scripts/maintenance/check-anon-access.js:108 |  | race_entries, race_results |  |  |
| get_racer_accident_records | anon 可 |  | src/services/racerQueries4.js:130 / 名前の文字列: scripts/maintenance/check-anon-access.js:112, sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs:683 |  | race_conditions, race_entries, race_start_timings |  |  |
| get_today_races | anon 可 |  | api/races/today.js:30, scripts/maintenance/verify-display-coverage.js:175, src/services/scheduleQueries.js:55 / 名前の文字列: scripts/maintenance/check-anon-access.js:116, scripts/maintenance/check-anon-access.js:179 |  | predictions, race_conditions, race_entries, race_results, races |  |  |
| guard_sns_diff_approval | service だけ |  | トリガー: sns_drafts | sns_diff_content | sns_x_send_jobs |  |  |
| guard_sns_preview_bundle_draft | service だけ |  | トリガー: sns_drafts | sns_bundle_send_allowed | sns_bundle_imports, sns_drafts, sns_x_send_jobs |  |  |
| guard_sns_x_approval | service だけ |  | トリガー: sns_drafts |  | sns_x_send_jobs | sns_x_send_jobs |  |
| import_sns_preview_bundle | service だけ |  | api/_lib/snsBundleImport.js:60 |  | sns_bundle_imports, sns_drafts | sns_bundle_imports, sns_drafts |  |
| read_sns_draft_diff | service だけ |  | api/_lib/snsXSendStore.js:43 / RPC から: save_sns_draft_diff | sns_diff_content, sns_mobile_revision | sns_drafts |  |  |
| renew_sns_x_send_period | service だけ |  | なし |  |  | sns_x_send_control |  |
| reserve_sns_x_read | service だけ |  | scripts/lib/snsMetricsRunnerStore.js:121 |  | sns_x_send_control | sns_x_send_control |  |
| roll_sns_send_baselines | service だけ |  | 名前の文字列: scripts/lib/snsAutoPlanRunner.js:72 |  |  | sns_x_send_control, sns_youtube_quota_control |  |
| roll_sns_x_send_period | service だけ |  | 名前の文字列: scripts/lib/snsAutoPlanRunner.js:72 |  | sns_x_send_control | sns_x_send_control |  |
| save_sns_draft_diff | service だけ |  | api/_lib/snsXSendStore.js:49 | read_sns_draft_diff, sns_diff_content, sns_mobile_revision | sns_drafts | sns_drafts |  |
| scrape_breaker_open | service だけ |  | scripts/lib/scrapeJobs/store.js:335 / 名前の文字列: scripts/lib/scrapeJobs/store.js:356 |  |  | scrape_job_state |  |
| sns_bundle_send_allowed | service だけ |  | RPC から: approve_sns_x_send, guard_sns_preview_bundle_draft, transition_sns_send_139, transition_sns_x_send |  | sns_auto_send_items, sns_bundle_imports |  |  |
| sns_claim_external | service だけ | yes | 名前の文字列: api/_lib/snsExternalOperations.js:15, api/_lib/snsExternalOperations.js:24, scripts/maintenance/verifyData/sns-existing-fixes-fixture.js:95 ほか1 |  | sns_drafts | sns_drafts |  |
| sns_diff_content | service だけ |  | RPC から: guard_sns_diff_approval, read_sns_draft_diff, save_sns_draft_diff |  |  |  |  |
| sns_finish_external | service だけ | yes | 名前の文字列: api/_lib/snsExternalOperations.js:35 |  | sns_drafts | sns_drafts |  |
| sns_guard_external | service だけ |  | トリガー: sns_drafts |  |  |  |  |
| sns_mobile_revision | service だけ |  | RPC から: read_sns_draft_diff, save_sns_draft_diff |  |  |  |  |
| sns_record_external | service だけ | yes | 名前の文字列: api/_lib/snsExternalOperations.js:31 |  |  | sns_drafts |  |
| sns_update_external_warning | service だけ | yes | 名前の文字列: api/admin/sns-hub/drafts/[id]/publish-youtube.js:219 |  |  | sns_drafts |  |
| sns_x_slot_room | service だけ |  | scripts/lib/snsXSlots.js:69 / RPC から: transition_sns_send_139 |  | sns_auto_send_items, sns_drafts, sns_x_kind_reserves, sns_x_send_control, sns_x_send_jobs |  |  |
| stop_sns_auto_item | service だけ |  | なし |  | sns_auto_send_items, sns_drafts, sns_x_send_jobs | sns_auto_send_items, sns_drafts |  |
| sweep_sns_deadline_queue | service だけ |  | api/_lib/snsXSendStore.js:66 |  |  | sns_x_send_jobs |  |
| transition_sns_send_139 | service だけ |  | RPC から: transition_sns_x_send | sns_bundle_send_allowed, sns_x_slot_room | sns_auto_send_control, sns_auto_send_items, sns_drafts, sns_x_send_control, sns_x_send_jobs | sns_drafts, sns_x_send_control, sns_x_send_jobs |  |
| transition_sns_x_send | service だけ | yes | api/_lib/snsXSendStore.js:126, scripts/sns/pushFullPictureStore.js:136 | sns_bundle_send_allowed, transition_sns_send_139 | sns_auto_send_control, sns_auto_send_items, sns_drafts, sns_x_send_control, sns_x_send_jobs, sns_youtube_quota_attempts, sns_youtube_quota_control, sns_youtube_quota_reads | sns_auto_send_items, sns_drafts, sns_x_send_jobs, sns_youtube_quota_attempts, sns_youtube_quota_reads |  |
| trg_external_predictions_updated_at | service だけ |  | トリガー: external_predictions |  |  |  |  |
| update_prediction_results | service だけ |  | トリガー: race_results |  | predictions | bet_recommendations, predictions |  |
| update_updated_at_column | service だけ |  | トリガー: rule_applications, venue_rules |  |  |  |  |
| update_venue_stats | service だけ |  | なし |  | race_results, races | venues |  |

## 取得のジョブ（scrape の registry）

入口の `api/cron` のファイルから相対 import でたどれるファイルの書き込み。共有の部品を通るので、別のジョブの書き込みも入る（多めに出る）。

| ジョブ | 入口 | たどったファイル | 書く表 |
|---|---|---|---|
| analogy_dispatch_morning | api/cron/analogy-dispatch-morning.js | 16 | scrape_job_state, scrape_slots |
| analogy_dispatch_train | api/cron/analogy-dispatch-train.js | 16 | scrape_job_state, scrape_slots |
| analogy_v16_exhibition | api/cron/analogy-exhibition.js | 21 | analogy_v16_snapshots, scrape_job_state, scrape_slots |
| boatcast_motor_start | api/cron/boatcast-motor-start.js | 23 | scrape_job_state, scrape_slots, venue_motor_start_dates |
| boatcast_oriten | api/cron/boatcast-oriten.js | 25 | race_original_exhibition, race_original_exhibition_values, scrape_job_state, scrape_slots |
| daily_reconcile | api/cron/daily-reconcile.js | 21 | scrape_job_state, scrape_slots |
| data_health | api/cron/data-health.js | 23 | scrape_job_state, scrape_slots |
| data_health_morning | api/cron/data-health-morning.js | 23 | scrape_job_state, scrape_slots |
| db_apply_dispatch | api/cron/db-apply-dispatch.js | 17 | scrape_job_state, scrape_slots |
| e2e_rerecord_dispatch | api/cron/e2e-rerecord-dispatch.js | 16 | scrape_job_state, scrape_slots |
| entry_course_stats | api/cron/entry-course-stats.js | 28 | scrape_job_state, scrape_slots, venue_entry_course_stats |
| eve_deadlines | api/cron/eve-deadlines.js | 23 | eve_race_deadlines, scrape_job_state, scrape_slots |
| eve_deadlines_reconcile | api/cron/eve-deadlines-reconcile.js | 23 | eve_race_deadlines, scrape_job_state, scrape_slots |
| exhibition | api/cron/exhibition.js | 48 | exhibition_data, predictions, race_conditions, race_entries, races, scrape_job_state, scrape_slots |
| fan_period | api/cron/fan-period.js | 23 | raw_snapshots, scrape_job_state, scrape_slots |
| in_caution_dispatch | api/cron/in-caution-dispatch.js | 16 | scrape_job_state, scrape_slots |
| in_caution_health | api/cron/in-caution-health.js | 24 | scrape_job_state, scrape_slots |
| in_caution_today_health | api/cron/in-caution-today-health.js | 24 | scrape_job_state, scrape_slots |
| key_canary_dispatch | api/cron/key-canary-dispatch.js | 16 | scrape_job_state, scrape_slots |
| kfile_sync | api/cron/kfile-sync.js | 39 | predictions, race_conditions, race_payouts, race_results, race_start_timings, races, scrape_job_state, scrape_slots |
| morning_digest | api/cron/morning-digest.js | 22 | morning_digest_days, morning_digest_rows, scrape_job_state, scrape_slots |
| motor_pretest | api/cron/motor-pretest.js | 26 | scrape_job_state, scrape_slots |
| odds | api/cron/odds.js | 29 | prediction_odds, race_odds, scrape_job_state, scrape_slots |
| odds_final | api/cron/odds-final.js | 26 | race_odds, race_odds_final, scrape_job_state, scrape_slots |
| outcome_distribution_update | api/cron/outcome-distribution-update.js | 21 | nige_outcome_distribution, outcome_distribution, scrape_job_state, scrape_slots |
| pcexpect | api/cron/pcexpect.js | 20 | external_predictions, scrape_job_state, scrape_slots |
| pit_reports | api/cron/pit-reports.js | 22 | race_pit_comments, race_pit_reports, scrape_job_state, scrape_slots |
| point_rank | api/cron/point-rank.js | 26 | racer_series_points, scrape_job_state, scrape_slots |
| pseudo | api/cron/scrape-pseudo.js | 15 | scrape_job_state, scrape_slots |
| race_info | api/cron/race-info.js | 48 | exhibition_data, predictions, race_conditions, race_entries, races, scrape_job_state, scrape_slots |
| race_notices | api/cron/race-notices.js | 24 | race_notices_health, race_special_notes, scrape_job_state, scrape_slots |
| race_series | api/cron/race-series.js | 21 | scrape_job_state, scrape_slots |
| race_status | api/cron/race-status.js | 39 | predictions, race_conditions, race_payouts, race_results, race_start_timings, races, scrape_job_state, scrape_slots |
| racer_career_main | api/cron/racer-career-main.js | 23 | racer_career_meta, scrape_job_state, scrape_slots |
| racer_course_technique_stats | api/cron/racer-course-technique-stats.js | 19 | racer_course_technique_stats, scrape_job_state, scrape_slots, venue_course_technique_baseline |
| racer_news | api/cron/racer-news.js | 21 | racer_news, racer_news_pending, scrape_job_state, scrape_slots |
| racer_profiles | api/cron/racer-profiles.js | 20 | racer_profiles, scrape_job_state, scrape_slots |
| races_init | api/cron/races-init.js | 49 | exhibition_data, predictions, race_conditions, race_entries, races, scrape_job_state, scrape_slots |
| release_dispatch | api/cron/release-dispatch.js | 19 | scrape_job_state, scrape_slots |
| result | api/cron/result.js | 39 | predictions, race_conditions, race_payouts, race_results, race_start_timings, races, scrape_job_state, scrape_slots |
| result_catchup | api/cron/result-catchup.js | 39 | predictions, race_conditions, race_payouts, race_results, race_start_timings, races, scrape_job_state, scrape_slots |
| scrape-cleanup | api/cron/scrape-cleanup.js | 17 | scrape_job_state, scrape_slots |
| scrape-monitor | api/cron/scrape-monitor.js | 18 | scrape_job_state, scrape_slots |
| sns_auto_plan | api/cron/sns-auto-plan.js | 117 | scrape_job_state, scrape_slots, sns_auto_send_items, sns_drafts, sns_post_tracking, sns_send_events, sns_strategy_insights, sns_x_send_control |
| sns_daily | api/cron/sns-daily.js | 23 | scrape_job_state, scrape_slots, sns_channel_daily, sns_drafts, sns_strategy_insights |
| sns_metrics | api/cron/sns-metrics.js | 30 | scrape_job_state, scrape_slots, sns_drafts, sns_metric_jobs, sns_oauth_tokens, sns_strategy_insights |
| sns_send | api/cron/sns-send.js | 88 | scrape_job_state, scrape_slots, sns_drafts, sns_oauth_tokens, sns_send_events, sns_strategy_insights, sns_x_send_control |
| venue_motor_stats | api/cron/venue-motor-stats.js | 25 | scrape_job_state, scrape_slots, venue_motor_stats |

## 表ごとの読み手・書き手

### <a id="t-accuracy_cache"></a>accuracy_cache

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/ml/analogy/in_caution_bands.py:211`, `scripts/ml/analogy/in_caution_bands.py:230`, `scripts/ml/analogy/tests/test_in_caution_bands.py:342`
- 読み手（5）: 
  - `api/accuracy/index.js:31` select(rest) [data, key]
  - `src/services/predictionQueries3.js:441` select [data, key]
  - `src/services/predictionQueries3.js:467` select [data, key]
  - `src/services/predictionQueries4.js:22` select [data, key]
  - `src/services/predictionQueries4.js:44` select [data, key]
- 書き手（3）: 
  - `scripts/daily/calculate-accuracy.js:177` upsert [data, key, updated_at]
  - `scripts/daily/calculate-unified-model-accuracy.js:203` upsert [data, key, updated_at]
  - `scripts/daily/calculate-unified-volatility-accuracy.js:142` upsert [data, key, updated_at]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-analogy_contribution_profiles"></a>analogy_contribution_profiles

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/ml/analogy/db.py:96`, `scripts/ml/analogy/db.py:119`, `scripts/ml/analogy/db.py:153`, `scripts/ml/analogy/db.py:172`, `scripts/ml/analogy/tests/test_db.py:69`
- 読み手（2）: 
  - `api/analogy/contribution.js:102` rest(rest) [boat_number, breakdown, frame_ratio, grade, n_boats, n_races, period_from, period_to, round, share_sd, shares, venue_code]
  - `src/services/analogyService.js:66` select [boat_number, breakdown, finish_target, frame_ratio, grade, model_version, n_boats, n_races, period_from, period_to, round, share_sd, shares, stage, venue_code]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-analogy_feedback"></a>analogy_feedback

- 権限: service だけ（anon: INSERT / authenticated: INSERT、RLS 有効）
- 本体で読む RPC: analogy_feedback_guard
- 読み手（0）: なし
- 書き手（1）: 
  - `src/services/analogyFeedback.js:18` insert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, kind, race_id, verdict, reasons, comment, analogy_stage, analogy_tab, lang

### <a id="t-analogy_models"></a>analogy_models

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: activate_analogy_model
- 本体で書く RPC: activate_analogy_model
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/ml/analogy/db.py:108`, `scripts/ml/analogy/db.py:112`, `scripts/ml/analogy/db.py:115`, `scripts/ml/analogy/db.py:134`, `scripts/ml/analogy/db.py:137`, `scripts/ml/analogy/db.py:146`, `scripts/ml/analogy/db.py:168`
- 読み手（4）: 
  - `api/analogy/contribution.js:95` rest(rest) [is_active, metrics, model_version, themes, trained_at]
  - `scripts/analysis/analogy-v16-rebuild/inspect.mjs:9` select [created_at, is_active, model_version]
  - `scripts/ml/analogy/storage.js:112` select [is_active, model_version]
  - `src/services/analogyService.js:51` select [is_active, metrics, model_version, themes, trained_at]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-analogy_v16_snapshots"></a>analogy_v16_snapshots

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_morning_freshness
- 取得のジョブ: analogy_v16_exhibition
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/ml/analogy/v16_morning.py:259`, `scripts/ml/analogy/v16_morning.py:295`
- 読み手（12）: 
  - `api/_lib/analogyV16.js:99` rest(rest) [computed_at, exact, model_version, n_layer, pool_cutoff, race_id, run_id, stage, status]
  - `scripts/analysis/analogy-v16-rebuild/inspect.mjs:4` select [computed_at, model_version, n_layer, pool_cutoff, race_id, run_id, stage, status]
  - `scripts/analysis/analogy-v16-rebuild/snaps.mjs:4` select [computed_at, n_layer, race_id, racecard_hash, run_id, stage, status]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:87` select [race_id, stage, status]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:144` select [computed_at, race_id, run_id, stage]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:216` select [computed_at, race_id, run_id, stage]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:485` select [n_layer, race_id, stage, status]
  - `scripts/lib/analogyDispatch.js:80` select [race_id, stage]
  - `scripts/lib/analogyV16Exhibition.js:251` rest(rest) [model_version, n_layer, pool_cutoff, race_id, run_id, stage, status]
  - `scripts/maintenance/verify-analogy-v16.js:269` rest(rest) [stage] （検査）
  - `scripts/maintenance/verify-analogy-v16.js:279` rest(rest) [computed_at, exact, race_id, stage, status] （検査）
  - `scripts/maintenance/verify-analogy-v16.js:281` rest(rest) [race_id, stage] （検査）
- 書き手（1）: 
  - `scripts/lib/analogyV16Exhibition.js:307` upsert(rest) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-bet_filters"></a>bet_filters

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: filter_id, name, model_id, conditions, total_races, hit_count, total_payout, recovery_rate, valid_from, valid_to, is_active, created_at, updated_at

### <a id="t-bet_recommendations"></a>bet_recommendations

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_morning_freshness, data_health_nightly_freshness
- 本体で書く RPC: update_prediction_results
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/delete-phantom-races.js:84`, `scripts/maintenance/fix-opening-day-race-id-date.js:74`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:47`
- 読み手（5）: 
  - `scripts/daily/update-moriarty-outcomes.js:31` select [actual_hit, bet_fraction, created_at, expected_value, model_id, race_id, reasons, recommendation]
  - `src/services/moriartyService.js:68` select [model_id, race_id, recommendation]
  - `src/services/moriartyService.js:141` select [actual_hit, actual_payout, bet_fraction, expected_value, model_id, race_id, reasons, recommendation]
  - `src/services/moriartyService.js:268` select [actual_hit, expected_value, model_id, recommendation]
  - `src/services/predictionQueries4.js:62` select [expected_hit_rate, expected_payout, expected_value, model_id, race_id, reasons, recommendation]
- 書き手（4）: 
  - `scripts/daily/generate-moriarty-recommendations.js:361` upsert [?]
  - `scripts/daily/generate-unified-trifecta-reference.js:176` delete
  - `scripts/daily/generate-unified-trifecta-reference.js:188` insert [?]
  - `scripts/daily/update-moriarty-outcomes.js:144` update [actual_hit, actual_payout]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-daily_bet_summary"></a>daily_bet_summary

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: date, model_id, all_races, all_hits, all_payout, all_recovery_rate, recommended_races, recommended_hits, recommended_payout, recommended_recovery_rate, skipped_races, skipped_hits, skipped_payout, skipped_recovery_rate, recovery_improvement, profit_if_all, profit_if_recommended

### <a id="t-exhibition_data"></a>exhibition_data

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_coverage, data_health_table_rows, get_predictions_by_date, get_predictions_by_date_light, get_race_exhibition_trend, get_race_st_predictability
- 取得のジョブ: exhibition, race_info, races_init
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:8`, `scripts/maintenance/backfill-kb-gaps.js:82`, `scripts/maintenance/delete-phantom-races.js:86`, `scripts/maintenance/fix-opening-day-race-id-date.js:72`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:45`, `scripts/ml/analogy/v16_morning.py:292`
- 読み手（48）: 
  - `api/_lib/analogyV16.js:103` rest(rest) [boat_number, exhibition_time, is_absent, race_id]
  - `api/_lib/racerEntryExhibition.js:192` rest(rest) [boat_number, exhibition_time, is_absent, race_id]
  - `api/_lib/snsClaimCheckReaders.js:46` rest(rest) [is_absent, race_id]
  - `api/_lib/snsClaimCheckReaders.js:236` rest(rest) [is_absent, race_id]
  - `api/_lib/snsTodayDigest.js:54` rest(rest) [boat_number, is_absent, race_id]
  - `scripts/analysis/original-exhibition/fetch.mjs:59` select(helper:all)
  - `scripts/analysis/train-conditional-logit.js:88` select(helper:fetchAll)
  - `scripts/analysis/verify-race-analysis-rpc.js:35` select [boat_number, race_id, start_timing]
  - `scripts/analysis/verify-race-analysis-rpc.js:78` select(helper:fetchAll)
  - `scripts/analysis/verify-race-analysis-rpc.js:127` select [boat_number, exhibition_time, race_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:151` select [boat_number, exhibition_time, race_id]
  - `scripts/daily/generate-predictions.js:1070` select(helper:upsertChangedRows)
  - `scripts/daily/generate-predictions.js:1301` select(helper:selectByRaceIds)
  - `scripts/daily/scrape-exhibition-data.js:74` select(helper:fetchAll)
  - `scripts/daily/scrape-exhibition-data.js:454` select [exhibition_time, race_id, start_timing]
  - `scripts/daily/update-exhibition-time-top-stats.js:173` select(helper:fetchAll)
  - `scripts/lib/analogyV16Exhibition.js:156` rest(rest) [boat_number, exhibition_course, exhibition_time, is_absent, race_id, start_flag, start_timing]
  - `scripts/lib/analogyV16Exhibition.js:258` rest(rest) [boat_number, exhibition_time, is_absent, race_id]
  - `scripts/lib/exhibitionJobParts.js:70` select(helper:upsertChangedRows)
  - `scripts/lib/snsTodayDigestV3.js:93` rest(rest) [boat_number, is_absent, race_id]
  - `scripts/maintenance/backfill-exhibition-by-race-id.js:48` select [race_id]
  - `scripts/maintenance/backfill-opening-day-races.js:97` select(helper:count)
  - `scripts/maintenance/check-exhibition-gap-rate.js:46` select(helper:fetchAll)
  - `scripts/maintenance/check-pre-race-shadow.js:301` select(helper:fetchByRaceIds)
  - `scripts/maintenance/verify-analogy-v16.js:286` rest(rest) [boat_number, exhibition_time, is_absent, race_id] （検査）
  - `scripts/maintenance/verifyData/scraped-timestamps-scenes-1.js:32` select(helper:upsertChangedRows)
  - `scripts/ml/export-inference-data.js:115` select(helper:fetchByRaceIds)
  - `scripts/ml/export-training-data.js:196` select(helper:fetchAll)
  - `scripts/sns/pushSetsuKiryokuShortStore.js:120` rest(rest) [is_absent, race_id]
  - `src/services/meetQueries.js:269` select(helper:fetchAllByIn)
  - `src/services/meetQueries2.js:166` select [boat_number, exhibition_time, race_id]
  - `src/services/motorQueries.js:385` select(helper:fetchAllByIn)
  - `src/services/motorQueries5.js:65` select(helper:fetchAllByIn)
  - `src/services/motorQueries6.js:120` select [adjustment_weight, boat_number, exhibition_course, exhibition_time, is_absent, parts_changed, prev_entry_course, prev_finish_mark, prev_finish_rank, prev_race_no, prev_start_timing, propeller_change, race_id, tilt, today_weight, updated_at]
  - `src/services/motorQueries6.js:136` select [adjustment_weight, boat_number, exhibition_time, parts_changed, propeller_change, race_id, tilt]
  - `src/services/motorQueries7.js:78` select [boat_number, exhibition_time, parts_changed, propeller_change, race_id]
  - `src/services/raceQueries.js:35` select [boat_number, race_id, start_flag]
  - `src/services/raceQueries.js:239` select(helper:fetchAllByIn)
  - `src/services/raceQueries.js:288` select [boat_number, race_id, start_timing]
  - `src/services/raceQueries2.js:66` select [boat_number, exhibition_time, race_id]
  - `src/services/raceQueries2.js:90` select(helper:fetchAllByIn)
  - `src/services/raceQueries2.js:188` select [boat_number, exhibition_time, is_absent, race_id, start_flag, start_timing, tilt]
  - `src/services/raceQueries3.js:90` select [boat_number, exhibition_time, race_id, start_flag, start_timing]
  - `src/services/racerQueries2.js:202` select(helper:fetchAllByIn)
  - `src/services/racerQueries2.js:330` select(helper:fetchAllByIn)
  - `src/services/racerQueries3.js:119` select(helper:fetchAllByIn)
  - `src/services/racerQueries3.js:194` select(helper:fetchAllByIn)
  - `src/services/sherlockService.js:76` select [boat_number, exhibition_time, race_id, start_timing]
- 書き手（4）: 
  - `scripts/daily/generate-predictions.js:1070` upsert(helper:upsertChangedRows) [?]
  - `scripts/lib/exhibitionJobParts.js:70` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verify-pre-race-parsers.js:1868` upsert [?] （検査）
  - `scripts/maintenance/verifyData/scraped-timestamps-scenes-1.js:32` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-exhibition_time_top_stats"></a>exhibition_time_top_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（1）: 
  - `src/services/venueQueries3.js:144` select [*, boat_number, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-exhibition-time-top-stats.js:137` delete
  - `scripts/daily/update-exhibition-time-top-stats.js:146` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-external_predictions"></a>external_predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: pcexpect
- 読み手（1）: 
  - `scripts/maintenance/check-morning-init-shadow.js:254` select [payload, race_date, race_no, scraped_at, source, venue_code]
- 書き手（1）: 
  - `scripts/daily/scrape-pcexpect.js:176` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, race_start_at, created_at, updated_at

### <a id="t-fetch_counts"></a>fetch_counts

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: fetch_counts_daily
- 本体で書く RPC: add_fetch_counts
- 読み手（0）: なし
- 書き手（0）: なし

### <a id="t-fetch_counts_minute"></a>fetch_counts_minute

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で書く RPC: add_fetch_counts
- 読み手（0）: なし
- 書き手（0）: なし

### <a id="t-in_caution_gap_band_daily"></a>in_caution_gap_band_daily

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: get_in_caution_band_rates
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/ml/analogy/in_caution_bands.py:45`, `scripts/ml/analogy/tests/test_in_caution_bands.py:154`, `scripts/ml/analogy/tests/test_in_caution_bands.py:159`
- 読み手（0）: なし
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-kb_archive_boats"></a>kb_archive_boats

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:72`
- 読み手（2）: 
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:298` select [boat_number, course, finish_raw, is_flying, is_late_start, race_id, start_timing]
  - `scripts/analysis/venue-summary-stats/count-venue-techniques.mjs:66` select(helper:fetchAll)
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-kb_archive_races"></a>kb_archive_races

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:70`
- 読み手（5）: 
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:290` select [has_result, payout_3fuku, payout_3tan, race_id]
  - `scripts/analysis/venue-summary-stats/count-venue-techniques.mjs:64` select(helper:fetchAll)
  - `scripts/daily/update-winning-technique-stats.js:212` select(helper:fetchAll)
  - `scripts/lib/racerCareerDb.js:138` select(helper:count)
  - `scripts/maintenance/verify-full-picture-scene2.js:3641` rest(rest) （検査）
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-kb_archive_venue_days"></a>kb_archive_venue_days

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:71`
- 読み手（2）: 
  - `scripts/lib/racerCareerDb.js:128` select [race_date]
  - `scripts/lib/racerCareerDb.js:137` select(helper:count)
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-losing_technique_stats"></a>losing_technique_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/maintenance/verify-full-picture-scene2.js:3533` rest(rest) （検査）
  - `src/services/venueQueries2.js:284` select [*, boat_number, percentage, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-losing-technique-stats.js:152` delete
  - `scripts/daily/update-losing-technique-stats.js:162` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-model_bet_candidates"></a>model_bet_candidates

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/fix-opening-day-race-id-date.js:75`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:48`
- 読み手（0）: なし
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-model_experiments"></a>model_experiments

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: experiment_id, name, description, control_model_id, treatment_model_id, start_date, end_date, control_predictions, control_hit_rate, control_recovery_rate, treatment_predictions, treatment_hit_rate, treatment_recovery_rate, p_value, is_significant, conclusion, notes, status, created_at

### <a id="t-model_performance_daily"></a>model_performance_daily

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（3）: 
  - `src/services/moriartyService.js:40` select [date, investment, model_id, payout_win, recovery_rate_win, total_predictions, win_hits]
  - `src/services/moriartyService.js:181` select [date, investment, model_id, payout_win, recovery_rate_win, total_predictions, win_hits]
  - `src/services/moriartyService.js:223` select [by_venue, date, model_id]
- 書き手（1）: 
  - `scripts/daily/update-moriarty-outcomes.js:264` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: place_hits, trifecta_hits, payout_trifecta, recovery_rate_trifecta, by_volatility

### <a id="t-models"></a>models

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_production_models
- 本体で読む RPC: get_accuracy_summary
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-perrace/finish_targets.py:335`, `scripts/analysis/analogy-finder-perrace/race_level.py:396`, `scripts/analysis/analogy-finder-perrace/race_level.py:397`, `scripts/analysis/analogy-finder-perrace/race_level.py:398`, `scripts/analysis/analogy-finder-perrace/venue_magnitude.py:26`, `scripts/analysis/boa845-axis-place/effect.py:98`, `scripts/ml/analogy/make_treeshap_testdata.py:209`, `scripts/ml/analogy/make_treeshap_testdata.py:214`, `scripts/ml/analogy/perrace.py:53`, `scripts/ml/analogy/tests/test_perrace.py:75`, `scripts/ml/analogy/tests/test_perrace.py:76`, `scripts/ml/analogy/tests/test_perrace.py:77`, `scripts/ml/analogy/tests/test_perrace.py:85`, `scripts/ml/predict.py:26`, `scripts/ml/predict_mycroft.py:30`, `scripts/ml/predict_watson.py:26`, `scripts/ml/train_mycroft.py:37`, `scripts/ml/train_rf.py:28`, `scripts/ml/train_v2.py:29`, `scripts/ml/train_watson.py:42`, `scripts/ml/watson_scores.py:23`
- 読み手（2）: 
  - `scripts/daily/calculate-accuracy.js:140` select [hit_rate_place, hit_rate_trifecta, hit_rate_trio, hit_rate_win, model_id, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio, recovery_rate_win, total_predictions]
  - `src/services/predictionQueries3.js:114` select [display_name, hit_rate_place, hit_rate_trifecta, hit_rate_trio, hit_rate_win, model_id, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio, recovery_rate_win, total_predictions]
- 書き手（1）: 
  - `scripts/daily/calculate-accuracy.js:231` update [hit_rate_place, hit_rate_trifecta, hit_rate_trio, hit_rate_win, last_evaluated_at, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio, recovery_rate_win, total_predictions, updated_at]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-morning_digest_days"></a>morning_digest_days

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: morning_digest
- 読み手（2）: 
  - `scripts/maintenance/verify-morning-digest.js:40` select [digest_date, generated_at, notes, race_count, venue_count] （検査）
  - `src/services/scheduleQueries.js:278` select [*, digest_date]
- 書き手（2）: 
  - `scripts/daily/generate-morning-digest.js:510` upsert [?]
  - `scripts/daily/generate-morning-digest.js:539` update [generated_at]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-morning_digest_rows"></a>morning_digest_rows

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: morning_digest
- 読み手（2）: 
  - `scripts/maintenance/verify-morning-digest.js:58` select [*, digest_date] （検査）
  - `src/services/scheduleQueries.js:283` select [*, digest_date, rank, section]
- 書き手（3）: 
  - `scripts/daily/generate-morning-digest.js:515` delete
  - `scripts/daily/generate-morning-digest.js:524` insert [?]
  - `scripts/daily/generate-morning-digest.js:532` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-motor_pretest_stats"></a>motor_pretest_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 読み手（7）: 
  - `scripts/lib/motorPretestJob.js:217` select [race_date, venue_code]
  - `scripts/lib/motorPretestJob.js:233` select [race_date, racer_id, venue_code]
  - `scripts/maintenance/verify-pretest-row-pick.js:74` select [pretest_rank, pretest_time, race_date, racer_id, series_title, venue_code] （検査）
  - `src/services/meetQueries2.js:144` select [motor_number, pretest_rank, pretest_time, race_date, racer_class, racer_id, venue_code]
  - `src/services/motorQueries2.js:41` select [pretest_rank, pretest_time, race_date, racer_id, venue_code]
  - `src/services/motorQueries4.js:139` select [race_date, venue_code]
  - `src/services/motorQueries4.js:155` select [motor_2rate, motor_number, pretest_time, race_date, racer_id, venue_code]
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: boat_number, boat_2rate, created_at, updated_at

### <a id="t-mycroft_predictions"></a>mycroft_predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/fix-opening-day-race-id-date.js:77`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:50`
- 読み手（1）: 
  - `src/services/mycroftService.js:97` select [attention_evidence, model_trained_at, predicted_at, race_id, rank_order, win_probs]
- 書き手（1）: 
  - `scripts/daily/generate-mycroft-predictions.js:97` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-nige_outcome_distribution"></a>nige_outcome_distribution

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 取得のジョブ: outcome_distribution_update
- 読み手（1）: 
  - `src/services/venueQueries3.js:55` select [*, count_90days, first_boat, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-nige-outcome-distribution.js:120` delete
  - `scripts/daily/update-nige-outcome-distribution.js:130` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-nige_second_by_course"></a>nige_second_by_course

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/daily/update-course-baseline-stats.js:135` select(helper:upsertChangedRows)
  - `src/services/venueQueries3.js:21` select [exacta_rate, nige_races, second_count, second_course, second_rate, total_races, venue_code, window_days, window_end, window_start]
- 書き手（1）: 
  - `scripts/daily/update-course-baseline-stats.js:135` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-outcome_distribution"></a>outcome_distribution

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 取得のジョブ: outcome_distribution_update
- 読み手（5）: 
  - `api/outcome-distribution/index.js:47` select(rest) [count_90days, first_boat, venue_code]
  - `scripts/analysis/verify-outcome-distribution-coverage.js:26` select(helper:fetchAll)
  - `scripts/maintenance/verify-full-picture-scene2.js:2849` rest(rest) （検査）
  - `src/services/venueQueries.js:98` select [count_90days, first_boat]
  - `src/services/venueQueries.js:224` select [*, count_90days, first_boat, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-outcome-distribution.js:115` delete
  - `scripts/daily/update-outcome-distribution.js:126` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-poirot_predictions"></a>poirot_predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_morning_freshness
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/fix-opening-day-race-id-date.js:78`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:51`
- 読み手（2）: 
  - `scripts/analysis/verify-poirot.js:56` select(helper:fetchAll)
  - `src/services/poirotService.js:62` select [model_version, predicted_at, race_id, top_2nd, top_3rd, top_pick, trifecta_prob, win_probs]
- 書き手（1）: 
  - `scripts/daily/generate-poirot-predictions.js:78` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-prediction_odds"></a>prediction_odds

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: get_predictions_by_date, get_predictions_by_date_light
- 取得のジョブ: odds
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/delete-phantom-races.js:85`, `scripts/maintenance/fix-opening-day-race-id-date.js:73`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:46`
- 読み手（4）: 
  - `scripts/analysis/train-moriarty-calibration.js:82` select(helper:fetchAll)
  - `scripts/daily/generate-moriarty-recommendations.js:112` select [*, race_id]
  - `scripts/lib/scrapeJobs/predictionOddsHandlers.js:155` select [*, race_id]
  - `scripts/lib/scrapeJobs/predictionOddsHandlers.js:194` select(helper:upsertChangedRows)
- 書き手（2）: 
  - `scripts/daily/scrape-prediction-odds.js:249` upsert [?]
  - `scripts/lib/scrapeJobs/predictionOddsHandlers.js:194` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-predictions"></a>predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_prediction_performance, v_todays_recommendations
- 本体で読む RPC: get_accuracy_summary, get_admin_rule_performance, get_predictions_by_date, get_predictions_by_date_light, get_race_history_summary, get_today_races, update_prediction_results
- 本体で書く RPC: update_prediction_results
- 取得のジョブ: exhibition, kfile_sync, race_info, race_status, races_init, result, result_catchup
- 外の読み手: hq `platform/finals_sheet.py`（read） 廃止した3モデルのうち safeBet の予想（BOA-1124 の記述では predictions.safeBet.top3）を「龍神の本線」として読む。読む経路（表・RPC・API のどれか）と列は未確認。3モデルの生成を止める前に hq 側の参照を外す（BOA-1124、2026-10-27）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/delete-phantom-races.js:83`, `scripts/maintenance/fix-opening-day-race-id-date.js:68`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:41`, `scripts/ml/analogy/in_caution_bands.py:204`, `scripts/ml/analogy/tests/test_in_caution_bands.py:286`, `scripts/ml/analogy/tests/test_in_caution_bands.py:318`
- 読み手（44）: 
  - `scripts/analysis/analyze-prediction-ensemble.js:66` select(helper:fetchAll)
  - `scripts/analysis/analyze-upset-factors.js:109` select [feature_contributions, model_id, race_id]
  - `scripts/analysis/calibration-report.js:92` select(helper:fetchAll)
  - `scripts/analysis/campaign-backtest-fetch-races.js:49` select [feature_contributions, predicted_at, race_id]
  - `scripts/analysis/collect-venue-stats.js:231` select [confidence, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/analysis/find-missing-dates.js:32` select [*, race_id]
  - `scripts/analysis/find-video-worthy-race.js:76` select [feature_contributions, model_id, predicted_at, race_id]
  - `scripts/analysis/simulate-nige-calibration.js:36` select(helper:fetchAll)
  - `scripts/analysis/train-moriarty-calibration.js:67` select(helper:fetchAll)
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:75` select [feature_contributions, model_id, prediction_id, race_id]
  - `scripts/analysis/verify-calculations.js:15` select [model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/daily-rule-tracking.js:129` select [*, model_id, race_id]
  - `scripts/daily/calculate-accuracy.js:25` select(helper:fetchAll)
  - `scripts/daily/calculate-accuracy.js:65` select(helper:fetchAll)
  - `scripts/daily/calculate-unified-model-accuracy.js:179` select(helper:fetchAll)
  - `scripts/daily/calculate-unified-volatility-accuracy.js:114` select(helper:fetchAll)
  - `scripts/daily/generate-moriarty-recommendations.js:81` select [is_shadow, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/daily/generate-morning-digest.js:298` select [feature_contributions, model_id, race_id]
  - `scripts/daily/generate-unified-predictions.js:152` select(helper:fetchAll)
  - `scripts/daily/generate-unified-predictions.js:247` select(helper:fetchAll)
  - `scripts/daily/generate-unified-predictions.js:260` select(helper:fetchAll)
  - `scripts/daily/generate-unified-trifecta-reference.js:44` select [feature_contributions, is_shadow, model_id, race_id]
  - `scripts/daily/scrape-prediction-odds.js:40` select [is_shadow, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/daily/scrape-results.js:982` select(helper:fetchAll)
  - `scripts/daily/todays-volatility-digest.js:124` select [feature_contributions, model_id, race_id]
  - `scripts/daily/update-race-history-cache.js:27` select(helper:fetchAll)
  - `scripts/lib/inCautionHealth.js:127` select [feature_contributions, model_id, race_id]
  - `scripts/lib/raceResultPersist.js:39` select [feature_contributions, model_id, prediction_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/lib/scrapeJobs/predictionOddsHandlers.js:50` select [is_shadow, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/maintenance/backfill-is-hit-turn.js:28` select(helper:fetchAll)
  - `scripts/maintenance/backfill-missing-venue-day.js:131` select [race_id]
  - `scripts/maintenance/backfill-place-hits.js:62` select [is_hit_place, prediction_id, race_id, top_pick]
  - `scripts/maintenance/backfill-refund-hit-flags.js:87` select(helper:fetchAll)
  - `scripts/maintenance/backfill-refund-hit-flags.js:106` select(helper:fetchAll)
  - `scripts/maintenance/backfill-trifecta-trio.js:37` select [model_id, prediction_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/maintenance/build-races-derived-backfill-sql.js:122` select(helper:fetchAll)
  - `scripts/maintenance/delete-cancelled-race-predictions.js:72` select [prediction_id, race_id]
  - `scripts/maintenance/delete-phantom-races.js:138` select [is_hit_place, is_hit_trifecta, is_hit_trio, is_hit_win, race_id]
  - `scripts/maintenance/verify-admin-rule-performance.js:268` select [confidence, model_id, predicted_at, race_id, top_2nd, top_3rd, top_pick] （検査）
  - `scripts/maintenance/verify-full-picture-scene2.js:3001` rest(rest) （検査）
  - `src/services/adminRuleService.js:26` select [confidence, model_id, predicted_at, race_id, top_2nd, top_3rd, top_pick]
  - `src/services/predictionQueries3.js:133` select [is_hit_place, is_hit_trifecta, is_hit_trio, is_hit_win, model_id, payout_place, payout_trifecta, payout_trio, payout_win, race_id]
  - `src/services/raceQueries2.js:226` select [feature_contributions, model_id, predicted_at, race_id]
  - `src/services/ruleMatchService.js:124` select [confidence, model_id, predicted_at, race_id, top_2nd, top_3rd, top_pick]
- 書き手（10）: 
  - `scripts/daily/generate-predictions.js:1720` upsert [?]
  - `scripts/daily/generate-unified-predictions.js:306` upsert [?]
  - `scripts/daily/scrape-results.js:1031` update [?]
  - `scripts/lib/raceResultPersist.js:61` update [?]
  - `scripts/maintenance/backfill-is-hit-turn.js:69` update [is_hit_turn]
  - `scripts/maintenance/backfill-place-hits.js:42` update [is_hit_place, payout_place]
  - `scripts/maintenance/backfill-refund-hit-flags.js:135` update [?]
  - `scripts/maintenance/backfill-trifecta-trio.js:62` update [?]
  - `scripts/maintenance/delete-cancelled-race-predictions.js:139` delete
  - `scripts/maintenance/migrate-to-supabase.js:270` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_conditions"></a>race_conditions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_coverage, data_health_nightly_freshness, data_health_pre_race_fields, data_health_table_rows, get_predictions_by_date, get_predictions_by_date_light, get_racer_accident_records, get_today_races
- 取得のジョブ: exhibition, kfile_sync, race_info, race_status, races_init, result, result_catchup
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:75`, `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:9`, `scripts/maintenance/delete-phantom-races.js:87`, `scripts/maintenance/fix-opening-day-race-id-date.js:70`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:43`
- 読み手（44）: 
  - `api/_lib/racerEntryExhibition.js:173` rest(rest) [is_final_day, race_id, series_day]
  - `api/_lib/snsClaimCheckReaders.js:104` rest(rest) [race_id, race_stage]
  - `api/_lib/snsClaimCheckReaders.js:229` rest(rest) [race_id, race_stage]
  - `api/admin/sns-hub/send-probe.js:66` rest(rest) [race_id, race_stage]
  - `scripts/analysis/backtest-unified-model.js:116` select [race_id, wave_height, wind_speed]
  - `scripts/analysis/boa845-axis-place/fetch_today.mjs:40` select(helper:all)
  - `scripts/analysis/calibrate-unified-model.js:152` select [race_id, wave_height, wind_speed]
  - `scripts/analysis/race-stage-inventory.mjs:31` select(helper:fetchAllByRaceId)
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:53` select(helper:fetchAllByRaceId)
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:115` select [race_id, wave_height, weather, wind_direction, wind_speed]
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:90` select [race_id, wave_height, wind_speed]
  - `scripts/analysis/verify-volatility-predictive-power.js:72` select [race_id, wave_height, wind_speed]
  - `scripts/daily/generate-predictions.js:1300` select(helper:selectByRaceIds)
  - `scripts/daily/generate-unified-predictions.js:64` select(helper:fetchAll)
  - `scripts/daily/scrape-point-rank.js:169` select [race_id, series_day]
  - `scripts/lib/analogyV16Exhibition.js:191` rest(rest) [race_id, wave_height, weather, weather_observed_at, wind_direction, wind_speed]
  - `scripts/lib/raceConditionsWriter.js:44` select(helper:upsertChangedRows)
  - `scripts/lib/snsAutoPlanRunnerStore.js:58` rest(rest) [race_id, race_stage]
  - `scripts/lib/snsTodayDigestV3.js:85` rest(rest) [is_final_day, race_id, race_stage, race_title, series_day]
  - `scripts/maintenance/backfill-opening-day-races.js:96` select(helper:count)
  - `scripts/maintenance/backfill-race-conditions.js:77` select [race_id]
  - `scripts/maintenance/backfill-race-series-meta.js:162` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:302` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:355` select(helper:fetchAll)
  - `scripts/maintenance/backfill-series-day.js:58` select(helper:fetchAll)
  - `scripts/maintenance/check-pre-race-shadow.js:287` select(helper:fetchByRaceIds)
  - `scripts/maintenance/verify-full-picture-scene2.js:3633` rest(rest) [race_id, race_stage] （検査）
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:179` select(helper:filterUnchangedRows)
  - `scripts/ml/analogy/build-wind-basis.js:95` select [race_id, wind_direction, wind_speed]
  - `scripts/ml/export-inference-data.js:119` select(helper:fetchByRaceIds)
  - `scripts/ml/export-training-data.js:201` select(helper:fetchAll)
  - `scripts/sns/pushFinalsImageStore.js:82` rest(rest) [race_id, race_stage]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:107` rest(rest) [race_id, race_stage]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:112` rest(rest) [race_id, race_stage]
  - `scripts/verification/verify-series-points-border.mjs:79` select [race_id, race_stage]
  - `scripts/verification/verify-series-points-needed.mjs:74` select [race_id, race_stage]
  - `scripts/verification/verify-series-points-official.mjs:158` select [is_final_day, race_id, race_stage]
  - `src/services/currentMeetEntries.js:44` select [is_final_day, race_id, series_day]
  - `src/services/meetQueries2.js:115` select [is_final_day, race_id, race_stage, race_title, series_day]
  - `src/services/meetQueries3.js:43` select [is_final_day, race_id, race_stage, race_title, series_day]
  - `src/services/motorQueries.js:205` select [is_final_day, race_id, series_day]
  - `src/services/motorQueries3.js:285` select [race_id, race_stage]
  - `src/services/racerQueries2.js:116` select(helper:fetchAllByIn)
  - `src/services/racerQueries2.js:336` select(helper:fetchAllByIn)
- 書き手（6）: 
  - `scripts/lib/raceConditionsWriter.js:44` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-race-conditions.js:161` upsert [?]
  - `scripts/maintenance/backfill-race-series-meta.js:227` upsert [?]
  - `scripts/maintenance/backfill-race-series-meta.js:337` upsert [?]
  - `scripts/maintenance/backfill-series-day.js:175` update [series_day]
  - `scripts/maintenance/backfill-series-day.js:196` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_entries"></a>race_entries

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_todays_recommendations
- 本体で読む RPC: compute_racer_course_technique_stats, compute_st_course_baseline, compute_today_course_win_stats, compute_venue_course_entry_baseline, compute_venue_course_technique_baseline, data_health_entries_duplicates, data_health_pre_race_fields, data_health_racer_period_stats, data_health_table_rows, get_latest_racer_grades, get_predictions_by_date, get_predictions_by_date_light, get_race_exhibition_trend, get_race_return_rate, get_race_st_predictability, get_race_technique_profile, get_racer_accident_records, get_today_races
- 取得のジョブ: exhibition, race_info, races_init
- 写しに無い列の名前（埋め込みの別名・JSON のキー・誤りのどれか）: name
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:77`, `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:7`, `scripts/maintenance/backfill-kb-gaps.js:81`, `scripts/maintenance/delete-phantom-races.js:88`, `scripts/maintenance/fix-opening-day-race-id-date.js:66`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:39`, `scripts/ml/analogy/v16_morning.py:292`
- 読み手（146）: 
  - `api/_lib/analogyV16.js:105` rest(rest) [boat_number, is_absent, race_id]
  - `api/_lib/racerEntryExhibition.js:171` rest(rest) [boat_number, race_id, racer_id]
  - `api/_lib/snsClaimCheckReaders.js:45` rest(rest) [is_absent, race_id]
  - `api/_lib/snsClaimCheckReaders.js:235` rest(rest) [is_absent, race_id]
  - `api/_lib/snsTodayDigest.js:52` rest(rest) [boat_number, is_absent, race_id]
  - `scripts/analysis/aggregate-racer-stats.js:627` select [racer_id]
  - `scripts/analysis/analyze-indicator-predictive-power.js:131` select [boat_number, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/backtest-course-rate-only.js:81` select [boat_number, race_id, racer_id]
  - `scripts/analysis/backtest-unified-model.js:100` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/boa845-axis-place/fetch_today.mjs:39` select(helper:all)
  - `scripts/analysis/calibrate-unified-model.js:136` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/campaign-backtest-fetch-races.js:96` select [boat_2rate, boat_3rate, boat_number, grade, local_win_rate, motor_2rate, motor_3rate, player_name, race_id, win_rate]
  - `scripts/analysis/collect-venue-stats.js:261` select [boat_number, grade, motor_2rate, race_id, win_rate]
  - `scripts/analysis/compare-course-rate-sources.js:59` select(helper:fetchAll)
  - `scripts/analysis/find-missing-dates.js:31` select [*, race_id]
  - `scripts/analysis/original-exhibition/fetch.mjs:74` select(helper:all)
  - `scripts/analysis/past-rate-check/label-threshold-checks.mjs:87` select [race_id]
  - `scripts/analysis/past-rate-check/label-threshold-checks.mjs:88` select [boat_number, created_at, race_id, updated_at]
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:58` select(helper:fetchAllByRaceId)
  - `scripts/analysis/train-conditional-logit.js:83` select(helper:fetchAll)
  - `scripts/analysis/train-moriarty-calibration.js:77` select(helper:fetchAll)
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:109` select [boat_number, grade, race_id, win_rate]
  - `scripts/analysis/verify-race-analysis-rpc.js:28` select [boat_number, player_name, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:49` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:120` select [boat_number, player_name, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:141` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:188` select [boat_number, player_name, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:201` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:253` select [boat_number, player_name, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:268` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:134` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:74` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/verify-volatility-predictive-power.js:58` select [boat_number, race_id, racer_id, win_rate]
  - `scripts/daily/generate-moriarty-recommendations.js:122` select [ai_score_safe_bet, ai_score_standard, ai_score_upset_focus, boat_number, race_id]
  - `scripts/daily/generate-morning-digest.js:152` select [boat_number, grade, is_absent, motor_2rate, motor_number, player_name, race_id, racer_id]
  - `scripts/daily/generate-predictions.js:1035` select(helper:upsertChangedRows)
  - `scripts/daily/generate-predictions.js:1299` select(helper:selectByRaceIds)
  - `scripts/daily/generate-unified-predictions.js:55` select(helper:fetchAll)
  - `scripts/daily/generate-unified-predictions.js:236` select(helper:fetchAll)
  - `scripts/daily/generate-unified-trifecta-reference.js:71` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/daily/morning-init.js:259` select(helper:fetchAll)
  - `scripts/daily/update-race-info.js:137` select(helper:upsertChangedRows)
  - `scripts/lib/analogyV16Exhibition.js:261` rest(rest) [is_absent, race_id]
  - `scripts/lib/motorPretestRows.js:134` select [race_id, racer_id]
  - `scripts/lib/pitReportJob.js:188` select [boat_number, race_id, racer_id]
  - `scripts/lib/raceIndicatorData.js:72` select [boat_number, race_id, racer_id, win_rate]
  - `scripts/lib/raceIndicatorData.js:87` select [race_id, racer_id, win_rate]
  - `scripts/lib/racelistBackfillRows.js:127` select [race_id]
  - `scripts/lib/racerProfileSync.js:343` select [boat_number, race_id, racer_id]
  - `scripts/lib/racerStStats.js:127` select(helper:fetchAll)
  - `scripts/lib/snsTodayDigestV3.js:89` rest(rest) [boat_number, grade, is_absent, player_name, race_id, racer_id]
  - `scripts/lib/venueEntryCourseStats/scrape.js:49` select(helper:fetchAll)
  - `scripts/maintenance/audit-race-entries-vs-kb.js:68` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:154` select(helper:fetchAll)
  - `scripts/maintenance/backfill-opening-day-races.js:95` select(helper:count)
  - `scripts/maintenance/backfill-pit-reports.js:146` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-entries-racer-id-remaining.js:69` select(helper:fetchAllPaged)
  - `scripts/maintenance/backfill-race-entries-racer-id-remaining.js:172` select(helper:fetchAllPaged)
  - `scripts/maintenance/backfill-race-entries-racer-id.js:176` select(helper:fetchAllPaged)
  - `scripts/maintenance/backfill-racer-ids.js:128` select [boat_number, race_id, racer_id]
  - `scripts/maintenance/build-races-derived-backfill-sql.js:157` select(helper:fetchAll)
  - `scripts/maintenance/check-morning-init-shadow.js:121` select [age, boat_number, boat_number_id, grade, motor_number, race_id, racer_id]
  - `scripts/maintenance/check-pre-race-shadow.js:281` select(helper:fetchByRaceIds)
  - `scripts/maintenance/delete-phantom-race-days.js:112` select [boat_number, race_id, racer_id]
  - `scripts/maintenance/fix-opening-day-entries-from-b.js:290` select(helper:fetchAll)
  - `scripts/maintenance/racelist-backfill-load.js:97` select(helper:upsertChangedRows)
  - `scripts/maintenance/racelist-backfill-load.js:199` select [race_id]
  - `scripts/maintenance/restore-contaminated-race-entries.js:81` select(helper:fetchAll)
  - `scripts/maintenance/restore-contaminated-race-entries.js:206` select(helper:upsertChangedRows)
  - `scripts/maintenance/restore-entries-branch-hometown.js:39` select(helper:fetchAll)
  - `scripts/maintenance/restore-entries-branch-hometown.js:119` select(helper:upsertChangedRows)
  - `scripts/maintenance/verify-analogy-v16.js:289` rest(rest) [is_absent, race_id] （検査）
  - `scripts/maintenance/verify-data-readers.js:557` select(embed) [racer_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:46` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:47` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:51` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:52` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:56` rest(rest) [name, race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:57` rest(rest) [name, race_id] （検査）
  - `scripts/maintenance/verify-full-picture-scene2.js:3168` rest(rest) （検査）
  - `scripts/maintenance/verify-pretest-row-pick.js:93` select(embed) [racer_id] （検査）
  - `scripts/maintenance/verifyData/scraped-timestamps-scenes-1.js:93` select(helper:upsertChangedRows)
  - `scripts/maintenance/verifyData/scraped-timestamps-scenes-1.js:117` select(helper:upsertChangedRows)
  - `scripts/maintenance/verifyData/series-points-stage-rules-scenes-1.js:194` select(helper:fetchAllByRaceId)
  - `scripts/maintenance/verifyData/series-points-stage-rules-scenes-1.js:215` select(helper:fetchAllByRaceId)
  - `scripts/maintenance/verifyData/sns-today-plan-v3-race-db.js:106` rest(rest) [race_id]
  - `scripts/maintenance/verifyData/sns-today-plan-v3-race-db.js:108` rest(rest) [race_id]
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:101` select(helper:upsertChangedRows)
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:126` select(helper:upsertChangedRows)
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:146` select(helper:upsertChangedRows)
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:161` select(helper:filterUnchangedRows)
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-3.js:50` select(helper:upsertChangedRows)
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-3.js:95` select(helper:upsertChangedRows)
  - `scripts/ml/export-inference-data.js:111` select(helper:fetchByRaceIds)
  - `scripts/ml/export-training-data.js:191` select(helper:fetchAll)
  - `scripts/sns/pushSetsuKiryokuShortStore.js:119` rest(rest) [is_absent, race_id]
  - `scripts/sns/rank-data.js:78` select(helper:readAllIn)
  - `scripts/sns/rankDataMotor.js:58` select(helper:readAllIn)
  - `scripts/sns/rankDataRacer.js:15` select(helper:readAll)
  - `scripts/verification/verify-series-points-border.mjs:47` select [boat_number, player_name, race_id, racer_id]
  - `scripts/verification/verify-series-points-needed.mjs:41` select [boat_number, player_name, race_id, racer_id]
  - `scripts/verification/verify-series-points-official.mjs:149` select [boat_number, player_name, race_id, racer_id]
  - `src/services/currentMeetEntries.js:26` select [boat_number, motor_number, race_id, racer_id]
  - `src/services/meetQueries.js:37` select [boat_number, f_count, race_id, racer_id]
  - `src/services/meetQueries.js:49` select [boat_number, race_id, racer_id]
  - `src/services/meetQueries.js:184` select [boat_number, race_id, racer_id]
  - `src/services/meetQueries.js:195` select [boat_number, race_id, racer_id]
  - `src/services/meetQueries.js:252` select [boat_number, motor_number, race_id, racer_id]
  - `src/services/meetQueries2.js:105` select [boat_number, motor_number, player_name, race_id, racer_id]
  - `src/services/meetQueries3.js:60` select [boat_number, player_name, race_id, racer_id]
  - `src/services/motorQueries.js:234` select [motor_2rate, race_id]
  - `src/services/motorQueries.js:274` select [boat_number, motor_2rate, motor_3rate, motor_number, race_id]
  - `src/services/motorQueries2.js:111` select [boat_number, global_2rate, motor_number, race_id]
  - `src/services/motorQueries2.js:262` select [boat_number, grade, motor_number, player_name, race_id, racer_id]
  - `src/services/motorQueries3.js:240` select [boat_number, motor_2rate, motor_3rate, motor_number, player_name, race_id, racer_id]
  - `src/services/motorQueries3.js:303` select [boat_number, motor_number, player_name, race_id, racer_id]
  - `src/services/motorQueries4.js:160` select [motor_2rate, motor_number, player_name, race_id, racer_id]
  - `src/services/motorQueries5.js:38` select [?, motor_number, race_id]
  - `src/services/motorQueries7.js:47` select [motor_number, race_id, racer_id]
  - `src/services/mycroftService.js:83` select [boat_number, player_name, race_id]
  - `src/services/raceQueries.js:144` select [boat_number, f_count, global_2rate, global_3rate, l_count, local_2rate, local_3rate, local_win_rate, race_id, win_rate]
  - `src/services/raceQueries.js:169` select [boat_number, local_win_rate, player_name, race_id, racer_id, win_rate]
  - `src/services/raceQueries.js:192` select [race_id, racer_id, win_rate]
  - `src/services/raceQueries.js:278` select [boat_number, player_name, race_id, racer_id]
  - `src/services/raceQueries.js:308` select [boat_number, race_id, racer_id]
  - `src/services/raceQueries2.js:25` select [boat_number, race_id, racer_id]
  - `src/services/raceQueries2.js:56` select [boat_number, player_name, race_id, racer_id]
  - `src/services/raceQueries2.js:158` select [boat_number, race_id, weight_kg]
  - `src/services/raceQueries2.js:264` select [boat_number, race_id, racer_id]
  - `src/services/raceQueries3.js:83` select [age, boat_number, global_2rate, grade, local_win_rate, motor_2rate, motor_number, player_name, race_id, win_rate]
  - `src/services/raceQueries3.js:137` select [boat_number, player_name, race_id, racer_id]
  - `src/services/raceQueries3.js:164` select [boat_number, race_id, racer_id]
  - `src/services/raceQueries3.js:328` select [boat_number, race_id, racer_id]
  - `src/services/racerQueries.js:19` select [?, race_id, racer_id]
  - `src/services/racerQueries.js:47` select [local_win_rate, race_id, racer_id, win_rate]
  - `src/services/racerQueries.js:83` select [local_win_rate, race_id, racer_id, win_rate]
  - `src/services/racerQueries.js:103` select [race_id, racer_id, win_rate]
  - `src/services/racerQueries.js:140` select [boat_number, race_id, racer_id]
  - `src/services/racerQueries3.js:27` select [boat_number, race_id, racer_id]
  - `src/services/racerQueries3.js:99` select [boat_number, race_id, racer_id]
  - `src/services/racerQueries3.js:182` select [boat_number, race_id, racer_id]
  - `src/services/racerQueries3.js:263` select(helper:fetchAllByIn)
  - `src/services/racerQueries3.js:309` select [race_id, racer_id, win_rate]
  - `src/services/racerQueries5.js:45` select [grade, race_id, racer_id]
  - `src/services/sherlockService.js:70` select [boat_2rate, boat_number, grade, local_win_rate, motor_2rate, player_name, race_id, win_rate]
  - `src/services/watsonService.js:76` select [boat_number, player_name, race_id]
- 書き手（17）: 
  - `scripts/daily/generate-predictions.js:1035` upsert(helper:upsertChangedRows) [?]
  - `scripts/daily/update-race-info.js:137` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-race-data.js:182` upsert [?]
  - `scripts/maintenance/backfill-race-entries-racer-id-remaining.js:127` update [racer_id]
  - `scripts/maintenance/backfill-race-entries-racer-id.js:131` update [racer_id]
  - `scripts/maintenance/backfill-racer-ids.js:228` update [racer_id]
  - `scripts/maintenance/migrate-to-supabase.js:259` upsert [?]
  - `scripts/maintenance/racelist-backfill-load.js:97` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/restore-contaminated-race-entries.js:206` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/restore-entries-branch-hometown.js:119` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verifyData/scraped-timestamps-scenes-1.js:93` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verifyData/scraped-timestamps-scenes-1.js:117` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:101` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:126` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:146` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-3.js:50` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-3.js:95` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_history_cache"></a>race_history_cache

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `api/race-history/summary.js:37` select(rest) [data, key]
  - `src/services/scheduleQueries.js:187` select [data, key]
- 書き手（1）: 
  - `scripts/daily/update-race-history-cache.js:124` upsert [data, key, updated_at]

### <a id="t-race_notices_health"></a>race_notices_health

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: race_notices
- 読み手（2）: 
  - `scripts/daily/scrape-race-information.js:188` select [check_date, had_success, last_reason, venue_code]
  - `scripts/maintenance/check-race-notices-drift.js:75` select [check_date, had_success, last_reason, venue_code]
- 書き手（1）: 
  - `scripts/daily/scrape-race-information.js:277` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: last_checked_at

### <a id="t-race_odds"></a>race_odds

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_coverage, data_health_table_rows
- 取得のジョブ: odds, odds_final
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/delete-phantom-races.js:75`, `scripts/maintenance/fix-opening-day-race-id-date.js:71`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:44`
- 読み手（15）: 
  - `api/odds/live.js:79` select [*, captured_at, race_id]
  - `scripts/analysis/backtest-unified-model.js:73` select(helper:fetchAll)
  - `scripts/analysis/check-win-odds-vs-final.js:45` select(helper:fetchAll)
  - `scripts/analysis/train-conditional-logit.js:101` select(helper:fetchAll)
  - `scripts/analysis/train-moriarty-calibration.js:83` select(helper:fetchAll)
  - `scripts/daily/generate-moriarty-recommendations.js:97` select [captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6, race_id]
  - `scripts/daily/generate-unified-trifecta-reference.js:55` select(helper:fetchAll)
  - `scripts/daily/scrape-odds.js:144` select(helper:fetchAll)
  - `scripts/daily/scrape-odds.js:323` select [*, race_id, window_min]
  - `scripts/daily/scrape-odds.js:395` select [?, captured_at, race_id]
  - `scripts/lib/scrapeJobs/predictionOddsHandlers.js:81` select [captured_at, race_id, trifecta_all, trio_all]
  - `scripts/maintenance/check-odds-shadow.js:201` select [?, race_id, source]
  - `scripts/ml/export-training-data.js:285` select(helper:fetchAll)
  - `src/services/raceQueries2.js:320` select [?, captured_at, race_id]
  - `src/services/sherlockService.js:80` select [captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6, race_id]
- 書き手（3）: 
  - `scripts/daily/scrape-odds.js:288` upsert [?]
  - `scripts/daily/scrape-odds.js:303` upsert [?]
  - `scripts/daily/scrape-odds.js:508` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_odds_final"></a>race_odds_final

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: odds_final
- 読み手（3）: 
  - `scripts/analysis/check-win-odds-vs-final.js:50` select(helper:fetchAll)
  - `scripts/lib/scrapeJobs/finalOddsHandlers.js:129` select [?, race_id]
  - `src/services/raceQueries3.js:31` select [captured_at, exacta_all, place_all, quinella_all, race_id, trifecta_all, trio_all, wide_all, win_all]
- 書き手（1）: 
  - `scripts/lib/scrapeJobs/finalOddsHandlers.js:144` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_original_exhibition"></a>race_original_exhibition

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: boatcast_oriten
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/original-exhibition/check-rewrite.mjs:15`, `scripts/lib/boatcast/oritenSchema.js:12`
- 読み手（5）: 
  - `scripts/analysis/original-exhibition/fetch.mjs:44` select(helper:all)
  - `scripts/lib/boatcast/oritenJob.js:183` select [content_hash, parser_version, race_id]
  - `scripts/lib/boatcast/oritenJob.js:223` select(helper:upsertChangedRows)
  - `scripts/maintenance/verifyData/e2e-no-unroute-self-test.js:122` rest(rest)
  - `src/services/raceQueries4.js:165` select [item_labels, race_id, updated_at]
- 書き手（1）: 
  - `scripts/lib/boatcast/oritenJob.js:223` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_original_exhibition_values"></a>race_original_exhibition_values

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: boatcast_oriten
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/original-exhibition/check-rewrite.mjs:15`, `scripts/lib/boatcast/oritenSchema.js:13`
- 読み手（5）: 
  - `scripts/analysis/original-exhibition/fetch.mjs:49` select(helper:all)
  - `scripts/lib/boatcast/oritenJob.js:203` select(helper:upsertChangedRows)
  - `scripts/lib/boatcast/oritenJobParts.js:39` select [boat_number, kind, race_id]
  - `src/services/meetQueries.js:333` select(helper:fetchAllByIn)
  - `src/services/raceQueries4.js:170` select [boat_number, kind, race_id, value]
- 書き手（2）: 
  - `scripts/lib/boatcast/oritenJob.js:203` upsert(helper:upsertChangedRows) [?]
  - `scripts/lib/boatcast/oritenJobParts.js:47` delete
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_outcome_frequencies"></a>race_outcome_frequencies

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 読み手（0）: なし
- 書き手（1）: 
  - `scripts/daily/update-outcome-frequencies.js:110` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: total_occurrences, sample_races, appearance_rate, avg_payout, recovery_rate, updated_at

### <a id="t-race_payouts"></a>race_payouts

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_table_rows, get_predictions_by_date, get_predictions_by_date_light
- 取得のジョブ: kfile_sync, race_status, result, result_catchup
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/lib/raceResultSchema.js:30`, `scripts/maintenance/delete-phantom-races.js:77`
- 読み手（3）: 
  - `scripts/lib/dailyReconcileJob.js:106` select(helper:fetchAll)
  - `scripts/lib/raceResultPersist.js:141` select(helper:upsertChangedRows)
  - `scripts/maintenance/backfill-kb-recent-results.js:164` select(helper:fetchAll)
- 書き手（2）: 
  - `scripts/lib/raceResultFix.js:134` upsert [?]
  - `scripts/lib/raceResultPersist.js:141` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_pit_comments"></a>race_pit_comments

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: pit_reports
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/lib/pitReportSchema.js:14`
- 読み手（2）: 
  - `scripts/lib/pitReportJob.js:242` select(helper:upsertChangedRows)
  - `src/services/raceQueries4.js:94` select [boat_number, comment_text, confidence_stars, previous_race_number, race_id, racer_id]
- 書き手（2）: 
  - `scripts/lib/pitReportJob.js:242` upsert(helper:upsertChangedRows) [?]
  - `scripts/lib/pitReportJob.js:259` delete
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_pit_reports"></a>race_pit_reports

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_pit_reports, data_health_table_rows
- 取得のジョブ: pit_reports
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/lib/pitReportSchema.js:13`
- 読み手（4）: 
  - `scripts/lib/pitReportJob.js:207` select [content_hash, parser_version, race_id, raw_storage_path]
  - `scripts/lib/pitReportJob.js:270` select(helper:upsertChangedRows)
  - `scripts/maintenance/backfill-pit-reports.js:134` select(helper:fetchAll)
  - `src/services/raceQueries4.js:87` select [comment_count, created_at, race_id, reporter_name, status, target_from, target_to, updated_at]
- 書き手（1）: 
  - `scripts/lib/pitReportJob.js:270` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_results"></a>race_results

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_prediction_performance
- 本体で読む RPC: compute_nige_second_by_course, compute_racer_course_technique_stats, compute_st_course_baseline, compute_today_course_win_stats, compute_venue_course_entry_baseline, compute_venue_course_technique_baseline, data_health_cancellation_with_result, data_health_coverage, data_health_entries_duplicates, data_health_monthly_result, data_health_nightly_freshness, data_health_table_rows, get_admin_rule_performance, get_predictions_by_date, get_predictions_by_date_light, get_race_return_rate, get_race_technique_profile, get_today_races, update_venue_stats
- 取得のジョブ: kfile_sync, race_status, result, result_catchup
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:76`, `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:10`, `scripts/lib/raceResultSchema.js:25`, `scripts/maintenance/delete-phantom-races.js:74`, `scripts/maintenance/fix-opening-day-race-id-date.js:69`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:42`
- 読み手（111）: 
  - `api/_lib/snsClaimCheckReaders.js:321` rest(rest) [race_id, rank1]
  - `scripts/analysis/aggregate-racer-stats.js:70` select(helper:fetchAll)
  - `scripts/analysis/analogy-finder-md6/export-actual-course.js:20` select(helper:fetchAll)
  - `scripts/analysis/analyze-indicator-predictive-power.js:116` select(helper:fetchAll)
  - `scripts/analysis/analyze-upset-factors.js:94` select [is_cancelled, is_no_race, payout_win, race_id, rank1, winning_technique]
  - `scripts/analysis/backtest-course-rate-only.js:60` select(helper:fetchAll)
  - `scripts/analysis/backtest-unified-model.js:196` select(helper:fetchAll)
  - `scripts/analysis/boa845-axis-place/fetch_today.mjs:42` select(helper:all)
  - `scripts/analysis/calculate-placement-distribution.js:29` select(helper:fetchAll)
  - `scripts/analysis/calibrate-unified-model.js:120` select(helper:fetchAll)
  - `scripts/analysis/calibration-report.js:99` select(helper:fetchAll)
  - `scripts/analysis/campaign-backtest-score.js:59` select [payout_trifecta, payout_trio, race_id, rank1, rank2, rank3]
  - `scripts/analysis/collect-venue-stats.js:247` select [*, race_id]
  - `scripts/analysis/compare-course-rate-sources.js:52` select(helper:fetchAll)
  - `scripts/analysis/find-missing-dates.js:33` select [*, race_id]
  - `scripts/analysis/find-video-worthy-race.js:93` select [payout_trifecta, payout_win, race_id, rank1, rank2, rank3, winning_technique]
  - `scripts/analysis/original-exhibition/fetch.mjs:69` select(helper:all)
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:274` select [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, is_cancelled, is_no_race, payout_trifecta, payout_trio, race_id, race_status, rank1, rank2, rank3, refund_boats]
  - `scripts/analysis/redesign-volatility-by-venue.js:150` select [is_cancelled, is_no_race, payout_win, race_id, rank1, winning_technique]
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:63` select(helper:fetchAllByRaceId)
  - `scripts/analysis/simulate-nige-calibration.js:42` select(helper:fetchAll)
  - `scripts/analysis/train-conditional-logit.js:93` select(helper:fetchAll)
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:60` select [race_id]
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:101` select [course_1, course_2, course_3, course_4, course_5, course_6, race_id, rank1, rank2, rank3, winning_technique]
  - `scripts/analysis/venue-summary-stats/count-venue-techniques.mjs:78` select(helper:fetchAll)
  - `scripts/analysis/verify-all-venues-label-accuracy.js:93` select [race_id, rank1]
  - `scripts/analysis/verify-calculations.js:20` select [payout_place_1, payout_place_2, payout_trifecta, payout_trio, payout_win, race_id, rank1, rank2, rank3]
  - `scripts/analysis/verify-label-accuracy.js:94` select [race_id, rank1]
  - `scripts/analysis/verify-outcome-distribution-coverage.js:45` select(helper:fetchAll)
  - `scripts/analysis/verify-poirot.js:73` select [is_cancelled, is_no_race, payout_trio, race_id, rank1, rank2, rank3]
  - `scripts/analysis/verify-race-analysis-rpc.js:211` select [race_id, rank1, winning_technique]
  - `scripts/analysis/verify-race-analysis-rpc.js:285` select [is_cancelled, is_no_race, payout_place_1, payout_place_2, payout_win, race_id, rank1, rank2]
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:151` select(helper:fetchInChunks)
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:56` select(helper:fetchAll)
  - `scripts/analysis/verify-volatility-predictive-power.js:42` select(helper:fetchAll)
  - `scripts/daily-rule-tracking.js:149` select [*, race_id]
  - `scripts/daily/calculate-accuracy.js:94` select(helper:fetchAll)
  - `scripts/daily/calculate-unified-model-accuracy.js:187` select(helper:fetchAll)
  - `scripts/daily/calculate-unified-volatility-accuracy.js:125` select(helper:fetchAll)
  - `scripts/daily/calculate-venue-grade-stats.js:176` select(embed) [is_cancelled, payout_trio, race_status, rank1, rank2, rank3, refund_boats, winning_technique]
  - `scripts/daily/scrape-odds.js:79` select [payout_win, race_id]
  - `scripts/daily/scrape-results.js:196` select [race_id, rank1]
  - `scripts/daily/scrape-results.js:252` select(helper:filterUnchangedRows)
  - `scripts/daily/scrape-results.js:314` select [race_id, rank1, rank2, rank3, rank4]
  - `scripts/daily/scrape-results.js:665` select [race_id]
  - `scripts/daily/scrape-results.js:729` select [race_id]
  - `scripts/daily/scrape-results.js:821` select [payout_win, race_id, winning_technique]
  - `scripts/daily/scrape-results.js:1003` select(helper:fetchAll)
  - `scripts/daily/update-exhibition-time-top-stats.js:185` select(helper:fetchAll)
  - `scripts/daily/update-losing-technique-stats.js:55` select [is_cancelled, race_id, rank1, winning_technique]
  - `scripts/daily/update-moriarty-outcomes.js:46` select [is_cancelled, payout_trifecta, payout_trio, payout_win, race_id, race_status, rank1, rank2, rank3]
  - `scripts/daily/update-nige-outcome-distribution.js:63` select [?, is_cancelled, race_id, rank1, rank2, rank3, winning_technique]
  - `scripts/daily/update-outcome-distribution.js:60` select [?, is_cancelled, race_id, rank1, rank2, rank3]
  - `scripts/daily/update-outcome-frequencies.js:19` select [is_cancelled, payout_trio, race_id, race_status, rank1, rank2, rank3, result_at]
  - `scripts/daily/update-top-start-stats.js:185` select(helper:fetchAll)
  - `scripts/daily/update-winning-technique-stats.js:62` select [is_cancelled, race_id, rank1, winning_technique]
  - `scripts/daily/update-winning-technique-stats.js:197` select(helper:fetchAll)
  - `scripts/lib/dailyReconcileJob.js:97` select(helper:fetchAll)
  - `scripts/lib/inCautionHealth.js:142` select [race_id, rank1]
  - `scripts/lib/raceResultPersist.js:104` select(helper:upsertChangedRows)
  - `scripts/lib/raceResultRun.js:131` select [payout_win, race_id, winning_technique]
  - `scripts/lib/raceStatusJob.js:110` select [race_id]
  - `scripts/maintenance/audit-missing-results.js:73` select(helper:fetchAll)
  - `scripts/maintenance/audit-race-result-anomalies.js:97` select(helper:fetchAll)
  - `scripts/maintenance/audit-race-result-anomalies.js:207` select [?, race_id]
  - `scripts/maintenance/backfill-actual-course.js:65` select [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, race_id, rank1]
  - `scripts/maintenance/backfill-is-hit-turn.js:42` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:125` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:351` select(helper:upsertChangedRows)
  - `scripts/maintenance/backfill-opening-day-races.js:98` select(helper:count)
  - `scripts/maintenance/backfill-place-hits.js:30` select [payout_place_1, payout_place_2, race_id, rank1, rank2, rank3]
  - `scripts/maintenance/backfill-race-data.js:225` select [race_id, winning_technique]
  - `scripts/maintenance/backfill-rank456-from-kfile.js:75` select [race_id, rank1, rank2, rank3, rank4]
  - `scripts/maintenance/backfill-refund-hit-flags.js:77` select(helper:fetchAll)
  - `scripts/maintenance/backfill-results-by-race-id.js:52` select [payout_win, race_id, winning_technique]
  - `scripts/maintenance/backfill-start-timings.js:276` select [race_id, winning_technique]
  - `scripts/maintenance/backfill-trifecta-trio.js:19` select [*, race_id]
  - `scripts/maintenance/build-races-derived-backfill-sql.js:114` select(helper:fetchAll)
  - `scripts/maintenance/check-exhibition-gap-rate.js:40` select(helper:fetchAll)
  - `scripts/maintenance/check-result-shadow.js:160` select(helper:fetchByRaceIds)
  - `scripts/maintenance/delete-cancelled-race-predictions.js:55` select [race_id]
  - `scripts/maintenance/delete-phantom-race-days.js:62` select(helper:fetchAll)
  - `scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js:45` select(helper:fetchAll)
  - `scripts/maintenance/update-venue-stats.js:32` select(embed) [race_status, rank1]
  - `scripts/ml/export-training-data.js:206` select(helper:fetchAll)
  - `scripts/sns/rankDataMotor.js:65` select(helper:readAllIn)
  - `scripts/sns/rankDataVenue.js:37` select(helper:readAll)
  - `scripts/verification/verify-series-points-border.mjs:56` select [race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `scripts/verification/verify-series-points-needed.mjs:50` select [race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `scripts/verification/verify-series-points-official.mjs:164` select [race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `src/services/adminRuleService.js:42` select [payout_place_1, payout_place_2, payout_trifecta, payout_trio, payout_win, race_id, rank1, rank2, rank3]
  - `src/services/meetQueries.js:105` select [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `src/services/meetQueries2.js:128` select(helper:fetchAllByIn)
  - `src/services/meetQueries3.js:55` select [race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `src/services/motorQueries2.js:130` select [race_id, rank1, rank2, rank3]
  - `src/services/motorQueries2.js:358` select [race_id, race_status, rank1, rank2, rank3, rank4, rank5, rank6]
  - `src/services/motorQueries3.js:312` select [race_id, rank1]
  - `src/services/motorQueries5.js:53` select(helper:fetchAllByIn)
  - `src/services/raceQueries.js:84` select(helper:fetchAllByIn)
  - `src/services/raceQueries3.js:125` select [race_id, race_status, rank1, rank2, rank3, winning_technique]
  - `src/services/raceQueries3.js:255` select(helper:fetchAllByIn)
  - `src/services/raceQueries3.js:346` select(helper:fetchAllByIn)
  - `src/services/raceQueries4.js:29` select [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, race_id]
  - `src/services/racerQueries.js:150` select(helper:fetchAllByIn)
  - `src/services/racerQueries2.js:54` select(helper:fetchAllByIn)
  - `src/services/racerQueries2.js:188` select(helper:fetchAllByIn)
  - `src/services/racerQueries2.js:323` select(helper:fetchAllByIn)
  - `src/services/racerQueries3.js:37` select(helper:fetchAllByIn)
  - `src/services/ruleMatchService.js:146` select [payout_place_1, payout_place_2, payout_trifecta, payout_trio, payout_win, race_id, rank1, rank2, rank3]
  - `src/services/venueQueries2.js:57` select(helper:fetchAllByIn)
  - `src/services/venueQueries2.js:127` select(helper:fetchAllByIn)
- 書き手（10）: 
  - `scripts/daily/scrape-results.js:266` update [?]
  - `scripts/daily/scrape-results.js:416` update [rank4, rank5, rank6]
  - `scripts/lib/raceResultFix.js:117` update [?]
  - `scripts/lib/raceResultPersist.js:104` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-actual-course.js:111` update [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6]
  - `scripts/maintenance/backfill-kb-recent-results.js:351` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-race-data.js:195` update [winning_technique]
  - `scripts/maintenance/backfill-rank456-from-kfile.js:157` update [rank4, rank5, rank6]
  - `scripts/maintenance/backfill-start-timings.js:186` update [winning_technique]
  - `scripts/maintenance/migrate-to-supabase.js:284` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_series"></a>race_series

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_race_series, data_health_table_rows
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule.py:282`, `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:73`
- 読み手（15）: 
  - `api/_lib/botPage.js:276` rest(rest) [class_code, end_date, grade, kind, start_date, title, total_days, venue_code]
  - `api/_lib/botRace.js:212` rest(rest)
  - `scripts/lib/eveDeadlinesJob.js:66` select [end_date, start_date, venue_code]
  - `scripts/lib/motorPretestJob.js:197` select [end_date, start_date, venue_code]
  - `scripts/lib/raceSeriesLookup.js:161` select [end_date, start_date, venue_code]
  - `scripts/lib/snsTodayDigestV3.js:96` rest(rest) [end_date, grade, kind, start_date, title, venue_code]
  - `scripts/maintenance/backfill-race-series-meta.js:58` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:358` select(helper:fetchAll)
  - `scripts/maintenance/backfill-series-day.js:64` select(helper:fetchAll)
  - `scripts/maintenance/verify-bot-race-function.js:849` rest(rest) [class_code, end_date, grade, kind, start_date, title, total_days, venue_code] （検査）
  - `src/services/meetQueries3.js:35` select [class_code, end_date, grade, kind, start_date, title, total_days, venue_code]
  - `src/services/motorQueries7.js:21` select [end_date, start_date, venue_code]
  - `src/services/raceQueries2.js:254` select [end_date, start_date, venue_code]
  - `src/services/scheduleQueries.js:71` select [class_code, end_date, kind, start_date, total_days, venue_code]
  - `src/services/scheduleQueries.js:99` select [class_code, end_date, grade, kind, start_date, title, total_days, venue_code]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_special_notes"></a>race_special_notes

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: race_notices
- 読み手（1）: 
  - `scripts/daily/generate-morning-digest.js:482` select [category, detail_text, race_date, racer_id, venue_code]
- 書き手（1）: 
  - `scripts/daily/scrape-race-information.js:240` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: boat_number, structured_data, scraped_at

### <a id="t-race_start_timings"></a>race_start_timings

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: compute_st_course_baseline, data_health_coverage, data_health_table_rows, get_race_st_predictability, get_racer_accident_records
- 取得のジョブ: kfile_sync, race_status, result, result_catchup
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:11`, `scripts/lib/raceResultSchema.js:20`, `scripts/lib/raceResultSchema.js:35`, `scripts/maintenance/backfill-kb-gaps.js:80`, `scripts/maintenance/delete-phantom-races.js:76`, `scripts/maintenance/fix-opening-day-race-id-date.js:67`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:40`
- 読み手（28）: 
  - `scripts/analysis/full-picture-answer-stage/actual.cjs:10` select [boat_number, entry_course, finish_rank, is_flying, is_late_start, race_id, start_timing]
  - `scripts/analysis/original-exhibition/fetch.mjs:64` select(helper:all)
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:280` select [boat_number, finish_mark, is_flying, is_late_start, race_id, start_timing]
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:70` select(helper:fetchAllByRaceId)
  - `scripts/analysis/verify-race-analysis-rpc.js:74` select(helper:fetchAll)
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:169` select(helper:fetchInChunks)
  - `scripts/daily/generate-morning-digest.js:391` select [boat_number, finish_mark, race_id, start_timing]
  - `scripts/daily/scrape-results.js:467` select [?, boat_number, race_id]
  - `scripts/daily/update-top-start-stats.js:173` select(helper:fetchAll)
  - `scripts/lib/raceResultPersist.js:124` select(helper:upsertChangedRows)
  - `scripts/lib/racerStStats.js:152` select(helper:fetchAll)
  - `scripts/maintenance/audit-race-result-anomalies.js:107` select(helper:fetchAll)
  - `scripts/maintenance/backfill-disqualified-finish-marks.js:48` select(helper:fetchAll)
  - `scripts/maintenance/backfill-disqualified-finish-marks.js:71` select(helper:fetchAll)
  - `scripts/maintenance/backfill-start-timings.js:261` select [race_id]
  - `scripts/maintenance/check-result-shadow.js:166` select(helper:fetchByRaceIds)
  - `scripts/ml/export-training-data.js:211` select(helper:fetchAll)
  - `scripts/verification/verify-series-points-border.mjs:64` select [boat_number, finish_mark, race_id]
  - `scripts/verification/verify-series-points-needed.mjs:58` select [boat_number, finish_mark, race_id]
  - `src/services/meetQueries.js:79` select [boat_number, is_flying, race_id]
  - `src/services/meetQueries.js:111` select [boat_number, entry_course, finish_mark, race_id]
  - `src/services/meetQueries2.js:176` select [boat_number, finish_mark, is_flying, race_id, start_timing]
  - `src/services/raceQueries.js:97` select(helper:fetchAllByIn)
  - `src/services/raceQueries.js:233` select(helper:fetchAllByIn)
  - `src/services/raceQueries4.js:22` select [boat_number, entry_course, finish_mark, finish_rank, is_flying, is_late_start, race_id, start_timing]
  - `src/services/racerQueries2.js:194` select(helper:fetchAllByIn)
  - `src/services/racerQueries2.js:344` select(helper:fetchAllByIn)
  - `src/services/racerQueries3.js:113` select(helper:fetchAllByIn)
- 書き手（6）: 
  - `scripts/daily/scrape-results.js:537` upsert [?]
  - `scripts/lib/raceResultFix.js:125` upsert [?]
  - `scripts/lib/raceResultPersist.js:124` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-disqualified-finish-marks.js:212` update [?]
  - `scripts/maintenance/backfill-start-timings.js:173` upsert [?]
  - `scripts/maintenance/verify-race-result-parser.js:1675` upsert [?] （検査）
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_aggregated_stats"></a>racer_aggregated_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（12）: 
  - `api/_lib/racerEntryExhibition.js:188` rest(rest) [calculated_at, course_entry_tendency, racer_id, venue_code]
  - `scripts/analysis/aggregate-racer-stats.js:504` select(helper:upsertChangedRows)
  - `scripts/analysis/analyze-indicator-predictive-power.js:145` select [avg_st, course_race_counts, racer_id, venue_code]
  - `scripts/analysis/backtest-course-rate-only.js:92` select [course_race_counts, racer_id, venue_code]
  - `scripts/analysis/backtest-unified-model.js:126` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/analysis/calibrate-unified-model.js:162` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:105` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/analysis/verify-volatility-predictive-power.js:87` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/daily/generate-predictions.js:553` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/daily/generate-unified-predictions.js:112` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/daily/generate-unified-trifecta-reference.js:84` select [avg_st, course_race_counts, racer_id, venue_code]
  - `src/services/racerQueries.js:199` select [avg_st, avg_st_last_30, course_race_counts, flying_rate, racer_id, st_stddev, total_races, venue_code]
- 書き手（1）: 
  - `scripts/analysis/aggregate-racer-stats.js:504` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_course_technique_stats"></a>racer_course_technique_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: racer_course_technique_stats
- 読み手（4）: 
  - `scripts/daily/generate-morning-digest.js:222` select [*, course, racer_id]
  - `scripts/daily/generate-morning-digest.js:355` select [window_end]
  - `scripts/daily/update-racer-course-technique-stats.js:330` select(helper:upsertChangedRows)
  - `scripts/lib/snsTodayDigestV3.js:113` rest(rest) [course, makuri_rate, nigashi_rate, nige_rate, racer_id, runs, window_end, window_start]
- 書き手（1）: 
  - `scripts/daily/update-racer-course-technique-stats.js:330` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_grade_cache"></a>racer_grade_cache

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/sns/rank-data.js:75` select(helper:readAll)
  - `src/services/racerQueries.js:344` select [data, key]
- 書き手（1）: 
  - `scripts/daily/update-racer-grade-cache.js:46` upsert [data, key, updated_at]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_news"></a>racer_news

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: racer_news
- 読み手（3）: 
  - `scripts/generate-sitemap.js:465` select [created_at, racer_id]
  - `scripts/lib/racerNews/dedup.js:34` select [id, source_url]
  - `src/services/racerQueries5.js:60` select [created_at, id, published_at, racer_id, source_name, source_url, summary, title]
- 書き手（2）: 
  - `scripts/lib/racerNews/officialGradeAnnouncements.js:190` insert [published_at, racer_id, source_name, source_url, summary, title]
  - `scripts/maintenance/add-racer-news.js:49` insert [published_at, racer_id, source_name, source_url, summary, title]

### <a id="t-racer_news_pending"></a>racer_news_pending

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: racer_news
- 読み手（2）: 
  - `scripts/lib/racerNews/pendingReview.js:139` select [*, detected_at, id]
  - `scripts/lib/racerNews/pendingReview.js:153` select [id, source_url]
- 書き手（2）: 
  - `scripts/lib/racerNews/pendingReview.js:162` upsert [candidate, detected_at, id, reason, source, source_name, source_url, status]
  - `scripts/lib/racerNews/pendingReview.js:179` update [resolved_at, status]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_period_stats"></a>racer_period_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_racer_period_stats, data_health_table_rows
- 読み手（8）: 
  - `scripts/analysis/racer-period-stats/fetch-period-stats.mjs:9` select [*, period_no, period_year, racer_id]
  - `scripts/maintenance/verify-full-picture-scene2.js:2601` rest(rest) （検査）
  - `scripts/maintenance/verify-full-picture-scene2.js:3683` rest(rest) （検査）
  - `src/services/raceQueries2.js:270` select [avg_st, period_no, period_year, racer_id]
  - `src/services/racerQueries.js:227` select [avg_st, period_no, period_year, racer_id]
  - `src/services/racerQueries.js:266` select [?, period_no, period_year, racer_id]
  - `src/services/racerQueries4.js:71` select [avg_st, calc_from, calc_to, finals, period_no, period_year, racer_id, starts, top2_rate, win_rate, wins]
  - `src/services/racerQueries4.js:80` select [period_no, period_year, racer_id]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_profiles"></a>racer_profiles

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: racer_profiles
- 読み手（15）: 
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:95` select [racer_id]
  - `scripts/daily/scrape-race-information.js:157` select(helper:fetchAll)
  - `scripts/lib/racerNews/officialGradeAnnouncements.js:164` select [branch, name, racer_id]
  - `scripts/lib/racerProfileSync.js:329` select [?]
  - `scripts/maintenance/backfill-race-entries-racer-id.js:60` select(helper:fetchAllPaged)
  - `scripts/maintenance/fan-backfill-load.js:239` select [racer_id, sex, training_term]
  - `scripts/maintenance/fan-backfill-load.js:338` select(helper:fetchAll)
  - `scripts/maintenance/fix-opening-day-entries-from-b.js:312` select [hometown, name, racer_id]
  - `scripts/maintenance/restore-contaminated-race-entries.js:101` select(helper:fetchAll)
  - `scripts/maintenance/restore-entries-branch-hometown.js:62` select(helper:fetchAll)
  - `scripts/maintenance/verifyData/sns-x-delete-scenes-1.js:70` rest(rest)
  - `scripts/sns/delete-x-post.js:129` rest(rest) [name, racer_id]
  - `src/services/motorQueries4.js:176` select [name, racer_id]
  - `src/services/racerQueries.js:311` select [birth_date, branch, height_cm, hometown, name, name_kana, racer_id, registration_period, weight_kg]
  - `src/services/racerQueries5.js:31` select [birth_date, blood_type, branch, height_cm, hometown, name, name_kana, racer_id, registration_period, weight_kg]
- 書き手（3）: 
  - `scripts/lib/racerProfileSync.js:273` update [?]
  - `scripts/lib/racerProfileSync.js:291` upsert [birth_date, blood_type, branch, grade_at_scrape, height_cm, hometown, name, name_kana, racer_id, registration_period, weight_kg]
  - `scripts/maintenance/fan-backfill-load.js:259` update [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_series_points"></a>racer_series_points

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness, data_health_table_rows
- 取得のジョブ: point_rank
- 読み手（5）: 
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:76` select [meet_start_date, penalty_points, racer_id, rank, remarks, score_rate, total_points, venue_code]
  - `scripts/verification/verify-series-points-official.mjs:46` select [meet_start_date, penalty_points, placements, player_name, racer_id, rank, remarks, score_rate, total_points, venue_code]
  - `scripts/verification/verify-series-points-official.mjs:135` select [meet_start_date, racer_id, venue_code]
  - `src/services/meetQueries2.js:193` select [meet_start_date, penalty_points, placements, racer_id, remarks, scraped_at, total_points, venue_code]
  - `src/services/meetQueries3.js:65` select [meet_start_date, scraped_at, venue_code]
- 書き手（1）: 
  - `scripts/daily/scrape-point-rank.js:399` upsert(helper:upsertWithOptionalColumns) [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, grade, next_race_1, next_race_2, next_series_day

### <a id="t-races"></a>races

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_prediction_performance, v_todays_recommendations
- 本体で読む RPC: claim_scrape_slots, claim_scrape_slots_by_offset, compute_nige_second_by_course, compute_racer_course_technique_stats, compute_st_course_baseline, compute_today_course_win_stats, compute_venue_course_entry_baseline, compute_venue_course_technique_baseline, data_health_cancellation_with_result, data_health_coverage, data_health_entries_duplicates, data_health_monthly_result, data_health_morning_freshness, data_health_nightly_freshness, data_health_pit_reports, data_health_pre_race_fields, data_health_race_series, data_health_racer_period_stats, data_health_table_rows, ensure_scrape_slots, get_predictions_by_date, get_predictions_by_date_light, get_race_history_summary, get_today_races, update_venue_stats
- 取得のジョブ: exhibition, kfile_sync, race_info, race_status, races_init, result, result_catchup
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-fr2-holdout.py:340`, `scripts/analysis/analogy-finder-fr2-strat/features_prod.py:169`, `scripts/analysis/analogy-finder-fr2-strat/features_prod.py:348`, `scripts/analysis/analogy-finder-fr2-strat/features_prod.py:354`, `scripts/analysis/analogy-finder-phase-m/build_dataset.py:127`, `scripts/analysis/analogy-finder-phase-m/build_dataset.py:280`, `scripts/analysis/analogy-finder-phase-m/build_dataset.py:294`, `scripts/analysis/analogy-finder-phase-m/md3_odds.py:94`, `scripts/analysis/analogy-finder-phase-m/md3_odds_v2.py:235`, `scripts/analysis/analogy-finder-t1/t1_1_stage_rule.py:263`, `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:74`, `scripts/analysis/analogy-finder-t1/t1_2_series_runs.py:133`, `scripts/analysis/analogy-finder-t1/t1_2_series_runs.py:157`, `scripts/analysis/analogy-finder-t1/t1_2_series_runs.py:159`, `scripts/analysis/analogy-finder-t1/t1_4_hint_threshold.py:108`, `scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py:112`, `scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py:173`, `scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py:198`, `scripts/analysis/analogy-finder-v16/t2_4_rerank_agreement.py:88`, `scripts/analysis/boa845-axis-place/build_pool.py:47`, `scripts/analysis/boa845-axis-place/common.py:98`, `scripts/analysis/boa845-axis-place/common.py:105`, `scripts/analysis/boa845-axis-place/common.py:110`, `scripts/analysis/boa845-axis-place/display.py:58`, `scripts/analysis/boa845-axis-place/mark_rule.py:82`, `scripts/analysis/boa845-axis-place/today_counts.py:42`, `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:6`, `scripts/analysis/in-collapse-caution/round2/c2_rebuild.py:25`, `scripts/analysis/in-collapse-caution/round3/c2_round3.py:29`, `scripts/analysis/in-collapse-caution/round4/sparse_cells.py:29`, `scripts/analysis/in-collapse-caution/round4/sparse_cells.py:56`, `scripts/analysis/original-exhibition/analyze.py:87`, `scripts/analysis/original-exhibition/analyze.py:92`, `scripts/analysis/original-exhibition/analyze.py:93`, `scripts/analysis/original-exhibition/analyze.py:105`, `scripts/analysis/original-exhibition/analyze2.py:11`, `scripts/analysis/original-exhibition/analyze4.py:86`, `scripts/analysis/original-exhibition/analyze4.py:100`, `scripts/analysis/original-exhibition/analyze4.py:141`, `scripts/analysis/original-exhibition/analyze4.py:152`, `scripts/analysis/original-exhibition/analyze4.py:165`, `scripts/analysis/original-exhibition/build.py:6`, `scripts/analysis/original-exhibition/forecast-slit.py:24`, `scripts/analysis/original-exhibition/forecast-slit.py:27`, `scripts/analysis/past-rate-check/label-threshold.py:142`, `scripts/analysis/past-rate-check/label-threshold.py:443`, `scripts/analysis/past-rate-check/slit-pattern-rates.py:76`, `scripts/analysis/past-rate-check/slit-pattern-rates.py:90`, `scripts/maintenance/delete-phantom-races.js:89`, `scripts/ml/analogy/features.py:303`, `scripts/ml/analogy/features.py:540`, `scripts/ml/analogy/features.py:546`, `scripts/ml/analogy/make_treeshap_testdata.py:219`, `scripts/ml/analogy/perrace.py:159`, `scripts/ml/analogy/tests/test_in_caution_bands.py:100`, `scripts/ml/analogy/tests/test_perrace.py:110`, `scripts/ml/analogy/tests/test_v16_pool.py:107`, `scripts/ml/analogy/tests/test_v16_scenario.py:56`, `scripts/ml/analogy/tests/test_v16_scenario.py:59`, `scripts/ml/analogy/tests/test_v16_scenario.py:64`, `scripts/ml/analogy/v16_history.py:53`, `scripts/ml/analogy/v16_morning.py:289`, `scripts/ml/analogy/v16_morning.py:373`, `scripts/ml/analogy/v16_pool.py:74`, `scripts/ml/analogy/v16_scenario.py:69`
- 読み手（156）: 
  - `api/_lib/analogyV16.js:101` rest(rest) [race_date, race_id, start_time, venue_code]
  - `api/_lib/racerEntryExhibition.js:196` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `api/_lib/snsClaimCheckReaders.js:44` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `api/_lib/snsClaimCheckReaders.js:234` rest(rest) [cancellation_status, race_id]
  - `api/_lib/snsClaimCheckReaders.js:320` rest(rest) [cancellation_status, race_id]
  - `api/_lib/snsTodayDigest.js:50` rest(rest) [cancellation_status, race_id, start_time]
  - `api/odds/live.js:72` select [race_date, race_id, start_time]
  - `scripts/analysis/analyze-upset-factors.js:81` select [first_boat_motor_2rate, first_boat_win_rate, motor_2rate_stddev, race_date, race_id, venue_code, volatility_level, volatility_score, win_rate_stddev]
  - `scripts/analysis/backtest-unified-model.js:109` select [race_id, venue_code]
  - `scripts/analysis/boa845-axis-place/fetch_today.mjs:32` select(helper:all)
  - `scripts/analysis/calibrate-unified-model.js:145` select [race_id, venue_code]
  - `scripts/analysis/original-exhibition/fetch.mjs:54` select(helper:all)
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:78` select [cancellation_status, race_date, race_id, start_time]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:142` select [race_date, race_id, start_time]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:284` select [cancellation_status, race_id]
  - `scripts/analysis/race-stage-inventory.mjs:36` select(helper:fetchAllByRaceId)
  - `scripts/analysis/redesign-volatility-by-venue.js:135` select [first_boat_avg_st, first_boat_motor_2rate, first_boat_win_rate, race_date, race_id, venue_code, volatility_score, win_rate_stddev]
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:93` select [first_boat_grade, first_boat_win_rate, race_date, race_grade, race_id, race_number, venue_code, volatility_level, volatility_score]
  - `scripts/analysis/verify-all-venues-label-accuracy.js:67` select [race_date, race_id, venue_code, volatility_score]
  - `scripts/analysis/verify-calculations.js:7` select [race_date, race_id]
  - `scripts/analysis/verify-label-accuracy.js:76` select [race_date, race_id, venue_code, volatility_score]
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:79` select [race_date]
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:83` select [race_id, venue_code]
  - `scripts/analysis/verify-volatility-predictive-power.js:65` select [race_id, venue_code]
  - `scripts/daily/calculate-accuracy.js:85` select(helper:fetchAll)
  - `scripts/daily/calculate-venue-grade-stats.js:176` select [race_date, race_grade, race_id, venue_code]
  - `scripts/daily/generate-morning-digest.js:130` select [race_date, race_grade, race_id, race_number, start_time, venue_code]
  - `scripts/daily/generate-predictions.js:971` select(helper:upsertChangedRows)
  - `scripts/daily/generate-predictions.js:1302` select(helper:selectByRaceIds)
  - `scripts/daily/generate-predictions.js:1420` select(helper:filterUnchangedRows)
  - `scripts/daily/morning-init.js:86` select [race_id, venue_code]
  - `scripts/daily/morning-init.js:173` select [*, race_id]
  - `scripts/daily/morning-init.js:221` select [race_id, updated_at]
  - `scripts/daily/morning-init.js:391` select [*, race_id]
  - `scripts/daily/scrape-point-rank.js:150` select [cancellation_status, race_grade, race_id]
  - `scripts/daily/scrape-results.js:667` select [cancellation_status, race_id]
  - `scripts/daily/scrape-results.js:731` select [cancellation_status, race_id]
  - `scripts/daily/scrape-results.js:789` select [cancellation_status, race_date, race_id]
  - `scripts/daily/scrape-results.js:947` select [race_date, race_id, race_number, venue_code]
  - `scripts/daily/todays-volatility-digest.js:148` select [cancellation_status, race_date, race_id]
  - `scripts/daily/update-moriarty-outcomes.js:59` select [race_id, venue_code]
  - `scripts/daily/update-outcome-frequencies.js:43` select [race_id, venue_code]
  - `scripts/daily/update-race-history-cache.js:112` select(helper:fetchAll)
  - `scripts/daily/update-race-info.js:70` select [cancellation_check_streak, cancellation_status, race_grade, race_id]
  - `scripts/generate-sitemap.js:379` select [race_date, venue_code]
  - `scripts/generate-sitemap.js:662` select [race_date, venue_code]
  - `scripts/lib/analogyDispatch.js:75` select [cancellation_status, race_date, race_id, start_time]
  - `scripts/lib/analogyV16Exhibition.js:253` rest(rest) [race_date, race_id, start_time]
  - `scripts/lib/boatcast/oritenJob.js:280` select [race_date, race_id, start_time]
  - `scripts/lib/boatcast/oritenJobParts.js:162` select [race_date, race_id, start_time]
  - `scripts/lib/dailyReconcileJob.js:91` select(helper:fetchAll)
  - `scripts/lib/eveDeadlinesJob.js:387` select [race_date, race_id, start_time]
  - `scripts/lib/inCautionHealth.js:137` select [cancellation_status, race_id]
  - `scripts/lib/motorPretestRows.js:112` select [cancellation_status, race_date, race_id, venue_code]
  - `scripts/lib/pitReportJob.js:290` select [race_date, race_grade, race_id, race_number, start_time]
  - `scripts/lib/pitReportJob.js:365` select [race_date, race_grade, race_id, race_number, start_time]
  - `scripts/lib/raceResultRun.js:278` select [race_id, start_time]
  - `scripts/lib/raceSchedule.js:44` select [race_id, start_time]
  - `scripts/lib/raceSeriesLookup.js:174` select [cancellation_status, race_date, venue_code]
  - `scripts/lib/raceStatusJob.js:93` select [cancellation_status, race_date, race_id, race_number, venue_code]
  - `scripts/lib/racesInit/job.js:106` select(helper:fetchAll)
  - `scripts/lib/scrapeJobs/monitor.js:809` select [race_date, race_id]
  - `scripts/lib/scrapeJobs/pcexpectHandlers.js:33` select [race_id, start_time]
  - `scripts/lib/scrapeJobs/resultHandlerParts.js:61` select(embed) [cancellation_status]
  - `scripts/lib/scrapeJobs/resultHandlerParts.js:71` select [race_date, race_id, start_time]
  - `scripts/lib/scrapeJobs/resultHandlers.js:167` select [race_date, race_id, start_time]
  - `scripts/lib/snsAutoPlanRunnerStore.js:55` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `scripts/lib/snsTodayDigestV3.js:81` rest(rest) [cancellation_status, race_date, race_grade, race_id, race_number, start_time, venue_code]
  - `scripts/lib/snsTodayDigestV3.js:126` rest(rest) [cancellation_status, race_date, venue_code]
  - `scripts/maintenance/audit-missing-results.js:67` select(helper:fetchAll)
  - `scripts/maintenance/backfill-exhibition-by-race-id.js:35` select [race_id, race_number, venue_code]
  - `scripts/maintenance/backfill-kb-gaps.js:103` select(helper:read)
  - `scripts/maintenance/backfill-kb-gaps.js:113` select(helper:read)
  - `scripts/maintenance/backfill-kb-gaps.js:125` select(helper:read)
  - `scripts/maintenance/backfill-kb-recent-results.js:119` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:145` select(helper:fetchAll)
  - `scripts/maintenance/backfill-missing-venue-day.js:68` select [race_date, race_id, race_number, venue_code]
  - `scripts/maintenance/backfill-missing-venue-day.js:111` select [race_date, race_id, venue_code]
  - `scripts/maintenance/backfill-missing-venue-day.js:126` select [cancellation_status, race_id]
  - `scripts/maintenance/backfill-opening-day-races.js:94` select(helper:count)
  - `scripts/maintenance/backfill-opening-day-races.js:147` select(helper:upsertChangedRows)
  - `scripts/maintenance/backfill-pit-reports.js:123` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-conditions.js:70` select [cancellation_status, race_id]
  - `scripts/maintenance/backfill-race-data.js:275` select [race_date, race_id, race_number, venue_code]
  - `scripts/maintenance/backfill-race-series-meta.js:91` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:173` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:313` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:348` select(helper:fetchAll)
  - `scripts/maintenance/backfill-racer-ids.js:128` select(embed) [race_date, race_number, venue_code]
  - `scripts/maintenance/backfill-results-by-race-id.js:37` select [cancellation_check_streak, cancellation_status, race_id, race_number, venue_code]
  - `scripts/maintenance/backfill-series-day.js:46` select(helper:fetchAll)
  - `scripts/maintenance/backfill-series-day.js:85` select(helper:fetchAll)
  - `scripts/maintenance/backfill-start-timings.js:223` select [race_date, race_id, race_number, venue_code]
  - `scripts/maintenance/build-races-derived-backfill-sql.js:106` select(helper:fetchAll)
  - `scripts/maintenance/check-exhibition-gap-rate.js:39` select(helper:fetchAll)
  - `scripts/maintenance/check-morning-init-shadow.js:113` select [cancellation_status, race_id, start_time]
  - `scripts/maintenance/check-morning-init-shadow.js:279` select(embed) [cancellation_status, start_time]
  - `scripts/maintenance/check-odds-shadow.js:142` select(embed) [cancellation_status, start_time]
  - `scripts/maintenance/check-pre-race-shadow.js:255` select(embed) [cancellation_status, start_time]
  - `scripts/maintenance/check-pre-race-shadow.js:293` select(helper:fetchByRaceIds)
  - `scripts/maintenance/check-result-shadow.js:129` select(embed) [cancellation_status, start_time]
  - `scripts/maintenance/delete-cancelled-race-predictions.js:40` select(helper:fetchAll)
  - `scripts/maintenance/delete-phantom-race-days.js:56` select(helper:fetchAll)
  - `scripts/maintenance/delete-phantom-race-days.js:103` select [race_date, race_id, race_number, venue_code]
  - `scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js:39` select(helper:fetchAll)
  - `scripts/maintenance/fix-opening-day-entries-from-b.js:302` select(helper:fetchAll)
  - `scripts/maintenance/fix-opening-day-race-id-date.js:98` select [*, race_id]
  - `scripts/maintenance/fix-opening-day-race-id-date.js:191` select [race_id]
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:71` select [*, race_date, race_id, venue_code]
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:122` select [race_id]
  - `scripts/maintenance/motor-pretest-backfill-fetch.js:72` select [race_date, race_number, venue_code]
  - `scripts/maintenance/update-venue-stats.js:32` select [race_date, race_id, venue_code]
  - `scripts/maintenance/verify-analogy-v16.js:276` rest(rest) [cancellation_status, race_date, race_id, start_time] （検査）
  - `scripts/maintenance/verify-data-readers.js:557` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-live-api-key.js:32` rest(rest) [*] （検査）
  - `scripts/maintenance/verify-e2e-live-api-key.js:33` rest(rest) （検査）
  - `scripts/maintenance/verify-pretest-row-pick.js:93` select [race_date, race_id, venue_code] （検査）
  - `scripts/maintenance/verify-pretest-row-pick.js:128` select [race_date, venue_code] （検査）
  - `scripts/maintenance/verify-rpc-output-keys.js:266` select [race_date] （検査）
  - `scripts/maintenance/verify-rpc-output-keys.js:321` select [race_date, venue_code] （検査）
  - `scripts/maintenance/verify-scrape-slots-on-db.js:69` select [cancellation_status, race_date, race_id, start_time] （検査）
  - `scripts/maintenance/verify-sns-auto-plan.js:615` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-sns-setsu-kiryoku-short.js:1577` rest(rest) [race_id, start_time] （検査）
  - `scripts/maintenance/verifyData/sns-today-plan-v3-race-db.js:101` rest(rest) [race_date]
  - `scripts/maintenance/verifyData/sns-today-plan-v3-race-db.js:102` rest(rest) [cancellation_status]
  - `scripts/maintenance/verifyData/sns-today-plan-v3-race-db.js:103` rest(rest) [race_id]
  - `scripts/maintenance/verifyData/unchanged-rows-scenes-2.js:193` select(helper:filterUnchangedRows)
  - `scripts/ml/export-inference-data.js:80` select(helper:fetchAll)
  - `scripts/ml/export-training-data.js:186` select(helper:fetchAll)
  - `scripts/sns/pushFinalsImageStore.js:71` rest(rest) [cancellation_status, race_date, race_grade, race_id, race_number, start_time]
  - `scripts/sns/pushFinalsImageStore.js:77` rest(rest) [race_date, race_grade, race_id, race_number, start_time]
  - `scripts/sns/pushFullPictureStore.js:43` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:118` rest(rest) [cancellation_status, race_id, start_time]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:195` rest(rest) [race_id, start_time]
  - `scripts/sns/rankDataMotor.js:45` select(helper:readAll)
  - `scripts/sns/rankDataVenue.js:30` select(helper:readAll)
  - `scripts/sns/today-picks.js:106` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `src/services/meetQueries.js:115` select [cancellation_status, race_id]
  - `src/services/meetQueries2.js:137` select(helper:fetchAllByIn)
  - `src/services/meetQueries3.js:50` select [cancellation_status, race_grade, race_id]
  - `src/services/motorQueries.js:112` select [race_date, race_id, venue_code]
  - `src/services/motorQueries3.js:285` select(embed) [venue_code]
  - `src/services/mycroftService.js:79` select [race_date, race_id, race_number, start_time, venue_code]
  - `src/services/poirotService.js:49` select [race_date, race_id, race_number, start_time, venue_code]
  - `src/services/racerQueries2.js:53` select(helper:fetchAllByIn)
  - `src/services/racerQueries2.js:182` select(helper:fetchAllByIn)
  - `src/services/racerQueries2.js:317` select(helper:fetchAllByIn)
  - `src/services/racerQueries3.js:252` select [race_date, race_id, race_number, venue_code]
  - `src/services/ruleMatchService.js:158` select [race_id, start_time]
  - `src/services/scheduleQueries.js:134` select [race_date]
  - `src/services/scheduleQueries.js:214` select [race_date, venue_code]
  - `src/services/scheduleQueries.js:238` select [race_date, race_id, race_number, start_time, venue_code]
  - `src/services/sherlockService.js:66` select [race_date, race_id, race_number, start_time, venue_code]
  - `src/services/venueQueries2.js:44` select [race_date, race_id, venue_code]
  - `src/services/venueQueries2.js:117` select [race_date, race_id, venue_code]
  - `src/services/watsonService.js:72` select [race_date, race_id, race_number, start_time, venue_code]
- 書き手（18）: 
  - `scripts/daily/generate-predictions.js:971` upsert(helper:upsertChangedRows) [?]
  - `scripts/daily/generate-predictions.js:1652` update [?]
  - `scripts/daily/scrape-results.js:697` update [cancellation_status]
  - `scripts/daily/scrape-results.js:758` update [cancellation_check_streak, cancellation_status]
  - `scripts/lib/raceInfoWrite.js:18` update [?]
  - `scripts/maintenance/audit-missing-results.js:252` update [cancellation_status]
  - `scripts/maintenance/backfill-missing-venue-day.js:184` update [cancellation_status]
  - `scripts/maintenance/backfill-opening-day-races.js:147` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-race-series-meta.js:147` upsert [?]
  - `scripts/maintenance/delete-phantom-race-days.js:253` delete
  - `scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js:114` update [cancellation_status]
  - `scripts/maintenance/fix-opening-day-race-id-date.js:202` update [race_number]
  - `scripts/maintenance/fix-opening-day-race-id-date.js:225` insert [?]
  - `scripts/maintenance/fix-opening-day-race-id-date.js:333` delete
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:130` update [race_number]
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:152` insert [?]
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:247` delete
  - `scripts/maintenance/migrate-to-supabase.js:249` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-raw_snapshots"></a>raw_snapshots

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: fan_period
- 読み手（0）: なし
- 書き手（1）: 
  - `scripts/lib/fanPeriodJob.js:116` upsert [bytes, key, page_type, parser_version, run, sha256, storage_path]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, captured_at, storage_path, bytes, parser_version, run

### <a id="t-rule_applications"></a>rule_applications

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（1）: 
  - `scripts/daily-rule-tracking.js:163` select [race_id, rule_id]
- 書き手（2）: 
  - `scripts/daily-rule-tracking.js:216` insert [?]
  - `scripts/daily-rule-tracking.js:229` update [is_hit, payout]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, bet_amount, is_hit, payout, created_at, updated_at

### <a id="t-scrape_job_state"></a>scrape_job_state

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で書く RPC: scrape_breaker_open
- 取得のジョブ: analogy_dispatch_morning, analogy_dispatch_train, analogy_v16_exhibition, boatcast_motor_start, boatcast_oriten, daily_reconcile, data_health, data_health_morning, db_apply_dispatch, e2e_rerecord_dispatch, entry_course_stats, eve_deadlines, eve_deadlines_reconcile, exhibition, fan_period, in_caution_dispatch, in_caution_health, in_caution_today_health, key_canary_dispatch, kfile_sync, morning_digest, motor_pretest, odds, odds_final, outcome_distribution_update, pcexpect, pit_reports, point_rank, pseudo, race_info, race_notices, race_series, race_status, racer_career_main, racer_course_technique_stats, racer_news, racer_profiles, races_init, release_dispatch, result, result_catchup, scrape-cleanup, scrape-monitor, sns_auto_plan, sns_daily, sns_metrics, sns_send, venue_motor_stats
- 読み手（13）: 
  - `scripts/lib/dataHealth/job.js:98` select [job, last_report]
  - `scripts/lib/eveDeadlinesJob.js:362` select [job, last_target_date]
  - `scripts/lib/ghaSkipGate.js:450` rest(rest)
  - `scripts/lib/motorPretestJob.js:176` select [job, last_target_date, mode]
  - `scripts/lib/racesInit/job.js:132` select [job, mode]
  - `scripts/lib/racesInit/predictCodeCheck.js:86` select [job, last_report]
  - `scripts/lib/scrapeJobs/monitor.js:777` select [*]
  - `scripts/lib/scrapeJobs/store.js:86` select [*, job]
  - `scripts/lib/scrapeJobs/store.js:286` select [?, job]
  - `scripts/maintenance/check-morning-init-shadow.js:197` select [consecutive_failures, cursor, job, last_error, last_success_at, mode]
  - `scripts/maintenance/check-scrape-monitor-liveness.js:139` select [consecutive_failures, job, last_error, last_success_at, last_target_date, last_tick_at, mode]
  - `scripts/maintenance/verify-gha-skip-gate.js:1354` rest(rest) （検査）
  - `scripts/sns/pushResearchImageStore.js:61` rest(rest) [job, last_report]
- 書き手（14）: 
  - `scripts/lib/boatcast/oritenJobParts.js:203` update [last_report]
  - `scripts/lib/racesInit/job.js:364` update [cursor, last_report]
  - `scripts/lib/racesInit/predictCodeCheck.js:98` upsert [job, last_report, updated_at]
  - `scripts/lib/racesInit/predictCodeCheck.js:116` update [last_report, updated_at]
  - `scripts/lib/racesInit/predictCodeCheck.js:138` update [last_report, updated_at]
  - `scripts/lib/scrapeJobs/store.js:102` upsert [job]
  - `scripts/lib/scrapeJobs/store.js:110` update [last_tick_at]
  - `scripts/lib/scrapeJobs/store.js:129` update [?]
  - `scripts/lib/scrapeJobs/store.js:135` update [consecutive_failures, last_error, updated_at]
  - `scripts/lib/scrapeJobs/store.js:147` update [claimed_by, lease_until]
  - `scripts/lib/scrapeJobs/store.js:161` update [claimed_by, lease_until]
  - `scripts/lib/scrapeJobs/store.js:318` update [breaker_open_until, updated_at]
  - `scripts/lib/scrapeJobs/store.js:368` upsert [?]
  - `scripts/lib/scrapeJobs/store.js:398` update [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-scrape_slots"></a>scrape_slots

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: claim_scrape_slots, claim_scrape_slots_by_offset
- 本体で書く RPC: claim_scrape_slots, claim_scrape_slots_by_offset, ensure_scrape_slots
- 取得のジョブ: analogy_dispatch_morning, analogy_dispatch_train, analogy_v16_exhibition, boatcast_motor_start, boatcast_oriten, daily_reconcile, data_health, data_health_morning, db_apply_dispatch, e2e_rerecord_dispatch, entry_course_stats, eve_deadlines, eve_deadlines_reconcile, exhibition, fan_period, in_caution_dispatch, in_caution_health, in_caution_today_health, key_canary_dispatch, kfile_sync, morning_digest, motor_pretest, odds, odds_final, outcome_distribution_update, pcexpect, pit_reports, point_rank, pseudo, race_info, race_notices, race_series, race_status, racer_career_main, racer_course_technique_stats, racer_news, racer_profiles, races_init, release_dispatch, result, result_catchup, scrape-cleanup, scrape-monitor, sns_auto_plan, sns_daily, sns_metrics, sns_send, venue_motor_stats
- 読み手（10）: 
  - `scripts/lib/boatcast/oritenJob.js:253` select [job, outcome, race_date, race_id, status]
  - `scripts/lib/boatcast/oritenJobParts.js:172` select [job, race_date, race_id]
  - `scripts/lib/scrapeJobs/monitor.js:787` select [?]
  - `scripts/lib/scrapeJobs/resultHandlerParts.js:61` select [job, race_date, race_id]
  - `scripts/lib/scrapeJobs/resultHandlerParts.js:81` select [job, race_date, race_id, status]
  - `scripts/maintenance/check-morning-init-shadow.js:279` select [attempts, done_at, job, last_error, offset_min, outcome, race_date, race_id, result_digest, run_mode, status]
  - `scripts/maintenance/check-odds-shadow.js:142` select [attempts, done_at, job, last_error, offset_min, outcome, race_date, race_id, result_digest, run_mode, status]
  - `scripts/maintenance/check-pre-race-shadow.js:255` select [attempts, done_at, first_attempt_at, job, last_error, offset_min, outcome, race_date, race_id, result_digest, rows_written, run_mode, status]
  - `scripts/maintenance/check-result-shadow.js:129` select [attempts, done_at, job, last_error, offset_min, outcome, race_date, race_id, result_digest, run_mode, status]
  - `scripts/maintenance/verify-scrape-slots-on-db.js:198` select [attempts, job, status] （検査）
- 書き手（9）: 
  - `scripts/lib/boatcast/oritenJobParts.js:188` upsert [?]
  - `scripts/lib/pitReportJob.js:400` upsert [?]
  - `scripts/lib/scrapeJobs/cleanup.js:33` update [last_error, lease_until, next_attempt_at, status]
  - `scripts/lib/scrapeJobs/cleanup.js:52` delete
  - `scripts/lib/scrapeJobs/store.js:233` update [done_at, last_error, lease_until, outcome, result_digest, rows_written, status]
  - `scripts/lib/scrapeJobs/store.js:269` update [?]
  - `scripts/maintenance/verify-scrape-slots-on-db.js:124` delete （検査）
  - `scripts/maintenance/verify-scrape-slots-on-db.js:174` update [done_at, outcome, status] （検査）
  - `scripts/maintenance/verify-scrape-slots-on-db.js:211` delete （検査）
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_approvers"></a>sns_approvers

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: approve_sns_x_send
- 読み手（2）: 
  - `api/admin/sns-hub/approvers/index.js:47` select(rest) [display_name, id]
  - `api/admin/sns-hub/drafts/index.js:43` select(embed) [display_name]
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: active, created_at

### <a id="t-sns_auto_send_control"></a>sns_auto_send_control

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: approve_sns_x_send, transition_sns_send_139, transition_sns_x_send
- 写しに無い列の名前（埋め込みの別名・JSON のキー・誤りのどれか）: setsu_kiryoku_short_enabled, today_thinking_enabled, upset_win_short_enabled
- 読み手（18）: 
  - `api/_lib/snsClaimCheckReaders.js:108` rest(rest) [channel, finals_image_enabled]
  - `api/_lib/snsClaimCheckReaders.js:152` rest(rest) [channel]
  - `api/_lib/snsClaimCheckReaders.js:205` rest(rest) [channel, today_thinking_enabled]
  - `api/_lib/snsClaimCheckReaders.js:272` rest(rest) [channel, setsu_kiryoku_short_enabled]
  - `api/_lib/snsClaimCheckReaders.js:318` rest(rest) [channel, upset_win_short_enabled]
  - `api/_lib/snsXSendStore.js:152` rest(rest) [channel, dry_run, mode]
  - `scripts/lib/snsAutoPlanRunnerStore.js:77` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/lib/snsSendRunner.js:206` rest(rest) [channel, dry_run, mode]
  - `scripts/lib/snsTodayPlannerStore.js:106` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/sns/push-upset-win-short.js:103` rest(rest) [auto_approver_id, channel, dry_run, mode, upset_win_short_enabled]
  - `scripts/sns/push-upset-win-short.js:115` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/sns/pushFinalsImageStore.js:48` rest(rest)
  - `scripts/sns/pushFinalsImageStore.js:59` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/sns/pushFullPictureStore.js:50` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/sns/pushResearchImageStore.js:26` rest(rest)
  - `scripts/sns/pushResearchImageStore.js:34` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:56` rest(rest) [auto_approver_id, channel, dry_run, mode, setsu_kiryoku_short_enabled]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:69` rest(rest) [auto_approver_id, channel, dry_run, mode]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_auto_send_incidents"></a>sns_auto_send_incidents

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, item_id, channel, note, recorded_at

### <a id="t-sns_auto_send_items"></a>sns_auto_send_items

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: approve_sns_x_send, sns_bundle_send_allowed, sns_x_slot_room, stop_sns_auto_item, transition_sns_send_139, transition_sns_x_send
- 本体で書く RPC: stop_sns_auto_item, transition_sns_x_send
- 取得のジョブ: sns_auto_plan
- 読み手（19）: 
  - `api/_lib/snsClaimCheckReaders.js:106` rest(rest) [id, kind, race_id, state, variant]
  - `api/_lib/snsClaimCheckReaders.js:148` rest(rest) [draft_id, kind, race_id]
  - `api/_lib/snsClaimCheckReaders.js:150` rest(rest) [channel, id, kind, race_id, state]
  - `api/_lib/snsClaimCheckReaders.js:200` rest(rest) [draft_id, kind, race_id, variant]
  - `api/_lib/snsClaimCheckReaders.js:203` rest(rest) [id, kind, race_id, state, variant]
  - `api/_lib/snsClaimCheckReaders.js:266` rest(rest) [draft_id, kind, race_id, variant]
  - `api/_lib/snsClaimCheckReaders.js:269` rest(rest) [channel, id, kind, race_id, state, variant]
  - `api/_lib/snsClaimCheckReaders.js:313` rest(rest) [draft_id, kind, race_id]
  - `api/_lib/snsClaimCheckReaders.js:315` rest(rest) [channel, id, kind, race_id, state]
  - `scripts/lib/snsAutoPlanRunnerStore.js:64` rest(rest) [*, race_id]
  - `scripts/lib/snsTodayPlannerStore.js:48` rest(rest) [draft_id, id, kind, race_id, state]
  - `scripts/maintenance/verify-sns-auto-plan.js:621` rest(rest) [id, state] （検査）
  - `scripts/maintenance/verify-sns-today-plan.js:745` rest(rest) [kind, race_id] （検査）
  - `scripts/sns/push-upset-win-short.js:122` rest(rest) [channel, created_at, draft_id, held_reason, id, kind, race_id, state]
  - `scripts/sns/pushFinalsImageStore.js:88` rest(rest) [created_at, draft_id, id, kind, race_id, state, variant]
  - `scripts/sns/pushFullPictureStore.js:109` rest(rest) [channel, deadline_at, draft_id, id, kind, race_id, state, variant]
  - `scripts/sns/pushResearchImageStore.js:57` rest(rest) [channel, created_at, draft_id, held_reason, id, kind, race_id, state]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:82` rest(rest) [draft_id, id, race_id, state]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:161` rest(rest) [channel, created_at, draft_id, held_reason, id, kind, race_id, state, variant]
- 書き手（4）: 
  - `scripts/lib/snsAutoPlanRunnerStore.js:102` update(rest) [?]
  - `scripts/lib/snsTodayPlannerStore.js:115` update(rest) [?]
  - `scripts/sns/pushFinalsImageStore.js:174` update(rest) [?]
  - `scripts/sns/pushFullPictureStore.js:94` update(rest) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_bundle_imports"></a>sns_bundle_imports

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: guard_sns_preview_bundle_draft, import_sns_preview_bundle, sns_bundle_send_allowed
- 本体で書く RPC: import_sns_preview_bundle
- 読み手（2）: 
  - `api/_lib/snsClaimCheck.js:177` select(embed) [bundle, schema_version]
  - `scripts/lib/snsAutoPlanRunnerStore.js:45` rest(rest) [bundle, created_at, id, qa, schema_version]
- 書き手（0）: なし

### <a id="t-sns_campaign_entries"></a>sns_campaign_entries

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/delete-phantom-races.js:78`, `scripts/maintenance/fix-opening-day-race-id-date.js:76`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:49`
- 読み手（0）: なし
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_campaigns"></a>sns_campaigns

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, name, purpose, persona, tone_spec, start_date, duration_days, target_channels, tiktok_decision_note, selection_criteria, purchase_amount_yen, status, created_at

### <a id="t-sns_channel_daily"></a>sns_channel_daily

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: sns_daily
- 読み手（1）: 
  - `scripts/lib/snsDailyRunnerStore.js:77` rest(rest) [channel, day, definition, draft_id, id, metric_name, metric_value, missing_reason, source, utm_content]
- 書き手（1）: 
  - `scripts/lib/snsDailyRunnerStore.js:85` upsert(rest) [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: observed_at

### <a id="t-sns_content_types"></a>sns_content_types

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, type_key, label, cadence, requires_topic_approval, trigger_mode, active, notes, created_at

### <a id="t-sns_draft_metrics"></a>sns_draft_metrics

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, draft_id, metric_name, metric_value, source, recorded_at

### <a id="t-sns_drafts"></a>sns_drafts

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: append_sns_metric_observation, approve_sns_x_send, enqueue_sns_metric_jobs, guard_sns_preview_bundle_draft, import_sns_preview_bundle, read_sns_draft_diff, save_sns_draft_diff, sns_claim_external, sns_finish_external, sns_x_slot_room, stop_sns_auto_item, transition_sns_send_139, transition_sns_x_send
- 本体で書く RPC: approve_sns_x_send, import_sns_preview_bundle, save_sns_draft_diff, sns_claim_external, sns_finish_external, sns_record_external, sns_update_external_warning, stop_sns_auto_item, transition_sns_send_139, transition_sns_x_send
- 取得のジョブ: sns_auto_plan, sns_daily, sns_metrics, sns_send
- 読み手（35）: 
  - `api/_lib/snsClaimCheck.js:177` rest(rest) [bundle_import_id, id, source_data]
  - `api/_lib/snsClaimCheckReaders.js:154` rest(rest) [caption_text, cover_image_path, hashtags, id, platform, video_storage_path]
  - `api/_lib/snsHubHelpers.js:119` select(rest) [*, id]
  - `api/_lib/snsXSendStore.js:73` rest(rest) [format, id, platform, posted_at, scheduled_at, source_data, status, title]
  - `api/admin/sns-hub/drafts/index.js:43` select(rest) [*]
  - `api/admin/sns-hub/insights/index.js:53` select(rest) [referenced_insight_ids]
  - `api/admin/sns-hub/revisions/index.js:57` select(rest) [format, id, platform, revision_reason_codes, revision_reason_freetext, title, updated_at]
  - `api/admin/sns-hub/send-probe.js:52` rest(rest) [cover_image_path, created_at, format]
  - `api/admin/sns-hub/send-probe.js:55` rest(rest) [created_at, platform, video_storage_path]
  - `scripts/analysis/youtube-posts-report.js:22` select [archived_at, created_at, id, platform, posted_at, status, title]
  - `scripts/lib/contentRevisionHistory.js:34` select [format, id, platform, revision_reason_codes, revision_reason_freetext, title, updated_at]
  - `scripts/lib/snsAutoPlanRunnerStore.js:61` rest(rest) [bundle_import_id, caption_text, cover_image_path, format, hashtags, id, language, platform, publication_hold_reasons, publish_blocked, risk_flags, source_data, status, template_variant_id, thread_index, title, video_storage_path]
  - `scripts/lib/snsAutoPlanRunnerStore.js:85` rest(rest) [format, id, status]
  - `scripts/lib/snsDailyRunnerStore.js:60` rest(rest) [format, id, platform, posted_at, source_data]
  - `scripts/lib/snsDailyRunnerStore.js:65` rest(rest) [caption_text, format, id, platform, posted_at]
  - `scripts/lib/snsDailyRunnerStore.js:68` rest(rest) [id]
  - `scripts/lib/snsMetricsRunnerStore.js:62` rest(rest) [format, id, platform, posted_at, status]
  - `scripts/lib/snsTodayPlannerStore.js:45` rest(rest) [format, id, send_lane, source_data, status]
  - `scripts/maintenance/verify-data-readers.js:183` rest(rest) [created_at, id, status] （検査）
  - `scripts/maintenance/verify-data-readers.js:205` rest(rest) [id] （検査）
  - `scripts/maintenance/verify-display-coverage.js:170` rest(rest) [*] （検査）
  - `scripts/maintenance/verify-sns-auto-plan.js:617` rest(rest) [bundle_import_id] （検査）
  - `scripts/maintenance/verify-sns-auto-plan.js:625` rest(rest) [id, status] （検査）
  - `scripts/maintenance/verify-sns-daily-runner.js:965` rest(rest) [caption_text, format, id, platform, posted_at] （検査）
  - `scripts/maintenance/verify-sns-month-calendar.js:47` rest(rest) （検査）
  - `scripts/maintenance/verify-sns-today-plan.js:738` rest(rest) [format, send_lane] （検査）
  - `scripts/maintenance/verify-sns-today-plan.js:762` rest(rest) [id, status] （検査）
  - `scripts/maintenance/verifyData/sns-existing-fixes-fixture.js:67` rest(rest)
  - `scripts/maintenance/verifyData/sns-metrics-runner-scenes-1.js:260` rest(rest)
  - `scripts/maintenance/verifyData/sns-x-delete-scenes-1.js:69` rest(rest)
  - `scripts/sns/delete-x-post.js:123` rest(rest) [format, id, source_data, status, title]
  - `scripts/sns/pushFinalsImageStore.js:110` select(embed) [bundle_import_id]
  - `scripts/sns/pushFullPictureStore.js:115` rest(rest) [id, source_data]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:78` rest(rest) [format, id]
  - `scripts/sns/today-picks.js:98` rest(rest) [caption_text, format, id, send_lane, source_data, status]
- 書き手（6）: 
  - `api/_lib/snsHubHelpers.js:136` update(rest) [?]
  - `scripts/lib/snsAutoPlanRunnerStore.js:112` update(rest) [?]
  - `scripts/lib/snsTodayPlannerStore.js:92` update(rest) [?]
  - `scripts/sns/pushFinalsImageStore.js:165` update(rest) [?]
  - `scripts/sns/pushFullPictureStore.js:145` update(rest) [?]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:146` update(rest) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_metric_jobs"></a>sns_metric_jobs

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で書く RPC: enqueue_sns_metric_jobs
- 取得のジョブ: sns_metrics
- 読み手（3）: 
  - `scripts/lib/snsMetricsRunnerStore.js:57` rest(rest) [attempts, draft_id, due_at, id, last_error, source, state, window]
  - `scripts/lib/snsMetricsRunnerStore.js:80` rest(rest) [done_at, id, state]
  - `scripts/maintenance/verifyData/sns-metrics-runner-scenes-1.js:250` rest(rest) [state]
- 書き手（2）: 
  - `scripts/lib/snsMetricsRunnerStore.js:99` update(rest) [?]
  - `scripts/lib/snsMetricsRunnerStore.js:113` update(rest) [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: created_at

### <a id="t-sns_metric_observations"></a>sns_metric_observations

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: append_sns_metric_observation
- 本体で書く RPC: append_sns_metric_observation
- 読み手（4）: 
  - `api/_lib/snsXSendStore.js:77` rest(rest) [data_through, definition, draft_id, id, metric_name, metric_value, missing_reason, observed_at, period_end, source, window]
  - `scripts/lib/snsDailyRunnerStore.js:24` rest(rest) [definition, denominator_value, draft_id, metric_name, metric_value, observed_at, source, window]
  - `scripts/lib/snsMetricsRunnerStore.js:131` rest(rest) [draft_id, id, metric_value, source, window]
  - `scripts/maintenance/verify-sns-month-calendar.js:51` rest(rest) （検査）
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_oauth_tokens"></a>sns_oauth_tokens

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: sns_metrics, sns_send
- 読み手（1）: 
  - `api/_lib/snsTokenDb.js:33` rest(rest) [*, provider]
- 書き手（4）: 
  - `api/_lib/snsTokenDb.js:36` upsert(rest) [?]
  - `api/_lib/snsTokenDb.js:55` update(rest) [?]
  - `api/_lib/snsTokenDb.js:68` update(rest) [?]
  - `api/_lib/snsTokenDb.js:76` update(rest) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_post_tracking"></a>sns_post_tracking

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: sns_auto_plan
- 読み手（1）: 
  - `scripts/lib/snsPostTracking.js:86` select(rest) [draft_id, tracking_url]
- 書き手（1）: 
  - `scripts/lib/snsPostTracking.js:76` upsert(rest) [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: template_variant_id, race_url, utm_source, utm_medium, utm_campaign, utm_content, release_evidence, created_at

### <a id="t-sns_strategy_insights"></a>sns_strategy_insights

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: sns_auto_plan, sns_daily, sns_metrics, sns_send
- 読み手（4）: 
  - `api/_lib/snsHubHelpers.js:162` select(rest) [*, id]
  - `api/admin/sns-hub/insights/index.js:32` select(rest) [*]
  - `scripts/lib/snsStrategyInsights.js:32` select [*, status]
  - `scripts/lib/snsStrategyInsights.js:56` select [created_at, format, id, insight_text, language, platform, status]
- 書き手（2）: 
  - `api/_lib/snsHubHelpers.js:179` update(rest) [?]
  - `scripts/lib/snsStrategyInsights.js:81` insert [evidence, format, insight_text, language, platform, research_method, source]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_target_accounts"></a>sns_target_accounts

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, platform, account_label, brand_kit_ref, credential_ref, active, created_at

### <a id="t-sns_template_variants"></a>sns_template_variants

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（1）: 
  - `api/admin/sns-hub/drafts/index.js:43` select(embed) [composition_name, variant_name]
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, format, active, notes, created_at, created_by

### <a id="t-sns_today_type_schedule"></a>sns_today_type_schedule

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（3）: 
  - `scripts/lib/snsTodayPlannerStore.js:79` rest(rest) [day, post, type_id]
  - `scripts/maintenance/verify-sns-today-plan.js:755` rest(rest) [day, post, type_id] （検査）
  - `scripts/maintenance/verify-sns-today-variants.js:358` rest(rest) [day] （検査）
- 書き手（1）: 
  - `scripts/sns/push-today-types.js:104` upsert(rest) [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: source, updated_at

### <a id="t-sns_topic_categories"></a>sns_topic_categories

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, category_key, label, content_type_id, source_id, active, notes, created_at

### <a id="t-sns_topic_category_channels"></a>sns_topic_category_channels

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, category_id, platform, enabled, updated_at

### <a id="t-sns_topic_targets"></a>sns_topic_targets

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, topic_id, target_account_id, status, claimed_by, claimed_at, skip_reason, draft_id, created_at

### <a id="t-sns_topics"></a>sns_topics

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, topic_text, content_type_id, status, source_insight_ids, proposed_at, approved_at, approver_id, created_at, rejection_reason, campaign_id

### <a id="t-sns_x_kind_reserves"></a>sns_x_kind_reserves

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: sns_x_slot_room
- 読み手（1）: 
  - `scripts/sns/x-slots-check.js:179` rest(rest) [daily_count, kind, weekdays]
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: note, updated_at

### <a id="t-sns_x_send_control"></a>sns_x_send_control

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: approve_sns_x_send, reserve_sns_x_read, roll_sns_x_send_period, sns_x_slot_room, transition_sns_send_139, transition_sns_x_send
- 本体で書く RPC: renew_sns_x_send_period, reserve_sns_x_read, roll_sns_send_baselines, roll_sns_x_send_period, transition_sns_send_139
- 取得のジョブ: sns_auto_plan, sns_send
- 読み手（6）: 
  - `api/_lib/snsXSendStore.js:140` rest(rest) [budget_microusd, id, paused, reserved_microusd]
  - `api/_lib/snsXSendStore.js:150` rest(rest) [id, paused]
  - `scripts/lib/snsMetricsRunnerStore.js:119` rest(rest) [*, id]
  - `scripts/sns/pushFinalsImageStore.js:94` rest(rest) [daily_baseline_date, daily_external_count, daily_limit, daily_limit_x, id]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:156` rest(rest) [daily_baseline_date, daily_external_count, daily_limit, daily_limit_youtube, expiry_minutes, id, max_source_age_seconds]
  - `scripts/sns/x-slots-check.js:181` rest(rest) [daily_limit_x]
- 書き手（1）: 
  - `api/_lib/snsXSendStore.js:157` update(rest) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_x_send_jobs"></a>sns_x_send_jobs

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: approve_sns_x_send, guard_sns_diff_approval, guard_sns_preview_bundle_draft, guard_sns_x_approval, sns_x_slot_room, stop_sns_auto_item, transition_sns_send_139, transition_sns_x_send
- 本体で書く RPC: approve_sns_x_send, guard_sns_x_approval, sweep_sns_deadline_queue, transition_sns_send_139, transition_sns_x_send
- 読み手（29）: 
  - `api/_lib/snsXSendStore.js:60` rest(rest) [external_post_id, id, state]
  - `api/_lib/snsXSendStore.js:70` rest(rest) [draft_id, error_code, expires_at, external_post_id, id, posted_at, scheduled_at, snapshot, state, youtube_stage]
  - `api/_lib/snsXSendStore.js:137` rest(rest) [attempts, draft_id, error_code, expires_at, external_post_url, id, posted_at, scheduled_at, state]
  - `api/admin/sns-hub/delete-x-post.js:39` rest(rest) [*, id]
  - `scripts/lib/snsAutoPlanRunnerStore.js:92` rest(rest) [draft_id, id, state]
  - `scripts/lib/snsDailyRunnerStore.js:55` rest(rest) [channel, draft_id, external_post_id, posted_at, state]
  - `scripts/lib/snsMetricsRunnerStore.js:64` rest(rest) [channel, draft_id, external_post_id, state]
  - `scripts/lib/snsSendRunner.js:216` rest(rest) [*, id, scheduled_at, state]
  - `scripts/lib/snsSendRunner.js:223` rest(rest) [external_post_id, id, state]
  - `scripts/lib/snsSendRunner.js:235` rest(rest) [channel, expires_at, id, parent_job_id, state]
  - `scripts/lib/snsSendRunner.js:239` rest(rest) [external_post_id, id, state]
  - `scripts/lib/snsSendRunner.js:248` rest(rest) [attempts, channel, error_code, expires_at, external_post_id, id, snapshot, state, youtube_stage]
  - `scripts/lib/snsSendRunner.js:255` rest(rest) [attempts, channel, error_code, expires_at, external_post_id, id, snapshot, state, youtube_stage]
  - `scripts/lib/snsSendRunner.js:261` rest(rest) [channel, error_code, id, state, youtube_stage]
  - `scripts/maintenance/verify-sns-month-calendar.js:46` rest(rest) （検査）
  - `scripts/maintenance/verify-sns-send-runner.js:504` rest(rest) [channel, error_code, id, state, youtube_stage] （検査）
  - `scripts/maintenance/verify-sns-send-runner.js:1568` rest(rest) [attempts, channel, error_code, expires_at, external_post_id, id, snapshot, state, youtube_stage] （検査）
  - `scripts/maintenance/verify-sns-send-runner.js:2236` rest(rest) [attempts, channel, error_code, expires_at, external_post_id, id, snapshot, state, youtube_stage] （検査）
  - `scripts/maintenance/verifyData/sns-metrics-runner-scenes-1.js:269` rest(rest)
  - `scripts/maintenance/verifyData/sns-x-delete-scenes-1.js:67` rest(rest)
  - `scripts/sns/delete-x-post.js:115` rest(rest) [posted_at]
  - `scripts/sns/pushFinalsImageStore.js:104` rest(rest) [attempt_channels, attempt_dates, id, state]
  - `scripts/sns/pushFinalsImageStore.js:110` rest(rest) [attempts, channel, expires_at, id, parent_job_id, state]
  - `scripts/sns/pushFinalsImageStore.js:119` rest(rest) [draft_id, error_code, external_post_id, external_post_url, id, posted_at, state]
  - `scripts/sns/pushFullPictureStore.js:118` rest(rest) [attempts, draft_id, id, state]
  - `scripts/sns/pushResearchImageStore.js:66` rest(rest) [draft_id, error_code, expires_at, external_post_id, external_post_url, id, posted_at, scheduled_at, state]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:166` rest(rest) [draft_id, error_code, expires_at, external_post_id, external_post_url, id, posted_at, scheduled_at, state]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:170` rest(rest) [attempt_channels, attempt_dates, id, state]
  - `scripts/sns/pushSetsuKiryokuShortStore.js:175` rest(rest) [attempts, channel, draft_id, expires_at, id, scheduled_at, state]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_youtube_quota_attempts"></a>sns_youtube_quota_attempts

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: transition_sns_x_send
- 本体で書く RPC: transition_sns_x_send
- 読み手（1）: 
  - `scripts/sns/pushSetsuKiryokuShortStore.js:90` rest(rest) [general_reserved, quota_day, upload_reserved]
- 書き手（0）: なし

### <a id="t-sns_youtube_quota_control"></a>sns_youtube_quota_control

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: transition_sns_x_send
- 本体で書く RPC: roll_sns_send_baselines
- 読み手（1）: 
  - `scripts/sns/pushSetsuKiryokuShortStore.js:180` rest(rest) [baseline_day, external_general, external_uploads, general_limit, id, upload_limit, verified]
- 書き手（0）: なし

### <a id="t-sns_youtube_quota_reads"></a>sns_youtube_quota_reads

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: transition_sns_x_send
- 本体で書く RPC: transition_sns_x_send
- 読み手（1）: 
  - `scripts/sns/pushSetsuKiryokuShortStore.js:92` rest(rest) [quota_day, units]
- 書き手（0）: なし

### <a id="t-st_course_baseline"></a>st_course_baseline

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/daily/update-course-baseline-stats.js:113` select(helper:upsertChangedRows)
  - `src/services/venueQueries2.js:361` select [avg_st, breakout_count, breakout_rate, course, grade, late_rate, runs, st_histogram, stable_rate, window_days, window_end, window_start]
- 書き手（1）: 
  - `scripts/daily/update-course-baseline-stats.js:113` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-top_start_stats"></a>top_start_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（1）: 
  - `src/services/venueQueries2.js:254` select [*, boat_number, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-top-start-stats.js:143` delete
  - `scripts/daily/update-top-start-stats.js:152` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-user_visible_summary"></a>user_visible_summary

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_performance_comparison
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: summary_id, rec_avg_payout, rec_profit_rate, skip_saved, updated_at

### <a id="t-v_performance_comparison"></a>v_performance_comparison

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 無効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: model_id, period_type, period_start, period_end, all_total, all_hit_rate_pct, all_recovery_rate_pct, rec_total, rec_hit_rate_pct, rec_recovery_rate_pct, improvement_pct, rec_profit

### <a id="t-v_prediction_performance"></a>v_prediction_performance

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 無効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: model_id, race_date, total_races, wins, place_hits, win_rate, place_rate, avg_confidence

### <a id="t-v_production_models"></a>v_production_models

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 無効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: model_id, display_name, description, model_type, version, parent_model_id, target_venues, target_volatility_min, target_volatility_max, trained_at, training_data_from, training_data_to, training_race_count, hyperparameters, feature_list, status, is_public, total_predictions, hit_rate_win, recovery_rate_win, last_evaluated_at, created_at, updated_at

### <a id="t-v_todays_recommendations"></a>v_todays_recommendations

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 無効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: race_id, venue_code, race_number, start_time, model_id, top_pick, confidence, player_name, win_rate, motor_2rate

### <a id="t-venue_course_technique_baseline"></a>venue_course_technique_baseline

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: compute_racer_course_technique_stats
- 取得のジョブ: racer_course_technique_stats
- 読み手（5）: 
  - `scripts/daily/generate-morning-digest.js:237` select [*]
  - `scripts/daily/update-racer-course-technique-stats.js:255` select(helper:upsertChangedRows)
  - `scripts/daily/update-racer-course-technique-stats.js:283` select [*]
  - `scripts/maintenance/verify-full-picture-scene2.js:2716` rest(rest) （検査）
  - `scripts/maintenance/verify-full-picture-scene2.js:4136` rest(rest) （検査）
- 書き手（1）: 
  - `scripts/daily/update-racer-course-technique-stats.js:255` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-venue_entry_course_stats"></a>venue_entry_course_stats

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: entry_course_stats
- 読み手（0）: なし
- 書き手（1）: 
  - `scripts/lib/venueEntryCourseStats/scrape.js:209` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: venue_code, racer_id, racer_name_raw, entry_rate, avg_st, place_rate_1, place_rate_2, place_rate_3, place_rate_4, place_rate_5, place_rate_6, stats_period_start, stats_period_end, scraped_at

### <a id="t-venue_grade_boat_stats"></a>venue_grade_boat_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（3）: 
  - `scripts/daily/calculate-venue-grade-stats.js:210` select(helper:upsertChangedRows)
  - `src/services/venueQueries3.js:172` select [boat_number, manshu_count, payout_count, payout_trio_sum, race_count, race_grade, technique_breakdown, top2, top3, venue_code, wins]
  - `src/services/venueQueries3.js:189` select [venue_code]
- 書き手（1）: 
  - `scripts/daily/calculate-venue-grade-stats.js:210` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-venue_motor_start_dates"></a>venue_motor_start_dates

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: boatcast_motor_start
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/lib/boatcast/oritenSchema.js:15`
- 読み手（3）: 
  - `scripts/lib/boatcast/motorStartJob.js:202` select(helper:upsertChangedRows)
  - `scripts/sns/rankDataMotor.js:18` select(helper:readAll)
  - `src/services/motorQueries.js:179` select [start_date, venue_code]
- 書き手（1）: 
  - `scripts/lib/boatcast/motorStartJob.js:202` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-venue_motor_stats"></a>venue_motor_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: venue_motor_stats
- 読み手（4）: 
  - `scripts/daily/generate-morning-digest.js:193` select [motor_number, race_count, scraped_date, venue_code]
  - `src/services/motorQueries3.js:55` select [*, motor_number, scraped_date, venue_code]
  - `src/services/motorQueries3.js:368` select [scraped_date, venue_code]
  - `src/services/motorQueries3.js:378` select [accident_rate, championship_count, final_count, motor_number, race_count, scraped_date, stats_period_end, top2_rate, top3_rate, venue_code, win_rate]
- 書き手（1）: 
  - `scripts/daily/scrape-venue-motor-stats.js:134` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-venue_rules"></a>venue_rules

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 読み手（0）: なし
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, rule_id, venue_code, bet_type, conditions, description, expected_recovery, reliability, sample_size, is_active, created_at, updated_at

### <a id="t-venue_technique_period_stats"></a>venue_technique_period_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（1）: 
  - `src/services/venueQueries.js:25` select [last_updated, period_days, period_from, period_to, race_count, total_races, venue_code, winning_technique]
- 書き手（2）: 
  - `scripts/daily/update-winning-technique-stats.js:236` delete
  - `scripts/daily/update-winning-technique-stats.js:245` insert [?]

### <a id="t-venues"></a>venues

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 本体で書く RPC: update_venue_stats
- 読み手（6）: 
  - `scripts/analysis/venue-summary-stats/count-venue-techniques.mjs:89` select [cluster, code]
  - `scripts/daily/generate-predictions.js:42` select [avg_first_win_rate, code]
  - `scripts/maintenance/update-venue-stats.js:74` select [avg_first_win_rate, avg_first_win_rate_race_count, code, name]
  - `src/services/core.js:324` select [avg_first_win_rate, code]
  - `src/services/venueQueries.js:57` select [cluster, code, name]
  - `src/services/venueQueries2.js:224` select [avg_first_win_rate, avg_first_win_rate_race_count, code, name]
- 書き手（2）: 
  - `scripts/maintenance/update-venue-stats.js:46` update [avg_first_win_rate, avg_first_win_rate_race_count, updated_at]
  - `scripts/maintenance/update-venue-stats.js:58` update [avg_first_win_rate, avg_first_win_rate_race_count, updated_at]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: water_type, course_entry_baseline, course_entry_baseline_updated_at

### <a id="t-watson_predictions"></a>watson_predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/fix-opening-day-race-id-date.js:79`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:52`
- 読み手（1）: 
  - `src/services/watsonService.js:90` select [explanations, model_trained_at, predicted_at, race_id, rank_order, win_probs]
- 書き手（1）: 
  - `scripts/daily/generate-watson-predictions.js:93` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-winning_technique_stats"></a>winning_technique_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/maintenance/verify-full-picture-scene2.js:2871` rest(rest) （検査）
  - `src/services/venueQueries.js:255` select [*, boat_number, percentage, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-winning-technique-stats.js:161` delete
  - `scripts/daily/update-winning-technique-stats.js:171` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

## コードが使うのに写しに無い名前

写しの取得より後のマイグレーションで足したもの、消したもの、別のスキーマ、誤りのどれか。

- rpc `b`: `scripts/maintenance/verifyData/e2e-har-merge-scenes.js:189`, `scripts/maintenance/verifyData/e2e-har-merge-scenes.js:208`
- rpc `get_course_win_rate_baseline`: `src/services/venueQueries.js:355`
- rpc `get_racer_front_taking_counts`: `src/services/racerQueries4.js:203`
- rpc `get_racer_scoped_race_rows`: `src/services/racerQueries4.js:174`
- table `a`: `scripts/maintenance/verifyData/e2e-har-merge-scenes.js:186`, `scripts/maintenance/verifyData/e2e-har-merge-scenes.js:187`, `scripts/maintenance/verifyData/e2e-har-merge-scenes.js:188`
- table `eve_race_deadlines`: `scripts/lib/eveDeadlinesJob.js:80`, `scripts/lib/eveDeadlinesJob.js:274`, `scripts/lib/eveDeadlinesJob.js:399`
- table `racer_career_meta`: `scripts/lib/racerCareerDb.js:108`, `scripts/lib/racerCareerJob.js:504`, `scripts/lib/racerCareerJob.js:553`
- table `sns_send_events`: `scripts/lib/snsSendRunner.js:172`

## 拾えなかったもの

- 名前が式（変数・テンプレートの式）の箇所: 34
  - `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:50` 表の名前が変数（.from(式)）
  - `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:15` 表の名前が変数（.from(式)）
  - `scripts/analysis/original-exhibition/check-rewrite.mjs:20` 表の名前が変数（.from(式)）
  - `scripts/analysis/verify-race-analysis-rpc.js:376` RPC の名前が変数（.rpc(式)）
  - `scripts/lib/boatcast/oritenSchema.js:50` 表の名前が変数（.from(式)）
  - `scripts/lib/dataHealth/job.js:71` RPC の名前が変数（.rpc(式)）
  - `scripts/lib/fanPeriodJob.js:86` 表の名前が変数（.from(式)）
  - `scripts/lib/fanPeriodJob.js:159` 表の名前が変数（.from(式)）
  - `scripts/lib/fanPeriodJob.js:247` 表の名前が変数（.from(式)）
  - `scripts/lib/pitReportSchema.js:40` 表の名前が変数（.from(式)）
  - `scripts/lib/raceResultSchema.js:84` 表の名前が変数（.from(式)）
  - `scripts/lib/raceSeriesSync.js:75` 表の名前が変数（.from(式)）
  - `scripts/lib/raceSeriesSync.js:91` 表の名前が変数（.from(式)）
  - `scripts/lib/raceSeriesSync.js:104` 表の名前が変数（.from(式)）
  - `scripts/lib/racerCareerJob.js:268` 表の名前が変数（.from(式)）
  - `scripts/lib/schemaDetect.js:67` 表の名前が変数（.from(式)）
  - `scripts/lib/snsAutoPlanRunner.js:74` RPC の名前が変数（.rpc(式)）
  - `scripts/lib/snsSendRunner.js:153` REST の表の名前が式（/rest/v1/${…}）
  - `scripts/maintenance/backfill-kb-gaps.js:204` 表の名前が変数（.from(式)）
  - `scripts/maintenance/backfill-kb-gaps.js:239` 表の名前が変数（.from(式)）
  - `scripts/maintenance/delete-phantom-races.js:178` 表の名前が変数（.from(式)）
  - `scripts/maintenance/delete-phantom-races.js:220` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fan-backfill-load.js:111` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fan-backfill-load.js:195` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-opening-day-race-id-date.js:153` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-opening-day-race-id-date.js:169` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-opening-day-race-id-date.js:254` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:84` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:100` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:180` 表の名前が変数（.from(式)）
  - `scripts/maintenance/kb-backfill-load.js:313` 表の名前が変数（.from(式)）
  - `scripts/maintenance/motor-pretest-backfill.js:251` 表の名前が変数（.from(式)）
  - `scripts/maintenance/verifyData/fakeServiceSupabase.js:51` RPC の名前が変数（.rpc(式)）
  - `scripts/sns/pushSetsuKiryokuShortStore.js:37` REST の表の名前が式（/rest/v1/${…}）
- 構文木にできなかったファイル: 0
- 対象外の言語で DB を読み書きしうるファイル（Python。拾っていない）: 55
  - `scripts/analysis/analogy-finder-fr2-holdout.py`
  - `scripts/analysis/analogy-finder-fr2-strat/features_prod.py`
  - `scripts/analysis/analogy-finder-perrace/finish_targets.py`
  - `scripts/analysis/analogy-finder-perrace/race_level.py`
  - `scripts/analysis/analogy-finder-perrace/venue_magnitude.py`
  - `scripts/analysis/analogy-finder-phase-m/build_dataset.py`
  - `scripts/analysis/analogy-finder-phase-m/md3_odds.py`
  - `scripts/analysis/analogy-finder-phase-m/md3_odds_v2.py`
  - `scripts/analysis/analogy-finder-t1/t1_1_stage_rule.py`
  - `scripts/analysis/analogy-finder-t1/t1_2_series_runs.py`
  - `scripts/analysis/analogy-finder-t1/t1_4_hint_threshold.py`
  - `scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py`
  - `scripts/analysis/analogy-finder-v16/t2_4_rerank_agreement.py`
  - `scripts/analysis/boa845-axis-place/build_pool.py`
  - `scripts/analysis/boa845-axis-place/common.py`
  - `scripts/analysis/boa845-axis-place/display.py`
  - `scripts/analysis/boa845-axis-place/effect.py`
  - `scripts/analysis/boa845-axis-place/mark_rule.py`
  - `scripts/analysis/boa845-axis-place/today_counts.py`
  - `scripts/analysis/in-collapse-caution/round2/c2_rebuild.py`
  - `scripts/analysis/in-collapse-caution/round3/c2_round3.py`
  - `scripts/analysis/in-collapse-caution/round4/sparse_cells.py`
  - `scripts/analysis/original-exhibition/analyze.py`
  - `scripts/analysis/original-exhibition/analyze2.py`
  - `scripts/analysis/original-exhibition/analyze4.py`
  - `scripts/analysis/original-exhibition/build.py`
  - `scripts/analysis/original-exhibition/forecast-slit.py`
  - `scripts/analysis/past-rate-check/label-threshold.py`
  - `scripts/analysis/past-rate-check/slit-pattern-rates.py`
  - `scripts/maintenance/guard_weakening/verify_guard.py`
  - `scripts/ml/analogy/db.py`
  - `scripts/ml/analogy/features.py`
  - `scripts/ml/analogy/in_caution_bands.py`
  - `scripts/ml/analogy/make_treeshap_testdata.py`
  - `scripts/ml/analogy/perrace.py`
  - `scripts/ml/analogy/tests/test_db.py`
  - `scripts/ml/analogy/tests/test_in_caution_bands.py`
  - `scripts/ml/analogy/tests/test_perrace.py`
  - `scripts/ml/analogy/tests/test_v16_pool.py`
  - `scripts/ml/analogy/tests/test_v16_scenario.py`
  - `scripts/ml/analogy/v16_history.py`
  - `scripts/ml/analogy/v16_morning.py`
  - `scripts/ml/analogy/v16_pool.py`
  - `scripts/ml/analogy/v16_scenario.py`
  - `scripts/ml/backfill.py`
  - `scripts/ml/features.py`
  - `scripts/ml/mycroft_sequences.py`
  - `scripts/ml/predict.py`
  - `scripts/ml/predict_mycroft.py`
  - `scripts/ml/predict_watson.py`
  - `scripts/ml/train_mycroft.py`
  - `scripts/ml/train_rf.py`
  - `scripts/ml/train_v2.py`
  - `scripts/ml/train_watson.py`
  - `scripts/ml/watson_scores.py`
- repo の外（hq の `platform/*.py`・cron-job.org 等）: 機械では拾えない。`docs/reference/data-readers.extra.json` に手で足す
- 読み手の変数に入れてから後で足した連鎖（`let q = …from("t"); q = q.eq("c", …)`）の列、`.select()` の文字列が式の列

