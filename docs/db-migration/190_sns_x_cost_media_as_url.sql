-- 190: 本文に URL が無くても画像・動画のある X の投稿を、URL つきの額（ceiling_x_url）で予約する。
-- 根拠（2026-10-28、オーナーの X Developer Console の実測。日付は UTC）: 10/27 UTC は ContentCreateWithUrl 2・Content Create 2。DB の送信は
--   5本（全貌 URL つき 06:22、優勝戦の本投稿 画像4枚・URL なし 08:47、投票 URL なし 08:48、展示後のリプ 画像4枚・URL なし 11:29、
--   /today URL つき 23:00:54）で Console の合計4本と1本合わない。/today がまだ数えられていなければ、画像の投稿の1本が WithUrl で
--   数えられた。区別は、10/28 UTC の URL の無い画像の投稿（数字で見たら 10:00 UTC、画像1枚）が Console でどちらに入るかで付く。
--   多めに予約する側に倒す（少なく予約すると、実額が予算を越えても claim が止まらない）。オーナー 2026-10-28「出してよい」
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
