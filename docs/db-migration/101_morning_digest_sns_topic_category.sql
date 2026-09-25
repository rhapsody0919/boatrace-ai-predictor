-- 101_morning_digest_sns_topic_category.sql
--
-- 「本日のデータ一覧」（BOA-402、/today）を SNS のネタゲート（sns-topic-gate）に
-- 新しいネタ種別として登録する。tasks.md T5-1 / plan.md §5。
--
-- 背景:
--   毎朝 JST 05:30 に api/cron/morning-digest.js が morning_digest_days / morning_digest_rows を
--   書いたあと、同じ実行が sns_topics に1件ネタを登録する。チャネル別パイプライン
--   （docs/operation/sns-pipeline-{x,blog,note,youtube}.md）が承認済みネタをポーリングし、
--   下書きを sns-hub の承認待ちに出す。下書きは morning_digest_rows **だけ**を読むため、
--   ページとSNSで数値が食い違わない（ADR-0070）。
--
-- 型（sns_content_types）に daily-auto（日次・一般、requires_topic_approval=false、
-- trigger_mode=auto）を使う理由:
--   毎朝出るネタでネタ単位の人間承認を挟むと、承認が遅れた日は朝のうちに下書きが出ない。
--   「ネタ承認は省略し、下書き承認だけ人間が行う」という daily-auto の運用がそのまま合う。
--   登録側（generate-morning-digest.js）は createTopicWithTargets({autoApprove: true}) で作る。
--
-- チャネル:
--   x / blog / note / youtube を enabled=true にする（tasks.md T5-2 の受入基準）。
--   tiktok は入れない。ギャンブル関連ポリシーとシャドウバンの経緯があり、
--   本ネタ（選手名・レース単位の数値）は TikTok 向きではないため。
--   ⚠️ **チャネルの増減はこのSQLを書き直さず、sns-hub 管理画面「ネタ型設定」から
--      enabled を切り替える**（sns_topic_category_channels はそのためのデータ駆動の表）。
--      毎朝4チャネルぶんの下書きが出る運用が重いと分かった場合も、同じ画面で減らせる。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で以下を実行する。DDLは無く、行のINSERTのみ
--   （新規テーブル・ビューなし＝RLSの追加規律は対象外）。
--
--   ⚠️ **コードのデプロイ（＝このPRのマージ）より先に適用する。** 行が無い状態で
--      日次バッチが走ると、ダイジェスト生成自体は成功するがネタ登録だけが失敗し、
--      report.alerts 経由で scrape-monitor が
--      `report:morning_digest:sns_topic_register_failed` を **毎朝 Slack に通知する**
--      （再通知間隔6時間）。適用するまで鳴り続ける。逆順にしても本番は壊れないが、
--      誤報が続くので順序を守ること。
--
--   ✅ **2026-09-25 に適用済み**（適用時のファイル名は `100_...`。同番号の
--      `100_data_health_entries_duplicates.sql`（BOA-423、PR #830）が先に master へ
--      入ったため 101 へ繰り下げた。DBに入った行の内容は変わらないので再実行は不要）。
--      適用後の実測: category_key='morning-digest' / active=true / 型 daily-auto /
--      有効チャネル {blog,note,x,youtube}。
--
-- 切り戻し:
--   UPDATE sns_topic_categories SET active = false WHERE category_key = 'morning-digest';
--   （active=false になると getEnabledChannelsForCategory が例外を投げ、登録側は
--    その回のネタ登録だけを諦める。ダイジェストの生成・ページ表示には影響しない）

BEGIN;

INSERT INTO sns_topic_categories (category_key, label, content_type_id, source_id, active, notes)
SELECT
  'morning-digest',
  '本日のデータ一覧',
  ct.id,
  NULL,  -- scripts/lib/contentTopics/ の提案モジュールは使わない。登録元は日次バッチ本体
  true,
  '毎朝の /today（BOA-402）。generate-morning-digest.js が morning_digest_* を書いた直後に'
  || ' sns_topics へ1件登録する（autoApprove）。下書きの材料は morning_digest_rows のみ（ADR-0070）。'
  || 'tiktok は対象外。設計: docs/design/morning-data-digest/plan.md §5'
  FROM sns_content_types ct
 WHERE ct.type_key = 'daily-auto'
ON CONFLICT (category_key) DO UPDATE
  SET label = EXCLUDED.label,
      content_type_id = EXCLUDED.content_type_id,
      active = true,
      notes = EXCLUDED.notes;

INSERT INTO sns_topic_category_channels (category_id, platform, enabled)
SELECT c.id, p.platform, true
  FROM sns_topic_categories c
  CROSS JOIN (VALUES ('x'), ('blog'), ('note'), ('youtube')) AS p(platform)
 WHERE c.category_key = 'morning-digest'
ON CONFLICT (category_id, platform) DO UPDATE
  SET enabled = EXCLUDED.enabled, updated_at = now();

COMMIT;

-- 適用後の確認:
--   SELECT c.category_key, c.label, c.active, ct.type_key,
--          array_agg(ch.platform ORDER BY ch.platform) FILTER (WHERE ch.enabled) AS enabled_channels
--     FROM sns_topic_categories c
--     JOIN sns_content_types ct ON ct.id = c.content_type_id
--     LEFT JOIN sns_topic_category_channels ch ON ch.category_id = c.id
--    WHERE c.category_key = 'morning-digest'
--    GROUP BY 1,2,3,4;
--   -- 期待: daily-auto / active=true / {blog,note,x,youtube}
