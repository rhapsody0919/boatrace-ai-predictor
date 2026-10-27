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

2026-10-27 追記: 1ジョブで全件を流していた間、2026-10-20〜26 の7回とも60分の上限で取り消され、本番データでの検知が1週間働いていなかった（docs/design/ci-minutes-reduction/design.md 2.4）。PR ゲートと同じ `e2e/shards.json` の組に分け（`e2e-shards.js --matrix`、各組 45分まで）、`report` のジョブが組のレポートをまとめて skip・組の網羅を見て、落ちていれば Slack に1回だけ流す。`verify-e2e-shards.js` が e2e-live.yml の組も e2e/shards.json から作ることを検査する。

### 4. 既存の個別 `page.route` は優先される

HAR は context に登録し、spec 側の `page.route` は page に登録される。page のルートが先に評価されるため、既存の差し替え（予測データ取得失敗・ピットレポートの回帰テスト）はそのまま効く。`route.fallback()` すれば HAR に落ちる。実測で確認した（`/rest/v1/venues*` を page.route で `[]` にした場合、HAR の応答ではなく `[]` が返った）。

例外が1つある。page.route の中で `route.fetch()`（実応答を取ってから加工する）を使うと、そのリクエストはブラウザの通信経路を通らずに直接ネットワークへ出るため、context の HAR では録画も再生もされない。再生時は本番へ出ようとして失敗した（`layout.spec.js` の BOA-460 再現テスト10件、`smoke.spec.js` の前検テスト1件）。`e2e/fixtures.js` の `fetchRecorded(route)` を代わりに使う。録画時は `route.fetch()` の結果を HAR に書き足し、再生時は録画から同じ応答を返す。`APIResponse` そのものではないので、`route.fulfill` には `status`・`headers` を明示して渡す。`route.continue()` も同じく context のルートを飛ばすので `route.fallback()` にする。導入初日に master 側で `route.continue()` 4箇所・`route.fetch()` 1箇所が新たに入ったため、`scripts/maintenance/verify-e2e-recorded-network.js`（Quality Gates で実行）で機械検査する。

もう1つ、テスト終了時の `page.unrouteAll()` は、context 側の録画の再生と競合して `Route is already handled!` で落ちる（実測: 展示前の体重テスト5件）。このフックは本番の応答待ちを捨てるためのものなので、replay では呼ばない。

**規約: page のルートを途中で0件にしない**（BOA-662）。`page.unroute`・`page.unrouteAll`・`times:` 付きの `page.route` は使わない。Playwright 1.59 は、page のルートが0件になった瞬間に処理中の要求があると、それを context 側（録画の再生 `routeFromHAR`）へ送り直す。同じ要求がクライアント側でも page→context の経路で処理され、`Route is already handled!` で落ちる。同じ仕組みで2回落ちた。

- BOA-466（#913）: 上記の afterEach の `page.unrouteAll()`
- BOA-661（#1084）: `smoke.spec.js` のオリジナル展示の再訪テストと `ga-pageview.spec.js` の `/admin` のスタブが、テストの途中で `page.unroute` していた

差し替えをやめたいときは、上に `page.route` を重ねる（後から登録したものが先に評価され、fulfill すれば下には回らない）か、フラグを倒して `route.fallback()` に回す（録画の再生へ落ちる）。`scripts/maintenance/verify-e2e-no-unroute.js`（Quality Gates で実行）が `e2e/**/*.js` を検査する。正当な例外は `scripts/maintenance/e2e-no-unroute-allowlist.json` に「ファイル・行の内容・理由」で載せる（現状は上記 afterEach の1件。replay では呼ばないため）。

### 5. A改: 録画に無い通信は素通しし、必ず一覧に出す（2026-09-29 改訂）

当初は録画に無い通信を abort していた。ところが、データ取得部分（`supabaseDataService.js`）を変える PR が1日に7本入り、PR ごとに撮り直す前提が成り立たなかった（導入初日だけで master 側の変更による撮り直しが3回要った）。そこで次に改めた。

- 録画に無い `/rest/v1/*`・`/api/*` は本番へ素通しする。CI には本番の読み取り用キー（anon）を渡す
- 素通しした通信は、メソッド・URL・どのテストかを `test-results/.e2e-passthrough/*.jsonl` に書き、`scripts/maintenance/report-e2e-passthrough.js` が GitHub Actions の step summary と PR コメント（目印付きの1件を更新し続ける）に出す。黙って本番依存に戻らないようにするため。0件でも「0件」と出す
- 素通しは失敗にしない。新しいクエリを足した PR では素通しが出るのが想定どおりで、翌日の自動撮り直しで録画に入る

### 6. 録画は毎日自動で撮り直す（`.github/workflows/e2e-rerecord.yml`）

毎日4回（JST 10:23 / 12:47 / 14:37 / 16:13。UTC 01:23 / 03:47 / 05:37 / 07:13）と `workflow_dispatch` で、master で全件を録画する。その日の録画を採用したら、後の起動は空振りする。

- 起動の主は Vercel Cron（`api/cron/e2e-rerecord-dispatch.js`）からの `workflow_dispatch`（`inputs.gate=true`）。2026-10-02 を最後に schedule が JST19時以降にしか来ず18日撮れなかったため（BOA-929、PR-A2）。schedule は同じ時刻の予備に残す。以下の「定期実行」は schedule と gate=true の dispatch の両方を指す

- 当初は JST11:00（`'0 2 * * *'`）の1回だけだったが、2026-09-30 は JST17:15 に起動した。GitHub の schedule は負荷で遅れ、取りこぼされることもあり、毎時0分に負荷が集中する（[公式](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule)）。このリポジトリの他の定期実行も1〜4時間の遅れが常態のため、0分を避けたうえで予備の起動を置いた（JST10:23・12:47の2回）
- 2回でも足りなかった。2026-10-01 は 10:23 の予定が JST16:15 に、12:47 の予定が JST19:27 に起動し、16:15 の回は不採用（テスト3件の失敗）、19:27 の回は打ち切りで撮らずに終わった。1回でも不採用・大幅遅延になると、その日は撮り直せない。起動を JST10〜17時に4回置き、同じ日のうちに再挑戦できるようにした
- 定期実行は、録画の前に `scripts/maintenance/e2e-recording.js gate` で撮るかを決める。その日（JST）の録画を採用済みなら撮らない（後の起動の空振り。通知しない）。JST19時以降に起動したら撮らない（発走前のレースが夜間開催の数場だけになる。通知する）。人が起こす `workflow_dispatch`（gate=false、既定）は判定せずに撮る
- 起動が遅れて重なっても、`concurrency`（`cancel-in-progress: false`）で直列になる。後の起動は前の起動の終了後に checkout した master のポインタで判定する（二重に撮らない）。起動時刻・直列化・権限は `verify-e2e-har-merge.js` が機械検査する

1. 本番に繋いで全件を録画する
2. 撮った録画だけで再生して全件実行する（`E2E_REPLAY_STRICT=1`: 録画に無い通信は abort＝録画が自己完結しているかを見る）
3. 採用条件（`scripts/maintenance/e2e-recording.js judge`）
   - 2 が全件通る（失敗・flaky・テスト外のエラーが0）
   - skip が現行の録画（ポインタに記録した件数）より増えていない。発走前のレースが少ない日に撮ると skip が増えるため。画面幅（プロジェクト）だけで決まる skip は数えない（理由を `e2e/viewport-skip.js` の `viewportSkipReason()` で包む。どの日に撮っても同じ数で、テストを足すたびに増えるため。BOA-929: 含めていた間は 2026-10-24 の3回とも「現行 0件 → 新 28件」で不採用になった）
4. 採用したら Release に添付してポインタを master に直接 push する（`push-with-retry.sh`。push はアプリ ryujin-bot のトークンで行い、この push で起動しうるワークフローは `[automated]` で終わるコミットでは動かない条件を持つか、paths で `e2e/recording.json` を対象にしていない。当初は GITHUB_TOKEN で push し、他のワークフローを起動しないことに頼っていた）。直近14件を残して古い Release を消す
5. 採用しなかった・失敗したときは Slack に通知する。PRゲートは現行の録画のまま動き続ける。定期実行の「採用しなかった・撮らなかった」通知は1日1回まで（`e2e-recording.js notify-dedupe`。同じ日に master の別の実行の通知ステップが動いていれば出さない。runs の API は inputs を返さないので、人の起動の通知も数える。確かめられないときは通知する）。2回目以降の結果は各実行の step summary に残る。ワークフロー自体の失敗（push の失敗・record ジョブの失敗等）と、人が起こす `workflow_dispatch`（gate=false）は毎回通知する

撮り直しで初めて落ちるテストは、録画の日時か本番データに暗黙に依存している。PRゲートは録画（時計は録画時刻）で再生するので通るが、翌日の撮り直し（時計は撮影時刻・本番の最新データ）で落ちる。2026-10-01 の不採用の3件はいずれもこの型だった。

2026-10-24 の不採用の6件も同じ型で、2つに分かれた（BOA-929）。(1) 直近N件・直近14日の一覧の先頭だけを見て、固定した過去のレースを探していた（選手ページの履歴・的中レース一覧）。(2) `fetchRecorded` の応答を `route.fulfill({ response })` で返していた。Playwright は APIResponse でない `response` を黙って無視して空の200を返すので、録画に無い通信を本番へ素通しする PR ゲートでは通り、撮り直した録画の strict 再生でだけ落ちる。`fetchRecorded` の戻り値は全モードで `fulfillOptions()` を持ち、`verify-e2e-recorded-network.js` が `fulfill({ response })` を検出する。

- 「過去か当日か」で表示が変わる箇所を、録画時刻の日付のレースで確かめていた → テスト内で `page.clock.setFixedTime` で日付を固定する
- 結果が確定すると既定タブが「結果」に変わるレースで、既定タブの中身を測っていた → タブを明示して開く
- 本番データの補完（過去のレースの進入コース）で「直近10走」の窓がずれ、先頭の1走の性質が変わった → 位置ではなく「条件を満たす走すべて」で確かめる
- 本日の「先頭の会場」（会場コード順。桐生はナイターで1R が15時台）に締切後のレースがある前提で探していた（2026-10-26 の JST 10:23・12:47・14:37 の3回の不採用、`race-card-link.spec.js`） → 結果の確定した過去日付の会場ページで探す

固定の race_id を開くテストを書くときは、撮影日が進んでも前提が変わらないか（結果の確定・今日との前後・後日の走の追加）を確かめる。

### 8. 配り方: build した束を `vite preview` で配る（案。CI の分数の削減の段2の PR のマージで採用、それまでは dev のまま）

#1319（BOA-769 B）は「/src を直に import する4ファイルが preview で通らない」で閉じた。#1997 の実験で4ファイルを Node 側の読み込みに替え、課金の分は中央 94分→39分（約 −58%、4 vCPU、dev 3回・preview 2回）、件数・合否・skip（28件、全部が画面幅だけで決まるもの）は dev と同じだった（docs/design/ci-minutes-reduction/design.md 4.2 A・6章、#1997 の結果のコメント）。

- **束は3つ**。`npm run build:e2e`（`scripts/maintenance/e2e-build.js`）がモードごとに build する。build は webServer の command に入れない（`timeout: 30000` で切れる）。前の step で流し、webServer は `vite preview` だけ
  - 再生: `e2e/recording.json` の `supabaseOrigin`（撮った録画の strict 再生は `e2e/recordings/meta.json`、`E2E_RECORDING_SOURCE=local`）
  - 撮り（`E2E_RECORD=1`）・本番データ（`E2E_LIVE=1`）: 今の `VITE_SUPABASE_URL`
- **宛先は束に焼き込まれる**。dev では `playwright.config.js` の `replayServerEnv` が起動のたびに録画のオリジンへ差し替えるが、preview では効かない。違う宛先で build すると HAR の URL の完全一致が外れ、全件が本番へ素通しになる（#1319 の 1,132 種類）。`VITE_GA_MEASUREMENT_ID` は空に固定する（本番の束の initGA は DEV で止まらない）
- **起動の前に束を照合する**。`dist/.e2e-build.json` に mode・焼き込んだ宛先・build のコミット（`git rev-parse HEAD`）を書き、`playwright.config.js` が今のモードの期待（`buildSupabaseUrl`）と HEAD に合わなければ止める（再生の束で本番データを走らせない・古い束で緑にしない）。未コミットの変更までは見ない（手元の既定は dev）
- **4つを同時に切り替える**: PR ゲート（e2e-shard・e2e-light）、撮り（record）、撮った録画の strict 再生、E2E Live。撮りと再生の片方だけを変えると、下の素通しの集合が配り方の差でずれる。撮り直しは `checkout ref: master` で動くので、ブランチでは「preview で撮って preview で再生」を測れない（#1997 の審査 P1）。**マージ後の最初の撮り直しの採用で確かめる**（採用の条件は緩めない: strict 再生が全件通る・skip が増えない）
- **Node 側で読む src は HAR の外**。関数・CSS の検査（`e2e/src-modules.js` の `loadSrc`・`srcFixedT`・`srcCss`）はブラウザを通らないので、録画にも素通しの一覧にも出ない。宛先は `https://e2e-node.invalid` に固定し、差し替え漏れで本番へ出ないようにする。通信が要る検査は `globalThis.fetch` を差し替えて確かめ、本番に当てる1本だけを `E2E_LIVE=1` で流す
- **dev でだけ見ていたもの**は CI で見なくなる: StrictMode の二重描画、dev の警告（console を見る spec は `flying-late-badge.spec.js` の1つ）、`src/i18n.js` の翻訳ファイルの欠落の throw（本番の束では `console.error` で ja に落ちるだけ）。最後のものは `verify-i18n-consistency.js` が `SUPPORTED_LANGUAGES` から言語を読んで代わりに止める。手元の既定（`E2E_SERVE` 未指定）は dev のまま
- **素通しの集合は、配り方でも同じ配り方の実行どうしでも厳密には同じにならない**（2026-10-27 の実測）。原因は in() の並び（決定2）ではない。テストの途中の画面遷移とテストの終わりで、応答待ちの続きの要求（`fetchAllPages` の2ページ目 `offset=1000`、選手の窓・モーターの指数の続きの読み）が切られるかが、配る速さで変わる
  - #1997 の preview の2回目で dev より増えた9種類のうち7種類は `offset=1000` の2ページ目で、1ページ目は録画に1000行で入っていた。`race-detail-details.spec.js` が住之江のレースを開いた後に大村のレースへ移り、その遷移で前の画面の選手6人分の読みが切れる。速い preview は遷移の前に2ページ目まで進む。残る2種類は、同じテストの選手の展示の読み（`race_original_exhibition_values` の in()）と、`race-detail-accident-rate.spec.js` の選手1人の窓の読み（`racer_id=eq.4856`。録画にはこの選手の読みが1件も無い）。後者は遷移でなくテストの終わりで切れた型とみられる（未検証）
  - dev どうし（#1993〜#1996 で7〜11種類）の揺れも同じ型（`smoke.spec.js` の今節の前走のテストで、モーターの指数の `race_entries` の束 `global_2rate` が遷移の前に出るか）
  - in() の束は並びで揺れない。`fetchAllInChunks` は値を並べてから分け、`chunkArray` に渡す一覧は DB の並び。録画の in() はすべて並び済みだった
  - 撮りで context を閉じる前に静かな時間（新しい要求が出ない0.5秒）を待つ形は採らない。`race-detail-details.spec.js` の部分録画を手元で撮って確かめたところ、テストの終わりの画面（大村）の2ページ目は今の録画にも入っており、増えた7種類（遷移の前の画面の住之江）は待っても入らなかった。テストの終わりで切れる型（上の `racer_id=eq.4856`）には効きうるが、1種類のために全テストの撮りを延ばさない
  - 素通しは失敗にしない（決定5）ので合否は変わらない。採用の線は「dev と同じ集合」でなく「増えた分が、続きのページか遷移の前の画面の読みだけであること」にする。撮りと再生を同じ配り方にそろえると、撮りの時点で preview の速さの分まで録画に入る
- **戻す手順**: 4つのワークフローの `E2E_SERVE: preview` と `npm run build:e2e` の step を外す（dev に戻る）。録画の形式は配り方に依らないので撮り直さなくてよい。戻した後の最初の撮り直しで、素通しの集合は dev のものに戻る。マージ後の最初の撮り直しが採用されなければ戻す

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
