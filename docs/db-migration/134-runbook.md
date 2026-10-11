# 134 の適用手順（BOA-430 思考アシスト: 会場の決まり手を期間ごとに数えた表）

マイグレーション 134（`venue_technique_period_stats` の新設）の本番適用の手順。新しい表を作るだけで、既存の表・データ・画面には触れない。

## 順序（入れ替えない）
1. ユーザー: SQL Editor で、下の SQL を上から順に実行する（手順1の確認 → 手順2の本体 → 手順3の確認）
2. Claude: 適用の確認（手順3の SELECT。読み取りなので Claude が実行してよい）。APPLIED.md の 134 の行を「適用済み」に直す
3. ユーザー: 書き手（`update-winning-technique-stats.js` に期間の集計を足す PR）をマージする
4. ユーザー: GitHub → Actions → update-winning-technique-stats → Run workflow（branch: master）を1回動かす
5. Claude: 約290行（24会場×2期間×約6決まり手）が入ったことを読み取りで確かめる

適用より先に書き手をマージすると、毎日のスクリプトの期間の集計の書き込みが「表が無い」で失敗する（既存の90日の集計は先に書くので影響しない）。
4 までの間、思考アシストは会場の決まり手の節を出さない（壊れない）。

## SQL（全文。手順1〜3と戻し方）
本体（手順2）は `docs/db-migration/134_venue_technique_period_stats.sql` と同じ。

```sql
-- ============================================================================
-- 134 の本番適用（BOA-430 思考アシスト: 会場の決まり手を期間ごとに数えた表）
-- 実行する人: ユーザー（Supabase Dashboard > SQL Editor）
-- 何をするか: 新しい表 venue_technique_period_stats を作るだけ。既存の表・データ・画面には触れない
-- 戻し方: 末尾の「戻す」の1文（適用直後は0行なので、消しても失うものは無い）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 手順1（実行前の確認・読み取りのみ）: まだ表が無いこと
--   期待値: already_exists が NULL（表が無い）
-- ---------------------------------------------------------------------------
SELECT to_regclass('public.venue_technique_period_stats') AS already_exists;
--   → already_exists が NULL なら手順2へ。NULL でなければ実行せず、オーケストレーターに知らせる

-- ---------------------------------------------------------------------------
-- 手順2（本体）: ここから COMMIT までを1回で実行する
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_technique_period_stats (
  venue_code         smallint NOT NULL CHECK (venue_code BETWEEN 1 AND 24),
  period_days        smallint NOT NULL CHECK (period_days IN (90, 365)),
  winning_technique  text NOT NULL CHECK (winning_technique <> ''),
  race_count         integer NOT NULL CHECK (race_count >= 0),
  total_races        integer NOT NULL CHECK (total_races > 0 AND total_races >= race_count),
  period_from        date NOT NULL,
  period_to          date NOT NULL CHECK (period_to >= period_from),
  last_updated       date NOT NULL,
  PRIMARY KEY (venue_code, period_days, winning_technique)
);

ALTER TABLE public.venue_technique_period_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS venue_technique_period_stats_select ON public.venue_technique_period_stats;
CREATE POLICY venue_technique_period_stats_select ON public.venue_technique_period_stats
  FOR SELECT TO anon, authenticated USING (true);

REVOKE ALL ON public.venue_technique_period_stats FROM anon, authenticated;
GRANT SELECT ON public.venue_technique_period_stats TO anon, authenticated;
GRANT ALL ON public.venue_technique_period_stats TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- 手順3（実行後の確認・読み取りのみ）: 4つとも期待値どおりか
-- ---------------------------------------------------------------------------
-- 3-1 RLS が有効             期待値: true
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_technique_period_stats'::regclass;

-- 3-2 ポリシーは読み取りだけ   期待値: 1行 venue_technique_period_stats_select | SELECT | {anon,authenticated}
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'venue_technique_period_stats';

-- 3-3 匿名の権限は SELECT だけ 期待値: anon・authenticated とも SELECT の2行だけ（INSERT・UPDATE・DELETE が無い）
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'venue_technique_period_stats' AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- 3-4 空の表                   期待値: 0
SELECT count(*) FROM public.venue_technique_period_stats;

-- ---------------------------------------------------------------------------
-- 適用の後: 表は0行のまま。書き手（毎日の update-winning-technique-stats.js に足す処理）の PR がマージされた後、
-- ワークフロー「update-winning-technique-stats」を1回手動で動かすと約290行が入る。それまで思考アシストは
-- 会場の決まり手の節を出さない（壊れない）。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 戻す（必要なときだけ）
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS public.venue_technique_period_stats;
```

## 期待値のまとめ
| 確認 | 期待値 |
|---|---|
| 手順1 `already_exists` | NULL |
| 3-1 `relrowsecurity` | true |
| 3-2 ポリシー | 1行 `venue_technique_period_stats_select` / SELECT / {anon,authenticated} |
| 3-3 匿名の権限 | anon・authenticated の SELECT の2行だけ |
| 3-4 行数 | 0 |
