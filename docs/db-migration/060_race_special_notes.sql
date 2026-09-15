-- レース特記事項（事故・内規違反・減点／モーター・ボート変更／欠場・帰郷）テーブル
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 対応チケット: BOA-318（欠場・帰郷）/ BOA-319（モーター・ボート変更）/ BOA-320（事故・内規違反・減点）
-- 対応spec/plan: docs/design/scraping-full-coverage/spec.md FR-1 / plan.md FR-1
--
-- 背景: 公式サイト（boatrace.jp）の race/information ページ（会場・日付単位、
-- レース番号非依存）に「事故・内規違反・減点」「モーター・ボート変更」
-- 「欠場・帰郷」の3区分があり、現行のスクレイピングパイプラインは
-- 一切対象にしていない（2026-09-15調査）。
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
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_race_special_notes_dedup UNIQUE (venue_code, race_date, category, detail_text)
);

CREATE INDEX IF NOT EXISTS idx_race_special_notes_venue_date
    ON race_special_notes (venue_code, race_date);

CREATE INDEX IF NOT EXISTS idx_race_special_notes_racer
    ON race_special_notes (racer_id) WHERE racer_id IS NOT NULL;

COMMENT ON TABLE race_special_notes IS
    '公式サイトrace/informationページ由来。事故・内規違反・減点／モーター・ボート変更／欠場・帰郷の3区分（BOA-318/319/320）';
COMMENT ON COLUMN race_special_notes.structured_data IS
    '種別ごとの構造化データ。実データ確認済み（2026-09-15、jcd=12 hd=20171224）: accidentは{raceNo, violation, penaltyText, penaltyPoints}、equipment_changeは{equipmentType: "motor"|"boat", oldNumber, newNumber, effectiveFrom}、absenceは{type: "帰郷"|"欠場", subReason, rawText}。BOA-318記載の「途中帰郷」「即日帰郷」「即刻帰郷」の区別は実データで未確認（見つかり次第scripts/daily/scrape-race-information.jsのparseAbsenceRowを見直す）';
COMMENT ON CONSTRAINT uq_race_special_notes_dedup
    ON race_special_notes IS
    '同一会場・日付・区分・本文の重複挿入を防ぐ（10分間隔ポーリングで同じ通知を繰り返し取得するため）';

-- FR-1専用の構造変化監視（scripts/lib/venueMotorStats/driftHealth.jsのコアロジックを再利用）。
-- Vercel Function（api/cron/race-notices.js）は10分間隔で実行され、GitHub Actionsの
-- 日次ジョブと異なりファイルシステムへの永続化・git commitができないため、
-- 会場×日付単位の当日集計をSupabaseに保存する方式にする（scripts/daily/scrape-race-information.js参照）。
CREATE TABLE IF NOT EXISTS race_notices_health (
    venue_code SMALLINT NOT NULL,
    check_date DATE NOT NULL,
    had_success BOOLEAN NOT NULL DEFAULT false,
    last_reason TEXT,
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (venue_code, check_date)
);

COMMENT ON TABLE race_notices_health IS
    'race-notices Vercel Functionの会場×日付単位の当日集計（構造変化監視用）。had_success=trueはその日1回でもページ取得・パースに成功したことを示す。日次の構造変化チェック（scripts/maintenance/check-race-notices-drift.js）がこの表を古い順に読み、driftHealth.jsのupdateVenueHealth/findDriftAlertsで連続失敗日数を算出する';
