# 全月カレンダー（依頼16・パッチ11）

内部管理画面の既存期限順一覧を拡張する。01〜10適用後が基準。新しい送信・承認・状態管理基盤は作らない。既存DeadlineQueuePanelの取得・10秒更新・エラー表示を共用し、選択月・日・型・会場だけを同じ親のローカルstateで持つ。日を選ぶと同じDeadlineQueueListを絞り込み、一覧へフォーカス・スクロールする。

## 集計契約

- 全表示日付はJST。投稿済みはjob.posted_at、無ければdraft.posted_at。実公開日が無い投稿済みを予定日から推測しない。
- 未公開はscheduled_at、未設定なら公式締切、最後に送信期限の日。失効も元の予定日に計上する。公開日と予定日は異なる場合があるため、月の件数は制作日単位の指標ではない。
- 投稿済み、cancelled、期限切れのqueued/held/pending_review/approved、queued、その他の順で排他的に分類する。sending/reconcileを期限切れだけで失効扱いにしない。失効判定はnow >= expires_at。
- 型は既存format（035の型列）、会場はsource_data.race_idの会場コードと既存STADIUM_NAMES。グレードはsource_data.gradeの保存された文字列のみ。最新のレース情報を新たに取得しない。不明は未確認と表示する。
- 型・会場で月を絞り込み、チャネル・型・会場・保存グレードの本数を表示する。日付が不明な記録は全期間の未確認件数に残し、月へ割り当てない。月変更では型・会場・日選択を解除する。
- カレンダーは曜日の位置を維持するため固定7列。データ件数に応じたカードグリッドではない。

## データ取得・観測

deadline-queue APIは既存の管理者認証・Edge runtimeを維持。既存jobs/draftsの読み取り列を拡張し、136のsns_metric_observationsを500行ずつ読む。新規SQL、依存、外部API、送信処理は無い。投稿済みjobはdraftがアーカイブされていても実績を表示する。

日別一覧には取得元・定義・観測窓・取得日時・期間末・反映日時を伴う生の観測履歴を表示する。mockと未来の観測は表示しない。改訂履歴は合算せず、値がnullなら欠測理由を表示する。0を補わず、48h/7dの成果比較や有効性判断をカレンダーで行わない。136が未適用など読み取りに失敗した場合は、空月や0件にせず既存の固定エラー文を出す。

## 検証と停止点

`node scripts/maintenance/verify-sns-month-calendar.js` は純粋集計・モックDB取得・1001行ページング・JSX/CSSバンドルを検証する。既存verify-sns-bundle-import.jsからも呼ばれる。新スクリプトを独立ゲートとして登録する場合は取り込み側がverify-registry.jsonへ登録する。

`--ui`はenvDir=false/publicDir=false/appType=customの専用経路とlocalhost限定通信で実行する。5幅・light/dark・米国timezoneのブラウザテスト。Chromiumが起動不可ならUIは未実行として扱う。

最新masterへの統合、実データでの保存グレードの充足・日付不足、全履歴を10秒ごとに読む既存方式の負荷、実画面の見え方は取り込み側の確認事項。実接続・投稿開始は既存のオーナー判断待ちを維持する。
