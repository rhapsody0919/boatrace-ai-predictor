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
--
-- 2026-09-03修正: 当初DO $$ ... $$ ブロック（PL/pgSQL）で変数経由で
-- content_type_idを解決していたが、SQL実行環境によってはブロックが
-- セミコロン区切りで分割されてしまい、"relation v_venue_feature does not
-- exist" のようなエラーになった。migration 043と同じ、変数を使わない
-- 素のSQL（サブクエリ）に書き直す。

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
-- 3. 初期データ: 型本体（content_type_idはtype_keyからのサブクエリで解決）
-- ============================================================================
INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active, notes) VALUES
    ('venue-characteristic', '会場特性',
        (SELECT id FROM sns_content_types WHERE type_key = 'venue-feature'),
        'venue-characteristic', true, NULL),
    ('racer-condition', '選手調子',
        (SELECT id FROM sns_content_types WHERE type_key = 'daily-auto'),
        'daily-result', true, NULL),
    ('motor-condition', 'モーター調子',
        (SELECT id FROM sns_content_types WHERE type_key = 'daily-auto'),
        'daily-result', true, NULL),
    ('volatility-index', 'イン崩れ注意度',
        (SELECT id FROM sns_content_types WHERE type_key = 'daily-auto'),
        'daily-result', true, NULL),
    ('payout-rate', '選手×艇番回収率型',
        (SELECT id FROM sns_content_types WHERE type_key = 'daily-auto'),
        'daily-result', true, NULL),
    ('outcome-distribution', '出目分布型',
        (SELECT id FROM sns_content_types WHERE type_key = 'daily-auto'),
        'daily-result', true, NULL),
    ('prediction-accuracy', '展開予想的中（答え合わせ型）',
        (SELECT id FROM sns_content_types WHERE type_key = 'race-time-critical'),
        NULL, true,
        'topic-gateにはまだ未接続。既存のsns-hub-content-generation（sns-video-producer-prompt.md）が担当'),
    ('prediction-hook', '予想数値フック型',
        (SELECT id FROM sns_content_types WHERE type_key = 'race-time-critical'),
        NULL, true,
        'topic-gateにはまだ未接続。既存のsns-hub-content-generationが担当'),
    ('feature-intro', '機能紹介型（一覧アピール型）',
        NULL, 'new-feature', true,
        'topic-gateにはまだ未接続。フローA（新機能マルチチャネル展開）のcontent-multi-channel-pipelineが担当'),
    ('trivia', '豆知識型',
        NULL, NULL, true, '未実装。提案元モジュール未着手'),
    ('confrontation-hype', '対決煽り型',
        NULL, NULL, false,
        'TikTokガイドライン違反で削除・異議申し立ても却下済み（2026-09-01）。新規制作禁止')
ON CONFLICT (category_key) DO NOTHING;

-- ============================================================================
-- 4. 初期データ: チャネル設定（blog/note/x/youtubeは全型でON、TikTokのみ型ごとに設定）
-- ============================================================================
INSERT INTO sns_topic_category_channels (category_id, platform, enabled)
SELECT c.id, p.platform, true
FROM sns_topic_categories c
CROSS JOIN (VALUES ('blog'), ('note'), ('x'), ('youtube')) AS p(platform)
ON CONFLICT (category_id, platform) DO NOTHING;

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
