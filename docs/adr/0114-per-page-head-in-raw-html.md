# ADR-0114: 選手・会場・レースのページの生の HTML に、ページごとの head を全ての UA に同じに入れる

## ステータス

提案（2026-11-27）。オーナーの決定は 2026-11-27（「head の差し込みを先に出し、SSR はグランプリの後に効きを4〜6週見て決める。ブログの SSG は BOA-1726 で調べる」の推奨を承認、窓口経由）。

関係する ADR: [ADR-0089](./0089-bot-html-for-daily-pages.md)（ボット向け HTML。本 ADR は本文の出し分けを変えない）、[ADR-0032](./0032-ai-crawler-snapshot-delivery.md)（ビルド時スナップショット）、[ADR-0103](./0103-api-same-site-only.md)（/api の関門）、[ADR-0069](./0069-query-error-propagation.md)（失敗をデータなしにしない）、[ADR-0106](./0106-batched-production-release.md)（1日3回の配備）。

## 背景

- 本番の生の HTML（JS を回す前）は、トップ・選手・会場・今日・ブログで title が全部「ボートレースのデータ分析とAI予想が無料｜競艇 龍神レーダー」で、description・canonical が無い。UA が Googlebot でも同じ（窓口の curl、2026-11-27）
- 競合11社は全てページごとの title と本文を生の HTML に入れている（競合の調べ、2026-11-27）
- GSC 10/27〜11/23 のクリックはトップ 3,720、レース 127、選手 4。長尾が取れていない
- 手元の URL 検査（2026-11-26）で、ブログ3件の Google の正規が関係ないページ（user_canonical が空）。生の HTML に canonical が無いことと矛盾しない（因果は未検証）
- 本筋は SSR（react-router 7 の framework mode、20〜28本・5〜7週の見積もり）。グランプリ（12/15〜20）に間に合わないので、head だけを先に出す
- `docs/reference/seo-architecture-constraints.md` は「Googlebot は描画するので title 等は React で足りる」としていた。描画の待ち・描画の失敗・描画しない検索の取得器では生の HTML の head しか見られない。本 ADR でこの判断軸を改める

## 決定

### 1. 対象のページ（第1段は ja だけ）

| ページ | head の材料 | head を決める関数（人の画面と同じ） |
|---|---|---|
| `/races/:date/:venue`（過去日の会場） | URL と ja の文言だけ | `getPastVenuePageMeta` |
| `/race/:raceId`（レース詳細） | `/api/predictions/{date}?light=true`（中止・結果の有無） | `getRaceDetailMeta` |
| `/venue/:code`（本日の会場、1〜24） | `/api/races/today`（SG・G1 の節の名前） | `getTodayVenuePageMeta` |
| `/racer/:id`（選手） | 選手のプロフィール・級・期別の要約（anon キーで読む） | `RacerProfile.jsx` の title・description・JSON-LD の組み方を `src/pure` へ移した物 |

- 言語版（/en/venue/… 等）・トップ・/today・ブログは第1段に入れない。言語版の race は noindex（ADR-0107）。トップは title が既に index.html と同じ。ブログの正規は BOA-1726 で別に扱う
- 入れるのは title・meta description・link canonical・JSON-LD（人の画面が出している物だけ）。og・twitter は変えない（SNS のボットは ADR-0089・0032 の本文の HTML を受ける）
- robots は変えない（生の HTML は今と同じ index.html の値。noindex の判定は今どおり人の画面が JS で付ける）

### 2. 組み方（全ての UA に同じ）

```
ブラウザ・Googlebot・その他
   │ GET /racer/4444
   ▼
middleware.js ──(AI の UA で ADR-0089・0032 の対象)──▶ 今どおり bot-page・スナップショットへ rewrite（本文つき）
   │ それ以外の全ての UA
   │ 並べて取る（合わせて上限の時間、目安 800ms・根拠なし。本番の計測で決め直す）
   ├─ GET /index.html（同じ host の静的なファイル＝今の配備の外枠）
   └─ head の材料: 純関数（/races）か GET /api/page-head/{kind}/{key}（JSON、CDN にキャッシュ）
   │
   ├─ 両方そろった → 外枠の <title> を置き換え、description・canonical・JSON-LD を data-page-head 付きで足して 200 を返す（Cache-Control は今と同じ no-store）
   └─ どれかが失敗・時間切れ・404 → 何も返さず素通り（今と同じ静的な index.html。1行の JSON ログ）
```

- **差し込むのは middleware、キャッシュするのは head の JSON だけ**。HTML をまるごと CDN に置かない
  - 理由1: `vercel.json` は人の HTML のパスに `Vercel-CDN-Cache-Control: no-store` を付けている（ADR-0089 未確認1: headers は rewrite 前のパスで照合される）。HTML を関数で返しても CDN に残らない。`vercel.json` は作り手が変えられない（AGENTS.md 安全の4）
  - 理由2: HTML をまるごとキャッシュすると、配備の後に古い HTML が消えた `/assets/*` を指しうる（配備ごとに CDN のキャッシュが分かれるかは未検証）。JSON の head は asset を指さないので、配備をまたいで残っても壊れない（変わるのは最大 s-maxage の間の文言だけ）
  - 理由3: 外枠は middleware が同じ host の `/index.html` を毎回取るので、その時の配備の外枠になる。関数に dist の index.html を同梱できるかの問題（`includeFiles` の index.html はソースの物）が起きない
- **失敗は素通り（今の外枠）にし、503 を人に返さない**
  - head の材料の取得の失敗・形の違い・選手が見つからない、は関数が 503（失敗）・404（該当なし）を `Cache-Control: no-store` で返し、middleware は素通りする。「該当なし」の head を CDN に残さない
  - 素通りの外枠は今と同じで canonical を持たないので、失敗が重なっても全ページが同じ canonical に集まる型（#2049）にならない。人も今と同じ画面を見る
  - 外枠の取得（`/index.html`）が 200 でない（保護のかかった Preview の 401 等）ときも素通り
- **UA で head を変えない**。AI の UA への本文の出し分け（ADR-0089・0032）は今どおりで、その HTML の head も人の画面と同じ関数の値（ADR-0089 決定3）。Googlebot は人と同じ外枠＋head を受ける（ADR-0089 の「Googlebot に出し分けない」を保つ）
- クエリ文字列は head の材料に使わない（キャッシュのキーを増やさない。ADR-0089 決定6と同じ）。人の `/race/:id` 等も head をクエリで変えない

### 3. head の値は人の画面と同じ関数で作る

- 各ページの title・description・canonical・JSON-LD を組む関数を `src/pure` に置き（今 `src/utils`・ページの中にある物は移す）、人の画面・`/api/page-head`・ボット向け HTML が同じ関数を呼ぶ
- 起動の前（`src/main.jsx` の描画の前）に `[data-page-head]` の要素を消し、差し込んだ title は index.html の既定の文に戻す。React 19 の `<title>`・`<meta>`・`<link>`・JSON-LD と重ねない（`useSingleTitle`・`useSocialMeta`・`RacerStructuredData` は今のまま）。描画した後の head は今と同じになる
- 生の HTML の head と描画後の head は、データの時点の差（キャッシュの s-maxage の間）を除き同じ値になる。違いうるのは選手の期別の勝率等が更新された直後だけ

### 4. キャッシュ（/api/page-head の応答。`/api` は vercel.json の no-store の規則の外）

| kind | 正常時の Cache-Control |
|---|---|
| venue | `public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600` |
| race（本日） | `public, max-age=0, s-maxage=60, stale-while-revalidate=30, stale-if-error=3600` |
| race（過去日） | `public, max-age=0, s-maxage=86400, stale-while-revalidate=3600, stale-if-error=3600` |
| racer | `public, max-age=0, s-maxage=21600, stale-while-revalidate=3600, stale-if-error=3600` |

- 本日・過去日の境は JST の日付（`/api/predictions` の UTC の判定との差は ADR-0089 第2段の未確認3と同じ。過去日の長いキャッシュは JST の翌日から）
- 失敗・該当なしは `no-store`（上の2）。関数の中でも材料を60秒使い回す（ADR-0089 決定4と同じ）

### 5. 公開の口の安全

- `/api/page-head/*` は誰でも直接呼べる前提で作る。引数はパスの形を正規表現で固定（会場 1〜24、レースは `YYYY-MM-DD-VV-RR`、選手は4桁）し、外は 404
- middleware からの取得は自分の host だけ（`originOf`）。利用者の入力から外の URL を組まない。/api の関門を通るので `internalApiHeaders` を付ける（ADR-0103）
- サーバーで使う鍵は anon キーだけ。`SERVICE_ROLE` の字が `/api/page-head` から import される物に無いことを verify で見る
- 差し込む値は全て HTML のエスケープ（JSON-LD は `<` を `<` に）を通す

### 6. 関数のリージョン

- 材料（Supabase）は ap-southeast-2。`/api/page-head/**` を syd1 に置く1行（`"api/page-head/**/*.js": { "regions": ["syd1"] }`）を `vercel.json` に足すのはオーナーに委ねる（関数の PR の本文に差分を書く）。足すまでは既定のリージョンで動き、遅ければ上限の時間で素通りする

## 却下した選択肢

- **関数が HTML をまるごと返し、middleware で全 UA を rewrite（11/27 の見積もりの C2）**: 上の理由1〜3。加えて関数が落ちると人に 5xx が出る（rewrite に素通りの道が無い）
- **ビルド時に head だけの外枠を全ページ分作る（SSG の head 版）**: 配備は1日3回なので本日の会場・レースの状態が最大6時間古い。選手1,600余りと過去のレースの全てを毎回作るとビルドが伸びる。選手だけなら成り立つので、第1段の効きを見て再考の候補にする
- **Googlebot にだけ head を入れる**: UA の出し分け（クローキングの疑い）になる。人とボットで同じ物を返す
- **SSR（framework mode）を今から**: グランプリに間に合わない。オーナーの決定（2026-11-27）で効きを見てから

## 影響

- 人の `/racer/*`・`/venue/1〜24`・`/race/*`・`/races/*/*` の HTML が middleware を通り、TTFB が延びる（CDN の HIT で数十 ms、MISS で材料の往復ぶん。未計測）。上限の時間で頭打ち。Core Web Vitals に効くので、配線の PR ごとに本番の人の TTFB の中央値を前後で比べる（ADR-0089 の照合のログに足す）
- middleware の matcher に `/races/:path*` を足す
- `/api/page-head` の起動の費用: venue 24 キー×5分、race は本日最大288キー×1分・過去日は長いキャッシュ、racer は6時間。月の起動は ADR-0089 第2段の見積もり（上限 月約1,000万回）より少ない見込み（未計測）
- 戻し方: (1) middleware の差し込みを kind ごとに外す PR (2) 急ぐときは Instant Rollback。差し込みが無くても人の画面は今と同じ

## 確かめ（各 PR）

- 新しい verify（既存の verify・e2e は変えない）
  - head の差し込みの純関数: title が1つ、canonical が1本、description が1つ、JSON-LD の `</script>` 破り無し、`data-page-head` が付く
  - middleware: 対象のパスで差し込み、材料の失敗・404・時間切れ・外枠の 401 で素通り（undefined）、AI の UA は今どおり rewrite、クエリを材料に持ち込まない
  - `/api/page-head`: パスの形の外は 404、材料の失敗は 503・no-store、正常時の Cache-Control が上の表どおり、import の木に `SERVICE_ROLE` の字が無い
  - 起動の前の消去: `[data-page-head]` が消え、title が既定の文に戻る
- 本番（claude/* に Preview は無い）: 配線の後、curl で生の title・canonical がページごとに違うこと、`x-vercel-cache` の HIT、人の UA で画面が壊れないこと、TTFB の前後。窓口が URL 検査で Google の正規と user_canonical の一致を見直す

## 未確認

1. middleware の実行の場所（地域）と、middleware から自分の host への fetch が CDN のキャッシュを通る速さ（ADR-0089 の関数の材料の取得は通っている）
2. 上限の時間（目安 800ms、根拠なし）の妥当さ。本番の分布で決め直す
3. 配備ごとに CDN のキャッシュが分かれるか（本 ADR の形ではどちらでも壊れない）
4. 生の head を入れたことの効き（GSC のレース・選手のクリック）。SSR を決めるときの材料（オーナーの決定どおり4〜6週）
