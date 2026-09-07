-- sns_topic_categories「humor」行の新設（2026-09-07）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: 「ゆるユーモア型」は当初動画フォーマット（Remotion、通知風UI/検索候補型/
-- デッドパン即答型）として3回設計し直したが、選手個人の成績データを扱う動画の
-- 誇張演出（インパクトエフェクト・突き放し文言）が「煽りに見える」「選手への
-- リスペクトがない」とユーザーに却下された。動画は諦め、選手個人データに一切
-- 触れない題材（競技ルール・観戦文化のあるあるネタ）の文字投稿のみに方針転換。
--
-- 日次・Xのみで運用する（`daily-auto`型、trigger_mode='auto'、
-- requires_topic_approval=false）。sns-hub管理画面「🌅日次ネタ自動提案」の
-- 型指定ドロップダウンから手動発火できる。運用手順は
-- docs/operation/sns-topic-proposer-daily-auto.mdに追記済み。

INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active, notes) VALUES
    ('humor', 'ゆるユーモア型',
        (SELECT id FROM sns_content_types WHERE type_key = 'daily-auto'),
        'humor', true,
        '選手個人の成績データには触れない、競技ルール・観戦文化のあるあるネタ（scripts/lib/contentTopics/humorSource.jsの固定ネタバンクをクールダウン方式でローテーション）。日次・Xのみ。動画は作らずテキスト投稿のみ（2026-09-07決定、経緯はdocs/operation/sns-topic-proposer-daily-auto.md参照）')
ON CONFLICT (category_key) DO NOTHING;

-- チャネル設定: Xのみ既定ON、他は既定OFF（あとでsns-hub管理画面から変更可能）
INSERT INTO sns_topic_category_channels (category_id, platform, enabled)
SELECT c.id, p.platform, (p.platform = 'x')
FROM sns_topic_categories c
CROSS JOIN (VALUES ('blog'), ('note'), ('x'), ('tiktok'), ('youtube')) AS p(platform)
WHERE c.category_key = 'humor'
ON CONFLICT (category_id, platform) DO NOTHING;
