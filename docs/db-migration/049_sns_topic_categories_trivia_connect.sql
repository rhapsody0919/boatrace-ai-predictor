-- sns_topic_categories「trivia」行の接続（2026-09-05）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: category_key='trivia'は当初「未実装。提案元モジュール未着手」の
-- プレースホルダーとしてのみ登録されていた（migration 044）。チャネル設定
-- （sns_topic_category_channels）はblog/note/x/youtube/tiktokすべて既にON
-- 済みだったが、content_type_id・source_idがNULLのままだったため週次バッチ
-- の候補選定ロジック（venueCharacteristicSource.js/dataInsightSourceと同じ
-- ローテーション方式）から一切呼ばれない状態だった。新設した
-- scripts/lib/contentTopics/triviaSource.js（選手属性・級別×成績の関係等、
-- 15軸を長期クールダウン方式でローテーション）に接続し、venue-characteristic・
-- feature-introと合わせた3カテゴリ構成にする（migration 047と同じ「転用」
-- パターン）。
--
-- 実行運用: docs/operation/sns-topic-proposer-weekly.mdが3カテゴリの
-- 交互取り出しロジック・「2-C. 豆知識ネタの本文作成」に更新済み。

UPDATE sns_topic_categories
SET
    source_id = 'trivia',
    content_type_id = (SELECT id FROM sns_content_types WHERE type_key = 'venue-feature'),
    notes = '選手属性（級別・年代・体重・支部・経験年数・身長・出身地）や級別×成績の関係（スタート・フライング率・コース配置等）を紹介するネタ。triviaSource.jsの15軸を長期クールダウン（180日）方式でローテーション使用。venue-feature型（週次・要承認）と同じ運用（2026-09-05接続、2026-09-06に6軸から15軸へ拡張、以前は提案元モジュール未着手のプレースホルダーだった）'
WHERE category_key = 'trivia';
