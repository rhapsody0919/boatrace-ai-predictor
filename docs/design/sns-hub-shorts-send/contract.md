# YouTube Shorts 承認後送信（依頼10、モックまで）

## 接続と承認

139（F01-Rの試行時媒体計数）・140・141を維持し、142を上に適用する。実adapter・worker/cron接続・鍵・OAuth・アップロードは提供しない。既存queue/mobile APIのconnected=falseと初期停止は維持する。旧publish-youtubeは期限付き素材を拒否するまま。既存youtubeUpload.jsのOAuth・multipart upload・thumbnail helperは将来adapterが利用できるが、このレーンからは呼ばない。

スマホのversionHashは既存SQL revision＋server snapshotのhash。同じサーバー関数createXSnapshotを使い、YouTubeのみvideoと任意coverの両方を実バイトhash/size/typeで含める。SQLの承認版・媒体パス検査も2件までへ拡張する。本文/タイトル/タグ/媒体/根拠の編集は既存triggerにより承認失効。同じStorageパスの上書きは送信時に拒否する。142以前のcoverを含まないsnapshotは再承認が必要。Xの媒体選択は変更しない。上限は従来の各32MiB（動画＋cover最大64MiB）、SQL/API応答時間・実動画対応は接続前に確認する。

## 実行契約

runYoutubeQueueJobは既存claim → hash/媒体検査 → preflight → begin_post → youtube.publish → completeを維持する。予約はローカルscheduled_at、外部publishAtはnull。begin_postを最初の外部書込より先に保存し、その後のupload応答喪失/DBエラー/lease切れはreconcileから再送しない。

注入publish({snapshot,media,privacyStatus:'public',publishAt:null,beforeCall,uploaded})は、検証済みの実バイトだけを送る。各Data API呼出し前にbeforeCall(method)、uploadのIDがわかった直後にuploaded(videoId)をawaitする。呼出し内部のretry・Storage再読込は禁止。モックはvideos.insertでuploadと公開metadata設定を同時に行う既存inline方式のモデルで、任意thumbnails.set、videos.list確認の順。実API実装ではない。別workerでの非公開upload→公開やvideos.updateは未提供。公開方式はオーナー判断後に接続設計を確定する。

公開済みと記録できる結果は、本人の同一チャンネル・承認版との一致を確認した{confirmed:true,privacyStatus:'public',id,posted_at}だけ。posted_atは確認した実公開時刻。private/unlistedのpublishedAtやupload終了時刻から推測しない。候補IDだけはreconcileのexternal_post_idへ早く保存する。completeの動画ID/URL/posted_atとdraft.posted_atは139の同一transactionで保存する。

beforeCallは公開検査preflightを再実行し、DBの停止・期限・lease・鮮度・承認・JST日次枠・費用期間・PTクォータ日を再検査する。進行中のinline uploadの公開を停止できる保証はない。5分を超える動画と締切跨ぎを安全に扱うには非公開uploadと公開の分離をオーナーが決める必要がある。

## クォータ

142は1プロジェクト用のsns_youtube_quota_control（既定verified=false、上限/基準日未設定）、追記試行台帳sns_youtube_quota_attempts、照合読取台帳sns_youtube_quota_readsを用意する。全てRLS有効、service_roleのみ。既存transition RPC名/戻り値を維持して最新139の内部実装を再利用する。内部関数transition_sns_send_139は直接実行権を剥奪する。

quota_dayはAmerica/Los_Angelesの暦日（DST対応）。JSTの日次投稿枠と混ぜない。claim時にupload専用1回＋一般51 units（任意thumbnail 50＋確認list 1）を原子的に予約する。カバーなしでも51を予約する保守的上界。失敗/保留/取消/再承認でも返金しない。calls、upload_calls_started、general_units_startedは外部呼出し直前に追記する。応答喪失で実消費不明でも消費扱いで保守的に数える。予約と開始記録は実Google請求・クォータ残高の測定値ではない。

上限/当日基準日/verifiedが未設定・未確認ならclaim不可、上限を超える予約はclaim全体をrollbackする。外部APIゼロ。外部・手動APIの確認済み使用量external_uploads/external_generalを同じプロジェクトの台帳へ重複なく集約する必要がある。確認後にverifiedへ設定するのはオーナー。Google Cloudのクォータ実値・全経路計数・実費照合は未接続。PT日付を跨ぐ試行は後続APIを停止し再送しない。一般枠を他経路が使った場合も上限で停止する。

reconcileYoutubeJob(job,{store,lookup})は公開停止/期限/leaseとは独立した読取照合。単一videos.listの読取をyoutube_lookup RPCで先に1 unit記録してからlookup(job)を実行する。基準日/一般枠を検査し、自動retryなし。確定結果だけcomplete、非公開/未確認/欠測はreconcile維持。ID不明時の一覧探索・別quota bucket・未投稿確定後の解除は未提供。lookupの本人チャンネル/版照合は接続側の責任。静的mockでの確認しかしていない。

## 48h/7dへの受け渡し

依頼2/136のパッチは本累積の別系列で、今回混ぜない。取り込み側はpostedのYouTube jobからdraft_id、channel='youtube'、external_post_id、external_post_url、posted_atを渡し、draft.posted_atを厳密な48h/7dの起点にする。source_data.youtube_urlは旧手動経路専用なので新queueの結果取得元にしない。reconcile・privateを観測対象へ入れない。YouTube Analyticsの本人認可・維持率等の指標定義/欠測規則は依頼2のまま。収集・観測・本番接続は今回実装しない。

## 検証

node --test --test-concurrency=1 scripts/tests/sns-shorts-send.test.js scripts/tests/sns-deadline-queue.test.js scripts/tests/sns-x-send.test.js scripts/tests/sns-mobile-approval.test.js scripts/tests/sns-mobile-api.test.js scripts/tests/sns-mobile-groups.test.js scripts/tests/sns-edit-assist.test.js

node scripts/maintenance/verify-sns-bundle-import.js

全てローカルPGlite＋モック。品質ゲート台帳は変更しない。実adapter・外部並行接続・UI実動画再生は未検証。
