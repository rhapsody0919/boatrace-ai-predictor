# ADR 0077: PRゲートのE2Eは録画（HAR）の再生と時計の固定で決定的に実行する

## ステータス

採用（2026-09-28、BOA-466）

## 背景

`.github/workflows/e2e-smoke-test.yml` はPRごとに `npm run test:e2e` を実行する。E2Eは次の2つに直結していた。

- 本番Supabase（ブラウザから `https://*.supabase.co/rest/v1/*`）
- `/api/*`（`vite.config.js` のプロキシで本番 `www.boat-ai.jp` へ転送。`src/services/supabaseDataService.js` の `EDGE_API_BASE=""`）

そのため同じコードでも、当日のデータと実行時刻で結果が変わった。

| 項目 | 実測 |
|---|---|
| PRごとのE2E（直近30回） | 成功16・失敗14 |
| フロントの `new Date()` | 約70箇所 |
| 夜間（JST 22:53）の実行でのskip | 1087件中9件（うち7件は「本日開催中の未終了レースが見つからない」、`selectUpcomingRace`） |
| 日中の実行でのskip | 1087件中2件（イン崩れ指数を持つ未確定レースが無い） |

コードに関係なく落ちるゲートは、「赤でもマージしてよいか」を毎回判断させる。判断の積み重ねで、本物の失敗も見過ごされる。

## 決定

### 1. PRゲートは録画を再生し、時計を録画時刻に固定する

共通fixture `e2e/fixtures.js` で `test` を extend し、全specの import をそこへ切り替えた。fixture は `context` に次を掛ける。

- `context.clock.setFixedTime(録画時刻)`: `Date` だけを固定し、`setTimeout` 等のタイマーは実時間で進める。既存の `waitFor`・アニメーション・リトライ間隔の待機はそのまま動く（`clock.install` はタイマーも止めるため採らなかった）
- `context.routeFromHAR(api.har, { url: /rest/v1/ と localhost の /api/, notFound: "fallback" })`: 録画に無いリクエストは**本番へ素通しする**（下記「5. A改」）。`E2E_REPLAY_STRICT=1` のときは abort する（自動撮り直しの検証用）
- それ以外の外部ホスト（ローカルdevサーバー以外）への通信は abort する。録画時に観測したのは Google Fonts・AdSense・YouTube埋め込み・Googleマップ・OpenStreetMapタイル等17オリジンで、どれもアサーションの対象ではない（通しても当日の広告・地図タイルで結果が揺れるだけ）

時計を固定するのは、フロントが「今」から組み立てるクエリ（日付・時刻）を録画時と同じURLにするため。Node側で当日の日付を組み立てていた箇所（`smoke.spec.js` の `/races/{本日}` 等）も `e2eNow()` / `e2eTodayJST()` に置き換えた。

### 2. 撮り直しは `npm run test:e2e:record`

- `E2E_RECORD=1`。`global-setup.js` が録画時刻を1つ決め、全テストがその時刻に時計を固定したまま本番へ繋ぐ。録画は context の `route` で対象URLを `route.fetch()` し、取った応答を1件ずつ HAR 形式で書き出してからブラウザへ返す
  - **録画中も「1つのリクエストには1つの応答」に揃える**。最初に取った応答を `test-results/.e2e-record-cache/` に置き、同じリクエスト（メソッド + 正規化したURL + POST本文）が来たら全ワーカー・全テストにそれを返す。テストごとに本番から取り直すと、録画に20分かかる間にデータが変わり（レースが終わる等）、束ねた録画が「一覧は古い時点・詳細は取っていない」という食い違いを持った。再生では一覧に出たレースを開いても詳細が録画に無く abort された（実測: イン崩れ演出のテスト2件）。揃えておけば、録画時に通った経路と再生時の経路が一致する。5xx はキャッシュせず、次に同じリクエストが来たら取り直す
  - `routeFromHAR` の `update: true` は使わない。page.route が差し替えた応答（spec が作った500や、件数を絞ったスタブ）まで録画し、同じURLを見る別のテストの再生を汚した（実測: `morning_digest_rows` を1枚に絞った応答が2枚のテストに返り、5件落ちた）。context の route は page.route より後に評価されるので、spec が差し替えたリクエストは録画に来ない
- `global-teardown.js` が全テストの HAR を束ねて `e2e/recordings/api.har` と `meta.json`（録画時刻・Supabaseのオリジン）に書く
- 束ねるときの規則（`e2e/har-merge.js`）
  - 「メソッド + URL + POST本文」で重複を落とし、最も早く録画された応答を残す。ただし5xx（本番DBの一時的な statement timeout 等）より成功した応答を優先する
  - 本文が無い応答は捨てる（`update: true` で録画していたとき、テストが先に終わって本文無しで残った応答が1回の録画で26件あり、再生が空応答になって6テストが落ちた）。録画時は fixture が context を閉じる前に対象リクエストの完了を最大30秒待つ
  - PostgREST の `in.(...)` の並びを揃える。フロントが race_id の一覧を非同期応答の到着順で組み立てる箇所があり、同じ画面でも実行ごとにURLが変わった（実測: `race_entries` の `global_2rate` 取得。並びは結果の集合に影響しない）。再生時は同じ正規化をした URL を `route.fallback({ url })` で routeFromHAR に渡す
  - ローカルのオリジン（ポートはworktreeごとに変わる）はプレースホルダに置き換え、再生時に実際の baseURL へ戻す
  - リクエストヘッダー（apikey・Authorization）は保存しない。撮り直すたびに変わるだけの応答ヘッダーも落とす
  - 応答本文は `e2e/recordings/bodies/<sha1>.json` に切り出し、`api.har` からは `content._file` で参照する（下記「サイズ」）
- 対象を絞った録画（spec のパス・`-g`・`--project` 等を付けた `npm run test:e2e:record -- ...`）は**部分録画**として扱い、既存の録画時刻に時計を合わせて、今回取った応答だけを既存の録画に上書き・追記する。全体を置き換えると、走らせていないテストの応答が消えてPRゲートがまとめて落ちるため（レビュー指摘）。判定に迷う引数は部分録画に倒す
- **録画は発走前のレースがある時間帯（JST10〜15時目安）に行う**。`selectUpcomingRace` 系が skip しない状態で撮る

### 3. 本番データでの実行は定期実行に移す

`E2E_LIVE=1`（`npm run test:e2e:live`）で従来どおり本番データ・実時刻で走る。`.github/workflows/e2e-live.yml` が JST14:00（UTC05:00）に実行し、失敗を Slack に流す（`nightly-verify-db.yml` と同じ webhook・attachments 形式）。`workflow_dispatch` も付けた。

### 4. 既存の個別 `page.route` は優先される

HAR は context に登録し、spec 側の `page.route` は page に登録される。page のルートが先に評価されるため、既存の差し替え（予測データ取得失敗・ピットレポートの回帰テスト）はそのまま効く。`route.fallback()` すれば HAR に落ちる。実測で確認した（`/rest/v1/venues*` を page.route で `[]` にした場合、HAR の応答ではなく `[]` が返った）。

例外が1つある。page.route の中で `route.fetch()`（実応答を取ってから加工する）を使うと、そのリクエストはブラウザの通信経路を通らずに直接ネットワークへ出るため、context の HAR では録画も再生もされない。再生時は本番へ出ようとして失敗した（`layout.spec.js` の BOA-460 再現テスト10件、`smoke.spec.js` の前検テスト1件）。`e2e/fixtures.js` の `fetchRecorded(route)` を代わりに使う。録画時は `route.fetch()` の結果を HAR に書き足し、再生時は録画から同じ応答を返す。`APIResponse` そのものではないので、`route.fulfill` には `status`・`headers` を明示して渡す。`route.continue()` も同じく context のルートを飛ばすので `route.fallback()` にする。導入初日に master 側で `route.continue()` 4箇所・`route.fetch()` 1箇所が新たに入ったため、`scripts/maintenance/verify-e2e-recorded-network.js`（Quality Gates で実行）で機械検査する。

もう1つ、テスト終了時の `page.unrouteAll()` は、context 側の録画の再生と競合して `Route is already handled!` で落ちる（実測: 展示前の体重テスト5件）。このフックは本番の応答待ちを捨てるためのものなので、replay では呼ばない。

### 5. A改: 録画に無い通信は素通しし、必ず一覧に出す（2026-09-29 改訂）

当初は録画に無い通信を abort していた。ところが、データ取得部分（`supabaseDataService.js`）を変える PR が1日に7本入り、PR ごとに撮り直す前提が成り立たなかった（導入初日だけで master 側の変更による撮り直しが3回要った）。そこで次に改めた。

- 録画に無い `/rest/v1/*`・`/api/*` は本番へ素通しする。CI には本番の読み取り用キー（anon）を渡す
- 素通しした通信は、メソッド・URL・どのテストかを `test-results/.e2e-passthrough/*.jsonl` に書き、`scripts/maintenance/report-e2e-passthrough.js` が GitHub Actions の step summary と PR コメント（目印付きの1件を更新し続ける）に出す。黙って本番依存に戻らないようにするため。0件でも「0件」と出す
- 素通しは失敗にしない。新しいクエリを足した PR では素通しが出るのが想定どおりで、翌日の自動撮り直しで録画に入る

### 6. 録画は毎日自動で撮り直す（`.github/workflows/e2e-rerecord.yml`）

毎日4回（JST 10:23 / 12:47 / 14:37 / 16:13。UTC 01:23 / 03:47 / 05:37 / 07:13）と `workflow_dispatch` で、master で全件を録画する。その日の録画を採用したら、後の起動は空振りする。

- 当初は JST11:00（`'0 2 * * *'`）の1回だけだったが、2026-09-30 は JST17:15 に起動した。GitHub の schedule は負荷で遅れ、取りこぼされることもあり、毎時0分に負荷が集中する（[公式](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule)）。このリポジトリの他の定期実行も1〜4時間の遅れが常態のため、0分を避けたうえで予備の起動を置いた（JST10:23・12:47の2回）
- 2回でも足りなかった。2026-10-01 は 10:23 の予定が JST16:15 に、12:47 の予定が JST19:27 に起動し、16:15 の回は不採用（テスト3件の失敗）、19:27 の回は打ち切りで撮らずに終わった。1回でも不採用・大幅遅延になると、その日は撮り直せない。起動を JST10〜17時に4回置き、同じ日のうちに再挑戦できるようにした
- 定期実行は、録画の前に `scripts/maintenance/e2e-recording.js gate` で撮るかを決める。その日（JST）の録画を採用済みなら撮らない（後の起動の空振り。通知しない）。JST19時以降に起動したら撮らない（発走前のレースが夜間開催の数場だけになる。通知する）。`workflow_dispatch` は判定せずに撮る
- 起動が遅れて重なっても、`concurrency`（`cancel-in-progress: false`）で直列になる。後の起動は前の起動の終了後に checkout した master のポインタで判定する（二重に撮らない）。起動時刻・直列化・権限は `verify-e2e-har-merge.js` が機械検査する

1. 本番に繋いで全件を録画する
2. 撮った録画だけで再生して全件実行する（`E2E_REPLAY_STRICT=1`: 録画に無い通信は abort＝録画が自己完結しているかを見る）
3. 採用条件（`scripts/maintenance/e2e-recording.js judge`）
   - 2 が全件通る（失敗・flaky・テスト外のエラーが0）
   - skip が現行の録画（ポインタに記録した件数）より増えていない。発走前のレースが少ない日に撮ると skip が増えるため
4. 採用したら Release に添付してポインタを master に直接 push する（`push-with-retry.sh`。GITHUB_TOKEN の push は他のワークフローを起動しない）。直近14件を残して古い Release を消す
5. 採用しなかった・失敗したときは Slack に通知する。PRゲートは現行の録画のまま動き続ける。定期実行の通知は1日1回まで（`e2e-recording.js notify-dedupe`。同じ日に別の定期実行の通知ステップが動いていれば出さない。確かめられないときは通知する）。2回目以降の結果は各実行の step summary に残る。`workflow_dispatch` は毎回通知する

撮り直しで初めて落ちるテストは、録画の日時か本番データに暗黙に依存している。PRゲートは録画（時計は録画時刻）で再生するので通るが、翌日の撮り直し（時計は撮影時刻・本番の最新データ）で落ちる。2026-10-01 の不採用の3件はいずれもこの型だった。

- 「過去か当日か」で表示が変わる箇所を、録画時刻の日付のレースで確かめていた → テスト内で `page.clock.setFixedTime` で日付を固定する
- 結果が確定すると既定タブが「結果」に変わるレースで、既定タブの中身を測っていた → タブを明示して開く
- 本番データの補完（過去のレースの進入コース）で「直近10走」の窓がずれ、先頭の1走の性質が変わった → 位置ではなく「条件を満たす走すべて」で確かめる

固定の race_id を開くテストを書くときは、撮影日が進んでも前提が変わらないか（結果の確定・今日との前後・後日の走の追加）を確かめる。

### 7. 録画の本体は GitHub Release に置く

本体（`api.har` と `bodies/`、約90MB）はリポジトリに置かない。撮り直しのたびに圧縮後10〜12MB ずつ履歴が増え、毎日撮り直す運用では1年で約4GBになる。

- 採用した録画は、タグ `e2e-recording-YYYYMMDD-HHMM`（JSTの録画時刻）の Release に `e2e-recording.zip` として添付する（prerelease・latest にしない）
- リポジトリには `e2e/recording.json`（タグ・sha256・バイト数・録画時刻・Supabaseのオリジン・件数・skip件数）だけを置く
- 再生の前に `global-setup.js` がポインタの zip を取得し、sha256 を照合して `e2e/recordings/`（gitignore）に展開する。zip は `node_modules/.cache/boatai-e2e-recording/<sha256>.zip` にキャッシュし、CI では `actions/cache` でポインタのハッシュをキーに保存する。リポジトリは公開なので取得に認証は要らない
- 手元で撮った録画をそのまま再生するときは `E2E_RECORDING_SOURCE=local`。手元で撮った録画を採用するときは `node scripts/maintenance/e2e-recording.js publish --skipped=N --tests=N`
- 必要な権限: 撮り直しのワークフローは `contents: write`（Release の作成・削除とポインタの push）。Supabase は既存の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（anon キーでの読み取りのみ）で足り、新しいキーは要らない

## サイズ

2026-09-28 12:26 JST の録画で実測。

| 項目 | 値 |
|---|---|
| 応答（重複除外後） | 841件（録画した context 295個・重複3,535件・失敗/本文欠け88件を除外） |
| `api.har`（本文なし、URL・ヘッダーのみ） | 4.8MB |
| `bodies/` | 786ファイル・82.4MB（最大4.7MB。過去日付の `/api/predictions/{日付}` が大半） |
| リポジトリに入る量（zlib圧縮後のblob合計） | 13.1MB |

本文を1本の HAR に埋め込むと101MBになり、GitHub の1ファイル上限（100MB）を超えた。`.zip`（routeFromHAR が対応）なら約8MBだが、撮り直すたびに全体が別のバイナリになり、履歴が毎回約8MBずつ増える。本文を内容の sha1 で名付けたファイルに分けると、撮り直しで変わらない本文（過去日付の予測データ等）は同じblobのまま再利用され、増えるのは変わった本文だけになる。当日の日付に依存する本文は録画1回あたり約8.5MB（圧縮前）で、撮り直しごとの増分はおおむねこの規模になる見込み。

その後（2026-09-29）、本体はリポジトリに置かず GitHub Release に移した（決定7）。上の数値はリポジトリに置いていた場合の見積もりで、Release 方式ではリポジトリに入るのはポインタ（1KB未満）だけになる。

## 対象外

- `venue-guide-data.spec.js` はブラウザを使わない（`page` 未使用）ため、fixture に切り替えていない

## トレードオフ

- **PRでは本番データ側の変化を検知できない**。RPCの応答形の変化・当日データの欠けは e2e-live.yml の定期実行でしか分からない。検知は最大1日遅れる
- **新しい通信を足した PR では、その通信だけ本番に依存する**。素通しは一覧に出るが、失敗にはしない。翌日の自動撮り直しまでは、その部分は当日データで揺れうる
- **録画は最大1日古い**。自動撮り直しが採用されない日が続くと古いまま残る（Slack に通知される）
- **撮り直しの採用は skip 件数で判定する**。skip が同数でも中身（どのテストが skip したか）が入れ替わる場合は見ていない
- 録画中にデータが更新されると、テストによって見ている時点が数分ずれる（重複は最も早い応答を残すので、同じURLは1つの応答に揃う）
