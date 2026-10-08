# 個別承認後のX送信（依頼3）

この段階はSQL・管理画面・workerインターフェースとモックまで。実adapter、OAuth接続、cron、購入、投稿は別の接続承認が必要。APIのconnectedは常にfalse、画面の公開/予約ボタンは無効。既存の個別承認・手動コピー/共有は残る。

## 保存と承認

SQL137は135に依存、136には依存しない。本人の日本語X下書きのみ。公開保留・v0由来は不可。既存approvedにも本人の再承認が必要で、過去の承認から自動queue化しない。

承認APIは媒体をサーバーで読みSHA-256を計算し、本文＋改行＋タグ、原文・タグ・言語・媒体パス、媒体実バイトのhash/サイズ/typeをsnapshotにする。動画があれば動画1本、なければカバー1枚。上限32MiB、MP4/JPEG/PNG。source_data.dataCardUrlによる追加画像がある既存投稿は一部だけ送らず拒否し、手動経路に残す。DBは行ロック下で現行本文/パスとの一致を確認し、snapshotのJSONB文字列表現をSHA-256でhash化する。workerは保存済みsnapshot_textと実バイトを照合する。ストレージの同じパスを上書きしても送信直前に拒否する。媒体差し替え後は再承認が必要。

144適用後、draft.statusまたはjob.stateがpostedなら本文・媒体等の承認対象編集を拒否する。送信済みjobは再承認・再送できない既存契約に合わせ、投稿済み版を上書きせず承認記録を保持する。statusのみの投稿完了記録・アーカイブは従来どおり扱う。

未投稿の本文・タグ・媒体パス・言語・公開保留等の編集はDB triggerで承認hash/承認者/日時を消し、未送信jobを取消、approved/ready_to_postをpending_reviewへ戻す。queuedは取消操作後に手動経路へ戻せる。画面はqueued/sending/reconcileの手動投稿導線を隠す。sending/reconcileは編集・手動投稿済み記録・アーカイブを拒否する。直接Storage上書きはDB triggerで即時検知できず、workerの実バイト照合で停止する。

## 状態と実行

- queued: 即時または予約時刻待ち。claimで月額枠を予約しsendingへ。draft/jobのロックで二重claim拒否。
- sending: upload処理中。initialize→append→finalize→最大10回status。各外部呼び出し直前に停止状態と承認を再確認。
- reconcile: 投稿作成前にDBへ先に保存。成功応答のDB更新失敗・POST timeout・開始RPC応答喪失でも再claim不可。workerが途中終了したsendingは、停止してworker終了を確認後にrecover操作でreconcileにする。
- posted: 投稿ID/URL・公開時刻と下書きpostedを同一DB transactionで保存。
- failed: 投稿作成前の失敗。再実行には本人の再承認が必要。試行費用枠を払い戻さない。
- cancelled: 編集/手動投稿等で未送信の承認が失効。

store.transitionはSQL137のtransition_sns_x_send。X adapterはinitialize({size,type,category})、append({id,index,bytes})、finalize(id)、status(id)、createPost({text,mediaIds})を実装する。媒体処理結果はprocessing_infoに正規化する。createPostは{id,posted_at}へ正規化し、posted_atは照合した実公開時刻を渡す。SDK内のPOST自動再試行も禁止。workerには実adapterを渡す経路がなく、モックはローカルテスト専用。

要照合を通常失敗/queuedへ戻す操作は用意しない。本人がX側の投稿・アカウント・本文/媒体・時刻を確認し、同一投稿と確定した場合だけcompleteで記録する。未投稿と確認した後の解除手順は次の接続設計で判断する。ID不明のtimeoutから自動的に「未投稿」と推定しない。

## 上限と停止

USDの100万分の1単位の整数。上限は最大$10。period_start/endは実際のX請求期間をオーナー側で設定する。全upload（32MiBで最大7chunk）・最大10poll・投稿作成・照合等を含む1試行の保守的な費用上限attempt_ceiling_microusdが未設定ならclaimできない。全試行を先に予約、失敗時も返金しない。期間を跨いだjobの継続を拒否する。月更新は自動化していない。

初期paused=true、請求期間・費用未設定。停止APIはpaused=trueにしかできず、再開APIは提供しない。停止は次の外部呼び出し前に効く。すでに開始した外部通信は取り消せない。停止応答/チェックと外部通信開始の間の競合は残るため「送信中も必ず取消できる」と表示しない。

この枠は本workerだけの予約台帳。別のX分析処理/手動API呼び出しや料金改定は捕捉しない。実接続前にX Consoleの同じ請求期間のspending limitも$10以下に設定し、他経路の費用を共通枠へ集約する。通常読取/owned readを含む総予算は依頼2の接続時にも照合する。外部APIから実請求額を取得する処理は今回ない。

## 権限と運用

新規テーブルはRLS有効、PUBLIC/anon/authenticatedから権限を剥奪し、service_roleのみ操作可。全APIがrequireAdminAuthを呼ぶ。既存承認者マスタの「本人」を検査する（admin認証とマスタ選択は既存の構造）。本人の別アカウント認証への変更は今回なし。APIはブラウザ提供のhashや費用上限を信頼しない。

将来の非公開環境変数名候補: SNS_X_OAUTH_CLIENT_ID、SNS_X_OAUTH_CLIENT_SECRET、SNS_X_OAUTH_REDIRECT_URI。値もトークン保存先も今回扱わない。長期認可・refresh tokenの暗号化保管/更新/失効・state/PKCEの保存方式は接続段階で取り込み側が確定する。

## ローカル検証

`node --test scripts/tests/sns-x-send.test.js`（PGlite＋モック、外部通信なし）。品質ゲート台帳は変更禁止なので、新しいverifyスクリプトは作らずnode:testを独立配置。

`npx playwright test --config playwright.x-send.config.js`（専用Vite、envDir=false、publicDir=false、localhost以外を遮断）。本番・秘密ファイルを読む既定E2Eのglobal setupは使わない。画面は375px/light/darkで未接続、停止、予約承認、公開不可、要照合を検査する。実際のX接続・メディア可否・課金・本番適用は未検証。

## 返答03の応答喪失対策（2026-10-07）

承認・取消・停止の操作開始時に親へunknownを通知し、画面も状態未確定と表示する。操作後の状態GETが成功して初めて確定状態へ戻す。POST応答喪失・POST成功後のGET失敗では手動投稿と再承認を閉じたままにする。操作前に開始したpollの応答は世代番号で除外し、操作中はpollを開始しない。失敗後の新しいpollが確定状態を返せばそれを反映する（要照合jobの解除ではない）。

承認対象が画面で見た版かクリック時の最新版か、実adapterのtimeout/SDK retry、総費用、要照合解除・本人認可は未決事項であり、今回独断で設計を追加しない。送信直前のヘッドレス公開確認は依頼5。初期停止・connected=falseを維持する。
