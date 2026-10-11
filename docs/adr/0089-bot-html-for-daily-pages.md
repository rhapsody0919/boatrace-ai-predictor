# ADR 0089: 日替わりページのボット向け HTML をリクエスト時に関数で作る

## ステータス
提案（2026-10-11。オーナーの実装判断待ち。出す UA の範囲は、オーナーが 2026-10-11 に「検索ボットにも配る」と決めた）

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
2. **出すページ**: 第1段は、日本語の / と /venue/:code（01〜24 のみ）。次のパスには出さない。
   - 言語の接頭辞が付くパス
   - `?date=` 付き
   - `/races/:date` 系
   - /today とレース詳細は第2段とし、本 ADR に追記して決める
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
   - 引数は venue code（01〜24 の固定集合）だけを受け、それ以外は 404。クエリ文字列は無視する
   - 外部への取得は自分の `/api/races/today` だけ。利用者の入力から URL を組まない
   - キャッシュのキーは最大25個に限られる
   - UA を偽れば誰でもボット向け HTML を取れる。ただし中身は公開ページの部分集合なので害は無く、逆引き DNS での本物判定はしない
7. **生の値を一覧で出さない（提案書 §8-3・ADR 0067）**
   - 出走表の選手一覧・オッズ・払戻・着順の表は、ボット向け HTML に入れない。人の画面に出ていても入れない
   - 第1段は、開催の予定（会場・節の名前・日目・レース番号・締切時刻・グレード）だけを出す
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
  - 見る項目: 見出し・会場名・節の名前・日目・レース番号・締切時刻・リンク先
  - ボット側の文字列がすべて人の DOM にあれば合格
- **verify-middleware-routing.js（CI）を拡げる**
  - / と /venue/01: 上記 UA なら関数へ振り分ける
  - Googlebot と人のブラウザ: 振り分けない
  - /venue/99: 振り分けない
- Vercel Observability: middleware の rewrite のパス別件数、/api/bot-page の起動回数・5xx
- Bing Webmaster Tools: インデックスの件数、手動の措置の有無

## 未確認（実装の PR3 で確かめる）
1. **キャッシュの優先順**
   - Vercel の公式の優先順は `Vercel-CDN-Cache-Control` ＞ `CDN-Cache-Control` ＞ `Cache-Control`。`Vercel-CDN-Cache-Control` は vercel.json に書いても最優先
   - 今の vercel.json は、ページのパス `/((?!api|assets).*)` に `Vercel-CDN-Cache-Control: no-store` を付けている
   - headers の照合が rewrite の前と後のどちらのパスで行われるかは、文書で決まらない
   - Preview で bingbot の UA で2回続けて取り、`x-vercel-cache` が MISS→HIT になるかを見る
   - MISS が続くなら、vercel.json の no-store の規則に UA の除外（`missing`）を足し、UA の一覧が `aiCrawlerBots.js` と一致することを verify で固定する
2. **キャッシュの取り違え**
   - キャッシュのキーに UA は入らない
   - ボットで /venue/01 を取った直後に、人の UA で同じ URL を取り、SPA の外枠が返ることを確かめる
   - ボット向け HTML が人に返ったら公開しない。その場合は `Vary: User-Agent` を付けて確かめ直す
3. **人の会場ページに出る項目が、すべて `/api/races/today` から取れるか**: 人の会場ページは `/api/predictions/{date}` を使っている。PR1 で突き合わせる
4. 実際のボットの来訪数と、どの地域から来るか
   - 実装の前に、Vercel の画面で今のスナップショット（/blog/*・/today）への UA 別の取得数を1日分見る

## 実装の進め方（オーナーが実装を決めた場合）
| 順 | PR | 中身 |
|---|---|---|
| 1 | 整形関数の切り出し | 人の画面の挙動は変えない。Node から import できることを verify で固定する |
| 2 | 関数の追加（まだ配線しない） | 関数とキャッシュのヘッダー、503 の経路、venue code の検証。Preview で関数の URL を直接取って確かめる |
| 3 | 配線 | middleware の振り分け。上の「未確認」の1・2を Preview で確かめる。人の / の TTFB を、配線の前後で10回ずつ測る |
| 4 | 日中の照合 | 上の「監視」。わざと文言を1つ足した HTML で落ちることを確かめる |
| 5 | 第2段 | /today とレース詳細。第1段の監視を2週間見てから、本 ADR に追記して決める |
