# データの読み手の台帳

> 機械生成（`node scripts/maintenance/generate-data-readers.js`）。手で書き換えない。表・列・RPC を変える・消す前に、ここで読み手と書き手を確かめる。master へのマージ後に CI（regenerate-generated-docs.yml）が作り直す。PR には含めない（ADR-0078）。作業中の枝の影響を見るときは手元で作り直して読み、コミットせずに戻す。機械で拾えない repo の外の読み手（hq 等）は `docs/reference/data-readers.extra.json` に手で足す。
>
> 入力: `src/`・`api/`・`scripts/`・`sns-video-studio/` の JS/TS（構文木で `.from()`・`.select()`・`.rpc()` 等と `/rest/v1/` を拾う）と、本番スキーマの写し（`docs/reference/schema-snapshot.json`、取得 2026-10-27T08:16:33.412Z）。権限・RPC の本体はこの写しの時点のもの。

## 件数

| 項目 | 件数 |
|---|---|
| 表・ビュー（写し） | 107 |
| RPC（写しの関数） | 68 |
| 読んだファイル | 1554 |
| 読み書きのあるファイル | 254 |
| 表の読み手（箇所） | 888 |
| 表の書き手（箇所） | 184 |
| RPC の呼び手（箇所） | 49 |
| 名前の文字列だけの箇所（呼ぶ経路は式） | 231 |
| 読み手の見つからない表（RPC・ビュー経由・名前の文字列・外も無し。data_health_* の監視だけのものは含む） | 21 |
| 呼び手の見つからない RPC（RPC 経由・名前の文字列・トリガー・外も無し） | 7 |
| 外の読み手（手で足した行） | 1 |
| コードが使うのに写しに無い名前 | 0 |
| 名前が式で拾えなかった箇所 | 31 |
| 構文木にできなかったファイル | 0 |
| 対象外の言語のファイル（Python 等） | 54 |

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
| [exhibition_data](#t-exhibition_data) | table | anon 可 | 47 | 3 | data_health_coverage, data_health_table_rows, get_predictions_by_date ほか3 |  | exhibition, race_info, races_init |  |
| [exhibition_time_top_stats](#t-exhibition_time_top_stats) | table | anon 可 | 1 | 2 | data_health_nightly_freshness |  |  |  |
| [external_predictions](#t-external_predictions) | table | anon 可 | 2 | 1 | data_health_table_rows |  | pcexpect |  |
| [fetch_counts](#t-fetch_counts) | table | service だけ | 0 | 0 | fetch_counts_daily | add_fetch_counts |  |  |
| [fetch_counts_minute](#t-fetch_counts_minute) | table | service だけ | 0 | 0 |  | add_fetch_counts |  |  |
| [in_caution_gap_band_daily](#t-in_caution_gap_band_daily) | table | service だけ | 0 | 0 | get_in_caution_band_rates |  |  |  |
| [kb_archive_boats](#t-kb_archive_boats) | table | service だけ | 1 | 0 |  |  |  |  |
| [kb_archive_races](#t-kb_archive_races) | table | service だけ | 3 | 0 |  |  |  |  |
| [kb_archive_venue_days](#t-kb_archive_venue_days) | table | service だけ | 0 | 0 |  |  |  |  |
| [losing_technique_stats](#t-losing_technique_stats) | table | anon 可 | 2 | 2 | data_health_nightly_freshness |  |  |  |
| [model_bet_candidates](#t-model_bet_candidates) | table | anon 可 | 0 | 0 |  |  |  |  |
| [model_experiments](#t-model_experiments) | table | service だけ | 0 | 0 |  |  |  |  |
| [model_performance_daily](#t-model_performance_daily) | table | anon 可 | 3 | 1 | data_health_nightly_freshness |  |  |  |
| [models](#t-models) | table | anon 可 | 2 | 1 | get_accuracy_summary, view:v_production_models |  |  |  |
| [morning_digest_days](#t-morning_digest_days) | table | anon 可 | 2 | 2 |  |  | morning_digest |  |
| [morning_digest_rows](#t-morning_digest_rows) | table | anon 可 | 2 | 3 |  |  | morning_digest |  |
| [motor_pretest_stats](#t-motor_pretest_stats) | table | anon 可 | 5 | 0 |  |  |  |  |
| [mycroft_predictions](#t-mycroft_predictions) | table | anon 可 | 1 | 1 |  |  |  |  |
| [nige_outcome_distribution](#t-nige_outcome_distribution) | table | anon 可 | 1 | 2 | data_health_nightly_freshness |  |  |  |
| [nige_second_by_course](#t-nige_second_by_course) | table | anon 可 | 2 | 1 | data_health_nightly_freshness |  |  |  |
| [outcome_distribution](#t-outcome_distribution) | table | anon 可 | 7 | 2 | data_health_nightly_freshness |  |  |  |
| [poirot_predictions](#t-poirot_predictions) | table | anon 可 | 2 | 1 | data_health_morning_freshness |  |  |  |
| [prediction_odds](#t-prediction_odds) | table | anon 可 | 4 | 2 | get_predictions_by_date, get_predictions_by_date_light |  | odds |  |
| [predictions](#t-predictions) | table | anon 可 | 55 | 10 | get_accuracy_summary, get_admin_rule_performance, get_predictions_by_date ほか6 | update_prediction_results | exhibition, kfile_sync, race_info ほか4 | hq:platform/finals_sheet.py |
| [race_conditions](#t-race_conditions) | table | anon 可 | 39 | 6 | data_health_coverage, data_health_nightly_freshness, data_health_pre_race_fields ほか5 |  | exhibition, kfile_sync, race_info ほか4 |  |
| [race_entries](#t-race_entries) | table | anon 可 | 140 | 10 | compute_racer_course_technique_stats, compute_st_course_baseline, compute_today_course_win_stats ほか16 |  | exhibition, race_info, races_init |  |
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
| [race_results](#t-race_results) | table | anon 可 | 124 | 10 | compute_nige_second_by_course, compute_racer_course_technique_stats, compute_st_course_baseline ほか17 |  | kfile_sync, race_status, result ほか1 |  |
| [race_series](#t-race_series) | table | anon 可 | 7 | 0 | data_health_race_series, data_health_table_rows |  |  |  |
| [race_special_notes](#t-race_special_notes) | table | service だけ | 1 | 1 | data_health_table_rows |  | race_notices |  |
| [race_start_timings](#t-race_start_timings) | table | anon 可 | 29 | 6 | compute_st_course_baseline, data_health_coverage, data_health_table_rows ほか2 |  | kfile_sync, race_status, result ほか1 |  |
| [racer_aggregated_stats](#t-racer_aggregated_stats) | table | anon 可 | 13 | 1 | data_health_nightly_freshness |  |  |  |
| [racer_course_technique_stats](#t-racer_course_technique_stats) | table | anon 可 | 3 | 1 |  |  | racer_course_technique_stats |  |
| [racer_grade_cache](#t-racer_grade_cache) | table | anon 可 | 1 | 1 | data_health_nightly_freshness |  |  |  |
| [racer_news](#t-racer_news) | table | anon 可 | 3 | 2 |  |  | racer_news |  |
| [racer_news_pending](#t-racer_news_pending) | table | service だけ | 2 | 2 |  |  | racer_news |  |
| [racer_period_stats](#t-racer_period_stats) | table | anon 可 | 6 | 0 | data_health_racer_period_stats, data_health_table_rows |  |  |  |
| [racer_profiles](#t-racer_profiles) | table | anon 可 | 14 | 3 | data_health_table_rows |  | racer_profiles |  |
| [racer_series_points](#t-racer_series_points) | table | anon 可 | 5 | 1 | data_health_nightly_freshness, data_health_table_rows |  | point_rank |  |
| [races](#t-races) | table | anon 可 | 141 | 20 | claim_scrape_slots, claim_scrape_slots_by_offset, compute_nige_second_by_course ほか24 |  | exhibition, kfile_sync, race_info ほか4 |  |
| [raw_snapshots](#t-raw_snapshots) | table | service だけ | 0 | 1 |  |  | fan_period |  |
| [rule_applications](#t-rule_applications) | table | service だけ | 1 | 2 |  |  |  |  |
| [scrape_job_state](#t-scrape_job_state) | table | service だけ | 12 | 14 |  | scrape_breaker_open | analogy_dispatch_morning, analogy_dispatch_train, analogy_v16_exhibition ほか40 |  |
| [scrape_slots](#t-scrape_slots) | table | service だけ | 10 | 9 | claim_scrape_slots, claim_scrape_slots_by_offset | claim_scrape_slots, claim_scrape_slots_by_offset, ensure_scrape_slots | analogy_dispatch_morning, analogy_dispatch_train, analogy_v16_exhibition ほか40 |  |
| [sns_approvers](#t-sns_approvers) | table | service だけ | 2 | 0 | approve_sns_x_send |  |  |  |
| [sns_auto_send_control](#t-sns_auto_send_control) | table | service だけ | 12 | 0 | approve_sns_x_send, transition_sns_send_139, transition_sns_x_send |  |  |  |
| [sns_auto_send_incidents](#t-sns_auto_send_incidents) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_auto_send_items](#t-sns_auto_send_items) | table | service だけ | 11 | 4 | approve_sns_x_send, sns_bundle_send_allowed, sns_x_slot_room ほか3 | stop_sns_auto_item, transition_sns_x_send | sns_auto_plan |  |
| [sns_bundle_imports](#t-sns_bundle_imports) | table | service だけ | 2 | 0 | guard_sns_preview_bundle_draft, import_sns_preview_bundle, sns_bundle_send_allowed | import_sns_preview_bundle |  |  |
| [sns_campaign_entries](#t-sns_campaign_entries) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_campaigns](#t-sns_campaigns) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_channel_daily](#t-sns_channel_daily) | table | service だけ | 1 | 1 |  |  | sns_daily |  |
| [sns_content_types](#t-sns_content_types) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_draft_metrics](#t-sns_draft_metrics) | table | service だけ | 0 | 0 |  |  |  |  |
| [sns_drafts](#t-sns_drafts) | table | service だけ | 29 | 5 | append_sns_metric_observation, approve_sns_x_send, enqueue_sns_metric_jobs ほか10 | approve_sns_x_send, import_sns_preview_bundle, save_sns_draft_diff ほか7 | sns_auto_plan, sns_daily, sns_metrics ほか1 |  |
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
| [sns_x_send_control](#t-sns_x_send_control) | table | service だけ | 5 | 1 | approve_sns_x_send, reserve_sns_x_read, roll_sns_x_send_period ほか3 | renew_sns_x_send_period, reserve_sns_x_read, roll_sns_send_baselines ほか2 | sns_auto_plan, sns_send |  |
| [sns_x_send_jobs](#t-sns_x_send_jobs) | table | service だけ | 20 | 0 | approve_sns_x_send, guard_sns_diff_approval, guard_sns_preview_bundle_draft ほか5 | approve_sns_x_send, guard_sns_x_approval, sweep_sns_deadline_queue ほか2 |  |  |
| [sns_youtube_quota_attempts](#t-sns_youtube_quota_attempts) | table | service だけ | 0 | 0 | transition_sns_x_send | transition_sns_x_send |  |  |
| [sns_youtube_quota_control](#t-sns_youtube_quota_control) | table | service だけ | 0 | 0 | transition_sns_x_send | roll_sns_send_baselines |  |  |
| [sns_youtube_quota_reads](#t-sns_youtube_quota_reads) | table | service だけ | 0 | 0 | transition_sns_x_send | transition_sns_x_send |  |  |
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
| [venue_motor_start_dates](#t-venue_motor_start_dates) | table | anon 可 | 2 | 1 |  |  | boatcast_motor_start |  |
| [venue_motor_stats](#t-venue_motor_stats) | table | anon 可 | 4 | 1 | data_health_table_rows |  | venue_motor_stats |  |
| [venue_rules](#t-venue_rules) | table | service だけ | 0 | 0 |  |  |  |  |
| [venue_technique_period_stats](#t-venue_technique_period_stats) | table | anon 可 | 1 | 2 | data_health_nightly_freshness |  |  |  |
| [venues](#t-venues) | table | anon 可 | 5 | 2 | data_health_nightly_freshness | update_venue_stats |  |  |
| [watson_predictions](#t-watson_predictions) | table | anon 可 | 1 | 1 |  |  |  |  |
| [winning_technique_stats](#t-winning_technique_stats) | table | anon 可 | 2 | 2 | data_health_nightly_freshness |  |  |  |

## RPC

| RPC | 権限 | definer | 呼び手 | 呼ぶ RPC | 本体が読む表 | 本体が書く表 | 外の読み手 |
|---|---|---|---|---|---|---|---|
| activate_analogy_model | service だけ |  | 名前の文字列: scripts/ml/analogy/db.py:136 |  | analogy_models | analogy_models |  |
| add_fetch_counts | service だけ |  | scripts/lib/scrapeJobs/fetchCounter.js:140 / 名前の文字列: scripts/lib/scrapeJobs/fetchCounter.js:15 |  |  | fetch_counts, fetch_counts_minute |  |
| analogy_feedback_guard | service だけ | yes | トリガー: analogy_feedback |  | analogy_feedback |  |  |
| append_sns_metric_observation | service だけ |  | api/admin/sns-hub/observations.js:187, scripts/lib/snsDailyRunner.js:704, scripts/lib/snsMetricsRunner.js:501, scripts/maintenance/verify-sns-daily-runner.js:1078 |  | sns_drafts, sns_metric_observations | sns_metric_observations |  |
| approve_sns_x_send | service だけ |  | api/_lib/snsXSendStore.js:102, scripts/lib/snsTodayPlanner.js:1164, scripts/sns/push-finals-image.js:1272, scripts/sns/push-full-picture.js:735 | sns_bundle_send_allowed | sns_approvers, sns_auto_send_control, sns_auto_send_items, sns_drafts, sns_x_send_control, sns_x_send_jobs | sns_drafts, sns_x_send_jobs |  |
| claim_scrape_slots | service だけ |  | scripts/lib/scrapeJobs/store.js:216, scripts/maintenance/verify-scrape-slots-on-db.js:47 / 名前の文字列: scripts/lib/scrapeJobs/schemaErrors.js:17 |  | races, scrape_slots | scrape_slots |  |
| claim_scrape_slots_by_offset | service だけ |  | scripts/lib/scrapeJobs/store.js:197 |  | races, scrape_slots | scrape_slots |  |
| compute_nige_second_by_course | service だけ |  | scripts/daily/update-course-baseline-stats.js:93 |  | race_results, races |  |  |
| compute_racer_course_technique_stats | service だけ |  | scripts/daily/update-racer-course-technique-stats.js:304 |  | race_entries, race_results, races, venue_course_technique_baseline |  |  |
| compute_st_course_baseline | service だけ |  | scripts/daily/update-course-baseline-stats.js:71 |  | race_entries, race_results, race_start_timings, races |  |  |
| compute_today_course_win_stats | service だけ |  | scripts/daily/generate-morning-digest.js:281 |  | race_entries, race_results, races |  |  |
| compute_venue_course_entry_baseline | service だけ |  | なし |  | race_entries, race_results, races |  |  |
| compute_venue_course_technique_baseline | service だけ |  | scripts/daily/update-racer-course-technique-stats.js:222 |  | race_entries, race_results, races |  |  |
| data_health_cancellation_with_result | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:343, scripts/lib/dataHealth/functions.js:517 |  | race_results, races |  |  |
| data_health_coverage | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:66, scripts/lib/dataHealth/functions.js:452 |  | exhibition_data, race_conditions, race_odds, race_results, race_start_timings, races |  |  |
| data_health_entries_duplicates | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:323, scripts/lib/dataHealth/functions.js:508 |  | race_entries, race_results, races |  |  |
| data_health_monthly_result | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:370, scripts/lib/dataHealth/functions.js:497 |  | race_results, races |  |  |
| data_health_morning_freshness | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:199, scripts/lib/dataHealth/checks.js:208, scripts/lib/dataHealth/checks.js:218 ほか1 |  | analogy_v16_snapshots, bet_recommendations, poirot_predictions, races |  |  |
| data_health_nightly_freshness | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:105, scripts/lib/dataHealth/functions.js:526 |  | accuracy_cache, bet_recommendations, exhibition_time_top_stats, losing_technique_stats, model_performance_daily, nige_outcome_distribution, nige_second_by_course, outcome_distribution, race_conditions, race_history_cache, race_results, racer_aggregated_stats, racer_grade_cache, racer_series_points, races, st_course_baseline, top_start_stats, venue_grade_boat_stats, venue_technique_period_stats, venues, winning_technique_stats |  |  |
| data_health_pit_reports | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:268, scripts/lib/dataHealth/functions.js:470 |  | race_pit_reports, races |  |  |
| data_health_pre_race_fields | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:242, scripts/lib/dataHealth/checks.js:255, scripts/lib/dataHealth/functions.js:461 |  | race_conditions, race_entries, races |  |  |
| data_health_race_series | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:293, scripts/lib/dataHealth/functions.js:479 |  | race_series, races |  |  |
| data_health_racer_period_stats | service だけ |  | 名前の文字列: scripts/lib/dataHealth/checks.js:304, scripts/lib/dataHealth/functions.js:488 |  | race_entries, racer_period_stats, races |  |  |
| data_health_table_rows | service だけ |  | 名前の文字列: scripts/lib/dataHealth/functions.js:546, scripts/lib/dataHealth/job.js:51 |  | exhibition_data, external_predictions, race_conditions, race_entries, race_odds, race_payouts, race_pit_reports, race_results, race_series, race_special_notes, race_start_timings, racer_period_stats, racer_profiles, racer_series_points, races, venue_entry_course_stats, venue_motor_stats |  |  |
| enqueue_sns_metric_jobs | service だけ |  | トリガー: sns_x_send_jobs |  | sns_drafts | sns_metric_jobs |  |
| ensure_scrape_slots | service だけ |  | scripts/lib/scrapeJobs/store.js:175, scripts/maintenance/verify-scrape-slots-on-db.js:58 / 名前の文字列: scripts/lib/scrapeJobs/schemaErrors.js:16 |  | races | scrape_slots |  |
| fetch_counts_daily | service だけ |  | なし |  | fetch_counts |  |  |
| get_accuracy_summary | service だけ |  | なし |  | models, predictions |  |  |
| get_admin_rule_performance | service だけ |  | api/admin/rules/performance.js:41, scripts/maintenance/verify-admin-rule-performance.js:211 |  | predictions, race_results |  |  |
| get_in_caution_band_rates | service だけ |  | scripts/daily/generate-unified-predictions.js:231, scripts/lib/inCautionHealth.js:107 |  | in_caution_gap_band_daily |  |  |
| get_latest_racer_grades | service だけ |  | scripts/daily/update-racer-grade-cache.js:17 |  | race_entries |  |  |
| get_predictions_by_date | anon 可 |  | api/predictions/[date].js:67, src/services/supabaseDataService.js:1513 / 名前の文字列: api/predictions/[date].js:63, scripts/maintenance/check-anon-access.js:103 |  | exhibition_data, prediction_odds, predictions, race_conditions, race_entries, race_payouts, race_results, races |  |  |
| get_predictions_by_date_light | anon 可 |  | api/predictions/[date].js:67, scripts/maintenance/verify-predictions-response.js:156, src/services/supabaseDataService.js:1513 / 名前の文字列: api/predictions/[date].js:63, scripts/maintenance/check-anon-access.js:104, scripts/maintenance/check-anon-access.js:173 |  | exhibition_data, prediction_odds, predictions, race_conditions, race_entries, race_payouts, race_results, races |  |  |
| get_race_exhibition_trend | anon 可 |  | scripts/lib/raceIndicatorData.js:47, src/services/supabaseDataService.js:5168 / 名前の文字列: scripts/analysis/verify-race-analysis-rpc.js:333, scripts/maintenance/check-anon-access.js:105 |  | exhibition_data, race_entries |  |  |
| get_race_history_summary | service だけ |  | なし |  | predictions, races |  |  |
| get_race_return_rate | anon 可 |  | scripts/lib/raceIndicatorData.js:37, src/services/supabaseDataService.js:5836 / 名前の文字列: scripts/analysis/verify-race-analysis-rpc.js:358, scripts/maintenance/check-anon-access.js:106 |  | race_entries, race_results |  |  |
| get_race_st_predictability | anon 可 |  | scripts/lib/raceIndicatorData.js:32, src/services/supabaseDataService.js:4949 / 名前の文字列: scripts/analysis/verify-race-analysis-rpc.js:324, scripts/maintenance/check-anon-access.js:107 |  | exhibition_data, race_entries, race_start_timings |  |  |
| get_race_technique_profile | anon 可 |  | scripts/lib/raceIndicatorData.js:42, src/services/supabaseDataService.js:6363 / 名前の文字列: scripts/analysis/verify-race-analysis-rpc.js:342, scripts/maintenance/check-anon-access.js:108 |  | race_entries, race_results |  |  |
| get_racer_accident_records | anon 可 |  | src/services/supabaseDataService.js:7487 / 名前の文字列: sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs:648 |  | race_conditions, race_entries, race_start_timings |  |  |
| get_today_races | anon 可 |  | api/races/today.js:35, scripts/maintenance/verify-display-coverage.js:175, src/services/supabaseDataService.js:1387 / 名前の文字列: scripts/maintenance/check-anon-access.js:109, scripts/maintenance/check-anon-access.js:172 |  | predictions, race_conditions, race_entries, race_results, races |  |  |
| guard_sns_diff_approval | service だけ |  | トリガー: sns_drafts | sns_diff_content | sns_x_send_jobs |  |  |
| guard_sns_preview_bundle_draft | service だけ |  | トリガー: sns_drafts | sns_bundle_send_allowed | sns_bundle_imports, sns_drafts, sns_x_send_jobs |  |  |
| guard_sns_x_approval | service だけ |  | トリガー: sns_drafts |  | sns_x_send_jobs | sns_x_send_jobs |  |
| import_sns_preview_bundle | service だけ |  | api/_lib/snsBundleImport.js:60 |  | sns_bundle_imports, sns_drafts | sns_bundle_imports, sns_drafts |  |
| read_sns_draft_diff | service だけ |  | api/_lib/snsXSendStore.js:30 / RPC から: save_sns_draft_diff | sns_diff_content, sns_mobile_revision | sns_drafts |  |  |
| renew_sns_x_send_period | service だけ |  | なし |  |  | sns_x_send_control |  |
| reserve_sns_x_read | service だけ |  | scripts/lib/snsMetricsRunner.js:528 |  | sns_x_send_control | sns_x_send_control |  |
| roll_sns_send_baselines | service だけ |  | 名前の文字列: scripts/lib/snsAutoPlanRunner.js:90 |  |  | sns_x_send_control, sns_youtube_quota_control |  |
| roll_sns_x_send_period | service だけ |  | 名前の文字列: scripts/lib/snsAutoPlanRunner.js:90 |  | sns_x_send_control | sns_x_send_control |  |
| save_sns_draft_diff | service だけ |  | api/_lib/snsXSendStore.js:36 | read_sns_draft_diff, sns_diff_content, sns_mobile_revision | sns_drafts | sns_drafts |  |
| scrape_breaker_open | service だけ |  | scripts/lib/scrapeJobs/store.js:335 / 名前の文字列: scripts/lib/scrapeJobs/store.js:356 |  |  | scrape_job_state |  |
| sns_bundle_send_allowed | service だけ |  | RPC から: approve_sns_x_send, guard_sns_preview_bundle_draft, transition_sns_send_139, transition_sns_x_send |  | sns_auto_send_items, sns_bundle_imports |  |  |
| sns_claim_external | service だけ | yes | 名前の文字列: api/_lib/snsExternalOperations.js:15, api/_lib/snsExternalOperations.js:24 |  | sns_drafts | sns_drafts |  |
| sns_diff_content | service だけ |  | RPC から: guard_sns_diff_approval, read_sns_draft_diff, save_sns_draft_diff |  |  |  |  |
| sns_finish_external | service だけ | yes | 名前の文字列: api/_lib/snsExternalOperations.js:35 |  | sns_drafts | sns_drafts |  |
| sns_guard_external | service だけ |  | トリガー: sns_drafts |  |  |  |  |
| sns_mobile_revision | service だけ |  | RPC から: read_sns_draft_diff, save_sns_draft_diff |  |  |  |  |
| sns_record_external | service だけ | yes | 名前の文字列: api/_lib/snsExternalOperations.js:31 |  |  | sns_drafts |  |
| sns_update_external_warning | service だけ | yes | 名前の文字列: api/admin/sns-hub/drafts/[id]/publish-youtube.js:210 |  |  | sns_drafts |  |
| sns_x_slot_room | service だけ |  | scripts/lib/snsXSlots.js:68 / RPC から: transition_sns_send_139 |  | sns_auto_send_items, sns_drafts, sns_x_kind_reserves, sns_x_send_control, sns_x_send_jobs |  |  |
| stop_sns_auto_item | service だけ |  | なし |  | sns_auto_send_items, sns_drafts, sns_x_send_jobs | sns_auto_send_items, sns_drafts |  |
| sweep_sns_deadline_queue | service だけ |  | api/_lib/snsXSendStore.js:53 |  |  | sns_x_send_jobs |  |
| transition_sns_send_139 | service だけ |  | RPC から: transition_sns_x_send | sns_bundle_send_allowed, sns_x_slot_room | sns_auto_send_control, sns_auto_send_items, sns_drafts, sns_x_send_control, sns_x_send_jobs | sns_drafts, sns_x_send_control, sns_x_send_jobs |  |
| transition_sns_x_send | service だけ | yes | api/_lib/snsXSendStore.js:113 | sns_bundle_send_allowed, transition_sns_send_139 | sns_auto_send_control, sns_auto_send_items, sns_drafts, sns_x_send_control, sns_x_send_jobs, sns_youtube_quota_attempts, sns_youtube_quota_control, sns_youtube_quota_reads | sns_auto_send_items, sns_drafts, sns_x_send_jobs, sns_youtube_quota_attempts, sns_youtube_quota_reads |  |
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
| analogy_v16_exhibition | api/cron/analogy-exhibition.js | 20 | analogy_v16_snapshots, scrape_job_state, scrape_slots |
| boatcast_motor_start | api/cron/boatcast-motor-start.js | 22 | scrape_job_state, scrape_slots, venue_motor_start_dates |
| boatcast_oriten | api/cron/boatcast-oriten.js | 23 | race_original_exhibition, race_original_exhibition_values, scrape_job_state, scrape_slots |
| daily_reconcile | api/cron/daily-reconcile.js | 21 | scrape_job_state, scrape_slots |
| data_health | api/cron/data-health.js | 21 | scrape_job_state, scrape_slots |
| data_health_morning | api/cron/data-health-morning.js | 21 | scrape_job_state, scrape_slots |
| db_apply_dispatch | api/cron/db-apply-dispatch.js | 17 | scrape_job_state, scrape_slots |
| e2e_rerecord_dispatch | api/cron/e2e-rerecord-dispatch.js | 16 | scrape_job_state, scrape_slots |
| entry_course_stats | api/cron/entry-course-stats.js | 27 | scrape_job_state, scrape_slots, venue_entry_course_stats |
| exhibition | api/cron/exhibition.js | 41 | exhibition_data, predictions, race_conditions, race_entries, races, scrape_job_state, scrape_slots |
| fan_period | api/cron/fan-period.js | 22 | raw_snapshots, scrape_job_state, scrape_slots |
| in_caution_dispatch | api/cron/in-caution-dispatch.js | 16 | scrape_job_state, scrape_slots |
| in_caution_health | api/cron/in-caution-health.js | 22 | scrape_job_state, scrape_slots |
| in_caution_today_health | api/cron/in-caution-today-health.js | 22 | scrape_job_state, scrape_slots |
| key_canary_dispatch | api/cron/key-canary-dispatch.js | 16 | scrape_job_state, scrape_slots |
| kfile_sync | api/cron/kfile-sync.js | 32 | predictions, race_conditions, race_payouts, race_results, race_start_timings, races, scrape_job_state, scrape_slots |
| morning_digest | api/cron/morning-digest.js | 20 | morning_digest_days, morning_digest_rows, scrape_job_state, scrape_slots |
| motor_pretest | api/cron/motor-pretest.js | 24 | scrape_job_state, scrape_slots |
| odds | api/cron/odds.js | 25 | prediction_odds, race_odds, scrape_job_state, scrape_slots |
| odds_final | api/cron/odds-final.js | 23 | race_odds, race_odds_final, scrape_job_state, scrape_slots |
| pcexpect | api/cron/pcexpect.js | 20 | external_predictions, scrape_job_state, scrape_slots |
| pit_reports | api/cron/pit-reports.js | 21 | race_pit_comments, race_pit_reports, scrape_job_state, scrape_slots |
| point_rank | api/cron/point-rank.js | 23 | racer_series_points, scrape_job_state, scrape_slots |
| pseudo | api/cron/scrape-pseudo.js | 15 | scrape_job_state, scrape_slots |
| race_info | api/cron/race-info.js | 41 | exhibition_data, predictions, race_conditions, race_entries, races, scrape_job_state, scrape_slots |
| race_notices | api/cron/race-notices.js | 21 | race_notices_health, race_special_notes, scrape_job_state, scrape_slots |
| race_series | api/cron/race-series.js | 20 | scrape_job_state, scrape_slots |
| race_status | api/cron/race-status.js | 33 | predictions, race_conditions, race_payouts, race_results, race_start_timings, races, scrape_job_state, scrape_slots |
| racer_course_technique_stats | api/cron/racer-course-technique-stats.js | 18 | racer_course_technique_stats, scrape_job_state, scrape_slots, venue_course_technique_baseline |
| racer_news | api/cron/racer-news.js | 21 | racer_news, racer_news_pending, scrape_job_state, scrape_slots |
| racer_profiles | api/cron/racer-profiles.js | 19 | racer_profiles, scrape_job_state, scrape_slots |
| races_init | api/cron/races-init.js | 41 | exhibition_data, predictions, race_conditions, race_entries, races, scrape_job_state, scrape_slots |
| result | api/cron/result.js | 32 | predictions, race_conditions, race_payouts, race_results, race_start_timings, races, scrape_job_state, scrape_slots |
| result_catchup | api/cron/result-catchup.js | 32 | predictions, race_conditions, race_payouts, race_results, race_start_timings, races, scrape_job_state, scrape_slots |
| scrape-cleanup | api/cron/scrape-cleanup.js | 17 | scrape_job_state, scrape_slots |
| scrape-monitor | api/cron/scrape-monitor.js | 18 | scrape_job_state, scrape_slots |
| sns_auto_plan | api/cron/sns-auto-plan.js | 68 | scrape_job_state, scrape_slots, sns_auto_send_items, sns_drafts, sns_post_tracking, sns_strategy_insights, sns_x_send_control |
| sns_daily | api/cron/sns-daily.js | 19 | scrape_job_state, scrape_slots, sns_channel_daily, sns_drafts, sns_strategy_insights |
| sns_metrics | api/cron/sns-metrics.js | 24 | scrape_job_state, scrape_slots, sns_drafts, sns_metric_jobs, sns_oauth_tokens, sns_strategy_insights |
| sns_send | api/cron/sns-send.js | 59 | scrape_job_state, scrape_slots, sns_drafts, sns_oauth_tokens, sns_strategy_insights, sns_x_send_control |
| venue_motor_stats | api/cron/venue-motor-stats.js | 25 | scrape_job_state, scrape_slots, venue_motor_stats |

## 表ごとの読み手・書き手

### <a id="t-accuracy_cache"></a>accuracy_cache

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/ml/analogy/in_caution_bands.py:211`, `scripts/ml/analogy/in_caution_bands.py:230`, `scripts/ml/analogy/tests/test_in_caution_bands.py:342`
- 読み手（5）: 
  - `api/accuracy/index.js:36` select(rest) [data, key]
  - `src/services/supabaseDataService.js:1865` select [data, key]
  - `src/services/supabaseDataService.js:5698` select [data, key]
  - `src/services/supabaseDataService.js:5724` select [data, key]
  - `src/services/supabaseDataService.js:5746` select [data, key]
- 書き手（3）: 
  - `scripts/daily/calculate-accuracy.js:482` upsert [data, key, updated_at]
  - `scripts/daily/calculate-unified-model-accuracy.js:171` upsert [data, key, updated_at]
  - `scripts/daily/calculate-unified-volatility-accuracy.js:166` upsert [data, key, updated_at]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-analogy_contribution_profiles"></a>analogy_contribution_profiles

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/ml/analogy/db.py:96`, `scripts/ml/analogy/db.py:119`, `scripts/ml/analogy/db.py:153`, `scripts/ml/analogy/db.py:172`, `scripts/ml/analogy/tests/test_db.py:69`
- 読み手（2）: 
  - `api/analogy/contribution.js:108` rest(rest) [boat_number, breakdown, frame_ratio, grade, n_boats, n_races, period_from, period_to, round, share_sd, shares, venue_code]
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
  - `api/analogy/contribution.js:101` rest(rest) [is_active, metrics, model_version, themes, trained_at]
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
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:85` select [race_id, stage, status]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:132` select [computed_at, race_id, run_id, stage]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:190` select [computed_at, race_id, run_id, stage]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:372` select [n_layer, race_id, stage, status]
  - `scripts/lib/analogyDispatch.js:80` select [race_id, stage]
  - `scripts/lib/analogyV16Exhibition.js:289` rest(rest) [model_version, n_layer, pool_cutoff, race_id, run_id, stage, status]
  - `scripts/maintenance/verify-analogy-v16.js:269` rest(rest) [stage] （検査）
  - `scripts/maintenance/verify-analogy-v16.js:279` rest(rest) [computed_at, exact, race_id, stage, status] （検査）
  - `scripts/maintenance/verify-analogy-v16.js:281` rest(rest) [race_id, stage] （検査）
- 書き手（1）: 
  - `scripts/lib/analogyV16Exhibition.js:367` upsert(rest) [?]
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
  - `scripts/daily/update-moriarty-outcomes.js:30` select [actual_hit, bet_fraction, created_at, expected_value, model_id, race_id, reasons, recommendation]
  - `src/services/moriartyService.js:68` select [model_id, race_id, recommendation]
  - `src/services/moriartyService.js:141` select [actual_hit, actual_payout, bet_fraction, expected_value, model_id, race_id, reasons, recommendation]
  - `src/services/moriartyService.js:268` select [actual_hit, expected_value, model_id, recommendation]
  - `src/services/supabaseDataService.js:7666` select [expected_hit_rate, expected_payout, expected_value, model_id, race_id, reasons, recommendation]
- 書き手（4）: 
  - `scripts/daily/generate-moriarty-recommendations.js:348` upsert [?]
  - `scripts/daily/generate-unified-trifecta-reference.js:202` delete
  - `scripts/daily/generate-unified-trifecta-reference.js:214` insert [?]
  - `scripts/daily/update-moriarty-outcomes.js:173` update [actual_hit, actual_payout]
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
- 読み手（47）: 
  - `api/_lib/analogyV16.js:103` rest(rest) [boat_number, exhibition_time, is_absent, race_id]
  - `api/_lib/racerEntryExhibition.js:192` rest(rest) [boat_number, exhibition_time, is_absent, race_id]
  - `api/_lib/snsClaimCheck.js:218` rest(rest) [is_absent, race_id]
  - `api/_lib/snsClaimCheck.js:249` rest(rest) [is_absent, race_id]
  - `api/_lib/snsClaimCheck.js:336` rest(rest) [is_absent, race_id]
  - `api/_lib/snsClaimCheck.js:380` rest(rest) [is_absent, race_id]
  - `api/_lib/snsTodayDigest.js:54` rest(rest) [boat_number, is_absent, race_id]
  - `scripts/analysis/original-exhibition/fetch.mjs:59` select(helper:all)
  - `scripts/analysis/train-conditional-logit.js:90` select(helper:fetchAll)
  - `scripts/analysis/verify-race-analysis-rpc.js:35` select [boat_number, race_id, start_timing]
  - `scripts/analysis/verify-race-analysis-rpc.js:78` select(helper:fetchAll)
  - `scripts/analysis/verify-race-analysis-rpc.js:127` select [boat_number, exhibition_time, race_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:151` select [boat_number, exhibition_time, race_id]
  - `scripts/daily/generate-predictions.js:1111` select(helper:upsertChangedRows)
  - `scripts/daily/generate-predictions.js:1342` select(helper:selectByRaceIds)
  - `scripts/daily/scrape-exhibition-data.js:79` select(helper:fetchAll)
  - `scripts/daily/scrape-exhibition-data.js:265` select(helper:upsertChangedRows)
  - `scripts/daily/scrape-exhibition-data.js:536` select [exhibition_time, race_id, start_timing]
  - `scripts/daily/update-exhibition-time-top-stats.js:173` select(helper:fetchAll)
  - `scripts/lib/analogyV16Exhibition.js:208` rest(rest) [boat_number, exhibition_course, exhibition_time, is_absent, race_id, start_flag, start_timing]
  - `scripts/lib/analogyV16Exhibition.js:296` rest(rest) [boat_number, exhibition_time, is_absent, race_id]
  - `scripts/maintenance/backfill-exhibition-by-race-id.js:48` select [race_id]
  - `scripts/maintenance/backfill-opening-day-races.js:97` select(helper:count)
  - `scripts/maintenance/check-exhibition-gap-rate.js:46` select(helper:fetchAll)
  - `scripts/maintenance/check-pre-race-shadow.js:319` select(helper:fetchByRaceIds)
  - `scripts/maintenance/verify-analogy-v16.js:286` rest(rest) [boat_number, exhibition_time, is_absent, race_id] （検査）
  - `scripts/ml/export-inference-data.js:115` select(helper:fetchByRaceIds)
  - `scripts/ml/export-training-data.js:79` select(helper:fetchAll)
  - `src/services/racerService.js:153` select [boat_number, exhibition_time, parts_changed, propeller_change, race_id]
  - `src/services/sherlockService.js:83` select [boat_number, exhibition_time, race_id, start_timing]
  - `src/services/supabaseDataService.js:467` select [boat_number, race_id, start_flag]
  - `src/services/supabaseDataService.js:770` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:3716` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4497` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4572` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4716` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4968` select [boat_number, race_id, start_timing]
  - `src/services/supabaseDataService.js:5021` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:5109` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:5187` select [boat_number, exhibition_time, race_id]
  - `src/services/supabaseDataService.js:5230` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:5300` select [adjustment_weight, boat_number, exhibition_course, exhibition_time, is_absent, parts_changed, prev_entry_course, prev_finish_mark, prev_finish_rank, prev_race_no, prev_start_timing, propeller_change, race_id, tilt, today_weight, updated_at]
  - `src/services/supabaseDataService.js:5316` select [adjustment_weight, boat_number, exhibition_time, parts_changed, propeller_change, race_id, tilt]
  - `src/services/supabaseDataService.js:5378` select [boat_number, exhibition_time, is_absent, race_id, start_flag, start_timing, tilt]
  - `src/services/supabaseDataService.js:5427` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:5776` select [boat_number, exhibition_time, race_id, start_flag, start_timing]
  - `src/services/supabaseDataService.js:6765` select [boat_number, exhibition_time, race_id]
- 書き手（3）: 
  - `scripts/daily/generate-predictions.js:1111` upsert(helper:upsertChangedRows) [?]
  - `scripts/daily/scrape-exhibition-data.js:265` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/verify-pre-race-parsers.js:1868` upsert [?] （検査）
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-exhibition_time_top_stats"></a>exhibition_time_top_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（1）: 
  - `src/services/supabaseDataService.js:7645` select [*, boat_number, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-exhibition-time-top-stats.js:137` delete
  - `scripts/daily/update-exhibition-time-top-stats.js:146` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-external_predictions"></a>external_predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: pcexpect
- 読み手（2）: 
  - `scripts/analysis/compare-pcexpect.js:129` select [payload, race_date, race_no, source, venue_code]
  - `scripts/maintenance/check-morning-init-shadow.js:238` select [payload, race_date, race_no, scraped_at, source, venue_code]
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
- 読み手（1）: 
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:241` select [boat_number, course, finish_raw, is_flying, is_late_start, race_id, start_timing]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-kb_archive_races"></a>kb_archive_races

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:70`
- 読み手（3）: 
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:237` select [has_result, payout_3fuku, payout_3tan, race_id]
  - `scripts/daily/update-winning-technique-stats.js:212` select(helper:fetchAll)
  - `scripts/maintenance/verify-full-picture-scene2.js:1214` rest(rest) （検査）
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-kb_archive_venue_days"></a>kb_archive_venue_days

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:71`
- 読み手（0）: なし
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-losing_technique_stats"></a>losing_technique_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/maintenance/verify-full-picture-scene2.js:1188` rest(rest) （検査）
  - `src/services/supabaseDataService.js:6504` select [*, boat_number, percentage, venue_code]
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
  - `scripts/daily/update-moriarty-outcomes.js:273` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: place_hits, trifecta_hits, payout_trifecta, recovery_rate_trifecta, by_volatility

### <a id="t-models"></a>models

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_production_models
- 本体で読む RPC: get_accuracy_summary
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-perrace/finish_targets.py:335`, `scripts/analysis/analogy-finder-perrace/race_level.py:396`, `scripts/analysis/analogy-finder-perrace/race_level.py:397`, `scripts/analysis/analogy-finder-perrace/race_level.py:398`, `scripts/analysis/analogy-finder-perrace/venue_magnitude.py:26`, `scripts/analysis/boa845-axis-place/effect.py:98`, `scripts/ml/analogy/make_treeshap_testdata.py:209`, `scripts/ml/analogy/make_treeshap_testdata.py:214`, `scripts/ml/analogy/perrace.py:53`, `scripts/ml/analogy/tests/test_perrace.py:75`, `scripts/ml/analogy/tests/test_perrace.py:76`, `scripts/ml/analogy/tests/test_perrace.py:77`, `scripts/ml/analogy/tests/test_perrace.py:85`, `scripts/ml/predict.py:26`, `scripts/ml/predict_mycroft.py:30`, `scripts/ml/predict_watson.py:26`, `scripts/ml/train_mycroft.py:37`, `scripts/ml/train_rf.py:28`, `scripts/ml/train_v2.py:29`, `scripts/ml/train_watson.py:42`, `scripts/ml/watson_scores.py:23`
- 読み手（2）: 
  - `scripts/daily/calculate-accuracy.js:370` select [hit_rate_place, hit_rate_trifecta, hit_rate_trio, hit_rate_win, model_id, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio, recovery_rate_win, total_predictions]
  - `src/services/supabaseDataService.js:1568` select [display_name, hit_rate_place, hit_rate_trifecta, hit_rate_trio, hit_rate_win, model_id, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio, recovery_rate_win, total_predictions]
- 書き手（1）: 
  - `scripts/daily/calculate-accuracy.js:536` update [hit_rate_place, hit_rate_trifecta, hit_rate_trio, hit_rate_win, last_evaluated_at, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio, recovery_rate_win, total_predictions, updated_at]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-morning_digest_days"></a>morning_digest_days

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: morning_digest
- 読み手（2）: 
  - `scripts/maintenance/verify-morning-digest.js:40` select [digest_date, generated_at, notes, race_count, venue_count] （検査）
  - `src/services/supabaseDataService.js:7943` select [*, digest_date]
- 書き手（2）: 
  - `scripts/daily/generate-morning-digest.js:893` upsert [?]
  - `scripts/daily/generate-morning-digest.js:922` update [generated_at]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-morning_digest_rows"></a>morning_digest_rows

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: morning_digest
- 読み手（2）: 
  - `scripts/maintenance/verify-morning-digest.js:58` select [*, digest_date] （検査）
  - `src/services/supabaseDataService.js:7948` select [*, digest_date, rank, section]
- 書き手（3）: 
  - `scripts/daily/generate-morning-digest.js:898` delete
  - `scripts/daily/generate-morning-digest.js:907` insert [?]
  - `scripts/daily/generate-morning-digest.js:915` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-motor_pretest_stats"></a>motor_pretest_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 読み手（5）: 
  - `scripts/maintenance/verify-pretest-row-pick.js:74` select [pretest_rank, pretest_time, race_date, racer_id, series_title, venue_code] （検査）
  - `src/services/supabaseDataService.js:3478` select [race_date, venue_code]
  - `src/services/supabaseDataService.js:3498` select [motor_2rate, motor_number, pretest_time, race_date, racer_id, venue_code]
  - `src/services/supabaseDataService.js:6741` select [motor_number, pretest_rank, pretest_time, race_date, racer_class, racer_id, venue_code]
  - `src/services/supabaseDataService.js:8016` select [pretest_rank, pretest_time, race_date, racer_id, venue_code]
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: boat_number, boat_2rate, created_at, updated_at

### <a id="t-mycroft_predictions"></a>mycroft_predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/fix-opening-day-race-id-date.js:77`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:50`
- 読み手（1）: 
  - `src/services/mycroftService.js:95` select [attention_evidence, model_trained_at, predicted_at, race_id, rank_order, win_probs]
- 書き手（1）: 
  - `scripts/daily/generate-mycroft-predictions.js:97` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-nige_outcome_distribution"></a>nige_outcome_distribution

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（1）: 
  - `src/services/supabaseDataService.js:7556` select [*, count_90days, first_boat, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-nige-outcome-distribution.js:119` delete
  - `scripts/daily/update-nige-outcome-distribution.js:129` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-nige_second_by_course"></a>nige_second_by_course

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/daily/update-course-baseline-stats.js:168` select(helper:upsertChangedRows)
  - `src/services/supabaseDataService.js:7522` select [exacta_rate, nige_races, second_count, second_course, second_rate, total_races, venue_code, window_days, window_end, window_start]
- 書き手（1）: 
  - `scripts/daily/update-course-baseline-stats.js:168` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-outcome_distribution"></a>outcome_distribution

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（7）: 
  - `api/outcome-distribution/index.js:71` select(rest) [count_90days, first_boat, venue_code]
  - `scripts/analysis/turnprediction-guided-outcome-distribution.js:127` select(helper:fetchAll)
  - `scripts/analysis/validate-outcome-distribution.js:143` select(helper:fetchAll)
  - `scripts/analysis/verify-outcome-distribution-coverage.js:26` select(helper:fetchAll)
  - `scripts/maintenance/verify-full-picture-scene2.js:1030` rest(rest) （検査）
  - `src/services/supabaseDataService.js:2055` select [count_90days, first_boat]
  - `src/services/supabaseDataService.js:2108` select [*, count_90days, first_boat, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-outcome-distribution.js:114` delete
  - `scripts/daily/update-outcome-distribution.js:125` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-poirot_predictions"></a>poirot_predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_morning_freshness
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/fix-opening-day-race-id-date.js:78`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:51`
- 読み手（2）: 
  - `scripts/analysis/verify-poirot.js:61` select(helper:fetchAll)
  - `src/services/poirotService.js:59` select [model_version, predicted_at, race_id, top_2nd, top_3rd, top_pick, trifecta_prob, win_probs]
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
  - `scripts/daily/scrape-prediction-odds.js:219` upsert [?]
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
- 読み手（55）: 
  - `scripts/analysis/analyze-prediction-ensemble.js:66` select(helper:fetchAll)
  - `scripts/analysis/analyze-upset-factors.js:133` select [feature_contributions, model_id, race_id]
  - `scripts/analysis/analyze-venue-03-trifecta.js:54` select [confidence, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/analysis/analyze-venue-03-trio.js:54` select [confidence, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/analysis/analyze-venue-03.js:78` select [confidence, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/analysis/analyze-venue-generic.js:36` select [confidence, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/analysis/calibration-report.js:95` select(helper:fetchAll)
  - `scripts/analysis/campaign-backtest-fetch-races.js:49` select [feature_contributions, predicted_at, race_id]
  - `scripts/analysis/collect-venue-stats.js:215` select [confidence, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/analysis/compare-pcexpect.js:120` select [is_shadow, model_id, payout_trio, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/analysis/discover-exacta-rules.js:53` select(helper:fetchAll)
  - `scripts/analysis/expected-value-report.js:74` select(helper:fetchAll)
  - `scripts/analysis/find-missing-dates.js:32` select [*, race_id]
  - `scripts/analysis/find-video-worthy-race.js:80` select [feature_contributions, model_id, predicted_at, race_id]
  - `scripts/analysis/recalculate-all-rules.js:211` select(helper:fetchAll)
  - `scripts/analysis/recalculate-trio-rules.js:125` select(helper:fetchAll)
  - `scripts/analysis/simulate-nige-calibration.js:37` select(helper:fetchAll)
  - `scripts/analysis/train-moriarty-calibration.js:67` select(helper:fetchAll)
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:84` select [feature_contributions, model_id, prediction_id, race_id]
  - `scripts/analysis/turnprediction-guided-outcome-distribution.js:169` select(helper:fetchAll)
  - `scripts/analysis/validate-outcome-distribution.js:216` select(helper:fetchAll)
  - `scripts/analysis/verify-calculations.js:23` select [model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/daily-rule-tracking.js:129` select [*, model_id, race_id]
  - `scripts/daily/calculate-accuracy.js:45` select(helper:fetchAll)
  - `scripts/daily/calculate-accuracy.js:119` select(helper:fetchAll)
  - `scripts/daily/calculate-unified-model-accuracy.js:66` select(helper:fetchAll)
  - `scripts/daily/calculate-unified-volatility-accuracy.js:68` select(helper:fetchAll)
  - `scripts/daily/generate-moriarty-recommendations.js:81` select [is_shadow, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/daily/generate-morning-digest.js:326` select [feature_contributions, model_id, race_id]
  - `scripts/daily/generate-unified-predictions.js:187` select(helper:fetchAll)
  - `scripts/daily/generate-unified-predictions.js:282` select(helper:fetchAll)
  - `scripts/daily/generate-unified-predictions.js:295` select(helper:fetchAll)
  - `scripts/daily/generate-unified-trifecta-reference.js:44` select [feature_contributions, is_shadow, model_id, race_id]
  - `scripts/daily/scrape-prediction-odds.js:40` select [is_shadow, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/daily/scrape-results.js:1004` select [feature_contributions, model_id, prediction_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/daily/scrape-results.js:1585` select(helper:fetchAll)
  - `scripts/daily/todays-volatility-digest.js:56` select [feature_contributions, model_id, race_id]
  - `scripts/daily/update-race-history-cache.js:27` select(helper:fetchAll)
  - `scripts/lib/inCautionHealth.js:127` select [feature_contributions, model_id, race_id]
  - `scripts/lib/scrapeJobs/predictionOddsHandlers.js:50` select [is_shadow, model_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/maintenance/backfill-is-hit-turn.js:28` select(helper:fetchAll)
  - `scripts/maintenance/backfill-missing-venue-day.js:138` select [race_id]
  - `scripts/maintenance/backfill-place-hits.js:14` select [is_hit_place, prediction_id, race_id, top_pick]
  - `scripts/maintenance/backfill-refund-hit-flags.js:87` select(helper:fetchAll)
  - `scripts/maintenance/backfill-refund-hit-flags.js:106` select(helper:fetchAll)
  - `scripts/maintenance/backfill-trifecta-trio.js:37` select [model_id, prediction_id, race_id, top_2nd, top_3rd, top_pick]
  - `scripts/maintenance/build-races-derived-backfill-sql.js:122` select(helper:fetchAll)
  - `scripts/maintenance/delete-cancelled-race-predictions.js:72` select [prediction_id, race_id]
  - `scripts/maintenance/delete-phantom-races.js:138` select [is_hit_place, is_hit_trifecta, is_hit_trio, is_hit_win, race_id]
  - `scripts/maintenance/verify-admin-rule-performance.js:268` select [confidence, model_id, predicted_at, race_id, top_2nd, top_3rd, top_pick] （検査）
  - `scripts/maintenance/verify-full-picture-scene2.js:1051` rest(rest) （検査）
  - `src/services/adminRuleService.js:69` select [confidence, model_id, predicted_at, race_id, top_2nd, top_3rd, top_pick]
  - `src/services/ruleMatchService.js:104` select [confidence, model_id, predicted_at, race_id, top_2nd, top_3rd, top_pick]
  - `src/services/supabaseDataService.js:1585` select [is_hit_place, is_hit_trifecta, is_hit_trio, is_hit_win, model_id, payout_place, payout_trifecta, payout_trio, payout_win, race_id]
  - `src/services/supabaseDataService.js:5481` select [feature_contributions, model_id, predicted_at, race_id]
- 書き手（10）: 
  - `scripts/daily/generate-predictions.js:1761` upsert [?]
  - `scripts/daily/generate-unified-predictions.js:508` upsert [?]
  - `scripts/daily/scrape-results.js:1026` update [?]
  - `scripts/daily/scrape-results.js:1634` update [?]
  - `scripts/maintenance/backfill-is-hit-turn.js:69` update [is_hit_turn]
  - `scripts/maintenance/backfill-place-hits.js:60` update [is_hit_place, payout_place]
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
- 読み手（39）: 
  - `api/_lib/racerEntryExhibition.js:173` rest(rest) [is_final_day, race_id, series_day]
  - `api/_lib/snsClaimCheck.js:250` rest(rest) [race_id, race_stage]
  - `api/admin/sns-hub/send-probe.js:66` rest(rest) [race_id, race_stage]
  - `scripts/analysis/backtest-unified-model-place-trifecta.js:101` select [race_id, wave_height, wind_speed]
  - `scripts/analysis/backtest-unified-model.js:116` select [race_id, wave_height, wind_speed]
  - `scripts/analysis/boa845-axis-place/fetch_today.mjs:40` select(helper:all)
  - `scripts/analysis/calibrate-unified-model.js:167` select [race_id, wave_height, wind_speed]
  - `scripts/analysis/race-stage-inventory.mjs:31` select(helper:fetchAllByRaceId)
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:180` select(helper:fetchAllByRaceId)
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:131` select [race_id, wave_height, weather, wind_direction, wind_speed]
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:98` select [race_id, wave_height, wind_speed]
  - `scripts/analysis/verify-volatility-predictive-power.js:83` select [race_id, wave_height, wind_speed]
  - `scripts/daily/generate-predictions.js:1341` select(helper:selectByRaceIds)
  - `scripts/daily/generate-unified-predictions.js:70` select(helper:fetchAll)
  - `scripts/daily/scrape-point-rank.js:194` select [race_id, series_day]
  - `scripts/lib/analogyV16Exhibition.js:184` rest(rest) [race_id, wave_height, weather, weather_observed_at, wind_direction, wind_speed]
  - `scripts/lib/raceConditionsWriter.js:44` select(helper:upsertChangedRows)
  - `scripts/lib/snsAutoPlanRunner.js:744` rest(rest) [race_id, race_stage]
  - `scripts/maintenance/backfill-opening-day-races.js:96` select(helper:count)
  - `scripts/maintenance/backfill-race-conditions.js:77` select [race_id]
  - `scripts/maintenance/backfill-race-series-meta.js:162` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:302` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:355` select(helper:fetchAll)
  - `scripts/maintenance/backfill-series-day.js:58` select(helper:fetchAll)
  - `scripts/maintenance/check-pre-race-shadow.js:305` select(helper:fetchByRaceIds)
  - `scripts/maintenance/verify-full-picture-scene2.js:1212` rest(rest) [race_id, race_stage] （検査）
  - `scripts/ml/analogy/build-wind-basis.js:95` select [race_id, wind_direction, wind_speed]
  - `scripts/ml/export-inference-data.js:119` select(helper:fetchByRaceIds)
  - `scripts/ml/export-training-data.js:83` select(helper:fetchAll)
  - `scripts/sns/push-finals-image.js:1164` rest(rest) [race_id, race_stage]
  - `scripts/verification/verify-series-points-border.mjs:79` select [race_id, race_stage]
  - `scripts/verification/verify-series-points-needed.mjs:74` select [race_id, race_stage]
  - `scripts/verification/verify-series-points-official.mjs:155` select [is_final_day, race_id, race_stage]
  - `src/services/supabaseDataService.js:629` select [is_final_day, race_id, series_day]
  - `src/services/supabaseDataService.js:3221` select [race_id, race_stage]
  - `src/services/supabaseDataService.js:4507` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4722` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:6677` select [is_final_day, race_id, race_stage, race_title, series_day]
  - `src/services/supabaseDataService.js:7222` select [is_final_day, race_id, race_stage, race_title, series_day]
- 書き手（6）: 
  - `scripts/lib/raceConditionsWriter.js:44` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-race-conditions.js:185` upsert [?]
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
- 読み手（140）: 
  - `api/_lib/analogyV16.js:105` rest(rest) [boat_number, is_absent, race_id]
  - `api/_lib/racerEntryExhibition.js:171` rest(rest) [boat_number, race_id, racer_id]
  - `api/_lib/snsClaimCheck.js:217` rest(rest) [is_absent, race_id]
  - `api/_lib/snsClaimCheck.js:248` rest(rest) [is_absent, race_id]
  - `api/_lib/snsClaimCheck.js:335` rest(rest) [is_absent, race_id]
  - `api/_lib/snsClaimCheck.js:379` rest(rest) [is_absent, race_id]
  - `api/_lib/snsTodayDigest.js:52` rest(rest) [boat_number, is_absent, race_id]
  - `scripts/analysis/aggregate-racer-stats.js:569` select [racer_id]
  - `scripts/analysis/analyze-indicator-predictive-power.js:148` select [boat_number, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/analyze-venue-03-trifecta.js:67` select [boat_number, grade, motor_2rate, race_id, win_rate]
  - `scripts/analysis/analyze-venue-03-trio.js:67` select [boat_number, grade, motor_2rate, race_id, win_rate]
  - `scripts/analysis/analyze-venue-03.js:106` select [boat_2rate, boat_number, grade, local_win_rate, motor_2rate, race_id, win_rate]
  - `scripts/analysis/backtest-course-rate-only.js:81` select [boat_number, race_id, racer_id]
  - `scripts/analysis/backtest-unified-model-place-trifecta.js:85` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/backtest-unified-model.js:100` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/boa845-axis-place/fetch_today.mjs:39` select(helper:all)
  - `scripts/analysis/calibrate-unified-model.js:151` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/campaign-backtest-fetch-races.js:96` select [boat_2rate, boat_3rate, boat_number, grade, local_win_rate, motor_2rate, motor_3rate, player_name, race_id, win_rate]
  - `scripts/analysis/collect-venue-stats.js:245` select [boat_number, grade, motor_2rate, race_id, win_rate]
  - `scripts/analysis/compare-course-rate-sources.js:59` select(helper:fetchAll)
  - `scripts/analysis/find-missing-dates.js:31` select [*, race_id]
  - `scripts/analysis/full-picture-boat1-return/analyze-boat1-return-rate-noise.mjs:37` select(helper:fetchAll)
  - `scripts/analysis/original-exhibition/fetch.mjs:74` select(helper:all)
  - `scripts/analysis/past-rate-check/label-threshold-checks.mjs:86` select [race_id]
  - `scripts/analysis/past-rate-check/label-threshold-checks.mjs:87` select [boat_number, created_at, race_id, updated_at]
  - `scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js:82` select(helper:fetchAllPages)
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:185` select(helper:fetchAllByRaceId)
  - `scripts/analysis/train-conditional-logit.js:85` select(helper:fetchAll)
  - `scripts/analysis/train-moriarty-calibration.js:77` select(helper:fetchAll)
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:125` select [boat_number, grade, race_id, win_rate]
  - `scripts/analysis/verify-race-analysis-rpc.js:28` select [boat_number, player_name, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:49` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:120` select [boat_number, player_name, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:141` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:188` select [boat_number, player_name, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:201` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:253` select [boat_number, player_name, race_id, racer_id]
  - `scripts/analysis/verify-race-analysis-rpc.js:268` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:134` select [boat_number, race_id, racer_id]
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:82` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/analysis/verify-volatility-predictive-power.js:69` select [boat_number, race_id, racer_id, win_rate]
  - `scripts/daily/generate-moriarty-recommendations.js:122` select [ai_score_safe_bet, ai_score_standard, ai_score_upset_focus, boat_number, race_id]
  - `scripts/daily/generate-morning-digest.js:155` select [boat_number, grade, is_absent, motor_2rate, motor_number, player_name, race_id, racer_id]
  - `scripts/daily/generate-predictions.js:1076` select(helper:upsertChangedRows)
  - `scripts/daily/generate-predictions.js:1340` select(helper:selectByRaceIds)
  - `scripts/daily/generate-unified-predictions.js:61` select(helper:fetchAll)
  - `scripts/daily/generate-unified-predictions.js:271` select(helper:fetchAll)
  - `scripts/daily/generate-unified-trifecta-reference.js:104` select [boat_number, grade, local_win_rate, motor_2rate, race_id, racer_id, win_rate]
  - `scripts/daily/morning-init.js:298` select(helper:fetchAll)
  - `scripts/daily/scrape-venue-entry-course-stats.js:91` select(helper:fetchAll)
  - `scripts/daily/update-race-info.js:443` select(helper:upsertChangedRows)
  - `scripts/lib/analogyV16Exhibition.js:299` rest(rest) [is_absent, race_id]
  - `scripts/lib/motorPretestRows.js:134` select [race_id, racer_id]
  - `scripts/lib/pitReportJob.js:188` select [boat_number, race_id, racer_id]
  - `scripts/lib/raceIndicatorData.js:72` select [boat_number, race_id, racer_id, win_rate]
  - `scripts/lib/raceIndicatorData.js:87` select [race_id, racer_id, win_rate]
  - `scripts/lib/racelistBackfillRows.js:127` select [race_id]
  - `scripts/lib/racerProfileSync.js:335` select [boat_number, race_id, racer_id]
  - `scripts/lib/racerStStats.js:127` select(helper:fetchAll)
  - `scripts/maintenance/audit-race-entries-vs-kb.js:68` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:154` select(helper:fetchAll)
  - `scripts/maintenance/backfill-opening-day-races.js:95` select(helper:count)
  - `scripts/maintenance/backfill-pit-reports.js:146` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-entries-racer-id-remaining.js:69` select(helper:fetchAllPaged)
  - `scripts/maintenance/backfill-race-entries-racer-id-remaining.js:108` select(helper:fetchAllPaged)
  - `scripts/maintenance/backfill-race-entries-racer-id.js:101` select(helper:fetchAllPaged)
  - `scripts/maintenance/backfill-racer-ids.js:128` select [boat_number, race_id, racer_id]
  - `scripts/maintenance/build-races-derived-backfill-sql.js:157` select(helper:fetchAll)
  - `scripts/maintenance/check-morning-init-shadow.js:152` select [age, boat_number, boat_number_id, grade, motor_number, race_id, racer_id]
  - `scripts/maintenance/check-pre-race-shadow.js:299` select(helper:fetchByRaceIds)
  - `scripts/maintenance/delete-phantom-race-days.js:112` select [boat_number, race_id, racer_id]
  - `scripts/maintenance/fix-opening-day-entries-from-b.js:290` select(helper:fetchAll)
  - `scripts/maintenance/racelist-backfill.js:366` select(helper:fetchExistingRows)
  - `scripts/maintenance/racelist-backfill.js:411` select(helper:upsertChangedRows)
  - `scripts/maintenance/racelist-backfill.js:458` select [race_id]
  - `scripts/maintenance/restore-contaminated-race-entries.js:81` select(helper:fetchAll)
  - `scripts/maintenance/restore-contaminated-race-entries.js:206` select(helper:upsertChangedRows)
  - `scripts/maintenance/restore-entries-branch-hometown.js:39` select(helper:fetchAll)
  - `scripts/maintenance/restore-entries-branch-hometown.js:119` select(helper:upsertChangedRows)
  - `scripts/maintenance/verify-analogy-v16.js:289` rest(rest) [is_absent, race_id] （検査）
  - `scripts/maintenance/verify-data-readers.js:557` select(embed) [racer_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:47` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:48` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:52` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:53` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:57` rest(rest) [name, race_id] （検査）
  - `scripts/maintenance/verify-e2e-har-merge.js:58` rest(rest) [name, race_id] （検査）
  - `scripts/maintenance/verify-full-picture-scene2.js:1092` rest(rest) （検査）
  - `scripts/maintenance/verify-pretest-row-pick.js:93` select(embed) [racer_id] （検査）
  - `scripts/ml/export-inference-data.js:111` select(helper:fetchByRaceIds)
  - `scripts/ml/export-training-data.js:75` select(helper:fetchAll)
  - `scripts/verification/verify-series-points-border.mjs:47` select [boat_number, player_name, race_id, racer_id]
  - `scripts/verification/verify-series-points-needed.mjs:41` select [boat_number, player_name, race_id, racer_id]
  - `scripts/verification/verify-series-points-official.mjs:146` select [boat_number, player_name, race_id, racer_id]
  - `src/services/mycroftService.js:82` select [boat_number, player_name, race_id]
  - `src/services/racerService.js:31` select [grade, race_id, racer_id]
  - `src/services/racerService.js:84` select [boat_number, motor_number, race_id, racer_id]
  - `src/services/racerService.js:118` select [motor_number, race_id, racer_id]
  - `src/services/sherlockService.js:77` select [boat_2rate, boat_number, grade, local_win_rate, motor_2rate, player_name, race_id, win_rate]
  - `src/services/supabaseDataService.js:513` select [?, race_id, racer_id]
  - `src/services/supabaseDataService.js:658` select [motor_2rate, race_id]
  - `src/services/supabaseDataService.js:757` select [boat_number, motor_2rate, motor_3rate, motor_number, race_id]
  - `src/services/supabaseDataService.js:2331` select [boat_number, f_count, global_2rate, global_3rate, l_count, local_2rate, local_3rate, local_win_rate, race_id, win_rate]
  - `src/services/supabaseDataService.js:2367` select [boat_number, f_count, race_id, racer_id]
  - `src/services/supabaseDataService.js:2379` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:2455` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:2466` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:2634` select [boat_number, motor_2rate, motor_3rate, motor_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:2911` select [boat_number, global_2rate, motor_number, race_id]
  - `src/services/supabaseDataService.js:3011` select [boat_number, grade, motor_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:3239` select [boat_number, motor_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:3503` select [motor_2rate, motor_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:3697` select [boat_number, motor_number, race_id]
  - `src/services/supabaseDataService.js:3853` select [boat_number, motor_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:3950` select [boat_number, local_win_rate, player_name, race_id, racer_id, win_rate]
  - `src/services/supabaseDataService.js:3973` select [race_id, racer_id, win_rate]
  - `src/services/supabaseDataService.js:4016` select [local_win_rate, race_id, racer_id, win_rate]
  - `src/services/supabaseDataService.js:4052` select [local_win_rate, race_id, racer_id, win_rate]
  - `src/services/supabaseDataService.js:4072` select [race_id, racer_id, win_rate]
  - `src/services/supabaseDataService.js:4109` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:4555` select [boat_number, motor_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:4767` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:4958` select [boat_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:4993` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:5089` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:5177` select [boat_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:5211` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:5348` select [boat_number, race_id, weight_kg]
  - `src/services/supabaseDataService.js:5415` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:5519` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:5769` select [age, boat_number, global_2rate, grade, local_win_rate, motor_2rate, motor_number, player_name, race_id, win_rate]
  - `src/services/supabaseDataService.js:5844` select [boat_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:5874` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:5988` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:6020` select [race_id, racer_id, win_rate]
  - `src/services/supabaseDataService.js:6372` select [boat_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:6397` select [boat_number, race_id, racer_id]
  - `src/services/supabaseDataService.js:6667` select [boat_number, motor_number, player_name, race_id, racer_id]
  - `src/services/supabaseDataService.js:7237` select [boat_number, player_name, race_id, racer_id]
  - `src/services/watsonService.js:75` select [boat_number, player_name, race_id]
- 書き手（10）: 
  - `scripts/daily/generate-predictions.js:1076` upsert(helper:upsertChangedRows) [?]
  - `scripts/daily/update-race-info.js:443` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-race-data.js:196` upsert [?]
  - `scripts/maintenance/backfill-race-entries-racer-id-remaining.js:155` update [racer_id]
  - `scripts/maintenance/backfill-race-entries-racer-id.js:155` update [racer_id]
  - `scripts/maintenance/backfill-racer-ids.js:229` update [racer_id]
  - `scripts/maintenance/migrate-to-supabase.js:259` upsert [?]
  - `scripts/maintenance/racelist-backfill.js:411` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/restore-contaminated-race-entries.js:206` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/restore-entries-branch-hometown.js:119` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_history_cache"></a>race_history_cache

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `api/race-history/summary.js:42` select(rest) [data, key]
  - `src/services/supabaseDataService.js:1964` select [data, key]
- 書き手（1）: 
  - `scripts/daily/update-race-history-cache.js:121` upsert [data, key, updated_at]

### <a id="t-race_notices_health"></a>race_notices_health

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: race_notices
- 読み手（2）: 
  - `scripts/daily/scrape-race-information.js:349` select [check_date, had_success, last_reason, venue_code]
  - `scripts/maintenance/check-race-notices-drift.js:75` select [check_date, had_success, last_reason, venue_code]
- 書き手（1）: 
  - `scripts/daily/scrape-race-information.js:614` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: last_checked_at

### <a id="t-race_odds"></a>race_odds

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_coverage, data_health_table_rows
- 取得のジョブ: odds, odds_final
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/delete-phantom-races.js:75`, `scripts/maintenance/fix-opening-day-race-id-date.js:71`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:44`
- 読み手（15）: 
  - `scripts/analysis/analyze-odds-momentum.js:54` select(helper:fetchAll)
  - `scripts/analysis/backtest-unified-model.js:73` select(helper:fetchAll)
  - `scripts/analysis/check-win-odds-vs-final.js:45` select(helper:fetchAll)
  - `scripts/analysis/train-conditional-logit.js:103` select(helper:fetchAll)
  - `scripts/analysis/train-moriarty-calibration.js:83` select(helper:fetchAll)
  - `scripts/daily/generate-moriarty-recommendations.js:97` select [captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6, race_id]
  - `scripts/daily/generate-unified-trifecta-reference.js:55` select(helper:fetchAll)
  - `scripts/daily/scrape-odds.js:592` select(helper:fetchAll)
  - `scripts/daily/scrape-odds.js:887` select [*, race_id, window_min]
  - `scripts/daily/scrape-odds.js:975` select [?, captured_at, race_id]
  - `scripts/lib/scrapeJobs/predictionOddsHandlers.js:81` select [captured_at, race_id, trifecta_all, trio_all]
  - `scripts/maintenance/check-odds-shadow.js:200` select [?, race_id, source]
  - `scripts/ml/export-training-data.js:224` select(helper:fetchAll)
  - `src/services/sherlockService.js:87` select [captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6, race_id]
  - `src/services/supabaseDataService.js:5574` select [?, captured_at, race_id]
- 書き手（3）: 
  - `scripts/daily/scrape-odds.js:746` upsert [?]
  - `scripts/daily/scrape-odds.js:769` upsert [?]
  - `scripts/daily/scrape-odds.js:999` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_odds_final"></a>race_odds_final

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: odds_final
- 読み手（3）: 
  - `scripts/analysis/check-win-odds-vs-final.js:50` select(helper:fetchAll)
  - `scripts/lib/scrapeJobs/finalOddsHandlers.js:129` select [?, race_id]
  - `src/services/supabaseDataService.js:5644` select [captured_at, exacta_all, place_all, quinella_all, race_id, trifecta_all, trio_all, wide_all, win_all]
- 書き手（1）: 
  - `scripts/lib/scrapeJobs/finalOddsHandlers.js:144` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_original_exhibition"></a>race_original_exhibition

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: boatcast_oriten
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/original-exhibition/check-rewrite.mjs:15`, `scripts/lib/boatcast/oritenSchema.js:12`
- 読み手（5）: 
  - `scripts/analysis/original-exhibition/fetch.mjs:44` select(helper:all)
  - `scripts/lib/boatcast/oritenJob.js:181` select [content_hash, parser_version, race_id]
  - `scripts/lib/boatcast/oritenJob.js:221` select(helper:upsertChangedRows)
  - `scripts/maintenance/verify-e2e-no-unroute.js:199` rest(rest) （検査）
  - `src/services/supabaseDataService.js:7882` select [item_labels, race_id, updated_at]
- 書き手（1）: 
  - `scripts/lib/boatcast/oritenJob.js:221` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_original_exhibition_values"></a>race_original_exhibition_values

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: boatcast_oriten
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/original-exhibition/check-rewrite.mjs:15`, `scripts/lib/boatcast/oritenSchema.js:13`
- 読み手（5）: 
  - `scripts/analysis/original-exhibition/fetch.mjs:49` select(helper:all)
  - `scripts/lib/boatcast/oritenJob.js:201` select(helper:upsertChangedRows)
  - `scripts/lib/boatcast/oritenJob.js:240` select [boat_number, kind, race_id]
  - `src/services/supabaseDataService.js:4636` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:7887` select [boat_number, kind, race_id, value]
- 書き手（2）: 
  - `scripts/lib/boatcast/oritenJob.js:201` upsert(helper:upsertChangedRows) [?]
  - `scripts/lib/boatcast/oritenJob.js:248` delete
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
  - `scripts/daily/scrape-results.js:1126` select(helper:upsertChangedRows)
  - `scripts/lib/dailyReconcileJob.js:106` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:164` select(helper:fetchAll)
- 書き手（2）: 
  - `scripts/daily/scrape-results.js:1126` upsert(helper:upsertChangedRows) [?]
  - `scripts/lib/raceResultFix.js:134` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_pit_comments"></a>race_pit_comments

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: pit_reports
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/lib/pitReportSchema.js:14`
- 読み手（2）: 
  - `scripts/lib/pitReportJob.js:242` select(helper:upsertChangedRows)
  - `src/services/supabaseDataService.js:7811` select [boat_number, comment_text, confidence_stars, previous_race_number, race_id, racer_id]
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
  - `src/services/supabaseDataService.js:7804` select [comment_count, created_at, race_id, reporter_name, status, target_from, target_to, updated_at]
- 書き手（1）: 
  - `scripts/lib/pitReportJob.js:270` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_results"></a>race_results

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_prediction_performance
- 本体で読む RPC: compute_nige_second_by_course, compute_racer_course_technique_stats, compute_st_course_baseline, compute_today_course_win_stats, compute_venue_course_entry_baseline, compute_venue_course_technique_baseline, data_health_cancellation_with_result, data_health_coverage, data_health_entries_duplicates, data_health_monthly_result, data_health_nightly_freshness, data_health_table_rows, get_admin_rule_performance, get_predictions_by_date, get_predictions_by_date_light, get_race_return_rate, get_race_technique_profile, get_today_races, update_venue_stats
- 取得のジョブ: kfile_sync, race_status, result, result_catchup
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:76`, `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:10`, `scripts/lib/raceResultSchema.js:25`, `scripts/maintenance/delete-phantom-races.js:74`, `scripts/maintenance/fix-opening-day-race-id-date.js:69`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:42`
- 読み手（124）: 
  - `scripts/analysis/aggregate-racer-stats.js:70` select(helper:fetchAll)
  - `scripts/analysis/analogy-finder-md6/export-actual-course.js:20` select(helper:fetchAll)
  - `scripts/analysis/analyze-indicator-predictive-power.js:122` select(helper:fetchAll)
  - `scripts/analysis/analyze-odds-momentum.js:59` select(helper:fetchAll)
  - `scripts/analysis/analyze-outcome-patterns.js:46` select [race_id, rank1, rank2, rank3]
  - `scripts/analysis/analyze-upset-factors.js:120` select [is_cancelled, is_no_race, payout_win, race_id, rank1, winning_technique]
  - `scripts/analysis/analyze-venue-03-trifecta.js:62` select [*, race_id]
  - `scripts/analysis/analyze-venue-03-trio.js:62` select [*, race_id]
  - `scripts/analysis/analyze-venue-03.js:95` select [*, race_id]
  - `scripts/analysis/analyze-venue-generic.js:45` select [*, race_id]
  - `scripts/analysis/backtest-course-rate-only.js:60` select(helper:fetchAll)
  - `scripts/analysis/backtest-unified-model-place-trifecta.js:61` select(helper:fetchAll)
  - `scripts/analysis/backtest-unified-model.js:207` select(helper:fetchAll)
  - `scripts/analysis/boa845-axis-place/fetch_today.mjs:42` select(helper:all)
  - `scripts/analysis/calculate-placement-distribution.js:36` select(helper:fetchAll)
  - `scripts/analysis/calibrate-unified-model.js:127` select(helper:fetchAll)
  - `scripts/analysis/calibration-report.js:102` select(helper:fetchAll)
  - `scripts/analysis/campaign-backtest-score.js:59` select [payout_trifecta, payout_trio, race_id, rank1, rank2, rank3]
  - `scripts/analysis/collect-venue-stats.js:231` select [*, race_id]
  - `scripts/analysis/compare-course-rate-sources.js:52` select(helper:fetchAll)
  - `scripts/analysis/compare-pcexpect.js:108` select [is_cancelled, is_no_race, payout_trio, race_id, rank1, rank2, rank3]
  - `scripts/analysis/discover-exacta-rules.js:70` select [payout_trio, race_id, rank1, rank2, rank3]
  - `scripts/analysis/expected-value-report.js:81` select(helper:fetchAll)
  - `scripts/analysis/find-missing-dates.js:33` select [*, race_id]
  - `scripts/analysis/find-video-worthy-race.js:101` select [payout_trifecta, payout_win, race_id, rank1, rank2, rank3, winning_technique]
  - `scripts/analysis/full-picture-boat1-return/analyze-boat1-return-rate-noise.mjs:38` select(helper:fetchAll)
  - `scripts/analysis/original-exhibition/fetch.mjs:69` select(helper:all)
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:224` select [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, is_cancelled, is_no_race, payout_trifecta, payout_trio, race_id, race_status, rank1, rank2, rank3, refund_boats]
  - `scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js:64` select(helper:fetchAllPages)
  - `scripts/analysis/recalculate-all-rules.js:227` select [*, race_id]
  - `scripts/analysis/recalculate-trio-rules.js:142` select [*, race_id]
  - `scripts/analysis/redesign-volatility-by-venue.js:146` select [is_cancelled, is_no_race, payout_win, race_id, rank1, winning_technique]
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:190` select(helper:fetchAllByRaceId)
  - `scripts/analysis/simulate-nige-calibration.js:43` select(helper:fetchAll)
  - `scripts/analysis/train-conditional-logit.js:95` select(helper:fetchAll)
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:70` select [race_id]
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:117` select [course_1, course_2, course_3, course_4, course_5, course_6, race_id, rank1, rank2, rank3, winning_technique]
  - `scripts/analysis/turnprediction-guided-outcome-distribution.js:144` select(helper:fetchAll)
  - `scripts/analysis/validate-outcome-distribution.js:177` select(helper:fetchAll)
  - `scripts/analysis/verify-all-venues-label-accuracy.js:106` select [race_id, rank1]
  - `scripts/analysis/verify-calculations.js:28` select [payout_place_1, payout_place_2, payout_trifecta, payout_trio, payout_win, race_id, rank1, rank2, rank3]
  - `scripts/analysis/verify-label-accuracy.js:90` select [race_id, rank1]
  - `scripts/analysis/verify-outcome-distribution-coverage.js:45` select(helper:fetchAll)
  - `scripts/analysis/verify-poirot.js:81` select [is_cancelled, is_no_race, payout_trio, race_id, rank1, rank2, rank3]
  - `scripts/analysis/verify-race-analysis-rpc.js:211` select [race_id, rank1, winning_technique]
  - `scripts/analysis/verify-race-analysis-rpc.js:285` select [is_cancelled, is_no_race, payout_place_1, payout_place_2, payout_win, race_id, rank1, rank2]
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:151` select(helper:fetchInChunks)
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:61` select(helper:fetchAll)
  - `scripts/analysis/verify-volatility-predictive-power.js:48` select(helper:fetchAll)
  - `scripts/daily-rule-tracking.js:149` select [*, race_id]
  - `scripts/daily/calculate-accuracy.js:187` select(helper:fetchAll)
  - `scripts/daily/calculate-unified-model-accuracy.js:74` select(helper:fetchAll)
  - `scripts/daily/calculate-unified-volatility-accuracy.js:79` select(helper:fetchAll)
  - `scripts/daily/calculate-venue-grade-stats.js:73` select(embed) [is_cancelled, payout_trio, race_status, rank1, rank2, rank3, refund_boats, winning_technique]
  - `scripts/daily/scrape-odds.js:70` select [payout_win, race_id]
  - `scripts/daily/scrape-results.js:368` select [race_id, rank1]
  - `scripts/daily/scrape-results.js:424` select(helper:filterUnchangedRows)
  - `scripts/daily/scrape-results.js:486` select [race_id, rank1, rank2, rank3, rank4]
  - `scripts/daily/scrape-results.js:837` select [race_id]
  - `scripts/daily/scrape-results.js:901` select [race_id]
  - `scripts/daily/scrape-results.js:1085` select(helper:upsertChangedRows)
  - `scripts/daily/scrape-results.js:1193` select [payout_win, race_id, winning_technique]
  - `scripts/daily/scrape-results.js:1344` select [payout_win, race_id, winning_technique]
  - `scripts/daily/scrape-results.js:1606` select(helper:fetchAll)
  - `scripts/daily/update-exhibition-time-top-stats.js:185` select(helper:fetchAll)
  - `scripts/daily/update-losing-technique-stats.js:55` select [is_cancelled, race_id, rank1, winning_technique]
  - `scripts/daily/update-moriarty-outcomes.js:45` select [is_cancelled, payout_trifecta, payout_trio, payout_win, race_id, race_status, rank1, rank2, rank3]
  - `scripts/daily/update-nige-outcome-distribution.js:62` select [?, is_cancelled, race_id, rank1, rank2, rank3, winning_technique]
  - `scripts/daily/update-outcome-distribution.js:59` select [?, is_cancelled, race_id, rank1, rank2, rank3]
  - `scripts/daily/update-outcome-frequencies.js:19` select [is_cancelled, payout_trio, race_id, race_status, rank1, rank2, rank3, result_at]
  - `scripts/daily/update-top-start-stats.js:185` select(helper:fetchAll)
  - `scripts/daily/update-winning-technique-stats.js:62` select [is_cancelled, race_id, rank1, winning_technique]
  - `scripts/daily/update-winning-technique-stats.js:197` select(helper:fetchAll)
  - `scripts/lib/dailyReconcileJob.js:97` select(helper:fetchAll)
  - `scripts/lib/inCautionHealth.js:142` select [race_id, rank1]
  - `scripts/lib/raceStatusJob.js:125` select [race_id]
  - `scripts/maintenance/audit-missing-results.js:73` select(helper:fetchAll)
  - `scripts/maintenance/audit-race-result-anomalies.js:97` select(helper:fetchAll)
  - `scripts/maintenance/audit-race-result-anomalies.js:207` select [?, race_id]
  - `scripts/maintenance/backfill-actual-course.js:65` select [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, race_id, rank1]
  - `scripts/maintenance/backfill-is-hit-turn.js:42` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:125` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:351` select(helper:upsertChangedRows)
  - `scripts/maintenance/backfill-opening-day-races.js:98` select(helper:count)
  - `scripts/maintenance/backfill-place-hits.js:31` select [payout_place_1, payout_place_2, race_id, rank1, rank2, rank3]
  - `scripts/maintenance/backfill-race-data.js:293` select [race_id, winning_technique]
  - `scripts/maintenance/backfill-rank456-from-kfile.js:75` select [race_id, rank1, rank2, rank3, rank4]
  - `scripts/maintenance/backfill-refund-hit-flags.js:77` select(helper:fetchAll)
  - `scripts/maintenance/backfill-results-by-race-id.js:52` select [payout_win, race_id, winning_technique]
  - `scripts/maintenance/backfill-start-timings.js:276` select [race_id, winning_technique]
  - `scripts/maintenance/backfill-trifecta-trio.js:19` select [*, race_id]
  - `scripts/maintenance/build-races-derived-backfill-sql.js:114` select(helper:fetchAll)
  - `scripts/maintenance/check-exhibition-gap-rate.js:40` select(helper:fetchAll)
  - `scripts/maintenance/check-result-shadow.js:157` select(helper:fetchByRaceIds)
  - `scripts/maintenance/delete-cancelled-race-predictions.js:55` select [race_id]
  - `scripts/maintenance/delete-phantom-race-days.js:62` select(helper:fetchAll)
  - `scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js:45` select(helper:fetchAll)
  - `scripts/maintenance/update-venue-stats.js:32` select(embed) [race_status, rank1]
  - `scripts/ml/export-training-data.js:87` select(helper:fetchAll)
  - `scripts/verification/verify-series-points-border.mjs:56` select [race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `scripts/verification/verify-series-points-needed.mjs:50` select [race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `scripts/verification/verify-series-points-official.mjs:161` select [race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `src/services/adminRuleService.js:87` select [payout_place_1, payout_place_2, payout_trifecta, payout_trio, payout_win, race_id, rank1, rank2, rank3]
  - `src/services/ruleMatchService.js:118` select [payout_place_1, payout_place_2, payout_trifecta, payout_trio, payout_win, race_id, rank1, rank2, rank3]
  - `src/services/supabaseDataService.js:1429` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:2503` select [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `src/services/supabaseDataService.js:2930` select [race_id, rank1, rank2, rank3]
  - `src/services/supabaseDataService.js:3030` select [race_id, race_status, rank1, rank2, rank3, rank4, rank5, rank6]
  - `src/services/supabaseDataService.js:3248` select [race_id, rank1]
  - `src/services/supabaseDataService.js:3710` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:3865` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4119` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4341` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4483` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4709` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4777` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:5810` select [race_id, race_status, rank1, rank2, rank3, winning_technique]
  - `src/services/supabaseDataService.js:5898` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:6110` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:6257` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:6415` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:6722` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:7232` select [race_id, rank1, rank2, rank3, rank4, rank5, rank6]
  - `src/services/supabaseDataService.js:7706` select [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, race_id]
- 書き手（10）: 
  - `scripts/daily/scrape-results.js:438` update [?]
  - `scripts/daily/scrape-results.js:588` update [rank4, rank5, rank6]
  - `scripts/daily/scrape-results.js:1085` upsert(helper:upsertChangedRows) [?]
  - `scripts/lib/raceResultFix.js:117` update [?]
  - `scripts/maintenance/backfill-actual-course.js:111` update [actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6]
  - `scripts/maintenance/backfill-kb-recent-results.js:351` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-race-data.js:209` update [winning_technique]
  - `scripts/maintenance/backfill-rank456-from-kfile.js:157` update [rank4, rank5, rank6]
  - `scripts/maintenance/backfill-start-timings.js:186` update [winning_technique]
  - `scripts/maintenance/migrate-to-supabase.js:284` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_series"></a>race_series

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_race_series, data_health_table_rows
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-t1/t1_1_stage_rule.py:282`, `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:73`
- 読み手（7）: 
  - `scripts/lib/raceSeriesLookup.js:161` select [end_date, start_date, venue_code]
  - `scripts/maintenance/backfill-race-series-meta.js:58` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-series-meta.js:358` select(helper:fetchAll)
  - `scripts/maintenance/backfill-series-day.js:64` select(helper:fetchAll)
  - `src/services/supabaseDataService.js:1404` select [end_date, start_date, venue_code]
  - `src/services/supabaseDataService.js:5509` select [end_date, start_date, venue_code]
  - `src/services/supabaseDataService.js:7215` select [end_date, grade, start_date, title, venue_code]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-race_special_notes"></a>race_special_notes

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: race_notices
- 読み手（1）: 
  - `scripts/daily/generate-morning-digest.js:856` select [category, detail_text, race_date, racer_id, venue_code]
- 書き手（1）: 
  - `scripts/daily/scrape-race-information.js:586` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: boat_number, structured_data, scraped_at

### <a id="t-race_start_timings"></a>race_start_timings

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: compute_st_course_baseline, data_health_coverage, data_health_table_rows, get_race_st_predictability, get_racer_accident_records
- 取得のジョブ: kfile_sync, race_status, result, result_catchup
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:11`, `scripts/lib/raceResultSchema.js:20`, `scripts/lib/raceResultSchema.js:35`, `scripts/maintenance/backfill-kb-gaps.js:80`, `scripts/maintenance/delete-phantom-races.js:76`, `scripts/maintenance/fix-opening-day-race-id-date.js:67`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:40`
- 読み手（29）: 
  - `scripts/analysis/full-picture-answer-stage/actual.cjs:10` select [boat_number, entry_course, finish_rank, is_flying, is_late_start, race_id, start_timing]
  - `scripts/analysis/original-exhibition/fetch.mjs:64` select(helper:all)
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:229` select [boat_number, finish_mark, is_flying, is_late_start, race_id, start_timing]
  - `scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js:72` select(helper:fetchAllPages)
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:197` select(helper:fetchAllByRaceId)
  - `scripts/analysis/verify-race-analysis-rpc.js:74` select(helper:fetchAll)
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:169` select(helper:fetchInChunks)
  - `scripts/daily/generate-morning-digest.js:702` select [boat_number, finish_mark, race_id, start_timing]
  - `scripts/daily/scrape-results.js:639` select [?, boat_number, race_id]
  - `scripts/daily/scrape-results.js:1105` select(helper:upsertChangedRows)
  - `scripts/daily/update-top-start-stats.js:173` select(helper:fetchAll)
  - `scripts/lib/racerStStats.js:152` select(helper:fetchAll)
  - `scripts/maintenance/audit-race-result-anomalies.js:107` select(helper:fetchAll)
  - `scripts/maintenance/backfill-disqualified-finish-marks.js:48` select(helper:fetchAll)
  - `scripts/maintenance/backfill-disqualified-finish-marks.js:71` select(helper:fetchAll)
  - `scripts/maintenance/backfill-start-timings.js:261` select [race_id]
  - `scripts/maintenance/check-result-shadow.js:163` select(helper:fetchByRaceIds)
  - `scripts/ml/export-training-data.js:91` select(helper:fetchAll)
  - `scripts/verification/verify-series-points-border.mjs:64` select [boat_number, finish_mark, race_id]
  - `scripts/verification/verify-series-points-needed.mjs:58` select [boat_number, finish_mark, race_id]
  - `src/services/supabaseDataService.js:1442` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:2409` select [boat_number, is_flying, race_id]
  - `src/services/supabaseDataService.js:2509` select [boat_number, entry_course, finish_mark, race_id]
  - `src/services/supabaseDataService.js:4489` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4730` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:5015` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:5103` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:6774` select [boat_number, finish_mark, is_flying, race_id, start_timing]
  - `src/services/supabaseDataService.js:7699` select [boat_number, entry_course, finish_mark, finish_rank, is_flying, is_late_start, race_id, start_timing]
- 書き手（6）: 
  - `scripts/daily/scrape-results.js:709` upsert [?]
  - `scripts/daily/scrape-results.js:1105` upsert(helper:upsertChangedRows) [?]
  - `scripts/lib/raceResultFix.js:125` upsert [?]
  - `scripts/maintenance/backfill-disqualified-finish-marks.js:191` update [?]
  - `scripts/maintenance/backfill-start-timings.js:173` upsert [?]
  - `scripts/maintenance/verify-race-result-parser.js:2047` upsert [?] （検査）
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_aggregated_stats"></a>racer_aggregated_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（13）: 
  - `api/_lib/racerEntryExhibition.js:188` rest(rest) [calculated_at, course_entry_tendency, racer_id, venue_code]
  - `scripts/analysis/aggregate-racer-stats.js:453` select(helper:upsertChangedRows)
  - `scripts/analysis/analyze-indicator-predictive-power.js:159` select [avg_st, course_race_counts, racer_id, venue_code]
  - `scripts/analysis/backtest-course-rate-only.js:92` select [course_race_counts, racer_id, venue_code]
  - `scripts/analysis/backtest-unified-model-place-trifecta.js:111` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/analysis/backtest-unified-model.js:126` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/analysis/calibrate-unified-model.js:177` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:108` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/analysis/verify-volatility-predictive-power.js:93` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/daily/generate-predictions.js:594` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/daily/generate-unified-predictions.js:118` select [attack_distribution, avg_st, course_race_counts, defense_distribution, racer_id, st_stddev, venue_code]
  - `scripts/daily/generate-unified-trifecta-reference.js:117` select [avg_st, course_race_counts, racer_id, venue_code]
  - `src/services/supabaseDataService.js:4168` select [avg_st, avg_st_last_30, course_race_counts, flying_rate, racer_id, st_stddev, total_races, venue_code]
- 書き手（1）: 
  - `scripts/analysis/aggregate-racer-stats.js:453` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_course_technique_stats"></a>racer_course_technique_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: racer_course_technique_stats
- 読み手（3）: 
  - `scripts/daily/generate-morning-digest.js:250` select [*, course, racer_id]
  - `scripts/daily/generate-morning-digest.js:383` select [window_end]
  - `scripts/daily/update-racer-course-technique-stats.js:330` select(helper:upsertChangedRows)
- 書き手（1）: 
  - `scripts/daily/update-racer-course-technique-stats.js:330` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_grade_cache"></a>racer_grade_cache

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（1）: 
  - `src/services/supabaseDataService.js:4268` select [data, key]
- 書き手（1）: 
  - `scripts/daily/update-racer-grade-cache.js:46` upsert [data, key, updated_at]

### <a id="t-racer_news"></a>racer_news

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: racer_news
- 読み手（3）: 
  - `scripts/generate-sitemap.js:443` select [created_at, racer_id]
  - `scripts/lib/racerNews/dedup.js:34` select [id, source_url]
  - `src/services/racerService.js:46` select [created_at, id, published_at, racer_id, source_name, source_url, summary, title]
- 書き手（2）: 
  - `scripts/lib/racerNews/officialGradeAnnouncements.js:214` insert [published_at, racer_id, source_name, source_url, summary, title]
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
- 読み手（6）: 
  - `scripts/maintenance/verify-full-picture-scene2.js:977` rest(rest) （検査）
  - `scripts/maintenance/verify-full-picture-scene2.js:1226` rest(rest) （検査）
  - `src/services/supabaseDataService.js:4196` select [avg_st, period_no, period_year, racer_id]
  - `src/services/supabaseDataService.js:5525` select [avg_st, period_no, period_year, racer_id]
  - `src/services/supabaseDataService.js:7427` select [avg_st, calc_from, calc_to, finals, period_no, period_year, racer_id, starts, top2_rate, win_rate, wins]
  - `src/services/supabaseDataService.js:7436` select [period_no, period_year, racer_id]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_profiles"></a>racer_profiles

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: racer_profiles
- 読み手（14）: 
  - `scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js:56` select(helper:fetchAllPages)
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:95` select [racer_id]
  - `scripts/daily/scrape-race-information.js:318` select(helper:fetchAll)
  - `scripts/lib/racerNews/officialGradeAnnouncements.js:174` select [branch, name, racer_id]
  - `scripts/lib/racerProfileSync.js:321` select [?]
  - `scripts/maintenance/backfill-race-entries-racer-id.js:60` select(helper:fetchAllPaged)
  - `scripts/maintenance/fan-backfill.js:494` select [racer_id, sex, training_term]
  - `scripts/maintenance/fan-backfill.js:512` select(helper:fetchAll)
  - `scripts/maintenance/fix-opening-day-entries-from-b.js:312` select [hometown, name, racer_id]
  - `scripts/maintenance/restore-contaminated-race-entries.js:101` select(helper:fetchAll)
  - `scripts/maintenance/restore-entries-branch-hometown.js:62` select(helper:fetchAll)
  - `src/services/racerService.js:18` select [birth_date, blood_type, branch, height_cm, hometown, name, name_kana, racer_id, registration_period, weight_kg]
  - `src/services/supabaseDataService.js:3522` select [name, racer_id]
  - `src/services/supabaseDataService.js:4236` select [birth_date, branch, height_cm, hometown, name, name_kana, racer_id, registration_period, weight_kg]
- 書き手（3）: 
  - `scripts/lib/racerProfileSync.js:265` update [?]
  - `scripts/lib/racerProfileSync.js:283` upsert [birth_date, blood_type, branch, grade_at_scrape, height_cm, hometown, name, name_kana, racer_id, registration_period, weight_kg]
  - `scripts/maintenance/fan-backfill.js:544` update [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-racer_series_points"></a>racer_series_points

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness, data_health_table_rows
- 取得のジョブ: point_rank
- 読み手（5）: 
  - `scripts/analysis/series-points-scoring-hypotheses.mjs:203` select [meet_start_date, penalty_points, racer_id, rank, remarks, score_rate, total_points, venue_code]
  - `scripts/verification/verify-series-points-official.mjs:45` select [meet_start_date, penalty_points, placements, player_name, racer_id, rank, remarks, score_rate, total_points, venue_code]
  - `scripts/verification/verify-series-points-official.mjs:132` select [meet_start_date, racer_id, venue_code]
  - `src/services/supabaseDataService.js:6786` select [meet_start_date, penalty_points, placements, racer_id, remarks, scraped_at, total_points, venue_code]
  - `src/services/supabaseDataService.js:7242` select [meet_start_date, scraped_at, venue_code]
- 書き手（1）: 
  - `scripts/daily/scrape-point-rank.js:444` upsert(helper:upsertWithOptionalColumns) [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: id, grade, next_race_1, next_race_2, next_series_day

### <a id="t-races"></a>races

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 定義で読むビュー: v_prediction_performance, v_todays_recommendations
- 本体で読む RPC: claim_scrape_slots, claim_scrape_slots_by_offset, compute_nige_second_by_course, compute_racer_course_technique_stats, compute_st_course_baseline, compute_today_course_win_stats, compute_venue_course_entry_baseline, compute_venue_course_technique_baseline, data_health_cancellation_with_result, data_health_coverage, data_health_entries_duplicates, data_health_monthly_result, data_health_morning_freshness, data_health_nightly_freshness, data_health_pit_reports, data_health_pre_race_fields, data_health_race_series, data_health_racer_period_stats, data_health_table_rows, ensure_scrape_slots, get_predictions_by_date, get_predictions_by_date_light, get_race_history_summary, get_today_races, update_venue_stats
- 取得のジョブ: exhibition, kfile_sync, race_info, race_status, races_init, result, result_catchup
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/analysis/analogy-finder-fr2-holdout.py:340`, `scripts/analysis/analogy-finder-fr2-strat/features_prod.py:169`, `scripts/analysis/analogy-finder-fr2-strat/features_prod.py:348`, `scripts/analysis/analogy-finder-fr2-strat/features_prod.py:354`, `scripts/analysis/analogy-finder-phase-m/build_dataset.py:127`, `scripts/analysis/analogy-finder-phase-m/build_dataset.py:280`, `scripts/analysis/analogy-finder-phase-m/build_dataset.py:294`, `scripts/analysis/analogy-finder-phase-m/md3_odds.py:94`, `scripts/analysis/analogy-finder-phase-m/md3_odds_v2.py:235`, `scripts/analysis/analogy-finder-t1/t1_1_stage_rule.py:263`, `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:74`, `scripts/analysis/analogy-finder-t1/t1_2_series_runs.py:133`, `scripts/analysis/analogy-finder-t1/t1_2_series_runs.py:157`, `scripts/analysis/analogy-finder-t1/t1_2_series_runs.py:159`, `scripts/analysis/analogy-finder-t1/t1_4_hint_threshold.py:108`, `scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py:112`, `scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py:173`, `scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py:198`, `scripts/analysis/analogy-finder-v16/t2_4_rerank_agreement.py:88`, `scripts/analysis/boa845-axis-place/build_pool.py:47`, `scripts/analysis/boa845-axis-place/common.py:98`, `scripts/analysis/boa845-axis-place/common.py:105`, `scripts/analysis/boa845-axis-place/common.py:110`, `scripts/analysis/boa845-axis-place/display.py:58`, `scripts/analysis/boa845-axis-place/mark_rule.py:82`, `scripts/analysis/boa845-axis-place/today_counts.py:42`, `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:6`, `scripts/analysis/in-collapse-caution/round2/c2_rebuild.py:25`, `scripts/analysis/in-collapse-caution/round3/c2_round3.py:29`, `scripts/analysis/in-collapse-caution/round4/sparse_cells.py:29`, `scripts/analysis/in-collapse-caution/round4/sparse_cells.py:56`, `scripts/analysis/original-exhibition/analyze.py:87`, `scripts/analysis/original-exhibition/analyze.py:92`, `scripts/analysis/original-exhibition/analyze.py:93`, `scripts/analysis/original-exhibition/analyze.py:105`, `scripts/analysis/original-exhibition/analyze2.py:11`, `scripts/analysis/original-exhibition/analyze4.py:86`, `scripts/analysis/original-exhibition/analyze4.py:100`, `scripts/analysis/original-exhibition/analyze4.py:141`, `scripts/analysis/original-exhibition/analyze4.py:152`, `scripts/analysis/original-exhibition/analyze4.py:165`, `scripts/analysis/original-exhibition/build.py:6`, `scripts/analysis/original-exhibition/forecast-slit.py:24`, `scripts/analysis/original-exhibition/forecast-slit.py:27`, `scripts/analysis/past-rate-check/label-threshold.py:142`, `scripts/analysis/past-rate-check/label-threshold.py:443`, `scripts/analysis/past-rate-check/slit-pattern-rates.py:76`, `scripts/analysis/past-rate-check/slit-pattern-rates.py:90`, `scripts/maintenance/delete-phantom-races.js:89`, `scripts/ml/analogy/features.py:303`, `scripts/ml/analogy/features.py:540`, `scripts/ml/analogy/features.py:546`, `scripts/ml/analogy/make_treeshap_testdata.py:219`, `scripts/ml/analogy/perrace.py:159`, `scripts/ml/analogy/tests/test_in_caution_bands.py:100`, `scripts/ml/analogy/tests/test_perrace.py:110`, `scripts/ml/analogy/tests/test_v16_pool.py:107`, `scripts/ml/analogy/tests/test_v16_scenario.py:56`, `scripts/ml/analogy/tests/test_v16_scenario.py:59`, `scripts/ml/analogy/tests/test_v16_scenario.py:64`, `scripts/ml/analogy/v16_history.py:53`, `scripts/ml/analogy/v16_morning.py:289`, `scripts/ml/analogy/v16_morning.py:373`, `scripts/ml/analogy/v16_pool.py:74`, `scripts/ml/analogy/v16_scenario.py:69`
- 読み手（141）: 
  - `api/_lib/analogyV16.js:101` rest(rest) [race_date, race_id, start_time, venue_code]
  - `api/_lib/racerEntryExhibition.js:196` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `api/_lib/snsClaimCheck.js:215` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `api/_lib/snsClaimCheck.js:246` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `api/_lib/snsClaimCheck.js:333` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `api/_lib/snsClaimCheck.js:377` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `api/_lib/snsTodayDigest.js:50` rest(rest) [cancellation_status, race_id, start_time]
  - `scripts/analysis/analyze-upset-factors.js:108` select [first_boat_motor_2rate, first_boat_win_rate, motor_2rate_stddev, race_date, race_id, venue_code, volatility_level, volatility_score, win_rate_stddev]
  - `scripts/analysis/backtest-unified-model-place-trifecta.js:94` select [race_id, venue_code]
  - `scripts/analysis/backtest-unified-model.js:109` select [race_id, venue_code]
  - `scripts/analysis/boa845-axis-place/fetch_today.mjs:32` select(helper:all)
  - `scripts/analysis/calibrate-unified-model.js:160` select [race_id, venue_code]
  - `scripts/analysis/original-exhibition/fetch.mjs:54` select(helper:all)
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:76` select [cancellation_status, race_date, race_id, start_time]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:130` select [race_date, race_id, start_time]
  - `scripts/analysis/past-rate-check/pool-contract-check.mjs:232` select [cancellation_status, race_id]
  - `scripts/analysis/race-stage-inventory.mjs:36` select(helper:fetchAllByRaceId)
  - `scripts/analysis/redesign-volatility-by-venue.js:133` select [first_boat_avg_st, first_boat_motor_2rate, first_boat_win_rate, race_date, race_id, venue_code, volatility_score, win_rate_stddev]
  - `scripts/analysis/turn-prediction-venue-deep-analysis.js:109` select [first_boat_grade, first_boat_win_rate, race_date, race_grade, race_id, race_number, venue_code, volatility_level, volatility_score]
  - `scripts/analysis/verify-all-venues-label-accuracy.js:76` select [race_date, race_id, venue_code, volatility_score]
  - `scripts/analysis/verify-calculations.js:15` select [race_date, race_id]
  - `scripts/analysis/verify-label-accuracy.js:72` select [race_date, race_id, venue_code, volatility_score]
  - `scripts/analysis/verify-racer-season-stats-accuracy.js:79` select [race_date]
  - `scripts/analysis/verify-turn-prediction-accuracy-v6.js:91` select [race_id, venue_code]
  - `scripts/analysis/verify-volatility-predictive-power.js:76` select [race_id, venue_code]
  - `scripts/daily/calculate-accuracy.js:178` select(helper:fetchAll)
  - `scripts/daily/calculate-venue-grade-stats.js:73` select [race_date, race_grade, race_id, venue_code]
  - `scripts/daily/generate-morning-digest.js:133` select [race_date, race_grade, race_id, race_number, start_time, venue_code]
  - `scripts/daily/generate-predictions.js:1012` select(helper:upsertChangedRows)
  - `scripts/daily/generate-predictions.js:1343` select(helper:selectByRaceIds)
  - `scripts/daily/generate-predictions.js:1461` select(helper:filterUnchangedRows)
  - `scripts/daily/morning-init.js:86` select [race_id, venue_code]
  - `scripts/daily/morning-init.js:184` select [*, race_id]
  - `scripts/daily/morning-init.js:229` select [*, race_id]
  - `scripts/daily/morning-init.js:263` select [race_id, updated_at]
  - `scripts/daily/scrape-point-rank.js:178` select [race_grade, race_id]
  - `scripts/daily/scrape-results.js:839` select [cancellation_status, race_id]
  - `scripts/daily/scrape-results.js:903` select [cancellation_status, race_id]
  - `scripts/daily/scrape-results.js:961` select [cancellation_status, race_date, race_id]
  - `scripts/daily/scrape-results.js:1501` select [race_id, start_time]
  - `scripts/daily/scrape-results.js:1550` select [race_date, race_id, race_number, venue_code]
  - `scripts/daily/todays-volatility-digest.js:80` select [cancellation_status, race_date, race_id]
  - `scripts/daily/update-moriarty-outcomes.js:58` select [race_id, venue_code]
  - `scripts/daily/update-outcome-frequencies.js:43` select [race_id, venue_code]
  - `scripts/daily/update-race-history-cache.js:48` select(helper:fetchAll)
  - `scripts/daily/update-race-info.js:174` select [cancellation_check_streak, cancellation_status, race_grade, race_id]
  - `scripts/generate-sitemap.js:382` select [race_date, venue_code]
  - `scripts/generate-sitemap.js:591` select [race_date, venue_code]
  - `scripts/lib/analogyDispatch.js:75` select [cancellation_status, race_date, race_id, start_time]
  - `scripts/lib/analogyV16Exhibition.js:291` rest(rest) [race_date, race_id, start_time]
  - `scripts/lib/boatcast/oritenJob.js:401` select [race_date, race_id, start_time]
  - `scripts/lib/boatcast/oritenJob.js:522` select [race_date, race_id, start_time]
  - `scripts/lib/dailyReconcileJob.js:91` select(helper:fetchAll)
  - `scripts/lib/inCautionHealth.js:137` select [cancellation_status, race_id]
  - `scripts/lib/motorPretestRows.js:112` select [cancellation_status, race_date, race_id, venue_code]
  - `scripts/lib/pitReportJob.js:290` select [race_date, race_grade, race_id, race_number, start_time]
  - `scripts/lib/pitReportJob.js:365` select [race_date, race_grade, race_id, race_number, start_time]
  - `scripts/lib/raceSchedule.js:44` select [race_id, start_time]
  - `scripts/lib/raceSeriesLookup.js:174` select [cancellation_status, race_date, venue_code]
  - `scripts/lib/raceStatusJob.js:109` select [cancellation_status, race_date, race_id, race_number, venue_code]
  - `scripts/lib/racesInit/job.js:122` select(helper:fetchAll)
  - `scripts/lib/scrapeJobs/monitor.js:746` select [race_date, race_id]
  - `scripts/lib/scrapeJobs/pcexpectHandlers.js:33` select [race_id, start_time]
  - `scripts/lib/scrapeJobs/resultHandlers.js:153` select [race_date, race_id, start_time]
  - `scripts/lib/scrapeJobs/resultHandlers.js:214` select(embed) [cancellation_status]
  - `scripts/lib/scrapeJobs/resultHandlers.js:275` select [race_date, race_id, start_time]
  - `scripts/lib/snsAutoPlanRunner.js:741` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `scripts/maintenance/audit-missing-results.js:67` select(helper:fetchAll)
  - `scripts/maintenance/backfill-exhibition-by-race-id.js:35` select [race_id, race_number, venue_code]
  - `scripts/maintenance/backfill-kb-gaps.js:103` select(helper:read)
  - `scripts/maintenance/backfill-kb-gaps.js:113` select(helper:read)
  - `scripts/maintenance/backfill-kb-gaps.js:125` select(helper:read)
  - `scripts/maintenance/backfill-kb-recent-results.js:119` select(helper:fetchAll)
  - `scripts/maintenance/backfill-kb-recent-results.js:145` select(helper:fetchAll)
  - `scripts/maintenance/backfill-missing-venue-day.js:73` select [race_date, race_id, race_number, venue_code]
  - `scripts/maintenance/backfill-missing-venue-day.js:133` select [cancellation_status, race_id]
  - `scripts/maintenance/backfill-missing-venue-day.js:156` select [race_date, race_id, venue_code]
  - `scripts/maintenance/backfill-opening-day-races.js:94` select(helper:count)
  - `scripts/maintenance/backfill-opening-day-races.js:147` select(helper:upsertChangedRows)
  - `scripts/maintenance/backfill-pit-reports.js:123` select(helper:fetchAll)
  - `scripts/maintenance/backfill-race-conditions.js:70` select [cancellation_status, race_id]
  - `scripts/maintenance/backfill-race-data.js:240` select [race_date, race_id, race_number, venue_code]
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
  - `scripts/maintenance/check-morning-init-shadow.js:144` select [cancellation_status, race_id, start_time]
  - `scripts/maintenance/check-morning-init-shadow.js:211` select(embed) [cancellation_status, start_time]
  - `scripts/maintenance/check-odds-shadow.js:146` select(embed) [cancellation_status, start_time]
  - `scripts/maintenance/check-pre-race-shadow.js:255` select(embed) [cancellation_status, start_time]
  - `scripts/maintenance/check-pre-race-shadow.js:311` select(helper:fetchByRaceIds)
  - `scripts/maintenance/check-result-shadow.js:125` select(embed) [cancellation_status, start_time]
  - `scripts/maintenance/delete-cancelled-race-predictions.js:40` select(helper:fetchAll)
  - `scripts/maintenance/delete-phantom-race-days.js:56` select(helper:fetchAll)
  - `scripts/maintenance/delete-phantom-race-days.js:103` select [race_date, race_id, race_number, venue_code]
  - `scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js:39` select(helper:fetchAll)
  - `scripts/maintenance/fix-opening-day-entries-from-b.js:302` select(helper:fetchAll)
  - `scripts/maintenance/fix-opening-day-race-id-date.js:98` select [*, race_id]
  - `scripts/maintenance/fix-opening-day-race-id-date.js:226` select [race_id]
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:71` select [*, race_date, race_id, venue_code]
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:155` select [race_id]
  - `scripts/maintenance/motor-pretest-backfill.js:231` select [race_date, race_number, venue_code]
  - `scripts/maintenance/update-venue-stats.js:32` select [race_date, race_id, venue_code]
  - `scripts/maintenance/verify-analogy-v16.js:276` rest(rest) [cancellation_status, race_date, race_id, start_time] （検査）
  - `scripts/maintenance/verify-data-readers.js:557` rest(rest) [race_id] （検査）
  - `scripts/maintenance/verify-pretest-row-pick.js:93` select [race_date, race_id, venue_code] （検査）
  - `scripts/maintenance/verify-pretest-row-pick.js:128` select [race_date, venue_code] （検査）
  - `scripts/maintenance/verify-rpc-output-keys.js:266` select [race_date] （検査）
  - `scripts/maintenance/verify-scrape-slots-on-db.js:69` select [cancellation_status, race_date, race_id, start_time] （検査）
  - `scripts/maintenance/verify-sns-auto-plan.js:615` rest(rest) [race_id] （検査）
  - `scripts/ml/export-inference-data.js:80` select(helper:fetchAll)
  - `scripts/ml/export-training-data.js:71` select(helper:fetchAll)
  - `scripts/sns/push-finals-image.js:1159` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `scripts/sns/push-full-picture.js:689` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `scripts/sns/today-picks.js:83` rest(rest) [cancellation_status, race_date, race_id, start_time]
  - `src/services/mycroftService.js:78` select [race_date, race_id, race_number, start_time, venue_code]
  - `src/services/poirotService.js:48` select [race_date, race_id, race_number, start_time, venue_code]
  - `src/services/ruleMatchService.js:133` select [race_id, start_time]
  - `src/services/sherlockService.js:73` select [race_date, race_id, race_number, start_time, venue_code]
  - `src/services/supabaseDataService.js:570` select [race_date, race_id, venue_code]
  - `src/services/supabaseDataService.js:1911` select [race_date]
  - `src/services/supabaseDataService.js:2277` select [race_date, venue_code]
  - `src/services/supabaseDataService.js:2301` select [race_date, race_id, race_number, start_time, venue_code]
  - `src/services/supabaseDataService.js:2513` select [cancellation_status, race_id]
  - `src/services/supabaseDataService.js:3221` select(embed) [venue_code]
  - `src/services/supabaseDataService.js:4340` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4477` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:4703` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:5977` select [race_date, race_id, race_number, venue_code]
  - `src/services/supabaseDataService.js:6097` select [race_date, race_id, venue_code]
  - `src/services/supabaseDataService.js:6247` select [race_date, race_id, venue_code]
  - `src/services/supabaseDataService.js:6731` select(helper:fetchAllByIn)
  - `src/services/supabaseDataService.js:7227` select [cancellation_status, race_grade, race_id]
  - `src/services/watsonService.js:71` select [race_date, race_id, race_number, start_time, venue_code]
- 書き手（20）: 
  - `scripts/daily/generate-predictions.js:1012` upsert(helper:upsertChangedRows) [?]
  - `scripts/daily/generate-predictions.js:1693` update [?]
  - `scripts/daily/scrape-results.js:869` update [cancellation_status]
  - `scripts/daily/scrape-results.js:930` update [cancellation_check_streak, cancellation_status]
  - `scripts/daily/update-race-info.js:376` update [cancellation_check_streak, cancellation_status]
  - `scripts/daily/update-race-info.js:400` update [start_time]
  - `scripts/daily/update-race-info.js:513` update [race_grade]
  - `scripts/maintenance/audit-missing-results.js:252` update [cancellation_status]
  - `scripts/maintenance/backfill-missing-venue-day.js:125` update [cancellation_status]
  - `scripts/maintenance/backfill-opening-day-races.js:147` upsert(helper:upsertChangedRows) [?]
  - `scripts/maintenance/backfill-race-series-meta.js:147` upsert [?]
  - `scripts/maintenance/delete-phantom-race-days.js:253` delete
  - `scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js:114` update [cancellation_status]
  - `scripts/maintenance/fix-opening-day-race-id-date.js:237` update [race_number]
  - `scripts/maintenance/fix-opening-day-race-id-date.js:260` insert [?]
  - `scripts/maintenance/fix-opening-day-race-id-date.js:339` delete
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:163` update [race_number]
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:185` insert [?]
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:256` delete
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
- 取得のジョブ: analogy_dispatch_morning, analogy_dispatch_train, analogy_v16_exhibition, boatcast_motor_start, boatcast_oriten, daily_reconcile, data_health, data_health_morning, db_apply_dispatch, e2e_rerecord_dispatch, entry_course_stats, exhibition, fan_period, in_caution_dispatch, in_caution_health, in_caution_today_health, key_canary_dispatch, kfile_sync, morning_digest, motor_pretest, odds, odds_final, pcexpect, pit_reports, point_rank, pseudo, race_info, race_notices, race_series, race_status, racer_course_technique_stats, racer_news, racer_profiles, races_init, result, result_catchup, scrape-cleanup, scrape-monitor, sns_auto_plan, sns_daily, sns_metrics, sns_send, venue_motor_stats
- 読み手（12）: 
  - `scripts/lib/dataHealth/job.js:94` select [job, last_report]
  - `scripts/lib/ghaSkipGate.js:450` rest(rest)
  - `scripts/lib/motorPretestJob.js:196` select [job, last_target_date, mode]
  - `scripts/lib/racesInit/job.js:148` select [job, mode]
  - `scripts/lib/racesInit/predictCodeCheck.js:104` select [job, last_report]
  - `scripts/lib/scrapeJobs/monitor.js:714` select [*]
  - `scripts/lib/scrapeJobs/store.js:86` select [*, job]
  - `scripts/lib/scrapeJobs/store.js:286` select [?, job]
  - `scripts/maintenance/check-morning-init-shadow.js:107` select [consecutive_failures, cursor, job, last_error, last_success_at, mode]
  - `scripts/maintenance/check-scrape-monitor-liveness.js:139` select [consecutive_failures, job, last_error, last_success_at, last_target_date, last_tick_at, mode]
  - `scripts/maintenance/verify-gha-skip-gate.js:1354` rest(rest) （検査）
  - `scripts/sns/push-research-image.js:557` rest(rest) [job, last_report]
- 書き手（14）: 
  - `scripts/lib/boatcast/oritenJob.js:498` update [last_report]
  - `scripts/lib/racesInit/job.js:517` update [cursor, last_report]
  - `scripts/lib/racesInit/predictCodeCheck.js:115` upsert [job, last_report, updated_at]
  - `scripts/lib/racesInit/predictCodeCheck.js:136` update [last_report, updated_at]
  - `scripts/lib/racesInit/predictCodeCheck.js:157` update [last_report, updated_at]
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
- 取得のジョブ: analogy_dispatch_morning, analogy_dispatch_train, analogy_v16_exhibition, boatcast_motor_start, boatcast_oriten, daily_reconcile, data_health, data_health_morning, db_apply_dispatch, e2e_rerecord_dispatch, entry_course_stats, exhibition, fan_period, in_caution_dispatch, in_caution_health, in_caution_today_health, key_canary_dispatch, kfile_sync, morning_digest, motor_pretest, odds, odds_final, pcexpect, pit_reports, point_rank, pseudo, race_info, race_notices, race_series, race_status, racer_course_technique_stats, racer_news, racer_profiles, races_init, result, result_catchup, scrape-cleanup, scrape-monitor, sns_auto_plan, sns_daily, sns_metrics, sns_send, venue_motor_stats
- 読み手（10）: 
  - `scripts/lib/boatcast/oritenJob.js:374` select [job, outcome, race_date, race_id, status]
  - `scripts/lib/boatcast/oritenJob.js:534` select [job, race_date, race_id]
  - `scripts/lib/scrapeJobs/monitor.js:724` select [?]
  - `scripts/lib/scrapeJobs/resultHandlers.js:214` select [job, race_date, race_id]
  - `scripts/lib/scrapeJobs/resultHandlers.js:316` select [job, race_date, race_id, status]
  - `scripts/maintenance/check-morning-init-shadow.js:211` select [attempts, done_at, job, last_error, offset_min, outcome, race_date, race_id, result_digest, run_mode, status]
  - `scripts/maintenance/check-odds-shadow.js:146` select [attempts, done_at, job, last_error, offset_min, outcome, race_date, race_id, result_digest, run_mode, status]
  - `scripts/maintenance/check-pre-race-shadow.js:255` select [attempts, done_at, first_attempt_at, job, last_error, offset_min, outcome, race_date, race_id, result_digest, rows_written, run_mode, status]
  - `scripts/maintenance/check-result-shadow.js:125` select [attempts, done_at, job, last_error, offset_min, outcome, race_date, race_id, result_digest, run_mode, status]
  - `scripts/maintenance/verify-scrape-slots-on-db.js:198` select [attempts, job, status] （検査）
- 書き手（9）: 
  - `scripts/lib/boatcast/oritenJob.js:568` upsert [?]
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
- 写しに無い列の名前（埋め込みの別名・JSON のキー・誤りのどれか）: today_thinking_enabled
- 読み手（12）: 
  - `api/_lib/snsClaimCheck.js:254` rest(rest) [channel, finals_image_enabled]
  - `api/_lib/snsClaimCheck.js:284` rest(rest) [channel, research_image_enabled]
  - `api/_lib/snsClaimCheck.js:344` rest(rest) [channel, today_thinking_enabled]
  - `api/_lib/snsXSendStore.js:139` rest(rest) [channel, dry_run, mode]
  - `scripts/lib/snsAutoPlanRunner.js:719` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/lib/snsSendRunner.js:460` rest(rest) [channel, dry_run, mode]
  - `scripts/lib/snsTodayPlanner.js:1160` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/sns/push-finals-image.js:1179` rest(rest)
  - `scripts/sns/push-finals-image.js:1190` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/sns/push-full-picture.js:696` rest(rest) [auto_approver_id, channel, dry_run, mode]
  - `scripts/sns/push-research-image.js:543` rest(rest) [auto_approver_id, channel, dry_run, mode, research_image_enabled]
  - `scripts/sns/push-research-image.js:551` rest(rest) [auto_approver_id, channel, dry_run, mode]
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
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/lib/snsAutoPlanRunner.js:770`
- 読み手（11）: 
  - `api/_lib/snsClaimCheck.js:252` rest(rest) [id, kind, race_id, state, variant]
  - `api/_lib/snsClaimCheck.js:280` rest(rest) [draft_id, kind, race_id]
  - `api/_lib/snsClaimCheck.js:282` rest(rest) [channel, id, kind, race_id, state]
  - `api/_lib/snsClaimCheck.js:338` rest(rest) [draft_id, kind, race_id, variant]
  - `api/_lib/snsClaimCheck.js:341` rest(rest) [id, kind, race_id, state, variant]
  - `scripts/lib/snsAutoPlanRunner.js:750` rest(rest) [*, race_id]
  - `scripts/lib/snsTodayPlanner.js:1105` rest(rest) [draft_id, id, kind, race_id, state]
  - `scripts/maintenance/verify-sns-auto-plan.js:621` rest(rest) [id, state] （検査）
  - `scripts/maintenance/verify-sns-today-plan.js:730` rest(rest) [kind, race_id] （検査）
  - `scripts/sns/push-finals-image.js:1169` rest(rest) [created_at, draft_id, id, kind, race_id, state, variant]
  - `scripts/sns/push-research-image.js:536` rest(rest) [channel, created_at, draft_id, held_reason, id, kind, race_id, state]
- 書き手（4）: 
  - `scripts/lib/snsAutoPlanRunner.js:775` update(rest) [?]
  - `scripts/lib/snsTodayPlanner.js:1169` update(rest) [?]
  - `scripts/sns/push-finals-image.js:1263` update(rest) [?]
  - `scripts/sns/push-full-picture.js:728` update(rest) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_bundle_imports"></a>sns_bundle_imports

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: guard_sns_preview_bundle_draft, import_sns_preview_bundle, sns_bundle_send_allowed
- 本体で書く RPC: import_sns_preview_bundle
- 読み手（2）: 
  - `api/_lib/snsClaimCheck.js:191` select(embed) [bundle, schema_version]
  - `scripts/lib/snsAutoPlanRunner.js:729` rest(rest) [bundle, created_at, id, qa, schema_version]
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
  - `scripts/lib/snsDailyRunner.js:748` rest(rest) [channel, day, definition, draft_id, id, metric_name, metric_value, missing_reason, source, utm_content]
- 書き手（1）: 
  - `scripts/lib/snsDailyRunner.js:756` upsert(rest) [?]
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
- 読み手（29）: 
  - `api/_lib/snsClaimCheck.js:191` rest(rest) [bundle_import_id, id, source_data]
  - `api/_lib/snsClaimCheck.js:286` rest(rest) [caption_text, cover_image_path, hashtags, id, platform, video_storage_path]
  - `api/_lib/snsHubHelpers.js:119` select(rest) [*, id]
  - `api/_lib/snsXSendStore.js:60` rest(rest) [format, id, platform, posted_at, scheduled_at, source_data, status, title]
  - `api/admin/sns-hub/drafts/index.js:43` select(rest) [*]
  - `api/admin/sns-hub/insights/index.js:53` select(rest) [referenced_insight_ids]
  - `api/admin/sns-hub/revisions/index.js:57` select(rest) [format, id, platform, revision_reason_codes, revision_reason_freetext, title, updated_at]
  - `api/admin/sns-hub/send-probe.js:52` rest(rest) [cover_image_path, created_at, format]
  - `api/admin/sns-hub/send-probe.js:55` rest(rest) [created_at, platform, video_storage_path]
  - `scripts/analysis/youtube-posts-report.js:22` select [archived_at, created_at, id, platform, posted_at, status, title]
  - `scripts/lib/contentRevisionHistory.js:34` select [format, id, platform, revision_reason_codes, revision_reason_freetext, title, updated_at]
  - `scripts/lib/snsAutoPlanRunner.js:747` rest(rest) [bundle_import_id, caption_text, cover_image_path, format, hashtags, id, language, platform, publication_hold_reasons, publish_blocked, risk_flags, source_data, status, template_variant_id, thread_index, title, video_storage_path]
  - `scripts/lib/snsAutoPlanRunner.js:758` rest(rest) [format, id, status]
  - `scripts/lib/snsDailyRunner.js:736` rest(rest) [format, id, platform, posted_at, source_data]
  - `scripts/lib/snsDailyRunner.js:739` rest(rest) [id]
  - `scripts/lib/snsMetricsRunner.js:493` rest(rest) [format, id, platform, posted_at, status]
  - `scripts/lib/snsTodayPlanner.js:1102` rest(rest) [format, id, send_lane, source_data, status]
  - `scripts/maintenance/verify-data-readers.js:183` rest(rest) [created_at, id, status] （検査）
  - `scripts/maintenance/verify-data-readers.js:205` rest(rest) [id] （検査）
  - `scripts/maintenance/verify-display-coverage.js:170` rest(rest) [*] （検査）
  - `scripts/maintenance/verify-sns-auto-plan.js:617` rest(rest) [bundle_import_id] （検査）
  - `scripts/maintenance/verify-sns-auto-plan.js:625` rest(rest) [id, status] （検査）
  - `scripts/maintenance/verify-sns-existing-fixes.js:142` rest(rest) （検査）
  - `scripts/maintenance/verify-sns-metrics-runner.js:632` rest(rest) （検査）
  - `scripts/maintenance/verify-sns-month-calendar.js:47` rest(rest) （検査）
  - `scripts/maintenance/verify-sns-today-plan.js:723` rest(rest) [format, send_lane] （検査）
  - `scripts/maintenance/verify-sns-today-plan.js:747` rest(rest) [id, status] （検査）
  - `scripts/sns/push-finals-image.js:1214` select(embed) [bundle_import_id]
  - `scripts/sns/today-picks.js:75` rest(rest) [caption_text, format, id, send_lane, source_data, status]
- 書き手（5）: 
  - `api/_lib/snsHubHelpers.js:136` update(rest) [?]
  - `scripts/lib/snsAutoPlanRunner.js:785` update(rest) [?]
  - `scripts/lib/snsTodayPlanner.js:1146` update(rest) [?]
  - `scripts/sns/push-finals-image.js:1254` update(rest) [?]
  - `scripts/sns/push-full-picture.js:741` update(rest) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_metric_jobs"></a>sns_metric_jobs

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で書く RPC: enqueue_sns_metric_jobs
- 取得のジョブ: sns_metrics
- 読み手（3）: 
  - `scripts/lib/snsMetricsRunner.js:488` rest(rest) [attempts, draft_id, due_at, id, last_error, source, state, window]
  - `scripts/lib/snsMetricsRunner.js:550` rest(rest) [done_at, id, state]
  - `scripts/maintenance/verify-sns-metrics-runner.js:622` rest(rest) [state] （検査）
- 書き手（2）: 
  - `scripts/lib/snsMetricsRunner.js:506` update(rest) [?]
  - `scripts/lib/snsMetricsRunner.js:520` update(rest) [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: created_at

### <a id="t-sns_metric_observations"></a>sns_metric_observations

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: append_sns_metric_observation
- 本体で書く RPC: append_sns_metric_observation
- 読み手（4）: 
  - `api/_lib/snsXSendStore.js:64` rest(rest) [data_through, definition, draft_id, id, metric_name, metric_value, missing_reason, observed_at, period_end, source, window]
  - `scripts/lib/snsDailyRunner.js:700` rest(rest) [definition, denominator_value, draft_id, metric_name, metric_value, observed_at, source, window]
  - `scripts/lib/snsMetricsRunner.js:538` rest(rest) [draft_id, id, metric_value, source, window]
  - `scripts/maintenance/verify-sns-month-calendar.js:51` rest(rest) （検査）
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_oauth_tokens"></a>sns_oauth_tokens

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 取得のジョブ: sns_metrics, sns_send
- 読み手（1）: 
  - `api/_lib/snsTokenStore.js:195` rest(rest) [*, provider]
- 書き手（4）: 
  - `api/_lib/snsTokenStore.js:198` upsert(rest) [?]
  - `api/_lib/snsTokenStore.js:217` update(rest) [?]
  - `api/_lib/snsTokenStore.js:230` update(rest) [?]
  - `api/_lib/snsTokenStore.js:238` update(rest) [?]
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
  - `scripts/lib/snsTodayPlanner.js:1133` rest(rest) [day, post, type_id]
  - `scripts/maintenance/verify-sns-today-plan.js:740` rest(rest) [day, post, type_id] （検査）
  - `scripts/maintenance/verify-sns-today-variants.js:358` rest(rest) [day] （検査）
- 書き手（1）: 
  - `scripts/sns/push-today-types.js:106` upsert(rest) [?]
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
  - `scripts/sns/x-slots-check.js:156` rest(rest) [daily_count, kind, weekdays]
- 書き手（0）: なし
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: note, updated_at

### <a id="t-sns_x_send_control"></a>sns_x_send_control

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: approve_sns_x_send, reserve_sns_x_read, roll_sns_x_send_period, sns_x_slot_room, transition_sns_send_139, transition_sns_x_send
- 本体で書く RPC: renew_sns_x_send_period, reserve_sns_x_read, roll_sns_send_baselines, roll_sns_x_send_period, transition_sns_send_139
- 取得のジョブ: sns_auto_plan, sns_send
- 読み手（5）: 
  - `api/_lib/snsXSendStore.js:127` rest(rest) [budget_microusd, id, paused, reserved_microusd]
  - `api/_lib/snsXSendStore.js:137` rest(rest) [id, paused]
  - `scripts/lib/snsMetricsRunner.js:526` rest(rest) [*, id]
  - `scripts/sns/push-finals-image.js:1198` rest(rest) [daily_baseline_date, daily_external_count, daily_limit, daily_limit_x, id]
  - `scripts/sns/x-slots-check.js:158` rest(rest) [daily_limit_x]
- 書き手（1）: 
  - `api/_lib/snsXSendStore.js:144` update(rest) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_x_send_jobs"></a>sns_x_send_jobs

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: approve_sns_x_send, guard_sns_diff_approval, guard_sns_preview_bundle_draft, guard_sns_x_approval, sns_x_slot_room, stop_sns_auto_item, transition_sns_send_139, transition_sns_x_send
- 本体で書く RPC: approve_sns_x_send, guard_sns_x_approval, sweep_sns_deadline_queue, transition_sns_send_139, transition_sns_x_send
- 読み手（20）: 
  - `api/_lib/snsXSendStore.js:47` rest(rest) [external_post_id, id, state]
  - `api/_lib/snsXSendStore.js:57` rest(rest) [draft_id, error_code, expires_at, external_post_id, id, posted_at, scheduled_at, snapshot, state, youtube_stage]
  - `api/_lib/snsXSendStore.js:124` rest(rest) [attempts, draft_id, error_code, expires_at, external_post_url, id, posted_at, scheduled_at, state]
  - `scripts/lib/snsAutoPlanRunner.js:765` rest(rest) [draft_id, id, state]
  - `scripts/lib/snsDailyRunner.js:731` rest(rest) [channel, draft_id, external_post_id, posted_at, state]
  - `scripts/lib/snsMetricsRunner.js:495` rest(rest) [channel, draft_id, external_post_id, state]
  - `scripts/lib/snsSendRunner.js:470` rest(rest) [*, id, scheduled_at, state]
  - `scripts/lib/snsSendRunner.js:477` rest(rest) [external_post_id, id, state]
  - `scripts/lib/snsSendRunner.js:489` rest(rest) [channel, expires_at, id, parent_job_id, state]
  - `scripts/lib/snsSendRunner.js:493` rest(rest) [external_post_id, id, state]
  - `scripts/lib/snsSendRunner.js:502` rest(rest) [attempts, channel, error_code, expires_at, external_post_id, id, snapshot, state, youtube_stage]
  - `scripts/lib/snsSendRunner.js:508` rest(rest) [channel, error_code, id, state, youtube_stage]
  - `scripts/maintenance/verify-sns-metrics-runner.js:641` rest(rest) （検査）
  - `scripts/maintenance/verify-sns-month-calendar.js:46` rest(rest) （検査）
  - `scripts/maintenance/verify-sns-send-runner.js:471` rest(rest) [channel, error_code, id, state, youtube_stage] （検査）
  - `scripts/maintenance/verify-sns-send-runner.js:1526` rest(rest) [attempts, channel, error_code, expires_at, external_post_id, id, snapshot, state, youtube_stage] （検査）
  - `scripts/sns/push-finals-image.js:1208` rest(rest) [attempt_channels, attempt_dates, id, state]
  - `scripts/sns/push-finals-image.js:1214` rest(rest) [attempts, channel, expires_at, id, parent_job_id, state]
  - `scripts/sns/push-finals-image.js:1223` rest(rest) [draft_id, error_code, external_post_id, external_post_url, id, posted_at, state]
  - `scripts/sns/push-research-image.js:562` rest(rest) [draft_id, error_code, expires_at, external_post_id, external_post_url, id, posted_at, scheduled_at, state]
- 書き手（0）: なし
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-sns_youtube_quota_attempts"></a>sns_youtube_quota_attempts

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: transition_sns_x_send
- 本体で書く RPC: transition_sns_x_send
- 読み手（0）: なし
- 書き手（0）: なし

### <a id="t-sns_youtube_quota_control"></a>sns_youtube_quota_control

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: transition_sns_x_send
- 本体で書く RPC: roll_sns_send_baselines
- 読み手（0）: なし
- 書き手（0）: なし

### <a id="t-sns_youtube_quota_reads"></a>sns_youtube_quota_reads

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: transition_sns_x_send
- 本体で書く RPC: transition_sns_x_send
- 読み手（0）: なし
- 書き手（0）: なし

### <a id="t-st_course_baseline"></a>st_course_baseline

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/daily/update-course-baseline-stats.js:146` select(helper:upsertChangedRows)
  - `src/services/supabaseDataService.js:6581` select [avg_st, breakout_count, breakout_rate, course, grade, late_rate, runs, st_histogram, stable_rate, window_days, window_end, window_start]
- 書き手（1）: 
  - `scripts/daily/update-course-baseline-stats.js:146` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-top_start_stats"></a>top_start_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（1）: 
  - `src/services/supabaseDataService.js:6474` select [*, boat_number, venue_code]
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
  - `scripts/daily/generate-morning-digest.js:265` select [*]
  - `scripts/daily/update-racer-course-technique-stats.js:255` select(helper:upsertChangedRows)
  - `scripts/daily/update-racer-course-technique-stats.js:283` select [*]
  - `scripts/maintenance/verify-full-picture-scene2.js:1003` rest(rest) （検査）
  - `scripts/maintenance/verify-full-picture-scene2.js:1335` rest(rest) （検査）
- 書き手（1）: 
  - `scripts/daily/update-racer-course-technique-stats.js:255` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-venue_entry_course_stats"></a>venue_entry_course_stats

- 権限: service だけ（anon: なし / authenticated: なし、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: entry_course_stats
- 読み手（0）: なし
- 書き手（1）: 
  - `scripts/daily/scrape-venue-entry-course-stats.js:223` upsert [?]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: venue_code, racer_id, racer_name_raw, entry_rate, avg_st, place_rate_1, place_rate_2, place_rate_3, place_rate_4, place_rate_5, place_rate_6, stats_period_start, stats_period_end, scraped_at

### <a id="t-venue_grade_boat_stats"></a>venue_grade_boat_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（3）: 
  - `scripts/daily/calculate-venue-grade-stats.js:190` select(helper:upsertChangedRows)
  - `src/services/supabaseDataService.js:7749` select [boat_number, manshu_count, payout_count, payout_trio_sum, race_count, race_grade, technique_breakdown, top2, top3, venue_code, wins]
  - `src/services/supabaseDataService.js:7766` select [venue_code]
- 書き手（1）: 
  - `scripts/daily/calculate-venue-grade-stats.js:190` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-venue_motor_start_dates"></a>venue_motor_start_dates

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 取得のジョブ: boatcast_motor_start
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/lib/boatcast/oritenSchema.js:15`
- 読み手（2）: 
  - `scripts/lib/boatcast/motorStartJob.js:144` select(helper:upsertChangedRows)
  - `src/services/supabaseDataService.js:603` select [start_date, venue_code]
- 書き手（1）: 
  - `scripts/lib/boatcast/motorStartJob.js:144` upsert(helper:upsertChangedRows) [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-venue_motor_stats"></a>venue_motor_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_table_rows
- 取得のジョブ: venue_motor_stats
- 読み手（4）: 
  - `scripts/daily/generate-morning-digest.js:196` select [motor_number, race_count, scraped_date, venue_code]
  - `src/services/supabaseDataService.js:3148` select [*, motor_number, scraped_date, venue_code]
  - `src/services/supabaseDataService.js:3377` select [scraped_date, venue_code]
  - `src/services/supabaseDataService.js:3387` select [accident_rate, championship_count, final_count, motor_number, race_count, scraped_date, stats_period_end, top2_rate, top3_rate, venue_code, win_rate]
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
  - `src/services/supabaseDataService.js:1985` select [last_updated, period_days, period_from, period_to, race_count, total_races, venue_code, winning_technique]
- 書き手（2）: 
  - `scripts/daily/update-winning-technique-stats.js:236` delete
  - `scripts/daily/update-winning-technique-stats.js:245` insert [?]

### <a id="t-venues"></a>venues

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 本体で書く RPC: update_venue_stats
- 読み手（5）: 
  - `scripts/daily/generate-predictions.js:42` select [avg_first_win_rate, code]
  - `scripts/maintenance/update-venue-stats.js:74` select [avg_first_win_rate, avg_first_win_rate_race_count, code, name]
  - `src/services/supabaseDataService.js:880` select [avg_first_win_rate, code]
  - `src/services/supabaseDataService.js:2017` select [cluster, code]
  - `src/services/supabaseDataService.js:6335` select [avg_first_win_rate, avg_first_win_rate_race_count, code]
- 書き手（2）: 
  - `scripts/maintenance/update-venue-stats.js:46` update [avg_first_win_rate, avg_first_win_rate_race_count, updated_at]
  - `scripts/maintenance/update-venue-stats.js:58` update [avg_first_win_rate, avg_first_win_rate_race_count, updated_at]
- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: water_type, course_entry_baseline, course_entry_baseline_updated_at

### <a id="t-watson_predictions"></a>watson_predictions

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 名前の文字列（`.from(式)` 等の先で読む・書く見込み）: `scripts/maintenance/fix-opening-day-race-id-date.js:79`, `scripts/maintenance/fix-tsu-2025-12-02-date.js:52`
- 読み手（1）: 
  - `src/services/watsonService.js:88` select [explanations, model_trained_at, predicted_at, race_id, rank_order, win_probs]
- 書き手（1）: 
  - `scripts/daily/generate-watson-predictions.js:93` upsert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

### <a id="t-winning_technique_stats"></a>winning_technique_stats

- 権限: anon 可（anon: SELECT / authenticated: SELECT、RLS 有効）
- 本体で読む RPC: data_health_nightly_freshness
- 読み手（2）: 
  - `scripts/maintenance/verify-full-picture-scene2.js:1033` rest(rest) （検査）
  - `src/services/supabaseDataService.js:2204` select [*, boat_number, percentage, venue_code]
- 書き手（2）: 
  - `scripts/daily/update-winning-technique-stats.js:161` delete
  - `scripts/daily/update-winning-technique-stats.js:171` insert [?]
- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる

## コードが使うのに写しに無い名前

写しの取得より後のマイグレーションで足したもの、消したもの、別のスキーマ、誤りのどれか。

なし

## 拾えなかったもの

- 名前が式（変数・テンプレートの式）の箇所: 31
  - `scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs:50` 表の名前が変数（.from(式)）
  - `scripts/analysis/in-collapse-caution/round1/fetch_delta.mjs:15` 表の名前が変数（.from(式)）
  - `scripts/analysis/original-exhibition/check-rewrite.mjs:20` 表の名前が変数（.from(式)）
  - `scripts/analysis/verify-race-analysis-rpc.js:376` RPC の名前が変数（.rpc(式)）
  - `scripts/lib/boatcast/oritenSchema.js:50` 表の名前が変数（.from(式)）
  - `scripts/lib/dataHealth/job.js:67` RPC の名前が変数（.rpc(式)）
  - `scripts/lib/fanPeriodJob.js:86` 表の名前が変数（.from(式)）
  - `scripts/lib/fanPeriodJob.js:162` 表の名前が変数（.from(式)）
  - `scripts/lib/fanPeriodJob.js:286` 表の名前が変数（.from(式)）
  - `scripts/lib/pitReportSchema.js:40` 表の名前が変数（.from(式)）
  - `scripts/lib/raceResultSchema.js:84` 表の名前が変数（.from(式)）
  - `scripts/lib/raceSeriesSync.js:75` 表の名前が変数（.from(式)）
  - `scripts/lib/raceSeriesSync.js:91` 表の名前が変数（.from(式)）
  - `scripts/lib/raceSeriesSync.js:104` 表の名前が変数（.from(式)）
  - `scripts/lib/schemaDetect.js:67` 表の名前が変数（.from(式)）
  - `scripts/lib/snsAutoPlanRunner.js:92` RPC の名前が変数（.rpc(式)）
  - `scripts/lib/snsSendRunner.js:440` REST の表の名前が式（/rest/v1/${…}）
  - `scripts/maintenance/backfill-kb-gaps.js:204` 表の名前が変数（.from(式)）
  - `scripts/maintenance/backfill-kb-gaps.js:239` 表の名前が変数（.from(式)）
  - `scripts/maintenance/delete-phantom-races.js:195` 表の名前が変数（.from(式)）
  - `scripts/maintenance/delete-phantom-races.js:273` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fan-backfill.js:382` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fan-backfill.js:406` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-opening-day-race-id-date.js:153` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-opening-day-race-id-date.js:204` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-opening-day-race-id-date.js:285` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:84` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:133` 表の名前が変数（.from(式)）
  - `scripts/maintenance/fix-tsu-2025-12-02-date.js:209` 表の名前が変数（.from(式)）
  - `scripts/maintenance/kb-backfill.js:774` 表の名前が変数（.from(式)）
  - `scripts/maintenance/motor-pretest-backfill.js:454` 表の名前が変数（.from(式)）
- 構文木にできなかったファイル: 0
- 対象外の言語で DB を読み書きしうるファイル（Python。拾っていない）: 54
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

