# ai-crawler-snapshot タスク分解

`docs/design/ai-crawler-snapshot/spec.md`・`plan.md`・`docs/adr/0032-ai-crawler-snapshot-delivery.md`に基づくタスク一覧。依存順に並べており、上から順に実装する。

## タスク一覧

- [x] **1. `src/config/aiCrawlerBots.js`作成**
  対象ボットのUser-Agent文字列リスト（`GPTBot`/`ClaudeBot`/`PerplexityBot`/`Google-Extended`/`facebookexternalhit`/`Twitterbot`）と、`isTargetBot(userAgent)`・`resolveSnapshotPath(pathname, userAgent)`を実装する（plan.md記載のコード例通り）。`middleware.js`・`verify-ai-snapshots.js`双方から読み込めるよう、Edge Runtime・Node.js両方で動くプレーンなESモジュールにする。

- [x] **2. `scripts/generate-ai-snapshots.js`実装（ブログ記事分）**
  `vite preview`相当のローカル静的サーバーを一時起動し`dist/`を配信、Playwrightで`src/data/blogPosts.js`の日本語記事全件（`/blog/{id}`）にアクセスして`.blog-post-content`の描画を待機、`page.content()`を`dist/ai-snapshots/blog/{id}.html`に保存する。処理完了後、一時サーバーを確実に停止する。

- [x] **3. `scripts/generate-ai-snapshots.js`拡張（`/winning-technique`分）**
  `src/locales/ja/common.json`の`analysisPage`セクション（h1/subtitle/tabs.*/info.*、17タブ分）を読み込み、`index.html`と同等の`<head>`構成を持つ簡易HTMLテンプレートへ流し込んで`dist/ai-snapshots/winning-technique.html`として保存する処理を追加する。ブラウザ・Supabase等のライブAPIは使用しない。

- [x] **4. `package.json`のbuildスクリプト変更**
  `"build": "vite build"`を`"build": "vite build && node scripts/generate-ai-snapshots.js"`に変更する。`npm run build`実行後、`dist/ai-snapshots/`配下にブログ記事全件＋`winning-technique.html`が生成されることを確認する。

- [x] **5. `middleware.js`のリファクタ＋ボット分岐追加**
  既存のSNSハブBasic認証処理を関数化（`handleSnsHubAuth(request)`等）し、挙動を変えないことを確認する。`matcher`に`/blog/:path*`・`/winning-technique`を追加。リクエストパスで分岐し、`/admin/sns-hub*`は既存認証、それ以外は`resolveSnapshotPath()`の結果に応じて`@vercel/functions`の`rewrite()`または`next()`相当（何も返さない）とする。`@vercel/functions`パッケージが未導入の場合は追加する。

- [x] **6. `scripts/verification/verify-ai-snapshots.js`実装**
  対象URL全件（ブログ記事id一覧＋`/winning-technique`）に対し、`AI_CRAWLER_USER_AGENTS`の代表UA（`GPTBot`）を付与したfetchを行い、レスポンスHTMLに記事タイトル・本文相当の実コンテンツ文字列が含まれるかをチェックするスクリプトを作成する。デプロイ先URL（本番・Vercel Preview）を引数で指定できるようにする。

- [x] **7. ローカル動作確認・技術検証**
  `vercel dev`はプロジェクト未リンクのため使用不可と判明。代替として、`middleware.js`をNode.jsで直接importし実際の`Request`オブジェクトを渡してレスポンスを検証（(a) 通常UA+ブログ記事→undefined、(b) SNSハブ認証あり/なしの正常系・異常系→既存挙動を維持、(c) GPTBot+ブログ記事→`x-middleware-rewrite`ヘッダ付きResponseで正しいスナップショットパスを指す、を全て確認）。`npm run build`成功（86記事+winning-technique、約23秒）、生成物のtitle重複バグを発見・修正、`npm run test:e2e`実行（21件失敗は既知の環境依存failureと同一、回帰なし）。

- [ ] **8. PR作成**
  `/create-pr`でPR作成。PR本文にADR 0032へのリンク、技術検証結果を含める。マージ後の効果測定（GA4定点観測、1〜2週間）はPRのフォローアップ事項として明記する。
