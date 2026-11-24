> 未審査の案。適用の根拠にしない。

# growth_gsc_page_daily（date × page）の DB の案

設計: SEO・GEO・AIO のデータの輪（2026-11-24）の PR2。作り手はマイグレーションを作れない（AGENTS.md 安全の3）ので、この文書は SQL の案と手順だけを置く。適用はオーナーの db-apply（番号は適用の時に `origin/master` の最大＋1）。

## 目的

`growth_gsc_daily`（date × query × page）は、Search Console が匿名化した語を返さないので、ページの合計がサイトの実際より小さい。query を付けない date × page は匿名の語も含むので、記事の効き（ページの総クリック・表示）の物差しにする。

## SQL の案

```sql
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.growth_gsc_page_daily (
    date        DATE        NOT NULL,
    page        TEXT        NOT NULL,
    clicks      INTEGER     NOT NULL CHECK (clicks >= 0),
    impressions INTEGER     NOT NULL CHECK (impressions >= 0),
    position    REAL        NOT NULL CHECK (position >= 0),
    fetched_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (date, page)
);

COMMENT ON TABLE public.growth_gsc_page_daily IS
    'Search Console の検索（web）の date × page（query を付けない。匿名化された語も合計に入る）。dataState=all を取り直す。growth_gsc_daily（query 付き）より合計が大きい';
COMMENT ON COLUMN public.growth_gsc_page_daily.date IS 'Search Console の日付（太平洋時間 PT の日）。GA4・配備の JST の日と1日ずれうる';
COMMENT ON COLUMN public.growth_gsc_page_daily.page IS 'Search Console が返す URL のまま（www と無印が別の行になりうる）';
COMMENT ON COLUMN public.growth_gsc_page_daily.position IS 'その日の平均の掲載順位（Search Console の値のまま。ページ間の平均は表示で重みを付ける）';

-- ページごとの時系列（記事の効き）を引く
CREATE INDEX IF NOT EXISTS idx_growth_gsc_page_daily_page_date
    ON public.growth_gsc_page_daily (page, date);

-- 権限: 204（growth_gsc_daily）と同じ形。anon・authenticated には何も付けない
ALTER TABLE public.growth_gsc_page_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_gsc_page_daily FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_gsc_page_daily TO service_role;
GRANT SELECT ON public.growth_gsc_page_daily TO claude_ro;

COMMIT;
```

- 書き手: 補充 CLI `scripts/maintenance/backfill-gsc-daily.js`（窓口が実行）と、後の PR の日次の取得（service_role）。
- 読み手: claude_ro と service_role だけ。anon・authenticated に GRANT しない。view を作るときは `security_invoker` を付け、anon に REVOKE する（設計 7）。
- 主キー (date, page) が日付での読み・消しも支える。(page, date) の索引は記事ごとの時系列用（容量を見て不要なら外す）。

## 適用の手順

1. オーナーが db-apply で上の SQL を適用する（`docs/db-migration/` へ番号を付けて置く PR は、適用の時に別に作る）。
2. 確かめ（claude_ro の読み取り）:
   - `SELECT has_table_privilege('anon', 'public.growth_gsc_page_daily', 'SELECT');` が false（authenticated も同じ）
   - `SELECT has_table_privilege('service_role', 'public.growth_gsc_page_daily', 'INSERT');` が true
   - `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.growth_gsc_page_daily'::regclass;` が true
3. 窓口が補充を回す。先に1日だけ: `node scripts/maintenance/backfill-gsc-daily.js --tables page --from 2026-11-20 --to 2026-11-20`。行が入ったら範囲を広げる（既定は 2025-12-21〜PT の昨日。再実行しても二重にならない）。
4. 表が無い間は、CLI が `--tables page` を含む実行の最初に表の有無を見て、何を適用するかを書いて止まる。`--tables query` だけなら既存の表へ回せる。

## 戻しの手順

`DROP TABLE public.growth_gsc_page_daily;`（他の表・view から参照されない。参照する view を作った後は、その view を先に落とす）。

## 容量の見積りの出し方（見積もりが出るまで新しい表を増やさない）

作り手は本番を読めないので、窓口が claude_ro で次を出す。

```sql
-- 1) date × page の行数の下限: 既存の表の、1日あたりの distinct page（匿名の語だけのページは含まれない）
SELECT count(*) AS days, avg(n) AS pages_per_day, max(n) AS pages_max
FROM (SELECT date, count(DISTINCT page) AS n FROM growth_gsc_daily GROUP BY date) t;

-- 2) 1行あたりの大きさ: 既存の表の実測（page の長さが近いので代用になる）
SELECT pg_total_relation_size('public.growth_gsc_daily')::float / NULLIF(count(*), 0) AS bytes_per_row FROM growth_gsc_daily;
```

見積り = pages_per_day × 480 日 × bytes_per_row（480 日は 2025-12-21 から約16か月先までの目安。根拠なし）。補充の後は実測 `SELECT pg_total_relation_size('public.growth_gsc_page_daily')` と行数で置き換える。保持（古い日を消すか）は見積りと Supabase の容量を並べてから決める（未決）。

## 範囲外・未決

- 日次の取得（collect-gsc-daily.js）へ date × page を足すのは、表の適用と PR1（全日0行の見張り）のマージの後の別の PR。
- ADR-0066 との食い違い（GSC は Actions のまま。オーナーは Vercel Cron へ移すと決めた）は、移す PR で解く。
