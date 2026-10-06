-- prep2 cube: 会場×グレード（NULL 含む）×ラウンドの最小セル。node 側で all を合算して CUBE を作る。
-- 1行 = "v|g|r|n|dmin|dmax|1着艇番1..6|決まり手 逃げ,差し,まくり,まくり差し,抜き,恵まれ,その他(6分類以外・NULL)"、行は ';' 区切り
SELECT string_agg(concat_ws('|', venue_code, coalesce(grade, 'NULL'), coalesce(round, 'NULL'), n, dmin, dmax, r1, tc), ';' ORDER BY venue_code, grade, round) AS cells
FROM (
  SELECT venue_code, grade, round, count(*) n, min(race_date) dmin, max(race_date) dmax,
    concat_ws(',', count(*) FILTER (WHERE rank1 = 1), count(*) FILTER (WHERE rank1 = 2), count(*) FILTER (WHERE rank1 = 3),
              count(*) FILTER (WHERE rank1 = 4), count(*) FILTER (WHERE rank1 = 5), count(*) FILTER (WHERE rank1 = 6)) r1,
    concat_ws(',', count(*) FILTER (WHERE tech_raw = '逃げ'), count(*) FILTER (WHERE tech_raw = '差し'), count(*) FILTER (WHERE tech_raw = 'まくり'),
              count(*) FILTER (WHERE tech_raw = 'まくり差し'), count(*) FILTER (WHERE tech_raw = '抜き'), count(*) FILTER (WHERE tech_raw = '恵まれ'),
              count(*) FILTER (WHERE tech_raw IS NULL OR tech_raw NOT IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ'))) tc
  FROM pool GROUP BY venue_code, grade, round
) z;
