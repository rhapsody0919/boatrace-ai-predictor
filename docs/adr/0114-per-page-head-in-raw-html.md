# ADR-0114: 選手・会場・レースのページの生の HTML に、ページごとの head を全ての UA に同じに入れる

## ステータス

提案（2026-11-27）。オーナーの決定は 2026-11-27（「head の差し込みを先に出し、SSR はグランプリの後に効きを4〜6週見て決める。ブログの SSG は BOA-1726 で調べる」の推奨を承認、窓口経由）。審査は system-architect・seo-marketer（2026-11-27、P1 を本文に入れた）。

関係する ADR: [ADR-0089](./0089-bot-html-for-daily-pages.md)（ボット向け HTML。本 ADR は本文の出し分けを変えない）、[ADR-0032](./0032-ai-crawler-snapshot-delivery.md)（ビルド時スナップショット）、[ADR-0103](./0103-api-same-site-only.md)（/api の関門）、[ADR-0069](./0069-query-error-propagation.md)（失敗をデータなしにしない）、[ADR-0106](./0106-batched-production-release.md)（1日3回の配備）。

## 背景

- 本番の生の HTML（JS を回す前）は、トップ・選手・会場・今日・ブログで title が全部「ボートレースのデータ分析とAI予想が無料｜競艇 龍神レーダー」で、description・canonical が無い。UA が Googlebot でも同じ（窓口の curl、2026-11-27）
- 競合11社は全てページごとの title と本文を生の HTML に入れている（競合の調べ、2026-11-27）
- GSC 10/27〜11/23 のクリックはトップ 3,720、レース 127、選手 4。長尾が取れていない
- 手元の URL 検査（2026-11-26）で、ブログ3件の Google の正規が関係ないページ（user_canonical が空）。生の HTML に canonical が無いことと矛盾しない（因果は未検証）
- 本筋は SSR（react-router 7 の framework mode、20〜28本・5〜7週の見積もり）。グランプリ（12/15〜20）に間に合わないので、head だけを先に出す
- `docs/reference/seo-architecture-constraints.md` は「Googlebot は描画するので title 等は React で足りる」としていた。描画の待ち・描画の失敗・描画しない取得器では生の HTML の head しか見られない。本 ADR と同じ PR でこの判断軸を改める

## 決定

### 1. 対象のページ（第1段は ja だけ）

| ページ | head の材料 | head を決める関数（人の画面と同じ） |
|---|---|---|
| `/races/:date/:venue`（過去日の会場） | URL と会場名（`src/constants` の `STADIUM_NAMES`）だけ | `getPastVenuePageMeta` |
| `/race/:raceId`（レース詳細） | `/api/predictions/{date}?light=true`（中止・結果の有無） | `getRaceDetailMeta` |
| `/venue/:code`（本日の会場、1〜24） | `/api/races/today`（SG・G1 の節の名前） | `getTodayVenuePageMeta` |
| `/racer/:id`（選手、4桁） | 選手のプロフィール・級・期別の要約（anon キーで読む） | `RacerProfile.jsx` の title・description・JSON-LD の組み方を `src/pure` へ移した物 |

- 言語版（/en/venue/… 等）・トップ・/today・ブログは第1段に入れない。言語版の race は noindex（ADR-0107）。トップは title が既に index.html と同じ。ブログは観測された被害（正規の取り違え）があるが、BOA-1726（SSG）で本文ごと扱う。外すことで効きが遅れる大きさは未確認（未確認6）
- 入れるのは title・meta description・link canonical・JSON-LD（人の画面が出している物だけ）。og・twitter は変えない（SNS のボットは ADR-0089・0032 の本文の HTML を受ける）
- robots は変えない（生は今と同じ index.html の index）。索引しない選手・中身の無いレースは「生は index＋自分を指す canonical、描画の後に noindex」になる。Google は描画の後の noindex を採るので許す。逆（生に noindex）は描画を飛ばされる側で、#2049 と同じ型になるのでしない

### 2. 組み方（全ての UA に同じ）

```
ブラウザ・Googlebot・その他
   │ GET /racer/4444
   ▼
middleware.js ──(AI の UA で ADR-0089・0032 の対象)──▶ 今どおり bot-page・スナップショットへ rewrite（本文つき。head は同じ関数の値）
   │ それ以外の全ての UA、GET だけ
   │ 並べて取る（上限の時間は 300ms から。目安・根拠なし。本番の分布で決め直す）
   ├─ GET {new URL(request.url).origin}/index.html（静的なファイル＝今の配備の外枠。matcher の外）
   └─ head: 純関数（/races）か GET /api/page-head/v1/{kind}/{key}（JSON、CDN にキャッシュ）
   │
   ├─ 両方そろった → 外枠の <title> の文を置き換え、description・canonical・JSON-LD を data-page-head 付きで足して 200
   └─ 失敗・時間切れ・404・版の違い・例外 → 何も返さず素通り（今の静的な index.html）。1行の JSON ログ
```

- **差し込むのは middleware、キャッシュするのは head の JSON だけ**。HTML をまるごと CDN に置かない
  - 理由1: `vercel.json` は人の `/racer/*`・`/races/*` に全ての UA で、`/venue/1〜24`・`/race/{id}` に配る UA の外で `Vercel-CDN-Cache-Control: no-store` を付ける（headers は rewrite 前のパスで照合される、ADR-0089 未確認1の結果）。HTML を関数で返しても CDN に残らない。`vercel.json` は作り手が変えられない（AGENTS.md 安全の4）
  - 理由2: HTML をまるごとキャッシュすると、配備の後に古い HTML が消えた `/assets/*` を指しうる。外枠は毎回同じ host の `/index.html` を取るので、外枠とブラウザが続けて取る `/assets` は同じ alias の配備にそろう
  - 理由3: 関数に dist の index.html を同梱できるかの問題（`includeFiles` の index.html はソースの物）が起きない
- **失敗は素通り（今の外枠）にし、503 を人に返さない**
  - `/api/page-head` は、材料の失敗・形の違いで 503、該当なし（選手が無い等）で 404 を、どちらも `Cache-Control: no-store` で返す。middleware は素通りする。「該当なし」の head を CDN に残さない
  - 素通りの外枠は今と同じで canonical を持たない。差し込む canonical は URL から作る自分を指す物だけなので、失敗が重なっても全ページが同じ canonical に集まる型（#2049）にならない
  - 外枠の取得が 200 でない（保護のかかった Preview の 401 等）・外枠の head の `<title>` が1つでない・description か canonical が既にある、も素通り
  - 差し込みの枝は try/catch で包み、どんな例外も素通りにしてログを出す。middleware の例外は対象の全ページの 5xx になるため（AGENTS.md の「try/catch は種類で分けるときだけ」の例外。理由を注釈に書く）
  - 時間切れのときは素通りにしつつ、head の取得は `waitUntil`（`@vercel/functions`）で最後まで走らせ、CDN を温める（打ち切ると MISS が続き差し込みが永久に効かない型を避ける）
- **返す応答**: `Content-Type: text/html; charset=utf-8`、`Cache-Control`・`CDN-Cache-Control`・`Vercel-CDN-Cache-Control` は vercel.json の人の HTML と同じ文字列（no-store）、`X-Content-Type-Options: nosniff` を自分で付ける。外枠の `content-encoding`・`content-length`・`etag` は写さない（fetch は展開した本文を返す）。`Server-Timing` に取得の時間を入れる
- **UA で head を変えない**。本文は AI・bingbot 等だけに人の画面の部分集合を出す（ADR-0089）。head は全ての UA に同じ関数の値で、AI の UA は rewrite 先の HTML の head、ほかの UA は差し込みの head を受ける。Googlebot は人と同じ外枠＋head（ADR-0089 の「Googlebot に出し分けない」を保つ）。時間切れの素通りは UA でなく負荷で決まり、人にも同じ確率で起きるので、UA の出し分けではない
- クエリ文字列は head の材料に使わない（キャッシュのキーを増やさない。ADR-0089 決定6と同じ）
- matcher は `/races/:date/:venue` だけを足す（`/races/:date` の一覧は起こさない）。会場コード・日付・選手番号の形の外は素通り

### 3. 起動の後の受け渡し（差し込んだ head と React の head を重ねない、消して0本にもしない）

- title の要素は差し替えず中の文だけを置き換え、元の既定の文を `data-page-head` の値に持たせる（`useSingleTitle.js` がモジュールの評価の時に要素そのものを掴むため。既定の文を別の所に書き写さない）
- description・canonical・JSON-LD は、React が同じ種類の要素（`meta[name=description]`・`link[rel=canonical]`・同じ `@type` の JSON-LD）を足した時点で `data-page-head` の物を外す（MutationObserver。`useSingleTitle` と同じ型。時間では見回らない）。読み込み中・取得の失敗で React が canonical を出さない間は、差し込みが残り0本にならない
- SPA の中で別のパスへ移ったら、残っている `data-page-head` の要素を全て外し、title の文を既定に戻す（生の値を別のページに持ち越さない）
- この受け渡しは、差し込みの配線より前の配備に入れる。差し込みが無い間は何もしないので害が無い

### 4. キャッシュ（/api/page-head の応答。`/api` は vercel.json の no-store の規則の外）

| kind | 正常時の Cache-Control |
|---|---|
| venue | `public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600` |
| race（本日） | `public, max-age=0, s-maxage=60, stale-while-revalidate=30, stale-if-error=3600` |
| race（過去日） | `public, max-age=0, s-maxage=86400, stale-while-revalidate=3600, stale-if-error=3600` |
| racer | `public, max-age=0, s-maxage=21600, stale-while-revalidate=3600, stale-if-error=3600` |

- 本日・過去日の境は JST の日付（`/api/predictions` の UTC の判定との差は ADR-0089 第2段の未確認3と同じ。過去日の長いキャッシュは JST の翌日から）
- JSON は配備と Instant Rollback をまたいで s-maxage の間残るので、パスに版（`/v1/`）を入れ、中身にも `v` を持たせる。middleware は版が違えば素通りにする
- 失敗・該当なしは `no-store`（上の2）。関数の中でも材料を60秒使い回す（ADR-0089 決定4と同じ）

### 5. 公開の口の安全

- `/api/page-head/*` は誰でも直接呼べる前提で作る。引数はパスの形を正規表現で固定（会場 1〜24、レースは id の形、選手は4桁）し、外は 404
- middleware からの取得は `new URL(request.url).origin` だけ（`api/_lib/botPage.js` の `originOf` は Node の `headers.host` を読むので middleware では使えない）。外枠は必ず `/index.html` を取り、`/` を取らない（`/` は matcher に入り middleware がもう一度動く）。/api の関門を通るので `internalApiHeaders` を付ける（ADR-0103）
- サーバーで使う鍵は anon キーだけ。`SERVICE_ROLE` の字が `/api/page-head` から import される物に無いことを verify で見る
- 差し込む値は全て HTML のエスケープを通す。JSON-LD の中は `<` と U+2028・U+2029 を `\u` の形に逃がす

### 6. 関数のリージョン

- 材料（Supabase）は ap-southeast-2（syd1 から 28〜46ms、iad1 から約250ms。ADR-0089 決定8）。`/api/page-head/**` を syd1 に置く1行（`"api/page-head/**/*.js": { "regions": ["syd1"] }`）を `vercel.json` に足すのはオーナーに委ねる（関数の PR の本文に差分を書く）
- `/api/page-head` を使う kind（venue・race・racer）の配線は、その1行が本番に入ってから出す。`api/bot-page/**` の下に置けば今すぐ syd1 を継げるが、名前と役が食い違い、関門を通さない口が増えるので採らない

## 却下した選択肢

- **関数が HTML をまるごと返し、middleware で全 UA を rewrite（11/27 の見積もりの C2）**: 上の理由1〜3。加えて関数が落ちると人に 5xx が出る（rewrite に素通りの道が無い）
- **ビルド時に head だけの外枠を全ページ分作る（SSG の head 版）**: 配備は1日3回なので本日の会場・レースの状態が最大6時間古い。選手1,600余りと過去のレースの全てを毎回作るとビルドが伸びる。選手だけなら成り立つので、第1段の効きを見て再考の候補にする
- **起動の前に差し込んだ head を全て消す**: lazy のチャンクと取得の待ちの間に canonical が0本になり、生の head の利点を自分で捨てる（seo-marketer の審査）
- **Googlebot にだけ head を入れる**: UA の出し分け（クローキングの疑い）になる
- **SSR（framework mode）を今から**: グランプリに間に合わない。オーナーの決定（2026-11-27）で効きを見てから

## 影響

- 人の `/racer/*`・`/venue/1〜24`・`/race/*`・`/races/:date/:venue` の HTML が middleware の差し込みを通る。1閲覧ごとに middleware の起動が2回（内側の /api の関門）・edge への要求が2つ（/index.html と /api/page-head）・関門のログが1行（internal は抜き取らない、`api/_lib/apiGate.js`）増える。ADR-0103 段階4の群ごとの数えに page-head の群が混ざる
- 最悪の TTFB は「今の TTFB＋上限の時間」。Core Web Vitals に効くので、配線の PR ごとに本番の人の TTFB の中央値と p75 を前後で比べる。参考: ADR-0089 第2段の未確認1（Preview で middleware を通すと 38→220ms、本番では差 約15ms）
- `/api/page-head` の起動の費用: venue 24 キー×5分、race は本日最大288キー×1分・過去日は長いキャッシュ、racer は6時間。ADR-0089 第2段の見積もり（上限 月約1,000万回）より少ない見込み（未計測）
- 差し込んだ応答は no-store のままなので、Googlebot の条件付きの再取得（ETag）は効かない。今と同じ。クロールの予算への影響は未確認
- `docs/reference/seo-architecture-constraints.md` の「JS 実行後でも良い」の判断軸を、本 ADR と同じ PR で改める
- 戻し方: (1) middleware の差し込みを kind ごとに外す PR (2) 急ぐときは Instant Rollback。版の合わない JSON は素通りになる。差し込みが無くても人の画面は今と同じ

## 段の分け方（各 PR は 300行5ファイル以内）

| 順 | PR | 中身 |
|---|---|---|
| 1 | 本 ADR と seo-architecture-constraints.md | 文書だけ |
| 2 | 材料を src/pure へ | 暦日の formatDate・パンくずの JSON-LD（振る舞いを変えない） |
| 3 | head の純関数と受け渡し | `src/pure/pageHead.js`（パスの読み・差し込み・/races の head）、起動の後の受け渡し（決定3） |
| 4 | 配線 /races | middleware の差し込みの枝（決定2）を /races だけ |
| 5 | page-head の venue、race | kind ごとに分ける。PR 本文に vercel.json の1行 |
| 6 | （オーナー）syd1 の1行 | |
| 7 | 配線 venue・race | |
| 8 | 選手の head を src/pure へ移すだけ、page-head の racer と配線 | |

## 確かめ（各 PR。既存の verify・e2e は変えず新しいファイルへ）

- 差し込みの純関数: title が1つ、canonical が1本、description が1つ、JSON-LD の `</script>` 破り無し、`data-page-head` が付き title の値が既定の文
- 受け渡し: 描画の前後で canonical が常に1本（0・2本の瞬間が無い）、lazy のチャンクを遅らせても1本、`useSingleTitle` が掴む title の要素が生きている、別のパスへ移ると差し込みが消え title が既定に戻る
- middleware: 対象のパスで差し込み、材料の失敗・404・時間切れ・外枠の 401・版の違い・例外で素通り（undefined）、AI の UA は今どおり rewrite、GET 以外は素通り、クエリを材料に持ち込まない、存在しない選手・範囲外の会場で canonical が出ない
- `/api/page-head`: パスの形の外は 404、材料の失敗は 503・no-store、正常時の Cache-Control が上の表どおり、import の木に `SERVICE_ROLE` の字が無い、ボット向け HTML の title・canonical と同じ入力で一致
- 本番（claude/* に Preview は無い）: 配線の後、curl（人・Googlebot・bingbot の UA を各1回）で生の title がページごとに違い、`<title>` が1つ、canonical が1本。内側の `x-vercel-cache` が MISS→HIT になる。人の UA で画面が壊れない。TTFB の前後。URL 検査のライブテストは描画後の HTML なので生の確かめに使わない
- 素通りは画面で見えないので、1要求ごとのログ `{page_head: kind, outcome, ms, inner_cache}` で kind ごとの素通り率を数え、ADR-0089 の毎日の照合に「人の UA で kind ごとに1本、生の title が既定の文と違い canonical が1本」を足す（照合の手順は別の PR、既存の verify は変えない）

## 効きの測り方（seo-marketer の審査）

- 配線の前に基準線を残す: 対象の4種で各20 URL ほどの、クリック・表示・平均掲載順位、URL 検査の Google の正規とユーザーの正規の一致、カバレッジの「重複」の件数（テンプレートごと）
- 対照群: 同じ期間の未配線の kind・ブログ・言語版。グランプリの需要と11月のコアアップデートは対照群で引く
- 先に見るのはページ単位の正規の一致と長尾の表示回数。クリックだけにしない。GSC は2〜3日遅れ、再クロールは週単位
- 条件の外の選手の URL を数本、URL 検査で描画後の noindex が採られるか見る

## 未確認

1. middleware の実行の場所（地域）と、middleware から自分の host への fetch が CDN のキャッシュを通る速さ（ADR-0089 の関数の材料の取得は通っている）
2. 上限の時間（300ms から、根拠なし）の妥当さ。本番の分布で決め直す
3. 配備ごとに CDN のキャッシュが分かれるか（本 ADR の形ではどちらでも壊れない）
4. 生の head を入れたことの効き（上の「効きの測り方」）。SSR を決めるときの材料（オーナーの決定どおり4〜6週）
5. 素通り率（kind ごと）。高ければ効かない
6. ブログを外す判断で効きが遅れる大きさ
7. 時間切れで middleware が打ち切っても `waitUntil` の取得で CDN に入るか
