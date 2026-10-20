# ADR 0099: ブログの図の PNG を、Vercel のビルドで部品を撮って配る

## ステータス
採用（2026-10-20。構成は system-architect の審査済み、オーケストレーター経由。撮影の形は `docs/design/blog-charts/mock/png-review.md` でオーナーの確認待ち）

## 背景
- ブログの図（ADR 0098）を note・X の投稿にも添えたい。オーナーが画像を取りに行く先が要る
- 図を画像として別に作ると、記事の図と値・見た目がずれる。記事と同じ部品（`src/components/blog/BlogChart.jsx`）を撮れば、同じ JSON から同じ値が出る
- ビルドは既に AI 向けのスナップショット（ADR 0032・0089）で Chromium（`scripts/lib/launchChromium.js`、Vercel では @sparticuz/chromium と同梱の Noto Sans JP）を起動し、dist を配るローカルのサーバーで記事を描いている

## 決定
1. **撮る場所**: `scripts/generate-ai-snapshots.js` が記事のスナップショットの後に `scripts/lib/blogChartPng.js` を呼ぶ。`public/blog-charts/*.json` ごとに記事（JSON の `article`）を開き、`figure[data-chart-id]` を撮影の形（`[data-chart-export]`、`BlogChart.css`）にして、ビューポートの左上に固定して撮る。鍵は要らない
2. **置き場と名前**: dist の `/blog-charts/{id}.{大きさ}.png`。コミットしない（ビルドの成果物）。名前は JSON の id から決まる
3. **大きさ**: 部品の固定の一覧（`src/utils/blogChartPng.js`）。portrait 1080×1350（CSS 400×500 を 2.7 倍、X の 4:5）と landscape 1280×720（CSS 640×360 を 2 倍、2段組み）。撮るのは既定の view・日本語だけ・ライトの色
4. **撮影の形**: 切り替えを消して札に「会場 福岡」の形で選んだ view を出す。注記は外さない。下端にサイト名とドメインを文字で入れる（ロゴの絵は入れない）。ファン役 `docs/design/blog-charts/fan-panel-png-v1.md`
5. **収まらないとき**: 字を縮めない。はみ出す大きさは作らず `status.json` の `blogChartPng.skipped` に理由を残す（作り手の側の事情なので `ok` は落とさない）。図が描けない・記事に図が無い等は `blogChartPng.errors` に残し `ok` を false にする（毎日の照合 `scripts/lib/botHtmlParity.js` が Slack に流す）。ビルドは落とさない（PR #624 と同じ）
6. **取り方と知らせ方**: オーナーは本番の URL から取る。新しい PNG の URL は、オーケストレーターが朝夜のまとめに `scripts/content/blog-chart-png-digest.js` の出力を貼る。無い PNG は rewrite で 200 の index.html が返るので、content-type と先頭8バイトで PNG かを見る

## 却下した案
- **PNG をリポジトリにコミットする**: 部品・CSS を変えるたびに全 PNG の差分が出る。JSON と部品があればビルドで同じものが作れる
- **画面の公開の経路（撮影専用のページ）を足す**: 本番に余計な URL が増え、ボット・人に見える。記事のページを撮影の形に切り替えれば足りる
- **字を縮めて枠に押し込む**: スマホの X で読めなくなる（visual-designer、2026-10-20）
- **注記を外して 4:5 に収める**: 画像だけが回ると「枠番ではない」「件数の少ない行の順位は言えない」が消え、誤読される（ファン役 3対1、x-channel・visual-designer も外さない）

## 影響
- ビルドの時間が図の数に比例して延びる（PR の本文に Standard 4 vCPU での実測）。図が無ければ0
- 撮影の形を変えるときは `BlogChart.css` の `[data-chart-export]` と `src/utils/blogChartPng.js` を同時に変える（`verify-blog-chart-png.js` が寸法の食い違いを落とす）
- 翻訳記事の図・既定以外の view は撮らない。要るときは一覧に大きさ・言語を足す

## 関連
- ADR 0032・0089（AI 向けのスナップショット）、ADR 0098（図の契約）
- `docs/design/blog-charts/contract.md` 8節・`mock/png-review.md`・`fan-panel-png-v1.md`
