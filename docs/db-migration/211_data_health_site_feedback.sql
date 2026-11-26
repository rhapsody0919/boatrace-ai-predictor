-- 211: data_health の日次監視に、ご意見ボックス（208 の site_feedback・209 の site_feedback_hourly）の見張りを足す
--
-- 背景: ご意見ボックスは匿名で送れ、全体の上限（10分30行＝1時間180件）で荒らしを止める。止めている間は正規の人も
--   送れないが、拒否した送信は DB に残らず、site_feedback は claude_ro から読めないので、誰も気づけなかった
--   （208 の審査 P2-1）。209 で時ごとの受け付けた件数の表を足した。オーナー決定（2026-11-26）: 人が表を見るのでなく、
--   機械が上限に張り付いた時間に気づいて Slack に知らせる。設計の審査: system-architect（2026-11-26）。
--
-- 実装: scripts/lib/dataHealth/tableSql.js（siteFeedbackSql）・functions.js（data_health_site_feedback）・
--   checks.js（site_feedback.saturation・site_feedback.hourly_counting）。下の関数は
--   `node scripts/maintenance/render-data-health-functions.js data_health_site_feedback` の出力（手で書き写さない）。
--
-- 判定: JST の日ごとに、24時間のうち1時間90件以上の時間が無いこと（閾値100%、days: 1 で前日だけ）と、
--   残っている行の数と時ごとの件数の和がそろうこと（足し込みが止まっていない。days: 7）。返すのは件数だけ。
--   90件は、時の区切りをまたぐ張り付き（長さ L 分は多い方の時に L/2 分しか入らない）を60分以上で拾う値（目安・根拠なし）。
--
-- 変更: CREATE OR REPLACE FUNCTION・REVOKE・GRANT・COMMENT のみ（読み取りの関数。表・データは変えない。ロックなし・冪等）。
--   SECURITY INVOKER で、呼ぶのは data_health ジョブ（service_role）だけ。
--
-- 適用前の確認（読み取り。claude_ro）:
--   SELECT to_regprocedure('public.data_health_site_feedback(date,date)');
--   -> NULL
--   SELECT has_table_privilege('service_role', 'public.site_feedback_hourly', 'SELECT'),
--          has_table_privilege('service_role', 'public.site_feedback', 'SELECT'),
--          (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role');
--   -> true, true, true（209 は service_role に明示の GRANT をしていない。Supabase の既定の権限に頼るので当てる前に見る。
--      false なら関数が落ちて「検査を実行できませんでした」が通知される＝黙らない）
--   SELECT max(received) FROM public.site_feedback_hourly;
--   -> 普段の流量（90 よりずっと小さいこと）
--
-- 適用の前提: lib の差分が master に入っていること（db-apply は master の SQL を当てる）。コードが本番に出た後、適用まで
--   の 06:35 JST の実行では関数が無く「検査を実行できませんでした: ご意見ボックス…」が1回通知され、適用の後の最初の
--   実行で消える。マージの後、次の定時のデプロイ（05:45・11:45・17:45 JST）の前に当てれば出ない。
--   SQL が先に当たっても、古いコードは呼ばないだけで害はない。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT has_function_privilege('anon', 'data_health_site_feedback(date,date)', 'EXECUTE'),
--          has_function_privilege('claude_ro', 'data_health_site_feedback(date,date)', 'EXECUTE');
--   -> false, false
--   翌朝: SELECT last_report->'checks' FROM scrape_job_state WHERE job = 'data_health'; に2件が ok で出る
--   （claude_ro は関数を呼べず site_feedback も読めないので、値の照合はオーナーが SQL Editor で
--    SELECT data_health_site_feedback(current_date - 7, current_date - 1); を流す）
--
-- 戻し: lib の差分を revert して定時で出してから、DROP FUNCTION IF EXISTS data_health_site_feedback(date, date);
--   （逆の順にすると、関数の欠けの通知が鳴る）
--
-- 検証: scripts/maintenance の verify-data-health-site-feedback.js（PGlite、本番には接続しない）

-- data_health_site_feedback
CREATE OR REPLACE FUNCTION data_health_site_feedback(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_site_feedback: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
with dd as (
  select g::date as d from generate_series(p_from::date, p_to::date, interval '1 day') g
), h as (
  select (hour at time zone 'Asia/Tokyo')::date as d, received
  from site_feedback_hourly
  where hour >= (p_from::date::timestamp at time zone 'Asia/Tokyo')
    and hour < ((p_to::date + 1)::timestamp at time zone 'Asia/Tokyo')
), f as (
  select (created_at at time zone 'Asia/Tokyo')::date as d, count(*) as kept
  from site_feedback
  where created_at >= (p_from::date::timestamp at time zone 'Asia/Tokyo')
    and created_at < ((p_to::date + 1)::timestamp at time zone 'Asia/Tokyo')
  group by 1
)
select dd.d::text as d,
    24 as hours,
    24 - count(h.received) filter (where h.received >= 90) as calm_hours,
    coalesce(max(h.received), 0) as max_received,
    coalesce((select kept from f where f.d = dd.d), 0) as kept,
    least(coalesce(sum(h.received), 0), coalesce((select kept from f where f.d = dd.d), 0)) as counted
from dd
left join h on h.d = dd.d
group by dd.d
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_site_feedback(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_site_feedback(date, date) TO service_role;
COMMENT ON FUNCTION data_health_site_feedback(date, date) IS 'データ健全性の日次監視: ご意見ボックス（site_feedback・site_feedback_hourly）の JST の日ごとの、上限に近い時間（1時間90件以上）の無い時間の数と、時ごとの件数の足し込みが止まっていないか。件数だけを返す';
