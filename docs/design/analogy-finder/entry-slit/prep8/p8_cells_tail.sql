-- prep8 セル集計: 1行 = scope|et|form|n|1着艇番1..6|2着艇番1..6|3着艇番1..6|決まり手7|万舟|払戻あり
--   決まり手の順: 逃げ,差し,まくり,まくり差し,抜き,恵まれ,その他（NULL 含む）
--   万舟＝3連単の払戻 >= 10000円。払戻あり＝払戻 > 0 が取れたレース（分母）
--   mae と all は build8.js で基本の型から足し上げる
SELECT jsonb_build_object(
 'cells', (SELECT string_agg(concat_ws('|', scope, et, form, n, r1, r2, r3, tc, man, payn), ';' ORDER BY scope, et, form) FROM (
   SELECT scope, et, form, count(*) n,
     concat_ws(',', count(*) FILTER (WHERE rank1 = 1), count(*) FILTER (WHERE rank1 = 2), count(*) FILTER (WHERE rank1 = 3), count(*) FILTER (WHERE rank1 = 4), count(*) FILTER (WHERE rank1 = 5), count(*) FILTER (WHERE rank1 = 6)) r1,
     concat_ws(',', count(*) FILTER (WHERE rank2 = 1), count(*) FILTER (WHERE rank2 = 2), count(*) FILTER (WHERE rank2 = 3), count(*) FILTER (WHERE rank2 = 4), count(*) FILTER (WHERE rank2 = 5), count(*) FILTER (WHERE rank2 = 6)) r2,
     concat_ws(',', count(*) FILTER (WHERE rank3 = 1), count(*) FILTER (WHERE rank3 = 2), count(*) FILTER (WHERE rank3 = 3), count(*) FILTER (WHERE rank3 = 4), count(*) FILTER (WHERE rank3 = 5), count(*) FILTER (WHERE rank3 = 6)) r3,
     concat_ws(',', count(*) FILTER (WHERE tech_raw = '逃げ'), count(*) FILTER (WHERE tech_raw = '差し'), count(*) FILTER (WHERE tech_raw = 'まくり'), count(*) FILTER (WHERE tech_raw = 'まくり差し'), count(*) FILTER (WHERE tech_raw = '抜き'), count(*) FILTER (WHERE tech_raw = '恵まれ'), count(*) FILTER (WHERE tech_raw IS NULL OR tech_raw NOT IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ'))) tc,
     count(*) FILTER (WHERE pay3 >= 10000) man, count(pay3) payn
   FROM u GROUP BY scope, et, form) z),
 'excl', (SELECT string_agg(concat_ws('|', scope, n_pool, n_ret, n_course_only, n_ok, n_st_missing, n_dh2, n_dh3, n_pay_missing), ';' ORDER BY scope) FROM (
   SELECT x.scope, count(*) n_pool, count(*) FILTER (WHERE has_ret) n_ret, count(*) FILTER (WHERE NOT has_ret AND course_unknown) n_course_only,
     count(*) FILTER (WHERE NOT has_ret AND NOT course_unknown) n_ok,
     (SELECT count(*) FROM sl WHERE sl.scope = x.scope AND NOT st_ok) n_st_missing,
     (SELECT count(*) FROM sl WHERE sl.scope = x.scope AND dh2) n_dh2,
     (SELECT count(*) FROM sl WHERE sl.scope = x.scope AND dh3) n_dh3,
     (SELECT count(*) FROM sl WHERE sl.scope = x.scope AND pay3 IS NULL) n_pay_missing
   FROM x GROUP BY x.scope) z)
) AS r;
