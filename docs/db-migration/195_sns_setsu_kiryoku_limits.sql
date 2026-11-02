-- 195: 節の機力（X・YouTube Shorts）を動かす設定の値（オーナー 2026-11-02 決定、#2112・#2113、BOA-1209）
-- X: daily_limit_x 11→12、取り置き finals_image 3→1・today_thinking 6→2（投票・展示後のリプは 10/31 にやめた）・setsu_kiryoku を新しく 1
-- YouTube: daily_limit_youtube 9→10
-- 旗: sns_auto_send_control の setsu_kiryoku_enabled（x）・setsu_kiryoku_short_enabled（youtube）を true
-- スキーマは変えない。値だけ。前提（194 適用済み・上限が 11 と 9）が違えば全体を戻す。
-- 適用はオーナーの db-apply（時間帯の制約なし。送信の cron が読む行を UPDATE するだけで、ロックは一瞬）。
-- 適用後の確認（期待: 12・10・true・true、reserves={"digest":1,"finals_image":1,"full_picture":0,"research_image":1,"setsu_kiryoku":1,"today_thinking":2}）:
--   SELECT (SELECT daily_limit_x FROM public.sns_x_send_control) AS limit_x,
--          (SELECT daily_limit_youtube FROM public.sns_x_send_control) AS limit_youtube,
--          (SELECT setsu_kiryoku_enabled FROM public.sns_auto_send_control WHERE channel='x') AS x_on,
--          (SELECT setsu_kiryoku_short_enabled FROM public.sns_auto_send_control WHERE channel='youtube') AS yt_on,
--          (SELECT jsonb_object_agg(kind, daily_count) FROM public.sns_x_kind_reserves) AS reserves;
-- 止めるとき: UPDATE public.sns_auto_send_control SET setsu_kiryoku_enabled = false WHERE channel='x';
--            UPDATE public.sns_auto_send_control SET setsu_kiryoku_short_enabled = false WHERE channel='youtube';

BEGIN;

DO $$ BEGIN
  IF (SELECT daily_limit_x FROM public.sns_x_send_control WHERE id = true) IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'daily_limit_x が 11 でない（読み直してから当てる）'; END IF;
  IF (SELECT daily_limit_youtube FROM public.sns_x_send_control WHERE id = true) IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'daily_limit_youtube が 9 でない（読み直してから当てる）'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'sns_auto_send_control'
                    AND column_name = 'setsu_kiryoku_enabled') THEN
    RAISE EXCEPTION '194 が当たっていない（setsu_kiryoku_enabled の列が無い）'; END IF;
END $$;

UPDATE public.sns_x_send_control
   SET daily_limit_x = 12, daily_limit_youtube = 10
 WHERE id = true AND daily_limit_x = 11 AND daily_limit_youtube = 9;

UPDATE public.sns_x_kind_reserves SET daily_count = 1,
       note = '優勝戦（本投稿だけ。投票・展示後のリプは 10/31 にやめた）'
 WHERE kind = 'finals_image';
UPDATE public.sns_x_kind_reserves SET daily_count = 2,
       note = '/today の対象レースの思考投稿（2レース×本投稿1本）'
 WHERE kind = 'today_thinking';
INSERT INTO public.sns_x_kind_reserves(kind, daily_count, weekdays, note)
VALUES ('setsu_kiryoku', 1, NULL, '節の機力（毎日 21:30）');

UPDATE public.sns_auto_send_control SET setsu_kiryoku_enabled = true WHERE channel = 'x';
UPDATE public.sns_auto_send_control SET setsu_kiryoku_short_enabled = true WHERE channel = 'youtube';

-- 取り置きの合計（曜日ごと）＋外部の数が、X の日の上限を越えないこと
DO $$ BEGIN
  IF (SELECT max(s) FROM (SELECT d, sum(daily_count) s FROM public.sns_x_kind_reserves,
        generate_series(1,7) d WHERE weekdays IS NULL OR d = ANY(weekdays) GROUP BY d) t)
     + (SELECT daily_external_count FROM public.sns_x_send_control WHERE id = true)
     > (SELECT daily_limit_x FROM public.sns_x_send_control WHERE id = true) THEN
    RAISE EXCEPTION '取り置きの合計が上限を越える'; END IF;
END $$;

COMMIT;
