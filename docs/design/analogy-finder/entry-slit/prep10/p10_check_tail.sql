-- 1) all_a1 × yusho（round='yusho'）× fd12 の件数（pool 段階＝返還艇・進入不明を除く前）
-- 2) 片方だけに当たるレースのステージ名の内訳（all_a1 のレースだけ、件数の多い順）
SELECT jsonb_build_object(
 'xtab', (SELECT jsonb_agg(jsonb_build_object('all_a1', all_a1, 'yusho', yusho, 'fd12', fd12, 'n', n) ORDER BY all_a1, yusho, fd12) FROM (
   SELECT all_a1, coalesce(round = 'yusho', false) AS yusho, fd12, count(*) n FROM pool WHERE race_date <= DATE '2026-09-26' GROUP BY 1, 2, 3) z),
 'a1_mismatch', (SELECT jsonb_agg(jsonb_build_object('yusho', yusho, 'fd12', fd12, 'stage', stage_raw, 'stage_kind', stage_kind, 'race_number_set', rns, 'n', n, 'example', ex) ORDER BY yusho, n DESC, stage_raw) FROM (
   SELECT coalesce(round = 'yusho', false) AS yusho, fd12, stage_raw, stage_kind, string_agg(DISTINCT race_number::text, ',') rns, count(*) n, max(race_id) ex
   FROM pool WHERE all_a1 AND race_date <= DATE '2026-09-26' AND coalesce(round = 'yusho', false) <> fd12 GROUP BY 1, 2, 3, 4) z)
) AS r;
