# 今日のレースのスマホ個別承認（依頼6）

依頼5基準。実送信は未接続、初期停止設定を維持。主要情報は一つのスクロール画面に並べ、チャネル切替タブで隠さない。

## read / approve

認証済み `GET /api/admin/sns-hub/mobile-approval` はJST今日の `source_data.race_id`（YYYY-MM-DD-会場-レース）を持つgroupとレース名を返す。作成日をレース日と推測しない。500件ずつ全ページ取得。同じレースの既存content_group_idを使い、複数groupは別版として残す。

`GET ?group=UUID` は一つのSQL readで日本語X/YouTubeのdraft・source_data（claims/manifest/QA/release）・jobをまとめて取得し、各動画の署名URLと版hash、保留理由を返す。source_dataの保存済み根拠を表示する。公開画面や本番データにこのレーンから接続して検証しない。

`POST ?group=UUID` の body はdraftId, approverId, versionHash, reviewSeconds。送信の呼び出しはしない。本人承認の既存RPCを行ロック内で使い、チャネル1件だけqueueへ承認する。scheduled_atは現行draftから取得、未設定なら依頼5の設定を使う。送信開始の許可を与えるUIではない。

版hash = SHA256(JSON.stringify([SQL revision, server snapshot]))。SQL revisionは本文・タイトル・タグ・媒体パス・source_data全体・risk・公開保留・bundle・状態・予定時刻。snapshotはサーバーが読み取った実媒体のSHA256/サイズを含む。ブラウザのhashは比較専用で信頼しない。POSTで再計算し、不一致・gate不合格は409。DBはロック後にrevision再比較する。同じパスの動画上書きはPOSTと送信直前の実バイトhash検査で止める。媒体取得後の上書きはStorage/DBの同一transactionにはできず、送信前検査が最後の防壁。

## 不足情報の保留

既存bundle v0の恒久公開保留は解除しない。QA.pass と numeric_claims_match がtrue、L0なし、risk_flags=[]、正式公開証拠、claimsとmanifest対応、主張ごとのcount（正整数）/scope（文字列）、出典hash確認・stage・取得時点・原文URLが必要。YouTubeは動画と画面プレビューが必要。期限不明/失効も保留。

新しい補足フィールドは `source_data.bundle.claims[].count/scope`、`source_data.release_evidence.{status:"released",url:HTTPS}`。入力済みフラグからv0を公開可能にする変更はない。上流の正式公開証拠の生成・確認責任とフィールド名は取り込み側で確認する。この依頼では生成や公開確認の仕組みを作らない。

SQL140は135/137/139に依存。レビュー時間・承認者・確認版を専用RLSテーブルに保存。修正理由は既存redoDraft API/履歴を再利用し、修正操作は承認hashを送らず承認を付けない。risk単独変更でも承認を無効化するtriggerを追加。既存一般承認UI/APIをこの画面へ統一する変更は今回含めない。

## 検証

node --test scripts/tests/sns-mobile-approval.test.js scripts/tests/sns-deadline-queue.test.js scripts/tests/sns-x-send.test.js

npx playwright test --config playwright.mobile-approval.config.js

専用ViteはenvDir=false/publicDir=false。本番/外部通信をrouteで遮断。375px、明暗、QA欠落の保留状態を確認し、out/reports/2026-10-07-task-06-qa/mobile-{light,dark}.pngを出す。macOS sandboxがChromiumを起動拒否した場合は未検証であり、スクリーンショット成功と扱わない。
