-- 096: オリジナル展示を匿名（画面）から読めるようにする（phase a / FR-4b）
--
-- 対応設計: docs/design/analysis-visualization-upgrade/plan.md §2.3 / spec.md FR-4b / docs/adr/0067-official-site-content-redisplay-policy.md
-- 対応Linearチケット: BOA-305 配下 / BOA-281
--
-- ⚠️ この案は「本番へ未適用」。**095より強い前提が必要**。
--
--   091（テーブル作成）は、匿名・authenticated の権限を意図的に全て剥奪している。ADR-0067の
--   BOATCASTの追記に「取得した値は**保存のみ**とする。匿名（画面）から読めるようにしない。
--   値を画面に再表示する場合は、本ADRの他の追記（ピットレポート）と同様に、別途、**ユーザーの承認と、
--   出典の表記の設計が要る**」と明記されているため。
--
--   したがってこのファイルの適用前に、次の2つが揃っている必要がある。
--     1. 画面側の出典表記の実装（出典: BOATCAST／取得時刻／再配布しない旨）とモック承認
--     2. ADR-0067 への追記（承認の記録）。ピットレポートの086と同じ手続き
--
-- 対象:
--   race_original_exhibition         レース単位のヘッダ（取得時刻・会場・レース）
--   race_original_exhibition_values  艇ごとの一周・まわり足・直線タイム等（会場により項目が異なる）
--
-- 適用手順: 次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--
-- 適用後の確認（読み取りのみ）:
--   SELECT c.relname, has_table_privilege('anon', c.oid, 'SELECT') AS sel,
--          has_table_privilege('anon', c.oid, 'INSERT') AS ins
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname='public' AND c.relname LIKE 'race_original_exhibition%';
--   → 2行とも sel=true, ins=false
--
-- ロールバック（公式・会場から要請を受けた場合はこれだけで表示を止められる。データは消えない）:
--   DROP POLICY IF EXISTS race_original_exhibition_public_read        ON public.race_original_exhibition;
--   DROP POLICY IF EXISTS race_original_exhibition_values_public_read ON public.race_original_exhibition_values;
--   REVOKE SELECT ON public.race_original_exhibition, public.race_original_exhibition_values
--     FROM anon, authenticated;
--
-- 設計上の要点:
--   * 公開するのは SELECT のみ。書き込みは service_role のみ（BOA-370のRLS規律）
--   * 画面は、権限エラーを「セクションを出さない」として扱う（ピットレポートと同じ。適用順序の保険）
--   * 2026-09-23時点のデータは14レース分（216値）のみで、2026-09-22以降。過去分のバックフィルは未実施

SET LOCAL lock_timeout = '10s';

DROP POLICY IF EXISTS race_original_exhibition_public_read ON public.race_original_exhibition;
CREATE POLICY race_original_exhibition_public_read ON public.race_original_exhibition
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS race_original_exhibition_values_public_read ON public.race_original_exhibition_values;
CREATE POLICY race_original_exhibition_values_public_read ON public.race_original_exhibition_values
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.race_original_exhibition        TO anon, authenticated;
GRANT SELECT ON public.race_original_exhibition_values TO anon, authenticated;
