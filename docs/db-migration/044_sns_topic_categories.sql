-- SNSコンテンツ ネタの型（カテゴリ）別チャネルON/OFF設定
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: TikTokは他チャネルよりガイドライン（ギャンブル関連ポリシー）が厳しく、
-- 「型」（会場特性・選手調子・イン崩れ注意度・答え合わせ型等）によって
-- 投稿可否の実績が分かれている（docs/operation/tiktok-posting-operations.md）。
-- これまではchannelMatrix.js（コード）+ 各Routineのプロンプト文言（散在）で
-- 判断していたが、型が増えるたびにコード・複数ドキュメントを触る必要があり
-- 保守性が低かった。型×チャネルのON/OFFをデータとして持ち、sns-hub管理画面
-- から直接編集できるようにする（2026-09-03、ユーザー要望）。

-- ============================================================================
-- 1. sns_topic_categories（ネタの型/カテゴリのレジストリ）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_topic_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_key VARCHAR(50) NOT NULL UNIQUE,  -- 'venue-characteristic' | 'racer-condition' 等
    label VARCHAR(50) NOT NULL,                -- 管理画面表示用の日本語名（例: '会場特性'）
    content_type_id UUID REFERENCES sns_content_types(id), -- 対応する週次/日次・一般/日次・時間制約。
                                                -- まだトピック提案元が接続されていない型はNULL可
    source_id VARCHAR(50),                     -- 対応するscripts/lib/contentTopics/*のid。未接続ならNULL
    active BOOLEAN NOT NULL DEFAULT true,       -- falseはガイドライン違反等で使用禁止にした型
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sns_topic_categories_content_type ON sns_topic_categories(content_type_id);

ALTER TABLE sns_topic_categories ENABLE ROW LEVEL SECURITY;
-- ADR 0021踏襲: public向けread/writeポリシーは設定しない

-- ============================================================================
-- 2. sns_topic_category_channels（型×チャネルのON/OFF）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_topic_category_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES sns_topic_categories(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL,             -- 'blog' | 'note' | 'x' | 'tiktok' | 'youtube'
    enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (category_id, platform)
);

ALTER TABLE sns_topic_category_channels ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. 初期データ
-- ============================================================================

-- 型本体。content_type_idはtype_keyから引く（DO $$ ブロックで動的に解決）
DO $$
DECLARE
    v_venue_feature UUID;
    v_daily_auto UUID;
    v_race_time_critical UUID;
    v_category UUID;
BEGIN
    SELECT id INTO v_venue_feature FROM sns_content_types WHERE type_key = 'venue-feature';
    SELECT id INTO v_daily_auto FROM sns_content_types WHERE type_key = 'daily-auto';
    SELECT id INTO v_race_time_critical FROM sns_content_types WHERE type_key = 'race-time-critical';

    -- 会場特性
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active)
    VALUES ('venue-characteristic', '会場特性', v_venue_feature, 'venue-characteristic', true)
    ON CONFLICT (category_key) DO NOTHING;

    -- 選手調子
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active)
    VALUES ('racer-condition', '選手調子', v_daily_auto, 'daily-result', true)
    ON CONFLICT (category_key) DO NOTHING;

    -- モーター調子
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active)
    VALUES ('motor-condition', 'モーター調子', v_daily_auto, 'daily-result', true)
    ON CONFLICT (category_key) DO NOTHING;

    -- イン崩れ注意度
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active)
    VALUES ('volatility-index', 'イン崩れ注意度', v_daily_auto, 'daily-result', true)
    ON CONFLICT (category_key) DO NOTHING;

    -- 選手×艇番回収率型
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active)
    VALUES ('payout-rate', '選手×艇番回収率型', v_daily_auto, 'daily-result', true)
    ON CONFLICT (category_key) DO NOTHING;

    -- 出目分布型
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active)
    VALUES ('outcome-distribution', '出目分布型', v_daily_auto, 'daily-result', true)
    ON CONFLICT (category_key) DO NOTHING;

    -- 展開予想的中（答え合わせ型）: content_typeは存在するがsource_id未接続
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active, notes)
    VALUES ('prediction-accuracy', '展開予想的中（答え合わせ型）', v_race_time_critical, NULL, true,
            'topic-gateにはまだ未接続。既存のsns-hub-content-generation（sns-video-producer-prompt.md）が担当')
    ON CONFLICT (category_key) DO NOTHING;

    -- 予想数値フック型
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active, notes)
    VALUES ('prediction-hook', '予想数値フック型', v_race_time_critical, NULL, true,
            'topic-gateにはまだ未接続。既存のsns-hub-content-generationが担当')
    ON CONFLICT (category_key) DO NOTHING;

    -- 機能紹介型（一覧アピール型）: content_type未確定（新機能リリース起点のイベント駆動のため）
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active, notes)
    VALUES ('feature-intro', '機能紹介型（一覧アピール型）', NULL, 'new-feature', true,
            'topic-gateにはまだ未接続。フローA（新機能マルチチャネル展開）のcontent-multi-channel-pipelineが担当')
    ON CONFLICT (category_key) DO NOTHING;

    -- 豆知識型: 未実装
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active, notes)
    VALUES ('trivia', '豆知識型', NULL, NULL, true, '未実装。提案元モジュール未着手')
    ON CONFLICT (category_key) DO NOTHING;

    -- 対決煽り型: 廃止・使用禁止
    INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active, notes)
    VALUES ('confrontation-hype', '対決煽り型', NULL, NULL, false,
            'TikTokガイドライン違反で削除・異議申し立ても却下済み（2026-09-01）。新規制作禁止')
    ON CONFLICT (category_key) DO NOTHING;

    -- 各カテゴリのチャネル設定を投入するヘルパー（存在すれば何もしない）
    FOR v_category IN SELECT id FROM sns_topic_categories LOOP
        INSERT INTO sns_topic_category_channels (category_id, platform, enabled)
        SELECT v_category, platform, true
        FROM unnest(ARRAY['blog', 'note', 'x', 'youtube']) AS platform
        ON CONFLICT (category_id, platform) DO NOTHING;
    END LOOP;
END $$;

-- TikTokのみ型ごとに個別設定（上のループでblog/note/x/youtubeは全てtrueで入っている前提）
INSERT INTO sns_topic_category_channels (category_id, platform, enabled)
SELECT id, 'tiktok', true FROM sns_topic_categories WHERE category_key IN
    ('venue-characteristic', 'racer-condition', 'motor-condition', 'feature-intro', 'trivia')
ON CONFLICT (category_id, platform) DO UPDATE SET enabled = true;

INSERT INTO sns_topic_category_channels (category_id, platform, enabled)
SELECT id, 'tiktok', false FROM sns_topic_categories WHERE category_key IN
    ('volatility-index', 'payout-rate', 'outcome-distribution', 'prediction-accuracy', 'prediction-hook')
ON CONFLICT (category_id, platform) DO UPDATE SET enabled = false;

-- 対決煽り型は廃止のため全チャネルOFF
UPDATE sns_topic_category_channels SET enabled = false
WHERE category_id = (SELECT id FROM sns_topic_categories WHERE category_key = 'confrontation-hype');

COMMENT ON TABLE sns_topic_categories IS 'ネタの型（会場特性/選手調子/イン崩れ注意度等）のレジストリ。channelMatrix.js（コード）を補完し、型×チャネルの可否をデータとして持つ（2026-09-03、ユーザー要望）';
COMMENT ON TABLE sns_topic_category_channels IS '型×チャネルのON/OFF設定。sns-hub管理画面「ネタ型設定」から編集する';
