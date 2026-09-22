-- 予定表の取得（claim）に、窓（offset_min）ごとの許容幅の上書きを足す新関数 claim_scrape_slots_by_offset を追加する。
-- 用途: オッズの発走60分前の窓（-60）だけ、未公開の間、許容幅を3分から30分に延ばす（完了の定義Bの見直し。
--       .claude/rules/data-acquisition.md のB、docs/design/scraping-vercel-consolidation/verification-runbook.md M-8）。
--
-- 対応spec/plan: docs/design/scraping-vercel-consolidation/plan.md §3 / tasks.md T4b-24
-- 前提: 075（scrape_slots・claim_scrape_slots・ensure_scrape_slots）が適用済みであること
--
-- **既存の claim_scrape_slots（075）のコピー元**: この関数は、075 の claim_scrape_slots の本体を、そのままコピーし、
--   許容幅（p_grace_min）を「offset_min ごとに上書きできる」ようにしただけの関数である。違いは次の3点のみ:
--     1. 引数に p_grace_by_offset JSONB DEFAULT '{}' を追加（例 {"-60": 30}。キーは offset_min の文字列、値は許容幅（分）。
--        指定した offset_min だけ、p_grace_min の代わりにこの値を使う。指定の無い offset_min は p_grace_min のまま）
--     2. (2) 期限切れ化の許容幅と (3) 取得対象の許容幅の判定が、上書きを考慮した値になる
--     3. p_grace_by_offset の検査（オブジェクトで、キーは整数の文字列、値は0以上の整数）
--   p_grace_by_offset が空（'{}' または NULL）のとき、既存の claim_scrape_slots と、同じ予定表・同じ時刻で、同じ結果を返す
--   （scripts/maintenance/verify-scrape-slots-sql.js が、複数のシナリオで、新旧を突き合わせる差分テストで確認する）。
--   既存の関数・テーブル・列は変更しない（別名の新関数を追加するだけ。PostgREST のオーバーロードの曖昧さを避けるため）。
--   ensure_scrape_slots は変更不要（p_defs の grace_min が、定義ごと＝offset ごとに、既に渡せる）。
--
-- 適用手順（ユーザーが実行する。**コードのマージより先に適用する**が、適用前にマージしても無害:
--   コードは、この関数が無い（PGRST202）ときだけ、既存の claim_scrape_slots へ自動でフォールバックし、
--   ログと scrape_job_state.last_report のアラートに残す。延長は効かないが、オッズの取得は従来どおり動く）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   関数の追加のみ（テーブル・データの変更なし）。ロックは取らないため、開催時間帯でも適用できる。
--   DOブロックが例外を出した場合は、COMMITせずROLLBACKする（何も変更されない）。
--
--   適用後の確認（読み取りのみ）: 末尾のコメント「適用後の確認SQL」を参照。
--
--   ロールバック（コードは、関数が無ければ既存の関数へフォールバックするため、コードの変更は不要）:
--     DROP FUNCTION IF EXISTS claim_scrape_slots_by_offset(TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB);

SET LOCAL lock_timeout = '10s';

-- ----------------------------------------------------------------------------
-- claim_scrape_slots_by_offset（期限が来たスロットを取る。offset_min ごとの許容幅の上書きつき）
-- ----------------------------------------------------------------------------
-- 1回の呼び出しで、次を行う（何も該当しなければ書き込みなし。claim_scrape_slots と同じ）:
--   (1) 確定中止（races.cancellation_status='confirmed'）のレースの pending スロットを、
--       outcome='cancelled_race' で終端する
--   (2) 期限+許容幅を過ぎた pending・リース切れの running を expired にする（許容幅は offset_min ごとの上書きを考慮）
--   (3) 期限が来て（期限 <= 現在）、次回試行時刻に到達した pending（またはリース切れの running）を、
--       期限の早い順に最大 p_limit 件、FOR UPDATE SKIP LOCKED で取り、running・リース・attempts+1・
--       claimed_by を設定して返す
-- 走査は race_date >= (JSTの今日 − 1日) に限る（それより古い未完了は scrape-cleanup が expired にする）。
-- 許容幅の上書きで延びた窓でも、リースは許容幅より短くすること（アプリ側のレジストリ検査 validateRegistry が確認）。
-- p_now: テスト用（既定は now()）
CREATE OR REPLACE FUNCTION claim_scrape_slots_by_offset(
    p_job TEXT,
    p_limit INTEGER,
    p_lease_sec INTEGER,
    p_worker TEXT,
    p_grace_min INTEGER,
    p_run_mode TEXT DEFAULT 'live',
    p_now TIMESTAMPTZ DEFAULT now(),
    p_grace_by_offset JSONB DEFAULT '{}'::jsonb
) RETURNS SETOF scrape_slots
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_min_date DATE := ((p_now AT TIME ZONE 'Asia/Tokyo')::DATE - 1);
    -- NULL は「上書きなし」と同じ扱い
    v_by_offset JSONB := COALESCE(p_grace_by_offset, '{}'::jsonb);
    v_key TEXT;
    v_val TEXT;
BEGIN
    IF p_run_mode NOT IN ('live', 'shadow') THEN
        RAISE EXCEPTION 'claim_scrape_slots_by_offset: p_run_mode は live か shadow です: %', p_run_mode;
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_lease_sec IS NULL OR p_lease_sec < 1
       OR p_worker IS NULL OR p_grace_min IS NULL OR p_grace_min < 0 THEN
        RAISE EXCEPTION 'claim_scrape_slots_by_offset: 引数が不正です（limit=%, lease_sec=%, worker=%, grace_min=%）',
            p_limit, p_lease_sec, p_worker, p_grace_min;
    END IF;
    IF jsonb_typeof(v_by_offset) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'claim_scrape_slots_by_offset: p_grace_by_offset は JSON オブジェクトで指定してください: %', v_by_offset;
    END IF;
    FOR v_key, v_val IN SELECT k, v FROM jsonb_each_text(v_by_offset) AS t(k, v) LOOP
        IF v_key !~ '^-?[0-9]{1,5}$' OR v_val !~ '^[0-9]{1,5}$' THEN
            RAISE EXCEPTION 'claim_scrape_slots_by_offset: p_grace_by_offset のキー（offset_min の整数）・値（0以上の整数の分）が不正です: %=%', v_key, v_val;
        END IF;
    END LOOP;

    -- (1) 確定中止のレースのスロットを終端する
    UPDATE scrape_slots s
       SET status = 'done', outcome = 'cancelled_race', done_at = p_now,
           lease_until = NULL, next_attempt_at = NULL
      FROM races r
     WHERE s.job = p_job
       AND s.status = 'pending'
       AND s.race_date >= v_min_date
       AND r.race_id = s.race_id
       AND r.cancellation_status = 'confirmed';

    -- (2) 期限+許容幅を超えたものを expired にする
    UPDATE scrape_slots s
       SET status = 'expired', lease_until = NULL, next_attempt_at = NULL
      FROM races r
     WHERE s.job = p_job
       AND s.race_date >= v_min_date
       AND r.race_id = s.race_id
       AND r.start_time IS NOT NULL
       AND (
           s.status = 'pending'
           OR (s.status = 'running' AND s.lease_until < p_now)
       )
       AND ((r.race_date + r.start_time) AT TIME ZONE 'Asia/Tokyo')
           + make_interval(mins => s.offset_min
               + COALESCE((v_by_offset ->> s.offset_min::TEXT)::INTEGER, p_grace_min)) < p_now;

    -- (3) 期限が来たスロットを取る
    RETURN QUERY
    WITH cand AS (
        SELECT s.job, s.race_id, s.offset_min
          FROM scrape_slots s
          JOIN races r ON r.race_id = s.race_id
         CROSS JOIN LATERAL (
              SELECT ((r.race_date + r.start_time) AT TIME ZONE 'Asia/Tokyo')
                     + make_interval(mins => s.offset_min) AS deadline_at,
                     COALESCE((v_by_offset ->> s.offset_min::TEXT)::INTEGER, p_grace_min) AS grace_min
         ) d
         WHERE s.job = p_job
           AND s.race_date >= v_min_date
           AND r.start_time IS NOT NULL
           AND (
               (s.status = 'pending'
                AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= p_now))
               OR (s.status = 'running' AND s.lease_until < p_now)
           )
           AND d.deadline_at <= p_now
           AND d.deadline_at + make_interval(mins => d.grace_min) >= p_now
         ORDER BY d.deadline_at, s.race_id
         LIMIT p_limit
           FOR UPDATE OF s SKIP LOCKED
    ),
    upd AS (
        UPDATE scrape_slots s
           SET status = 'running',
               attempts = s.attempts + 1,
               lease_until = p_now + make_interval(secs => p_lease_sec),
               claimed_by = p_worker,
               run_mode = p_run_mode,
               first_attempt_at = COALESCE(s.first_attempt_at, p_now),
               last_attempt_at = p_now,
               next_attempt_at = NULL
          FROM cand c
         WHERE s.job = c.job AND s.race_id = c.race_id AND s.offset_min = c.offset_min
        RETURNING s.*
    )
    SELECT * FROM upd ORDER BY race_id;
END;
$$;

COMMENT ON FUNCTION claim_scrape_slots_by_offset(TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB) IS
    'claim_scrape_slots（075）と同じ本体で、許容幅を offset_min ごとに上書きできる（p_grace_by_offset。例 {"-60": 30}）。p_grace_by_offset が空のとき、claim_scrape_slots と同じ結果を返す。docs/db-migration/092_claim_scrape_slots_by_offset.sql';

-- サービスロール専用（claim_scrape_slots と同じ。既定では PUBLIC に EXECUTE が付くため明示的に剥奪する）
REVOKE EXECUTE ON FUNCTION claim_scrape_slots_by_offset(TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_scrape_slots_by_offset(TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- 適用の検査（欠けていれば例外にし、トランザクション全体を失敗させる）
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'claim_scrape_slots_by_offset') THEN
        RAISE EXCEPTION 'claim_scrape_slots_by_offset がありません';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'claim_scrape_slots') THEN
        RAISE EXCEPTION '前提の claim_scrape_slots（075）がありません。075 を先に適用してください';
    END IF;
    IF has_function_privilege('anon', 'claim_scrape_slots_by_offset(text,integer,integer,text,integer,text,timestamptz,jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'claim_scrape_slots_by_offset(text,integer,integer,text,integer,text,timestamptz,jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon・authenticated が claim_scrape_slots_by_offset を実行できます（REVOKE が効いていません）';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 適用後の確認SQL（読み取りのみ）
-- ----------------------------------------------------------------------------
--   -- 関数が1本あり、service_roleだけが実行できる（anon・authenticatedは実行できない）
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname IN ('claim_scrape_slots', 'claim_scrape_slots_by_offset');
--   -- 期待: 2行（既存と新規）。両方とも anon_exec=false・auth_exec=false・service_exec=true
