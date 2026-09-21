-- 082: 直前情報（beforeinfo）の全項目化 — exhibition_data に展示進入・展示STのF/L・前走の着順の生表記・欠場を追加する
--
-- 対応設計: docs/design/pre-race-full-fields/plan.md（全データ設計 docs/design/scraping-vercel-consolidation/
--   optimal-scraping-design.md §2.5・data-catalog.md の N9・N10・N11、ユーザー承認Q3）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。**コードのマージより先でも後でも良い**。コードは、列が無い間は旧実装と同じ列だけを
-- 書き、列が現れてから約5分後（判定のキャッシュ）に新しい列も書き始める: scripts/lib/preRaceSchema.js）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   ALTER TABLE ... ADD COLUMN（DEFAULTなし・NULL可）はメタデータのみの変更で、テーブルを書き換えない
--   （2026-09-21の推定行数: exhibition_data は約17万行・20MB）。ACCESS EXCLUSIVE ロックを一瞬取るため、SET LOCAL lock_timeout で
--   待ち時間を制限してある（展示取得の書き込みと重なって10秒取れなければ失敗し、何も変更されない。時間をおいて再実行）。
--   制約は NOT VALID で追加してから VALIDATE する。展示取得は発走の約30〜7分前に動くため、適用は、開催時間帯
--   （JST 8:00〜21:30頃）を避けると、ロック競合の可能性が下がる。
--   このテーブルにはトリガーが無い（2026-09-21に pg_trigger で確認）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'exhibition_data'
--      AND column_name IN ('exhibition_course','start_flag','prev_finish_mark','is_absent') ORDER BY 1;
--   → 4行（exhibition_course=smallint, start_flag=text, prev_finish_mark=text, is_absent=boolean）
--
-- ロールバック（データを書いた後は、その4列の値が失われる。旧形式の読み手は、この列を読まない）:
--   ALTER TABLE exhibition_data
--     DROP CONSTRAINT IF EXISTS chk_ed_exhibition_course, DROP CONSTRAINT IF EXISTS chk_ed_start_flag,
--     DROP COLUMN IF EXISTS exhibition_course, DROP COLUMN IF EXISTS start_flag,
--     DROP COLUMN IF EXISTS prev_finish_mark, DROP COLUMN IF EXISTS is_absent;
--
-- 背景（2026-09-21に実ページ8件・本番DBで確認: docs/design/pre-race-full-fields/plan.md）:
--   * スタート展示の表は、**行順がコース順**（1行目=1コース）。前づけの予兆になる展示進入（N9、BOA-290）を、
--     旧実装（scrape-exhibition-data.js）は読んで捨てていた。欠場艇の行は無い（5行になり、コースは繰り上がる）。
--     展示航走前は行自体が無い
--   * スタート展示のSTの「F.01」は、旧実装が isFlying を解析して保存しなかった（N10）。Lの表記も同じ欄に出うる
--   * 前走成績の着順は、数字でないとき（F・欠・落 等）、旧実装の prev_finish_rank は NULL になり、内容が失われる。
--     実測: prev_race_no があるのに prev_finish_rank が NULL の行が、2026-09-10以降で27行（前走のある2,203行の1.2%）
--   * 欠場艇は、直前情報の tbody に is-miss が付く（唐津 2026-09-16 12R の1号艇。体重だけが入り、展示タイム・
--     チルト・プロペラは空）。旧実装は、展示タイム・STが無い艇の行を書かないため、欠場艇の行は無かった
--
-- 設計上の要点:
--   * 新しい列は全て NULL 可・DEFAULTなし。既存の行は NULL のまま
--   * exhibition_course は、スタート展示の行順（1〜6）。表が無い（展示航走前）・欠場艇は NULL
--   * start_flag は、展示STの表記の頭（F=フライング、L=出遅れ）。それ以外は NULL。start_timing の値は、
--     旧実装と同じく、F表記でも正の数（「F.01」→0.01）
--   * prev_finish_mark は、前走の着順の生表記（NFKC正規化後。1〜6・F・欠・落・転 等）。前走が無ければ NULL。
--     CHECKは付けない（未観測の表記が現れても書き込みを失敗させない）
--   * is_absent は、NULL=未判定（082以前の行）、false=表示なし、true=欠場の表示あり。true の行は、他の列（展示タイム等）
--     が NULL で、today_weight・prev_* だけが入りうる
--   * RLS・ポリシー・GRANTは変更しない（exhibition_data は076で SELECTポリシーが付いている）。既存の画面・RPCは
--     列を明示して読むため、payload は変わらない

SET LOCAL lock_timeout = '10s';

ALTER TABLE exhibition_data
  ADD COLUMN IF NOT EXISTS exhibition_course smallint,
  ADD COLUMN IF NOT EXISTS start_flag       text,
  ADD COLUMN IF NOT EXISTS prev_finish_mark text,
  ADD COLUMN IF NOT EXISTS is_absent        boolean;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ed_exhibition_course') THEN
    ALTER TABLE exhibition_data
      ADD CONSTRAINT chk_ed_exhibition_course CHECK (exhibition_course BETWEEN 1 AND 6) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ed_start_flag') THEN
    ALTER TABLE exhibition_data
      ADD CONSTRAINT chk_ed_start_flag CHECK (start_flag IN ('F', 'L')) NOT VALID;
  END IF;
END
$$;

ALTER TABLE exhibition_data VALIDATE CONSTRAINT chk_ed_exhibition_course;
ALTER TABLE exhibition_data VALIDATE CONSTRAINT chk_ed_start_flag;

COMMENT ON COLUMN exhibition_data.exhibition_course IS 'スタート展示の進入コース（行順=コース順。1〜6）。展示航走前・欠場艇はNULL。082以前の行もNULL';
COMMENT ON COLUMN exhibition_data.start_flag IS '展示STの表記の頭（F=フライング、L=出遅れ）。それ以外はNULL。start_timing の値は、F表記でも正の数（F.01→0.01）';
COMMENT ON COLUMN exhibition_data.prev_finish_mark IS '前走の着順の生表記（NFKC正規化後。1〜6・F・欠・落・転 等）。前走が無ければNULL。prev_finish_rank は数字のときだけ入る';
COMMENT ON COLUMN exhibition_data.is_absent IS '直前情報で欠場の表示（tbody の is-miss）があるか。NULL=未判定（082以前の行）、false=表示なし、true=欠場の表示あり';
