-- facts の表に同じレースの6艇の選手と着の並びを足し、匿名の RPC が「その選手の出たレースの6艇の走」を返すようにする
-- （ADR-0113 決定4 の追記 2026-11-27、docs/design/past-data-backfill/db-draft.md。未審査の案）
-- 理由: 選手ページの履歴の整形（src/services/racerRaceHistoryRows.js）は、同じレースの他の艇の ST（レース内の ST 順位）・
--   展示タイム（他の5艇の平均）・着の並び（race_results.rank1〜6）を使う。212 の RLS は本人の行しか通さず、作れない
-- 前提: 212 が適用済みで、race_facts・run_facts は空（kb 層の CLI の --apply の前。後だと kb の全期間を作り直す）
-- 適用の後に、書き手（scripts/lib/raceFactsKb.js・raceFactsMain.js の RACE_FACT_COLUMNS と Cron）を新しい列に合わせる PR をマージする。
--   racer_ids は NOT NULL なので、古い書き手の upsert は書けずに落ちる（RLS で黙って消えない）。書き手の PR まで kb の --apply と Cron の live をしない
-- 事後: anon のキーで rpc/get_racer_runs が []（表が空のとき）、GET race_facts・run_facts が []。
--   pg_policies の run_facts_one_racer・race_facts_one_racer が下の式。
--   kb を入れた後（claude_ro）: racer_ids と run_facts の選手の一致（0行を期待）:
--     SELECT count(*) FROM run_facts r JOIN race_facts f USING (race_id) WHERE r.racer_id IS DISTINCT FROM f.racer_ids[r.boat_number];
--   匿名の直の読みの重さ（SQL Editor）: BEGIN READ ONLY; SET LOCAL ROLE anon; EXPLAIN ANALYZE SELECT race_id FROM run_facts LIMIT 1; ROLLBACK;
--     OR の式で索引が効かず Seq Scan になる（PGlite で13.8万行 40ms）。1秒を超えたら式を見直す（ADR-0113 の見直しの契機）
-- 戻し（212 のポリシーと関数に戻し、列を消す。書き手を戻してから）:
--   BEGIN; SET LOCAL lock_timeout = '10s';
--   DROP POLICY IF EXISTS run_facts_one_racer ON public.run_facts;
--   CREATE POLICY run_facts_one_racer ON public.run_facts FOR SELECT TO anon, authenticated
--     USING (racer_id = nullif(current_setting('boatai.facts_racer_id', true), '')::integer);
--   DROP POLICY IF EXISTS race_facts_one_racer ON public.race_facts;
--   CREATE POLICY race_facts_one_racer ON public.race_facts FOR SELECT TO anon, authenticated
--     USING (EXISTS (SELECT 1 FROM public.run_facts r WHERE r.race_id = race_facts.race_id));
--   （ポリシーはこの順で戻す。逆だと2つのポリシーが互いを参照し、読みが infinite recursion になる）
--   212 の get_racer_runs と COMMENT に戻す（212_race_facts.sql の写し）:
--   CREATE OR REPLACE FUNCTION public.get_racer_runs(p_racer_id integer, p_from date)
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   STABLE
--   SECURITY INVOKER
--   SET search_path = public
--   AS $$
--   DECLARE
--     v_rows jsonb;
--   BEGIN
--     IF p_racer_id IS NULL OR p_from IS NULL THEN
--       RAISE EXCEPTION 'get_racer_runs: p_racer_id と p_from は必須（%、%）', p_racer_id, p_from;
--     END IF;
--     PERFORM set_config('boatai.facts_racer_id', p_racer_id::text, true);
--     SELECT COALESCE(jsonb_agg(to_jsonb(u) - 'built_at' - 'rule_version' ORDER BY u.race_id), '[]'::jsonb)
--       INTO v_rows
--       FROM (
--         SELECT r.*, to_jsonb(f) - 'race_id' - 'era' - 'race_date' - 'built_at' - 'rule_version' AS race
--           FROM public.run_facts r
--           JOIN public.race_facts f ON f.race_id = r.race_id
--          WHERE r.racer_id = p_racer_id
--            AND r.race_id >= to_char(p_from, 'YYYY-MM-DD')
--       ) u;
--     -- 読んだらすぐ空に戻す（同じトランザクションの後の文に残さない）。関数の SET 句は本番の postgres（superuser でない）が
--     -- 未知の設定に作れない（212 の db-apply の失敗、2026-11-27）ので使わない。例外のときはトランザクションごと戻り、セーブポイント・EXCEPTION 節で捕まえてもトランザクションの中だけの設定は戻る
--     PERFORM set_config('boatai.facts_racer_id', '', true);
--     RETURN v_rows;
--   END;
--   $$;
--   
--   COMMENT ON FUNCTION public.get_racer_runs(integer, date) IS
--     '選手1人の走を jsonb で返す（ADR-0113 決定4）。SECURITY INVOKER。本文の set_config(..., true) で boatai.facts_racer_id を立てて読み、読んだらすぐ空に戻す。表の RLS がその選手の行だけを通す';
--   ALTER TABLE public.race_facts DROP COLUMN IF EXISTS racer_ids; ALTER TABLE public.race_facts DROP COLUMN IF EXISTS finish_order; COMMIT;
SET LOCAL lock_timeout = '10s';

-- NOT NULL: 表が空でなければここで落ちて全部戻る（前提の機械の確かめ）。古い書き手の upsert は落ちる（黙って RLS で消えない）
ALTER TABLE public.race_facts ADD COLUMN IF NOT EXISTS racer_ids integer[] NOT NULL;
ALTER TABLE public.race_facts ADD COLUMN IF NOT EXISTS finish_order smallint[];
ALTER TABLE public.race_facts DROP CONSTRAINT IF EXISTS race_facts_racer_ids_len;
ALTER TABLE public.race_facts ADD CONSTRAINT race_facts_racer_ids_len
  CHECK (array_ndims(racer_ids) = 1 AND array_lower(racer_ids, 1) = 1 AND cardinality(racer_ids) = 6);
ALTER TABLE public.race_facts DROP CONSTRAINT IF EXISTS race_facts_finish_order_len;
ALTER TABLE public.race_facts ADD CONSTRAINT race_facts_finish_order_len
  CHECK (finish_order IS NULL OR (array_ndims(finish_order) = 1 AND array_lower(finish_order, 1) = 1 AND cardinality(finish_order) = 6
    AND 1 <= ALL (finish_order) AND 6 >= ALL (finish_order)));
COMMENT ON COLUMN public.race_facts.racer_ids IS
  '艇番の順（1〜6、添字は1から）の選手の登録番号。欠けた艇は配列の中の NULL。書き手は run_facts.racer_id と一致させる（DB は守らない、事後の確かめで見る）。RLS がこの列でその選手の出たレースを通す（ADR-0113 決定4 の追記 2026-11-27）';
COMMENT ON COLUMN public.race_facts.finish_order IS
  '1着から順の艇番。main は race_results.rank1〜6、kb は run_facts.finish_rank の順（同着は艇番の順に詰め、dead_heat で知らせる。同着の艇の着は run_facts.finish_rank で読む）。着の付かない位置は NULL';

-- race_facts は自分の列だけで判定する（run_facts を参照しない＝ポリシーが再帰しない）
DROP POLICY IF EXISTS race_facts_one_racer ON public.race_facts;
CREATE POLICY race_facts_one_racer ON public.race_facts
  FOR SELECT TO anon, authenticated
  USING (nullif(current_setting('boatai.facts_racer_id', true), '')::integer = ANY (racer_ids));
-- run_facts は本人の行か、本人の出たレースの艇（1トランザクションに1選手のまま。設定が空なら0行）
DROP POLICY IF EXISTS run_facts_one_racer ON public.run_facts;
CREATE POLICY run_facts_one_racer ON public.run_facts
  FOR SELECT TO anon, authenticated
  USING (
    racer_id = nullif(current_setting('boatai.facts_racer_id', true), '')::integer
    OR EXISTS (
      SELECT 1 FROM public.race_facts f
       WHERE f.race_id = run_facts.race_id
         AND nullif(current_setting('boatai.facts_racer_id', true), '')::integer = ANY (f.racer_ids)
    )
  );

-- 212 で付けた権限をそのまま明示する（076 以降は既定で剥がすため。verify-migration-rls の確かめ）
GRANT SELECT ON public.race_facts TO anon;
GRANT SELECT ON public.race_facts TO authenticated;
GRANT SELECT ON public.run_facts TO anon;
GRANT SELECT ON public.run_facts TO authenticated;

-- 選手1人の走（p_from 以降）を、レースの値と同じレースの6艇の走（boats、艇番の順）と一緒に返す（古い順）
CREATE OR REPLACE FUNCTION public.get_racer_runs(p_racer_id integer, p_from date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF p_racer_id IS NULL OR p_from IS NULL THEN
    RAISE EXCEPTION 'get_racer_runs: p_racer_id と p_from は必須（%、%）', p_racer_id, p_from;
  END IF;
  PERFORM set_config('boatai.facts_racer_id', p_racer_id::text, true);
  SELECT COALESCE(jsonb_agg(to_jsonb(u) - 'built_at' - 'rule_version' ORDER BY u.race_id), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT r.*,
             to_jsonb(f) - 'race_id' - 'era' - 'race_date' - 'built_at' - 'rule_version' AS race,
             (SELECT jsonb_agg(jsonb_build_object(
                       'boat_number', o.boat_number, 'racer_id', o.racer_id, 'course', o.course,
                       'start_timing', o.start_timing, 'is_flying', o.is_flying,
                       'finish_mark', o.finish_mark, 'finish_rank', o.finish_rank,
                       'exhibition_time', o.exhibition_time) ORDER BY o.boat_number)
                FROM public.run_facts o
               WHERE o.race_id = r.race_id) AS boats
        FROM public.run_facts r
        JOIN public.race_facts f ON f.race_id = r.race_id
       WHERE r.racer_id = p_racer_id
         AND r.race_id >= to_char(p_from, 'YYYY-MM-DD')
    ) u;
  -- 読んだらすぐ空に戻す（同じトランザクションの後の文に残さない。関数の SET 句は本番の postgres が作れないので使わない、212）
  PERFORM set_config('boatai.facts_racer_id', '', true);
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.get_racer_runs(integer, date) IS
  '選手1人の走を、レースの値と同じレースの6艇の走（boats）と一緒に jsonb で返す（ADR-0113 決定4 の追記 2026-11-27）。SECURITY INVOKER。本文の set_config(..., true) で boatai.facts_racer_id を立てて読み、読んだらすぐ空に戻す。RLS がその選手の出たレースの行だけを通す';

REVOKE ALL ON FUNCTION public.get_racer_runs(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_racer_runs(integer, date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_racer_runs(integer, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_racer_runs(integer, date) TO service_role;
