-- sns_topic_categories「feature-intro」行の転用（2026-09-05）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: category_key='feature-intro'は当初「新機能紹介型（一覧アピール型）」の
-- 未接続プレースホルダーとして登録され、source_id='new-feature'（フローA、
-- content-multi-channel-pipelineの新機能告知用ソース）を指していた。
-- ユーザーとの対話で「分析ツール(/winning-technique)の既存17タブを紹介する型」
-- （'一覧アピール型'・フローAの新機能告知とは別の第3の概念）が必要と判明し、
-- 既に実装済みだが現行アーキテクチャに未接続だったscripts/lib/contentTopics/
-- dataInsightSource.js（17タブローテーション、id='data-insight'）を
-- この行に繋ぎ直す形で転用することにした（一覧アピール型・フローA新機能告知は
-- 別概念のまま温存、BOA-239参照）。
--
-- 実行運用: docs/operation/sns-topic-proposer-weekly.mdが本カテゴリを
-- venue-characteristicと合わせて多カテゴリ対応する形で更新済み。

UPDATE sns_topic_categories
SET
    label = '機能紹介型',
    source_id = 'data-insight',
    content_type_id = (SELECT id FROM sns_content_types WHERE type_key = 'venue-feature'),
    notes = '分析ツール(/winning-technique)の各タブを紹介するネタ。dataInsightSource.jsの17タブローテーションを使用。venue-feature型(週次・要承認)と同じ運用（2026-09-05更新、以前はnew-feature/フローA用の未接続プレースホルダーだった）'
WHERE category_key = 'feature-intro';
