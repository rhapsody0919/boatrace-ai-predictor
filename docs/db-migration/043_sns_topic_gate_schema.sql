-- SNSコンテンツ ネタ生成ライン用スキーマ（docs/design/sns-topic-gate/）
-- Supabase Dashboard > SQL Editor で実行する。
-- 設計判断の背景は ADR 0036〜0038、docs/design/sns-topic-gate/spec.md 参照。
--
-- 既存の sns_drafts（035番）・sns_strategy_insights（039番）はそのまま再利用する。
-- 新規に作るのは「ネタ（トピック）」を承認の中心単位として管理する4テーブルのみ。

-- ============================================================================
-- 1. sns_content_types（ネタの型定義レジストリ。コードでなくデータとして持つ）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_content_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_key VARCHAR(50) NOT NULL UNIQUE,     -- 'venue-feature' | 'daily-auto' | 'race-time-critical' 等
    label VARCHAR(50) NOT NULL,               -- 管理画面表示用の日本語名（例: '週次'）
    cadence VARCHAR(20) NOT NULL,             -- 'weekly' | 'daily'
    requires_topic_approval BOOLEAN NOT NULL DEFAULT true,
    trigger_mode VARCHAR(20) NOT NULL,        -- 'poll'（cron定期ポーリング）| 'auto'（承認なし自動生成）| 'manual'（人間手動起動）
    active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sns_content_types ENABLE ROW LEVEL SECURITY;
-- ADR 0021踏襲: public向けread/writeポリシーは設定しない

-- 初期データ（spec.md要件1）
INSERT INTO sns_content_types (type_key, label, cadence, requires_topic_approval, trigger_mode, notes) VALUES
    ('venue-feature', '週次', 'weekly', true, 'poll', '会場特性等。週次バッチでネタ提案→人間承認→承認後は12時間おきcronでポーリング生成'),
    ('daily-auto', '日次・一般', 'daily', false, 'auto', '選手の調子等。データ検知で自動生成、ネタ承認は省略（下書き承認のみ）'),
    ('race-time-critical', '日次・時間制約', 'daily', false, 'manual', 'イン崩れ注意度等。レース発走に間に合わせるため人間が都度手動起動、ネタ承認は省略')
ON CONFLICT (type_key) DO NOTHING;

-- ============================================================================
-- 2. sns_target_accounts（配信先アカウント/ペルソナのレジストリ）
--    2026-09-03合意: 複数アカウント/ペルソナ対応はスキーマ設計のみ今回対象。
--    アカウント管理UIは作らず、初期データは現行運用中の1プラットフォーム1アカウントのみ投入する。
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_target_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(20) NOT NULL,            -- 'blog' | 'note' | 'x' | 'tiktok' | 'youtube'（将来追加可能、ENUM制約なし）
    account_label VARCHAR(50) NOT NULL,       -- 表示名（例: '龍神レーダー公式'）
    brand_kit_ref TEXT,                       -- 声色・ブランドルールの参照先（今は自由記述、将来ファイルパス等を想定）
    credential_ref TEXT,                      -- 認証情報の参照先キー（今は未使用、列のみ用意）
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (platform, account_label)
);

ALTER TABLE sns_target_accounts ENABLE ROW LEVEL SECURITY;

-- 初期データ: 現行運用中の5チャネル分（1プラットフォーム1アカウント）
INSERT INTO sns_target_accounts (platform, account_label) VALUES
    ('blog', '龍神レーダー公式'),
    ('note', '龍神レーダー公式'),
    ('x', '龍神レーダー公式'),
    ('tiktok', '龍神レーダー公式'),
    ('youtube', '龍神レーダー公式')
ON CONFLICT (platform, account_label) DO NOTHING;

-- ============================================================================
-- 3. sns_topics（ネタ本体）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_text TEXT NOT NULL,
    content_type_id UUID NOT NULL REFERENCES sns_content_types(id),
    status VARCHAR(20) NOT NULL DEFAULT 'proposed', -- 'proposed' | 'approved' | 'rejected'
    source_insight_ids UUID[] DEFAULT '{}',   -- sns_strategy_insights.id の配列（提案根拠、既存Phase 2基盤を再利用）
    proposed_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approver_id UUID REFERENCES sns_approvers(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sns_topics_status ON sns_topics(status);
CREATE INDEX IF NOT EXISTS idx_sns_topics_content_type ON sns_topics(content_type_id);

ALTER TABLE sns_topics ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. sns_topic_targets（ネタ×配信先アカウントの中間テーブル。
--    チャネルラベル・claim/lock・進捗マトリクスの3役を1テーブルで兼ねる、ADR 0036参照）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_topic_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES sns_topics(id) ON DELETE CASCADE,
    target_account_id UUID NOT NULL REFERENCES sns_target_accounts(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'claimed' | 'generated' | 'skipped'
    claimed_by TEXT,                          -- claimしたパイプラインのroutine_run_id
    claimed_at TIMESTAMPTZ,
    skip_reason TEXT,                         -- 'skipped'の場合の理由（例: 'tiktok-gambling-policy'）
    draft_id UUID REFERENCES sns_drafts(id),  -- 生成完了後にsns_draftsへ紐付ける
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (topic_id, target_account_id)
);

CREATE INDEX IF NOT EXISTS idx_sns_topic_targets_topic ON sns_topic_targets(topic_id);
-- 各チャネル別パイプラインのポーリングクエリ（自分のtarget_account_id × status='pending'）用
CREATE INDEX IF NOT EXISTS idx_sns_topic_targets_account_status ON sns_topic_targets(target_account_id, status);

ALTER TABLE sns_topic_targets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE sns_content_types IS 'ネタの型定義（週次/日次・一般/日次・時間制約等）。PDCAで型を追加・廃止する際はコード変更でなくこのテーブルへの行追加/active更新で対応する（ADR不要、spec.md要件1）';
COMMENT ON TABLE sns_target_accounts IS 'ネタの配信先アカウント/ペルソナレジストリ。複数アカウント対応はスキーマのみ今回対象（2026-09-03合意）';
COMMENT ON TABLE sns_topics IS 'ネタ本体。チャネル別パイプラインが生成する下書き（sns_drafts）は、content_group_id=このテーブルのidという規約で紐づける（既存のcontent-multi-channel-pipelineの規約を踏襲）';
COMMENT ON TABLE sns_topic_targets IS 'ネタ×配信先アカウントの中間テーブル。チャネルラベル付け・claim/lock・進捗マトリクス表示を1テーブルで兼ねる（ADR 0036）';
