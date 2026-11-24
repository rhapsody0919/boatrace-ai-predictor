-- 206: URL Inspection API の索引の状態の表（SEO・GEO・AIO のデータの輪 段1 PR5、2026-11-24 オーナー承認）
--
-- 背景: 新しい記事の効きは、まず索引に入ったか（D+1・D+3・D+7）を見る。主要ページは週1（weekly）。
--   案は docs/design/seo-data-loop/db-draft-url-inspection.md。
-- 書き手: scripts/maintenance/inspect-new-articles.js（窓口が回す、service_role）。
-- 読み手: claude_ro（窓口の朝の1枚）。anon・authenticated には何も付けない。
--
-- 戻し方: DROP TABLE public.growth_url_inspection;（他の表から参照されない）

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.growth_url_inspection (
    url              TEXT        NOT NULL,
    inspected_on     DATE        NOT NULL,
    checkpoint       TEXT        NOT NULL CHECK (checkpoint IN ('D+1', 'D+3', 'D+7', 'weekly')),
    verdict          TEXT,
    coverage_state   TEXT,
    indexing_state   TEXT,
    page_fetch_state TEXT,
    robots_txt_state TEXT,
    google_canonical TEXT,
    user_canonical   TEXT,
    canonical_ok     BOOLEAN,
    last_crawl_time  TIMESTAMPTZ,
    fetched_at       TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (url, inspected_on)
);

COMMENT ON TABLE public.growth_url_inspection IS
    'URL Inspection API の索引の状態（indexStatusResult）。新記事の D+1・D+3・D+7（主要ページは週 weekly）。同じ日に回し直しても (url, inspected_on) の upsert で二重にならない';
COMMENT ON COLUMN public.growth_url_inspection.verdict IS 'PASS なら索引済み（それ以外は未索引。応答に無ければ NULL = 不明）';
COMMENT ON COLUMN public.growth_url_inspection.canonical_ok IS 'Google が選んだ canonical が URL 自身か（www・無印・末尾の / は同じ扱い）。応答に無ければ NULL = 未確認';
COMMENT ON COLUMN public.growth_url_inspection.inspected_on IS '検査した日（太平洋時間 PT の日。growth_gsc_daily と同じ）';

-- 確認の日ごと・日付で読む
CREATE INDEX IF NOT EXISTS idx_growth_url_inspection_on ON public.growth_url_inspection (inspected_on);

-- 権限: growth_gsc_daily（204）と同じ形。anon・authenticated には何も付けない
ALTER TABLE public.growth_url_inspection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_url_inspection FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_url_inspection TO service_role;
GRANT SELECT ON public.growth_url_inspection TO claude_ro;

COMMIT;
