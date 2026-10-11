-- prep8 3連単の払戻の置き場所の確認（読み取りのみ）
-- 1) 列の一覧: information_schema.columns で payout/trifecta/3tan を含む列
-- 2) 欠損率: 長期 kb_archive_races.payout_3tan（年別）、本体 race_results.payout_trifecta（月別。後で券種が逆と判明）
SELECT 'main' src, to_char(ra.race_date,'YYYY-MM') m, count(*) n, count(rr.payout_trifecta) nn, count(*) FILTER (WHERE rr.payout_trifecta>0) pos, count(*) FILTER (WHERE rr.payout_trifecta>=10000) man
FROM race_results rr JOIN races ra ON ra.race_id=rr.race_id
WHERE ra.race_date BETWEEN '2025-12-03' AND '2026-09-26' AND rr.rank1 IS NOT NULL GROUP BY 2
UNION ALL
SELECT 'kb', to_char(race_date,'YYYY'), count(*), count(payout_3tan), count(*) FILTER (WHERE payout_3tan>0), count(*) FILTER (WHERE payout_3tan>=10000)
FROM kb_archive_races WHERE has_result AND race_date BETWEEN '2019-04-01' AND '2025-12-02' GROUP BY 2 ORDER BY 1,2;
-- 3) 本体の分位（payout_trifecta が 3連単にしては低すぎる）
SELECT percentile_cont(ARRAY[0.1,0.25,0.5,0.75,0.9,0.99]) WITHIN GROUP (ORDER BY payout_trifecta) main_q, (SELECT percentile_cont(ARRAY[0.1,0.25,0.5,0.75,0.9,0.99]) WITHIN GROUP (ORDER BY payout_3tan) FROM kb_archive_races WHERE race_date >= '2025-06-01' AND has_result) kb_q FROM race_results rr JOIN races ra ON ra.race_id=rr.race_id WHERE ra.race_date BETWEEN '2026-01-01' AND '2026-09-26';
-- 4) race_payouts（券種ごとの払戻、2025-12-02〜、3,634R だけ）の 3tan と race_results の列を突き合わせ
SELECT to_char(ra.race_date,'YYYY-MM') m, count(*) n_rp,
 count(*) FILTER (WHERE t.payout = rr.payout_trio) tan_eq_trio, count(*) FILTER (WHERE t.payout = rr.payout_trifecta) tan_eq_trifecta,
 count(*) FILTER (WHERE f.payout = rr.payout_trifecta) fuku_eq_trifecta, count(*) FILTER (WHERE t.combination = rr.rank1||'-'||rr.rank2||'-'||rr.rank3) combo_ok
FROM race_payouts t JOIN race_results rr ON rr.race_id=t.race_id JOIN races ra ON ra.race_id=t.race_id
LEFT JOIN race_payouts f ON f.race_id=t.race_id AND f.bet_type='3fuku' AND f.seq=1
WHERE t.bet_type='3tan' AND t.seq=1 AND t.payout_status='paid' GROUP BY 1 ORDER BY 1;
