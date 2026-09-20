-- 077: race_start_timings を「艇別の結果」に拡張する（着欄の生表記・着・進入コース・レースタイム）
--
-- 対応設計: docs/design/race-result-full-fields/plan.md（全データ設計 docs/design/scraping-vercel-consolidation/
--   optimal-scraping-design.md §2.5・data-catalog.md の N1・N4・N5・N6、ユーザー承認Q3・Q4）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。**コードのマージより先でも後でも良い**。コードは、列が無い間は旧形式
-- （STを読めた艇の行だけ）で書き、列が現れてから約5分後（判定のキャッシュ）に全艇の行を書き始める:
--   scripts/lib/raceResultSchema.js）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   ALTER TABLE ... ADD COLUMN（DEFAULTなし・NULL可）はメタデータのみの変更で、テーブルを書き換えない
--   （race_start_timings は約23万行・32MB）。ACCESS EXCLUSIVE ロックを一瞬取るため、SET LOCAL lock_timeout で
--   待ち時間を制限してある（結果取得の書き込みと重なって10秒取れなければ失敗し、何も変更されない。時間をおいて再実行）。
--   制約は NOT VALID で追加してから VALIDATE する（VALIDATE は SHARE UPDATE EXCLUSIVE で、書き込みを止めない）。
--   適用は、開催時間帯（JST 8:00〜21:30頃）を避けると、ロック競合の可能性が下がる。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'race_start_timings'
--      AND column_name IN ('finish_mark','finish_rank','entry_course','race_seconds') ORDER BY 1;
--   → 4行（finish_mark=text, finish_rank=smallint, entry_course=smallint, race_seconds=numeric）
--
-- ロールバック（データを書いた後は、その4列の値が失われる。旧形式の読み手は、この4列を読まない）:
--   ALTER TABLE race_start_timings
--     DROP CONSTRAINT IF EXISTS chk_rst_finish_rank, DROP CONSTRAINT IF EXISTS chk_rst_entry_course,
--     DROP COLUMN IF EXISTS finish_mark, DROP COLUMN IF EXISTS finish_rank,
--     DROP COLUMN IF EXISTS entry_course, DROP COLUMN IF EXISTS race_seconds;
--
-- 背景（実測: docs/design/scraping-vercel-consolidation/data-catalog.md §5 E1〜E4）:
--   * 結果ページの着欄（F・欠・L・落・転・沈・妨・エ等）が保存されず、race_results.rank1〜6 は「艇番を着順の位置に
--     並べる」形のため、欠場・失格・フライングの艇が着順に入る（BOA-362）。艇ごとに着欄・着を持てば解消する
--   * 進入コース（スタート情報の行順）が保存されず、race_results.course_1〜6 は枠番と恒等（BOA-257）
--   * 出遅れ（L）の艇は、STが数値でないため行自体が作られず、is_late_start が全行 false だった
--   これらを、既存の1レース6行の艇別テーブル（race_start_timings、主キー race_id+boat_number）に列を足して持つ
--   （別テーブルは作らない: KISS）。
--
-- 設計上の要点:
--   * 新しい4列は全て NULL 可・DEFAULTなし。既存の行は NULL のまま（過去分の充填は別途。plan.md「Q6の修正計画」）
--   * finish_mark は着欄の生表記（NFKC正規化後。「1」〜「6」・「F」・「L」・「欠」・「落」・「転」・「沈」・「妨」・
--     「エ」・「_」）。全種類は raceResultParser.js の FINISH_MARKS。CHECKは付けない（未観測の表記が現れても、
--     行の書き込みを失敗させず、パーサーの anomalies で検知する）
--   * finish_rank は完走した艇の着（同着は同じ値が複数艇に入る）。非完走は NULL
--   * entry_course はスタート情報の行順（1コース〜6コース）。欠場艇は NULL。実進入は Kファイル由来の
--     race_results.actual_course_1〜6 と一致することを、実ページ16レースで確認済み（plan.md）
--   * race_seconds はレースタイムの秒（1'50"7 → 110.7）。race_results.race_time_1〜6（文字列）は変更しない。
--     kb_archive_boats.race_seconds（074）と同じ型・単位
--   * RLS・ポリシー・GRANTは変更しない（race_start_timings は076で SELECTポリシーが付いている。列の追加は影響しない）

SET LOCAL lock_timeout = '10s';

ALTER TABLE race_start_timings
  ADD COLUMN IF NOT EXISTS finish_mark  text,
  ADD COLUMN IF NOT EXISTS finish_rank  smallint,
  ADD COLUMN IF NOT EXISTS entry_course smallint,
  ADD COLUMN IF NOT EXISTS race_seconds numeric(5,1);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rst_finish_rank') THEN
    ALTER TABLE race_start_timings
      ADD CONSTRAINT chk_rst_finish_rank CHECK (finish_rank BETWEEN 1 AND 6) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rst_entry_course') THEN
    ALTER TABLE race_start_timings
      ADD CONSTRAINT chk_rst_entry_course CHECK (entry_course BETWEEN 1 AND 6) NOT VALID;
  END IF;
END
$$;

ALTER TABLE race_start_timings VALIDATE CONSTRAINT chk_rst_finish_rank;
ALTER TABLE race_start_timings VALIDATE CONSTRAINT chk_rst_entry_course;

COMMENT ON COLUMN race_start_timings.finish_mark IS '着欄の生表記（NFKC正規化後）。1〜6=完走、F=フライング、L=出遅れ、欠=欠場、落=落水、転=転覆、沈=沈没、妨=妨害失格、エ=エンスト、_=順位なし。全種類は scripts/lib/raceResultParser.js の FINISH_MARKS。077以前の行はNULL';
COMMENT ON COLUMN race_start_timings.finish_rank IS '完走した艇の着（1〜6。同着は同じ値が複数艇）。非完走はNULL。race_results.rank1〜6（艇番を着順の位置に並べる旧形式）の正確な代わり';
COMMENT ON COLUMN race_start_timings.entry_course IS '進入コース（結果ページのスタート情報の行順。1〜6）。欠場艇はNULL。race_results.course_1〜6（枠番と恒等で無効）の正確な代わり';
COMMENT ON COLUMN race_start_timings.race_seconds IS 'レースタイムの秒（1''50"7 → 110.7）。完走できなかった艇・5〜6着で空欄のことがある';
