# SNS 配信の基盤レーンの引き継ぎ

SNS 配信の基盤レーン（範囲: sns-hub・`scripts/sns/push-*.js`・送信・計測・日の枠・TYPE_IMPL）の担当が、最初に読む要点。1行ずつの知見は [docs/knowledge/sns-send-ops.md](../knowledge/sns-send-ops.md)・[x.md](../knowledge/x.md)・[youtube.md](../knowledge/youtube.md) にあり、ここでは重ねない。ここにあるのは、仕組みの地図・本番の設定・未解決・見張りの手順。

## 仕組みの地図

| 投稿 | 作る所 | 送る所 | 承認 |
|---|---|---|---|
| /today の X（毎朝 8:00） | `scripts/lib/snsTodayPlanner.js`（cron `sns_auto_plan`、7:30 に下書き） | `scripts/lib/snsSendRunner.js`（cron `sns_send`、2分ごと） | 自動の承認者（`approve_sns_x_send`） |
| 全貌（X・YouTube 完全版・Shorts） | hq の作り手 → `scripts/sns/push-full-picture.js` | 同上 | 同上 |
| 計測 | `sns_metrics`（投稿ごとの窓）・`sns_daily`（JST 10:00、`scripts/lib/snsDailyRunner.js`） | — | — |

- /today の本文: 見出し（`config/today-variants.json` の案 a・b を日の偶奇で）→ 空行 → 「今日の一覧はこちら：{UTM 付き URL}」→ 注目レース・区分・一覧 → 末尾は注意書き（#1769）。重み付けの長さは 600 台で、長文（`thread_length=1`、25,000 まで）として送る。10/19 以降、この長さで毎日送れている
- /today の画像: 龍神ソナーの図（`.af-hep .af-dark`）を最大4枚。`api/_lib/snsHeadless.js` の `captureElement` で、撮った後に位置を測り直し、上下の色が `--ryujin-navy-600` かを確かめる。合わなければ `screenshot_misframed`、CSS の変数が無ければ `screenshot_edge_color_missing`（#1802、BOA-1013）
- 全貌: bundle の版2（`bundle_version: 2`）で YouTube の Shorts を足す。Shorts は `parent_job_id` で完全版の公開を待ち、説明文の `{full_url}` を送る時に完全版の URL に置き換える（#1714、ADR-0094 の追記、マイグレーション 172 の `sns_auto_send_items.variant`）。契約の表は `docs/design/full-picture-remotion/handoff.md`「送信の道への受け渡し」
- 全貌の URL の UTM: `utm_campaign=race-full`・`utm_content=<race_id>`（YouTube は `utm_term=full|shorts`）。作り手が付ける（#1767）

## 本番の設定（2026-10-20〜21 にオーナーが適用）

| 表 | 値 |
|---|---|
| `sns_auto_send_control` | x・youtube とも `mode=auto`・`dry_run=false` |
| `sns_x_send_control` | `daily_limit_x=3`・`daily_limit_youtube=3`（全貌 1レース/日 × 2件＋予備1）・`paused=false` |
| `sns_youtube_quota_control` | `verified=true`・`upload_limit=100`（videos.insert の別枠の既定）・`general_limit=10000`（Queries per day）。基準日は `sns_auto_plan` が live のときだけ `roll_sns_send_baselines` で進む |
| `scrape_job_state` | `sns_auto_plan`・`sns_send`・`sns_metrics`・`sns_daily` とも live |
| Linear の起票の関所 | 230件以上で止める（`scripts/lib/linearIssueGate.js`、AGENTS.md、#1708） |

止めるとき: チャネルだけなら `sns_auto_send_control.mode='manual'`、全部なら `sns_x_send_control.paused=true`。

## 未解決（2026-10-27 時点）

| チケット | 内容 | 状態 |
|---|---|---|
| BOA-1164 | 全貌の YouTube 完全版が `private_retained` で残り、要照合の知らせが止まらない | #2006 でマージ済み。マイグレーション 186 はオーナーの db-apply 待ち。当たった後の最初の sns_send の live で、job 0853d7d9・0883093d が cancelled・youtube_closed_deleted になるか、要照合の知らせが止まったか、verify-rpc-output-keys.js が通るかを見る |
| BOA-988 | YouTube 初回で見えた3点: 一度 reconcile（`post_outcome_unknown`）に落ちてから posted に戻った／posted の後も `youtube_stage=update_started`／埋め込み無効（oEmbed 401） | Backlog |
| BOA-981 | /today のまくりの行の図が、本文の注目の艇ではなく1号艇を強調する（/today の型の変更なので x-channel が要る） | Backlog |
| BOA-973 | YouTube の送信が太平洋時間の日付の境目（JST 16:00、11/1 から 17:00）をまたぐと、非公開のまま `youtube_quota_unconfirmed` で止まる | 2026-10-27 に Linear で見つからない（アーカイブか削除）。直っていない |
| BOA-998 | YouTube Analytics が視聴0の日に行を返さず、「未確定の可能性」の NULL のまま D−3 で固定される | 2026-10-27 に Linear で見つからない（アーカイブか削除） |
| BOA-929 | e2e の録画が 10/02 から撮り直されず、PR の e2e が本番へ素通しで揺れる | Backlog（このレーンの範囲の外） |

ほかに、決めていないこと:
- `sns_daily` の全貌の行は、同じレースの YouTube 2件（完全版・Shorts）を `race_id|platform` で1件に畳む。Shorts の訪問が完全版の draft_id に付く（`snsDailyRunner.js` の fpDraft）
- 完全版の item だけを止めると、Shorts は親を待ったまま期限で切れる（`stop_sns_auto_item` は full_picture の枝を持たない）
- Shorts の説明文の URL が押せるリンクになるかは、オーナーの実機の確認の結果を受け取っていない

## 計測を読むときの注意

- YouTube Analytics の反映は2〜3日遅れる。10/21 の動画は、10/23 の回では「行を返さない」、10/24 の回で値が入った。`sns_daily` は D−3〜D−1（PT）を毎日取り直す
- 動画ごとの指標は views・engagedViews・averageViewPercentage・averageViewDuration・subscribersGained（averageViewDuration は #1807）。Shorts のスワイプされた割合は公開の API に無く、近いものは engagedViews / views
- GA4 は Cookie 同意者だけを数える。/today の UTM つきの来訪は、10/18〜10/25 で0件。全貌の UTM の行は 10/24 に初めて1件出た。効き目は、GA4 の UTM の行と X の Post Analytics（オーナーが見る）を同じ日で並べる。X API は `url_link_clicks` を返さない
- GA4 の流入元の上位に、サイト内の部品の名前（`data_race_table` など）が出る。サイト内のリンクの utm_source が流入元を上書きしている（未対応、原因の箇所は未特定）

## 見張りの手順（読み取りだけで済むもの）

- /today: `scrape_job_state` の `sns_auto_plan` の `cursor->'today'` の events（outcome・reason）、`format='today_digest'` の下書きの `source_data.image_paths` と `sns_x_send_jobs`。画像は Storage の `sns-hub-media` から取って全部見る
- YouTube: `channel='youtube'` の `sns_x_send_jobs`（state・error_code・youtube_stage・parent_job_id）と `sns_youtube_quota_attempts`。公開かは watch ページの `isPrivate`・`isUnlisted`・`playabilityStatus` で見る（oEmbed は埋め込み無効で 401 になる）
- 計測: `sns_channel_daily`（source・utm_content・draft_id）と `scrape_job_state` の `sns_daily`・`sns_metrics` の last_report
- PR の `mergeStateStatus=BLOCKED` は、CI が緑でも `reviewDecision=REVIEW_REQUIRED` のことがある（2026-10-21 以降）。オーケストレーターかオーナーの承認が要る
