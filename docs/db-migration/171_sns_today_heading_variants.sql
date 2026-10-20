-- 171: /today の X 投稿の見出しの2案を sns_template_variants に入れる（2026-10-20 オーナー承認、PR #1687 の続き）
-- 案の札を sns_post_tracking.template_variant_id・sns_drafts.template_variant_id に入れるための行（外部キーの先）。
-- 仕組みは docs/operation/sns-today-heading-variants.md。データの2行だけで、表・関数は変えない。db-apply で当てる。
-- この行が入った後に、config/today-variants.json の案 a・b の uuid に下の2つを入れる PR を別に出す（入る前に uuid を入れると札なしになる）。
--
-- 適用前の確認（期待値: 0行）:
--   SELECT id, format, variant_name FROM public.sns_template_variants
--   WHERE id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a')
--      OR (format = 'today_digest' AND variant_name IN ('today-heading-a', 'today-heading-b'));
--
-- 適用後の確認（期待値: 2行。today-heading-a・today-heading-b、active=true）:
--   SELECT id, format, variant_name, active FROM public.sns_template_variants
--   WHERE id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a')
--   ORDER BY variant_name;
--
-- 戻し方（先に config/today-variants.json の uuid を null に戻す PR をマージしてから）:
--   参照の数（期待値: 0。参照があれば消さず active=false にする）:
--     SELECT (SELECT count(*) FROM public.sns_post_tracking WHERE template_variant_id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a'))
--          + (SELECT count(*) FROM public.sns_drafts WHERE template_variant_id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a'));
--   参照が0のとき: DELETE FROM public.sns_template_variants WHERE id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a');
--   参照があるとき: UPDATE public.sns_template_variants SET active = false WHERE id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a');
BEGIN;

-- 同じ id か同じ (format, variant_name) の行があれば何もしない（もう一度当てても増えない）
INSERT INTO public.sns_template_variants (id, format, variant_name, composition_name, active, notes, created_by)
VALUES
  ('0f88824e-c630-4f94-8c15-475297e4b242', 'today_digest', 'today-heading-a', 'TodayDigestX', true,
   '/today の X 投稿の見出しの案 a（config/today-variants.json の id "a"）', 'human'),
  ('be74c247-fa8f-442e-a29f-4d1d7866919a', 'today_digest', 'today-heading-b', 'TodayDigestX', true,
   '/today の X 投稿の見出しの案 b（config/today-variants.json の id "b"）', 'human')
ON CONFLICT DO NOTHING;

COMMIT;
