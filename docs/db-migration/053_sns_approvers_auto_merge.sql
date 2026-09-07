-- sns_approvers「自動承認（品質チェック合格）」行の新設（2026-09-07）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: ブログ記事の下書き承認を、機械的な品質チェック（文字数・サムネ画像位置・
-- 廃止済み用語・禁止用語・メタ情報の文字数・画像alt・内部リンク・FAQセクション）
-- が全て合格した場合に限り人間の承認を経ずに自動マージする運用を導入した
-- （scripts/maintenance/finalize-blog-draft.js）。sns_approvers.approver_idは
-- 自由入力不可の選択式（要件12）のため、「誰が承認したか」の履歴に自動承認を
-- 表すマスタ行を1件追加する。人間の承認と区別できるよう表示名を明確にする。

INSERT INTO sns_approvers (display_name) VALUES ('自動承認（品質チェック合格）')
ON CONFLICT (display_name) DO NOTHING;
