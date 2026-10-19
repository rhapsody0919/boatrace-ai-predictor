# 164 の適用手順（全貌動画の測り時: 当日 JST 23:00・投稿の24時間後）

マイグレーション164（`164_sns_full_picture_metric_windows.sql`）の本番適用の手順。決定は 2026-10-19 オーナー（hq 経由）: 全貌動画（`format=full_picture`）は 48h・7d をやめ、当日の全レース終了後（JST 23:00）と投稿の24時間後で測る。全貌以外（ブログ・/today など）は今までどおり 48h・7d。

## 変えるもの
- `sns_metric_jobs`・`sns_metric_observations` の窓の CHECK に `day_end`・`24h` を足す
- `sns_metric_observations` の窓の終わりの CHECK（`sns_metric_observations_check2`）を、4つの窓ごとの式（`sns_metric_observations_period_end`）に置き換える。`day_end` は投稿日（JST）の 23:00
- posted で取り込みの job を作るトリガー関数 `enqueue_sns_metric_jobs` を置き換える（154）。全貌は `day_end`・`24h`、23:00 を過ぎてから投稿された全貌は `24h` だけ、それ以外は `48h`・`7d`

## 既存のデータへの影響（2026-10-19 の本番、読み取りで確認）
- `sns_metric_jobs` は2行（/today の投稿の 48h・7d、pending）。変えない。新しい CHECK に違反しない
- `sns_metric_observations` は0行
- 置き換える前の `enqueue_sns_metric_jobs` の md5 は `b635b35552120b7704ee08ae146c8e69`（154 の定義を PGlite に入れた値と一致）

## 順序
1. ユーザー: SQL Editor で下のブロックを1回で実行する（最初の確認で前提が違えば例外で止まり、何も変えない）
2. Claude: 最後の SELECT の結果を読み取りで確かめ、APPLIED.md の 164 を「適用済み」に直す
3. コード（このPR）は新しい窓を使うので、**適用の後にマージする**（先にマージしても全貌の投稿が無い間は壊れないが、全貌が posted になると古いトリガーが 48h・7d を作る）

## 実行する SQL（1回で貼る）
```sql
-- 実行前の確認: 置き換える関数と、DROP する3つの制約が想定どおりか（違えば止まる）
DO $$
BEGIN
  IF md5(pg_get_functiondef('public.enqueue_sns_metric_jobs()'::regprocedure)) <> 'b635b35552120b7704ee08ae146c8e69' THEN
    RAISE EXCEPTION '164: enqueue_sns_metric_jobs が 154 の定義と違うので適用しない';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN
      ('sns_metric_jobs_window_check', 'sns_metric_observations_window_check', 'sns_metric_observations_check2')) <> 3 THEN
    RAISE EXCEPTION '164: DROP する制約が見つからないので適用しない';
  END IF;
END $$;

BEGIN;

-- 1. 窓の名前に day_end（投稿日の JST 23:00 まで）と 24h を足す
ALTER TABLE public.sns_metric_jobs DROP CONSTRAINT sns_metric_jobs_window_check;
ALTER TABLE public.sns_metric_jobs ADD CONSTRAINT sns_metric_jobs_window_check
  CHECK ("window" IN ('48h', '7d', 'day_end', '24h'));
ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_window_check;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_window_check
  CHECK ("window" IN ('48h', '7d', 'day_end', '24h'));

-- 2. 窓の終わりの時刻。day_end は投稿日（JST）の 23:00 で、投稿より後でなければならない
ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_check2;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_period_end
  CHECK (CASE "window"
    WHEN '48h' THEN period_end = period_start + interval '48 hours'
    WHEN '7d' THEN period_end = period_start + interval '168 hours'
    WHEN '24h' THEN period_end = period_start + interval '24 hours'
    WHEN 'day_end' THEN period_end = (((period_start AT TIME ZONE 'Asia/Tokyo')::date + time '23:00') AT TIME ZONE 'Asia/Tokyo')
      AND period_end > period_start
  END);

-- 3. posted で作る取り込みの job を、下書きの format で分ける（154 の置き換え）。
--    全貌: day_end（投稿日の JST 23:00。23:00 を過ぎてから投稿されたものは作らない）と 24h。それ以外: 48h と 7d
CREATE OR REPLACE FUNCTION public.enqueue_sns_metric_jobs() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_format TEXT;
  v_day_end TIMESTAMPTZ;
BEGIN
  IF NEW.state = 'posted' AND (OLD.state IS DISTINCT FROM 'posted') AND NEW.posted_at IS NOT NULL THEN
    SELECT format INTO v_format FROM public.sns_drafts WHERE id = NEW.draft_id;
    IF v_format = 'full_picture' THEN
      v_day_end := ((NEW.posted_at AT TIME ZONE 'Asia/Tokyo')::date + time '23:00') AT TIME ZONE 'Asia/Tokyo';
      INSERT INTO public.sns_metric_jobs (draft_id, "window", source, due_at)
      SELECT NEW.draft_id, w.win, CASE WHEN NEW.channel = 'youtube' THEN 'youtube-data' ELSE 'x-api' END, w.due
      FROM (VALUES ('day_end', v_day_end), ('24h', NEW.posted_at + interval '24 hours')) AS w(win, due)
      WHERE w.win <> 'day_end' OR v_day_end > NEW.posted_at
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.sns_metric_jobs (draft_id, "window", source, due_at)
      SELECT NEW.draft_id, w.win, CASE WHEN NEW.channel = 'youtube' THEN 'youtube-data' ELSE 'x-api' END,
             NEW.posted_at + w.span
      FROM (VALUES ('48h', interval '48 hours'), ('7d', interval '168 hours')) AS w(win, span)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_sns_metric_jobs() FROM PUBLIC, anon, authenticated;

COMMIT;

-- 実行後の確認（1行。期待値: 全部 true、jobs は2）
SELECT
  md5(pg_get_functiondef('public.enqueue_sns_metric_jobs()'::regprocedure)) = '5966815e7ae376e0377a0df15b027157' AS trigger_fn_ok,
  (SELECT pg_get_constraintdef(oid) LIKE '%day_end%' FROM pg_constraint WHERE conname = 'sns_metric_jobs_window_check') AS jobs_window_ok,
  (SELECT pg_get_constraintdef(oid) LIKE '%day_end%' FROM pg_constraint WHERE conname = 'sns_metric_observations_window_check') AS obs_window_ok,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sns_metric_observations_period_end') AS period_end_ok,
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sns_metric_observations_check2') AS old_check_dropped,
  (SELECT count(*) FROM public.sns_metric_jobs) AS jobs;
```

## 戻し方
154 の `enqueue_sns_metric_jobs` の定義（`154_sns_tokens_metric_jobs.sql` の該当部分）を `CREATE OR REPLACE` で戻し、CHECK を 154 の形（窓は `48h`・`7d`、period_end は `CASE "window" WHEN '48h' THEN 48h ELSE 168h`）に戻す。`day_end`・`24h` の行が既にあれば、戻す前に消すか残すかを決める（CHECK に違反するため）。
