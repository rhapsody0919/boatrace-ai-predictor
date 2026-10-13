-- 158: 得点率一覧（racer_series_points）に「早見」の列（翌日の1走目・2走目のレース番号）を足す（BOA-784）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーが SQL Editor で行う（docs/db-migration/APPLIED.md）。
--
-- 背景:
--   公式の得点率一覧（pointrank）は、予選中の夜から「早見」の列に各選手の**翌日**の1走目・2走目の
--   レース番号を出す（例: 三国G1 10/6夜 末永 5R/11R、毒島 7R/12R）。当サイトの出走表は当日05:07ごろ
--   DBに入るので、勝負駆けの下調べが最も見られる前夜には手元に無い。節ページに翌日のレース番号を出すため、
--   夜の取得（scripts/daily/scrape-point-rank.js、api/cron/point-rank.js）でこの列も保存する。
--   オーナー決定（2026-10-13）。
--
-- 列:
--   next_race_1 / next_race_2: 早見の1走目・2走目のレース番号（1〜12）。空欄（翌日の番組が無い・1走だけ・
--     予選が終わった後）は NULL。毎晩の upsert で上書きされる（前の晩の値は残らない）
--   next_series_day: 早見の見出しが指す節の日目（「早見（4日目）」の 4）。見出しに日目が無ければ NULL
--
-- 書き込み側は scripts/lib/optionalColumns.js で、この列が未適用でも他の列を書き続ける（適用の前後どちらで
-- 取得のコードをマージしてもよい）。表の権限（RLS・anon の SELECT、076）は変えない。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'racer_series_points'
--      AND column_name IN ('next_race_1', 'next_race_2', 'next_series_day');  -- 3行・smallint
--   SELECT has_column_privilege('anon', 'public.racer_series_points', 'next_race_1', 'SELECT');  -- true
--
-- 元に戻す: 取得側のコードはそのままでよい（列が無ければ除いて書く）
--   ALTER TABLE public.racer_series_points
--     DROP COLUMN IF EXISTS next_race_1, DROP COLUMN IF EXISTS next_race_2, DROP COLUMN IF EXISTS next_series_day;

SET LOCAL lock_timeout = '10s';

ALTER TABLE public.racer_series_points
  ADD COLUMN IF NOT EXISTS next_race_1 SMALLINT CHECK (next_race_1 BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS next_race_2 SMALLINT CHECK (next_race_2 BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS next_series_day SMALLINT CHECK (next_series_day BETWEEN 1 AND 9);

COMMENT ON COLUMN public.racer_series_points.next_race_1 IS
    '公式の得点率一覧の「早見」1走目のレース番号（翌日）。空欄はNULL。毎晩上書き（BOA-784）';
COMMENT ON COLUMN public.racer_series_points.next_race_2 IS
    '公式の得点率一覧の「早見」2走目のレース番号（翌日）。空欄はNULL。毎晩上書き（BOA-784）';
COMMENT ON COLUMN public.racer_series_points.next_series_day IS
    '「早見」の見出しが指す節の日目（「早見（4日目）」の4）。見出しに日目が無ければNULL（BOA-784）';
