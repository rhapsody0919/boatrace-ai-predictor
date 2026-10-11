-- prep10 一覧用（prep9b と同じ。キーだけ差し替え）: 件数30未満のセルごとに新しい順30件に入るレースを1行ずつ返す（セルへの振り分けと件数の照合は build10.js）。e までは p10_common_tail.sql と同じ
-- 1行 = race_id|日付|会場|グレード|開催名|ステージ|R|1着-2着-3着|決まり手|3連単払戻|進入コース(1..6号艇)|形(,区切り)|進入の型
, k AS (
  SELECT e.*, scope || '|' || et2 || '|' || fm AS key FROM e
  CROSS JOIN LATERAL unnest(ARRAY[e.et, 'all'] || CASE WHEN e.et LIKE 'mae%' THEN ARRAY['mae'] ELSE '{}'::text[] END) et2
  CROSS JOIN LATERAL unnest(ARRAY['any'] || CASE WHEN e.st_ok THEN e.forms ELSE '{}'::text[] END) fm
), kk AS (
  SELECT k.*, row_number() OVER (PARTITION BY key ORDER BY race_date DESC, race_number DESC) AS rn FROM k
  WHERE key = ANY (ARRAY['allA1Y|waku|d1', 'allA1Y|inlost|any', 'allA1Y|inlost|wall', 'allA1Y|inlost|d2', 'allA1Y|inlost|d3', 'allA1Y|inlost|dash', 'allA1Y|mae|flat', 'allA1Y|mae|wall', 'allA1Y|mae|kado', 'allA1Y|mae|d1', 'allA1Y|mae|dash', 'allA1Y|mae6|flat', 'allA1Y|mae6|wall', 'allA1Y|mae6|d2', 'allA1Y|mae6|d3', 'allA1Y|mae6|kado', 'allA1Y|mae6|dash', 'allA1Y|mae5|any', 'allA1Y|mae5|d2', 'allA1Y|mae5|d3', 'allA1Y|mae5|kado', 'allA1Y|mae5|dash', 'allA1Y|mae56|any', 'allA1Y|mae56|flat', 'allA1Y|mae56|wall', 'allA1Y|mae56|d2', 'allA1Y|mae56|d3', 'allA1Y|mae56|kado', 'allA1Y|mae56|dash', 'allA1Y|maeOther|flat', 'allA1Y|maeOther|wall', 'allA1Y|maeOther|d2', 'allA1Y|maeOther|d3', 'allA1Y|maeOther|kado', 'allA1Y|maeOther|d1', 'allA1Y|maeOther|dash', 'allA1Y|all|d1'])
), sel AS (SELECT DISTINCT race_id FROM kk WHERE rn <= 30)
SELECT q.n, q.rows, md5(q.rows) AS md5_rows FROM (SELECT count(*) AS n, string_agg(concat_ws('|', race_id, race_date, venue_code, coalesce(grade, ''), replace(coalesce(title, ''), '|', '/'), replace(coalesce(stage_raw, ''), '|', '/'), race_number,
  rank1 || '-' || rank2 || '-' || rank3, coalesce(tech_raw, ''), coalesce(pay3::text, ''), array_to_string(course_by_boat, ','), array_to_string(forms, ','), et), ';' ORDER BY race_date DESC, race_number DESC) AS rows
FROM (SELECT DISTINCT ON (race_id) * FROM e WHERE race_id IN (SELECT race_id FROM sel) ORDER BY race_id) z) q;
