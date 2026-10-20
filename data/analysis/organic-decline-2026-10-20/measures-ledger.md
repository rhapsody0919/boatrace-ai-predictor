# 検索に見える変更の台帳（2026-05-01〜08-31 と 2026-09-20 以降）

自然検索が 5〜8月に減った原因候補を照合するための台帳。出典は git（`origin/master`、2026-10-20 11:40 JST の e395e3ccf 時点）と docs・data。日時は JST。

- 「master 入り」は first-parent の取り込み commit の日時（squash は commit 自体、merge は merge commit）。author 日付とずれるものは両方書く
- SHA は「元の commit → 取り込み commit」。PR 番号は commit の件名・merge の件名から
- 本番への反映日は別物（4章）
- ファイル:行は commit 済みの HEAD（6104d9e50）の行番号。docs/operation/search-console-report.md はこの PR で末尾に節を足しただけで、既存の行番号は変わらない

## 1. 2026-05-01〜08-31 の変更

### 1-0. 抽出の方法と範囲
- `git log --since=2026-05-01 --until=2026-09-01` を、対象ファイル（index.html・middleware.js・vercel.json・public/robots.txt・scripts/generate-sitemap.js・scripts/submit-sitemap.js・scripts/generate-ai-snapshots.js・src/i18n.js・src/config/languages.js・src/components/HreflangTags.jsx・src/hooks/useSocialMeta.js・src/hooks/useRobotsMeta.js・src/data/blogPosts.js・src/locales/*/common.json）と、差分の正規表現（canonical・hreflang・ld+json・"@type"・og:title・noindex・document.title・documentElement.lang・robots・sitemap）と、件名のキーワード（title・meta・OGP・CTR・SEO・i18n・lang・rebrand・龍神 等）で絞った
- 対象外: ブログ記事・会場ガイドの本文の追加（件数が多い。sitemap の URL 数の推移は 1-8 に出す）、`chore: update sitemap [automated]` の日次 commit（1-8 にまとめる）
- 5〜6月の該当は 1-1 の3件と日次の sitemap 更新だけ。対象ファイルへの手の入った変更は 7/10 から（`git log --since=2026-05-01 --until=2026-07-01 -- <対象ファイル>` で automated 以外 0件）

### 1-1. 2026-05〜06
| master 入り | SHA | PR | 区分 | 要旨 | 対象 URL | 出典 |
|---|---|---|---|---|---|---|
| 05-13 09:44 | de73edf83 | #98 | e | 出目分布ページを追加。title・description を Helmet で出力。canonical は無し（7/14 の 334a8cc16 で追加） | /outcome-distribution | de73edf83 の差分、334a8cc16 の本文 |
| 05-23 12:19（-0400 表記 05-22 23:19） | 7c34d44fb・823ccb8cd → 0e5e8f596 | #101 | e | /holmes・/poirot（α版）を追加。Helmet で `robots noindex, nofollow`。ただし Helmet の meta は React 19 で出ていなかった（334a8cc16 の本文）ので、7/14 まで noindex は効いていない | /holmes, /poirot | 0e5e8f596:src/pages/Holmes.jsx:49・Poirot.jsx:10、334a8cc16 |
| 05-01〜06-30 毎日 | 436d08ad2 ほか | なし | d | sitemap の日次自動生成だけ。URL 数 234（5/1）→267（6/1）→297（7/1）。増分は /races/:date | sitemap 全体 | 1-8 |

### 1-2. 言語（a）
| master 入り | SHA | PR | 要旨 | 対象 URL | 出典 |
|---|---|---|---|---|---|
| 07-10 10:43（author 07-07） | b3cda6a52・0ffb79ee4 → 502d274f9 | #110 | i18n 基盤。言語判定は localStorage → navigator（ブラウザ言語）。`<html lang>` を表示言語に同期 | 言語接頭辞なしの全ページ | b3cda6a52 の src/i18n.js（detection.order）、0ffb79ee4 |
| 07-13 11:17 | 74f96f80d ほか → 99f069e21 | #115 | トップ・予想パネルの UI を英語化（翻訳キー化） | / ほか | 99f069e21 の取り込み commit 件名 |
| 07-13 12:53 | b01529470・5761c0cbf → 54e01b032 | #116 | /en/* ルーティング、hreflang（ja・en・x-default）を全ページに出力、トップに言語別 title・description・canonical、言語設定 en の人を初回だけ /en へリダイレクト。en の meta.title をここで追加 | 全ページ（hreflang）、/ と /en/ | b01529470 の本文・diff stat |
| 07-14 13:03 | 7eba3bf50・ae5e76af0 → 900fbcfb0 | #118 | 英語入門ガイド追加、ナビの言語接頭辞維持、言語リダイレクトをトップ限定に変更 | /en/guide、/ | 900fbcfb0 の取り込み commit 件名 |
| 07-19 10:53 | 9056b5831・59542aa76 → c8551ff61 | #120 | 英語の会場別ガイド。EN 専用ページでは hreflang を出さない | /en/venues/* | 同 |
| 07-19 11:51 | 7e2eeaf0c・e5003b5b9 → 0764010eb | #124 | 言語定義の一元化、/en 固定処理の汎用化 | 言語版全体 | 7e2eeaf0c 件名 |
| 07-19 12:20 | 6fd8a3102・5fe4ab94a → 6b2ef6584 | #125 | 繁体字（zh-TW）対応 | /zh-TW/* | 6fd8a3102 件名 |
| 07-24 10:31 | 0651caac0 → 5043e68d4 | #126 | 韓国語（ko）対応 | /ko/* | 0651caac0 件名 |
| 07-24 13:43 | 71da9ac76 → c339567ed | #130 | 会場ガイドを zh-TW に展開 | /zh-TW/venues/* | 同 |
| 07-27 13:32 | 0ea8e8e12 | #150 | /en/venues 等で対応外の言語ボタンを押すとトップへ飛ばされる不具合を修正（言語ボタンの無効化） | /{lang}/venues | 0ea8e8e12 本文 |
| 08-09 08:31 | 28faaeae8 → 374cadb4e | #191 | 未翻訳パスへの /{lng}/ アクセスを ja 版へリダイレクト（React Router の Navigate）。lang=en で日本語を配る状態を解消、hreflang の非出力と連動 | 未翻訳の /{lng}/* | 28faaeae8 本文 |
| 08-09 16:28 | bec8f02b7 | #194 | データ分析ツールのページを4言語で公開（sitemap にも追加） | /{lang}/winning-technique | 同件名、generate-sitemap.js の履歴 |
| 08-10 19:12〜21:41 | 4d0c047fd・f6838c83e・48fc3143b ほか | #245〜#271 | zh-TW の地域ハブ、ko の会場ガイド24会場とルーティング有効化 | /zh-TW/venues/*、/ko/venues/* | 各件名 |
| 08-11 07:54〜13:29 | c3ef7bd2e→b99b7255e、6ce7c80a7・f39d3023a→7657f2854、192b9f1c2・8bb1af4bb→bca5c6666 | #273・#274・#278（記事は #275〜#281） | ブログの en・zh-TW 版。sitemap の zh-tw 除外漏れの修正（8bb1af4bb） | /en/blog/*、/zh-TW/blog/* | 各件名 |
| 08-16 16:37 | 58c7103e6 | #309 | 未翻訳言語パスのリダイレクトを History API から window.location.replace に変更（Google がリダイレクトとして扱う形に） | 未翻訳の /{lng}/* | 58c7103e6 本文 |
| 08-17 09:15（author 07:47） | 4d04d1f94 → b78fccaa1 | #317 | 韓国語ブログのパイロット2本、languages.js・sitemap 変更 | /ko/blog/* | 同 |
| 08-18 13:42（author 13:40） | 0213b2e5e → 63552bd7d | #327 | 言語判定から navigator を外し、localStorage 未設定は常に ja。commit 本文に「Googlebot が / の英語版（"BoatAI - AI Predictions for Japanese Boat Race (Kyotei) \| Free"）をインデックスしていた」「ボートアイの順位が3週間で2.6→4.5位」とある | 言語接頭辞なしの全ページ | 0213b2e5e 本文・src/i18n.js の diff |

### 1-3. canonical（b）
| master 入り | SHA | PR | 要旨 | 対象 URL | 出典 |
|---|---|---|---|---|---|
| 〜07-13 12:53 | （2025-12-22 5087ac692 から） | — | index.html に静的 `<link rel="canonical" href="https://www.boat-ai.jp/">`。SPA は全パスで index.html を返す（vercel.json の rewrite）ので、ページ側に canonical の無いパスはトップを指していた。ページ側の canonical は Helmet で書かれていたが出力されていない（次行） | 全ページ | 52dc28762:index.html:23、334a8cc16 本文 |
| 07-13 12:53 | b01529470 → 54e01b032 | #116 | index.html の静的 description・canonical を削除。トップだけ言語別 canonical | 全ページ | b01529470 の index.html の diff |
| 07-14 09:17（author 07-13 15:35） | 334a8cc16・7d1bdad7f → f214f4716 | #117 | react-helmet-async（React 19 と非互換で link・meta が DOM に出ていなかった。commit 本文「全ページの canonical・meta description が実質欠落していた」）を React 19 の head ホイスティングに置換。/outcome-distribution に canonical を追加。og/twitter の重複を削除 | Helmet を使っていた20ファイルのページ | 334a8cc16 本文、package.json の履歴（helmet は 2025-12-22 5087ac692 から） |
| 07-13 12:53〜07-14 09:17 | 上2行の組み合わせ | #116・#117 | この間は静的 canonical・description が消え、ページ側も出ていない（トップを除く）。両 commit の本文からの帰結で、本番での観測記録は無い | トップ以外 | 同上 |

### 1-4. JSON-LD・構造化データ（c）
| master 入り | SHA | PR | 要旨 | 対象 URL | 出典 |
|---|---|---|---|---|---|
| 期間中ずっと | （2025-12-20 045372e34 から） | — | index.html の JSON-LD に `AggregateRating`（4.5・100件、根拠なし）と `SearchAction` があった。10/5 に削除（2章） | 全ページ（index.html） | 52dc28762:index.html:48〜75、2dcf7af75 の diff |
| 07-26 11:07 | 083fd7f63 → f9577bb64 | #135 | 会場ガイドに ItemList・BreadcrumbList・TouristAttraction | /venues, /venues/* | 083fd7f63 本文 |
| 07-26 20:38 | 1d2e07d4f → fd0d3849c | #137 | 地域別ハブページ（BreadcrumbList。英語固定だった件は #245 で修正、docs/knowledge/i18n.md:9） | /{lang}/venues/region/* | 件名、docs/knowledge/i18n.md:9 |
| 08-04 10:57 | 1a231ee1e → 8a0bcd32a | #171 | ブログ記事の「よくある質問」から FAQPage を自動生成。llms.txt を日次生成 | /blog/* | 1a231ee1e 本文 |
| 08-04 13:29 | df8e1f828 → 2fe876fd5 | #174 | /winning-technique に ItemList・BreadcrumbList | /winning-technique | df8e1f828 本文 |
| 08-20 06:58〜21:18 | a09fd4c97（#328）、e469040f1（#329）、d8188f335（#336） | #328・#329・#336 | JSON-LD の name を BoatAI → 龍神レーダー。ContentHub の CollectionPage の name・description を新 title に合わせる | 全ページ（index.html）、/about・/how-to-use・/profile・/guide | 各 diff・本文 |
| 08-25 16:35 | fea629dc4 → 7e8b2ddeb | #393 | 選手ページに Person | /racer/* | fea629dc4 本文 |

### 1-5. サイトマップ・robots（d）
| master 入り | SHA | PR | 要旨 | 対象 URL | 出典 |
|---|---|---|---|---|---|
| 07-13 12:53 | b01529470 → 54e01b032 | #116 | sitemap に /en/ を追加 | /en/ | 本文 |
| 07-27 11:39 | 684760268 → c94ca681d | #147 | 会場ガイド全体の検証スクリプト | /venues 系 | 件名 |
| 07-31 10:55 | f63101867 | #160 | /winning-technique を sitemap に追加（それまで未掲載で未インデックス）。sitemap 変更時に Search Console へ再送信する submit-sitemap.js と workflow のステップ | /winning-technique、sitemap 全体 | f63101867 の generate-sitemap.js diff、docs/operation/search-console-report.md:121〜143 |
| 07-31 11:09 | 6e4ad5e3d | #161 | 日別レースページ /races/:date を直近7日に限定。373→139 URL（本文）。日次生成の実数は 369（7/30）→140（8/1） | /races/:date | 6e4ad5e3d 本文、1-8 |
| 08-14 15:40 | 038461205 → a0b785c20 | #286 | /picks を sitemap から外し、/picks はクライアント側のリダイレクト（LegacyModelPageRedirect）に | /picks | 038461205 の diff、a0b785c20:src/AppRouter.jsx:166 |
| 08-20 11:11 | 86b348fde | #331 | robots.txt の BoatAI 表記を変更（ルールの変更は件名・本文からは読めない。中身未確認） | robots.txt | 86b348fde 本文 |
| 08-21 14:15 | 400c10468 → 6362da1b6 | #339 | sitemap の機械検証を追加 | — | 件名 |
| 08-25 16:35 | f8d5ad5a2 → 7e8b2ddeb | #393 | 選手ページを sitemap に登録（racer_news のある選手） | /racer/* | f8d5ad5a2 の diff |
| 08-29 21:02 | 6c5683315 | #415 | /venue/1〜24 と /races/:date/:code を sitemap に追加。/races/:date の中身を会場グリッドに差し替え、レース詳細を /race/:raceId に新設（ADR 0026） | /, /races/:date, /venue/*, /race/* | 6c5683315 の diff、docs/adr/0026-venue-list-redesign-url-structure.md:19〜28 |
| 07-10〜08-31 の多言語追加 | 1-2 の各行 | — | 言語版の追加ごとに sitemap に追加 | 言語版 | generate-sitemap.js の履歴 |

### 1-6. title・meta description・OGP・noindex（e）
| master 入り | SHA | PR | 要旨 | 対象 URL | 出典 |
|---|---|---|---|---|---|
| 07-14 09:17 | 334a8cc16 → f214f4716 | #117 | 1-3 のとおり。ページ別 description が出始める。同時に、ブログ記事・レース詳細の `<title>` が空になる不具合が入った（`<title>{式} 文字列</title>` の形を Helmet なしで出したため。334a8cc16 の diff では title 行は変えずラッパーだけ外している） | /blog/*, /races/:date | 334a8cc16 の BlogPost.jsx・RaceDetail.jsx の diff、0ca92d167 本文 |
| 07-28 14:33 | 0ca92d167 | #152 | 上の空 title を修正（本文「本番ビルドで実際に空タイトルになっていることを確認」「ブログ記事全件・レース詳細ページ全件」）。suji-funaken-guide・rough-race-signals の title・description 変更 | /blog/*, /races/:date | 0ca92d167 本文 |
| 07-31 10:55 | f63101867 | #160 | /winning-technique の h1・meta description 変更 | /winning-technique | 本文 |
| 08-03 21:08 | 79ac12a71 → faba89c50 | #169 | ブログ記事の OGP・Twitter カード・keywords を記事ごとに書き換え（DOM 直書き。JS を実行しないクローラーには届かない） | /blog/* | 本文 |
| 08-04 09:24 | 04883c1c0 → 16ace383b | #170 | About・HowToUse・Blog 一覧・Profile の keywords 重複・OGP 未反映を修正（useSocialMeta） | 4ページ | 本文 |
| 08-04 14:03 | → 628f1ae22 | #175 | 低 CTR 記事3本の title・description | /blog/* 3本 | 取り込み commit 件名、src/data/blogPosts.js |
| 08-15 13:04 | → e0cdec37f | #292 | ホームの meta description にブランド・ドメイン表記を追加 | / | 同、src/locales/ja/common.json |
| 08-16 11:33 | f3f965883 | #306 | ホームの title・OGP を「BoatAI - …」→「BoatAI（ボートアイ）- AIボートレース予想 \| 完全無料・実績公開中」 | / | f3f965883 の diff |
| 08-20 06:58 | a09fd4c97 | #328 | 改名（1-7）。title「龍神レーダー - 無料のボートレースAI予想＆データ分析」、og:site_name・author・keywords も変更 | 全ページ | a09fd4c97 の index.html の diff |
| 08-20 21:18 | d8188f335 | #336 | Profile・suji-funaken-guide・/guide・/en/guide の title・description | 4ページ | 本文 |
| 08-22 14:21 | → aba606bd1 | #344 | og:image を新ブランドの画像に差し替え | 全ページ | 取り込み commit 件名 |
| 08-22 14:48 | → 81e1f2bab | #345 | CTR ギャップ分析に基づく title・description 改善 | /blog/* | 同、src/data/blogPosts.js |
| 08-22 16:56 | → 40746917a | #348 | exhibition-run-guide の title | /blog/exhibition-run-guide | 同 |
| 08-25 16:35 | 084e91fc6 → 7e8b2ddeb | #393 | 選手ページ新設。ニュースが無い選手は noindex（useRobotsMeta で静的 robots を直書き） | /racer/* | 084e91fc6 本文 |
| 08-26 09:50 | → cebadf1a1 | #395 | motor-condition-guide の title・description | /blog/motor-condition-guide | 同 |
| 08-26 16:24 | → 4f008394a | #406 | トップ description に「実測回収率」、odds-expected-value-guide の title・description に「オッズとは」。本文に「日本語クエリに英語版ページだけが表示され日本語版が30日間表示されていなかった」 | /, /blog/odds-expected-value-guide | 4f008394a^2 本文 |

### 1-7. ブランド名の変更（f）
| master 入り | SHA | PR | 要旨 | 出典 |
|---|---|---|---|---|
| 2025-12-12 | 37b4aa9cd | — | 「BoatAI」に改名（参考、期間外） | index.html の履歴 |
| 08-16 11:33 | f3f965883 | #306 | title に「（ボートアイ）」を追加（4日後に消える） | 1-6 |
| 08-20 06:58 | a09fd4c97 | #328 | Phase 1: コア表示・共通メタ（title・OGP・JSON-LD・4言語の common.json）。en: Ryujin Radar、zh-TW: 龍神雷達、ko: 용신 레이더。ドメイン boat-ai.jp は維持 | 本文 |
| 08-20 10:23〜14:16 | 9b904ac5b・e469040f1・86b348fde・cfbd4eb63・a495e8442・502e53488 | #330・#329・#331・#332・#333・#334 | Phase 2〜5: 個別ページの構造化データ・本文、残りページ・llms.txt・robots.txt、ブログ本文165ファイル、note、docs | 各件名・diff stat |
| 08-21 08:28 | 794c82b8a・085ce0dd9・92465e94f → 864cae1e6 | #337 | ブランドの見た目（theme-color 等） | 件名 |
| 08-22 14:21 | → aba606bd1 | #344 | og:image 差し替え | 件名 |

改名の日は 2026-08-20（#328 の master 入り 06:58 JST）。

### 1-8. middleware・ボット向けスナップショット・vercel.json（g）
| master 入り | SHA | PR | 要旨 | 出典 |
|---|---|---|---|---|
| 05-01〜08-31 | なし | — | vercel.json は 2026-04-01（f90f6e5c8）から 2026-09-20（e287bae64）まで変更なし。rewrites は `/((?!api/).*) → /index.html` だけ | `git log -- vercel.json` |
| 08-28 11:30 | 232a8a109 | #410 | middleware.js を新設。SNS ハブ（/admin/sns-hub）の Basic 認証だけ | 件名、middleware.js の履歴 |
| 08-29 20:22 | 178efca16 | #417 | 同 401 に no-store | 件名 |
| 09-12 08:56（期間外・参考） | 078efd700 → 744914ce0 | #468 | AI クローラー・SNS ボット向け静的スナップショット配信を追加（ADR 0032）。Googlebot には出さない。安定は 9/15 の #653 | 744914ce0、942dff284、src/config/aiCrawlerBots.js:4 |

ボット向けスナップショットは 5〜8月には存在しない。Googlebot は一度も対象になっていない（src/config/aiCrawlerBots.js:4、ADR 0089 決定1）。

### 1-9. sitemap の URL 数の推移（日次自動生成、first-parent）
| 日付（生成 commit） | 全 URL | 言語版 | /race(s)/ | 出典 |
|---|---|---|---|---|
| 04-30（08a696e5a） | 234 | 0 | 149 | `git show <sha>:public/sitemap.xml` の `<loc>` 数 |
| 05-31（2f92adbb4） | 267 | 0 | 181 | 同 |
| 06-30（917dac798） | 297 | 0 | 211 | 同 |
| 07-11（88cd2af5f） | 307 | 0 | 221 | 同 |
| 07-14（7f7be3e23） | 312 | 2 | 224 | 同 |
| 07-29（cec6a9e78） | 369 | 43 | 240 | 同 |
| 07-31（3edf195f6） | 140 | 43 | 8 | 同（#161） |
| 08-08（5c4292d95） | 152 | 43 | 8 | 同 |
| 08-11（829a7c542） | 263 | 154 | 8 | 同 |
| 08-19（8f6ede174） | 288 | 180 | 6 | 同 |
| 08-25（fa7caec8a） | 290 | 180 | 7 | 同 |
| 08-31（aa99f76e7） | 475 | 252 | 91 | 同（#415） |

日付は commit の UTC 日付。言語版は `/(en|ko|zh-TW)/` で始まる loc、/race(s)/ は `/races/` と `/race/` で始まる loc。

## 2. 2026-09-20 以降の施策（master 入りは JST、すべて squash で commit 日時＝master 入り）
| master 入り | SHA | PR | 区分 | 要旨 | 対象ページ | 出典 |
|---|---|---|---|---|---|---|
| 09-24 16:45 | c00cb49d2 → 90b2e9696 | #815 | d・e | /today を新設、sitemap に追加 | /today | 件名、generate-sitemap.js の履歴 |
| 09-25 15:53 | a80726fba → 0ca81246a | #832 | g | /today をボット向けスナップショットに追加 | /today（AI・SNS ボット） | 件名 |
| 09-29 11:40 | a638e2b3b | #931 | e | 分析ツールの title・description に「競艇 データ分析」 | /winning-technique | 件名 |
| 09-30 06:52 | f55ded6dc | #976 | e | トップに AI 予想の説明。ja の meta description に「競艇」 | / | 件名、seo-measures.json |
| 09-30 21:50 | 4ae6aee18 | #1009 | — | /outcome-distribution を 308 で /winning-technique?tab=outcome へ | /outcome-distribution | seo-measures.json |
| 09-30 21:51 | 484dce100 | #1011 | d | sitemap の lastmod を実際の更新日に。反映は 10/1 04:30 の自動生成 | sitemap | seo-measures.json |
| 09-30 22:42 | 194ba8132 | #1012 | a・d | sitemap に hreflang（xhtml:link）。反映 10/1 04:30 | sitemap | seo-measures.json |
| 10-01 09:24 | b90b533c2 | #991 | e | 会場ページの title・description「{会場}競艇のAI予想…」、SG・G1 は節タイトル | /venue/* | seo-measures.json |
| 10-01 09:25 | 3c0894ba9 | #1013 | e | /today の title・description・h1 | /today | seo-measures.json |
| 10-01 14:23 | 28cc499cd | #1032 | e | トップの meta description から「実測的中率とあわせて公開」を削除 | / | seo-measures.json |
| 10-02 12:14 | f9037178a | #1109 | e | レース詳細の title・description に開催日 | /race/* | seo-measures.json |
| 10-02 12:14 | a2e3201bf | #1112 | c | BreadcrumbList を5種のページに | 会場・レース詳細・過去の予想・過去日付の会場一覧・/today | seo-measures.json |
| 10-02 13:34 | de4d2780a | #1120 | d・e | 現役 A1（322人）の選手ページを index、title 変更、sitemap に掲載 | /racer/* | seo-measures.json |
| 10-02 15:16 | fc115414e | #1125 | c | /races のパンくずの item が undefined になる不具合を修正 | /races | 件名 |
| 10-02 18:23 | c110ea000 | #1146 | e | index.html の静的 og:url（トップ固定）を削除 | 全ページ | c110ea000 の diff |
| 10-02 20:08 | 8546065fe | #1147 | e・c | og・twitter description と JSON-LD から「45項目」を削除 | 全ページ（index.html） | 8546065fe の diff |
| 10-05 12:20 | 2dcf7af75 | #1264 | c・g | JSON-LD の AggregateRating（4.5・100件）と SearchAction を削除、Organization を追加。bingbot・Applebot・DuckDuckBot 等にもスナップショットを返す | 全ページ（index.html）、ボット | 2dcf7af75 の diff |
| 10-05 12:58 | c77d487ba | #1265 | e・c | keywords・og・twitter description・JSON-LD description を「データを数えて見える化」の説明に | 全ページ（index.html） | c77d487ba の diff |
| 10-07 05:56 | 9f13a6400 | #1151 | d | SG・G1・G2 の節ページを追加、sitemap に | 節ページ | 件名 |
| 10-12 03:36 | 23d7a09d9 | #1395 | b・e | 4言語のページの canonical を表示中の言語の URL に（それまでレース詳細・会場一覧等の言語版は ja の URL を指していた）。思考アシスト・選手一覧に description・canonical | 言語版のレース詳細・会場・節、/race/*/assist、/racers | 23d7a09d9 の diff |
| 10-12 08:32 | 33b10c4f1 | #1409 | g | ボット向け HTML（関数）を middleware から配線。ja の / と /venue/1〜24 | /, /venue/1〜24（ボットのみ） | ADR 0089 |
| 10-12 11:16 | d8cf32fb4 | #1422 | a・c・g | ボット向け HTML に hreflang・JSON-LD | ボット向け HTML | 件名 |
| 10-12 11:23 | a5ec22a70 | #1421 | g | 選手ページのスナップショット | /racer/*（ボット） | 件名 |
| 10-12 16:43 | 33b39deca | #1447 | c | トップに FAQ 5問と FAQPage | / | 件名 |
| 10-12 20:45 | 4a64f4916 | #1425 | g | 言語版の / と /venue/1〜24 をボット向け HTML へ | /{lang}/, /{lang}/venue/*（ボット） | 件名 |
| 10-13 04:03 | 37df47635 | #1431 | g | 翻訳記事とブログ一覧をスナップショットへ | /{lang}/blog/*, /blog（ボット） | 件名 |
| 10-13 04:35 | 060307704 | #1433 | g | /today をボット向け関数へ | /today（ボット） | 件名 |
| 10-13 05:16 | c73ec300c | #1437 | g | 本日のレース詳細をボット向け関数へ | /race/*（本日、ボット） | 件名 |
| 10-13 09:31 | 0e42a4be5 | #1456 | g | ボット向けトップに説明・FAQ・ブログ欄 | /（ボット） | 件名 |
| 10-19 15:17 | aeb745fa2 | #1673 | e | ブログ記事の metaTitle・metaDescription に「競艇」（h1・一覧は「ボートレース」のまま）。適用は ai-index-reading-guide の1本だけ（10/19 14:25 の #1667 で掲載した記事） | /blog/ai-index-reading-guide | aeb745fa2 の diff stat、src/data/blog-posts/ai-index-reading-guide.json |

- 10/19〜20 に title・meta・canonical・JSON-LD・sitemap・ボット HTML を変えた commit は #1673 だけ（`git log origin/master --since=2026-10-14` の件名検索）
- ボット向け HTML（#1425・#1431・#1433・#1437）は件名に「draft・公開は 10/19 以降」、ADR 0089:149・243 に「10/19 の判断までマージしない」とあるが、git では 10/12〜13 に master 入りしている。食い違い
- ボット向け HTML はどれも Googlebot には返さない（src/config/aiCrawlerBots.js:4）

## 3. 既存の記録との突き合わせ

### 3-1. 再利用できる既存の記録
| パス | 中身 |
|---|---|
| data/analysis/search-console/seo-measures.json | 施策の投入日台帳。17件、最終 10/2（#1123） |
| docs/operation/search-console-report.md | レポートの使い方、読み方の注意（:80〜86）、GA4 の切れ目（:98〜100）、目標と方針（:102〜119）、sitemap 再送信（:121〜143） |
| docs/knowledge/seo.md | SPA の制約、ボット向け HTML、インデックスと順位の知見（:25〜27 が 4〜8月の減少の記録） |
| docs/knowledge/i18n.md | ルーティング・リダイレクトの落とし穴 |
| docs/reference/seo-architecture-constraints.md | SPA・JS 実行後の meta の制約 |
| docs/adr/0032-ai-crawler-snapshot-delivery.md・0089-bot-html-for-daily-pages.md | ボット向け HTML の決定 |
| docs/adr/0026-venue-list-redesign-url-structure.md | 8/29 の URL 構造 |
| data/analysis/search-console/report-*.json（7/27〜） | Search Console の定点 |
| data/analysis/serp-snapshots/snapshot-2026-08-20〜09-05.json | 検索結果の定点 |
| data/analysis/i18n-demand/report-2026-07-14〜09-05.json | 言語別 PV |
| data/analysis/growth-monthly-summary/summary-2026-08.json | 8月の月次まとめ（7/27 と 8/26 のレポート形式が違い月次比較不可と記載） |
| data/analysis/growth-pdca-major-initiatives.json | 被リンク施策の提示履歴 |

### 3-2. 食い違い・漏れ
| 項目 | 既存の記録 | 台帳（git） | 出典 |
|---|---|---|---|
| 言語自動判定の開始日 | seo-measures.json `i18n-navigator-detection` は 7/7（ref b3cda6a52）。search-console-report.md:82 も「7/7〜8/18」。docs/knowledge/seo.md:26 も「7/7 の言語自動判定」 | b3cda6a52 の master 入りは 7/10 10:43（#110）。トップの英語 title（en の meta.title）が入ったのは 7/13 12:53（#116） | 1-2 |
| 7/14 の canonical・description の出力開始（#117） | 記録なし | 334a8cc16 本文で「全ページの canonical・meta description が実質欠落」。2025-12-22〜7/14 の状態 | 1-3 |
| 7/14〜7/28 のブログ記事・レース詳細の空 title | 記録なし | #117 で入り #152 で修正 | 1-6 |
| index.html の静的 canonical 削除（7/13） | seo-measures.json `en-routing-hreflang` の説明に記載あり | 一致 | — |
| /races/:date の sitemap 7日限定（7/31、369→140 URL） | 記録なし | #161 | 1-5 |
| 未翻訳パスのリダイレクト（8/9 #191、8/16 #309） | knowledge/seo.md:9・i18n.md に知見としてあり、台帳には無し | 1-2 | — |
| 「BoatAI（ボートアイ）」が title から消えた | knowledge/seo.md:27・seo-measures.json `rebrand-ryujin-radar` は 8/20 の改名で消えたと記載 | 「（ボートアイ）」が title に入っていたのは 8/16 11:33〜8/20 06:58 の約4日だけ。それ以前は「BoatAI - AIボートレース予想 \| …」 | f3f965883・a09fd4c97 の diff |
| AggregateRating（根拠なし）の削除（10/5 #1264） | 台帳に無し | 2章 | — |
| 10/2 以降の施策（#1146・#1147・#1151・#1264・#1265・#1395・#1409〜#1456・#1447・#1673） | seo-measures.json に無し（最終行は 10/2 #1120） | 2章 | — |
| 8/29 のレース詳細の URL 変更（/races/:date → /race/:raceId、#415） | 台帳に無し。ADR 0026 にある | 1-5 | — |
| 言語判定の不具合の issue | docs/issues・docs/archive/issues に該当ファイル無し。記録は commit 0213b2e5e の本文・seo-measures.json・search-console-report.md・knowledge/seo.md | — | `grep -rl navigator docs` |
| ボット向け HTML の公開日 | ADR 0089:149・243「10/19 の判断までマージしない」 | 10/12〜13 に master 入り | 2章 |
| 思考アシストの公開日 | src/config/featureFlags.js:6「2026-10-10 に公開」 | #1379 の master 入りは 10/11 05:10。docs/design/thinking-assist/events.md:3 も 10/11 | 34ac2ebb8 |

## 4. 本番への反映日の限界
- Vercel は master への push ごとに本番をビルドするが、ビルドが失敗すると前の版のまま残る。記録のある失敗は 9/4 の 622a96595（「本番デプロイが3回連続失敗していたのを修正」）と、9/12 の 8c6adf69d（スナップショット生成の失敗でビルドが落ちる件）。5〜8月の Vercel のデプロイ履歴はこの台帳では見ていない（不明・Vercel の deployments を引いていない）
- sitemap は日次の自動生成（.github/workflows/update-sitemap.yml）で反映されるので、generate-sitemap.js の master 入りから最大1日遅れる（docs/operation/search-console-report.md:96）
- 検索側の反映（再クロール・再インデックス）は数日〜2週間遅れる（docs/knowledge/seo.md:30）
