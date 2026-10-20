# 自然検索の減少の補足データ（2026-10-20 取得）

Codex の調査 `/Users/Shared/codex-lanes/ryujin-marketing/out/reports/2026-10-20-organic-decline.md` §6「龍神の開発側に頼むこと」1〜5 を埋めるデータ。取得日はすべて 2026-10-20（JST）。鍵・トークン・サービスアカウントの中身は含まない。

## 共通の条件

- GSC: プロパティ `SEARCH_CONSOLE_SITE_URL`（https://www.boat-ai.jp/）、`searchType=web`、国・端末のフィルタなし（全世界・全端末）、`dataState=final`（`gsc-daily-16m-all` だけ `all`）。日付は太平洋時間（PT）。行の上限: 1回 25,000 行でページングし、全ファイル1ページで終わった（打ち切りなし。各 `{dims}.json` の `meta.possiblyTruncated=false`）
- GSC の合計の違い: `date`・`device`・`country` はサイト合計（byProperty）。`query` を含む集計は匿名化クエリを除くので小さい。`page` を含む集計は byPage で、表示回数がサイト合計と一致しない
- GSC プロパティのデータは **2025-12-21 から**（`gsc-daily-16m-final/date.json#meta.firstDate`）。前年の同条件は存在しない
- GA4: プロパティ `GA4_PROPERTY_ID`、Data API v1beta。週は ISO 週（月曜始まり、`202641` = 10/5〜10/11）。計測の切れ目 2026-09-29（page_view 一本化）と 2026-10-01（内部トラフィック除外）をまたぐ（各 JSON の `notes.measurementBreaks`）
- 取得スクリプト（この PR で追加）: `scripts/analysis/gsc-full-export.js`、`scripts/analysis/url-index-render-check.js`、`scripts/analysis/ga4-organic-weekly-export.js`

## ファイル

| パス | 中身 | 期間・条件 |
|---|---|---|
| `gsc-latest-0919-1017/` | 最新の全明細。`date`（29行）・`query`（718行）・`page`（581行）・`query+page`（876行）・`device`・`country`・`searchAppearance`（0行）・`meta.json` | 2026-09-19〜10-17（Codex の PERIOD と同じ29暦日）、final |
| `gsc-baseline-0501-0529/` | 減少前の比較用、同じ次元（`searchAppearance` なし） | 2026-05-01〜05-29（29暦日）、final |
| `gsc-daily-breakdown-0401-1017/` | 日次の内訳: `page+date`（6,542行）・`query+date`（20,460行）・`device+date`・`country+date` | 2026-04-01〜10-17、final |
| `gsc-daily-16m-final/date.json` | サイト合計の日次（301行、欠落日なし） | 2025-12-21〜2026-10-17、final |
| `gsc-daily-16m-all/date.json` | 同、未確定日を含む（303行） | 〜2026-10-19、all |
| `gsc-summary.json` | 上の2期間のページ分類別合計・トップ比率・匿名化比率・順位帯別のクエリ数（分類ルールは `rule`） | 派生 |
| `url-index-render.json` | 20 URL の URL Inspection 結果（全文）、UA 別の配信 HTML（browser・googlebot・gptbot）の title・canonical・robots・h1 数、Playwright で描画した後の title・canonical・robots・h1・JSON-LD の型・本文の先頭300字 | 2026-10-20 11:4x JST |
| `ga4-organic-0928-1019.json` | 週別×チャネル、全チャネル週別、Organic の週別×着地ページ・週別×端末、日別×チャネル、`daysByWeek` | 2026-09-28〜10-19 |
| `ga4-organic-0427-1019.json` | 同じ構成で長い期間（比較用） | 2026-04-27〜10-19 |
| `measures-ledger.md` | 5〜8月の言語・canonical・JSON-LD・サイトマップ・title・改名・ボット HTML の変更台帳、9/20 以降と 10/19 の施策、既存記録との食い違い | git log（master 反映日）・docs・ADR |
| `ga4-event-definitions.md` | レース→ソナー／アシストの GA4 イベントの定義・送信箇所・計測開始日・カスタムディメンション登録の記録、計測の切れ目 | コードと docs |
| `db-race-series-2025-12_2026-12.csv` | 節の一覧（会場・開始・終了・級・名前）855件 | 2025-12〜2026-12 に掛かる節、`race_series` |
| `db-monthly-venue-days.csv` | 月別の開催（会場×日）数・開催のある日数・SG/G1 の会場×日数 | 2025-12〜2026-10（10月は 10/20 まで）、`races` の中止（`cancellation_status='confirmed'`）を除く |

## 項目ごとの取れた・取れない

### 1. GSC の全明細（取れた）
- allQueries 718行・全 page 581行・query×page 876行・日次 29行（`gsc-latest-0919-1017/*.json#meta`）。打ち切りなし
- 実際の最終収録日: final は **2026-10-17**、未確定を含めると 2026-10-19（10/19 は 57 クリックで途中）。2025-12-21 以降に欠落日なし
- `searchAppearance` は 0 行（リッチリザルト等の表示が無い）
- 前年の同条件: 取れない（プロパティのデータが 2025-12-21 から）

### 2. 主な URL の登録と描画（取れた）
- 20 URL すべて `verdict=PASS`・「送信して登録されました」・`robotsTxtState=ALLOWED`・`crawledAs=MOBILE`、Google が選んだ canonical は全件その URL 自身（`url-index-render.json#results[].inspection.indexStatusResult`）
- 最終クロールが古いもの: `/venue/6` 2026-08-31、`/racer/4320` 2026-09-01、`/today` 2026-09-24。`/venue/1` は `userCanonical` が空（最終クロール 10/15）
- 配信 HTML（JS 実行前）: browser と Googlebot は全 URL 同じ HTML で、title はトップの「龍神レーダー - 無料のボートレースAI予想＆データ分析」・canonical なし。GPTBot にはブログ・選手・/venue/N・/today・/blog・/en/ で個別の title と canonical が出る。`/venue/*/meet/*`・`/about`・`/races` は GPTBot にもトップの HTML
- 描画後: 全 URL で個別の title・canonical 1本・`index, follow`。`/venue/6` は描画後の本文が 535 字と短い（他の /venue/1 は 3,353 字）
- 描画後の本文は Google の描画結果ではなく Playwright（通常のブラウザ UA）で描画したもの。URL Inspection API は描画後の HTML を返さない

### 3. 施策の台帳（取れた。詳細は `measures-ledger.md`）
- 5〜6月は検索に見える変更がほぼ無い（3件）。手作業の変更は 7/10 から
- 2025-12-22〜2026-07-14 はページごとの canonical・description が出ず、index.html の静的 canonical（トップを指す）が全ページに付いていた。7/14〜7/28 はブログ記事とレース詳細の title が空
- 言語の自動判定の master 反映は 7/10（台帳・docs の 7/7 は commit 作成日）。トップの英語 title は 7/13〜8/18
- 7/31 にサイトマップを 369→140 URL に縮小。index.html の JSON-LD に AggregateRating（4.5・100件）が 10/5 まで
- 10/19 のメタ施策は #1673 の1件（ai-index-reading-guide の1記事）
- 取れなかった: Vercel の 5〜8月のデプロイ日（master マージ日で代用）、言語判定不具合の issue 文書（commit 本文にのみ記録）

### 4. GA4（数字は取れた。設定は取れなかった）
- Organic Search の完全週（`ga4-organic-0928-1019.json#weeklyByChannel`）:

| ISO 週 | 日数 | sessions | engaged | newUsers | activeUsers | PV | engagementRate |
|---|---|---|---|---|---|---|---|
| 202640（9/28〜10/4） | 7 | 571 | 514 | 87 | 128 | 6,232 | 0.900 |
| 202641（10/5〜10/11） | 7 | 663 | 568 | 93 | 127 | 6,912 | 0.857 |
| 202642（10/12〜10/18） | 7 | 1,012 | 861 | 173 | 230 | 10,147 | 0.851 |
| 202643（10/19） | 1 | 15 | 12 | 2 | 7 | 98 | 0.800 |

- 全チャネルの週別（`#weeklyTotal`）: PV 7,714 → 9,180 → 13,584、sessions 804 → 998 → 1,395
- 着地ページ（`#organicWeeklyLanding`）: `/` の比率 62.3% → 61.2% → 60.7%、着地ページ数 155 → 170 → 232
- 202640 は 10/1 の内部トラフィック除外をまたぐ。10/19 は GA4 の処理遅れで途中の可能性がある
- イベント定義と登録日: `ga4-event-definitions.md`
- 取れなかった: タイムゾーン・データストリーム・カスタムディメンション・キーイベント・データ保持。理由は Google Cloud プロジェクトで Analytics Admin API が無効（`#settings.*.error`）。有効化はプロジェクト設定の変更なので行っていない。内部トラフィック除外の条件はそもそも Admin API で読めない
- AdSense 側 PV の照合: 取得の仕組みが repo に無く、取っていない

### 5. 開催・前年（一部取れた）
- 月別の開催（`db-monthly-venue-days.csv`）。SG は 2025-12 グランプリ（住之江）、3/24〜29 クラシック（蒲郡）、5/26〜31 オールスター（浜名湖）、6/23〜28 グランドチャンピオン（鳴門）、7/28〜8/2 オーシャンカップ（びわこ）、8/25〜30 メモリアル（桐生）、10/27〜11/1 ダービー（尼崎）、11/24〜29（常滑、名前は未登録）
- G1 の会場×日数は 9月 33、10月（20日まで）18、7月 0
- 前年の同条件 GSC: 取れない（上記）。SERP 履歴・市場需要資料: repo に無い

## 主な数字（GSC、`gsc-summary.json`）

| | 2026-05-01〜05-29 | 2026-09-19〜10-17 |
|---|---|---|
| サイト合計クリック／表示 | 2,817 ／ 46,101 | 2,591 ／ 51,094 |
| 名前の出るクエリ数／そのクリック | 353 ／ 2,360 | 718 ／ 1,590 |
| 匿名化クエリのクリック比率 | 16.2% | 38.6% |
| 表示のあったページ数 | 46 | 581 |
| トップ `/` のクリック（page 行合計に対する比率） | 2,674（94.9%） | 2,345（88.4%） |
| ブログ記事のクリック／表示 | 139 ／ 4,953 | 145 ／ 5,652 |
| `/venue/N` のクリック／表示 | 0 ／ 0 | 11 ／ 291 |
| `/venue/*/meet/*` のクリック／表示 | 0 ／ 0 | 1 ／ 762 |
| `/racer/*` のクリック／表示 | 0 ／ 0 | 0 ／ 225 |

- 最新期間の会場名を含むクエリは 143 語・157 クリック・3,235 表示。最大は「桐生競艇予想 ai」67 クリック・851 表示・順位 5.6、「平和島 競艇 得点率ランキング」等の得点率系は表示 90〜176・クリック 0〜1（`gsc-latest-0919-1017/query.json`）
- 最新の完全週のサイト合計（`gsc-daily-16m-all/date.json` を月曜始まりで合算、10/18 は未確定を含む）: 9/28 週 571 → 10/5 週 553 → 10/12 週 955 クリック
