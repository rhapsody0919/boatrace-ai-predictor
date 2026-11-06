# 自然検索の減少の補足データ（2026-10-20 取得）

Codex の調査 `/Users/Shared/codex-lanes/ryujin-marketing/out/reports/2026-10-20-organic-decline.md` §6「龍神の開発側に頼むこと」1〜5 を埋めるデータ。取得日はすべて 2026-10-20（JST）。鍵・トークン・サービスアカウントの中身は含まない。

GSC・GA4 の生データ（`gsc-*/`・`gsc-summary.json`・`ga4-organic-*.json`）と、その実数（クリック・表示・PV・セッション・ユーザー）は、2026-11-06 のオーナー決定で公開のリポジトリから外し、hq の非公開の記録へ移した。この README には取り方と、数に依らない結論だけを残す。

## 共通の条件

- GSC: プロパティ `SEARCH_CONSOLE_SITE_URL`（https://www.boat-ai.jp/）、`searchType=web`、国・端末のフィルタなし（全世界・全端末）、`dataState=final`（`gsc-daily-16m-all` だけ `all`）。日付は太平洋時間（PT）。行の上限: 1回 25,000 行でページングし、全ファイル1ページで終わった
- GSC の合計の違い: `date`・`device`・`country` はサイト合計（byProperty）。`query` を含む集計は匿名化クエリを除くので小さい。`page` を含む集計は byPage で、表示回数がサイト合計と一致しない
- GSC プロパティのデータは **2025-12-21 から**。前年の同条件は存在しない
- GA4: プロパティ `GA4_PROPERTY_ID`、Data API v1beta。週は ISO 週（月曜始まり、`202641` = 10/5〜10/11）。計測の切れ目 2026-09-29（page_view 一本化）と 2026-10-01（内部トラフィック除外）をまたぐ（各 JSON の `notes.measurementBreaks`）
- 取得スクリプト（この PR で追加）: `scripts/analysis/gsc-full-export.js`、`scripts/analysis/url-index-render-check.js`、`scripts/analysis/ga4-organic-weekly-export.js`

## ファイル

| パス | 中身 | 期間・条件 |
|---|---|---|
| `gsc-latest-0919-1017/` | hq へ移した（公開のリポジトリに置かない） | — |
| `gsc-baseline-0501-0529/` | hq へ移した（公開のリポジトリに置かない） | — |
| `gsc-daily-breakdown-0401-1017/` | hq へ移した（公開のリポジトリに置かない） | — |
| `gsc-daily-16m-final/date.json` | hq へ移した（公開のリポジトリに置かない） | — |
| `gsc-daily-16m-all/date.json` | hq へ移した（公開のリポジトリに置かない） | — |
| `gsc-summary.json` | hq へ移した（公開のリポジトリに置かない） | — |
| `url-index-render.json` | 20 URL の URL Inspection 結果（全文）、UA 別の配信 HTML（browser・googlebot・gptbot）の title・canonical・robots・h1 数、Playwright で描画した後の title・canonical・robots・h1・JSON-LD の型・本文の先頭300字 | 2026-10-20 11:4x JST |
| `ga4-organic-0928-1019.json` | hq へ移した（公開のリポジトリに置かない） | — |
| `ga4-organic-0427-1019.json` | hq へ移した（公開のリポジトリに置かない） | — |
| `measures-ledger.md` | 5〜8月の言語・canonical・JSON-LD・サイトマップ・title・改名・ボット HTML の変更台帳、9/20 以降と 10/19 の施策、既存記録との食い違い | git log（master 反映日）・docs・ADR |
| `ga4-event-definitions.md` | レース→ソナー／アシストの GA4 イベントの定義・送信箇所・計測開始日・カスタムディメンション登録の記録、計測の切れ目 | コードと docs |
| `db-race-series-2025-12_2026-12.csv` | 節の一覧（会場・開始・終了・級・名前）855件 | 2025-12〜2026-12 に掛かる節、`race_series` |
| `db-monthly-venue-days.csv` | 月別の開催（会場×日）数・開催のある日数・SG/G1 の会場×日数 | 2025-12〜2026-10（10月は 10/20 まで）、`races` の中止（`cancellation_status='confirmed'`）を除く |

## 項目ごとの取れた・取れない

### 1. GSC の全明細（取れた）
- 打ち切りなし。2025-12-21 以降に欠落日なし。実数は hq
- `searchAppearance` は 0 行（リッチリザルト等の表示が無い）
- 前年の同条件: 取れない（プロパティのデータが 2025-12-21 から）

### 2. 主な URL の登録と描画（取れた）
- 20 URL すべて `verdict=PASS`・「送信して登録されました」・`robotsTxtState=ALLOWED`・`crawledAs=MOBILE`、Google が選んだ canonical は全件その URL 自身（`url-index-render.json#results[].inspection.indexStatusResult`）
- 最終クロールが古いもの: `/venue/6` 2026-08-31、`/racer/4320` 2026-09-01、`/today` 2026-09-24。`/venue/1` は `userCanonical` が空（最終クロール 10/15）
- 配信 HTML（JS 実行前）: browser と Googlebot は全 URL 同じ HTML で、title はトップの「龍神レーダー - 無料のボートレースAI予想＆データ分析」・canonical なし。GPTBot にはブログ・選手・/venue/N・/today・/blog・/en/ で個別の title と canonical が出る。`/venue/*/meet/*`・`/about`・`/races` は GPTBot にもトップの HTML
- 描画後: 全 URL で個別の title・canonical 1本・`index, follow`。`/venue/6` は描画後の本文が他の会場より短い
- 描画後の本文は Google の描画結果ではなく Playwright（通常のブラウザ UA）で描画したもの。URL Inspection API は描画後の HTML を返さない

### 3. 施策の台帳（取れた。詳細は `measures-ledger.md`）
- 5〜6月は検索に見える変更がほぼ無い（3件）。手作業の変更は 7/10 から
- 2025-12-22〜2026-07-14 はページごとの canonical・description が出ず、index.html の静的 canonical（トップを指す）が全ページに付いていた。7/14〜7/28 はブログ記事とレース詳細の title が空
- 言語の自動判定の master 反映は 7/10（台帳・docs の 7/7 は commit 作成日）。トップの英語 title は 7/13〜8/18
- 7/31 にサイトマップを 369→140 URL に縮小。index.html の JSON-LD に AggregateRating（4.5・100件）が 10/5 まで
- 10/19 のメタ施策は #1673 の1件（ai-index-reading-guide の1記事）
- 取れなかった: Vercel の 5〜8月のデプロイ日（master マージ日で代用）、言語判定不具合の issue 文書（commit 本文にのみ記録）

### 4. GA4（数字は取れた。設定は取れなかった）
- Organic Search の週別・全チャネルの週別・着地ページの実数は hq へ移した
- 202640 は 10/1 の内部トラフィック除外をまたぐ。10/19 は GA4 の処理遅れで途中の可能性がある
- イベント定義と登録日: `ga4-event-definitions.md`
- 取れなかった: タイムゾーン・データストリーム・カスタムディメンション・キーイベント・データ保持。理由は Google Cloud プロジェクトで Analytics Admin API が無効（`#settings.*.error`）。有効化はプロジェクト設定の変更なので行っていない。内部トラフィック除外の条件はそもそも Admin API で読めない
- AdSense 側 PV の照合: 取得の仕組みが repo に無く、取っていない

### 5. 開催・前年（一部取れた）
- 月別の開催（`db-monthly-venue-days.csv`）。SG は 2025-12 グランプリ（住之江）、3/24〜29 クラシック（蒲郡）、5/26〜31 オールスター（浜名湖）、6/23〜28 グランドチャンピオン（鳴門）、7/28〜8/2 オーシャンカップ（びわこ）、8/25〜30 メモリアル（桐生）、10/27〜11/1 ダービー（尼崎）、11/24〜29（常滑、名前は未登録）
- G1 の会場×日数は 9月 33、10月（20日まで）18、7月 0
- 前年の同条件 GSC: 取れない（上記）。SERP 履歴・市場需要資料: repo に無い

## 主な数字（GSC）

hq へ移した（2026-11-06 オーナー決定）。

## 開催データの取り方（再現用）

読み取り専用の接続（`SUPABASE_RO_DB_URL`）で次を CSV に書き出した。

```sql
-- db-race-series-2025-12_2026-12.csv
select venue_code,start_date,end_date,total_days,class_code,grade,kind,title
from race_series where end_date>='2025-12-01' and start_date<='2026-12-31'
order by start_date,venue_code;

-- db-monthly-venue-days.csv
with vd as (select distinct race_date, venue_code from races
  where race_date between '2025-12-01' and '2026-10-31' and coalesce(cancellation_status,'')='')
select to_char(vd.race_date,'YYYY-MM') as month, count(*) as venue_days, count(distinct vd.race_date) as days_with_races,
  count(*) filter (where s.class_code='SG') as sg_venue_days, count(*) filter (where s.class_code='G1') as g1_venue_days,
  count(*) filter (where s.class_code is null) as no_series_match
from vd left join race_series s on s.venue_code=vd.venue_code and vd.race_date between s.start_date and s.end_date
group by 1 order by 1;
```
