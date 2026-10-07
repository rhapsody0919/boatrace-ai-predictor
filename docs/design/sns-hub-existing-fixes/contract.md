# 既存YouTube・ブログ承認の復旧契約（依頼4）

対象は既存YouTube投稿・ブログPRマージ・通常承認・redoの修正のみ。X実接続や公開段階を進めない。

## 排他と状態

SQL138をAPI配備前に適用する。sns_draftsの行ロック下で生の行スナップショット、pending_review、未claimを照合する。準備（媒体取得・PR情報取得）の後、外部操作前にreconcileを保存する。claimの応答が消えた場合も外部操作を開始しない。

- NULL: 外部操作未開始。通常承認・redoはpending_reviewを条件に更新する。
- reconcile: 送信中または結果不明。再アップロード・再マージ・内容変更・削除を禁止する。時間経過で解除しない。
- external_done: 外部ID/URL・マージSHA・完了時刻の記録済み。再試行はDBへのposted反映だけを行う。
- done: posted反映済み。同じ送信APIの再試行は保存済みの結果を返す。

動画IDはサムネ処理より先に保存する。サムネ失敗は動画失敗にしない。サムネ結果の記録に失敗しても動画IDと「サムネ未確認」の警告が残る。DB反映の再試行がサムネ処理より先にdoneへ進んでも、同一tokenのサムネ結果を保存し、反映済みsource_dataを同時に同期する。DB反映はsource_dataの既存値を保持し、動画ID/URLまたはブログSHAを追加する。

外部呼び出し・Ready化・DB記録の失敗は、安全側としてreconcileに残す。再送のための自動解除/API/期限は今回追加しない。既存の別経路が送信中の行を更新する場合もSQLトリガーで止める。通常のpostedのarchive方針は維持する。

## ブログの版確認

認証済みのblog-pr-preview GETから取得したhead SHAの固定ツリーを画面に提示し、リンク先の版を確認したチェックを承認条件にする。承認時にheadShaをPOSTする。サーバーは現在のPR headと照合してからReady化し、merge PUTにもshaを指定する。GitHubは取得後にheadが変わった場合も拒否する。[GitHub公式REST仕様](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)

下書き本文とPR内容の自動同一性保証、Storage実バイトの承認版固定は今回の依頼対象外。リンク先の記事と画像を人が確認する。PR URLは既存の固定リポジトリに限定する。

## 通知

redoのRoutine未設定・HTTP失敗・通信例外をroutine.fired=falseで返し、成功応答のriskWarnings・thumbnailWarningとともに画面の消えない通知に操作ごとに追加する。警告なしの成功や別のエラーでも以前の通知を消さず、利用者が「通知を閉じる」を押すまで保持する。redoの状態はrevision_requestedのまま。起動の再試行方法は今回追加しない。

## 人による照合（運用判断待ち）

reconcileの解除は、外部の同一動画またはPR、時刻と対象版を確認した後に取り込み側とオーナーが判断する。IDが分かる場合はservice_role限定のsns_record_externalへ同じtokenと結果を記録し、sns_finish_externalでDBだけを反映できる。ID不明時の未投稿確定条件・解除権限・解除手順はオーナー判断まで未提供。状態だけをNULLへ戻して再送しない。

SQL137のXガードはplatform=x、SQL138のclaimはyoutube/blogで、互いの送信状態を流用しない。SQL135の公開保留ガードは取り込み時に維持する。claimでもJSON経由でpublish_blocked・bundle_import_id・bundle_version_hash・publication_hold_reasonsを検査し、取り込み列があれば保留を拒否する。SQL138は135〜137の未取り込み列を直接参照しない。
