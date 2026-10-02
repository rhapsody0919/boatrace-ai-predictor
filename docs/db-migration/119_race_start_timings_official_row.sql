-- 119: race_start_timings に公式の着順表の行の順（official_row）を足す（BOA-667）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 背景:
--   公式の結果ページの着順表は、着順の無い艇（F・欠・転・落・妨 等）を艇番順ではなく記号の種類ごとに並べ、
--   同じ種類の中は艇番順にしている（例: ＿→F、F→欠、転→欠、落→妨。BOA-558 の3）。種類の間の順は全ての
--   組み合わせを確認できていないため、並びの規則を推測で実装せず、公式の行の順そのものを持つ。
--   画面（着順の無い艇の並び）は、この列が入ってから official_row の順に並べる（値が NULL なら艇番順）。
--
-- 値: 1〜6。公式の着順表（結果ページ）の上からの行の順。欠場艇も1行として数える。NULL＝未取得。
-- 書き込み: 日次は scripts/daily/scrape-results.js（結果ページの取得時。scripts/lib/raceResultRows.js の
--   buildTimingRows）。列が無い間は書かない（scripts/lib/raceResultSchema.js の officialRow で適用を判定）。
-- 過去分: 埋めない（NULL のまま）。Kファイルの並びは公式の結果ページの行の順と同じだと確認できておらず、
--   結果ページの取り直しは対象が全期間に及ぶため（BOA-667 の判断）。
-- 権限: 新しいテーブルは作らない。列の追加なので、既存の race_start_timings の RLS・GRANT がそのまま効く。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   NULL 許可・既定値なしの列の追加と CHECK（NOT VALID）は、表の書き換えを伴わない（メタデータの変更だけで一瞬）。
--   既存の行は全て NULL のため、VALIDATE は全行の走査だけで書き込みは無い。
--   ACCESS EXCLUSIVE を一瞬取るため lock_timeout を10秒にしてある（取れなければ失敗し、何も変わらない）。
--   コードは列が無い間は書かないので、コードのマージの前後どちらでも適用してよい。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'race_start_timings' AND column_name = 'official_row';
--   → smallint / YES
--   SELECT conname, convalidated FROM pg_constraint WHERE conname = 'chk_race_start_timings_official_row';
--   → 1行、convalidated = true
--   SELECT count(*) FROM race_start_timings WHERE official_row IS NOT NULL;
--   → 0（適用直後。最大5分後（判定のキャッシュ）の結果の取得から書き始める）
--
-- 元に戻す（列と、そこに書いた値が消える。他の列・表には影響しない）:
--   BEGIN;
--   SET LOCAL lock_timeout = '10s';
--   ALTER TABLE race_start_timings DROP COLUMN IF EXISTS official_row;
--   COMMIT;

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE race_start_timings
  ADD COLUMN IF NOT EXISTS official_row smallint;

ALTER TABLE race_start_timings
  DROP CONSTRAINT IF EXISTS chk_race_start_timings_official_row;
ALTER TABLE race_start_timings
  ADD CONSTRAINT chk_race_start_timings_official_row
  CHECK (official_row IS NULL OR official_row BETWEEN 1 AND 6) NOT VALID;
ALTER TABLE race_start_timings
  VALIDATE CONSTRAINT chk_race_start_timings_official_row;

COMMENT ON COLUMN race_start_timings.official_row IS
  '公式の結果ページの着順表の行の順（1〜6、欠場艇も1行）。着順の無い艇の並びに使う。NULL＝未取得（2026-10 以前の行は埋めない）（BOA-667）';

COMMIT;
