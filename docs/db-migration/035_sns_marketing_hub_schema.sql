-- SNSマーケティングハブ（docs/design/sns-marketing-hub/）Phase 1 用スキーマ
-- Supabase Dashboard > SQL Editor で実行する。
-- 設計判断の背景は ADR 0019〜0022 参照。
--
-- ⚠️ 既存の公開データ用テーブル（predictions等）と異なり、本スキーマは
--    anon/authenticatedロールへの公開ポリシーを一切設定しない（ADR 0021）。
--    フロントエンドは /api/admin/sns-hub/* 経由（service role key使用）でのみアクセスする。

-- ============================================================================
-- 1. sns_template_variants（型ごとのデザインバリアント・レジストリ）
--    デザイン改善・A/Bテスト対応（2026-08-27合意）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_template_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    format VARCHAR(50) NOT NULL,             -- 型（venue-ranking, mascot, live-prediction-hook等）
    variant_name VARCHAR(50) NOT NULL,       -- 「デザインA」等
    composition_name VARCHAR(100) NOT NULL,  -- Remotionコンポジション名（例: VenueRankingCM）
    active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (format, variant_name)
);

ALTER TABLE sns_template_variants ENABLE ROW LEVEL SECURITY;
-- ADR 0021: public向けread/writeポリシーは意図的に設定しない

-- ============================================================================
-- 2. sns_approvers（承認者マスタ、タップ選択式。自由入力は不可、要件12）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_approvers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(50) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sns_approvers ENABLE ROW LEVEL SECURITY;

-- 初期は「本人」のみ。将来アルバイト等を追加する際は行を追加するだけでよい
INSERT INTO sns_approvers (display_name) VALUES ('本人') ON CONFLICT (display_name) DO NOTHING;

-- ============================================================================
-- 3. sns_drafts（下書き本体）
--    1レコード = 1コンテンツ×1言語×1プラットフォーム（決め打ちカラムにしない、2026-08-27合意）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    content_group_id UUID NOT NULL,          -- 同一アイデアから派生した言語/PF違いをまとめるID
    parent_draft_id UUID REFERENCES sns_drafts(id), -- 修正・作り直し前の旧バージョン（履歴保持、要件14）

    format VARCHAR(50) NOT NULL,
    template_variant_id UUID REFERENCES sns_template_variants(id),

    language VARCHAR(10) NOT NULL,           -- 'ja' | 'en'（将来 'zh-CN' 等を追加可能、Enum制約はかけない）
    platform VARCHAR(20) NOT NULL,           -- 'x' | 'tiktok' | 'youtube'（将来追加可能）

    status VARCHAR(20) NOT NULL DEFAULT 'pending_review',
    -- pending_review / revision_requested / approved / ready_to_post / posted / archived

    video_storage_path TEXT,                 -- Supabase Storage上のパス
    video_tier VARCHAR(20) NOT NULL DEFAULT 'original', -- 'original' | 'compressed'（ADR 0022）
    cover_image_path TEXT,

    caption_text TEXT,
    hashtags TEXT[],
    background_text TEXT,                    -- 意図・ペルソナ・背景（承認者の確認材料）
    source_data JSONB,                       -- 生成に使ったレース等のデータ（再現性・監査用）

    risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb, -- 検出されたリスク警告一覧

    revision_reason_codes TEXT[],            -- 定型理由（複数選択可、要件3）
    revision_reason_freetext TEXT,

    approver_id UUID REFERENCES sns_approvers(id),
    approved_at TIMESTAMPTZ,

    scheduled_at TIMESTAMPTZ,                -- 投稿予定日時（人間が現地で設定した予定の記録用）
    posted_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,

    routine_run_id TEXT,                     -- どのRoutine実行が生成したか（トレーサビリティ）

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sns_drafts_status ON sns_drafts(status);
CREATE INDEX IF NOT EXISTS idx_sns_drafts_content_group ON sns_drafts(content_group_id);
CREATE INDEX IF NOT EXISTS idx_sns_drafts_posted_at ON sns_drafts(posted_at) WHERE status = 'posted';
CREATE INDEX IF NOT EXISTS idx_sns_drafts_archived_at ON sns_drafts(archived_at) WHERE status = 'archived';
-- 動画軽量化Routine（要件15）が「期限切れかつoriginal画質」を探すためのインデックス
CREATE INDEX IF NOT EXISTS idx_sns_drafts_video_tier ON sns_drafts(video_tier) WHERE video_tier = 'original';

ALTER TABLE sns_drafts ENABLE ROW LEVEL SECURITY;
-- ADR 0021: public向けread/writeポリシーは意図的に設定しない

-- ============================================================================
-- 4. sns_draft_metrics（エンゲージメント指標。手動入力/API取得を共通フォーマットで保持）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_draft_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id UUID NOT NULL REFERENCES sns_drafts(id) ON DELETE CASCADE,
    metric_name VARCHAR(30) NOT NULL,        -- 'views' | 'likes' | 'saves' | 'shares' | 'impressions' 等
    metric_value NUMERIC NOT NULL,
    source VARCHAR(10) NOT NULL DEFAULT 'manual', -- 'manual' | 'api'（Phase 2でYouTube/X APIが追加）
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sns_draft_metrics_draft ON sns_draft_metrics(draft_id);

ALTER TABLE sns_draft_metrics ENABLE ROW LEVEL SECURITY;
-- ADR 0021: public向けread/writeポリシーは意図的に設定しない
