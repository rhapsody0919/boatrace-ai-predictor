-- 111: 管理画面（/admin/rules）の運用成績を1本のRPCで集計する（BOA-567）
--
-- 背景: /admin/rules は表示のたびに predictions（2026-01-16以降の standard、約3.8万行）と race_results を
--   画面から1000件ずつページングして取り、ブラウザで集計していた。同じ全件取得が3系統（全体・ルール別・週別）
--   並行して走り、1回の表示で約40ページ×3＋race_results の .in() バッチ約77回×3 のリクエストになっていた。
--   集計をDB側に移し、返すのは生の整数（件数・的中数・払戻合計）だけにする。
--
-- 呼び出し元: api/admin/rules/performance.js（Edge、Basic認証、service key）だけ。
--   ルール定義は src/config/venueRules.js が唯一の正本で、API が p_rules として渡す（DBにルールを持たない）。
--   % の丸め・週の累積・ラベルは src/services/adminRulePerformance.js（旧実装と同じ Math.round の式）。
--
-- 集計の約束（旧実装と同じ）:
--   - predictions は model_id='standard'・predicted_at >= p_start_date（UTCの0時として解釈）
--   - service_role は RLS を迂回するため、匿名の公開ポリシー（is_shadow = false）と同じ条件を WHERE に明示する
--   - race_results の行があるものだけを samples に数える
--   - 券種と払戻の列: win→payout_win、place→1着なら payout_place_1・2着なら payout_place_2、
--     trio（3連複）→payout_trifecta、exacta（3連単）→payout_trio（列名と券種名が逆。歴史的経緯）
--   - 0件のルールも by_rule に返す。週は date_trunc('week')（月曜始まり）で race_id の日付を束ねる
--
-- ⚠️ 本番へ未適用。適用はユーザーの承認後に、ユーザーが実行する（テーブル・データの変更なし）。
-- 適用の順序: この SQL を先に本番へ適用 → その後 PR をマージ（マージ前は旧実装のまま動く。
--   適用だけ先に済んでも、呼び出し元が無いので何も変わらない）。
--
-- 適用手順:
--   Supabase Dashboard > SQL Editor で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   CREATE OR REPLACE FUNCTION・REVOKE・GRANT・COMMENT のみ（テーブルを読み書きしない。ロックなし）。冪等。
--
-- 適用後の確認（読み取りのみ）: scripts/maintenance/verify-admin-rule-performance.js --rpc
--   （本番のRPCを service key で呼び、旧実装の集計と全値が一致するかを見る）
--
-- 元に戻す: DROP FUNCTION IF EXISTS get_admin_rule_performance(jsonb, date);
--
-- verify-admin-rule-performance.js は「-- BEGIN QUERY」〜「-- END QUERY」の間をそのまま取り出し、
-- p_rules / p_start_date を値に置き換えて読み取り専用で実行する（適用前の検証用）。この2行の目印は消さない。

CREATE OR REPLACE FUNCTION get_admin_rule_performance(p_rules jsonb, p_start_date date DEFAULT '2026-01-16')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '30s'
AS $admin_rule_performance$
BEGIN
  IF p_start_date IS NULL OR p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' THEN
    RAISE EXCEPTION 'get_admin_rule_performance: p_rules は配列、p_start_date は必須です';
  END IF;
  IF EXISTS (
    select 1 from jsonb_array_elements(p_rules) x
    where coalesce(x->>'bet_type', '') not in ('win', 'place', 'trio', 'exacta')
       or coalesce(x->>'rule_id', '') = '' or coalesce(x->>'venue_code', '') = ''
  ) THEN
    RAISE EXCEPTION 'get_admin_rule_performance: rule_id・venue_code・bet_type（win/place/trio/exacta）の無いルールがあります';
  END IF;
  RETURN (
-- BEGIN QUERY
with rules as (
  select *
  from jsonb_to_recordset(p_rules) as r(
    rule_id text, venue_code text, bet_type text, top_pick int, conf_min numeric, conf_lt numeric,
    race_min int, race_max int, need_has1 boolean, need_has2 boolean
  )
), p as (
  select race_id,
         split_part(race_id, '-', 4) as venue_code,
         split_part(race_id, '-', 5)::int as race_no,
         left(race_id, 10)::date as race_date,
         coalesce(confidence, 0) as conf,
         top_pick, top_2nd, top_3rd,
         coalesce(1 in (top_pick, top_2nd, top_3rd), false) as has1,
         coalesce(2 in (top_pick, top_2nd, top_3rd), false) as has2
  from predictions
  where model_id = 'standard'
    and predicted_at >= (p_start_date::timestamp at time zone 'UTC')
    and is_shadow = false
), m as (
  select r.rule_id, r.bet_type, p.race_date, p.top_pick, p.top_2nd, p.top_3rd,
         rr.rank1, rr.rank2, rr.rank3,
         rr.payout_win, rr.payout_place_1, rr.payout_place_2, rr.payout_trifecta, rr.payout_trio
  from p
  join rules r on r.venue_code = p.venue_code
   and (r.top_pick is null or p.top_pick = r.top_pick)
   and (r.conf_min is null or p.conf >= r.conf_min)
   and (r.conf_lt is null or p.conf < r.conf_lt)
   and (r.race_min is null or p.race_no >= r.race_min)
   and (r.race_max is null or p.race_no <= r.race_max)
   and (not coalesce(r.need_has1, false) or p.has1)
   and (not coalesce(r.need_has2, false) or p.has2)
  join race_results rr on rr.race_id = p.race_id
), e as (
  select rule_id, race_date,
    case bet_type
      when 'win' then coalesce(top_pick = rank1, false)
      when 'place' then coalesce(top_pick = rank1, false) or coalesce(top_pick = rank2, false)
      when 'trio' then coalesce(
        (select array_agg(x order by x) from unnest(array[top_pick, top_2nd, top_3rd]) x)
          = (select array_agg(x order by x) from unnest(array[rank1, rank2, rank3]) x), false)
      when 'exacta' then coalesce(array[top_pick, top_2nd, top_3rd] = array[rank1, rank2, rank3], false)
    end as hit,
    case bet_type
      when 'win' then coalesce(payout_win, 0)
      when 'place' then case when top_pick = rank1 then coalesce(payout_place_1, 0) else coalesce(payout_place_2, 0) end
      when 'trio' then coalesce(payout_trifecta, 0)
      when 'exacta' then coalesce(payout_trio, 0)
    end as payout
  from m
)
select jsonb_build_object(
  'total', (
    select jsonb_build_object(
      'samples', count(*),
      'hits', count(*) filter (where hit),
      'payout', coalesce(sum(payout) filter (where hit), 0))
    from e),
  'by_rule', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'rule_id', r.rule_id,
      'samples', coalesce(s.samples, 0),
      'hits', coalesce(s.hits, 0),
      'payout', coalesce(s.payout, 0)) order by r.rule_id), '[]'::jsonb)
    from rules r
    left join (
      select rule_id, count(*) as samples, count(*) filter (where hit) as hits,
             coalesce(sum(payout) filter (where hit), 0) as payout
      from e group by rule_id
    ) s on s.rule_id = r.rule_id),
  'by_week', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'week_start', w.week_start::text,
      'samples', w.samples,
      'hits', w.hits,
      'payout', w.payout) order by w.week_start), '[]'::jsonb)
    from (
      select date_trunc('week', race_date::timestamp)::date as week_start, count(*) as samples,
             count(*) filter (where hit) as hits, coalesce(sum(payout) filter (where hit), 0) as payout
      from e group by 1
    ) w)
)
-- END QUERY
  );
END
$admin_rule_performance$;

REVOKE ALL ON FUNCTION get_admin_rule_performance(jsonb, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_admin_rule_performance(jsonb, date) TO service_role;
COMMENT ON FUNCTION get_admin_rule_performance(jsonb, date) IS '管理画面 /admin/rules の運用成績（全体・ルール別・週別の件数・的中数・払戻合計）。ルール定義は呼び出し元（api/admin/rules/performance.js が src/config/venueRules.js から）が p_rules で渡す。service_role のみ。BOA-567';
