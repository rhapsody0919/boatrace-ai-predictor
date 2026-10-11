# 発走期限つき待ち行列（依頼5、初期停止）

依頼3の `sns_x_send_jobs` と承認hash、transition RPC、排他、費用予約、要照合を再利用する。互換性のためテーブル名・RPC名・`x_approved_hash` は維持し、channelをx/youtubeへ拡張する。別送信台帳は作らない。135の公開保留は維持。SQL139は035/042/135/137が前提で、138は依頼4の別変更。適用はオーナーのみ。

## 承認対象と時刻

`source_data.deadline_queue` に `deadline_at`（公式締切、ISO offset付き）、`expires_at`、`source_observed_at`、`source_revision`、`public_url`、`screen_key`、必要なら `parent_job_id`、YouTubeなら `youtube_mode`（immediate/scheduled）を保存する。欠落は送信時に保留する。承認snapshotにこのオブジェクトを丸ごと含め、承認RPCは現行source_dataとの一致を行ロック内で確認する。YouTubeタイトルもsnapshot/hash対象。本文・添付・タイトル・source_dataの変更は再承認。

推奨は公式締切90分前、30分前失効。`deadlineSchedule` は計画作成用の純粋関数で、運用許可ではない。SQL controlの `schedule_minutes=90`、`expiry_minutes=30` は提案値、`timing_approved=false` が初期値。汎用queue-send APIで時刻省略ならDB設定の締切90分前を使う。既存X即時ボタン、YouTube immediateは明示的に現在時刻を渡す。予約時刻は未来指定で、expires_atは設定された失効時刻に一致しなければ保留。期限判定は `now >= expires_at`。画面・予約入力は端末のタイムゾーンに依存せずJST。

新API: `GET /api/admin/sns-hub/deadline-queue`（全ページを500行ずつ取得、承認待ち含む）、`GET/POST /api/admin/sns-hub/drafts/:id/queue-send`（既存X APIと同じ本人の個別承認/取消）。全API requireAdminAuth。connected=falseを維持し、送信workerを呼ばない。YouTube承認UIの実接続は未提供で、一覧は即時/予約を分けて表示する。

## 最終検査と公開画面

`createDeadlinePreflight({headless, markers, readCurrent})` をworkerへ注入する。Xは媒体処理前とPOST直前に実行、YouTubeは媒体バイト検査後に実行する。検査未接続なら保留する。

- 承認snapshotのhashと実媒体のhash/容量一致。
- APIの現在版と承認source_revision・公式締切が一致、欠場なし・中止なしが明示的に確認できること。`readCurrent` は送信時点の新しい取得結果を返す契約であり、保存済み結果の再利用は禁止。
- DB保存の取得時点は未来でなく `max_source_age_seconds` 内。未設定は停止。
- Xは公式twitter-textで加重文字数を検査し、波括弧の差し込み値は拒否。
- `headless.inspect({url,context:{storageState:null},requiredSelectors})` は毎回新しい未認証context、Cookie/Storage/Preview設定なしでリンク先を開く。visibleSelectorsはlocatorの存在ではなく実表示の判定結果を返す。`markers[screen_key]` は対象画面ごとの設定配列で、全印が表示されること。HTTP200やfeatureFlagsは根拠にしない。モックのみ提供、実ヘッドレスは未接続。
- 公開URLはwww.boat-ai.jpのHTTPS、UTM4種以外のquery・fragment・認証情報は拒否。リダイレクト・未表示・タイムアウトは保留。公開URL/queryの正式仕様が確定したら許可項目をレビューして足す。検査後にも期限を検査する。

失敗理由は既知の安全なコードだけ保存。Xのpublic_component_missing等は維持、媒体/非コードの例外はpreflight_or_media_failed。YouTubeはyoutube_preflight_failed。API本文・認証情報は保存しない。

## 排他・上限・失敗回復

claim/check/begin_postで期限・鮮度・承認版を再検査する。claimはdraft→control→jobのロック、5分のleaseとlocked_at、draft_revisionを保存。期限切れ/未確認はheld（再承認）。lease延長は提供せず、5分を超える処理は停止する。

`sweep_sns_deadline_queue` は期限切れqueuedをheld、lease切れsendingをreconcileへ。将来worker開始時にstore.sweepを明示的に呼ぶ契約で、cronは未接続。reconcileを期限切れや通常失敗へ戻さない。HTTP timeout/DB更新応答喪失は既存のbegin_post事前保存によりreconcile維持。lookupが同一投稿を外部確認しconfirmed/id/実公開時刻を返したときだけcomplete、未確認は再送しない。

親子は個別承認・別job/費用計数。親の同チャネルposted/外部IDを確認してから子をclaimし、親待ち/失敗/要照合ならparent_not_postedで保留。X子はcreatePostのreplyToに本人の親の外部IDを渡す。他者への自動返信は提供しない。

月$10上限は137の保守的費用予約を維持。日次はdaily_limit未設定なら停止、daily_baseline_dateが当日JSTでない場合も停止。daily_external_countは手動・引用・他経路分の確認済み本数としてオーナー側が設定する。controlロック下で同チャネルの当日試行記録（jobの追記専用attempt_datesとattempt_channelsの同じ添字に試行日・試行時の媒体を記録。再承認・取消・媒体変更で消さない。現在のjob.channelではなく試行時の媒体で集計）と足し合わせ上限を守る。begin_postでも当日JSTの基準と上限を再検査し、自分のclaim済み1枠のみ重複計数から除く。日付をまたいだclaimはdaily_claim_date_changedで保留し、自動で新日に枠を移さない。枠帰属はオーナー判断待ち。失敗試行も当日の枠を消費する。外部投稿数/料金を自動取得する処理はない。実接続前に全経路の本数・実績費用/予約費用を共通台帳へ集約する必要がある。X由来のcontrolは共通の停止・保守的予算枠であり、YouTube固有の料金計画は接続段階で確認する。

## YouTube即時と予約

`runYoutubeQueueJob` は同じclaim/begin_post/completeを使い、既存uploadに接続するためのpublish adapterとモックのみ提供する。既存publish-youtubeはdeadline_queue素材を拒否し、旧経路から期限検査を迂回させない。

予約はローカルscheduled_atに達するまでclaim不可。時刻到達後に媒体をStorageパスから新しく読み、最終検査してpublicとしてuploadする。adapterには検査した実バイトをmedia配列で渡し、同じStorageパスから読み直して別媒体を送らない契約とする。予約時刻まで持たない署名URLをsnapshotへ保存しない。実公開時刻だけposted_atへ記録する。YouTubeのpublishAtによる外部の自動公開は今回使わない。private動画/予約条件と将来時刻での最終検査を別途確認してから判断する。長時間uploadが期限を越える可能性は実adapter未検証で、公開前非公開upload→最終検査→公開の分離を接続段階で検討する。

48h/7dや継続視聴率の実装は変更しない。依頼2の厳密な投稿時刻起点・欠測扱いを取り込み側が維持する。

## ローカル検証

`node scripts/maintenance/verify-sns-deadline-queue.js scripts/maintenance/verify-sns-x-send.js` はPGlite＋モックだけ。品質ゲート台帳にはverify-registry.jsonで登録済み。

`npx playwright test --config playwright.deadline-queue.config.js` と既存playwright.x-send.config.jsはenvDir=false/publicDir=false、localhost以外を遮断。新一覧は375px/light/dark、端末America/Los_AngelesでもJSTを表示するテスト。Chromium起動がmacOS sandboxで拒否された場合は合格とせず未検証で報告する。
