-- 172: 全貌動画の YouTube を、1レースで完全版と Shorts の2件にする（2026-10-20、#1693 の新しい型への切り替え。BOA-912）
-- 153 の一意の索引 sns_auto_send_items_race_channel（1レース×1チャネルで生きている item は1件）のままでは、Shorts の item が入らない。
-- item に variant（main・shorts）を足し、一意の索引を (race_id, channel, variant) に作り直す。shorts は全貌の YouTube だけに許す。
-- 承認（approve_sns_x_send、160）は item を draft_id で、送信（transition_sns_send_139、158）は auto_item_id で引くので、RPC は変えない。
-- Shorts を完全版の公開の後に送る待ち合わせは、既存の parent_job_id（X のスレッドと同じ。158 の claim で parent_not_posted）を使い、表は変えない。
-- 既存の行はすべて main になる（今の生きている行は旧索引を満たしているので、新しい索引でも重複しない）。
-- 先にコード（push-full-picture.js の Shorts 対応・送る前の検査）をデプロイしてから当てる（db-apply は master の HEAD の SQL を当てる）。
--
-- 適用前の確認（読み取り）:
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'sns_auto_send_items_race_channel';
--   期待: CREATE UNIQUE INDEX sns_auto_send_items_race_channel ON public.sns_auto_send_items USING btree (race_id, channel)
--         WHERE (state <> ALL (ARRAY['stopped'::text, 'held_manual'::text]))   （2026-10-20 に本番で確認済み）
--   SELECT count(*) FROM information_schema.columns WHERE table_name = 'sns_auto_send_items' AND column_name = 'variant';  期待: 0
--
-- 適用後の確認（読み取り）:
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'sns_auto_send_items_race_channel';  期待: (race_id, channel, variant) と同じ WHERE
--   SELECT variant, count(*) FROM public.sns_auto_send_items GROUP BY 1;  期待: main だけ
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.sns_auto_send_items'::regclass AND conname = 'sns_auto_send_items_variant_scope';  期待: 1行
--
-- 戻し方（shorts の item が生きていないことを確かめてから）:
--   SELECT count(*) FROM public.sns_auto_send_items WHERE variant = 'shorts' AND state NOT IN ('stopped', 'held_manual');  期待: 0（あれば先に stopped にする）
--   BEGIN;
--   DROP INDEX public.sns_auto_send_items_race_channel;
--   CREATE UNIQUE INDEX sns_auto_send_items_race_channel ON public.sns_auto_send_items (race_id, channel) WHERE state NOT IN ('stopped', 'held_manual');
--   ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_variant_scope;
--   ALTER TABLE public.sns_auto_send_items DROP COLUMN variant;
--   COMMIT;
--   （stopped・held_manual の shorts の行が残っていても、旧索引はその行を対象にしないので作り直せる。DROP COLUMN の前に shorts の行を消すかは、そのときに判断する）
BEGIN;

ALTER TABLE public.sns_auto_send_items
  ADD COLUMN variant TEXT NOT NULL DEFAULT 'main' CHECK (variant IN ('main', 'shorts'));

-- Shorts は全貌の YouTube だけ（race・digest・X には入れない）
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_variant_scope
  CHECK (variant = 'main' OR (kind = 'full_picture' AND channel = 'youtube'));

-- 同じレース・同じチャネル・同じ版の生きている item は1つ（153 の意味を版ごとに保つ）
DROP INDEX public.sns_auto_send_items_race_channel;
CREATE UNIQUE INDEX sns_auto_send_items_race_channel ON public.sns_auto_send_items (race_id, channel, variant)
  WHERE state NOT IN ('stopped', 'held_manual');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sns_auto_send_items WHERE variant <> 'main') THEN
    RAISE EXCEPTION '172: 既存の item に main 以外の variant がある';
  END IF;
END $$;

COMMIT;
