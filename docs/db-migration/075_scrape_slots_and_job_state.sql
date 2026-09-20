-- データ取得基盤のVercel一本化: 予定表（scrape_slots）・ジョブ状態（scrape_job_state）・
-- race_odds の window_min/source・RPC 2本（ensure_scrape_slots / claim_scrape_slots）を追加する（WS4a・T4a-02）
--
-- 対応spec/plan: docs/design/scraping-vercel-consolidation/plan.md §3（予定表方式の設計案）/ tasks.md T4a-02
-- 判断: docs/adr/0066-scraping-execution-consolidation-to-vercel.md
--
-- 適用手順（ユーザーが実行する。**コードのマージより先に適用する**が、適用前にマージしても無害:
--   共通ラッパ・監視は、テーブル・関数が無い間は何もしない設計。詳細はPR本文）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文。SET LOCAL・CREATE・ALTER・REVOKE・GRANT・COMMENT・DOブロック）
--     COMMIT;
--   DOブロックが例外を出した場合は、COMMITせずROLLBACKする（何も変更されない）。
--   適用は、発走中のレースが無い時間帯（夜間・JST 23時以降、または朝のJST 6時前）が望ましい。
--   race_odds への ALTER TABLE（列追加）と CREATE UNIQUE INDEX は、race_odds に対する短いロックを取る
--   （列追加は ACCESS EXCLUSIVE でメタデータのみ。索引作成は SHARE で、race_odds 約13.5万行・42MB の走査のため数秒以内）。
--   取得スクリプトの書き込みと重なると数秒待つ。SET LOCAL lock_timeout により、10秒待っても取れなければ失敗する
--   （その場合は時間をおいて再実行する。失敗時は何も変更されない）。
--
--   CREATE INDEX CONCURRENTLY を使わない理由: トランザクション内では実行できず、DOブロックの適用検査と
--   1つのトランザクションにまとめられなくなる。適用直後の window_min は全行 NULL で、索引作成は
--   テーブルの1回の走査のみで終わる（数秒以内）。CONCURRENTLY の利点（長時間の書き込みブロックの回避）は、
--   この規模では不要。
--
--   適用後の確認（読み取りのみ。軽い）: 末尾のコメント「適用後の確認SQL」を参照。
--
--   ロールバック（必要な場合のみ。適用前後どちらでもコードは壊れない設計のため、コードの変更は不要。
--   race_odds の window_min・source に、既に Vercel 側の行が入っている場合は、その値が失われる）:
--     DROP FUNCTION IF EXISTS claim_scrape_slots(TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TIMESTAMPTZ);
--     DROP FUNCTION IF EXISTS ensure_scrape_slots(DATE, JSONB, BOOLEAN, TIMESTAMPTZ);
--     DROP TABLE IF EXISTS scrape_slots;
--     DROP TABLE IF EXISTS scrape_job_state;
--     DROP INDEX IF EXISTS uq_race_odds_race_window;
--     ALTER TABLE race_odds DROP COLUMN IF EXISTS window_min, DROP COLUMN IF EXISTS source;
--
-- 背景: 窓型ジョブ（展示・オッズ・結果・レース情報・公式予想）の「期限が来て未完了のものだけを実行する」
-- ための台帳（scrape_slots）と、ジョブ単位の状態（scrape_job_state。モード・リース・死活・ブレーカー）を持つ。
-- 完了の定義B・C（取得時刻・成否・試行回数・遅延・未実行）を、取得時刻列が無いテーブルも含めて
-- 全ジョブで同じ方法で計測できるようにする（plan.md §3.8）。
--
-- 設計上の要点:
--   * 期限は保存しない。races.start_time（JST）と offset_min から、claim の中で都度計算する
--     （発走時刻の変更・順延・中止に追従するため）。
--   * 排他は行単位のリース（lease_until）。claim は FOR UPDATE SKIP LOCKED で、重複配信・前回実行中の
--     次の起動でも、同じスロットを二重に取らない。完了の記録は、claimed_by が一致する場合のみ
--     （アプリ側の条件付き更新）。
--   * 両テーブルはサービスロール（バッチ・Vercel Function）専用。RLS を有効にしてポリシーを作らず、
--     anon・authenticated からの全権限を剥奪する（既存の race_odds 等は RLS 無効で anon が書き込める状態
--     のため、それに倣わない）。RPC も同じく service_role のみに EXECUTE を与える。
--   * race_odds の (race_id, window_min) の一意索引は、部分索引（WHERE window_min IS NOT NULL）にしない。
--     PostgREST の upsert（on_conflict=race_id,window_min）は、ON CONFLICT に WHERE 句を付けられず、
--     部分一意索引を推論できない（"no unique or exclusion constraint matching the ON CONFLICT
--     specification" になる）。通常の一意索引でも、NULL は互いに重複とみなされない（既定の NULLS DISTINCT）
--     ため、window_min が NULL の既存行・旧基盤（GitHub Actions）の行とは衝突しない。
--     索引にNULLのエントリ（約13.5万行分、数MB）が載るコストは許容する。
--     （plan.md §3.3 の「部分索引 WHERE source='vercel' AND window_min IS NOT NULL」からの変更。PR本文参照）

SET LOCAL lock_timeout = '10s';

-- ----------------------------------------------------------------------------
-- 1. scrape_slots（予定表）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_slots (
    -- ジョブ名（exhibition / odds / result / race_info / pcexpect ...）。CHECK制約は付けない
    -- （ジョブの追加をDDLなしにするため。アプリ側のレジストリで管理する）
    job TEXT NOT NULL,
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    -- 発走との相対（分）。負が発走前（-60 = 60分前）、正が発走後（5 = 5分後）
    offset_min SMALLINT NOT NULL,
    -- 索引・保持期間用の非正規化（races.race_date と同値。ensure_scrape_slots が設定する）
    race_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'done', 'expired')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    -- 次回の試行を許す時刻（再試行の間隔。NULLは即時）
    next_attempt_at TIMESTAMPTZ,
    -- running の有効期限（リース）。切れた running は、次の claim が奪取する
    lease_until TIMESTAMPTZ,
    -- リースの所有者（実行の識別子）。完了の記録は、これが一致する場合のみ
    claimed_by TEXT,
    -- live / shadow（並走中の区別。shadow の done は窓内取得率の集計に含めない）
    run_mode TEXT CHECK (run_mode IN ('live', 'shadow')),
    first_attempt_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    -- 完了時刻。遅延（done_at − 期限）の計測元。取得時刻列が無いテーブルでも、窓内取得率を計測できる
    done_at TIMESTAMPTZ,
    -- ok / partial / no_values（未公開）/ skipped_have_data / error / breaker_open / cancelled_race
    -- （CHECK制約は付けない。アプリ側で管理する）
    outcome TEXT,
    -- 書き込んだ行数（0件エラーの判定）。SMALLINTだと将来の1スロット多行の書き込みで溢れうるためINTEGER
    -- （plan.md §3.3 の SMALLINT からの変更）
    rows_written INTEGER,
    -- 解析結果のハッシュ（shadow時に、既存基盤が書いた値との一致を比較する）
    result_digest TEXT,
    -- 直近のエラー（アプリ側で500字程度に切る）
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job, race_id, offset_min)
);

-- 毎分の claim・期限切れ処理は、この小さな部分索引のみを見る
CREATE INDEX IF NOT EXISTS idx_scrape_slots_active
    ON scrape_slots (race_date, job)
    WHERE status IN ('pending', 'running');
-- 保持期間の削除・日次/7日の集計
CREATE INDEX IF NOT EXISTS idx_scrape_slots_race_date
    ON scrape_slots (race_date);

COMMENT ON TABLE scrape_slots IS
    'データ取得の予定表。期限（発走のoffset_min分後、負なら前）が来て未完了のものだけを取得する台帳。期限は保存せず races.start_time(JST) と offset_min から都度計算する。docs/design/scraping-vercel-consolidation/plan.md §3';
COMMENT ON COLUMN scrape_slots.offset_min IS
    '発走との相対（分）。負=発走前（-60は60分前）、正=発走後';
COMMENT ON COLUMN scrape_slots.status IS
    'pending=未実行または再試行待ち、running=リース中、done=完了（outcomeで内訳）、expired=期限+許容幅を超えて未完了（即時アラート対象）。done・expiredは終端';
COMMENT ON COLUMN scrape_slots.run_mode IS
    '最後にclaimした実行のモード。shadow=取得・解析のみでデータテーブルへは書かない（並走検証）。shadowのdoneは窓内取得率の集計に含めない';
COMMENT ON COLUMN scrape_slots.done_at IS
    '完了時刻。遅延（done_at−期限）の計測元。cancelled_raceで終端した場合は、そのclaim時刻';

-- ----------------------------------------------------------------------------
-- 2. scrape_job_state（ジョブ状態）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_job_state (
    -- ジョブ名。ホスト単位のサーキットブレーカーは、疑似ジョブ名 'host:boatrace.jp' の行に持つ
    -- （scrape_slots.job と論理的に対応するが、疑似ジョブ名を持つため外部キーにしない）
    job TEXT PRIMARY KEY,
    -- off / shadow / live。切り替え・切り戻しの操作点（DBの更新のみ。再デプロイ不要）。
    -- 行が無いジョブ、または off のジョブは、共通ラッパが何もしない
    mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'shadow', 'live')),
    -- 窓型でないジョブ（日次・A4・A5）の排他
    lease_until TIMESTAMPTZ,
    claimed_by TEXT,
    -- 起動の死活。5分に1回だけ書く（毎分だと同じ行が1日1,000回更新され、無駄なdead tupleになる）
    last_tick_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    consecutive_failures SMALLINT NOT NULL DEFAULT 0,
    -- 日次ジョブが最後に成功した対象日（catch-upの冪等性）
    last_target_date DATE,
    -- 直近の書き込み行数（0件エラーの判定）
    last_rows_written INTEGER,
    -- チャンク処理の進捗（races-init の会場、racer-profiles の位置）
    cursor JSONB,
    -- サーキットブレーカー（ホスト単位の疑似ジョブ行で使う）
    breaker_open_until TIMESTAMPTZ,
    -- ジョブ固有の成否履歴（B3・B4のhealth.json相当。git push依存の除去先）、監視の通知済み記録
    last_report JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE scrape_job_state IS
    'データ取得ジョブごとの状態（モード・リース・死活・ブレーカー・成否履歴）。modeがoffまたは行が無いジョブは共通ラッパが何もしない。docs/design/scraping-vercel-consolidation/plan.md §3.3';
COMMENT ON COLUMN scrape_job_state.mode IS
    'off=何もしない、shadow=取得・解析のみ（データテーブルへは書かない）、live=書き込む。DBの更新のみで切り替え・切り戻しできる';
COMMENT ON COLUMN scrape_job_state.last_tick_at IS
    '共通ラッパが最後に起動された時刻。5分に1回だけ更新される（死活監視は10分以上の未更新で検知）';

-- ----------------------------------------------------------------------------
-- 3. アクセス制御（サービスロール専用）
-- ----------------------------------------------------------------------------
ALTER TABLE scrape_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_job_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE scrape_slots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE scrape_job_state FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. race_odds の拡張（window_min・source・一意索引）
-- ----------------------------------------------------------------------------
-- window_min: 窓（-60〜0）。新基盤の行のみ設定。旧基盤の行は NULL のまま（窓は captured_at から後付けで計算する
--   現行の方法を継続する）。NULL可・既定値なしの列追加は、メタデータの変更のみ（テーブルの書き換え無し）。
-- source: 取得元（gha / vercel）。並走期間の二重書き込みを区別する（ADR-0059 4）。定数の DEFAULT 付きの
--   NOT NULL 列追加は、PostgreSQL 11以降ではメタデータの変更のみ（既存行は読み出し時に既定値 'gha' になる）。
ALTER TABLE race_odds
    ADD COLUMN IF NOT EXISTS window_min SMALLINT,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'gha';

-- 窓内の再試行が同じ行を更新するようにする（行が増えない）。旧基盤の行は window_min が NULL のため
-- 衝突しない（NULLS DISTINCT）。冒頭の注記のとおり、部分索引にはしない
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_odds_race_window
    ON race_odds (race_id, window_min);

COMMENT ON COLUMN race_odds.window_min IS
    '取得の窓（-60,-30,-15,-10,-5,0＝発走のN分前）。新基盤(Vercel)の行のみ設定。旧基盤の行はNULL（captured_atから後付けで計算する）。(race_id, window_min)は一意（NULLを除く）で、窓内の再試行は同じ行を更新する';
COMMENT ON COLUMN race_odds.source IS
    '取得元（gha=GitHub Actions、vercel=Vercel Function）。並走期間の二重書き込みを区別し、窓内取得率の水増しを防ぐ';

-- ----------------------------------------------------------------------------
-- 5. RPC: ensure_scrape_slots（その日の予定表を生成する）
-- ----------------------------------------------------------------------------
-- p_defs: [{"job":"odds","offset_min":-60,"grace_min":3}, ...]（ジョブ×窓の定義。アプリのレジストリが渡す）
-- p_skip_lapsed: TRUE なら、期限+許容幅が既に過ぎたスロットは作らない。ジョブを日中に有効化した場合や、
--   races の登録が遅れた場合に、過去分が一斉に expired（未実行）になってアラートが出るのを防ぐ。
--   （races の登録の遅れ自体は、別の監視＝当日のracesの件数で検知する。plan.md §7）
-- p_now: テスト用（既定は now()）
-- 戻り値: 新規に作成したスロット数。既存のスロットは触らない（ON CONFLICT DO NOTHING。重複呼び出しは無害）
CREATE OR REPLACE FUNCTION ensure_scrape_slots(
    p_date DATE,
    p_defs JSONB,
    p_skip_lapsed BOOLEAN DEFAULT TRUE,
    p_now TIMESTAMPTZ DEFAULT now()
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inserted INTEGER;
BEGIN
    IF p_defs IS NULL OR jsonb_typeof(p_defs) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'ensure_scrape_slots: p_defs は JSON 配列で指定してください';
    END IF;

    WITH defs AS (
        SELECT
            (d ->> 'job')::TEXT AS job,
            (d ->> 'offset_min')::SMALLINT AS offset_min,
            COALESCE((d ->> 'grace_min')::INTEGER, 0) AS grace_min
        FROM jsonb_array_elements(p_defs) AS d
    ),
    ins AS (
        INSERT INTO scrape_slots (job, race_id, offset_min, race_date)
        SELECT d.job, r.race_id, d.offset_min, r.race_date
        FROM races r
        CROSS JOIN defs d
        WHERE r.race_date = p_date
          AND r.start_time IS NOT NULL
          AND (
              NOT p_skip_lapsed
              OR ((r.race_date + r.start_time) AT TIME ZONE 'Asia/Tokyo')
                 + make_interval(mins => d.offset_min + d.grace_min) >= p_now
          )
        ON CONFLICT (job, race_id, offset_min) DO NOTHING
        RETURNING 1
    )
    SELECT count(*)::INTEGER INTO v_inserted FROM ins;

    RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION ensure_scrape_slots(DATE, JSONB, BOOLEAN, TIMESTAMPTZ) IS
    'その日のracesとジョブ定義(job,offset_min,grace_min)から予定表のスロットを一括生成する（ON CONFLICT DO NOTHING）。races-init完了時と、tickから10分に1回呼ぶ。docs/design/scraping-vercel-consolidation/plan.md §3.5';

-- ----------------------------------------------------------------------------
-- 6. RPC: claim_scrape_slots（期限が来たスロットを取る）
-- ----------------------------------------------------------------------------
-- 1回の呼び出しで、次を行う（何も該当しなければ書き込みなし）:
--   (1) 確定中止（races.cancellation_status='confirmed'）のレースの pending スロットを、
--       outcome='cancelled_race' で終端する（窓内取得率の分母から外すため）
--   (2) 期限+許容幅を過ぎた pending・リース切れの running を expired にする
--       （リースが有効な running は、処理中のため触らない）
--   (3) 期限が来て（期限 <= 現在）、次回試行時刻に到達した pending（またはリース切れの running）を、
--       期限の早い順に最大 p_limit 件、FOR UPDATE SKIP LOCKED で取り、running・リース・attempts+1・
--       claimed_by を設定して返す
-- 走査は race_date >= (JSTの今日 − 1日) に限る（それより古い未完了は scrape-cleanup が expired にする）。
-- 許容幅の短いジョブ（odds・race_info）では、p_lease_sec を許容幅より短くすること
-- （リースの解除が許容幅を超えると窓を取りこぼす）。
-- p_now: テスト用（既定は now()）
CREATE OR REPLACE FUNCTION claim_scrape_slots(
    p_job TEXT,
    p_limit INTEGER,
    p_lease_sec INTEGER,
    p_worker TEXT,
    p_grace_min INTEGER,
    p_run_mode TEXT DEFAULT 'live',
    p_now TIMESTAMPTZ DEFAULT now()
) RETURNS SETOF scrape_slots
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_min_date DATE := ((p_now AT TIME ZONE 'Asia/Tokyo')::DATE - 1);
BEGIN
    IF p_run_mode NOT IN ('live', 'shadow') THEN
        RAISE EXCEPTION 'claim_scrape_slots: p_run_mode は live か shadow です: %', p_run_mode;
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_lease_sec IS NULL OR p_lease_sec < 1
       OR p_worker IS NULL OR p_grace_min IS NULL OR p_grace_min < 0 THEN
        RAISE EXCEPTION 'claim_scrape_slots: 引数が不正です（limit=%, lease_sec=%, worker=%, grace_min=%）',
            p_limit, p_lease_sec, p_worker, p_grace_min;
    END IF;

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
           + make_interval(mins => s.offset_min + p_grace_min) < p_now;

    -- (3) 期限が来たスロットを取る
    RETURN QUERY
    WITH cand AS (
        SELECT s.job, s.race_id, s.offset_min
          FROM scrape_slots s
          JOIN races r ON r.race_id = s.race_id
         CROSS JOIN LATERAL (
              SELECT ((r.race_date + r.start_time) AT TIME ZONE 'Asia/Tokyo')
                     + make_interval(mins => s.offset_min) AS deadline_at
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
           AND d.deadline_at + make_interval(mins => p_grace_min) >= p_now
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

COMMENT ON FUNCTION claim_scrape_slots(TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TIMESTAMPTZ) IS
    '期限が来た予定表のスロットを、リース付きで最大p_limit件取る（FOR UPDATE SKIP LOCKED）。確定中止のスロットの終端と、期限+許容幅を超えたスロットのexpired化も、同じ呼び出しで行う。docs/design/scraping-vercel-consolidation/plan.md §3.5';

-- サービスロール専用（anon・authenticated は呼べない。既定では PUBLIC に EXECUTE が付くため明示的に剥奪する）
REVOKE EXECUTE ON FUNCTION ensure_scrape_slots(DATE, JSONB, BOOLEAN, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ensure_scrape_slots(DATE, JSONB, BOOLEAN, TIMESTAMPTZ) TO service_role;
REVOKE EXECUTE ON FUNCTION claim_scrape_slots(TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_scrape_slots(TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TIMESTAMPTZ) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. 適用の検査（欠けていれば例外にし、トランザクション全体を失敗させる）
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('scrape_slots', 'scrape_job_state')) <> 2 THEN
        RAISE EXCEPTION 'scrape_slots・scrape_job_state が揃っていません';
    END IF;
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'race_odds'
           AND column_name IN ('window_min', 'source')) <> 2 THEN
        RAISE EXCEPTION 'race_odds.window_min・source が揃っていません';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname = 'public' AND tablename = 'race_odds'
                      AND indexname = 'uq_race_odds_race_window') THEN
        RAISE EXCEPTION '索引 uq_race_odds_race_window がありません';
    END IF;
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('ensure_scrape_slots', 'claim_scrape_slots')) <> 2 THEN
        RAISE EXCEPTION 'RPC ensure_scrape_slots・claim_scrape_slots が揃っていません';
    END IF;
    IF has_function_privilege('anon', 'claim_scrape_slots(text,integer,integer,text,integer,text,timestamptz)', 'execute')
       OR has_function_privilege('anon', 'ensure_scrape_slots(date,jsonb,boolean,timestamptz)', 'execute') THEN
        RAISE EXCEPTION 'RPC が anon から実行できる状態です';
    END IF;
    IF has_table_privilege('anon', 'public.scrape_slots', 'select')
       OR has_table_privilege('anon', 'public.scrape_job_state', 'select') THEN
        RAISE EXCEPTION 'scrape_slots・scrape_job_state が anon から読める状態です';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.scrape_slots'::regclass)
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.scrape_job_state'::regclass) THEN
        RAISE EXCEPTION 'RLS が有効になっていません';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 適用後の確認SQL（読み取りのみ。トランザクションの外で個別に実行する）
-- ----------------------------------------------------------------------------
--   -- 1) テーブル・列（scrape_slots 18列、scrape_job_state 14列、race_odds の window_min・source）
--   SELECT table_name, count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name IN ('scrape_slots', 'scrape_job_state')
--    GROUP BY 1;                          -- → scrape_slots 18 / scrape_job_state 14
--   SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'race_odds' AND column_name IN ('window_min', 'source');
--                                         -- → window_min smallint NULL可 / source text NOT NULL DEFAULT 'gha'
--   -- 2) race_odds の既存行は source='gha'、window_min は NULL
--   SELECT source, count(*) AS n, count(window_min) AS with_window
--     FROM race_odds WHERE race_id >= '2026-09-18' AND race_id < '2026-09-19' GROUP BY 1;
--                                          -- → gha のみ、with_window = 0
--   -- 3) 索引
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename IN ('scrape_slots', 'race_odds')
--      AND indexname IN ('idx_scrape_slots_active', 'idx_scrape_slots_race_date', 'uq_race_odds_race_window');  -- → 3行
--   -- 4) RPC（2本）と権限（service_role のみ）
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'execute') AS anon_exec,
--          has_function_privilege('service_role', p.oid, 'execute') AS service_exec
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname IN ('ensure_scrape_slots', 'claim_scrape_slots');
--                                         -- → 2行、anon_exec = false、service_exec = true
--   -- 5) RLS
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE oid IN ('public.scrape_slots'::regclass, 'public.scrape_job_state'::regclass);  -- → 両方 true
