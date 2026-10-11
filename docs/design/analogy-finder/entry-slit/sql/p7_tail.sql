-- prep7: 進入の型・スリット7形（BOA-635 spec「スリットの判定」1段目）・その交差。母集団は 120 の定義、2026-09-26 まで。
-- 除外: 返還艇（F・出遅れ。本体は 120 と同じく着欄 F/L/欠・refund_boats も）がいるレース、進入が1艇でも不明のレース。
--       欠場は母集団の定義で既に除かれている。スリットはさらに ST が1艇でも NULL のレースを除く。
-- ST は round(st*100) の整数でコース順に並べて比べる。
-- 範囲(scope): all=全国 / v20=若松 / v20G1=若松×G1 / G1y=G1以上（G1・SG）の優勝戦
-- 1行 = scope|dim|value|n|1号艇1着|1着艇番1..6|決まり手 逃げ,差し,まくり,まくり差し,抜き,恵まれ,その他
--   dim: all=除外後の全レース / a=全艇枠なり(waku)・それ以外(other) / b=前付けをした艇の組（枠なり以外のみ。例 "4"・"36"）/
--        c=1号艇が1コース(yes/no) / s=スリット判定できた全レース / f=スリット形 / af=a×形 / cf=c×形（value は "waku:d2" の形）
--   excl 行: scope|excl|理由|件数（ret=返還艇あり, course=進入不明, st=ST がそろわない（スリットだけ除く））
, x AS (
  SELECT p.*, sc AS scope,
    coalesce(bool_or_ret, false) AS has_ret,
    (array_position(p.course_by_boat, NULL) IS NOT NULL) AS course_unknown
  FROM pool p
  CROSS JOIN LATERAL (SELECT bool_or(r) AS bool_or_ret FROM unnest(p.ret_by_boat) r) rr
  CROSS JOIN LATERAL unnest(ARRAY['all']
    || CASE WHEN p.venue_code = 20 THEN ARRAY['v20'] ELSE '{}'::text[] END
    || CASE WHEN p.venue_code = 20 AND p.grade = 'G1' THEN ARRAY['v20G1'] ELSE '{}'::text[] END
    || CASE WHEN p.grade IN ('G1', 'SG') AND p.round = 'yusho' THEN ARRAY['G1y'] ELSE '{}'::text[] END) sc
  WHERE p.race_date <= DATE '2026-09-26'
), ok AS (
  SELECT x.*,
    CASE WHEN x.course_by_boat = ARRAY[1,2,3,4,5,6]::smallint[] THEN 'waku' ELSE 'other' END AS a,
    (SELECT string_agg(k::text, '' ORDER BY k) FROM generate_series(1, 6) k WHERE x.course_by_boat[k] < k) AS b,
    CASE WHEN x.course_by_boat[1] = 1 THEN 'yes' ELSE 'no' END AS c,
    ARRAY(SELECT round(x.st_by_boat[array_position(x.course_by_boat, cc::smallint)] * 100)::int FROM generate_series(1, 6) cc ORDER BY cc) AS cst
  FROM x WHERE NOT x.has_ret AND NOT x.course_unknown
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
), u AS (
  SELECT scope, rank1, tech_raw, dim, val FROM sl CROSS JOIN LATERAL (
    SELECT 'all' dim, '' val UNION ALL SELECT 'a', a UNION ALL SELECT 'b', b WHERE a = 'other' UNION ALL SELECT 'c', c
    UNION ALL SELECT 's', '' WHERE st_ok
    UNION ALL SELECT 'f', f FROM unnest(forms) f WHERE st_ok
    UNION ALL SELECT 'af', a || ':' || f FROM unnest(forms) f WHERE st_ok
    UNION ALL SELECT 'cf', c || ':' || f FROM unnest(forms) f WHERE st_ok
    UNION ALL SELECT 'as', a WHERE st_ok UNION ALL SELECT 'cs', c WHERE st_ok) d
)
SELECT jsonb_build_object(
 'cells', (SELECT string_agg(concat_ws('|', scope, dim, coalesce(val, ''), n, r1, tc), ';' ORDER BY scope, dim, val) FROM (
   SELECT scope, dim, val, count(*) n,
     concat_ws(',', count(*) FILTER (WHERE rank1 = 1), count(*) FILTER (WHERE rank1 = 2), count(*) FILTER (WHERE rank1 = 3), count(*) FILTER (WHERE rank1 = 4), count(*) FILTER (WHERE rank1 = 5), count(*) FILTER (WHERE rank1 = 6)) r1,
     concat_ws(',', count(*) FILTER (WHERE tech_raw = '逃げ'), count(*) FILTER (WHERE tech_raw = '差し'), count(*) FILTER (WHERE tech_raw = 'まくり'), count(*) FILTER (WHERE tech_raw = 'まくり差し'), count(*) FILTER (WHERE tech_raw = '抜き'), count(*) FILTER (WHERE tech_raw = '恵まれ'), count(*) FILTER (WHERE tech_raw IS NULL OR tech_raw NOT IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ'))) tc
   FROM u GROUP BY scope, dim, val) z),
 'excl', (SELECT string_agg(concat_ws('|', scope, n_pool, n_ret, n_course_only, n_ok, n_st_missing), ';' ORDER BY scope) FROM (
   SELECT x.scope, count(*) n_pool, count(*) FILTER (WHERE has_ret) n_ret, count(*) FILTER (WHERE NOT has_ret AND course_unknown) n_course_only,
     count(*) FILTER (WHERE NOT has_ret AND NOT course_unknown) n_ok,
     (SELECT count(*) FROM sl WHERE sl.scope = x.scope AND NOT st_ok) n_st_missing
   FROM x GROUP BY x.scope) z)
) AS r;
