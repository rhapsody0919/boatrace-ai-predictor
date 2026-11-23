# 更新のお知らせ（site-updates）screens

[spec.md](spec.md) の画面とコンポーネント。

## 画面

| 画面 | 新規／既存 | 役割 |
|---|---|---|
| `/updates`（`src/pages/SiteUpdates.jsx`・`.css`） | 新規 | 月ごとの一覧・今つくっている物・断り。ja 専用。`AppRouter.jsx` に Route を1行 |
| トップ `/`（`src/pages/VenueGridPage.jsx`） | 既存の拡張 | 今日の一覧の `<main>` の先頭に `<SiteUpdatesBanner />` を1つ置く。部品が URL から言語を見て ja のときだけ描く。過去の日付（`/races/:date`）には置かない |
| メニュー（`src/components/Header.jsx`） | 既存の拡張 | ja のときだけ「更新のお知らせ」の `SubmenuLink`（既存の `/today`・`/racers` と同じ `currentLng === "ja"` の分岐）。7日以内の新着で NEW と ☰ の赤い点 |

## コンポーネント

| 部品 | 新規／既存 | 役割 |
|---|---|---|
| `src/components/siteUpdates/SiteUpdatesBanner.jsx`・`.css` | 新規 | トップの1行の帯。表示する1件は `pickBannerItem` が決める。×で閉じる |
| 1件の部品 `UpdateItem` | 新規（`SiteUpdates.jsx` の中） | 1件（日付・札・見出し・本文・リンク）。`/updates` の中だけで使うので別のファイルにしない |
| `src/data/siteUpdates.js` | 新規 | `SITE_UPDATES`（更新）と `SITE_MAKING`（今つくっている物）の定数 |
| `src/pure/siteUpdates.js` | 新規 | `visibleUpdates`・`groupUpdatesByMonth`・`pickBannerItem`・`hasRecentUpdate`。時計は引数で受ける（試験で固定する） |

`App.jsx` と `RaceDetail.jsx` の両方に要る部品は無い。共通化はしない。

## 見た目（トークン）

- 帯: 背景 `--surface-card`、罫 `--border-hairline`、左の太線 `--brand-accent-primary`。文字 `--text-primary`・`--text-secondary`
- 札「新機能」「改善」・NEW: 塗りを使わず枠線と文字の色だけ（新機能・NEW は `--brand-accent-primary`、改善は `--text-secondary`）。ライト・ダークの別の値が要らない。リンクも `--brand-accent-primary`（既存の `.result-volatility-caveat a` と同じ）
- 日付は `font-variant-numeric: tabular-nums`
- クラス名はすべて `site-updates-` で始める（ページ・部品に固有）

## 状態

| 状態 | 見え方 |
|---|---|
| 更新が0件（あり得ないが） | `/updates` は「まだお知らせはありません」の1行。帯・NEW は出ない |
| 14日以内の更新なし | 帯は出ない |
| 帯の×を押した後、新しい件が無い | 帯は出ない |
| localStorage が使えない | 帯は毎回出る（閉じても次の読み込みで出る） |
| 今つくっている物が0件 | 枠ごと出さない |
