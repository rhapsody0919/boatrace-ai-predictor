-- prep8b セル集計（u は p8_common_tail.sql と同じ）: 1行 = scope|et|form|tri|wt
--   u を1回だけ (scope, et, form, 着順, 決まり手) で集計（g）し、そこから tri と wt を作る（長期で statement timeout を避けるため）
--   tri: 3連単の着順（rank1 rank2 rank3 を連結した3桁）:件数 をカンマ区切り。件数0は出ない。3着同着は p8 と同じく rank3=max(boat_number)
--   wt: 1着艇番 決まり手番号:件数 をカンマ区切り（例 "11:525" = 1号艇の逃げ525件）。件数0は出ない
--       決まり手番号 1逃げ,2差し,3まくり,4まくり差し,5抜き,6恵まれ,7その他（NULL 含む）
--   mae と all は build8b.js で基本の型から足し上げる
, g AS MATERIALIZED (
  SELECT scope, et, form, rank1, rank2, rank3,
    CASE tech_raw WHEN '逃げ' THEN 1 WHEN '差し' THEN 2 WHEN 'まくり' THEN 3 WHEN 'まくり差し' THEN 4 WHEN '抜き' THEN 5 WHEN '恵まれ' THEN 6 ELSE 7 END AS tj,
    count(*) AS c
  FROM u GROUP BY 1, 2, 3, 4, 5, 6, 7
), t AS (
  SELECT scope, et, form, string_agg(o || ':' || c, ',' ORDER BY o) AS tri FROM (
    SELECT scope, et, form, concat(rank1, rank2, rank3) AS o, sum(c) AS c FROM g GROUP BY 1, 2, 3, 4) z
  GROUP BY 1, 2, 3
), w AS (
  SELECT scope, et, form, string_agg(o || ':' || c, ',' ORDER BY o) AS wt FROM (
    SELECT scope, et, form, concat(rank1, tj) AS o, sum(c) AS c FROM g GROUP BY 1, 2, 3, 4) z
  GROUP BY 1, 2, 3
)
SELECT string_agg(concat_ws('|', t.scope, t.et, t.form, t.tri, w.wt), ';' ORDER BY t.scope, t.et, t.form) AS r
FROM t JOIN w USING (scope, et, form);
