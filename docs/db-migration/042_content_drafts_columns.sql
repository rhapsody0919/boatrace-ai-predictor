-- content-multi-channel-pipeline用スキーマ追加
-- Supabase Dashboard > SQL Editor で実行する。
-- 設計判断の背景は ADR 0032 参照。
--
-- 既存のsns_draftsテーブル（035番マイグレーション）にblog/note下書き用の列を追加する。
-- platform列は元々ENUM制約なしで将来拡張を想定済みのため、
-- 'blog'/'note'という新しい値をそのまま使えばよく、この点の変更は不要。

ALTER TABLE sns_drafts
    ADD COLUMN IF NOT EXISTS title TEXT,
    -- ブログ/note下書きのタイトル。X/TikTok下書きでは常にNULL

    ADD COLUMN IF NOT EXISTS embed_video_url TEXT,
    -- note本文に画像の代わりにYouTube動画を埋め込む場合のURL（新機能ネタ用）
    -- 画像を使う場合はcover_image_path（既存列）を使う。両方NULLにはしない運用とする

    ADD COLUMN IF NOT EXISTS pr_url TEXT;
    -- ブログ下書きに対応するDraft PRのURL。承認時のマージ処理（api/admin/sns-hub/merge-blog-pr.js）が参照する
    -- note下書きでは常にNULL

COMMENT ON COLUMN sns_drafts.title IS 'blog/note下書きのタイトル（ADR 0032）';
COMMENT ON COLUMN sns_drafts.embed_video_url IS 'note本文に埋め込むYouTube動画URL（画像の代替、ADR 0032）';
COMMENT ON COLUMN sns_drafts.pr_url IS 'blog下書きに対応するDraft PRのURL（ADR 0032, 0034）';
