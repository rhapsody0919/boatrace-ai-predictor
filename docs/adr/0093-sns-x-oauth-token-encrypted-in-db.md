# ADR 0093: X の OAuth トークンは DB に暗号化して保存し、refresh を行ロックで1本にする

## ステータス
提案中（docs/design/sns-pdca-loop/plan.md §4）

## 背景
X の投稿・自分の投稿の指標の読み取りには OAuth 2.0（PKCE）のユーザー文脈のトークンが要る。access token は2時間で切れる。refresh token は `offline.access` を付けたときだけ出て、使うと新しいものが返り古いものは無効になる（公式ドキュメントに明記は無く、開発者フォーラムの報告。使い切り前提で設計する）。Vercel の環境変数は実行中に書き換えられない。DB に秘密を暗号化して保存している既存例は無い。

## 決定
- 154 の `sns_oauth_tokens` に、access token と refresh token を JSON にして AES-256-GCM で暗号化して保存する。鍵は Vercel の環境変数 `SNS_TOKEN_ENC_KEY`（32 バイト、base64）。`key_version` で鍵の入れ替えに備える
- 期限切れの5分前から refresh する。refresh は X の HTTP をはさむので1つのトランザクションにはできない。`lock_until`（90秒）と `locked_by` を条件付き UPDATE で取り、取れなかった呼び出しは待って読み直す。新しいトークンの保存は `WHERE locked_by=自分` の条件付き UPDATE にする（ロックが切れた後に古い保持者が書き戻すのを防ぐ）。IV と認証タグは別の列に持つ
- refresh に成功して保存に失敗すると refresh token を失う。この経路は Slack に「X の連携のやり直しが要る」と通知する
- refresh に失敗したら送信を `hold` にし、Slack に通知する。最初のトークンは、オーナーが管理画面の「X と連携する」から PKCE で取得する（コールバックで保存）

## 却下した選択肢
- **環境変数に refresh token を置く**: 使うたびに入れ替わるので、1回目の refresh で古い値になる
- **Supabase Vault（pgsodium）**: このプロジェクトで使った例が無く、service_role からの読み書きの権限設計と移行の手順が新しく要る。アプリ側の暗号化なら鍵は Vercel の環境変数だけで閉じる
- **OAuth 1.0a のユーザートークン（期限なし）**: 投稿と媒体のアップロードは使えるが、`non_public_metrics` の読み取りと PKCE の scope の管理を OAuth 2.0 に寄せる X の方針から外れる。旧スクリプトの鍵（`X_API_KEY` 等）は api 側に読むコードが無く、引き継ぐ利点も小さい

## 影響
- `SNS_TOKEN_ENC_KEY` を失うとトークンを読めなくなる（連携をやり直せば戻る）
- 2つの cron（送信・取り込み）が同じトークンを使うので、ロックの待ちが起きうる
