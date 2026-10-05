// prep5 の tail SQL を生成する（集計式が多いので機械生成）。使い方: node gen_p5.js > sql/p5_tail.sql
const IND = ['b1d', 'b1s', 'st1_tie', 'ib', 'md'];
const cond = (k, ind) => ({
  b1d: k === 1 ? 'false' : '(f[1] IS NULL OR f[1] > 3)',
  b1s: k === 1 ? 'false' : 'coalesce(sr[1] >= 4, false)',
  st1_tie: `coalesce(sr[${k}] = 1, false)`,
  ib: `ib[${k}]`,
  md: `coalesce(cb[${k}] < ${k}, false)`,
}[ind]);
const hit = (k) => `f[${k}] = 1`;
const cmp = (k) => (k === 1 ? 'rank1 <> 1' : `rank1 NOT IN (1, ${k})`);
const cnt = (w) => `count(*) FILTER (WHERE ${w})`;
const list = (xs) => `concat_ws(',', ${xs.join(', ')})`;
const r1 = list([1, 2, 3, 4, 5, 6].map((b) => cnt(`rank1 = ${b}`)));
const T = ['逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ'];
const tech = list([...T.map((t) => cnt(`tech_raw = '${t}'`)), cnt(`tech_raw IS NULL OR tech_raw NOT IN (${T.map((t) => `'${t}'`).join(', ')})`)]);
const kt = list([1, 2, 3, 4, 5, 6].flatMap((k) => [1, 2, 3].map((t) => cnt(`coalesce(f[${k}] <= ${t}, false)`))));
const hitInd = list([1, 2, 3, 4, 5, 6].flatMap((k) => IND.map((i) => cnt(`${hit(k)} AND ${cond(k, i)}`))));
const cmpN = list([1, 2, 3, 4, 5, 6].map((k) => cnt(cmp(k))));
const cmpInd = list([1, 2, 3, 4, 5, 6].flatMap((k) => IND.map((i) => cnt(`${cmp(k)} AND ${cond(k, i)}`))));
console.log(`-- prep5: 例のレース 2026-09-27-20-12 の4条件（gap_band=1・b1_class=A1・venue=20・top_boat=4）の全16部分集合＋「1111」に任意の条件を1つ足した3つ。
-- 母集団は 2026-09-26 まで。gen_p5.js が生成。
-- 1行（cells の ';' 区切り）= key|n|n_kb|n_main|dmin|dmax|1着艇番1..6|決まり手 逃げ,差し,まくり,まくり差し,抜き,恵まれ,その他|
--   n_hit(k=1..6 × t=1,2,3)|hit側の指標(k=1..6 × b1d,b1s,st1_tie,ib,md)|比べる相手の件数(k=1..6)|比べる相手の指標(k=1..6 × 5)
-- 比べる相手: k=1 は 1号艇が1着でない、k≥2 は 1着が1号艇でも k号艇でもない。hit = 艇 k が1着。
-- 指標の定義は prep.json と同じ（k=1 の b1d・b1s は 0 を出す）。ST 順位は min 順位、返還艇・不明は NULL。
, c AS (
  SELECT p.*,
    CASE WHEN p.b1_win_gap IS NULL THEN 5 WHEN p.b1_win_gap >= 0.19 THEN 4 WHEN p.b1_win_gap >= -0.49 THEN 3
         WHEN p.b1_win_gap >= -1.14 THEN 2 WHEN p.b1_win_gap >= -1.91 THEN 1 ELSE 0 END AS gap_band,
    CASE WHEN p.motor_rank IS NULL THEN 3 WHEN p.motor_rank <= 2 THEN 0 WHEN p.motor_rank <= 4 THEN 1 ELSE 2 END AS motor_band,
    ARRAY(SELECT CASE WHEN p.st_by_boat[i] IS NULL THEN NULL ELSE 1 + (SELECT count(*) FROM unnest(p.st_by_boat) x WHERE x < p.st_by_boat[i]) END
          FROM generate_series(1, 6) i ORDER BY i) AS sr,
    ARRAY(SELECT EXISTS (SELECT 1 FROM generate_series(1, k - 1) j WHERE p.ret_by_boat[j] OR p.code_by_boat[j] LIKE 'S%' OR p.code_by_boat[j] IN ('F', 'L', 'L0', 'L1'))
          FROM generate_series(1, 6) k ORDER BY k) AS ib
  FROM pool p WHERE p.race_date <= DATE '2026-09-26'
), u AS (
  SELECT c.*, c.fin_by_boat AS f, c.course_by_boat AS cb, key
  FROM c CROSS JOIN LATERAL (
    SELECT lpad(((m >> 3) & 1)::text, 1) || ((m >> 2) & 1)::text || ((m >> 1) & 1)::text || (m & 1)::text AS key
    FROM generate_series(0, 15) m
    WHERE ((m & 8) = 0 OR c.gap_band = 1) AND ((m & 4) = 0 OR c.b1_class = 'A1') AND ((m & 2) = 0 OR c.venue_code = 20) AND ((m & 1) = 0 OR c.top_boat = 4)
    UNION ALL SELECT '1111+round' WHERE c.gap_band = 1 AND c.b1_class = 'A1' AND c.venue_code = 20 AND c.top_boat = 4 AND c.round = 'yusho'
    UNION ALL SELECT '1111+grade' WHERE c.gap_band = 1 AND c.b1_class = 'A1' AND c.venue_code = 20 AND c.top_boat = 4 AND c.grade = 'G1'
    UNION ALL SELECT '1111+motor' WHERE c.gap_band = 1 AND c.b1_class = 'A1' AND c.venue_code = 20 AND c.top_boat = 4 AND c.motor_band = 2
  ) k
)
SELECT jsonb_build_object(
 'cells', (SELECT string_agg(concat_ws('|', key, n, n_kb, n_main, dmin, dmax, r1, tech, kt, hit_ind, cmp_n, cmp_ind), ';' ORDER BY key) FROM (
   SELECT key, count(*) n, ${cnt("source = 'kb'")} n_kb, ${cnt("source = 'main'")} n_main, min(race_date) dmin, max(race_date) dmax,
     ${r1} r1,
     ${tech} tech,
     ${kt} kt,
     ${hitInd} hit_ind,
     ${cmpN} cmp_n,
     ${cmpInd} cmp_ind
   FROM u GROUP BY key) z),
 'trifecta', (SELECT string_agg(key || '=' || t, ';' ORDER BY key) FROM (
   SELECT key, string_agg(combo || ':' || c, ',' ORDER BY combo) t FROM (
     SELECT key, rank1::text || rank2::text || rank3::text combo, count(*) c FROM u GROUP BY 1, 2) y GROUP BY key) z),
 'list_1111', (SELECT string_agg(concat_ws('|', race_date, venue_code, race_number, coalesce(grade, 'NULL'), coalesce(stage_raw, ''),
       rank1 || '-' || rank2 || '-' || rank3, coalesce(tech_raw, 'NULL'), array_to_string(code_by_boat, ',', '-'),
       array_to_string(st_by_boat, ',', '-'), array_to_string(sr, ',', '-'), array_to_string(course_by_boat, ',', '-'), coalesce(payout_3tan::text, '-'), source), ';' ORDER BY race_date, race_number)
   FROM u WHERE key = '1111')
) AS r;`);
