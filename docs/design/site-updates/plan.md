# 更新のお知らせ（site-updates）plan

[spec.md](spec.md)・[screens.md](screens.md) の作り方。DB・API・cron の変更は無い（同梱のデータだけ）。

## 全体の流れ

```
マージした PR ──(窓口が手で回す)──> site-updates-candidates.js ──> 候補の一覧（Markdown、標準出力）
                                                                      │ 窓口が選び、ファンの言葉に書く
                                                                      ▼
                          src/data/siteUpdates.js（SITE_UPDATES・SITE_MAKING）── verify-site-updates.js（CI）
                                   │
                 src/pure/siteUpdates.js（月の束ね・帯の1件・NEW の判定。時計は引数）
                   │                       │                         │
          /updates（SiteUpdates.jsx）  トップの帯（SiteUpdatesBanner） メニュー（Header の項目と ☰ の点）
```

## データの形（`src/data/siteUpdates.js`）

```js
// kind: "feature"（新機能）| "improvement"（改善）| "minor"（細かい改善。月ごとに畳む）
export const SITE_UPDATES = [
  {
    id: "2026-11-22-venue-card-link", // 日付-英小文字の短い名。変えない（帯の×の記録に使う）
    date: "2026-11-22",               // 本番に出た日（JST）
    kind: "improvement",
    title: "開催の無い会場のカードからも、会場のページへ進めるように", // 40字以内
    body: "今日レースの無い会場でも、直近1年の傾向や次の開催を確かめられます。", // 90字以内。minor は無し
    path: "/",                        // 任意。「見てみる」の行き先（ja のパス）
    blogId: undefined,                // 任意。src/data/blog-posts/{id}.json が実在すること
    prs: [3243],                      // 元の PR（候補の機械が既出を外すのに使う。画面には出さない）
  },
];
// 今つくっている物。0〜3件。時期を書かない。できたら SITE_UPDATES へ移し、見送ったら消す
export const SITE_MAKING = [
  { id: "analysis-tool", title: "データ分析ツールを見やすく" },
  { id: "racer-page", title: "選手ページの見直し" },
];
```

並びは日付の新しい順で手で書く（verify が見る）。同じ日は書いた順。

## 計算（`src/pure/siteUpdates.js`）

- 今日（JST）は `src/pure/jstDate.js` の `getDaysAgoJST(0, now)`
- `visibleUpdates(items, now)`: 今日までの件だけ。先の日付で書いた件は、その日まで画面・帯・NEW に出さない（verify は今の時刻を見ないので、ここで守る）
- `isWithinJstDays(date, days, now)`: 今日を含め days 日（`date >= getDaysAgoJST(days - 1, now) && date <= today`）。時計を引数で受け、文字列の比較で決定的にするため別に置く（ブログの `isWithinDays` と結果は JST の0時ちょうどを除いて同じ。`src/utils` は凍結）
- `groupUpdatesByMonth(items)`: `[{ month: "2026-11", label: "2026年11月", main: [...feature/improvement], minor: [...] }]`、月の新しい順
- `pickBannerItem(items, now, dismissedId)`: 今日までの件で kind が minor でない先頭（最新）を取り、14日以内でなければ null、id が dismissedId なら null
- `hasRecentUpdate(items, now)`: minor でない件が7日以内にあるか
- 定数 `BANNER_DAYS = 14`（目安・根拠なし）・`NEW_DAYS = 7`（ブログの NEW に合わせた）・`MAKING_MAX = 3`（オーナー決定 2026-11-23）

## 画面

- `/updates`: `AppRouter.jsx` に `<Route path="updates" element={<SiteUpdates />} />`。ja 専用なので `TRANSLATED_PATHS` に足さない（他言語の接頭辞で来たら既存の `isUntranslatedPath` の仕組みで ja へ）。`<title>`・description・canonical は既存のページ（`/today` の `MorningDataDigest.jsx`）と同じ書き方
- 帯: `VenueGridPage.jsx` の `TodayVenueGridPage` の `<main>` の先頭に `<SiteUpdatesBanner />`。言語は部品の中で Header と同じく URL（`parseLangFromPath`）から決め、ja 以外は何も描かない（`i18n.resolvedLanguage` は /en の初回の描画で ja なので一瞬出る）。過去の日付の一覧（`/races/:date`）には置かない。部品の頭に `i18n-allow-file`（`verify-jsx-japanese.js` が VenueGridPage から辿る）
- メニュー: `Header.jsx` の `/racers` と同じ `currentLng === "ja"` の分岐に `🔔 更新のお知らせ` の `SubmenuLink`。`hasRecentUpdate` が真なら項目に NEW、☰ に点（点も ja だけ）。`EXACT_TABS` に `updates`。文言は ja だけなので `i18n-allow` の印で囲む（既存と同じ）
- 断り: ページの末尾に固定の2文。`src/locales/ja/common.json` は他の作業と衝突しやすいので触らず、ja 専用ページの中に置く（`/today` と同じ）

## 端末の保存

`boatai-user:site-updates-dismissed` に帯で閉じた id を1つ。`useState(readDismissed)` で最初の描画の前に同期で読む（後から消すと中身が動く）。モジュールの最上位で window・localStorage を触らない。読み書きは try/catch、失敗は帯を出す側。

## 計測（GA4）

| イベント | 引数 | いつ |
|---|---|---|
| `site_updates_banner_view` | `update_id` | 帯を出したとき（1表示1回） |
| `site_updates_banner_click` | `update_id` | 帯を押したとき |
| `site_updates_banner_dismiss` | `update_id` | ×のとき |
| `site_updates_item_click` | `update_id`・`link`（try／blog） | `/updates` の「見てみる」「使い方の記事」 |

読み方: 帯の押下率（click / view）と、`/updates` からその画面への送客数。目安の線は置かない（根拠なし）。GA4 のカスタムディメンション `update_id` の登録はオーナーの GA4 の操作なので PR 本文で頼む。

## SEO

`scripts/lib/sitemapStaticPages.js` に `/updates` を1行（ja だけ）。AI 向けのスナップショットは作らない（YAGNI。PV が出てから）。

## 候補の機械（`scripts/maintenance/site-updates-candidates.js`）

- `git log origin/master --merges` ではなく、`--first-parent` の各 commit の題と変えたファイル（`--name-only`）を読む（squash マージのため）
- 残す: 変えたファイルに `src/pages/`・`src/components/`・`src/hooks/`・`src/locales/ja/` を含む
- 外す: 題が `refactor`・`リファクタ`・`test`・`e2e`・`ci:`・`chore`・`docs`・`content:`・`sns`・`admin`・`機能フラグの裏` を含む（大文字と小文字を区別しない）、または PR 番号が `SITE_UPDATES[].prs` にある。「揺れ」は外さない（画面の揺れの直しは載せうる）
- 起点: 引数 `--since`、無ければデータの最新の日付。git には `YYYY-MM-DDT00:00:00+09:00` で渡す（手元の TZ に依らない）
- 回す前に `git fetch origin master` を案内する（手元の origin/master を読むため）
- 出力: `- 2026-11-22 #3243 fix: …` の Markdown。書き込みはしない
- 判定の純関数は同じファイルから export し、verify で試す

## 試験と検査

| 何を | どこで |
|---|---|
| データの形・禁止語・並び | `scripts/maintenance/verify-site-updates.js`（tier ci） |
| 純関数（暦日の境目・帯の選び・月の束ね） | 同じ verify の中で時計を固定して |
| 候補の機械の残す・外す | 同じ verify の中で固定の commit の列を渡して |
| ページ | `e2e/site-updates.spec.js`（データは固定なので時計に依らない） |
| 帯・メニュー | `e2e/site-updates-banner.spec.js`・`e2e/site-updates-menu.spec.js`。時計を最新の新機能・改善の日の正午（JST）に置き、帯・×・再読み込み・en に出ないこと、NEW・☰ の点・en に出ないことを毎回試す |
| レイアウト | 5幅の layout の spec は足さない（1列の縦の並びだけ。手元で 375・1440 のライト・ダークを撮って確かめた） |
| 受け入れ | `e2e/acceptance/site-updates.spec.js`（acceptance-test-writer が spec だけから書いた物。実装の後に別の PR で入れる） |

## PR の分け方（300行5ファイル、`src/` と `docs/` を混ぜない）

| # | 中身 | tasks |
|---|---|---|
| D1 | 設計: spec・screens・fan-panel・mock/APPROVED.md・mock.html | — |
| D2 | 設計: plan・tasks・mock の画像2枚 | — |
| 1 | データと計算と検査: `src/data/siteUpdates.js`（10月下旬以降の10件）・`src/pure/siteUpdates.js`・`verify-site-updates.js`・`verify-registry.json` | T1 |
| 2 | ページ: `SiteUpdates.jsx`・`.css`・`AppRouter.jsx`・`sitemapStaticPages.js`・`e2e/site-updates.spec.js`（ルートと sitemap は verify-sitemap-coverage が同じ PR を求める） | T2 |
| 3 | トップの帯: `SiteUpdatesBanner.jsx`・`.css`・`VenueGridPage.jsx`・`e2e/site-updates-banner.spec.js` | T3 |
| 4 | メニュー: `Header.jsx`・`Header.css`・`e2e/site-updates-menu.spec.js` | T3 |
| 5 | 10月上旬の残りの件（データだけ） | T1 の続き |
| 6 | 候補の機械 | T4 |
| 7 | 運用の文書と content-index（公開の後） | T5 |

2〜4 は 1 の上に順に積む。1件の部品（screens の `SiteUpdateItem`）は別のファイルにせずページの中に置いた（ページでしか使わない）。
