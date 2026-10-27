-- 190（用意だけ。番号は PR を出すときに origin/master の最大＋1 に付け直す）: 本文に URL が無くても画像・動画のある X の投稿を、
-- URL つきの額（ceiling_x_url）で予約する。本文に URL の無い画像の投稿が X API の「Post: Create (with URL)」$0.200 で請求されると
-- Developer Console で分かったときだけ出す（188 の「未確認」、2026-10-27 オーナー「結果を見てから」）。
-- 変えるもの: 関数 sns_x_post_url_priced(snapshot) の本文だけ。transition_sns_send_139 の本文（md5）は変えない。
--   snapshot の media が1つ以上あれば真。素材のスレッドの兄弟は 188 が下書きの媒体（video_storage_path・cover_image_path・
--   source_data.image_paths）から media を作って渡している
-- 検証: scripts/maintenance/verify-sns-x-cost-by-url.js の「transition は予約の判定を sns_x_post_url_priced(snapshot) だけに任せる」
-- 適用の順: 188 の後（下の DO が 188 の関数の本文の md5 を確かめる）。189 とはどちらが先でもよい
-- 適用前の確認: SELECT md5(prosrc) FROM pg_proc WHERE proname = 'sns_x_post_url_priced';  期待: 76c989f914674097b8f7c5b6ad07d42e
-- 戻し方: 188 の sns_x_post_url_priced の CREATE FUNCTION を CREATE OR REPLACE にして当てる
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sns_x_post_url_priced' AND md5(prosrc) = '76c989f914674097b8f7c5b6ad07d42e') THEN
    RAISE EXCEPTION '190: sns_x_post_url_priced が 188 の本文でない';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sns_x_post_url_priced(p_snapshot JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT public.sns_x_post_has_url(p_snapshot->>'text') OR jsonb_array_length(coalesce(p_snapshot->'media','[]'::jsonb)) > 0;
$$;

REVOKE ALL ON FUNCTION public.sns_x_post_url_priced(JSONB) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
