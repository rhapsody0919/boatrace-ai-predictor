# SNS PDCA ループ: システム設計

[spec.md](spec.md)・[screens.md](screens.md) の実現方法。既存の送信契約（SQL137・139・140・146・148）と観測契約（SQL136）は作り直さず、足りない所をつなぐ。重要な判断は ADR 0090〜0094（0094 が自動送信そのものの決定）。

## 全体構成

```mermaid
flowchart TB
  subgraph Mac[オーナーの Mac]
    CX[Codex 集客レーン<br/>素材バンドル v1・週次の改善案ファイル] -->|ファイル| HQ[hq]
    HQ -->|npm run sns:push-bundle| PB[scripts/sns/push-bundle.js<br/>.env.local の service key]
    HQ -->|npm run sns:push-insights| PI[scripts/sns/push-insights.js]
    HQ -->|npm run sns:weekly-export| WE[scripts/sns/weekly-export.js]
  end
  subgraph Supa[Supabase]
    ST[(Storage sns-hub-media)]
    BI[(sns_bundle_imports・sns_drafts)]
    AI[(sns_auto_send_items 153)]
    J[(sns_x_send_jobs・control)]
    TK[(sns_oauth_tokens 154)]
    MJ[(sns_metric_jobs 154)]
    OB[(sns_metric_observations 136)]
    CD[(sns_channel_daily 154)]
    SI[(sns_strategy_insights 039)]
  end
  subgraph Vercel[Vercel Cron（ADR-0066）]
    C1[api/cron/sns-auto-plan 5分ごと<br/>検査→事前通知→自動承認]
    C2[api/cron/sns-send 2分ごと<br/>sweep→claim→送信]
    C3[api/cron/sns-metrics 5分ごと<br/>48h・168h の取り込み]
    C4[api/cron/sns-daily 1日1回<br/>GA4・YouTube 日次]
    C5[api/cron/sns-insights 週1回<br/>自動採用]
  end
  PB --> ST & BI
  PI --> SI
  BI --> C1 --> AI & J
  C1 -->|Slack| SL[事前通知]
  SL -->|署名付きリンク| STOP[api/sns-stop/:token]
  STOP --> AI & J
  J --> C2 -->|X API・YouTube API| EXT[X・YouTube]
  C2 --> TK
  J --> MJ --> C3 --> OB
  C4 --> CD & OB
  C5 --> SI
  OB & CD --> WE --> HQ
```

## 1. 素材の受け渡し（spec A8、ADR 0090）

- **v1 の形式**: v0（`ryujin-preview/0`）のファイル構成・検査をそのまま使い、`schema_version=ryujin-preview/1` を足す。v1 で増えるもの:
  - `bundle.json` の `x_thread`: `[{index, text, media?}]`（親が index 0、最大6件）。URL は index 0 にだけ置く（spec の費用の決まり）
  - `bundle.json` の `claims[]`: `{id, text, value, source:{endpoint, path}}`。`endpoint` は龍神の公開 API（例 `/api/races/{raceId}`）、`path` はその JSON の中の場所。A3 の照合で使う
  - `bundle.json` の `race_id`・`screen_key`。**締切は bundle の値を使わず、DB の races から計算する**（Codex の値を信用しない）
  - 動画は1本 32 MiB まで（送信契約と同じ）
- **運び方**: `scripts/sns/push-bundle.js <素材フォルダ>`（新規）。既存の `validateBundle` を Node から呼んで検査し、`bundleStore.saveFile` と同じパスへ Storage に直接上げ、取り込みの RPC を呼ぶ。Vercel を経由しないので 4.5 MB の制限を受けない。鍵は本体の `.env.local` を読む（Codex には渡さない。hq が実行する）
- **管理画面の手取り込み**（`BundleImportPanel`）は v0 のために残す
- **v0 の公開保留は5か所にあり、v1 では全部を変える**（153）:
  1. `sns_bundle_imports.schema_version` の CHECK（v0 だけ）→ v0・v1
  2. `import_sns_preview_bundle`（v0 だけ・X は1件）→ v1 は X スレッドの本数分の下書きを作る
  3. 一意索引 `sns_drafts_bundle_version_channel_language`（版×媒体×言語で1件）→ `sns_drafts.thread_index`（既定0）を足し、索引に含める
  4. `guard_sns_preview_bundle_draft` → v1 は item の検査が合格した下書きだけ `publish_blocked=false`・`publication_hold_reasons=[]` にでき、approved・posted に進める
  5. 送信の関数の `bundle_import_id IS NOT NULL` の拒否（`approve_sns_x_send`・`transition_sns_send_139`・`youtube_call_guard`）→ v1 で検査合格なら通す
  v0 は5か所とも今のまま

## 2. 自動承認と事前通知（spec A3〜A7・A10、cron `sns-auto-plan`、ADR 0094）

5分ごと（JST 8:00〜21:00）。1回の流れ:

```mermaid
flowchart TD
  A[今日の v1 下書きで、まだ item が無いレース] --> B[item を作る checking<br/>締切は races から。notify_by=締切-3h, veto_until=締切-60m]
  B --> C{検査}
  C -->|禁止表現: risk-rules・用語| D
  C -->|数値の照合: claims を公開 API で読み直す| D
  C -->|リンク先の表示: 未認証ヘッドレス| D
  D{全部通過?} -->|いいえ| H[held_manual<br/>理由を保存→個別承認の画面へ]
  D -->|はい| E{チャネルのモード}
  E -->|個別承認| M[manual<br/>検査の結果だけ画面に出す]
  E -->|自動| F{新しい型?}
  F -->|はい| M
  F -->|いいえ| G{今 ≤ notify_by?}
  G -->|いいえ| M
  G -->|はい| N1[notifying<br/>token の hash を CAS で書く]
  N1 --> N2{Slack に送れた?}
  N2 -->|いいえ・タイムアウト| H
  N2 -->|はい| N3[notified]
  N3 --> N4[自動送信の承認者で approve<br/>X は親から順に。子の parent_job_id は直前の投稿の job]
```

- **数値の照合**（A3）: `claims[].source.endpoint` を本番の公開 API から新しく取得し、`path` の値と `claims[].value` を照合する（数値は桁を含め完全一致、文字列は正規化後に一致）。不一致・取得失敗・endpoint が許可リスト（`/api/races/`・`/api/analogy/` 等、/step4 で一覧を固定）に無いものは不合格。Codex の `QA.pass` は見るが、それだけでは通さない。**送る直前の preflight でも同じ照合をもう一度行う**（`readCurrent` の中）
- **個別承認の画面と同じ条件**: 自動の分岐でも、`approve_sns_mobile_channel` が見る条件（qa.pass・numeric_claims_match・release_evidence・claims が空でない）を item.checks に対して検査する
- **リンク先の表示**（A2）: 既存の `createDeadlinePreflight` の `headless` を実装する（ADR 0091）。`markers` は `scripts/lib/snsScreenMarkers.js` に画面ごとの印を固定する（/step4 で実画面で決める）。結果を `release_evidence` として下書きに保存
- **禁止表現**: 既存の `scripts/lib/riskRules.js` と `sns-video-studio/remotion/risk-rules.json`、用語の検査（競艇・類似レース）
- **新しい型**（A10）: bundle の `format`・`template_variant` が、過去に `posted` になった下書きに無ければ新しい型として個別承認へ
- **事前通知の順番**: `checking → notifying`（token の hash を条件付き UPDATE で書く。cron が2回走っても通知とリンクは1つ）→ Slack（`unfurl_links:false`）→ `notified` → approve。**Slack に送れないときは approve しない**ので、通知が届かないまま送られることは無い
- **自動送信の承認者**: 153 で `sns_approvers` に「自動送信（止められなかった）」を `active=false`（管理画面の選択肢に出さない）で入れる。分岐は表示名の文字列ではなく `sns_auto_send_control.auto_approver_id`（153）で行う
- **スレッド**: 親（thread_index 0）を approve → 返った job の id を子の `source_data.deadline_queue.parent_job_id` に書く → 子を approve、を順に行う。返信先は**直前の投稿**（index n の子は n-1 に返信。見た目が普通のスレッドになる）。子の `scheduled_at` は親から index×1分ずつずらし、runner は「親が posted の子」だけを選ぶ（同時に claim して `parent_not_posted` で held に落ちないため）
- **送る時刻**（A7）: `sns_x_send_control.schedule_minutes=60`、`timing_approved=true`（ユーザー決定 Q1。本番 SQL でオーナーが設定）。`expiry_minutes=30` は維持
- **鮮度**（`max_source_age_seconds`）: 承認は締切の3時間前より前に起きるので、`source_observed_at` からの経過は送る時点で2時間を超える。値は 4時間（14400秒）にし、送る直前の preflight で `readCurrent` が版と締切を新しく読み直すことで鮮度を担保する

## 3. 止める操作（spec A6、ADR 0092・0094）

- **止めるのは「許可のリスト」で効かせる**（153）: 自動送信の承認者の job は、`transition_sns_x_send` の `claim`・`check`・`begin_post`・`youtube_publish_begin` のたびに「item.state='notified' かつ チャネルの mode='auto' かつ dry_run=false」を確かめ、外れたら `hold('auto_stopped')`。X はさらに `now() >= veto_until` を確かめる。YouTube の非公開アップロードの claim は veto_until を待たない（通知の時点で始める）が、公開（`youtube_publish_begin`）は `now() >= veto_until` を確かめる。これで、止める・自動を切る・通知の失敗のどれも、item か control の1行の UPDATE で次の外部呼び出しの前に効く
- **Slack のリンク**: `https://www.boat-ai.jp/api/sns-stop/<token>`。token は item ごとのランダム 32 バイト、DB には SHA-256 だけを保存。期限は `veto_until`＋30分。GET は確認の画面（対象と「この投稿を止める」ボタン1つ）を返すだけで、止めるのは POST。応答に `Cache-Control: no-store`・`Referrer-Policy: no-referrer`・`X-Robots-Tag: noindex` を付ける。管理画面の Basic 認証は通らない。できるのは「その item を止める」ことだけ
- **管理画面**: `POST /api/admin/sns-hub/auto-send` `{action:'stop', itemId}` / `{action:'mode', channel, mode:'manual'}`（自動を切る）/ `{action:'mode', channel, mode:'auto', approverId}`（自動にする。承認者が「本人」で、L3 の条件を満たすときだけ）/ `{action:'incident', channel, itemId?, note}`（誤投稿の記録）
- **`stop_sns_auto_item`**（153）: item を `stopped` にする（これで上の許可のリストが外れ、以後の外部呼び出しは止まる）。そのうえで job の状態ごとに後片付けをする:
  - `queued`・`held`: 既存の `cancel` で取り消し、下書きを `pending_review` に戻す
  - YouTube で非公開アップロード済み（`youtube_stage` が uploaded・ready）: `youtube_retain` で非公開のまま残す
  - YouTube のアップロード途中（ID がまだ無い）: そのまま。アップロードが終わって ID が付いた後の `youtube_publish_begin` が許可のリストで止まり、`youtube_retain` に回る
  - `sending`・`reconcile`・`posted`: 触らない（148 のガードで下書きを変えられない）。返り値で「送信が始まっていた」を知らせる
- **自動を切る**: `sns_auto_send_control.mode='manual'`。`notified` の item は許可のリストから外れるので、それ以上は送られない。item は `stopped`（`stopped_via='mode_off'`）にし、後片付けは上と同じ

## 4. 送信（spec A1・A9、cron `sns-send`）

- 2分ごと（JST 8:00〜21:00）。`createScrapeCronHandler`（`scripts/lib/scrapeJobs/cronWrapper.js`）に新しいジョブ `sns_send` を登録する（ADR-0066 改訂1 に、外部サイトを取得しないジョブが乗った先例がある）。`maxDuration=300`、`leaseSec` は300以上。monitor の死活の通知は JST 8:00〜21:30 だけにする（レジストリにジョブごとの稼働時間を足す）
- 1回の流れ: `xSendStore.sweep()` → `queued` で `scheduled_at` を過ぎた job（子は親が posted のものだけ）を古い順に最大3件 → チャネルごとに既存の `runXSendJob` / `runYoutubeQueueJob` / `runYoutubePublishJob` を呼ぶ
- **X adapter**（新規 `api/_lib/xApiAdapter.js`）: fetch で X API v2 を直接呼ぶ。`initialize`/`append`/`finalize`/`status` は `/2/media/upload/*`、`createPost` は `POST /2/tweets`（子は `reply.in_reply_to_tweet_id`）。動画は Storage から読み、5 MB ずつ送る
- **X のトークン**（ADR 0093）: 154 の `sns_oauth_tokens` に AES-256-GCM（IV と認証タグを列に持つ）で暗号化して保存。refresh は X の HTTP をはさむので1つのトランザクションにはできない。`lock_until` と `locked_by` を条件付き UPDATE で取り、保存は `WHERE locked_by=自分` の条件付き UPDATE にする。ロックは HTTP のタイムアウト（30秒）より長い90秒。refresh に成功して保存に失敗したら refresh token を失うので、Slack に「X の連携のやり直しが要る」と通知する
- **YouTube adapter**（新規 `api/_lib/youtubeQueueAdapter.js`）: `upload` は再開可能アップロード（privacyStatus=private）。32 MiB なら1回の関数で終わる見込みなので、**続きから送る仕組みは作らない**（関数の時間内に終わらなければ reconcile で止まり、オーナーの照合に回る）。`processing`・`makePublic`・`lookup` は `videos.list`・`videos.update`。既存 `youtubeUpload.js` のトークン取得を使う。サムネイルの Content-Type を媒体に合わせる
- **試運転**（A9）: `sns_auto_send_control.dry_run=true`（153、初期値 true）のあいだは **claim の前で止める**（X の月の予約・日次の枠・YouTube のクォータを消費しないため）。検査・preflight（ヘッドレスを含む）までを行い、結果を item.checks の `dry_run` に残す。dry_run が true のまま L2 に入らないよう、管理画面と毎日の Slack の要約に「試運転中」を出す
- **毎日の基準日**: 既存の契約は、claim に `daily_baseline_date = 当日 JST`（X）と `quota.baseline_day = 当日 PT`・`verified`（YouTube）を求め、オーナーが毎日 SQL で更新する前提になっている。自動送信ではこれを毎日手でやるのは続かない。**案: `sns-auto-plan` の最初の回が、その日の基準日を当日にし、`daily_external_count`・`external_uploads`・`external_general` を0で入れる**（オーナーが手で出した投稿があれば管理画面から足す）。これは既存の契約の変更なのでユーザーの判断に回す（下の「確認が要る点」）
- **費用**: X は既存の予約台帳のまま。153 で `renew_sns_x_send_period(start, end)`（オーナーが本番 SQL で実行。今の期間が終わってからだけ実行でき、`reserved_microusd` を0に戻す）を足す。期間の終わりの3日前から Slack に知らせる。取り込みの読み取りも同じ台帳に予約する（154 の `reserve_sns_x_read`。残りが「月の残り日数×1日の送信の予約額」を下回ったら拒否）

## 5. 取り込み（spec C1〜C4、cron `sns-metrics`・`sns-daily`）

- **ジョブの作り方**: job が `posted` になったら、154 のトリガーで `sns_metric_jobs` に `(draft_id, window, source)` を作る（`due_at = posted_at + 48h / 168h`）。X はスレッドの子にも作る（子ごとの表示・クリックを見るため。読み取りは1件 $0.001 なので月 $0.4 程度）
- **`sns-metrics`**（5分ごと、終日。許容差15分に対して1回抜けても間に合うように）: `due_at` を過ぎた pending を処理する
  - YouTube: `videos.list(statistics)` の累積値（views・likes・comments）を `measurement_kind='snapshot'` で保存
  - X: `GET /2/users/{id}/tweets`（自分の投稿、Owned Reads $0.001）の `public_metrics`・`non_public_metrics`・`organic_metrics`。投稿から30日を過ぎると非公開の指標は取れないので、168h でも十分に間に合う
  - 時刻: 136 は「累積値は対象の時刻ちょうど（`observed_at = period_end`）だけ保存できる」。cron では秒単位で合わせられないので、**154 で許容差を足す（未確定。下の「確認が要る点」）**。許容差を超えたら値を null・欠測理由「取得が遅れた」で保存する
  - 失敗は `attempts` を増やし、3回続けたら Slack（spec C4）
- **`sns-daily`**（1日1回、JST 10:00）:
  - YouTube Analytics の動画ごとの日次（engagedViews・averageViewPercentage・subscribersGained）を `sns_channel_daily` ではなく観測の表へ、`measurement_kind='period'`・`window` は投稿日〜翌日の2日の値として保存したいが、136 の窓は 48h/168h に固定で暦日の窓を入れられない。**暦日の値は 154 の `sns_channel_daily`（draft_id 任意）に入れる**。版の判定（spec 統計検証）はこの表の「投稿日＋翌日」を使う
  - GA4: 前日の X の UTM（`utm_content=draftId/variantId`）ごとのセッション・ユーザー・ソナーを開いた人、YouTube 経由（プロフィールの UTM＋参照元 youtube）の日次を `sns_channel_daily` へ。クエリは `scripts/analysis/sns-pdca-baseline/ga4-sns-inflow.js` と同じ流入元の完全一致のリスト（共通部分を `scripts/lib/snsGa4.js` に出す）
- **UTM**: X の親の投稿の URL は送信の承認時に `buildObservationUtm` で作る。136 の `sns_post_tracking` は campaign が `sonar-preview` 固定・`template_variant_id` 必須なので、154 で campaign に `race-full` を許し、`template_variant_id` を任意にする
- **鍵の置き場**: `YOUTUBE_ANALYTICS_*`（3つ）、`GOOGLE_SERVICE_ACCOUNT_KEY`（GA4、Vercel に未登録なら追加）、`SNS_TOKEN_ENC_KEY`、`X_OAUTH_CLIENT_ID`・`X_OAUTH_CLIENT_SECRET` を Vercel の環境変数（Production）に登録する。手順は tasks の段階でオーケストレーターに渡す

## 6. 改善案（spec B1〜B4、cron `sns-insights`）

- **自動採用**（B1）: 週1回（月曜 JST 5:00）。`status='proposed'` かつ `created_at` が7日以上前の案を、`scripts/lib/riskRules.js` で照合し、通れば `active`（`activated_at`、`decision_note='自動採用（1週間止められなかった）'`）、触れれば `retired`（`decision_note='自動で外した: <規則名>'`）。ADR 0030 に 2026-10-12 の追記を足す
- **保存**（B2）: `scripts/sns/push-insights.js <ファイル>`。既存の `createInsight` を使い、`research_method='codex-weekly'`、`source='own-metrics'`
- **次の生成へ**（B3）: `scripts/sns/weekly-export.js` が `active` な案と、観測の表（投稿ごと・版ごと）を1つの JSON に書き出し、hq が Codex に渡す。v1 bundle の `bundle.json` に `referenced_insight_ids` を入れてもらい、取り込みで `sns_drafts.referenced_insight_ids` に入れる
- **週次の数字**（B4）: 同じ `weekly-export.js` の出力に入れる（spec 統計検証の「守り」の判定もここで計算する）

## 7. 画面（screens.md）

- `src/pages/admin/sns-hub/AutoSendPanel.jsx`・`.css`（新規）。`GET /api/admin/sns-hub/auto-send` で `{controls, items, conditions}` を返す。`conditions` は L3 の条件（チャネルごとの実送信件数、`posted` で誤投稿として記録された件数＝154 の `sns_auto_send_incidents`、`reconcile` の件数、止める操作の本番試験の記録）
- `?auto=<itemId>` で該当の item を先頭・強調（screens #4）
- X との連携（screens #10）: `GET /api/admin/sns-hub/x-oauth/start`（state と PKCE の verifier を作り、HttpOnly の Cookie に入れて X の許可画面へ）→ `GET /api/admin/sns-hub/x-oauth/callback`（state を照合し、コードをトークンに替えて `sns_oauth_tokens` へ暗号化して保存）。X の Developer Console のコールバック URL に本番の URL を登録する（オーナー）
- `MobileApprovalPanel` の説明文と、`held_manual` の理由のバッジ。`DeadlineQueueList` に自動・止めた・止められる期限。`InsightCard` に自動採用までの日数
- 検査の結果の表示は `MobileRaceReview` から部品 `GateChecks` を切り出して共用

## データ設計

マイグレーション案: [153_sns_auto_send.sql](../../db-migration/153_sns_auto_send.sql)、[154_sns_tokens_metric_jobs.sql](../../db-migration/154_sns_tokens_metric_jobs.sql)。どちらも新しい表は RLS 有効・service_role だけ。

`node scripts/maintenance/generate-er-diagram.js sns-pdca-loop` の出力（引用符つきの列名 `"window"` は生成器が拾わない）:

```mermaid
erDiagram
    sns_auto_send_control }o--|| sns_approvers : "switched_by -> id"
    sns_auto_send_control }o--|| sns_approvers : "auto_approver_id -> id"
    sns_auto_send_items }o--|| sns_bundle_imports : "bundle_import_id -> id"
    sns_auto_send_incidents }o--|| sns_auto_send_items : "item_id -> id"
    sns_x_send_jobs }o--|| sns_auto_send_items : "auto_item_id -> id"
    sns_metric_jobs }o--|| sns_drafts : "draft_id -> id"
    sns_channel_daily }o--|| sns_drafts : "draft_id -> id"
    sns_auto_send_control {
        TEXT channel PK
        TEXT mode
        BOOLEAN dry_run
        DATE live_started_on
        TIMESTAMPTZ stop_tested_at
        TIMESTAMPTZ switched_at
        UUID switched_by
        UUID auto_approver_id
        TIMESTAMPTZ updated_at
    }
    sns_auto_send_items {
        UUID id PK
        UUID bundle_import_id
        TEXT channel
        TEXT race_id
        TIMESTAMPTZ deadline_at
        TIMESTAMPTZ notify_by
        TIMESTAMPTZ veto_until
        TEXT state
        JSONB checks
        TEXT held_reason
        TIMESTAMPTZ notified_at
        TEXT stop_token_hash
        TIMESTAMPTZ stopped_at
        TEXT stopped_via
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }
    sns_auto_send_incidents {
        UUID id PK
        UUID item_id
        TEXT channel
        TEXT note
        TIMESTAMPTZ recorded_at
    }
    sns_x_send_jobs {
        UUID auto_item_id
    }
    sns_drafts {
        SMALLINT thread_index
    }
    sns_oauth_tokens {
        TEXT provider PK
        TEXT ciphertext
        TEXT iv
        TEXT auth_tag
        INTEGER key_version
        TIMESTAMPTZ access_expires_at
        TIMESTAMPTZ refreshed_at
        TIMESTAMPTZ lock_until
        UUID locked_by
        TEXT account_id
    }
    sns_metric_jobs {
        UUID id PK
        UUID draft_id
        TEXT source
        TIMESTAMPTZ due_at
        TEXT state
        INTEGER attempts
        TEXT last_error
        TIMESTAMPTZ done_at
        TIMESTAMPTZ created_at
    }
    sns_channel_daily {
        UUID id PK
        DATE day
        TEXT channel
        UUID draft_id
        TEXT utm_content
        TEXT source
        TEXT metric_name
        NUMERIC metric_value
        TEXT missing_reason
        TEXT definition
        TIMESTAMPTZ observed_at
    }
```


## 既存の契約との整合

| 既存の契約 | この設計での扱い |
|---|---|
| 承認 hash・snapshot（137・140） | そのまま。自動承認も同じ snapshot を作る |
| 期限キュー（139）の 90分前・30分失効 | 60分前（Q1）に設定値を変える。コードは変えない |
| 案B（146） | そのまま。非公開アップロードを通知の時点に、公開を `veto_until` 以降に |
| 投稿済みの承認保護（148） | そのまま |
| v0 の恒久保留（135） | v0 はそのまま。v1 だけ検査を通れば解除 |
| X の月 $10（137） | そのまま。月の切り替えの関数を足す。上限額はユーザーの回答待ち |
| 観測（136） | 表はそのまま。累積値の時刻の許容差と、UTM 表の制約だけ 154 で緩める |
| 改善案（039・ADR 0030） | 表はそのまま。自動採用を戻す |
| `.claude/CLAUDE.md` の個別承認 | L3 の前に変更（[rule-change-proposal.md](rule-change-proposal.md)） |
| x-send の contract「過去の承認から自動 queue 化しない」「本人を検査」、deadline-queue の contract「親子は個別承認」 | ADR 0094 で例外を定め、/step4 で各 contract に「自動送信の承認者は ADR 0094 の条件でだけ通る」を追記する |
| 毎日の基準日（139・146） | 自動で当日にする案。ユーザーの判断待ち |

## 確認が要る点（オーケストレーター経由でユーザーへ）

1. **累積値の時刻の許容差**: 136 の契約で「未承認」のまま。推奨は「48h・168h の時刻から15分以内に取れた値を保存し、実際の取得時刻を `observed_at` に残す。15分を超えたら欠測」。理由: cron は5〜10分ごとで、秒単位では合わせられない。Shorts の再生は2日で99%が出るので、15分のずれは値にほぼ影響しない
2. **X の月額上限**（spec の未確定のまま）
3. **毎日の基準日を自動にするか**: 既存の契約は、X の `daily_baseline_date`（JST）と YouTube の `baseline_day`（PT）・`verified` をオーナーが毎日 SQL で当日にしないと送れない。推奨は「`sns-auto-plan` の最初の回が当日にし、他の経路の本数は0で入れる。手で出した投稿があれば管理画面から足す」。理由: 毎日の手作業が1回でも抜けるとその日は送れず、自動送信の意味が無くなる。他の経路の本数を0とみなす危険は、オーナーが手で出したときに足し忘れると日次上限を1本超えうること（上限は Shorts 1・X 1 なので、超えても1本）

## 設計検証（system-architect、2026-10-12）の指摘と対応

本番の読み取り（制約名・行数・関数の定義）と既存の SQL で根拠を確かめたうえで採否を決めた。

| 重さ | 指摘 | 対応 |
|---|---|---|
| P0 | v1 を取り込めない（`sns_bundle_imports` の CHECK と取り込み関数が v0 だけ） | 採用。§1 の5か所の変更に入れた（135:8 で再現） |
| P0 | 1バンドルに X の下書きは1件しか作れず、スレッドと衝突する（一意索引） | 採用。`thread_index` を足して索引に含める（135:26-28 で再現） |
| P0 | 公開保留の解除が approve だけでは足りない（`transition_sns_send_139`・`youtube_call_guard` も拒否） | 採用。§1 の5番（139:137・146:174 で再現） |
| P0 | 止めても claim 済みの job は送られる | 採用。許可のリストを claim・check・begin_post・youtube_publish_begin の全部で見る（§3） |
| P0 | Slack の通知が失敗しても送られる（approve が先） | 採用。通知→approve の順にした（§2） |
| P1 | YouTube の非公開アップロードが veto_until まで始まらない | 採用。veto_until で止めるのは X の claim と YouTube の公開（§3） |
| P1 | YouTube を止めたときの穴（reconcile での RAISE、ID が無いときの retain） | 採用。job の状態ごとの後片付け（§3） |
| P1 | 親子の結びつけの手順と、同時 claim で子が held に落ちる | 採用。親から順に approve、子は親が posted のものだけ選び、時刻をずらす（§2・§4） |
| P1 | 既存の契約の文言と衝突し、自動送信そのものの ADR が無い | 採用。ADR 0094 を足し、contract への追記を tasks に入れる |
| P1 | 毎日の基準日の手作業 | 案を出してユーザーの判断に回す（確認が要る点 3） |
| P1 | 鮮度の検査と通知の時刻の食い違い | 採用。4時間＋送る直前の読み直し（§2） |
| P1 | `sns_channel_daily` の式の一意索引は PostgREST の upsert に使えない | 採用。`UNIQUE NULLS NOT DISTINCT` の制約にする（154） |
| P1 | X トークンの refresh は1トランザクションにできない | 採用。`locked_by` の条件付き UPDATE（§4・ADR 0093） |
| P1 | 試運転で予約・クォータを消費する | 採用。claim の前で止める（§4） |
| P2 | 個別承認の画面の条件を自動では通らない | 採用（§2） |
| P2 | 自動送信の承認者が選択肢に出る | 採用。`active=false`、分岐は ID（§2） |
| P2 | maxDuration 800 は ADR-0066 改訂1 の300秒と食い違う | 採用。300秒にした（ヘッドレスは `sns-auto-plan` 側。0091 に記載） |
| P2 | 死活の監視が夜に誤って鳴る | 採用。稼働時間をレジストリに足す（§4） |
| P2 | `scrape_job_runs` は無い | 採用。試運転の記録は item.checks（§4） |
| P2 | `draft_ids UUID[]` に FK・一意が無い | 採用。153 で `sns_x_send_jobs.auto_item_id`（FK）にし、item の `draft_ids` は持たない |
| P2 | `youtube_upload_session` が承認の更新で消えず、画面の JSON に出る | 採用。続きから送る仕組み自体をやめ、列を足さない（§4） |
| P2 | `renew_sns_x_send_period` が今の期間の途中でも実行できる | 採用。`now() >= period_end` を条件にする |
| P2 | `weekly-export.js` は1000行の上限にかかる | 採用。`.range()` で読む（tasks に入れる） |
| P3 | `GRANT ALL` は広い | 採用。SELECT・INSERT・UPDATE に絞る |
| P3 | Vercel Cron の本数（今54本＋5本） | 上限は100本（一次情報で確認済み）。問題なし |
| 情報 | 148 は本番に適用済みなのに APPLIED.md は未適用 | 別 PR（#1452）で更新中とオーケストレーターから聞いている。このPRでは触らない |
