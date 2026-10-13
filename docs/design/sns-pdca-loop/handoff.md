# sns-pdca-loop 引き継ぎ（/step4 の途中）

次のセッションは、まず `tasks.md` を読み直してから続ける（`.claude/rules/sdd-workflow.md` の再開規律）。この文書は、tasks.md のチェックだけでは分からない「途中の状態」と「気をつけること」を書く。

## 本番の状態（2026-10-13 時点）

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

## 開発の補助（ryujin-dev-assist）の点検の扱い（2026-10-13）

直近マージを読み直した報告3本の P1 は、どれも実在を確かめて直し、修正前に落ちる再現テストで固定した。判定不能（U）の項目は、実投稿・運用の段階の材料か仕様の判断が要るので扱っていない。

| 報告 | P1 | 対応 | 残した判定不能 |
|---|---|---|---|
| `2026-10-13-plan-review-youtube-20261013-01.md`（YouTube adapter #1473） | F01 承認したタグが YouTube に届かない | #1496: 説明は承認の完成文（`snapshot.text`）、タグは承認の hashtags から # を外したもの（オーケストレーターが説明欄を完成文にすることを了承）。U06（大きさ）も直した: 32 MiB 超は begin_post の前に保留。非 JSON・例外・確認の喪失・publishedAt の欠落・JPEG・100文字の境界のテストを追加 | U01 本人チャンネル・公開時刻の外部仕様、U02 scope と表紙の実権限（L2 の最初の投稿で確かめる）、U03 時間の境界、U04 最新 SQL との統合、U05 非公開残置の回復の運用 |
| `2026-10-13-plan-review-xadapter-20261013-02.md`（X adapter #1472） | D1 媒体の処理中に応答が欠けると、完了を確かめないまま投稿に進む | #1499: STATUS に状態が無い・finalize に data が無いときは投げる。動画は finalize で省略されても STATUS で完了を確かめる。contract の「最大7chunk」を8に | U1 外部仕様の現行性、U2 runner の接続（#1480 で入った）、U3 実行の証跡、U4 承認の媒体と費用の対応 |
| `2026-10-13-plan-review-xoauth-20261013-03.md`（X OAuth #1470） | D1 保存が成り立たず読み直しも失敗すると、つなぎ直しの通知が出ない | #1505: 読み直し・復号の失敗を捕まえ、理由つきで通知してから投げる | U1 古い refresh と再連携の重なり（仕様の判断）、U2 state の期限・アカウントの固定、U3 呼び出し側の接続、U4 実行環境・鍵の版の移行 |

次の点検の報告が来たら、同じ形（実在の確認 → 直す → 修正前に落ちる再現テスト → U は残す理由を書く）で扱う。

## 次にやること（tasks.md の「実装の順番」）

1. **21 cron `sns-metrics`**（48h/7d の取り込み）: `sns_metric_jobs`（154 のトリガーで posted のときに2件できる）の due を処理。YouTube は `videos.list` の累積値、X は `GET /2/users/{id}/tweets`（読み取りの前に `reserve_sns_x_read`）。累積値は時刻から15分以内なら保存、超えたら欠測（154 の CHECK）。collector の JS 側の「遅い snapshot を欠測にする」処理も15分に合わせる（metrics の contract に記載）。完了の定義の3行（件数・タイミング・継続監視）がある
2. **23 UTM**、**22 cron `sns-daily`**（YouTube Analytics の暦日と GA4、`sns_channel_daily`。D−3〜D−1 を取り直す）
3. **20 費用**: `reserve_sns_x_read` は 21 で呼ぶ。「期間の終わりの3日前の Slack」は月の自動切り替え（158）にしたので、12 の auto-plan で「自動で切り替わる・額」を知らせる
4. **19b /today の X 投稿**（158 の適用後）、**6〜8 素材 v1**（X 用の 720×1280 を含む）、**9〜11 検査**（9・10 が入るまで送る前の検査は必ず `source_check_unconfigured` で止まる＝外部投稿ゼロ）、**12 auto-plan**（`roll_sns_send_baselines`・`roll_sns_x_send_period` を毎回呼ぶ、item は優勝戦・準優勝戦だけ、JST 5:30〜21:00）、**13〜15 止める・管理 API・画面**

## 気をつけること（このセッションで踏んだもの）

- **シェルの Node**: このマシンのシェルの既定は Node v16。`node --test` が動かないので、`export PATH=/Users/terukina/.nvm/versions/node/v22.20.0/bin:$PATH` を先に付ける
- **本番 DB の読み取り**: Supabase MCP が切れていることがある。そのときは `.env.local` の `SUPABASE_ACCESS_TOKEN` で Management API（`/v1/projects/{ref}/database/query` に `read_only: true`）を使い、SELECT だけを流す
- **Vercel の環境変数**: `vercel env ls` の時刻の列は作成日時（created）で、値を編集しても変わらない。更新を確かめるときは Vercel の API（`/v9/projects/{id}/env` の `updatedAt`）を読む。Sensitive の値は手元に取り出せない（確かめるのは token-health で）
- **管理 API は `export const config = { runtime: "edge" }`（または "nodejs"）が必須**: 無いと Node の (req, res) として呼ばれ、本番で 500 になる。#1494 で verify-admin-api-auth に検査を足した
- **ハンドラを Request で直接呼ぶテストでは、Vercel の呼ばれ方の違いは見つからない**: 新しい API は本番（または Preview）で一度叩いて確かめる
- **既存のファイルに整形（prettier）を丸ごとかけない**: 差分が数百行に膨らむ（snsDeadlineQueue.js で一度起きた）
- **手元のテストは1本ずつ・並列1**（オーケストレーターの負荷対策の指示。`node --test --test-concurrency=1`）
- **オーナーに渡すファイル**: `owner-apply-153-154.sql`・`orchestrator-checks-153-154.sql`・`owner-x-keys-setup.md`・`owner-google-oauth-production.md` は前のセッションの scratchpad にあり、次のセッションからは読めない。runbook（`docs/db-migration/153-runbook.md`・`158-runbook.md`）が正本。X の鍵の手順は tasks 8 の `docs/operation/sns-pdca-loop-runbook.md` に入れる（画面は console.x.com の App の右上の Settings）
