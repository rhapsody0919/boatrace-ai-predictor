-- exhibition_data・race_entries・race_start_timings に取得時刻の列（created_at・updated_at）を追加する（WS2）
--
-- 適用手順（ユーザーが実行する。コードのマージより先に適用する）:
--   Supabase Dashboard > SQL Editor で、次の全体を実行する。
--     BEGIN;
--     （このファイルの SET LOCAL・ALTER TABLE・COMMENT・DO ブロック）
--     COMMIT;
--   DOブロックが例外を出した場合は、COMMITせずROLLBACKする（何も変更されない）。
--   適用は、発走中のレースが無い時間帯（夜間・JST 22時以降など）が望ましい。ALTER TABLEはテーブルに
--   対する短い排他ロックを取るため、取得スクリプトの書き込みと重なると、数秒待つことがある
--   （SET LOCAL lock_timeout により、10秒待っても取れなければ失敗する。その場合は時間をおいて再実行する）。
--
--   適用後の確認（読み取りのみ。主キーの範囲検索のため軽い）:
--     -- 1) 列が3テーブルに存在し、created_at にだけ DEFAULT now() がある
--     SELECT table_name, column_name, data_type, column_default
--       FROM information_schema.columns
--      WHERE table_schema = 'public'
--        AND table_name IN ('exhibition_data', 'race_entries', 'race_start_timings')
--        AND column_name IN ('created_at', 'updated_at')
--      ORDER BY table_name, column_name;
--     → 6行。data_type は timestamp with time zone。created_at の column_default が now()、
--       updated_at の column_default は NULL であること。
--     -- 2) 既存の行はNULLのまま（適用日の時刻が全既存行に入っていない）
--     SELECT count(*) AS total, count(created_at) AS with_created_at, count(updated_at) AS with_updated_at
--       FROM race_entries WHERE race_id >= '2026-09-18' AND race_id < '2026-09-19';
--     → with_created_at と with_updated_at が 0（exhibition_data・race_start_timings も同様）。
--
--   ロールバック（必要な場合のみ。書き込み側のコードは列が無くても動くため、コードの変更は不要）:
--     ALTER TABLE exhibition_data DROP COLUMN created_at, DROP COLUMN updated_at;
--     ALTER TABLE race_entries DROP COLUMN created_at, DROP COLUMN updated_at;
--     ALTER TABLE race_start_timings DROP COLUMN created_at, DROP COLUMN updated_at;
--
-- 背景: 完了の定義B（可変データの窓内取得率、.claude/rules/data-acquisition.md）は、行ごとに
-- 取得時刻が残っていることを前提にする。この3テーブルには時刻の列が無く（information_schema で確認、
-- 2026-09-19。トリガーも無い）、展示・出走表・STが「発走の何分前に取得できたか」を計測できなかった。
-- Vercel一本化（ADR-0066）の移行後に、窓内取得率を旧基盤と比較して検証するため、移行より先に
-- 取得時刻を残し始める（ユーザー決定、2026-09-19）。
--
-- 列の意味:
--   created_at: 行が「最初に」保存された時刻。新規の行に、INSERT時にDBの DEFAULT now() が入る。
--     UPSERTの更新側では触られない（書き込み側のコードは created_at をINSERT・UPDATEのどちらにも
--     含めない）。「発走の何分前に取得できたか」（存在の窓内取得）は、この列で計測する。
--   updated_at: 行の値が「変わった」時刻（新規の行は保存時刻）。書き込み側のコード（scripts/lib/unchangedRows.js の
--     upsertChangedRows(..., {stampUpdatedAt: true})）が、変更のある行を書くときだけ現在時刻を入れる。
--     値が変わっていない行は書かない（WS8(b)）ため、更新されない。展示タイムがNULLの行が後から
--     埋まる時刻など、値が入った時刻は、この列で計測する。
--
-- 既存の行がNULLのままになる理由（重要）:
--   ADD COLUMN で列を追加した「あと」に、別の文で SET DEFAULT now() を設定する。PostgreSQL 11以降は、
--   ADD COLUMN ... DEFAULT now() と1文で書くと、追加時点の値が既存の全行に入る（マイグレーションの
--   実行時刻が、約17万〜27万行すべての「最初に保存された時刻」になってしまい、誤った取得時刻として
--   計測を汚す）。NULL可・既定値なしで列を追加し、その後で列の DEFAULT だけを設定すると、既存の行は
--   NULLのまま（＝「不明」）で、これ以降のINSERTにだけ now() が入る。NULLは「この列の追加前に保存された
--   行、または取得時刻が不明な行」を意味する。
--
-- トリガーを使わない理由: 行ごとのトリガーは、書き込みのたびに追加の処理を行い、Disk IO予算
-- （BOA-357）に影響する。また、トリガーは値が同じ書き込みでも updated_at を進めるため、
-- 「変更の無い行は書かない」方針（WS8(b)）と両立しない。updated_at は書き込み側のコードが
-- 変更のある行にだけ設定する。
--
-- 影響: NULL可・既定値なしの列追加はメタデータの変更のみで、テーブルの書き換え（リライト）は
-- 発生しない（PostgreSQL 11以降）。テーブルの規模: exhibition_data 約17万行（19MB）、
-- race_entries 約27万行（86MB）、race_start_timings 約23万行（32MB）（2026-09-19の推定行数）。
-- 既存の読み書きへの影響も無い（select('*') で読む箇所は、増えた列を使わない。RPCは変更しない）。
-- 書き込み側のコードは、この列が未適用のDBでも動く（列が無いエラーを受けたら updated_at を除いて
-- 書き直す）ため、適用とマージの順序で本番が壊れることは無いが、適用前にマージすると取得時刻が
-- 残らない期間ができる。適用が先、マージが後。
--
-- バックフィル方針: 既存の行への遡及はしない（過去の取得時刻は復元できない）。

SET LOCAL lock_timeout = '10s';

ALTER TABLE exhibition_data
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE exhibition_data
    ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE race_entries
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE race_entries
    ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE race_start_timings
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE race_start_timings
    ALTER COLUMN created_at SET DEFAULT now();

COMMENT ON COLUMN exhibition_data.created_at IS
    '行が最初に保存された時刻（INSERT時のDEFAULT now()）。NULLはこの列の追加前に保存された行（不明）。「発走の何分前に取得できたか」の計測に使う';
COMMENT ON COLUMN exhibition_data.updated_at IS
    '行の値が変わった時刻（新規の行は保存時刻）。書き込み側のコードが、変更のある行を書くときだけ設定する（トリガーは使わない）。NULLはこの列の追加前に保存され、以降に一度も変更されていない行';
COMMENT ON COLUMN race_entries.created_at IS
    '行が最初に保存された時刻（INSERT時のDEFAULT now()）。NULLはこの列の追加前に保存された行（不明）。「発走の何分前に取得できたか」の計測に使う';
COMMENT ON COLUMN race_entries.updated_at IS
    '行の値が変わった時刻（新規の行は保存時刻）。書き込み側のコードが、変更のある行を書くときだけ設定する（トリガーは使わない）。NULLはこの列の追加前に保存され、以降に一度も変更されていない行';
COMMENT ON COLUMN race_start_timings.created_at IS
    '行が最初に保存された時刻（INSERT時のDEFAULT now()）。NULLはこの列の追加前に保存された行（不明）。「発走の何分前に取得できたか」の計測に使う';
COMMENT ON COLUMN race_start_timings.updated_at IS
    '行の値が変わった時刻（新規の行は保存時刻）。書き込み側のコードが、変更のある行を書くときだけ設定する（トリガーは使わない）。NULLはこの列の追加前に保存され、以降に一度も変更されていない行';

-- 適用の検査: 3テーブルに2列とも存在し、created_at にだけ DEFAULT now() が設定されていること。
-- 欠けていれば例外にし、トランザクション全体を失敗させる。
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['exhibition_data', 'race_entries', 'race_start_timings'] LOOP
        IF (
            SELECT count(*)
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = t
               AND column_name IN ('created_at', 'updated_at')
               AND data_type = 'timestamp with time zone'
        ) <> 2 THEN
            RAISE EXCEPTION '%: created_at・updated_at（timestamptz）が揃っていません', t;
        END IF;
        IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = t
               AND column_name = 'created_at'
               AND column_default ~* '^now\(\)'
        ) THEN
            RAISE EXCEPTION '%: created_at に DEFAULT now() が設定されていません', t;
        END IF;
        IF EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = t
               AND column_name = 'updated_at'
               AND column_default IS NOT NULL
        ) THEN
            RAISE EXCEPTION '%: updated_at に DEFAULT が設定されています（コードが設定する設計のため、既定値は不要）', t;
        END IF;
    END LOOP;
END $$;
