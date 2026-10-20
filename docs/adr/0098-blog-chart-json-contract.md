# ADR 0098: ブログ記事の図を、記事と同じ時点の固定の JSON から部品で描く

## ステータス
採用（2026-10-20。オーナーが「推奨どおりで実装に進んで」とモック v1 を承認。横棒を HTML/CSS で描く件はオーケストレーターが決定。`docs/design/blog-charts/mock/APPROVED.md`）

## 背景
- ブログ（`public/blog/*.md`）は `src/pages/BlogPost.jsx` の ReactMarkdown で描き、日本語の記事約120本のうち95本は静止画しか持たない。オーナーは「数値の表はグラフに」を求めている（2026-09-14・2026-10-11）
- 記事を書くのは hq の SEO 担当（LLM）。担当が JSON を書くだけで図が出て、ファン役の条件（開いた時点で答えが出ている・値を常に出す・切り替えは1つ・スマホは横棒・CLS を防ぐ）を破れない形が要る
- AI 向けのスナップショット（ADR 0032・0089）は Playwright で描いた DOM を保存するので、図の値が文字で載り、描き終わる前に保存されないことが要る

## 決定
1. **契約**: 図は `public/blog-charts/{記事id}-{図id}.json` の固定の JSON（`docs/design/blog-charts/contract.md`、schemaVersion 1）。記事にはタグを1行 `<ryujin-chart src="/blog-charts/…json" rows="6"></ryujin-chart>` と書く。図の種類は `kind` で分ける union（実装は `hbar` だけ、ほかは予約）。新しい種類を足すのは版を上げず、既存の項目の意味・必須・型を変えるときだけ版を上げて同じ PR で全 JSON を書き換える
2. **描き方**: 部品 `src/components/blog/BlogChart.jsx` が JSON を取り、`src/utils/blogChartContract.js` で検査してから描く。横棒は recharts ではなく HTML/CSS で描く（値が HTML の文字になりスナップショットに確実に載る・アニメーションが無い・幅を測るまで描かない問題が無い）。見た目はサイトのトークンに合わせる
3. **条件の強制**: 条件は部品と CI（`scripts/maintenance/verify-blog-charts.js`、tier ci）で強制し、JSON からは変えられない。CI は未知のキー・件数と値の整数での照合・本文に無い答えの数字・記事のタグの書き方・「競艇」・廃止語・risk-rules の語を落とす
4. **スナップショット**: `scripts/generate-ai-snapshots.js` は `.blog-post-content` の後に `[data-chart-state="loading"]` が無くなるまで待ち、図が `error` の記事は保存せず失敗として数える
5. **置き場**: JSON は `/blog/` の下に置かない。middleware の対象で、1段（`/blog/x.json`）だと AI ボットにだけ別のファイルへ書き換えられる（`src/config/aiCrawlerBots.js` の `^\/blog\/([^/]+)$`）
6. **sanitize**: 記事の HTML の許可リスト（`src/utils/blogMarkdownSanitize.js`）に `ryujin-chart` の `src`（`/blog-charts/*.json` だけ）と `rows` を入れる

## 却下した案
- **/winning-technique の部品を共通にする**: 5つの部品は部品の中で Supabase を直接呼び、値は Tooltip でしか見えず、縦の棒でアニメーションする。契約の条件を満たすには分析ページの見た目と挙動も変わり、承認したモックの外になる（system-architect の見積もり、2026-10-20）。向きを逆にし、ブログの部品（props だけで描く）を正本にして、/winning-technique が後で乗り換えるかを別にオーナーに聞く
- **JSON をタグの中に直に書く**: JSON の途中の空行で HTML ブロックが切れ、残りが Markdown として崩れる。翻訳記事に写すとずれる
- **図だけ毎日更新する**: 本文の数字とずれる。記事と同じ時点で固定する

## 影響
- 記事の作り手は JSON とタグ1行を書き、同じ数字を本文の1行と表にも書く
- 図のある記事のスナップショットは、図の JSON の取得を待つ分だけ遅くなる
- 図の PNG の書き出し（note・X 用）は別の ADR で決める（ビルドで同じ部品を撮る案）

## 関連
- ADR 0032（AI クローラー向けスナップショット）、ADR 0089（ボット向け HTML は人の画面の部分集合）
- `docs/design/blog-charts/contract.md`・`fan-panel-mock-v1.md`・`mock/APPROVED.md`
- `docs/reference/venue-course-win-rate.md`（最初の題材の統計）
