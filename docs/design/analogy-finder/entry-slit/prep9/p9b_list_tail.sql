-- prep9b 一覧用: 件数30未満のセルごとに新しい順30件に入るレースを1行ずつ返す（セルへの振り分けと件数の照合は build9.js）。e までは p9b_common_tail.sql と同じ
-- 1行 = race_id|日付|会場|グレード|開催名|ステージ|R|1着-2着-3着|決まり手|3連単払戻|進入コース(1..6号艇)|形(,区切り)|進入の型
, k AS (
  SELECT e.*, scope || '|' || et2 || '|' || fm AS key FROM e
  CROSS JOIN LATERAL unnest(ARRAY[e.et, 'all'] || CASE WHEN e.et LIKE 'mae%' THEN ARRAY['mae'] ELSE '{}'::text[] END) et2
  CROSS JOIN LATERAL unnest(ARRAY['any'] || CASE WHEN e.st_ok THEN e.forms ELSE '{}'::text[] END) fm
), kk AS (
  SELECT k.*, row_number() OVER (PARTITION BY key ORDER BY race_date DESC, race_number DESC) AS rn FROM k
  WHERE key = ANY (ARRAY['v20A1|inlost|any', 'v20A1|inlost|flat', 'v20A1|inlost|wall', 'v20A1|inlost|d2', 'v20A1|inlost|d3', 'v20A1|inlost|kado', 'v20A1|inlost|d1', 'v20A1|inlost|dash', 'v20A1|mae|kado', 'v20A1|mae|d1', 'v20A1|mae|dash', 'v20A1|mae6|flat', 'v20A1|mae6|wall', 'v20A1|mae6|d2', 'v20A1|mae6|d3', 'v20A1|mae6|kado', 'v20A1|mae6|d1', 'v20A1|mae6|dash', 'v20A1|mae5|flat', 'v20A1|mae5|wall', 'v20A1|mae5|d2', 'v20A1|mae5|d3', 'v20A1|mae5|kado', 'v20A1|mae5|d1', 'v20A1|mae5|dash', 'v20A1|mae56|any', 'v20A1|mae56|flat', 'v20A1|mae56|wall', 'v20A1|mae56|d2', 'v20A1|mae56|d3', 'v20A1|mae56|kado', 'v20A1|mae56|d1', 'v20A1|mae56|dash', 'v20A1|maeOther|flat', 'v20A1|maeOther|wall', 'v20A1|maeOther|d2', 'v20A1|maeOther|d3', 'v20A1|maeOther|kado', 'v20A1|maeOther|d1', 'v20A1|maeOther|dash', 'allA1|inlost|flat', 'allA1|inlost|wall', 'allA1|inlost|kado', 'allA1|inlost|d1', 'allA1|inlost|dash'])
), sel AS (SELECT DISTINCT race_id FROM kk WHERE rn <= 30)
SELECT q.n, q.rows, md5(q.rows) AS md5_rows FROM (SELECT count(*) AS n, string_agg(concat_ws('|', race_id, race_date, venue_code, coalesce(grade, ''), replace(coalesce(title, ''), '|', '/'), replace(coalesce(stage_raw, ''), '|', '/'), race_number,
  rank1 || '-' || rank2 || '-' || rank3, coalesce(tech_raw, ''), coalesce(pay3::text, ''), array_to_string(course_by_boat, ','), array_to_string(forms, ','), et), ';' ORDER BY race_date DESC, race_number DESC) AS rows
FROM (SELECT DISTINCT ON (race_id) * FROM e WHERE race_id IN (SELECT race_id FROM sel) ORDER BY race_id) z) q;
