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
- `context.routeFromHAR(e2e/recordings/api.har, { url: /rest/v1/ と localhost の /api/, notFound: "abort" })`: 録画に無いリクエストはテスト失敗にする。素通ししない
- それ以外の外部ホスト（ローカルdevサーバー以外）への通信も abort する。録画時に観測したのは Google Fonts・AdSense・YouTube埋め込み・Googleマップ・OpenStreetMapタイル等17オリジンで、どれもアサーションの対象ではない（通しても当日の広告・地図タイルで結果が揺れるだけ）
- 落ちたテストでは、録画に無くて abort したリクエストをログと添付に出す（録画漏れと実バグの切り分け用。`E2E_DEBUG_MISSES=1` で通ったテストでも出す）

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
- **録画は発走前のレースがある時間帯（JST10〜15時目安）に行う**。`selectUpcomingRace` 系が skip しない状態で撮る

### 3. 本番データでの実行は定期実行に移す

`E2E_LIVE=1`（`npm run test:e2e:live`）で従来どおり本番データ・実時刻で走る。`.github/workflows/e2e-live.yml` が JST14:00（UTC05:00）に実行し、失敗を Slack に流す（`nightly-verify-db.yml` と同じ webhook・attachments 形式）。`workflow_dispatch` も付けた。

### 4. 既存の個別 `page.route` は優先される

HAR は context に登録し、spec 側の `page.route` は page に登録される。page のルートが先に評価されるため、既存の差し替え（予測データ取得失敗・ピットレポートの回帰テスト）はそのまま効く。`route.fallback()` すれば HAR に落ちる。実測で確認した（`/rest/v1/venues*` を page.route で `[]` にした場合、HAR の応答ではなく `[]` が返った）。

例外が1つある。page.route の中で `route.fetch()`（実応答を取ってから加工する）を使うと、そのリクエストはブラウザの通信経路を通らずに直接ネットワークへ出るため、context の HAR では録画も再生もされない。再生時は本番へ出ようとして失敗した（`layout.spec.js` の BOA-460 再現テスト10件、`smoke.spec.js` の前検テスト1件）。`e2e/fixtures.js` の `fetchRecorded(route)` を代わりに使う。録画時は `route.fetch()` の結果を HAR に書き足し、再生時は録画から同じ応答を返す。`APIResponse` そのものではないので、`route.fulfill` には `status`・`headers` を明示して渡す。

## サイズ

2026-09-28 12:26 JST の録画で実測。

| 項目 | 値 |
|---|---|
| 応答（重複除外後） | 841件（録画した context 295個・重複3,535件・失敗/本文欠け88件を除外） |
| `api.har`（本文なし、URL・ヘッダーのみ） | 4.8MB |
| `bodies/` | 786ファイル・82.4MB（最大4.7MB。過去日付の `/api/predictions/{日付}` が大半） |
| リポジトリに入る量（zlib圧縮後のblob合計） | 13.1MB |

本文を1本の HAR に埋め込むと101MBになり、GitHub の1ファイル上限（100MB）を超えた。`.zip`（routeFromHAR が対応）なら約8MBだが、撮り直すたびに全体が別のバイナリになり、履歴が毎回約8MBずつ増える。本文を内容の sha1 で名付けたファイルに分けると、撮り直しで変わらない本文（過去日付の予測データ等）は同じblobのまま再利用され、増えるのは変わった本文だけになる。当日の日付に依存する本文は録画1回あたり約8.5MB（圧縮前）で、撮り直しごとの増分はおおむねこの規模になる見込み。

`.gitattributes` で `e2e/recordings/**` を `-diff linguist-generated` にし、PRの差分表示から外した。

## 対象外

- `venue-guide-data.spec.js` はブラウザを使わない（`page` 未使用）ため、fixture に切り替えていない

## トレードオフ

- **PRでは本番データ側の変化を検知できない**。RPCの応答形の変化・当日データの欠けは e2e-live.yml の定期実行でしか分からない。検知は最大1日遅れる
- **新しい通信を足した変更は、録画の撮り直しが要る**。録画外は abort されるので、撮り直さないと落ちる（素通しにしなかった代償。素通しにすると当日データ依存が静かに戻る）
- **録画は古くなる**。フロントが期待する応答形が変わっても、古い録画のままだとPRは通る。撮り直しの目安は、応答形を変える変更（RPC・API）を入れたとき
- 録画中にデータが更新されると、テストによって見ている時点が数分ずれる（重複は最も早い応答を残すので、同じURLは1つの応答に揃う）
