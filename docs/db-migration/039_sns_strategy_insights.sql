-- SNSマーケティングハブ Phase 2（docs/design/sns-hub-phase2-pdca-loop/）用スキーマ追加
-- Supabase Dashboard > SQL Editor で実行する。
-- 設計判断の背景は ADR 0027〜0030 参照。
--
-- Phase 1（035_sns_marketing_hub_schema.sql）と同じ方針で、anon/authenticatedロールへの
-- 公開ポリシーは設定しない（ADR 0021を踏襲）。フロントエンドは /api/admin/sns-hub/* 経由のみ。

-- ============================================================================
-- 1. sns_strategy_insights（改善案の永続化。PDCAループのCheck→Act本体）
--    scope（platform/language/format）はいずれもnull可＝全体適用（spec.md要件1）
-- ============================================================================
CREATE TABLE IF NOT EXISTS sns_strategy_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    platform VARCHAR(20),                    -- null=全プラットフォーム対象。ENUM制約はかけない（将来youtube等追加のため）
    language VARCHAR(10),                    -- null=全言語対象
    format VARCHAR(50),                      -- null=全フォーマット対象

    insight_text TEXT NOT NULL,              -- 改善案の本文（次回生成プロンプトに注入される内容）
    evidence TEXT,                           -- 根拠・確信度の説明（定性的な自由記述。数値のconfidenceスコアは今回導入しない）
    source VARCHAR(20) NOT NULL,             -- 'own-metrics' | 'external-research'
    research_method VARCHAR(50),             -- 'x-growth-report-skill' | 'tiktok-growth-report-skill' | 'manual' 等、ENUM制約なし

    status VARCHAR(20) NOT NULL DEFAULT 'proposed', -- proposed / active / retired
    decision_note TEXT,                      -- 却下理由、またはsupersededの経緯（任意入力）
    superseded_by UUID REFERENCES sns_strategy_insights(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),    -- 提案日時
    activated_at TIMESTAMPTZ,                -- active昇格日時
    retired_at TIMESTAMPTZ                   -- 却下/失効日時
);

CREATE INDEX IF NOT EXISTS idx_sns_strategy_insights_status ON sns_strategy_insights(status);
CREATE INDEX IF NOT EXISTS idx_sns_strategy_insights_scope ON sns_strategy_insights(platform, language, format);

ALTER TABLE sns_strategy_insights ENABLE ROW LEVEL SECURITY;
-- ADR 0021の方針を踏襲: public向けread/writeポリシーは意図的に設定しない

-- ============================================================================
-- 2. sns_drafts への列追加（どのinsightを参照して生成されたかの機械可読な記録）
--    background_text（人間可読の生成メモ）とは別に、反映本数の集計をSQLで
--    確実に行うための配列カラム（screens.md「反映本数」表示のため、2026-08-29追加）
-- ============================================================================
ALTER TABLE sns_drafts
    ADD COLUMN IF NOT EXISTS referenced_insight_ids UUID[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sns_drafts_referenced_insights
    ON sns_drafts USING GIN (referenced_insight_ids);

-- ============================================================================
-- 3. sns_template_variants への列追加（新規コンポジション試作の監査、要件6）
--    新規テーブルは作らず既存レジストリを拡張する（ADR 0029）
-- ============================================================================
ALTER TABLE sns_template_variants
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(10) NOT NULL DEFAULT 'human';
    -- 'human' | 'routine'。既存行はすべて人間が作成したものなのでデフォルト'human'のまま問題ない
