# 今日のレースのスマホ個別承認（依頼6）

依頼5基準。実送信は未接続、初期停止設定を維持。主要情報は一つのスクロール画面に並べ、チャネル切替タブで隠さない。

## read / approve

認証済み `GET /api/admin/sns-hub/mobile-approval` はJST今日の `source_data.race_id`（YYYY-MM-DD-会場-レース）を持つgroupとレース名を返す。作成日をレース日と推測しない。DBで対象日と非null groupを絞り、group IDとrace_idだけを500件ずつ取得。最大2000行＋超過検査1行、最大5要求。今日0件なら最初の要求で終了し、過去の根拠JSONは取得しない。超過時は部分一覧を返さず503。同じレースの既存content_group_idを使い、複数groupは別版として残す。

`GET ?group=UUID` は一つのSQL readで日本語X/YouTubeのdraft・source_data（claims/manifest/QA/release）・jobをまとめて取得し、動画/画像の署名URLと版hash、保留理由を返す。最大20下書き。SQLで21件のIDまで数え、超過は媒体hash計算前に拒否。APIは媒体hash/署名を直列で行い、既存の1媒体32MiB上限を維持する。これらは安全側の実装上限であり、正式な運用件数・媒体総量・応答時間の確認はU05としてhq側に残る。source_dataの保存済み根拠を表示する。公開画面や本番データにこのレーンから接続して検証しない。

`POST ?group=UUID` の body はdraftId, approverId, versionHash, reviewSeconds。送信の呼び出しはしない。本人承認の既存RPCを行ロック内で使い、チャネル1件だけqueueへ承認する。scheduled_atは現行draftから取得、未設定なら依頼5の設定を使う。送信開始の許可を与えるUIではない。

版hash = SHA256(JSON.stringify([SQL revision, server snapshot]))。SQL revisionは本文・タイトル・タグ・媒体パス・source_data全体・risk・公開保留・bundle・状態・予定時刻。snapshotはサーバーが読み取った実媒体のSHA256/サイズを含む。ブラウザのhashは比較専用で信頼しない。POSTで再計算し、不一致・gate不合格は409。DBはロック後にrevision再比較する。同じパスの動画上書きはPOSTと送信直前の実バイトhash検査で止める。媒体取得後の上書きはStorage/DBの同一transactionにはできず、送信前検査が最後の防壁。

## 不足情報の保留

既存bundle v0の恒久公開保留は解除しない。QA.pass と numeric_claims_match がtrue、L0なし、risk_flags=[]、正式公開証拠、claimsとmanifest対応、主張ごとのcount（正整数）/scope（文字列）、出典hash確認・stage・取得時点・原文URLが必要。YouTubeは動画と画面プレビューが必要。期限不明/失効も保留。

新しい補足フィールドは `source_data.bundle.claims[].count/scope`、`source_data.release_evidence.{status:"released",url:HTTPS}`。入力済みフラグからv0を公開可能にする変更はない。上流の正式公開証拠の生成・確認責任とフィールド名は取り込み側で確認する。この依頼では生成や公開確認の仕組みを作らない。

SQL140は135/137/139に依存。レビュー時間・承認者・確認版を専用RLSテーブルに保存。修正理由は既存redoDraft API/履歴を再利用し、修正操作は承認hashを送らず承認を付けない。risk単独変更でも承認を無効化するtriggerを追加。既存一般承認UI/APIをこの画面へ統一する変更は今回含めない。

## 2026-10-08 点検修正（依頼6b）

スマホ操作開始時に親の操作epochを同期更新し、既存DraftCardの手動X投稿を閉じる。操作前poll・一覧の遅い応答は捨てる。成功・POST応答喪失・409・後続GET失敗の全経路で親一覧を再取得し、操作終了後の新しいX状態取得でのみunknownを解除する。修正依頼のroutine.fired=falseは保存成功と起動失敗を区別した警告として、後続GETが失敗しても残す。

X添付はsnapshotと同じ動画優先/なければcover画像を表示する。添付が必要な投稿はURL欠落・読込前・読込errorで承認不可。loadeddata/loadで読込済みとなる。版hash/下書きID/URLごとに確認状態を分離し、別版へ流用しない。X本文のみはプレビュー不要。ブラウザの実再生・人の確認時間・配信媒体とhashの同一性はU01/U04のまま。最新139（ccc4a73）を前提とし、140を改番しない。

## 検証

node scripts/maintenance/verify-sns-mobile-approval.js scripts/maintenance/verify-sns-mobile-groups.js scripts/maintenance/verify-sns-mobile-api.js scripts/maintenance/verify-sns-deadline-queue.js scripts/maintenance/verify-sns-x-send.js scripts/maintenance/verify-sns-mobile-dom.js

JSDOM試験は実コンポーネントの状態遷移を検証するが、375pxの可読性/動画再生の代替ではない。devDependenciesのjsdomが必要。旧実装の反例を再実行する場合: `SNS_MOBILE_TEST_BASELINE=3ed68cb node --test scripts/maintenance/verify-sns-mobile-dom.js scripts/maintenance/verify-sns-mobile-api.js`（UI/APIソースだけを指定コミットからbundleし、鍵・envは読まない）。

npx playwright test --config playwright.mobile-approval.config.js

専用ViteはenvDir=false/publicDir=false。本番/外部通信をrouteで遮断。375px、明暗、QA欠落の保留状態を確認し、out/reports/2026-10-07-task-06-qa/mobile-{light,dark}.pngを出す。macOS sandboxがChromiumを起動拒否した場合は未検証であり、スクリーンショット成功と扱わない。
