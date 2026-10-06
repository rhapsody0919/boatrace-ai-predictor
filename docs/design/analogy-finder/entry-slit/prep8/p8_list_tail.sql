-- prep8 一覧用: 件数30未満のセルは 若松の inlost（flat・wall）と 若松×G1 の waku 以外だけだったので、
-- 若松で「inlost、または G1 で waku 以外」のレースを1行ずつ返す（セルへの振り分け・新しい順30件は build8.js）。
-- 進入の型・形の判定は p8_common_tail.sql と同じ。pool は会場20に絞って実行（kr／mr_r に venue_code = 20 を足しただけ）
-- 1行 = race_id|日付|会場|グレード|開催名|ステージ|R|1着-2着-3着|決まり手|3連単払戻|進入コース(1..6号艇)|形(,区切り)|進入の型
, ok AS (
  SELECT p.*,
    CASE WHEN p.course_by_boat = ARRAY[1,2,3,4,5,6]::smallint[] THEN 'waku' ELSE 'other' END AS a,
    (SELECT string_agg(k::text, '' ORDER BY k) FROM generate_series(1, 6) k WHERE p.course_by_boat[k] < k) AS b,
    ARRAY(SELECT round(p.st_by_boat[array_position(p.course_by_boat, cc::smallint)] * 100)::int FROM generate_series(1, 6) cc ORDER BY cc) AS cst
  FROM pool p
  WHERE p.race_date <= DATE '2026-09-26' AND p.venue_code = 20
    AND NOT coalesce((SELECT bool_or(r) FROM unnest(p.ret_by_boat) r), false)
    AND array_position(p.course_by_boat, NULL) IS NULL
), sl AS (
  SELECT ok.*, (array_position(cst, NULL) IS NULL) AS st_ok,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN (SELECT max(v) - min(v) FROM unnest(cst) v) <= 6 THEN 'flat' END,
      CASE WHEN greatest(cst[1], cst[2], cst[3]) - least(cst[1], cst[2], cst[3]) <= 2 THEN 'wall' END,
      CASE WHEN cst[2] - least(cst[1], cst[3]) >= 5 THEN 'd2' END,
      CASE WHEN cst[3] - least(cst[2], cst[4]) >= 5 THEN 'd3' END,
      CASE WHEN least(cst[1], cst[2], cst[3]) - cst[4] >= 3 THEN 'kado' END,
      CASE WHEN cst[1] - cst[2] >= 5 THEN 'd1' END,
      CASE WHEN (cst[1] + cst[2] + cst[3]) - (cst[4] + cst[5] + cst[6]) >= 15 THEN 'dash' END], NULL) AS forms
  FROM ok
), e AS (
  SELECT sl.*, CASE WHEN course_by_boat[1] <> 1 THEN 'inlost' WHEN a = 'waku' THEN 'waku'
    WHEN b = '6' THEN 'mae6' WHEN b = '5' THEN 'mae5' WHEN b = '56' THEN 'mae56' ELSE 'maeOther' END AS et
  FROM sl
)
SELECT count(*) AS n, string_agg(concat_ws('|', race_id, race_date, venue_code, coalesce(grade, ''), replace(coalesce(title, ''), '|', '/'), replace(coalesce(stage_raw, ''), '|', '/'), race_number,
  rank1 || '-' || rank2 || '-' || rank3, coalesce(tech_raw, ''), coalesce(pay3::text, ''), array_to_string(course_by_boat, ','), array_to_string(forms, ','), et), ';' ORDER BY race_date DESC, race_number DESC) AS rows
FROM e WHERE et = 'inlost' OR (grade = 'G1' AND et <> 'waku');
