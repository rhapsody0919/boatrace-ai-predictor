-- 179: X の「数字で見たら」（集計ランキングの画像1枚、format=research_image、X だけ、月・水・金 19:00）を自動送信の item にする（hq XR01、オーナー 2026-10-27）。
-- hq の作り手が出すフォルダを scripts/sns/push-research-image.js が受け取り、X の下書き（画像1枚）と item（kind='research_image'・variant='main'、
-- 下書きに直接ひもづく）を作り、自動送信の承認者で承認する（approve_sns_x_send は 177 のまま）。
-- レースを持たないので、item の race_id には research:{YYYY-MM-DD}:{slug} を入れる（日は送る日の JST、slug は hq の題の札）。
-- 1日1本: 同じ JST の日の research_image は、生きている item（stopped・held_manual でないもの。送った sent も含む）が1つだけ。
-- 自動送信の許可は sns_auto_send_control の x の行の research_image_enabled（既定 false）。オーナーの yes まで false のまま。
-- 送り手の期限・許可・取り置き（transition_sns_send_139）は 180 で変える。この 179 は表の CHECK・索引・列だけ（関数は変えない）。
-- 変えるもの:
--   1. sns_auto_send_items: kind に research_image、kind_source に research_image の枝（X だけ・下書きにひもづく）、
--      research_image の race_id の形と variant=main の CHECK、1日1本の一意の索引 sns_auto_send_items_research_day
--      （(channel, left(race_id, 19))。left(race_id,19) は 'research:YYYY-MM-DD'）
--   2. sns_auto_send_control.research_image_enabled（BOOLEAN NOT NULL DEFAULT false、x の行だけ true にできる）
-- 検証: scripts/maintenance/verify-sns-research-image.js（PGlite、外部接続なし）
-- 適用の順: 179 → 180（180 は research_image_enabled を読むので、列が無いと 180 の最初の DO で止まる）。
--   コード（push-research-image.js・snsClaimCheck.js・snsDeadlineQueue.js の research_image の枝）とはどちらが先でもよい:
--   列が無い間は push が off として扱い何も書かない。kind の CHECK が item を拒む。送り手は research_image の下書きが無いので通らない
--
-- 適用前の確認（読み取り）:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.sns_auto_send_items'::regclass
--     AND conname IN ('sns_auto_send_items_kind_check','sns_auto_send_items_kind_source');
--   期待: 2行（kind は race・digest・full_picture・finals_image）
--   SELECT count(*) FROM information_schema.columns WHERE table_name = 'sns_auto_send_control' AND column_name = 'research_image_enabled';  期待: 0
--   SELECT count(*) FROM public.sns_auto_send_items WHERE race_id LIKE 'research:%';  期待: 0
--
-- 適用後の確認（読み取り）:
--   SELECT channel, research_image_enabled FROM public.sns_auto_send_control ORDER BY 1;  期待: x false・youtube false
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sns_auto_send_items_kind_source';  期待: research_image の枝
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'sns_auto_send_items_research_day';  期待: 1行
--
-- 戻し方（research_image の item が0件のときだけ。1件以上なら許可を false にして止めるだけにする）:
--   SELECT count(*) FROM public.sns_auto_send_items WHERE kind = 'research_image';  期待: 0
--   DROP INDEX public.sns_auto_send_items_research_day; 下の CHECK を 177 の定義に戻し、列 research_image_enabled と CHECK を落とす
--   （180 を当てた後なら、先に 180 の戻し方で関数を 177 に戻す）
BEGIN;

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_kind_check;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_kind_check
  CHECK (kind IN ('race', 'digest', 'full_picture', 'finals_image', 'research_image'));

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_kind_source;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_kind_source CHECK (
  (kind = 'race' AND bundle_import_id IS NOT NULL AND draft_id IS NULL)
  OR (kind = 'digest' AND bundle_import_id IS NULL AND draft_id IS NOT NULL AND channel = 'x')
  OR (kind = 'full_picture' AND bundle_import_id IS NULL AND draft_id IS NOT NULL)
  OR (kind = 'finals_image' AND bundle_import_id IS NULL AND draft_id IS NOT NULL AND channel = 'x')
  OR (kind = 'research_image' AND bundle_import_id IS NULL AND draft_id IS NOT NULL AND channel = 'x'));

-- research_image の race_id は research:{YYYY-MM-DD}:{slug}（slug は英小文字・数字・ハイフン、40字まで。api/_lib/snsResearchImage.js と同じ）。
-- 版は main だけ（variant_scope の main の枝は kind<>'finals_image' なので、177 のままで research_image の main を許す）
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_research_id CHECK (
  kind <> 'research_image'
  OR (race_id ~ '^research:[0-9]{4}-[0-9]{2}-[0-9]{2}:[a-z0-9][a-z0-9-]{0,39}$' AND variant = 'main'));

-- 1日1本（同じ JST の日に生きている・送った research_image は1つ）。直した版を入れ直すときは前の item を stopped（superseded）にしてから作る
CREATE UNIQUE INDEX sns_auto_send_items_research_day ON public.sns_auto_send_items (channel, left(race_id, 19))
  WHERE kind = 'research_image' AND state NOT IN ('stopped', 'held_manual');

ALTER TABLE public.sns_auto_send_control ADD COLUMN research_image_enabled BOOLEAN NOT NULL DEFAULT false;
-- 意味を持つのは x の行だけ（176 の finals_image_x_only と同じ）
ALTER TABLE public.sns_auto_send_control ADD CONSTRAINT sns_auto_send_control_research_image_x_only
  CHECK (channel = 'x' OR research_image_enabled = false);

COMMIT;
