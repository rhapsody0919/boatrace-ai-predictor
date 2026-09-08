-- 055: 選手ごとの最新級別・勝率を一括取得するRPC（docs/design/racer-search-and-list/）
--
-- 背景: 級別はADR-0023の方針でrace_entriesの選手ごとの最新行（race_id降順1件）を
-- 正とする。選手個別ページ（src/services/racerService.js:28-35）は1選手ずつこの
-- パターンでクエリしているが、選手一覧・検索フィルタでは全選手（約1,627人）分を
-- 一括で必要とする。1,627回のクエリを避けるため、DISTINCT ONで1回のSQLで
-- 全選手分の最新行を返すRPCを新設する（技術選定の比較はdocs/adr/0043参照）。
--
-- 複合インデックス: 既存のidx_race_entries_racer_id（050番、racer_id単体）は
-- 「racer_idで絞り込む」クエリ向けで、DISTINCT ON (racer_id) ORDER BY racer_id,
-- race_id DESC のような「racer_idごとに最新1件を選ぶ」クエリには複合インデックス
-- が無いと全表スキャン+ソートになる。CONCURRENTLYはトランザクション内で実行
-- できないため、Supabase Dashboard > SQL Editor でこのインデックス文だけを
-- 単独実行すること。

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_entries_racer_id_race_id
    ON public.race_entries (racer_id, race_id DESC);

CREATE OR REPLACE FUNCTION get_latest_racer_grades()
RETURNS TABLE (
  racer_id INTEGER,
  grade TEXT,
  win_rate NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (racer_id)
    racer_id,
    grade,
    win_rate
  FROM race_entries
  WHERE racer_id IS NOT NULL
  ORDER BY racer_id, race_id DESC;
$$;
