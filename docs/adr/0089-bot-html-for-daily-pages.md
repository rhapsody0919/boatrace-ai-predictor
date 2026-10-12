# ADR 0089: 日替わりページのボット向け HTML をリクエスト時に関数で作る

## ステータス
採用（2026-10-11。オーナーが「実装に入る」と決めた。出す UA の範囲は、同日に「検索ボットにも配る」と決めた。Vercel は Pro プラン）

## 背景
ADR 0032 は、AI クローラー向けの中身を「ビルド時に作る静的スナップショット」で配ると決めた。リクエスト時に作ってキャッシュする案（案C）は、「配るページはブログ記事と機能の説明で、更新が少ない静的コンテンツだから」として却下した。

日替わりのページには、この前提が当てはまらない。
- トップ（/）と会場ページ（/venue/:code）は、中身が毎日変わる。開催場・節の名前・日目・各レースの締切時刻・グレード
- ビルド時に作る方式では、日替わりの中身を入れられない。/today の今のスナップショットも「定義だけ」になっている（`src/config/aiCrawlerBots.js` の注記）
- 本番の実測（2026-10-05、`docs/proposal/ai-agent-era-strategy.md` §2）では、bingbot がブログ以外のページを取ると、中身の無い外枠しか返らない

オーナーの決定（2026-10-11）: ボット向け HTML は、AI の取得用 UA に加えて bingbot・Applebot・DuckDuckBot にも配る。Googlebot には配らない。

検討の経緯は、SEO 点検の F2（2026-10-11、system-architect 役）。

## 決定
1. **出す UA**: `src/config/aiCrawlerBots.js` の `AI_CRAWLER_USER_AGENTS`。AI の取得用 UA と、bingbot・Applebot・DuckDuckBot を含む。Googlebot には出さない。Googlebot は JS を描画して人と同じ画面を見るので、UA で出し分けない（0032 と同じ）
2. **出すページ**: 第1段は、日本語の / と /venue/1〜24（0埋めなし、人の URL と同じ）。次のパスには出さない。
   - `/venue/01` のような0埋め・範囲外・数字以外（人と同じ SPA のまま）
   - 言語の接頭辞が付くパス（第2段で言語版の / と /venue/1〜24 を足す。下の「第2段」）
   - `/races/:date` 系
   - /today とレース詳細は第2段とし、本 ADR に追記して決める（下の「第2段」）
   - クエリ文字列（`?date=` を含む）は人もボットも読まない。人の / と /venue/:code は日付を URL のパス（`/races/:date/...`）からしか取らず、`/venue/1?date=2026-10-01` を開いても本日の会場ページを出す（canonical も `/venue/1`）。そのためボットにも本日の HTML を返し、rewrite 先にクエリを持ち込まない（CDN のキーを増やさない）。2026-10-12 に本番で、人とボットの両方が本日の桐生を出すことを確かめた（SEO 再点検の N1。当初の「`?date=` 付きには出さない」は、人の画面の動きと食い違っていたので直した）
3. **HTML の組み方**
   - `middleware.js` の `resolveSnapshotPath` が、上記 UA のときだけ `/api/bot-page/top`・`/api/bot-page/venue/{code}` へ rewrite する。matcher に `/` と `/venue/:code` を足す
   - 関数（Node、`vercel.json` の functions で syd1）は、`/api/races/today` の JSON から HTML を組む
   - 整形は人の画面と同じ関数を使う（`transformTodayRaces` などを、ブラウザ専用の依存の無い純粋なモジュールへ切り出す）
   - 文言は人の画面と同じ `src/locales/ja/common.json` のキーを使う
   - ボット向け HTML は、人の画面の部分集合にする。人の画面に無い文言・見出し・数値・リンクを足さない
   - title・meta description・canonical・robots は、人のページと同じ値にする
   - 時刻で変わる状態（発売中・締切など）は出さない。人の画面にある最終更新時刻を出す
4. **キャッシュ**
   - 関数の応答に `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600` を付ける。材料の `/api/races/today` が s-maxage=300 なので、それより短くしても意味がない
   - 関数の中でも、材料の JSON を60秒だけ使い回す（モジュールスコープ）。CDN のキャッシュが効かなかった場合も、DB の負荷が増えないようにする
   - CDN のキャッシュが効くことは、Preview の `x-vercel-cache` で確かめてから本番に出す（下の「未確認」の1）
5. **失敗したとき（ADR 0069）**
   - 材料が取れない・形が違うときは、503・`Retry-After: 300`・`Cache-Control: no-store` を返す
   - 「本日開催なし」の HTML は、材料を正しく取れて0件だった場合だけ出す。取得の失敗を「開催なし」に化けさせない
   - CDN に前回の正常な応答があれば、`stale-if-error` がそれを返す
6. **公開エンドポイントの安全策（ADR 0059 §2）**
   - 関数の URL は、誰でも直接呼べる前提で作る
   - 引数は venue code（1〜24、0埋めなしの固定集合）だけを受け、それ以外は 404。クエリ文字列は無視する。middleware も rewrite 先に元のクエリ文字列を持ち込まない（`/?x=1` と `/?x=2` でキャッシュのキーを増やさない）
   - 外部への取得は自分の `/api/races/today` だけ。利用者の入力から URL を組まない
   - キャッシュのキーは最大25個に限られる
   - UA を偽れば誰でもボット向け HTML を取れる。ただし中身は公開ページの部分集合なので害は無く、逆引き DNS での本物判定はしない
7. **生の値を一覧で出さない（提案書 §8-3・ADR 0067）**
   - 出走表の選手一覧・オッズ・払戻・着順の表は、ボット向け HTML に入れない。人の画面に出ていても入れない
   - 第1段は、開催の予定（会場・節の名前・レース番号・締切時刻・グレード）だけを出す
   - 日目は入れない。人のトップ・会場ページが日目を出していないので、決定3（人の画面の部分集合）を優先する（PR1・PR2 で確認）
8. **関数のリージョンは syd1**。DB は ap-southeast-2 にあり、syd1 からの往復は 28〜46ms、iad1 からは約250ms（`docs/design/scraping-vercel-consolidation/orchestration.md` の実測）

## 動的レンダリング・クローキングへの立場（一次情報、確認日 2026-10-11）
| 提供元 | 原文（短い引用） | URL |
|---|---|---|
| Google | "Dynamic rendering is a workaround and not a recommended solution" | https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering |
| Google | "As long as your dynamic rendering produces similar content"（ならクローキングと見なさない） | 同上 |
| Google（スパムポリシー） | 検索エンジンのときだけ文言やキーワードを足すのはクローキング | https://developers.google.com/search/docs/essentials/spam-policies |
| Bing（現行のガイドライン） | "Sites should not rely on cloaking or serving materially different experiences" | https://www.bing.com/webmasters/help/webmasters-guidelines-30fba23a |
| Bing（2018年のブログ） | サーバーで描画しただけで中身が同じなら、クローキングではない | https://blogs.bing.com/webmaster/october-2018/bingbot-Series-JavaScript,-Dynamic-Rendering,-and-Cloaking-Oh-My |
| Apple（Applebot） | 動的レンダリング・クローキングへの記述は見つからなかった | https://support.apple.com/en-us/119829 |
| DuckDuckGo | 通常のリンクは "which we largely source from Bing"。実質は Bing の方針が効く | https://duckduckgo.com/duckduckgo-help-pages/results/sources |

このため、上の決定3（人の画面の部分集合・同じ材料・同じ文言）と、下の「監視」の日中の照合を、検索ボットに配る条件とする。

## 費用（Vercel Pro、単価の確認日 2026-10-11）
| 項目 | 単価 | 出典 |
|---|---|---|
| Function Invocations | $0.60 / 100万回 | https://vercel.com/docs/functions/usage-and-pricing |
| Active CPU（syd1） | $0.180 / 時 | 同上 |
| Provisioned Memory（syd1） | $0.0149 / GB時 | 同上 |
| Fast Origin Transfer | $0.06〜0.43 / GB | https://vercel.com/docs/pricing/regional-pricing |
| CDN Requests・Fast Data Transfer | Pro の込みの枠は月100万回・1TB | https://vercel.com/docs/pricing/flat-rate-cdn |
| Routing Middleware | fluid compute と同じ料金 | https://vercel.com/docs/routing-middleware |

月額の見積もり（上限側）:
- 関数: 約 $1.6〜4.0
  - 前提: 25 URL × 300秒ごと＝月216,000回、1回 50ms、HTML 30KB
  - 関数の応答のキャッシュは地域ごとなので、ボットの来る地域の数だけ倍になる
- middleware: $0.1 未満（人の / と /venue/* の閲覧で、月1万〜10万回）
- 未確認: Pro のクレジット $20 と CDN の枠の残り、Supabase のプランと egress の残り

## 却下した選択肢
- **ビルド時スナップショットのまま（0032 の延長）**: 日替わりの中身が入らない。毎日デプロイするのは、デプロイの運用とビルド時間の負担が大きい
- **人の画面の React 部品を renderToString でサーバーで描く**: 人の画面はデータを useEffect で取るので、データが入らない。データを渡せる形に書き換えるのは、0032 案B（フル SSR）寄りの規模になる
- **vercel.json の rewrites の has（user-agent）で振り分ける**:
  - `/` は index.html というファイルが rewrite より先に勝つので、振り分けられない
  - UA の一覧が `aiCrawlerBots.js` と二重になる
- **Playwright でその場で描いて保存する（0032 案C の原案）**: ブラウザを動かす実行時間と、キャッシュの層が新しく要る。API の JSON から組めば足りる
- **Googlebot にも配る**: Google は動的レンダリングを推奨しない回避策としている。Googlebot は JS を描画できるので、配る理由が無い
- **AI の取得用 UA だけに配る**: クローキングの懸念は最も小さいが、オーナーが検索ボットにも配ると決めた（2026-10-11）

## 影響
- middleware が、人の / と /venue/:code の閲覧でも起動する（UA を見て素通りするだけ）。トップの表示速度（TTFB）への影響は Preview で実測する
- 人の画面の整形関数を、ブラウザ専用の依存（supabaseClient・import.meta.env）から切り離す
- `docs/reference/cache-strategy.md` に関数のキャッシュ方針を追記する
- ADR 0032 の「Edge Runtime（デフォルト）」は、今の Vercel 公式（middleware.js の既定は Node.js）と食い違う。0032 に注記を足す
- 戻し方
  1. 検索ボットだけ外す: ページ単位の UA 集合から bingbot・Applebot・DuckDuckBot を外す（ブログのスナップショットには残す）
  2. 全部止める: `resolveSnapshotPath` から / と /venue/:code を外す PR を出す
  3. 急ぐとき: Vercel の Instant Rollback で前のデプロイに戻す

## 監視
- **日中の照合**（GitHub Actions、レース開催中の JST 12:00 ごろ。失敗は Slack に流す）
  - 本番の / と /venue/{開催中の2会場} について、bingbot の UA で取った HTML と、Playwright で人として描いた DOM を比べる
  - 見る項目: 見出し・会場名・節の名前・レース番号・締切時刻・リンク先
  - ボット側の文字列がすべて人の DOM にあれば合格
  - 実装（PR4）: ワークフロー `.github/workflows/bot-html-parity.yml`（毎日 UTC 03:00 = JST 12:00、手動でも動かせる）が `scripts/maintenance/verify-bot-html-parity.js`（tier manual）を実行する。照合の関数は `scripts/lib/botHtmlParity.js`、その検証は `scripts/maintenance/verify-bot-html-parity-logic.js`（tier ci、本番の HTML を保存したフィクスチャ）
  - あわせて見るもの: bingbot の直後に人の UA で同じ URL を取り SPA の外枠が返ること（上の「未確認」の2を毎日確かめる）、Googlebot の UA の / が SPA の外枠であること。人の UA の TTFB の中央値（/・/venue・middleware を通らない /race）はログに残すだけで、失敗にしない
  - 最終更新の時刻だけは、同じ文言で10分以内の差を許す。材料の `/api/races/today` は CDN に地域ごとに5分残り、関数（syd1）とブラウザが別の時点の材料を読む（2026-10-12 の本番でボット 08:42、人 08:40）
  - 照合の失敗（終了コード 1）、照合の途中で止まった（2）、照合より前の手順で落ちた、のどれも Slack に流す（`SLACK_WEBHOOK_URL`、`nightly-verify-db.yml` と同じ形）
- **verify-middleware-routing.js（CI）を拡げる**
  - / と /venue/1〜24: 上記 UA なら関数へ振り分ける
  - Googlebot と人のブラウザ: 振り分けない
  - /venue/01・/venue/0・/venue/25・/venue/abc・言語の接頭辞付き・/races/…: 振り分けない
  - クエリ付き（/?x=1・/venue/1?x=1）: rewrite 先にクエリを持ち込まない
- Vercel Observability: middleware の rewrite のパス別件数、/api/bot-page の起動回数・5xx
- Bing Webmaster Tools: インデックスの件数、手動の措置の有無

## 未確認（実装の PR3 で確かめる）
1. **キャッシュの優先順**
   - Vercel の公式の優先順は `Vercel-CDN-Cache-Control` ＞ `CDN-Cache-Control` ＞ `Cache-Control`。`Vercel-CDN-Cache-Control` は vercel.json に書いても最優先
   - 今の vercel.json は、ページのパス `/((?!api|assets).*)` に `Vercel-CDN-Cache-Control: no-store` を付けている
   - headers の照合が rewrite の前と後のどちらのパスで行われるかは、文書で決まらない
   - Preview で bingbot の UA で2回続けて取り、`x-vercel-cache` が MISS→HIT になるかを見る
   - MISS が続くなら、vercel.json の no-store の規則に UA の除外（`missing`）を足し、UA の一覧が `aiCrawlerBots.js` と一致することを verify で固定する
   - 結果（#1409 の Preview、2026-10-12）: 配線だけでは MISS が続いた（応答に `CDN-Cache-Control: no-store`。headers は rewrite 前のパスで照合される）。no-store の規則を分け、/ と /venue/1〜24 だけ `missing` で配る UA を除外したところ MISS→HIT になった。UA の一覧の一致は `verify-middleware-routing.js` で固定した
2. **キャッシュの取り違え**
   - キャッシュのキーに UA は入らない
   - ボットで /venue/1 を取った直後に、人の UA で同じ URL を取り、SPA の外枠が返ることを確かめる
   - ボット向け HTML が人に返ったら公開しない。その場合は `Vary: User-Agent` を付けて確かめ直す
   - 結果（#1409 の Preview、2026-10-12）: ボットの直後に人・Googlebot の UA で / と /venue/1・9・12 を取り、すべて SPA の外枠が返った（人が先でも同じ）。`Vary: User-Agent` は付けていない
   - 付記: rewrite 先の関数には、req.url が元のパス（/venue/1）のまま届く。関数は /venue/{code} も受ける
3. **人の会場ページに出る項目が、すべて `/api/races/today` から取れるか**: 人の会場ページは `/api/predictions/{date}` を使っている。PR1 で突き合わせる
4. 実際のボットの来訪数と、どの地域から来るか
   - 実装の前に、Vercel の画面で今のスナップショット（/blog/*・/today）への UA 別の取得数を1日分見る

## 実装の進め方
| 順 | PR | 中身 |
|---|---|---|
| 1 | 整形関数の切り出し（#1400） | 人の画面の挙動は変えない。Node から import できることを verify で固定する |
| 2 | 関数の追加（まだ配線しない、#1401） | 関数とキャッシュのヘッダー、503 の経路、venue code の検証。Preview で関数の URL を直接取って確かめる |
| 3 | 配線（#1409） | middleware の振り分け。上の「未確認」の1・2を Preview で確かめる。人の / の TTFB を、配線の前後で10回ずつ測る |
| 4 | 日中の照合 | 上の「監視」。わざと文言を1つ足した HTML で落ちることを確かめる |
| 5 | 第2段 | /today とレース詳細。第1段の監視を2週間見てから、本 ADR に追記して決める |

## 第2段（BOA-848、2026-10-12 追記）
オーナーの決定（2026-10-12）: 作るのは今から、公開は1週間後。配線の PR は draft で止め、10/19 にオーケストレーターが次を材料にユーザーへ出す。
- 毎日の照合の1週間分
- Bing Webmaster Tools（インデックスの件数、手動の措置の有無）
- 関数の起動回数と費用（Vercel Observability）

上の決定1・3〜8は第2段にもそのまま当てはめる。決定2の「言語の接頭辞が付くパス」「/today とレース詳細は第2段」は、下の表で置き換える。

### 出すページと方式
| ページ | 方式 | 状態 |
|---|---|---|
| 言語版の / と /venue/1〜24（/en/・/zh-TW/・/ko/） | 関数（第1段と同じ） | 関数 #1424、照合 #1426、配線 #1425（draft） |
| 翻訳記事 /{lang}/blog/{id}・ブログ一覧 /blog と /{lang}/blog | ビルド時スナップショット（0032 の延長） | 未着手 |
| /today の日替わりの中身 | 関数 | 未着手 |
| レース詳細 /race/{id}（と言語版） | 関数（本日の日付の id だけ） | 未着手 |
| 節 /venue/{code}/meet/{date} | 保留 | - |

方式の決め方: 中身が日替わり・直前で変わるものは関数（決定3・4）。デプロイのときだけ変わるもの（ブログ）はビルド時。

### 1. 言語版の / と /venue/1〜24
- 出すもの: 第1段と同じ項目（決定7）を、その言語の `src/locales/{lang}/common.json` の文言で出す。無いキーは人の画面（`src/i18n.js`）と同じく ja に戻す
- 人の画面と同じ値にするもの
  - title・description・canonical: `getTopPageMeta(t, lang)`・`getTodayVenuePageMeta(t, code, races, lang)`
  - リンク先・パンくず: `localizePath`（人の `useLocalizedPath` と同じ）。例 `/en/venue/1`・`/en/race/{id}`
  - `<html lang>`: 言語コード（人の画面は `i18n.js` が `document.documentElement.lang` に入れる）
  - hreflang・共通の JSON-LD: ja と同じ（人の画面も index.html の共通の JSON-LD と HreflangTags のまま）
- 節の名前（`raceTitle`）は日本語のまま。人の画面も日本語で出している（`translate="no"`）
- `/en`（末尾の / なし）も `/en/` と同じ HTML を返す。人の SPA も `/en` で en のトップを描く（canonical は `/en/`）
- rewrite 先は言語ごとに分ける（`/api/bot-page/{lang}/top`・`/api/bot-page/{lang}/venue/{code}`）。CDN のキャッシュのキーで言語が混ざらない。キーは最大 25×4＝100 個
- 関数は `api/bot-page/[lang]/top.js`・`api/bot-page/[lang]/venue/[code].js`。言語はパスから読み、en・zh-TW・ko 以外・0埋め・範囲外は 404
- `vercel.json` のページの no-store の規則は、第1段と同じく、言語版の2つの形だけ配る UA を `missing` で除外する
- 費用: 第1段の上限の見積もり（月 $1.6〜4.0）がキーの数に比例して4倍、月 $6.4〜16 が上限

### 2. 翻訳記事・ブログ一覧
- ja の記事と同じ作り方（`scripts/generate-ai-snapshots.js` が dist を配り、Playwright で描いた HTML を保存）。人の画面そのものなので、部分集合の条件は満たす
- 翻訳記事は `blogPostsEn`・`blogPostsZhTw`・`blogPostsKo` に載っている記事だけ（各25件、2026-10-12）。本文は `public/blog/{id}-en.md` 等
- 一覧は /blog と /{lang}/blog の4枚。人の一覧はその言語の記事だけを出す（`getPostsForLang`）
- 配信: `resolveSnapshotPath` と middleware の matcher に `/{lang}/blog/{id}`・`/blog`・`/{lang}/blog` を足す
- 失敗の検知: ja と同じく status.json に件数を足し、日中の照合（`evaluateSnapshotStatus`）で見る
- ビルド時間: 下の「ビルド時間」

### 3. /today
- 今のスナップショットは定義だけ。日替わりの中身は早朝のバッチ（JST 05:30 ごろ公開）が `morning_digest_days`・`morning_digest_rows` に書くので、関数で読む
- 出すもの: h1・日付・「N会場 Nレース」・期間・各セクションの名前と説明、注目レースと逃げ・まくり・逃がしのカード（会場・レース番号・率）、用語、免責、パンくず
- 出さないもの: フライング持ち・帰郷明けの選手の一覧と選手名（選手一覧に当たる。決定7）
- `?date=` 付きは振り分けない。人の /today は `?date=` の日を出すので、本日の HTML を返すと中身が食い違う（/venue/:code は `?date=` を読まないので本日を返す。決定2）。canonical は人と同じ `/today`
- 材料の読み方: 関数から Supabase を公開の読み取り（anon キー、RLS の範囲）で読む。モジュールスコープで60秒使い回す（決定4と同じ）。新しく公開 API を作るかは実装の PR で決める
- 「本日ぶんはまだ公開されていません」は、材料を正しく読めて0件のときだけ出す（決定5）

### 4. レース詳細
- 出すもの（人の初期表示のうち）
  - 上の帯: グレード（一般戦は出さない）・節の名前
  - h1: 会場名と「NR」・種別（優勝戦など）・日目（人のレース詳細は日目を出すので入れる。決定7の「日目は入れない」はトップ・会場ページの話）
  - 締切予定時刻・中止の表示
  - パンくず（ホーム › 会場 › NR）と、会場ページ・前後のレースへのリンク
- 出さないもの
  - 出走表の選手一覧（データ出走表・基本情報タブ）、オッズ、払戻、着順と結果タブ（決定7）
  - AI 予想タブ（展開予測・イン崩れ指数・出現パターン）。人の初期表示に無い
  - 直前情報タブ（天候・展示）。人の初期表示に無い
  - 「AI用にコピー」・思考アシストの入口
- 振り分けるのは本日（JST）の日付の id（`YYYY-MM-DD-VV-RR`）だけ。過去の日付は SPA のまま。キーは1日最大 288×4言語
- 材料: 人と同じ `/api/predictions/{date}`（当日は s-maxage=300）
- sitemap は変えない（ADR 0026）。ボット向けに出すことと sitemap に載せることは別。robots は人のページと同じ値
- 費用の上限: 全キーが5分ごとに取られると月約1,000万回（起動 $6、Active CPU 50ms で約 $25）。実際の取得はずっと少ないはずで、10/19 の起動回数を見て着手を決める

### 5. 節ページ（保留）
- 画面の中心が得点率ランキング・勝ち上がり・優勝者で、すべて選手一覧・着順に当たり出せない（決定7）
- 出せるのは見出し（グレード・会場名・期間・節の名前・日目・段階）だけで、中身が薄い
- 材料は Supabase の6テーブル。関数に新しい読み取りの経路が要り、noindex の判定（`knownMeet` など）も人と合わせる必要がある
- 言語版・ブログ・/today・レース詳細の後に、要るかを決め直す

### 照合と生の値の固定
- 新しく関数で出すページは、毎日の照合に足す。照合するページは振り分けの設定（`resolveSnapshotPath`）から決める（#1426）。配線の前は飛ばして注記に出し、配線が入ればそのまま照合に加わる
- 照合の本文の比較は、英字の大文字・小文字を区別しない。人の innerText は CSS の `text-transform` を反映する（会場ページの締切のラベルは uppercase。言語版の Preview の照合で分かった）
- 生の値（選手一覧・オッズ・払戻・着順）が入らないことは、ページごとに `verify-bot-page-function.js`（tier ci）で固定する。言語版は3言語の全会場の本文に選手名・生の `<script>` が無いことを見る
- ビルド時スナップショット（ブログ）は、status.json と `verify-ai-snapshots.js` で見る

### ビルド時間
- 言語版・/today・レース詳細は関数なので、ビルド時間は増えない
- 翻訳記事75件と一覧4枚を足す分の見積もり
  - 手元の実測（2026-10-12）: `vite build` 10秒、スナップショット生成 33秒（ブログ ja 121件・/winning-technique・/today・選手1件、並列4）。ブログ1件あたり約0.25秒
  - 79件で手元なら約20秒。Vercel のビルド機が手元の3倍遅くても約1分
  - 今の本番ビルド約6分半が約7分半になる見込みで、上限45分に対して余裕がある

### 未確認（第2段）
1. 言語版の人の TTFB（本番）: Preview では、/en/・/en/venue/1 が matcher に入って middleware を通るようになり、人の TTFB の中央値が約38ms→約220ms になった（#1425 の Preview、10巡）。本番で配線済みの / も Preview では約250ms だが、本番の照合では / 40ms・/race 25ms で差は約15ms。Preview 特有と見ているが、公開後に照合のログ（TTFB に /en/ を足した）で比べる
2. レース詳細の材料: 人は軽量版（`?light=true`）を取ってからフル版を取る。h1 の種別・日目が軽量版に入っているか
3. レース詳細の日付の境目: `/api/predictions/{date}` は当日の判定を UTC の日付でしている。middleware は JST の日付で振り分けるので、0時〜9時（JST）のキャッシュの長さを確かめる
4. /today の材料の読み方（関数から anon キーで読むか、公開 API を作るか）

### 実装の進め方（第2段）
| 順 | PR | 中身 |
|---|---|---|
| 6 | 言語版の関数（#1424） | 配線しない。Preview で関数の URL を直接取って確かめた |
| 7 | 言語版の照合（#1426） | 振り分けているページだけ照合。TTFB の記録に /en/ |
| 8 | 言語版の配線（#1425、draft） | 10/19 の判断までマージしない |
| 9 | 翻訳記事・一覧 | ビルド時。作る側と配線を分ける（配線は draft） |
| 10 | /today | 関数。作る側・照合・配線（draft） |
| 11 | レース詳細 | 関数。作る側・照合・配線（draft） |
