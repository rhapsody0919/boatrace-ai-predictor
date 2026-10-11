-- 125: 生ファイルの台帳 raw_snapshots を新設する（期別成績 fan の定期取り込み）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 背景:
--   承認済みの方針（docs/design/scraping-vercel-consolidation/optimal-scraping-design.md §2.2）は、
--   「K・B・fan のファイルは小さく、再解析の起点なので保管する」。保管先の非公開バケット raw-pages は
--   085 の適用時に作成済みだが、台帳 raw_snapshots は設計だけで未作成だった。
--   期別成績（fan）の取り込みを Vercel Cron で自動化する（2026-10-03 ユーザー承認、scripts/lib/fanPeriodJob.js）
--   にあたり、最初の利用者として新設する。K・B も後から同じ台帳に載せられる。
--
-- 列は設計（§2.2）どおり。1行＝1つの生ファイル。同じ内容（sha256）の再取得は二重に記録しない。
--   page_type      'fan' 等
--   key            fan は 'fan2610'
--   captured_at    取得時刻
--   storage_path   raw-pages バケット内の生のパス（署名付きURLは入れない。読み取り側が都度署名する）
--   bytes / sha256 生ファイルの大きさと内容ハッシュ
--   parser_version 解析した形式（fan は 'fan-period/v1'）
--   run            取得した実行（共通ラッパの worker）
-- 容量: fan は年2ファイル×約180KB で、行数も容量もほぼ0。
-- 権限: 書き込みは service_role のみ。画面からは読まない（RLS有効・ポリシーなし・匿名の権限なし）。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   新規テーブルの作成のみで、既存の表・読み手には触れない。コードのマージより先でも後でもよい
--   （未適用の間は、取り込みは続き、生ファイルの保管だけが警告になる）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'raw_snapshots' AND relkind = 'r';
--   → true
--   SELECT has_table_privilege('anon', 'public.raw_snapshots', 'SELECT');
--   → false
--
-- 元に戻す（台帳の行が消える。Storage に置いた生ファイルは残る）:
--   DROP TABLE IF EXISTS raw_snapshots;

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS raw_snapshots (
  id             bigserial PRIMARY KEY,
  page_type      text NOT NULL,
  key            text NOT NULL,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  storage_path   text NOT NULL,
  bytes          integer NOT NULL,
  sha256         text NOT NULL,
  parser_version text,
  run            text,
  CONSTRAINT raw_snapshots_page_key_sha256_key UNIQUE (page_type, key, sha256)
);

COMMENT ON TABLE raw_snapshots IS
  '取得した生ファイルの台帳（optimal-scraping-design.md §2.2）。本体は Storage の非公開バケット raw-pages。最初の利用者は期別成績 fan（scripts/lib/fanPeriodJob.js）';

ALTER TABLE raw_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON raw_snapshots FROM anon, authenticated;

COMMIT;
