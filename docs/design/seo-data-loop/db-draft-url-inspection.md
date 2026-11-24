> 未審査の案。適用の根拠にしない。

# growth_url_inspection（URL Inspection の結果）の DB の案

設計: SEO・GEO・AIO のデータの輪（2026-11-24）の PR5。作り手はマイグレーションを作れない（AGENTS.md 安全の3）ので、SQL の案と手順だけを置く。適用はオーナーの db-apply（番号は適用の時に `origin/master` の最大＋1）。

## 目的

新記事の段（索引された → 表示 → クリック）の最初の段を、公開の D+1・D+3・D+7 に確かめて残す。Google が選んだ canonical は、察知の判定木（`decideAction` の `canonicalOk`）の入力になる。書き手は `scripts/maintenance/inspect-new-articles.js`（窓口が実行）。

## SQL の案

```sql
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
```

- 'weekly'（主要ページの週次）は設計の「主要ページは週」に備えた値。この PR の CLI は D+1・D+3・D+7 だけを書く。
- 主キー (url, inspected_on)。同じ URL の D+1・D+3・D+7 は別の日の行になる。

## 適用の手順

1. オーナーが db-apply で SQL を適用する。
2. 確かめ（claude_ro の読み取り）: `has_table_privilege('anon', 'public.growth_url_inspection', 'SELECT')` と authenticated が false、service_role の INSERT が true、`relrowsecurity` が true。
3. 窓口が1件で試す: 記事の一覧の JSON に1件だけ書いて `node scripts/maintenance/inspect-new-articles.js --articles <file> --max 1`。行が入ったら広げる。

## 戻しの手順

`DROP TABLE public.growth_url_inspection;`（他の表から参照されない）。

## 容量

1記事あたり最大3行（D+1・D+3・D+7）。1日の公開が数本なので小さい（実測は未検証）。見積りは `SELECT pg_total_relation_size('public.growth_url_inspection'), count(*) FROM growth_url_inspection;` で出す。保持は決めない（小さいため。増えたら見直す）。

## 未決・範囲外

- URL Inspection API の応答の形・上限（1日2,000件・毎分600件）・必要なスコープは記憶による（未検証）。窓口が `--dry-run`（DB に書かない）で1件取って確かめる。
- 記事の一覧（url と公開日）の作り方は窓口の持ち物。
