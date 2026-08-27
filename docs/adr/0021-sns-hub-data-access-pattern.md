# ADR 0021: SNSマーケティングハブのデータアクセス方式

## ステータス
採用

## 背景
管理画面（`/admin/sns-hub`）はVercel Edge Middlewareによる**Basic認証**で保護する（spec.md要件11）。しかし、boatAIの既存の`/api/*`配下のVercel FunctionsはSupabaseの**anon key**を使い、`Access-Control-Allow-Origin: *`で公開データを配信するパターンが標準（例: `api/accuracy/index.js`）。管理画面のフロントエンドが同じ流儀でSupabaseの新規テーブルにanon key＋RLSでアクセスする設計にすると、Basic認証はページの表示だけを守り、**Supabaseのテーブルへの直接アクセス（PostgRESTエンドポイント）はanon keyさえ分かれば誰でも素通りできてしまう**（anon keyはフロントエンドのJSバンドルに埋め込まれる性質上、公開情報として扱う前提のため）。下書き内容（未公開のSNS投稿案）や承認操作はこの経路で保護されるべき対象であり、この抜け道は許容できない。

## 決定
SNSハブ関連の新規テーブル（`sns_drafts`・`sns_draft_metrics`・`sns_template_variants`・`sns_approvers`）は、**RLSでanon/authenticatedロールへの一切のアクセスを許可しない**（デフォルト拒否）。フロントエンドは直接Supabaseを呼ばず、新設する`/api/admin/sns-hub/*`のVercel Functions経由でのみ読み書きする。これらのFunctionsは**service role key**をサーバーサイドで使い、Supabaseにアクセスする。`middleware.ts`のBasic認証は、`/admin/sns-hub`（ページ）と`/api/admin/sns-hub/*`（API）の両方を対象パスに含める。

## 却下した選択肢
- **既存パターン踏襲（anon key＋RLSでpublic read/write）**: 上記の通りBasic認証を素通りできる抜け道が残るため却下
- **Supabase Authによるユーザー単位の認証・RLS**: 各操作者に個別アカウントを発行し、RLSでロールベースのアクセス制御を行う方式。将来の複数人運用としては筋が良いが、認証方式は「Basic認証で良い」とユーザー判断で確定済み（spec.md）。Supabase Auth導入は認証基盤の新規構築コストが発生し、今回のスコープに対して過剰。却下（将来Phase 2以降で複数人運用が本格化し、個人単位の権限分離が必要になった際に再検討する）

## 影響
- `snsHubService.js`（フロントエンド側）は`fetch('/api/admin/sns-hub/...')`を呼ぶ薄いラッパーとして実装する。既存の`ruleMatchService.js`等（Supabaseクライアントを直接呼ぶ）とは実装パターンが異なる点に注意
- `/api/admin/sns-hub/*`のFunctionsは`runtime: "edge"`ではなくNode.js runtimeを使う可能性がある（service role keyの扱い・書き込み処理の複雑さ次第、実装時に確定）
- Routine自体もSupabaseへの書き込みが必要（下書き生成・状態更新）。RoutineはVercel Functionsを経由せず、Supabaseに直接書き込む（Routineの環境変数にservice role keyを設定する。未確定事項としてspec.mdに記録済み、Service Key露出リスクの扱いは実装時に確定する）
