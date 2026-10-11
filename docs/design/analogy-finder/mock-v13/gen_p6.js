// prep6 の tail SQL を生成する。使い方: node gen_p6.js > sql/p6_tail.sql
const cnt = (w) => `count(*) FILTER (WHERE ${w})`;
const boats = [1, 2, 3, 4, 5, 6].flatMap((k) => [1, 2, 3].map((t) => cnt(`coalesce(fin_by_boat[${k}] <= ${t}, false)`)));
console.log(`-- prep6: レース全体で同じ値の条件（風速・波高・天候・グレード・ラウンド）ごとの、艇番1〜6の 1着・2着以内・3着以内 の件数。
-- 母集団は 120 の定義、2026-09-26 まで。gen_p6.js が生成。
-- 帯: 風速 0〜1m／2〜3m／4〜5m／6m以上／不明（m は整数で記録されている）、波高 0〜2cm／3〜5cm／6cm以上／不明、
--     天候 晴／曇り／雨／雪／その他・不明（霧・台風・NULL）
-- 1行 = unit|n|n_kb|n_main|dmin|dmax|艇1の1着,2着以内,3着以内,艇2…,艇6
-- unit: w:風速帯 / h:波高帯 / t:天候 / g:グレード（NULL 含む）/ r:ラウンド / x:G1以上かつ優勝戦 /
--       v20w:若松の風速帯 / va:会場（全体）/ v6:会場（風速6m以上）
, b AS (
  SELECT p.*,
    CASE WHEN wind_speed IS NULL THEN '不明' WHEN wind_speed <= 1 THEN '0-1' WHEN wind_speed <= 3 THEN '2-3' WHEN wind_speed <= 5 THEN '4-5' ELSE '6+' END AS wband,
    CASE WHEN wave_height IS NULL THEN '不明' WHEN wave_height <= 2 THEN '0-2' WHEN wave_height <= 5 THEN '3-5' ELSE '6+' END AS hband,
    CASE WHEN weather IN ('晴', '曇り', '雨', '雪') THEN weather ELSE 'その他・不明' END AS tband
  FROM pool p WHERE p.race_date <= DATE '2026-09-26'
), u AS (
  SELECT b.*, unit FROM b CROSS JOIN LATERAL unnest(ARRAY[
      'w:' || wband, 'h:' || hband, 't:' || tband, 'g:' || coalesce(grade, 'NULL'), 'r:' || coalesce(round, 'NULL'), 'va:' || venue_code]
    || CASE WHEN grade IN ('G1', 'SG') AND round = 'yusho' THEN ARRAY['x:G1+yusho'] ELSE '{}'::text[] END
    || CASE WHEN venue_code = 20 THEN ARRAY['v20w:' || wband] ELSE '{}'::text[] END
    || CASE WHEN wband = '6+' THEN ARRAY['v6:' || venue_code] ELSE '{}'::text[] END) unit
)
SELECT string_agg(concat_ws('|', unit, n, n_kb, n_main, dmin, dmax, bx), ';' ORDER BY unit) AS cells FROM (
  SELECT unit, count(*) n, ${cnt("source = 'kb'")} n_kb, ${cnt("source = 'main'")} n_main, min(race_date) dmin, max(race_date) dmax,
    concat_ws(',', ${boats.join(', ')}) bx
  FROM u GROUP BY unit) z;`);
