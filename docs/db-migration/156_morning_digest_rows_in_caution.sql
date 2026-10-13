-- 156: morning_digest_rows にイン崩れ注意度の列を足す（BOA-822）
--
-- 対応spec/plan: docs/design/in-collapse-caution/plan.md「/today」、ADR-0095
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーが SQL Editor で行う（docs/db-migration/APPLIED.md）。
--
-- 変更: 3列を足す（全列 NULL 可・DEFAULT なし）。volatility_percentile（098、0〜100 の会場内の順位）は使い回さない
--   （意味が違う値が同じ列に混ざると、過去の日の行と比べられなくなる）。
--     in_caution_pct    smallint      1号艇が1着を逃した割合（0〜100 の整数の%）。朝の unified の inCaution.pct をそのまま写す
--                                    （画面に出す%と段を同じ整数から出す。plan §1）
--     in_caution_n      integer       その帯の件数
--     in_caution_level  text          段（low / mid / high）。朝の生成が決めた値をそのまま写す（画面で閾値をかけ直さない）
--   読み取りの権限は表の既存の GRANT SELECT（anon, authenticated）とポリシーがそのまま効く。
--
-- 適用前の書き手の挙動: generate-morning-digest.js は OPTIONAL_ROW_COLUMNS に3列を入れ、列が無ければ外して書く
--   （131 と同じ）。適用の前後どちらにマージしてもよい。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'morning_digest_rows' AND column_name LIKE 'in_caution_%';  -- 3行
--   SELECT has_column_privilege('anon', 'public.morning_digest_rows', 'in_caution_pct', 'SELECT');           -- true
--
-- 適用の時刻: ALTER TABLE は ACCESS EXCLUSIVE のロックを取る（メタデータだけで一瞬）。digest の書き込み（JST 05:20〜05:40、
--   06:30・08:00 の再実行）を避けて適用する。NOT VALID → VALIDATE は同じトランザクションの中なのでロックを軽くする効果は無い（害も無い）。
--
-- 元に戻す: 列は残す（書き手を戻せば NULL のまま）。

SET LOCAL lock_timeout = '10s';

ALTER TABLE public.morning_digest_rows
  ADD COLUMN IF NOT EXISTS in_caution_pct smallint,
  ADD COLUMN IF NOT EXISTS in_caution_n integer,
  ADD COLUMN IF NOT EXISTS in_caution_level text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.morning_digest_rows'::regclass AND conname = 'morning_digest_rows_in_caution_check'
  ) THEN
    ALTER TABLE public.morning_digest_rows
      ADD CONSTRAINT morning_digest_rows_in_caution_check
      CHECK ((in_caution_level IS NULL OR in_caution_level IN ('low', 'mid', 'high'))
             AND (in_caution_pct IS NULL OR in_caution_pct BETWEEN 0 AND 100)) NOT VALID;
    ALTER TABLE public.morning_digest_rows VALIDATE CONSTRAINT morning_digest_rows_in_caution_check;
  END IF;
END
$$;
