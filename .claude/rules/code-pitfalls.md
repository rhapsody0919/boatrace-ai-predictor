---
paths:
  - "src/**"
  - "api/**"
  - "scripts/**"
  - "middleware.js"
---

# コードの落とし穴（旧 AGENTS.md の「boatAI 固有の最重要観点」「Review guidelines」「例外として正しいもの」から移した）

過去に実際に問題になった箇所。重大度は AGENTS.md「PR の決まり」の P0〜P3。

## 1. Supabase クエリの落とし穴（P1〜P0）

- **デフォルト limit は 1000行**。大量データ取得（全レース・全予測等）で `.range()` によるページネーションが無いと静かにデータが欠落する。`for` ループでの `.range(from, from + pageSize - 1)` パターンが正しい実装
- 環境変数名は `SUPABASE_SERVICE_KEY`（`SUPABASE_SERVICE_ROLE_KEY` ではない）。誤った変数名は接続失敗ではなく `undefined` として静かに失敗しうる
- `predictions.predicted_at` でのフィルタが必須（`created_at` カラムは存在しない）。存在しないカラムでのフィルタはエラーではなく無視される場合がある
- `patterns` 配列は **2026-03-08 以降のデータにのみ存在**。それ以前のデータを含むクエリ結果に対して `patterns` へ無条件アクセスするとレコードによっては undefined になる
- 集計・バッチスクリプトの冪等性: 同じスクリプトを再実行しても重複挿入・二重集計にならないか（過去に実際に非冪等な集計パイプラインが本番データを壊した事例あり）

## 2. i18n・多言語対応（P1）

- 言語プレフィックス（`/en`, `/zh-TW`, `/ko`）の付与・除去は `src/config/languages.js` の `localizePath` / `parseLangFromPath` に一元化されている。正規表現や文字列操作で `/en` 等をハードコードした新規実装は既存ヘルパーの再実装であり、他言語追加時に追従されず壊れる
- ページ内リンク（`<Link to="...">`）に言語プレフィックスを付け忘れると、クリック時に URL 同期ロジックが誤動作し **UI 全体の言語が意図せず切り替わる**（実際に発生した事故: 入門ガイド内の関連ページリンクがプレフィックスなしで、踏むと日本語に戻ってしまっていた）
- ブラウザ言語コード（`zh-HK`, `zh-CN` 等）が `supportedLngs` に完全一致せずフォールバック言語（日本語）に落ちるケースがないか、`fallbackLng` の設定を確認する
- 新規翻訳キーを追加した場合、全言語（`src/locales/{ja,en,zh-TW,ko}/common.json`）に対応キーがあるか（変数プレースホルダー `{{count}}` 等の一致含む）

## 3. モバイル・タッチイベント（P1）

- iOS のタッチイベントは問題が多い。`onTouchStart` 等の独自実装ではなく `onClick` のみのシンプルな実装になっているか
- `overflow: hidden` / `overflow: auto` はサブ要素のタッチイベントを妨げる。スクロール可能領域内のインタラクティブ要素で操作不能になっていないか

## 4. 用語・法令・ディスクレーマー（P0〜P1）

- 「競艇」という文字列の使用は禁止（コード・ドキュメント・ブログ本文・見出し・UI表示テキスト全て）。「ボートレース」を使う。多言語コンテンツでも各言語の禁止語相当（詳細は `docs/reference/i18n-glossary.md`）に注意
  - **例外（暫定措置）**: 画面に描画されないメタ情報（`<title>`・`meta description`・`meta keywords`・OGP/Twitter カード）と、SNS 投稿のハッシュタグ（`#競艇` 等）は使用可。これらに「競艇」が入っていることを P1 で指摘しない。ページ本文・見出し・UI表示テキスト、投稿の本文・ナレーションでの使用だけを P1 にする
- 投票は日本国内在住・20歳以上のみ可能。新規の英語・多言語コンテンツ（特にガイド系ページ）にこの制約の記載が欠けていないか
- AI予測は結果を保証しない旨のディスクレーマーが、予測を表示する新規UIで欠落していないか
- boatAIはSSR・プリレンダリングの無い純粋なクライアントサイドSPA。ページ固有のtitle/meta/OGPタグはマウント後にJSで書き換える方式のため、JavaScriptを実行しないクローラー（Facebook等）にはページ固有の変更が反映されない。SNSシェア時のリンクプレビュー（OGP/Twitterカード）関連の実装・レビューでは `docs/reference/seo-architecture-constraints.md` を参照する

## 5. コンポーネント・デザイン規約（P2）

- 同じUIパターンが `App.jsx` と `RaceDetail.jsx` 等の複数箇所に重複していないか（`src/components/race/` への切り出しルール）
- 色・サイズが `src/styles/design-tokens.css` の CSS 変数を使わずハードコードされていないか
- 会場コード（1〜24）⇔ 会場名のマッピングが `constants/`・`locales/*/common.json`・`docs/reference/i18n-glossary.md` の間で一貫しているか

## 6. スクリプトの実行環境（P2）

- `scripts/` 配下のスクリプトで GitHub Actions（日次 cron）から `node` 直接実行されるもの（例: `generate-sitemap.js`）が、Vite 専用構文（`import.meta.glob` 等）に依存する `src/` 配下のファイルを import していないか。Node 直実行で構文エラーになり自動処理が止まる

## 数値・統計・言い方・登録（旧 Review guidelines）

- **数値の範囲・母数・条件の食い違い**: 件数と割合の母数がそろっているか（同じ画面の「N件」と「x%」が別の範囲・期間・条件で出ていないか）。札・見出しの範囲の呼び名と、実際に使った範囲が一致しているか
- **後出しの統計**: そのレースの時点では分からない情報（結果・確定後の値・未来の日付のデータ）を、事前の傾向・判定に使っていないか
- **言い方の規則**（画面・UI 文言・SNS 本文）: 禁止語「数える・似た・似ている・ふつう・いつも」、「似たレース」（「類似レース」と書く）、「競艇」（本文・UI 不可。例外は上の「4.」）、誇大・保証の表現（「必ず当たる」「的中保証」「鉄板」等。`sns-video-studio/remotion/risk-rules.json`）。「集計・算出・対象」は禁止語ではない。龍神ソナー・思考アシストで「数える」を言い換えるときに限り、この3語も使わない
- **verify の登録漏れ**: 新しい `scripts/maintenance/verify-*.js` が `scripts/maintenance/verify-registry.json` に登録されているか（未登録だと `npm run verify:ci` が落ちる）
- **読み取りエラーの握りつぶし**: 本番 DB の取得失敗を `return []`・`.catch(() => [])`・`data || []` で空にし、「データなし」と同じ表示にしていないか（`.claude/rules/frontend-data-fetch.md`。除外集合が空になると除外が反転する）
- **1000行上限**: 件数が1000行を超えうる取得に `.range()` のページングがあるか
- **i18n のキー欠け**: 足したキーが `src/locales/{ja,en,zh-TW,ko}/common.json` の4言語すべてにあるか（プレースホルダーの一致を含む）
- **Edge Functions の import 属性**: `api/` で JSON 等を import するとき、import 属性（`with { type: "json" }`）の有無が既存の書き方とそろっているか。Vite の `npm run build` は `api/` を束ねないので、build が通っても Vercel・Node（verify-*.js から import する検査）で読めない形になっていないか

## 例外として正しいもの（誤って直さない）

- 「競艇」は `<title>`・`meta description`・`meta keywords`・OGP/Twitter カード・SNS 投稿のハッシュタグでは使ってよい（暫定措置。上記「4. 用語・法令・ディスクレーマー」参照）。画面に描画される本文・見出し・UI 文言での使用だけを P1 にする
- `predictions` に `created_at` は無い。`predicted_at` を使っていれば正しい
- E2E は録画を再生する。`e2e/fixtures.js` の `test` と `fetchRecorded(route)` を使っていれば正しい
- RPC の `CREATE OR REPLACE FUNCTION` は、直前の定義が返すキーを全て返しているかを見る。キーが減っていれば P1
