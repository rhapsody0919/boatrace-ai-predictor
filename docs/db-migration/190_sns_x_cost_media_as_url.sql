-- 190: 本文に URL が無くても画像・動画のある X の投稿を、URL つきの額（ceiling_x_url）で予約する。
-- 根拠（2026-10-28、オーナーの X Developer Console の実測。日付は UTC。DB の posted_at も UTC で数えて 10/25・10/26 は本数が一致）:
--   10/27 UTC は ContentCreateWithUrl 2・Content Create 2。DB の送信は5本（全貌 URL つき 06:22、優勝戦の本投稿 画像4枚・URL なし 08:47、
--   投票 URL なし 08:48、展示後のリプ 画像4枚・URL なし 11:29、/today URL つき 23:00:54）で1本合わない。読みは2つ:
--   A（もっともらしい）: WithUrl＝全貌・/today、Create＝画像の2本、投票は数えられていない → 画像は $0.015 で、190 は要らない
--   B: /today がまだ数えられておらず、同じ形の画像の2本の片方だけ WithUrl → 190 が要る（同じ形で値段が分かれる無理がある）
--   決めるのは次の UTC の日の Console と DB の本数の照合。B と分かったときだけ当てる（A なら閉じる）。予約は月の切り替えまで戻らないので、
--   誤って当てると積んだ分は 11/1 まで残る
-- 変えるもの: 関数 sns_x_post_url_priced(snapshot) の本文だけ。transition_sns_send_139 の本文（md5）は変えない。
--   snapshot の media が1つ以上あれば真。素材のスレッドの兄弟は 188 が下書きの媒体（video_storage_path・cover_image_path・
--   source_data.image_paths）から media を作って渡している
-- 検証: scripts/maintenance/verify-sns-x-cost-by-url.js の「transition は予約の判定を sns_x_post_url_priced(snapshot) だけに任せる」
-- 適用の順: 188 の後（下の DO が 188 の関数の本文の md5 を確かめる）。189 とはどちらが先でもよい
-- 適用前の確認: SELECT md5(prosrc) FROM pg_proc WHERE proname = 'sns_x_post_url_priced';  期待: 76c989f914674097b8f7c5b6ad07d42e
-- 適用後の確認: SELECT md5(prosrc) FROM pg_proc WHERE proname = 'sns_x_post_url_priced';  期待: 93ed0d0fc99d704c08100db1346e597c。
--   transition_sns_send_139 の md5 は 96c809c0… のまま。最初の URL の無い画像の投稿の job の reserved_microusd が 200000
-- 戻し方: 188 の sns_x_post_url_priced の CREATE FUNCTION を CREATE OR REPLACE にして当てる（積んだ予約は 11/1 の切り替えまで戻らない）
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
