-- レース特記事項（事故・内規違反・減点／モーター・ボート変更／欠場・帰郷）テーブル
-- 【草案】docs/design/scraping-full-coverage/plan.md FR-1 参照。
-- 実装時は現行mainブランチの最新マイグレーション番号を確認の上、採番し直すこと
-- （このplan.md作成時点のworktree内最新は058だが、並行セッションの作業により
-- 059以降が既に存在する可能性が高い）。
--
-- 背景: 公式サイト（boatrace.jp）の race/information ページ（会場・日付単位、
-- レース番号非依存）に「事故・内規違反・減点」「モーター・ボート変更」
-- 「欠場・帰郷」の3区分があり、現行のスクレイピングパイプラインは
-- 一切対象にしていない（BOA-318/319/320、2026-09-15調査）。
--
-- 3区分を1テーブルに統合する理由: 同一ページから1回のリクエストで
-- まとめて取得できるため（docs/design/scraping-full-coverage/plan.md参照）。

CREATE TABLE IF NOT EXISTS race_special_notes (
    id BIGSERIAL PRIMARY KEY,
    venue_code SMALLINT NOT NULL,
    race_date DATE NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('accident', 'equipment_change', 'absence')),
    racer_id INTEGER,
    boat_number SMALLINT,
    detail_text TEXT NOT NULL,
    structured_data JSONB,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_race_special_notes_venue_date
    ON race_special_notes (venue_code, race_date);

CREATE INDEX IF NOT EXISTS idx_race_special_notes_racer
    ON race_special_notes (racer_id) WHERE racer_id IS NOT NULL;

COMMENT ON TABLE race_special_notes IS
    '公式サイトrace/informationページ由来。事故・内規違反・減点／モーター・ボート変更／欠場・帰郷の3区分（BOA-318/319/320）';
COMMENT ON COLUMN race_special_notes.structured_data IS
    '種別ごとの構造化データ。例: absenceなら{"type": "途中帰郷"|"即日帰郷"|"即刻帰郷", "replacement_racer_id": ...}（実装時に確定）';
