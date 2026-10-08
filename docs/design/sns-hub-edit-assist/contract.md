# 編集補助・読みやすさ点検（依頼8）

依頼6のスマホ承認画面に助言を追加する。本文・risk/QA・公開保留・承認・送信設定は変更しない。指摘の有無・保存障害・未判断・無視を承認条件に追加しない。既存のQA/期限等のgateは保持する。

## 機械点検

`inspectDraft` は依頼7bの共通matcherと現行risk-rules.jsonを使う。本文・タイトル・scene内の文字を媒体別に照合し、hashtagsも同じmatcherで点検する。タグ欄に関するオーナー承認例外はrisk-rules.jsonの設定で判定し、独自に全タグを除外しない。長い文は80文字を目安に助言。Xは既存twitter-textで本文とタグの加重文字数280を点検する。

YYYY-MM-DDとHH:mmの候補を点検し、暦上の不正な日付/時刻・桁/区切りの不統一を指摘する。日本語の日付表記や相対日付の意味は判定しない。

bundle.claimsは保存された原文JSONをmanifest.storage_pathから読み、manifest.sha256を実バイトと照合してからpathの値を比較する。公開URLにアクセスしない。原文の欠落・取得失敗・hash不一致は未照合の指摘にする（正しいと推測しない）。原文は1MiBまで点検する。本文の数値はclaims.label直後に明示された数値だけ照合する。単位変換や丸め・自由文の意味理解はしない。label、件数count、対象範囲scopeの欠落も助言する。

選手名の敬称はsource_data.racersまたはbundle.source_data.racersのnameで明示された名前のみ対象。「選手」「さん」「氏」が直後になければ確認を促す。自由文から人名を推測しない。一覧等の適切な敬称省略はオーナーが無視できる。

## 保存・判断

SQL141は140のsns_mobile_revisionに依存。GETのレース読込で点検を保存する。キーはdraft_id/SQL revision/engineで、engineはdeterministic-v1とルール・指摘結果のSHA256。同じ結果の再読込は冪等。原文の一時的な取得障害が回復すると別点検になり、古い未照合結果を上書きしない。版と原文manifestは保存時の行ロックで比較する。

POST mobile-approval?group=UUID にaction=edit-decision、draftId、approverId、versionHash、inspectionId、findingId、decision（adopted/ignored）を送る。API管理認証と実媒体を含む版hash比較、SQL行ロック下でrevision・inspectionのdraft/版・指摘ID・本人を確認する。一般ロールにテーブル/RPCを公開しない。

判断は追記テーブルに保存し、画面には最新判断を返す。採用は修正方針の記録であって、自動修正や修正完了を意味しない。結果の表示から本文を別途修正する。指摘件数・採用率は後で集計できるが、改善効果や集客の因果関係を証明する値ではない。

## AI差し込み口

inspectWithAi(draft,{enabled=false,model,messages}) はAnthropic Messages形式の注入契約のみ。model必須、既定無効。messagesはテストのモックでのみ接続。実API・fetch・SDK・鍵読込・管理UIの有効化スイッチを提供しない。

将来の設定名はSNS_EDIT_ASSIST_AI_ENABLED、SNS_EDIT_ASSIST_AI_MODEL、SNS_EDIT_ASSIST_ANTHROPIC_API_KEY。値は設定しない。API_KEYの実利用・外部送信・モデル選定/費用・AI結果の保存経路接続は別のオーナー判断。現在のAPIは決定的点検だけを保存する。AI応答はlocation/content/reason/suggestionを検証し、助言としてのみ返す。伸びの勝者予測はしない。

## ローカル検証

node scripts/maintenance/verify-sns-edit-assist.js scripts/maintenance/verify-sns-mobile-approval.js scripts/maintenance/verify-sns-deadline-queue.js scripts/maintenance/verify-sns-x-send.js

node scripts/maintenance/verify-sns-bundle-import.js

node node_modules/@playwright/test/cli.js test --config playwright.edit-assist.config.js

375pxの明暗モック、外部通信遮断、envDir=false/publicDir=false。画面検証の結果・実行制約は報告に記載する。SQL適用・本番接続は行わない。

## 2026-10-08 オーナー承認のハッシュタグ例外

risk-rules.jsonのbanned-term-kyoutei.hashtag_exception.enabledだけで許可を解除できる。オーナー判断日と解除条件「GA4の直近28日のアクティブユーザー1000」を設定に記載する。GA4取得・自動判定は実装しない。到達時にはオーナーがenabled=falseへ変更して再配備する。Nodeのキャッシュはプロセス再起動で更新する。

許可するのはX/YouTubeのhashtagsの1要素が設定valueに完全一致する場合と、YouTube説明欄の末尾ハッシュタグ群のうち完全一致するタグだけ。裸語、別タグ、途中のタグ、X本文、タイトル、ナレーション、scene文字は警告のまま。未知媒体・文脈未指定は保守的に本文扱い。検査前の空白除去で例外タグを作らない。

Node checkRiskRules（明示fieldまたは欄の配列）、承認API（draftRiskFields）、bundle（bundleRiskFields）、編集補助は同一matcherと設定を使う。従来の戦略メモ承認APIの自由文は本文扱いを維持する。下書きapproveの応答にriskWarningsを追加するが、既存の承認条件と公開保留は変更しない。既に保存されたrisk_flagsを自動で消さない。

v0 bundleのscriptはナレーション、x_textは本文として保持する。追加の任意点検欄x_hashtags / youtube_tags（各30要素以下・1要素200文字以内）とyoutube_description（20000文字以内）をJSONに指定できる。未指定は従来どおり。これらはbundle.jsonと保存bundle内の**点検材料**で、投稿メタデータへ自動変換・送信しない。本文やscriptをタグ欄へ移して動画内警告を消さない。通常下書きでは既存hashtagsとYouTube caption_text（説明）を点検する。v0由来caption_textはscriptなので本文として扱う。

検証比較表は依頼10b報告とtask-10b-qa/verify-risk.txt。enabled=true/false両方でNode・下書き承認API・v0 bundle・編集補助の結果を確認する。v0はX/YouTubeのみで、他媒体の保守的判定はNode/API/編集補助で確認する。
