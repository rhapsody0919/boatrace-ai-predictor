// verify-migration-numbers.js の凍結した重複の表（字のまま移した）

/**
 * 既存の重複（凍結）。番号 -> 同番号で許可するファイル名の一覧。
 * 新規の重複は、ここに追加せず、後から作った側を最大番号+1にリネームして解消すること。
 * この一覧を増やす変更は、レビューで理由を明示すること。
 */
export const ALLOWED_DUPLICATES = {
  "008": [
    "008_ADD_EXHIBITION_TO_RPC.sql",
    "008_accuracy_rpc.sql",
    "008_venue_rules.sql",
  ],
  "009": ["009_RACE_HISTORY_RPC.sql", "009_add_first_boat_avg_st.sql"],
  "020": ["020_outcome_distribution.sql", "020_race_history_cache.sql"],
  "021": ["021_external_predictions.sql", "021_poirot_predictions.sql"],
  "022": ["022_moriarty_setup.sql", "022_race_odds_trifecta_all.sql"],
  "029": ["029_race_analysis_rpc.sql", "029_watson_predictions.sql"],
  "030": ["030_ai_model_redesign_schema.sql", "030_mycroft_predictions.sql"],
  "035": ["035_create_racer_profiles.sql", "035_sns_marketing_hub_schema.sql"],
  "039": [
    "039_fix_volatility_percentile_in_predictions_rpc.sql",
    "039_sns_strategy_insights.sql",
  ],
  "047": [
    "047_race_cancellation_status.sql",
    "047_sns_topic_categories_feature_intro_repurpose.sql",
  ],
  "048": [
    "048_add_cancellation_status_to_predictions_rpc.sql",
    "048_drop_venues_avg_volatility_score.sql",
  ],
  "050": [
    "050_race_entries_racer_id_index.sql",
    "050_race_results_full_order_and_payouts.sql",
    "050_sns_topic_categories_humor.sql",
  ],
  "054": ["054_racer_grade_cache_table.sql", "054_sns_campaigns_schema.sql"],
  "059": [
    "059_exhibition_data_weight_prev_result.sql",
    "059_venue_grade_boat_stats.sql",
  ],
  "064": ["064_racer_series_points.sql", "064_venue_entry_course_stats.sql"],
};
