-- 選手ニュース自動収集の要確認リスト（保留中候補）を、git管理のJSONファイルからDBの表へ移す
-- （データ取得基盤のVercel一本化 T4b-15-1、設計判断(i)。docs/design/scraping-vercel-consolidation/plan.md §11）
--
-- 背景: 選手の特定に失敗した候補（登録番号がDBに無い・支部が一致しない・見出しの形式が変わった等）は、
-- 自動投入せず、要確認リストに記録して、セッション開始時にユーザーへ提示する運用（ADR-0024）。
-- 従来は data/analysis/racer-news-pending-review/pending.json に書いて git push していた
-- （GitHub Actions の collect-racer-news.yml）。Vercel Function は、ファイルシステム・git push に頼れないため、
-- DBの表に移す。読み手（session-start-check.js・.claude/rules/content-ops.md フローC-4）も、この表を読む。
--
-- 対応: docs/design/scraping-vercel-consolidation/tasks.md T4b-15-1 / plan.md §4.1（B5）
--
-- 適用手順（ユーザーの承認後。適用前にコードをマージしても、Vercel の共通ラッパは racer_news ジョブを off の間
-- 何もしない。適用前に live へ切り替えない）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--
-- ロールバック（必要な場合のみ。要確認リストの未処理の項目が失われるため、先に内容を確認する）:
--   DROP TABLE IF EXISTS racer_news_pending;
--
-- 匿名（anon・authenticated）には、何も付与しない: 要確認の候補は、内部の運用データで、画面に出さない。
-- 書き込み・読み取りは service_role（RLS迂回）のみ（取得ジョブ・session-start-check.js・承認用スクリプト）。

CREATE TABLE IF NOT EXISTS racer_news_pending (
  -- 候補の識別子。従来の pending.json と同じ（例: "grade-announcement-{記事のURL}"）。冪等な追加の一意キー
  id TEXT PRIMARY KEY,
  -- 候補の取得元（現状は "grade-announcement" のみ。公式ニュースのレーサーデータカテゴリ）
  source TEXT NOT NULL,
  -- 自動投入しなかった理由（選手を特定できない・見出しの形式が変わった 等）
  reason TEXT NOT NULL,
  -- 候補の内容（racerId・branch・achievement・title 等。取得元ごとに形が違うため JSONB）
  candidate JSONB NOT NULL,
  -- 記事のURL。処理済みかの判定（racer_news.source_url との突き合わせ・二重の追加の防止）に使う
  source_url TEXT NOT NULL,
  source_name TEXT,
  -- 検出した日（JST）
  detected_at DATE NOT NULL,
  -- pending: 未確認 / approved: 承認して racer_news へ投入済み / rejected: 却下
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 承認・却下した時刻（pending の間は NULL）
  resolved_at TIMESTAMPTZ
);

-- 処理済みか（source_url）の判定と、セッション開始時の未確認の一覧（status）
CREATE INDEX IF NOT EXISTS idx_racer_news_pending_source_url ON racer_news_pending (source_url);
CREATE INDEX IF NOT EXISTS idx_racer_news_pending_status ON racer_news_pending (status) WHERE status = 'pending';

ALTER TABLE racer_news_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE racer_news_pending FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE racer_news_pending IS '選手ニュース自動収集の要確認リスト（保留中候補）。data/analysis/racer-news-pending-review/pending.json の後継（T4b-15）';

-- 適用後の確認SQL（読み取りのみ）:
--   SELECT count(*) FROM racer_news_pending;                                    -- 0（適用直後）
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'racer_news_pending';   -- true
--   SELECT has_table_privilege('anon', 'racer_news_pending', 'SELECT');         -- false
