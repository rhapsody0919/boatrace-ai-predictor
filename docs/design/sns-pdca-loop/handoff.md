# sns-pdca-loop 引き継ぎ（/step4 の途中）

次のセッションは、まず `tasks.md` を読み直してから続ける（`.claude/rules/sdd-workflow.md` の再開規律）。この文書は、tasks.md のチェックだけでは分からない「途中の状態」と「気をつけること」を書く。

## 本番の状態（2026-10-13 時点）

オーナーの方針（10/13）: 10/16 の自動投稿（L1）は延期しない。158 は本番 SQL をオーナーに渡した（実行後の確認は前のレーンがやる）。手元のテストは1本ずつ・workers=1。


| 項目 | 状態 |
|---|---|
| DB 153・154 | 本番に適用済み（オーナー、10/13）。実行後の確認は全部 OK。APPLIED.md の更新は PR #1483 |
| DB 158 | 案（PR #1487）。マージ後、オーナーに本番 SQL を渡す（`158-runbook.md`。実行前の md5 は本番と一致を確認済み） |
| 送信の設定 | `sns_auto_send_control` は x・youtube とも mode=manual・dry_run=true。`scrape_job_state` の sns_ の5行は shadow。`sns_x_send_control.paused=true` |
| X の鍵 | Vercel の Production に `X_OAUTH_CLIENT_ID`・`X_OAUTH_CLIENT_SECRET`・`SNS_TOKEN_ENC_KEY`。オーナーが連携済み（`sns_oauth_tokens` に x の行、10/13 14:24 JST） |
| YouTube の鍵 | 同意画面は本番。`YOUTUBE_REFRESH_TOKEN` は youtube.upload＋youtube で取り直し済み（Vercel の updatedAt で確認）。Analytics の3つも Vercel に登録済み。13:54 に再デプロイ |
| token-health | #1480 の版は本番で 500（runtime の指定漏れ）。修正は PR #1494。マージ後に本番で `?x_read=1` つきで、canUpload・canPublish・Analytics・X の read を確かめる（まだ未確認） |

## PR の状態

マージ済み: #1457（153・154）、#1468（通り道 A・B などの設計）、#1470（X の OAuth）、#1472（X adapter）、#1473（YouTube adapter）、#1480（送信の cron・token-health）

OPEN（10/13 時点）:
- #1483: 153・154 を適用済みにする（docs）
- #1487: DB 158（通り道 A・B、/today の item、月の自動切り替え）
- #1494: token-health の 500 の修正と `?x_read=1`
- #1496: YouTube に承認したタグと本文を送る、32 MiB 超を止める（開発の補助 F01・U06）
- #1499: X の媒体の処理の応答が欠けたら投稿しない（開発の補助 D1）
- #1505: X のトークンの保存が成り立たず読み直しも失敗したとき、つなぎ直しを通知する（開発の補助 D1）
- #1520: runner の走査位置を `scrape_job_state.cursor` に保存し、一度きりの通知の失敗を report.alerts に24時間持ち越す（開発の補助 D1・D2）

### 2本目のセッション（10/13 午後）で出した PR（tasks 21・23・22・6〜8・9・10・11）

どれも /code-review（high）の結果を PR コメントに書いた。

状態（10/13 夜）: マージ済み #1509・#1513・#1516・#1519、ほかに #1529（X 送信の contract を 158 に追随、開発の補助 08 の D1）・#1544（#1516 の点検 15 の D1・D2）。OPEN は #1515（GA4 の鍵待ちではない。CI 待ち）・#1517・#1518（見張りが #1517 → #1518 の順にマージ。#1518 は #1517 を取り込み済みで、送信の cron は照合＋表示の確認の両方を使う形）。

10/16 の試運転（L1）の範囲（オーケストレーターと合意）: レースの全貌だけ。/today（digest、19b）は L1 の後。auto-plan（12）が無い間は item も自動の job も作られないので、L1 で確かめられるのは cron の shadow／dry_run と、本人の承認の job が送る前の検査で止まることまで。#1518 の Chromium が Vercel で起動できるか（functions の glob の重なり）は L1 の最初の起動で見る。

| PR | tasks | 中身 | 依存・注意 |
|---|---|---|---|
| #1509 | 21 | cron `sns-metrics`（5分・終日）。YouTube `videos.list`・X `GET /2/users/{id}/tweets`（since_id/until_id で1件、`reserve_sns_x_read`）。15分超は外部を読まず欠測。JS の累積値の許容差も15分に | なし |
| #1513 | 23 | `buildObservationUtm` に campaign（race-full）、`scripts/lib/snsPostTracking.js`（本文の URL に UTM を差し込む・`sns_post_tracking` に保存）。レースの URL は `?tab=sonar` だけ許す | 呼ぶのは 12 |
| #1515 | 22 | cron `sns-daily`（JST 10:00・11:30）。YouTube Analytics（チャネル・動画の投稿日＋翌日）と GA4（チャネル・UTM ごと・ソナー）を D−3〜D−1 取り直し、変わった行だけ `sns_channel_daily` に | **オーナー: Vercel に `GOOGLE_SERVICE_ACCOUNT_KEY`・`GA4_PROPERTY_ID`**（無い間は GA4 を飛ばして通知）。実 API（読み取り）で day×video の指標と GA4 が JST であることを確認済み |
| #1516 | 6〜8 | v1 の検査（`api/_lib/snsBundleV1.js`、push-bundle だけが渡す）、`scripts/sns/push-bundle.js`（`npm run sns:push-bundle`、draft-x.mp4 を ffmpeg で 720×1280）、`docs/operation/sns-pdca-loop-runbook.md` | 親の投稿にレースの URL がちょうど1つ必須。claims の endpoint は `?stage=` を許す |
| #1517 | 9 | `api/_lib/snsClaimCheck.js`（許可リスト・照合・版）と `createReadCurrent`、sns-send の preflight に接続 | 版は `checkClaims().revision`、締切は `deadlineIso()`。12 が同じ関数で書く |
| #1518 | 10 | `api/_lib/snsHeadless.js`・`scripts/lib/snsScreenMarkers.js`（race-sonar の印は本番で決めた）・`scripts/lib/launchChromium.js`（AI スナップショットと共用）。checkPublicDisplay は `?tab=sonar` を許す。vercel.json で chromium の bin を同梱 | **L1 の最初の起動で Chromium が起動できるか確かめる**（functions の glob の重なり。個別の設定を先に置いた） |
| #1519 | 11 | `sendHolds`（＝`mobileHolds`）に v1 の条件（`source_data.claim_check` と `release_evidence`） | 12 が claim_check・release_evidence を書く |

同じファイルを触る PR が多い（`verify-registry.json` の末尾、`tasks.md`、`sns-hub-metrics/contract.md`、`snsObservations.js`、`api/cron/sns-send.js`（#1517・#1518）、`vercel.json`（#1509・#1515・#1518））。先にマージされた分に合わせて後の PR を origin/master に追従させる（衝突は機械的なもの）。

## 開発の補助（ryujin-dev-assist）の点検の扱い（2026-10-13）

直近マージを読み直した報告3本の P1 は、どれも実在を確かめて直し、修正前に落ちる再現テストで固定した。判定不能（U）の項目は、実投稿・運用の段階の材料か仕様の判断が要るので扱っていない。

| 報告 | P1 | 対応 | 残した判定不能 |
|---|---|---|---|
| `2026-10-13-plan-review-youtube-20261013-01.md`（YouTube adapter #1473） | F01 承認したタグが YouTube に届かない | #1496: 説明は承認の完成文（`snapshot.text`）、タグは承認の hashtags から # を外したもの（オーケストレーターが説明欄を完成文にすることを了承）。U06（大きさ）も直した: 32 MiB 超は begin_post の前に保留。非 JSON・例外・確認の喪失・publishedAt の欠落・JPEG・100文字の境界のテストを追加 | U01 本人チャンネル・公開時刻の外部仕様、U02 scope と表紙の実権限（L2 の最初の投稿で確かめる）、U03 時間の境界、U04 最新 SQL との統合、U05 非公開残置の回復の運用 |
| `2026-10-13-plan-review-xadapter-20261013-02.md`（X adapter #1472） | D1 媒体の処理中に応答が欠けると、完了を確かめないまま投稿に進む | #1499: STATUS に状態が無い・finalize に data が無いときは投げる。動画は finalize で省略されても STATUS で完了を確かめる。contract の「最大7chunk」を8に | U1 外部仕様の現行性、U2 runner の接続（#1480 で入った）、U3 実行の証跡、U4 承認の媒体と費用の対応 |
| `2026-10-13-plan-review-xoauth-20261013-03.md`（X OAuth #1470） | D1 保存が成り立たず読み直しも失敗すると、つなぎ直しの通知が出ない | #1505: 読み直し・復号の失敗を捕まえ、理由つきで通知してから投げる | U1 古い refresh と再連携の重なり（仕様の判断）、U2 state の期限・アカウントの固定、U3 呼び出し側の接続、U4 実行環境・鍵の版の移行 |
| `2026-10-13-plan-review-snsrunner-20261013-04.md`（runner #1480） | D1・D2 | #1520: 走査位置を `scrape_job_state.cursor` に保存、一度きりの通知の失敗を report.alerts に24時間持ち越す | D3 死活の監視の窓（21:30 まで見ると誤報）、U2 YouTube の残置の回復の運用、U3 token-health の生のエラーと tokeninfo の HTTP 状態、U4 X の refresh 失敗を hold にするか（ADR 0093 と plan の食い違い）、U5 試運転の結果を item.checks に（tasks 12）、U6 実行環境・CI の証跡 |

次の点検の報告が来たら、同じ形（実在の確認 → 直す → 修正前に落ちる再現テスト → U は残す理由を書く）で扱う。

## 次にやること（tasks.md の「実装の順番」）

21・23・22・6〜8・9・10・11 は PR を出した（上の表）。20 は読み取りの予約を 21 で入れ、期限前の知らせは 12 に移った（単独の作業は無い）。

1. **12 cron `sns-auto-plan`**（5分、JST 5:30〜21:00）。部品はそろった:
   - item を作る（`race_conditions.race_stage` が優勝戦・準優勝戦のレースだけ、締切は races から `deadlineIso`）
   - X の親: `prepareRaceTracking`（#1513）で本文に UTM → `createPostTrackingStore().save` → 禁止表現の検査をやり直す
   - `checkClaims`（#1517）→ `source_data.claim_check = {ok, revision, observed_at}`、`deadline_queue.source_revision = revision`、`deadline_at = deadlineIso(race)`、`public_url`（UTM つき、`?tab=sonar`）、`screen_key`
   - 表示の確認: `createChromiumHeadless`（#1518）＋`checkPublicDisplay` → `source_data.release_evidence = {status:'released', url, screen_key, checked_at}`
   - `sendHolds`（#1519）が空なら notifying → Slack → notified → approve（スレッドは親から順）
   - 毎回 `roll_sns_send_baselines()`・`roll_sns_x_send_period()`（158 適用後）。期間の終わりの3日前に「自動で切り替わる・額」を知らせる（tasks 20 の残り）
2. **19b /today の X 投稿**（158 の適用後）
3. **13〜15** 止めるリンク・管理 API・画面

## 気をつけること（このセッションで踏んだもの）

- **シェルの Node**: このマシンのシェルの既定は Node v16。`node --test` が動かないので、`export PATH=/Users/terukina/.nvm/versions/node/v22.20.0/bin:$PATH` を先に付ける
- **本番 DB の読み取り**: Supabase MCP が切れていることがある。そのときは `.env.local` の `SUPABASE_ACCESS_TOKEN` で Management API（`/v1/projects/{ref}/database/query` に `read_only: true`）を使い、SELECT だけを流す
- **Vercel の環境変数**: `vercel env ls` の時刻の列は作成日時（created）で、値を編集しても変わらない。更新を確かめるときは Vercel の API（`/v9/projects/{id}/env` の `updatedAt`）を読む。Sensitive の値は手元に取り出せない（確かめるのは token-health で）
- **管理 API は `export const config = { runtime: "edge" }`（または "nodejs"）が必須**: 無いと Node の (req, res) として呼ばれ、本番で 500 になる。#1494 で verify-admin-api-auth に検査を足した
- **ハンドラを Request で直接呼ぶテストでは、Vercel の呼ばれ方の違いは見つからない**: 新しい API は本番（または Preview）で一度叩いて確かめる
- **既存のファイルに整形（prettier）を丸ごとかけない**: 差分が数百行に膨らむ（snsDeadlineQueue.js で一度起きた）
- **手元のテストは1本ずつ・並列1**（オーケストレーターの負荷対策の指示。`node --test --test-concurrency=1`）
- **verify-registry.json の衝突**: 両側の末尾をつなぐだけだと、相手の PR が既存の行（例: verify-sns-send-runner.js の guards）を書き換えていたときに script の無い行ができる。master の版を取り、自分の PR が足した行だけを末尾に足し直す（`npm run verify:registry` で確かめる）
- **macOS に timeout コマンドは無い**: `timeout 300 node ...` は何も実行せずに空で終わる（テストが全部通ったように見える）
- **E2E のキュー**: 10/13 午後は E2E Smoke Test が30件以上キューに並び、PR の CI が1時間以上 pending のままになった。手元で全件は流さない（review-fix-cycle の Phase 5）
- **本番の画面で確かめるとき**: 解析のタグ（GA4）を route で止めてから開く（確認のアクセスを数えないため。`verify-sns-headless.js --live <race_id>` がそうしている）
- **オーナーに渡すファイル**: `owner-apply-153-154.sql`・`orchestrator-checks-153-154.sql`・`owner-x-keys-setup.md`・`owner-google-oauth-production.md` は前のセッションの scratchpad にあり、次のセッションからは読めない。runbook（`docs/db-migration/153-runbook.md`・`158-runbook.md`）が正本。X の鍵の手順は tasks 8 の `docs/operation/sns-pdca-loop-runbook.md` に入れる（画面は console.x.com の App の右上の Settings）
