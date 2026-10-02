-- Q4: 寄与度プロファイル（本番 analogy_contribution_profiles、analogy_models.is_active の版）。読み取りのみ。
-- 4a: 版の一覧
SELECT model_version, trained_at, is_active, created_at, jsonb_array_length(themes) n_themes, themes, metrics, feature_columns FROM analogy_models ORDER BY created_at;
-- 4b: グレード×ラウンドのスライス一覧（全会場をまとめた要約）
SELECT grade, round, count(*) n_cells, count(DISTINCT venue_code) n_venues, min(n_races) min_n_races, max(n_races) max_n_races,
  min(period_from) min_period_from, max(period_to) max_period_to
FROM analogy_contribution_profiles p JOIN analogy_models m USING (model_version) WHERE m.is_active GROUP BY grade, round ORDER BY grade, round;
-- 4c: 会場0・20 のスライスごとの n（boat_number=0, finish_target=1 の行）
SELECT venue_code, grade, round, n_races, n_boats, period_from, period_to
FROM analogy_contribution_profiles p JOIN analogy_models m USING (model_version)
WHERE m.is_active AND venue_code IN (0, 20) AND boat_number = 0 AND finish_target = 1 ORDER BY 1, 2, 3;
-- 4d: share と share_sd。テーマ順は [venueCourse, racerRecord, startExhibition, machine, environment, racerProfile]
--   share は小数4桁、share_sd は小数5桁に丸めて取得（元は倍精度）。
--   対象: 全国(0)・若松(20) × all/all、全国×all×yusho、若松×G1×yusho
SELECT jsonb_agg(jsonb_build_array(venue_code, grade, round, boat_number, finish_target, n_boats, n_races, period_from, period_to,
  ARRAY[round((shares->>'venueCourse')::numeric, 4), round((shares->>'racerRecord')::numeric, 4), round((shares->>'startExhibition')::numeric, 4),
        round((shares->>'machine')::numeric, 4), round((shares->>'environment')::numeric, 4), round((shares->>'racerProfile')::numeric, 4)],
  ARRAY[round((share_sd->>'venueCourse')::numeric, 5), round((share_sd->>'racerRecord')::numeric, 5), round((share_sd->>'startExhibition')::numeric, 5),
        round((share_sd->>'machine')::numeric, 5), round((share_sd->>'environment')::numeric, 5), round((share_sd->>'racerProfile')::numeric, 5)])
  ORDER BY venue_code, grade, round, boat_number, finish_target)
FROM analogy_contribution_profiles p JOIN analogy_models m USING (model_version)
WHERE m.is_active AND ((venue_code IN (0, 20) AND grade = 'all' AND round = 'all')
   OR (venue_code = 0 AND grade = 'all' AND round = 'yusho') OR (venue_code = 20 AND grade = 'G1' AND round = 'yusho'));

-- 補足（2章・3章の確認用）: 若松の G1 の節の一覧と、BBCトーナメント最終日の stage
SELECT s.start_date, s.end_date, s.grade, s.kind, s.title, vd.race_grade AS kb_vd_grade
FROM race_series s LEFT JOIN kb_archive_venue_days vd ON vd.venue_code = 20 AND vd.race_date = s.end_date
WHERE s.venue_code = 20 AND s.grade = 'G1' ORDER BY s.start_date;
SELECT race_id, stage, stage_kind, has_result FROM kb_archive_races WHERE race_id LIKE '2020-12-06-20-%' ORDER BY race_number DESC LIMIT 3;
