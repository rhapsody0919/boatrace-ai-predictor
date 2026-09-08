-- 企画型（キャンペーン型）SNS投稿パイプライン スキーマ新設（2026-09-08）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: 既存のsns-hub（sns_topics/sns_topic_targets、docs/design/sns-topic-gate/）は
-- 「型」ベースの単発ネタ→マルチチャネル横展開モデルで、複数日にまたがる連続的な
-- 「企画」を扱えない。docs/design/sns-hub-campaign-pipeline/spec.md参照。
--
-- 既存テーブルへの影響: sns_topicsにnullable列を1つ追加するのみ。
-- 既存の型ベースパイプラインの挙動には一切変更を加えない。

-- ============================================================================
-- 1. sns_campaigns（企画のメタデータ）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,                -- 企画名（例: 「龍神レーダーのAIに900円を託してみた」）
    purpose TEXT,                              -- 企画の目的・コアフック（自由記述）
    persona TEXT,                              -- 想定ペルソナ（自由記述）
    tone_spec JSONB DEFAULT '{}',              -- トーン・構成・尺等の企画専用仕様（自由記述、型のように固定しない）
    start_date DATE NOT NULL,
    duration_days INTEGER NOT NULL,            -- 企画期間（暦日数）。start_date + duration_daysが終了日
    target_channels VARCHAR(20)[] NOT NULL,    -- 対象チャネル配列（'x'|'tiktok'|'youtube'|'blog'|'note'）
    tiktok_decision_note TEXT,                 -- TikTok投稿可否の人間判断メモ（機械判定はしない、要件9）
    selection_criteria JSONB NOT NULL,         -- 対象レース選定条件（例: {"metric": "volatilityPercentile", "operator": ">=", "value": 0.99}）
    purchase_amount_yen INTEGER,               -- 1エントリあたりのシミュレーション購入額（パイロットは900円）
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'cancelled'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sns_campaigns_status ON sns_campaigns(status);

ALTER TABLE sns_campaigns ENABLE ROW LEVEL SECURITY;
-- ADR 0021踏襲: public向けread/writeポリシーは設定しない

-- ============================================================================
-- 2. sns_campaign_entries（企画内の1エントリ＝対象レース1件の実績記録）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_campaign_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES sns_campaigns(id) ON DELETE CASCADE,
    race_id VARCHAR(50) NOT NULL REFERENCES races(race_id),
    selection_metric_value NUMERIC,            -- 選定時の指標値（例: volatilityPercentile=0.99）

    ai_prompt_text TEXT NOT NULL,              -- useAiCopyText.js相当で組み立てたプロンプト全文
    ai_model_name VARCHAR(50) NOT NULL,        -- 回答したAIモデル名（例: 'claude-sonnet-5'、開示必須）
    ai_picks JSONB NOT NULL,                   -- AIが提案した三連単3点（例: [{"combination": "1-2-3"}, ...]）

    purchase_amount_yen INTEGER NOT NULL,      -- このエントリでの購入シミュレーション額
    actual_result VARCHAR(20),                 -- 三連単の実際の着順結果（例: '2-1-4'）。レース未確定時はnull
    hit BOOLEAN,                               -- 3点のいずれかが的中したか。結果未確定時はnull
    payout_yen INTEGER DEFAULT 0,              -- 的中時の払戻額（不的中・未確定時は0）
    cumulative_net_yen INTEGER,                -- このエントリ時点での企画通算収支

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sns_campaign_entries_campaign ON sns_campaign_entries(campaign_id, created_at);

ALTER TABLE sns_campaign_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. sns_topics.campaign_id（企画由来のネタを既存トピックゲートに紐づける）
-- ============================================================================
ALTER TABLE sns_topics ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES sns_campaigns(id);
CREATE INDEX IF NOT EXISTS idx_sns_topics_campaign ON sns_topics(campaign_id) WHERE campaign_id IS NOT NULL;

COMMENT ON TABLE sns_campaigns IS '企画（キャンペーン）型SNS投稿のメタデータ。複数日にまたがる連続的な物語をチャネル横断で管理する（型=sns_topic_categoriesとは別軸、docs/design/sns-hub-campaign-pipeline/spec.md参照）';
COMMENT ON TABLE sns_campaign_entries IS '企画内の1エントリ（対象レース1件）の実績記録。生成Routineが前エントリを参照して継続性のある本文を書くための実データ源';
