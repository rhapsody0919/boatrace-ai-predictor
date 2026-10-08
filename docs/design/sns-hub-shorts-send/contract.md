# YouTube Shorts 承認後送信（依頼10、モックまで）

## 接続と承認

139（F01-Rの試行時媒体計数）・140・141を維持し、142を上に適用する。実adapter・worker/cron接続・鍵・OAuth・アップロードは提供しない。既存queue/mobile APIのconnected=falseと初期停止は維持する。旧publish-youtubeは期限付き素材を拒否するまま。既存youtubeUpload.jsのOAuth・multipart upload・thumbnail helperは将来adapterが利用できるが、このレーンからは呼ばない。

スマホのversionHashは既存SQL revision＋server snapshotのhash。同じサーバー関数createXSnapshotを使い、YouTubeのみvideoと任意coverの両方を実バイトhash/size/typeで含める。SQLの承認版・媒体パス検査も2件までへ拡張する。本文/タイトル/タグ/媒体/根拠の編集は既存triggerにより承認失効。同じStorageパスの上書きは送信時に拒否する。142以前のcoverを含まないsnapshotは再承認が必要。Xの媒体選択は変更しない。上限は従来の各32MiB（動画＋cover最大64MiB）、SQL/API応答時間・実動画対応は接続前に確認する。

## 実行契約

オーナー判断2026-10-08の案B。runYoutubeQueueJobはclaim → 承認hash/媒体検査 → preflight → begin_post → **private** upload → ID保存。publishAtはnull、外部自動公開は禁止。upload({snapshot,media,privacyStatus:'private',publishAt:null,beforeCall,uploaded})は検証済みバイトだけを使い、ID判明直後にuploaded(id)をawaitする。任意coverもprivateの間に送る。実adapterは未提供、SDK内部retryは禁止。

runYoutubePublishJobは別段階。1回の呼出しでyoutube_pollを先に記録し、processing(job)で単一videos.listのprocessingDetails/statusと本人チャンネル・承認版・IDを照合する。confirmed=true、同一ID、private、processingStatus='succeeded'が必要。処理中はreconcileのまま、最大3回まで。タイマー/自動workerは提供しない。4回目は外部呼出し前に停止し非公開残置へ。ready保存後、最新preflight（未認証headless・欠場・source版・期限）→ youtube_publish_begin（DBの最新承認/停止/費用/日次枠/期限/鮮度/PTを再検査して**新しい5分lease**）→ 再度preflight/台帳 → videos.updateでpublic → videos.listで実公開確認 → complete。公開段階はuploadの古いleaseを更新して続行するのではなく、readyから一度だけ開始する。試行をJST日付跨ぎで公開しない（当日baselineを更新しても停止し非公開残置）。公開更新の再試行・再uploadは禁止。

公開結果は{confirmed:true,privacyStatus:'public',id,posted_at}。本人チャンネル・承認版・同一IDを確認した実公開時刻のみで、privateのpublishedAtやupload終了時刻は使わない。completeとdraft.posted_atは139の同一transactionで保存する。videos.update開始記録後の応答喪失・DB失敗はupdate_started/reconcileで照合に残し、非公開とは断定しない。通信開始後の停止・期限超過を取り消す保証はなく、実adapterのtimeout/時刻境界の通常検証が必要。

期限切れ・承認失効・preflight失敗等でupdate開始前に停止したID判明動画はyoutube_retainでprivate_retained/reconcileと理由を保存。一覧は候補IDと「非公開のまま残置」を表示する。削除・要照合解除・再公開の自動経路はない（削除はオーナーが手で行う）。ID不明・保存応答喪失は要照合のまま。DB保存失敗時には一覧の残置表示まで保証できないため、照合運用で確認する。処理読取が別ID・public/unlisted・未確認を返した場合も非公開と断定せず要照合のまま。

## クォータ

142は1プロジェクト用のsns_youtube_quota_control（既定verified=false、上限/基準日未設定）、追記試行台帳sns_youtube_quota_attempts、照合読取台帳sns_youtube_quota_readsを用意する。全てRLS有効、service_roleのみ。既存transition RPC名/戻り値を維持して最新139の内部実装を再利用する。内部関数transition_sns_send_139は直接実行権を剥奪する。

quota_dayはAmerica/Los_Angelesの暦日（DST対応）。JSTの日次投稿枠と混ぜない。claim時にupload専用1回＋一般104 units（任意thumbnail 50＋公開update 50＋処理poll最大3＋公開確認list 1）を原子的に予約する。カバーなしでも104を予約する保守的上界。失敗/保留/取消/再承認でも返金しない。calls、upload_calls_started、general_units_startedは外部呼出し直前に追記する。応答喪失で実消費不明でも消費扱いで保守的に数える。予約と開始記録は実Google請求・クォータ残高の測定値ではない。

上限/当日基準日/verifiedが未設定・未確認ならclaim不可、上限を超える予約はclaim全体をrollbackする。外部APIゼロ。外部・手動APIの確認済み使用量external_uploads/external_generalを同じプロジェクトの台帳へ重複なく集約する必要がある。確認後にverifiedへ設定するのはオーナー。Google Cloudのクォータ実値・全経路計数・実費照合は未接続。PT日付を跨ぐ試行は後続APIを停止し再送しない。一般枠を他経路が使った場合も上限で停止する。

reconcileYoutubeJob(job,{store,lookup})は公開停止/期限/leaseとは独立した読取照合。単一videos.listの読取をyoutube_lookup RPCで先に1 unit記録してからlookup(job)を実行する。基準日/一般枠を検査し、自動retryなし。確定結果だけcomplete、非公開/未確認/欠測はreconcile維持。ID不明時の一覧探索・別quota bucket・未投稿確定後の解除は未提供。汎用reconcileSendJobもYouTubeは必ずこの専用関数へ回す。lookupの本人チャンネル/版照合は接続側の責任。静的mockでの確認しかしていない。

## 48h/7dへの受け渡し

依頼2/136のパッチは本累積の別系列で、今回混ぜない。取り込み側はpostedのYouTube jobからdraft_id、channel='youtube'、external_post_id、external_post_url、posted_atを渡し、draft.posted_atを厳密な48h/7dの起点にする。source_data.youtube_urlは旧手動経路専用なので新queueの結果取得元にしない。reconcile・privateを観測対象へ入れない。YouTube Analyticsの本人認可・維持率等の指標定義/欠測規則は依頼2のまま。収集・観測・本番接続は今回実装しない。

## 検証

node --test --test-concurrency=1 scripts/maintenance/verify-sns-shorts-send.js scripts/maintenance/verify-sns-deadline-queue.js scripts/maintenance/verify-sns-x-send.js scripts/maintenance/verify-sns-mobile-approval.js scripts/maintenance/verify-sns-mobile-api.js scripts/maintenance/verify-sns-mobile-groups.js scripts/maintenance/verify-sns-edit-assist.js

node scripts/maintenance/verify-sns-bundle-import.js

全てローカルPGlite＋モック。品質ゲート台帳は変更しない。実adapter・外部並行接続・UI実動画再生は未検証。
