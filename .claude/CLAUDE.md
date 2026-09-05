# 龍神レーダー プロジェクト - Claude Code 設定

## プロジェクト概要
- ボートレースAI予想サービス
- React + Vite + react-router-dom
- モバイルファーストのPWA
- Supabase（データベース）

---

## ディレクトリ構造

```
boatrace-ai-predictor/
├── .claude/
│   ├── CLAUDE.md
│   ├── commands/          # スラッシュコマンド
│   ├── rules/             # 自動読み込みルール
│   └── templates/         # テンプレート集
├── .github/               # GitHub Actions
├── src/
│   ├── components/
│   ├── services/
│   └── pages/
│       └── admin/         # 管理画面
├── scripts/
│   ├── daily/             # 日次実行
│   ├── analysis/          # 分析用
│   ├── maintenance/       # メンテナンス
│   ├── db/                # DBスキーマ
│   └── lib/               # 共通ライブラリ（supabaseClient.js等）
├── data/
│   ├── analysis/          # 分析結果JSON（venue-XX/）
│   ├── venue-params/      # 会場別パラメータ
│   └── predictions/       # 予測データ
├── docs/
│   ├── db-migration/      # DBマイグレーション
│   ├── reference/         # リファレンス資料
│   ├── design/            # 設計・実装資料（採用済み）
│   ├── operation/         # 運用ガイド
│   ├── issues/            # 既知の問題
│   ├── proposal/          # 提案・検討（未採用）
│   ├── setup/             # セットアップガイド
│   └── archive/           # 廃案・不要になった資料
├── public/
│   └── blog/              # ブログ記事（Markdown）
├── note-articles/         # note.com記事
├── archive/               # 古いファイル（参照用）
└── api/                   # Vercel Edge Functions
```

---

## 分析・調査アプローチの優先順位

**Node.jsスクリプトを優先して使用する。SQLの手動実行は最終手段。**

1. **既存スクリプトを使用** — `scripts/analysis/` の既存スクリプトで対応できるか確認
2. **既存スクリプトを拡張** — 今後も使う・他会場でも使える機能なら既存スクリプトに追加
3. **一時的なコード（`node -e`）** — 一度きりの調査にはファイルを作らず実行
4. **SQLスクリプト（最終手段）** — Supabase Dashboardでの手動実行が必要な場合のみ

### 調査・分析結果の報告原則（2026-08-25〜）
調査・分析タスク（`/growth-pdca`・`/growth-report`・`/i18n-growth-report`・`/x-growth-report`・`/tiktok-growth-report`等の集客系スキルに限らず全般）では、**取得したデータは自己判断で重要度を絞り込まず全て報告に含める**。「特筆すべき動きが無い」「横ばい」というデータも省略せず、その旨を明記して報告する（2026-08-25、GA4で多言語PVデータを取得していたのに、日本語側の変化にフォーカスして報告から漏らしていた実例あり）。取得したのに報告しなかった情報は、ユーザーから見れば「調査されなかった」のと同じであり、判断材料が欠落する。一部だけ深掘りしたい場合も、まず全項目を並べた上で「特にAが重要」と扱うのは構わないが、他項目を書かずに済ませない。

### 「議論して」の8人パネル構成（2026-08-26〜）
ユーザーが「議論して」と依頼した場合、以下8つのペルソナ視点を立てて多角的に検討し、それぞれの意見を踏まえた統合的な結論を出す。SNSマーケティング戦略の議論（`docs/operation/sns-marketing-strategy.md`）で実際に効果を上げた構成をデフォルト化したもの。

1. 天才マーケター
2. 天才エンジニア
3. 天才経営者
4. 天才デザイナー
5. 20代男性ボートレースファン
6. 20代女性ボートレースファン
7. 30代男性ボートレースファン
8. 30代女性ボートレースファン

各ペルソナの発言を列挙するだけで終わらせず、意見が割れた点は明示した上で最終的な結論・推奨案を示す。議論の対象がSNSマーケティングに限らない場合も、ボートレースファン4名の視点は「ユーザー・顧客視点」として汎用的に活用する。

---

## 重要な制約

### Claude Codeの限界
- モバイル実機でのテストは不可能。ユーザーに確認を依頼する
- 複雑な修正を何度も試すより、**シンプルに再実装**を優先する
- 3回以上同じ問題で失敗したら、一度立ち止まって別のアプローチを提案する

### フロントエンド変更の確認は自己完結させる
- UI変更後の目視確認で `npm run dev` をユーザーに毎回打たせない。Claude自身が `run_in_background` でdevサーバーを起動し、確認後は停止する
- ブラウザでの確認はPlaywright（プロジェクト依存関係、Chrome拡張MCPの認証状態に左右されない）で自己検証する
  - DOM出力（`document.title` / `meta[name="description"]` / `link[rel="canonical"]` 等）をスクリプトで取得して照合する
  - スクリーンショットを撮り、Read toolで読み込んで視覚的にも確認する
  - Node解決の都合上、確認スクリプトはプロジェクト直下（node_modules配下）に一時的に置く必要がある場合がある。**検証後は必ず削除する**
- ユーザーへの確認依頼は、Playwrightで完結できないもの（モバイル実機、視覚的な好み・UXの主観判断等）に限定する。依頼する際は具体的な確認項目をリスト化する
- ユーザーがローカル環境で自分の目で確認したいと言った場合（Claudeが確認を依頼したかどうかに関わらず）は、必ず具体的な確認手順を出力する：①ローカルサーバーの起動状態（未起動なら`run_in_background`で起動する）、②確認対象の正確なURL・操作手順（例: `/winning-technique?tab=extrend`を開く、どのボタンを押すか）、③何を見ればよいか（新旧の違い、期待される表示内容）。「動作確認してください」のような曖昧な依頼で済ませない
- UI変更を伴うタスクのマージ確認・完了報告では、ユーザーから「ローカルで見たい」と言われる前に、上記①②③（ローカルサーバー起動＋正確なURL＋確認ポイント）を最初から本文に含めておく。「必要なら教えてください」で済ませて後出しにしない

### 実装前の要件確認（ユーザーの想定とのズレ防止）
- 既存機能の修正・追加依頼で、影響範囲が1ファイルに閉じない、または挙動が変わる場合は、着手前に「こう理解した」という理解内容を一言で復唱し、ユーザーの認識とズレが無いか確認してから実装する
- typo修正・文言1箇所の変更など自明な微修正はこの復唱を省略してよい
- 迷ったら「要件をどう解釈したか一文で言えるか」で判断する。一意に言えない・複数の解釈がありうる場合は復唱する
- 大規模・曖昧さが残る新機能は復唱では足りないため、従来通り `/step1-spec` からのSDDフローを使う

### モバイル対応で注意すること
- iOSのタッチイベントは問題が多い。`onClick` のみでシンプルに実装する
- `overflow: hidden/auto` はサブ要素のタッチイベントを妨げる
- **サイト埋め込み動画は、埋め込み先のレイアウトの向きに合わせてキャンバスのアスペクト比を決める**（2026-09-01、オンボーディング動画を16:9で作って埋め込み先の縦長モバイルカードに収めた結果、動画自体を大きく縮小することになり文字が判読不能になった実例あり）。埋め込み先が縦長のモバイルカード・画面なら動画も9:16縦長で作る。動画の中身がスマホの実画面キャプチャの場合、キャプチャ自体が縦長なので、横長キャンバスに収めると「縦長画面を横長枠に収める」→「その動画をさらに縦長の狭いカードに収める」という二重の縮小が起きる。SNS投稿用（`sns-video-studio/`、常に9:16）とは前提が違うことに注意し、動画を作る前に埋め込み先の実際の表示幅・向きを確認する
- **生成した動画・画像等の視覚アセットをUIに組み込んだ後は、「表示されるか・再生できるか」だけでなく「実際の埋め込みサイズで文字・内容が判読できるか」を必ず確認する**（上記と同じ実例が原因）。スクリーンショットを撮って終わりにせず、埋め込み先の実サイズ（特にモバイル幅で他要素に囲まれた状態）でズームして中身が読めるかを見る。「機能しているか」の確認と「実用的な品質か」の確認は別物として扱う

### モバイル余白・スペーシングの最適化
| 要素 | デスクトップ | モバイル (480px以下) |
|------|-------------|---------------------|
| margin | 2-2.5rem | 0.75-1rem |
| padding | 1.5-2.5rem | 0.75-1rem |
| gap | 1-1.5rem | 0.5-0.75rem |

---

## 開発フロー

### ブランチ戦略（GitHub Flow）

| ブランチ | 用途 | デプロイ先 |
|---------|------|-----------|
| `master` | 本番リリース | www.boat-ai.jp |
| `feature/*` | 機能開発 | Vercel Preview（PR単位で自動生成） |

### デプロイフロー
`feature/*` → PR作成（Vercel Previewで確認） → レビュー → `master` にマージ（本番デプロイ）

### 仕様書駆動開発（SDD、大規模機能向け）
仕様に曖昧さが残る・設計判断が重要な大規模機能は `/step1-spec` から順に SDD フローを使う（小〜中規模の Linear チケットは従来通り `/implement` で直接実装）。詳細は `docs/operation/sdd-and-codex-review.md` を参照。

```
/step1-spec {slug} [チケット番号] → /step1-screens {slug}（UI機能のみ） → /step2 {slug} → /step3 {slug} → /step4 {slug}
```

### 実装完了後の自動レビュー
実装・PR作成後、ユーザーにレビューを依頼せず以下まで自動で実施する：
1. `/code-review` でセルフレビューを実行
2. **新規のデータ集計・分析機能（新しい統計・ランキング・傾向表示等）を含む場合は、データの正確性を複数の視点で検証する**（詳細は `.claude/rules/analysis.md` の「データ精度の検証」を参照）。コードレビューとは別に「集計結果が実データと一致しているか」だけを見る検証を必ず行う。実データの見た目・コードスタイルが正しくても、集計ロジックの誤り（スケール不一致、JOIN漏れ、期間ズレ等）は見た目だけのレビューでは発見できないため、独立した検証ステップとして扱う
3. 指摘事項を修正してコミット・push（判断が分かれる指摘は修正せず報告に含める）
4. `npm run build` を実行し、ビルドエラーが無いことを確認する。既存のページ挙動・共通コンポーネント（Header、LanguageSwitcher、`src/components/race/` 等）・ルーティングに影響しうる変更の場合は `npm run test:e2e`（`e2e/smoke.spec.js`、Playwright）も実行し、デグレが無いことを確認する。`AppRouter.jsx`に新しい静的ルートを追加した変更では`npm run verify:sitemap`も実行する。**新機能（ユーザー向けの新しいページ・分析タブ・主要機能）を実装した変更では`npm run verify:content-index`も実行し、対応する`docs/design/{slug}/content-index.json`を作成済み（または`not_applicable: true`で対象外を明記済み）であることを確認する**（フローA-2参照）。CI連携はせず、毎回Claude自身が手元で実行する。新しい主要導線を追加した場合はスモークテストにも追記する
5. `/codex-review`（Codexセカンドオピニオンレビュー）は**2026-07時点で見送り中**。ChatGPT契約のコストに見合わないと判断（詳細は `docs/operation/sdd-and-codex-review.md`）。仕組み自体は用意済みなので、将来必要になったら有効化する
6. **レビュー結果を PR にコメントで記載する**。内容: 指摘一覧（ファイル・行・内容）、各指摘の対応（修正コミット / スキップ理由）、修正後の検証結果（データ精度検証の結果を含む）
7. **ユーザーへの完了報告（チャット本文）には以下を必ず全て含める**。PR コメントへのリンクや「詳細は PR 参照」で省略しない：
   - 実装内容（何をどう変えたか。ファイル・機能単位で具体的に）
   - レビュー指摘の一覧（何が問題とされたか、内容がわかる具体性で）
   - レビューを受けて修正した内容（指摘 → 修正の対応関係）
   - 修正せずスキップした指摘とその理由
   - 検証結果（ビルド・E2Eスモークテスト・データ精度検証の結果を含む）
   - 最後にマージ可否の確認
8. マージはユーザー承認後に実行（勝手にマージしない）。**マージ確認を求める際は、単に「マージしてよいか」だけを聞かない**。毎回、7の内容（実装内容・レビュー指摘・修正内容・検証結果）を簡潔にまとめたサマリーと、ユーザーが何を確認すればよいか（例: 見た目を確認したいならこのURL、事実確認したいならこの記述、等）を添えて聞く。連続してタスクをこなす場合も、都度このサマリー付きで確認を求める（「マージしてよいか」の一言だけに省略しない）

---

## フローA: 新機能マルチチャネル展開

新機能の実装完了からYouTube解説動画・ブログ記事・X投稿・note投稿へ展開する一連の流れ。全体設計・現状の課題分析は [`docs/design/content-ops-flow/spec.md`](../docs/design/content-ops-flow/spec.md) を参照（2026-09-01策定）。

**ネタ駆動マルチチャネルパイプライン（2026-09-04時点: sns-topic-gate体系へ移行済み）**: 新機能／会場特性／データ知見／成績の4系統のネタから、チャネルごとに最適化したブログ・note・X・TikTok・YouTubeコンテンツを生成する仕組み。2026-09-01策定の初期設計（`content-multi-channel-pipeline-prompt.md`、単一Routineが5チャネル全生成を担当する方式）は、ネタ承認前に全チャネル分を生成してしまう・修正ルールが伝播しないという課題から`docs/design/sns-topic-gate/`（spec/plan、ADR 0036〜0038）へ再設計され、`sns_topics`/`sns_topic_targets`によるネタゲート＋チャネル別パイプライン（`docs/operation/sns-pipeline-{blog,note,x,tiktok,youtube}.md`）に置き換わった（旧設計文書は`docs/archive/`へ移動済み）。sns-hub管理画面（`/admin/sns-hub`）にTikTok/X/YouTube/Note/Blogの5プラットフォームタブが追加されており、下書きの承認・却下・（blog/youtubeは）自動公開をここで行う。

### フローA-1: 並列着手とチャネル展開の基本ルール
- 機能実装完了（PRマージ）を単一トリガーとし、YouTube解説動画制作とブログ記事執筆は**並列で着手できる**（互いを待つ理由がない）。X・note投稿は両方の完成を待ってから着手する（記事だけ先に公開されて動画が後追いだとリンクが死ぬため）
- 「PRマージを単一トリガーとする」だけでは、別セッションが機能PRをマージして終了した場合に誰も気づかず埋もれるリスクがあった（2026-09-01発覚）。`session-start-check.js`の`missingContentIndex`が、AppRouter.jsxの新規ルートのうちcontent-index.json未カバーのものを機械的に検知し提示する（新ルート＝ブログが要る新機能とは限らないため強制はせず提示のみ）
- ブランド一貫性: 新しいチャネル向け画像・動画を作成する前に、必ず [`docs/reference/brand-kit.md`](../docs/reference/brand-kit.md) のギャラリーを確認する。既存の採用実例と矛盾する独自デザイン（新しいロゴバッジの発明、実ヘッダーと異なるフォント処理等）を作らない。承認されたら、その場で`brand-kit.md`のギャラリーに実例を追記する（後日まとめての更新にしない）
- 重複制作防止: フローA着手時、対応するLinearチケットを`In Progress`に変更する。新規の排他制御機構は作らない（複数セッション並行時の実害は「同じ動画を2回作る」程度に留まるため、厳密な排他制御より軽い運用で十分と判断）
- sns-hubへの連携: `content-index.json`（フローA-2）は`session-start-check.js`の`recentFlowAContent`経由でsns-hubの型・キャラ選定ロジック（`docs/operation/x-operations-playbook.md`・`docs/operation/sns-video-producer-prompt.md`）からも参照される。新機能そのものの告知ではなく、その機能で見えるようになった実データ・実画面を推し活・人間味のある文脈の"素材"として使う位置づけ（「新機能告知単体は選ばない」という既存ルールは変更しない）

### フローA-2: トレーサビリティ索引（content-index.json）
機能変更のたびに「どのページ・どのコンテンツが影響を受けるか」を機械的に特定する手段がなかったことへの対策。

- 新機能ごとに `docs/design/{feature-slug}/content-index.json` を作成する（テンプレート: `docs/design/_template/content-index.json`）。その機能に言及する静的ページ・note記事・ブログ記事・YouTube動画・X投稿を記録する
- 対象チャネルが無い機能は、空配列のまま放置せず `not_applicable: true` を明記する（「対象チャネルなしと確認済み」と「確認自体をしていない」を機械的に見分けるため）
- **実装完了後の自動レビュー（上記4番）で`npm run verify:content-index`を実行**し、既存の`content-index.json`の形式が壊れていないかを確認する。「本来必要なのに作られていない」の全自動検出はしない（機能の一覧を機械的に列挙する手段がsitemapのルートほど自明ではないため）。新規作成自体は、このPRの完了条件として人間（多くはClaude自身）が判断する

### フローA-3: 新機能リリース時のブログ記事ルール
2026-07-30時点で「新機能リリースは必ずブログ記事とセットで出す」運用を再開した（4月以降ブログ更新が止まったことがPV下落の一因だったため）。記事作成時は以下を守る。

- **1機能1記事**: 複数機能をまとめた1記事にしない。SEOで異なる検索クエリを個別に拾うため、機能ごとに記事を分ける
- **SEOを意識した文字数**: 1記事あたり本文2,000〜3,500字程度を目安にする（既存記事の分量感を踏襲）。見出し（h2/h3）で構造化し、「何がわかるか」「使い方」「活用のポイント」「実践例」「まとめ」の型を基本にする
- **画像を組み合わせる**: 実際の機能のスクリーンショット（Playwrightで撮影したもので良い）を最低1枚、記事内に配置する。装飾目的の画像は不要
- 用語・文体は `.claude/rules/code-style.md`（「競艇」使用禁止等）に従う
- **「よくある質問」セクションを設ける**: `BlogPost.jsx`が`## よくある質問`セクションを自動検出してFAQPage構造化データを生成する（`src/utils/blogFaqSchema.js`）ため、`### 質問文` + 回答段落の形式でFAQセクションを含めると追加コード不要でSEO/AI引用対策になる
- **featured記事は英訳も同時作成する（2026-08-11〜）**: featured記事（`blogPosts.js`の`featured: true`）を新規公開する際は、英語版（`public/blog/{slug}-en.md` + `src/data/blogPostsEn.js`へのエントリ追加）も同一PRまたは近接PRで作成する。対象言語は英語のみ（zh-TW/koは対象外、需要が確認できるまで見送り）。ブログi18nの実装パターン・設計判断は`docs/design/blog-i18n/`（spec/screens/plan/tasks）・`docs/adr/0005〜0007`を参照

### フローA-4: 新規ページ追加時のsitemap登録（必須）
2026-07-31時点で、`/winning-technique`が`scripts/generate-sitemap.js`への追加漏れで長期間sitemap.xmlに未掲載、Google未インデックスのままだった実績あり（Search Console実データで検索クリック・表示回数0件と確認）。同じ漏れを繰り返さないため、新しい静的ページ・ルート（`AppRouter.jsx`に`<Route>`を追加するもの）を実装したら、**同じPRで**`scripts/generate-sitemap.js`の`staticPages`（多言語対応ページは`LOCALIZED_PAGES`/`LANGUAGE_ONLY_PAGES`）にも追記する。ページ単体の実装が完了した時点で完了とせず、sitemap反映まで含めて1タスクとして扱う。

sitemap変更は`.github/workflows/update-sitemap.yml`で毎日自動反映され、変更があった場合はSearch Consoleへの再送信（`scripts/submit-sitemap.js`）も自動実行される。ただし個々のページの即時インデックス登録を保証するものではない（詳細は`docs/operation/search-console-report.md`）。

登録漏れは`npm run verify:sitemap`（`scripts/maintenance/verify-sitemap-coverage.js`）で機械的に検知できる。AppRouter.jsxの静的ルートとgenerate-sitemap.jsのstaticPagesを突き合わせ、未登録があれば失敗する。新規ルート追加を含むPRでは実装完了後の自動レビュー（`npm run build`実行時）にこのコマンドも合わせて実行する。意図的にsitemap非対象とするルート（リダイレクト専用・管理画面・非公開ページ等）は、スクリプト内の`EXPECTED_EXCLUSIONS`に理由付きで登録する。

---

## フローB: sns-hub日常運用

X/TikTokへの定常投稿は `src/pages/admin/SnsHubAdmin.jsx` 等で構築中のSNSマーケティングハブ（Phase 1稼働中、Phase 2でPDCAループ設計中、`docs/design/sns-marketing-hub/`参照）が担う。フローAの「新機能ローンチ」とは独立した、既存ユーザー向けの継続的なコンテンツサイクル。詳細な運用ルールは`docs/design/sns-marketing-hub/`・`docs/design/sns-hub-phase2-pdca-loop/`を参照。

- sns-hubの動画・画像生成プロンプトも、着手前に[`docs/reference/brand-kit.md`](../docs/reference/brand-kit.md)を参照する。色・フォントを個別プロンプト内に直書きしない
- 無人のクラウドRoutineは外部サイト（X/TikTok等）を自律的に閲覧できないと確定済み（WebFetch/curlは許可リスト外ドメインに一律`EGRESS_BLOCKED`、ヘッドレスChromiumも外部接続不可。`docs/design/sns-hub-phase2-pdca-loop/spec.md`参照）。外部閲覧・生成・投稿が絡む作業は、Routineではなく対話セッションに委ねる設計を維持する
- **デザイン・BGM等の抜本的な作り込みはsns-hub UI上では行わない**（2026-09-04）。sns-hub UIは運用（生成物の承認・却下・軽微な修正指摘）に専念し、複数案を比較しながら作り込みたい場合は`/refine-creative`スキルをClaude Codeとの対話で使う。sns-hub UI上で「制作仕様を変えたい」というフィードバックを受けた場合も、その旨をユーザーに伝え`/refine-creative`の利用を案内する

---

## フローC: 既存コンテンツの品質・鮮度維持

機能追加・UI変更・モデル変更のたびに静的ページ・過去のnote/ブログ記事・視覚素材が陳腐化しうる問題、および各チャネルの画像・動画・CTAがセッションごとに場当たり的に作られ統一感を欠く問題への対策。設計の全体像・検討過程は [`docs/design/content-ops-flow/spec.md`](../docs/design/content-ops-flow/spec.md) を参照。

**核心の方針**: 「人間が覚えている」ことに依存する仕組みは遅かれ早かれ形骸化する（tweet-draftsが14件→38件まで滞留した実績あり）。機械的に判定できるものは実装完了チェックリスト（フローA-2参照）またはGitHub Actions、判断が要るものはセッション開始時の能動チェックまたはSlack通知のいずれかに必ず寄せる。

### フローC-0: セッション開始時チェックの統合（session-start-check.js）
以下の既存確認ルール（フローC-2〜C-5）に加え、トレーサビリティ索引カバレッジ・視覚素材鮮度・品質バックログの3項目を、`node scripts/maintenance/session-start-check.js`が1回の実行で集約する。**セッション開始時、このスクリプトを実行し、結果をこのセッションの最初の応答で報告する**（各項目の判定ロジック詳細はスクリプト冒頭のコメントを参照。以下フローC-2〜C-5の本文は、確認後に実際に何をするか＝実行手順として引き続き有効）。

note.com向け下書き生成・Xツイート下書き生成・投稿滞留チェック（旧フローC-1）は、sns-hubパイプライン（ネタ→チャネル別下書き自動生成→admin承認）に代替されたため廃止した（2026-09-05）。`note-articles/tweet-drafts.md`・`convert_to_note_markdown.py`・`scripts/generate-tweet-draft.js`自体は削除せず残置している。

### フローC-2: セッション開始時のX動画投稿確認（2026-08-24〜）
X運用の長期戦略議論を経て、Xも「可能な範囲で毎日投稿する」運用に変更した（`docs/operation/x-operations-playbook.md`の「X投稿頻度・型選定ロジック」参照）。上記のXツイート下書き（noteブログ告知等のテキスト投稿）とは別に、**動画投稿**については以下をセッション開始時に必ず行う（本日の投稿状況は`session-start-check.js`の`xVideo`で機械的に取得できる）。

- `data/analysis/x-posts/history.json`を確認し、本日の投稿本数が目標本数（マスコットテスト期間中は3本/日、`docs/operation/x-operations-playbook.md`参照）に達していなければ、**このセッションの最初の応答で**「本日Xに動画を投稿しますか？」と自発的に確認する（ユーザーから話しかけられるのを待たない）。「1本投稿した＝その日は完了」と早合点しない
- 「はい」と回答があれば、`docs/operation/x-operations-playbook.md`の「型・キャラ選定ロジック」に従って本日の内容を判断し、一言で提案してから動画制作（または既存ストック動画の選定）に着手する。制作前に`docs/reference/brand-kit.md`を確認する
- セッション内で確認して「いいえ」または反応が無ければ、その日はスキップし`history.json`に`status: "skipped"`として記録、次のタスクに進む（催促を続けない）。この`skipped`は「確認した上で見送った日」専用で、セッションが一度も開かれなかった日はエントリを作らない
- **SNS投稿の自動化・自動承認は行わない**（1件ごとの明示的承認が必須という制約は不変）。動画が完成したらユーザーに提示し、承認を得てから投稿操作に進む
- 投稿完了後、`data/analysis/x-posts/history.json`に日付・キャラ・型・題材・動画ファイルパス・投稿ステータスを追記する

### フローC-3: セッション開始時のTikTok投稿確認（2026-08-24〜）
TikTokは運用が軌道に乗り次第「毎日投稿」を目標とする運用に合意した（`docs/operation/sns-marketing-strategy.md`のフェーズ設計を参照）。Xの下書きと異なり事前に用意された下書きは無く、**その日の題材・型をClaudeが投稿履歴から判断して新規に考える**運用のため、以下をセッション開始時に必ず行う（本日の投稿状況は`session-start-check.js`の`tiktok`で機械的に取得できる）。

- `data/analysis/tiktok-posts/history.json`を確認し、本日まだ投稿していなければ、**このセッションの最初の応答で**「本日TikTokに動画を投稿しますか？」と自発的に確認する（ユーザーから話しかけられるのを待たない）
- 「はい」と回答があれば、`docs/operation/sns-video-producer-prompt.md`の「TikTok投稿頻度・型選定ロジック」に従って本日の型・題材を判断し、一言で提案してから動画制作に着手する。制作前に`docs/reference/brand-kit.md`を確認する
- セッション内で確認して「いいえ」または反応が無ければ、その日はスキップし`history.json`に`status: "skipped"`として記録、次のタスクに進む（催促を続けない）。**この`skipped`は「確認した上で見送った日」専用**であり、そもそもその日セッションが一度も開かれなかった日は誰も確認していないため`skipped`を書き込まない（無理に埋め合わせない、記録が単に存在しない日として扱う）
- **SNS投稿の自動化・自動承認は行わない**（Xツイート下書きと同じ制約。送信を伴うアクションは1件ごとの明示的承認が必須）。動画が完成したらユーザーに提示し、承認を得てから投稿操作に進む
- 投稿完了後、`data/analysis/tiktok-posts/history.json`に日付・型・題材・動画ファイルパス・投稿ステータスを追記する

### フローC-4: セッション開始時の選手ニュース要確認リスト提示（2026-08-27〜）
選手ニュース自動収集（`racer-news-auto-collect`）はGitHub Actionsで毎日自動実行され、`boatrace.jp`公式ニュースアーカイブ（レーサーデータカテゴリ）から選手の節目記録（通算◯勝達成等）を検出し、登録番号によるDB照合を通過したものは人手承認なしで`racer_news`へ自動投入する（ADR-0024参照）。ただし選手の特定に失敗した候補（登録番号がDBに無い、支部が一致しない等）は自動投入されず、`data/analysis/racer-news-pending-review/pending.json`に記録される（未確認件数は`session-start-check.js`の`racerNews.pendingCount`で機械的に取得できる）。

- `pending.json`に`status: "pending"`の項目があれば、**このセッションの最初の応答で**自発的に提示し、`racer_news`への投入可否を確認する（ユーザーから話しかけられるのを待たない）
- 承認されたら`scripts/maintenance/add-racer-news.js`でINSERTし該当項目の`status`を`approved`に、却下されたら`rejected`に更新する
- 掲載頻度自体が月1〜2件と低いため、このリストは頻繁には溜まらない想定。溜まっている場合はGitHub Actionsの実行状況（`.github/workflows/collect-racer-news.yml`）も確認する

### フローC-5: セッション開始時の集客調査スキル実行確認（2026-08-29〜、2026-09-05にnote追加）
SNSマーケティングハブPhase 2（改善案の自律立案ループ、`docs/design/sns-hub-phase2-pdca-loop/`）は、`/x-growth-report`・`/tiktok-growth-report`・`/note-growth-report`の定期実行結果をinsightとしてDBに登録し（ADR 0027）、週次で生成Routineへの反映を判定する（ADR 0030）設計。外部調査（競合・隣接ジャンル観測）はクラウドRoutineでは技術的に実行できないと確定しているため（`sns_marketing_hub_operational_state.md`メモリ参照）、対話セッション側でのスキル定期実行に運用が依存する。過去にX戦略の定期施策が「決めただけで仕組み化されず自然消滅した」実績（2025-12）があるため、以下をセッション開始時に必ず行う（鮮度は`session-start-check.js`の`growthSkills`で機械的に取得できる）。

- `data/analysis/x-growth/`・`data/analysis/tiktok-growth/`・`data/analysis/note-growth/`それぞれの最新レポートファイルの日付を確認し、いずれかが1週間以上前であれば、**このセッションの最初の応答で**該当スキル（`/x-growth-report`・`/tiktok-growth-report`・`/note-growth-report`）の実行を自発的に提案する（ユーザーから話しかけられるのを待たない）
- 「はい」と回答があれば該当スキルを実行する（複数プラットフォームが該当する場合、まとめて提案してよい）
- 「いいえ」または反応が無ければその日はスキップし、次のタスクに進む（催促を続けない）

### フローC-6: 自然言語「集客状況を調査して」トリガー時は4スキルセットで実行（2026-08-31〜、2026-09-05にnote追加）
「集客を分析して」「集客状況どう？」等の自然言語依頼（`/growth-pdca`と明示コマンド指定しない場合）では、`/growth-pdca`（Search Console/GA4、検索流入・ブログ側）に加えて`/x-growth-report`（Xプラットフォーム自体の実績）・`/tiktok-growth-report`（TikTokプラットフォーム自体の実績）・`/note-growth-report`（noteプラットフォーム自体の実績）も続けてまとめて実行する。4スキル合計でChrome in Claudeでの画面操作（X/TikTok/noteは実績確認のため）を含み実行時間が伸びる点、Search Console等の反映ラグ（2〜3日）と比べて高頻度で聞くと同じデータの再取得になりやすい点を踏まえた上でユーザーが合意済み（2026-08-31、note追加は2026-09-05）。`/growth-pdca`と明示コマンドで呼ばれた場合は対象外（これまで通りSearch Console/GA4単体で実行、X/TikTok/note分析は含めない）。
- 過去レポートが1件も無い場合は「初回実行の提案」として扱う

### フローC-7: 視覚素材の鮮度チェック
テキストのgrepでは検知できない`/about`のヒーロー動画のような素材の陳腐化に対応する。`node scripts/maintenance/session-start-check.js`の`visualAssetAge`で、`public/videos/`・`public/images/blog/`配下の主要素材の最終更新日一覧が確認できる（90日以上未更新の素材数を`staleCount`で提示）。**陳腐化の自動判定はしない**（判断は人間）。過去に「モデル刷新後も古い動画のまま5日間放置」が実際に発生している（`promo_video_stale_after_model_change.md`メモリ参照）。

### フローC-8: 「気づいたが手が回らない」品質課題の軽量バックログ化
陳腐化だけでなく、そもそもデザイン・CTA・画像の質が最適でないという課題を、都度フルスペックで指摘しなくても拾える仕組み。Linearの`content-quality`ラベル（2026-09-01新設）で軽量起票する（このセッションの`spawn_task`相当の代替）。粒度は「詳細な要件定義」ではなく「後で拾えるチケットの種」でよい。

- `node scripts/maintenance/session-start-check.js`の`qualityBacklog`で、ラベル付きIssueのうち起票日が古い順に2〜3件を提示する（tweet-draftsと同じ鮮度優先ペース）
- ブランド・デザイン品質に関する気づき（新しい画像・動画の制作時、既存チャネルのレビュー時等）は、都度この`content-quality`ラベルで起票する。起票して終わりにせず、`session-start-check.js`経由で定期的に拾われる前提の運用とする

### フローC-9: 押す（push）層 — GitHub Actions定期チェック＋Slack通知
`session-start-check.js`は「セッションが開かれたら実行される」引く仕組みであり、セッションが長期間開かれなければ一度も実行されない。この穴を埋めるため、判断・生成が要らない機械的チェック（トレーサビリティのカバレッジ・視覚素材の鮮度・品質バックログの件数）は`.github/workflows/content-ops-nightly-check.yml`で毎日夜間に定期実行し、閾値超過時（視覚素材90日超・品質バックログ10件超・content-index形式エラーあり）のみ既存の`SLACK_WEBHOOK_URL`（`slack-notify-pr.yml`と同経路）へ通知する。無人Routineが外部サイトを閲覧できない制約（フローB参照）とは異なり、このワークフローはリポジトリ内スクリプト＋Linear APIのみで完結するため無人実行に適する。

### フローC-10: 廃止済み用語の機械的検知（UI文言・note下書き・ブログ記事）
「このオンボーディングカードの文言は今の仕様と矛盾している」という意味理解による陳腐化検知は不可能。ただし「廃止が確定している具体的な用語・機能名がまだ残っていないか」は機械的に検知できる（ブログ記事の公開前チェック「現行仕様との整合性」で既に確立していた手法を横展開）。

- `docs/reference/deprecated-terms.json`に廃止済み用語（3モデル体系・「今日のおすすめ」機能・旧ブランド名「BoatAI」等）を一元管理する。新たに機能を廃止したら、都度このファイルに追記する
- `node scripts/maintenance/check-deprecated-terms.js`が、静的ページ（`About.jsx`・`FAQ.jsx`・`HowToUse.jsx`・各言語版ガイド）・オンボーディングUI（`FirstVisitGuideCard.jsx`）・note下書き（`note-articles/`）・ブログ記事（`public/blog/`）を対象にgrepし、ヒット件数を報告する
- `docs/reference/`配下の内部ドキュメント（用語集・DB設計等）は対象外（歴史的経緯の記録として旧用語を含んでいてよいため）
- 検知できるのは「この単語が存在すること」だけで、文脈が本当に矛盾しているかは目視確認が必要。ヒット件数は`session-start-check.js`の`deprecatedTerms`で件数のみ機械的に取得できる

### フローC-11: セッション開始時の戦略メモ（insight）承認待ち確認（2026-09-05〜）
`sns_strategy_insights`の`status='proposed'`（要判断）は、sns-hub「戦略メモ」タブの手動採用ボタン（PR #514）で人間が個別に承認する設計。tweet-drafts.md（最大38件滞留）・X動画投稿・TikTok投稿と同じ「セッション開始時チェックが無いと人間が承認を忘れて滞留する」パターンの再発を防ぐため、以下をセッション開始時に必ず行う（件数は`session-start-check.js`の`pendingInsights`で機械的に取得できる）。

- `pendingInsights.pendingCount`が1件以上あれば、**このセッションの最初の応答で**最も古い1件（`oldest`）の内容を自発的に提示し、「戦略メモの承認画面で確認しますか？」と一言確認する（ユーザーから話しかけられるのを待たない）
- 承認・却下の判断自体はsns-hub管理画面（`/admin/sns-hub`「戦略メモ」タブ）で行う（Claude Code側から代理で採用・却下しない、insight内容の妥当性判断は人間に委ねる）
- 「いいえ」または反応が無ければその日はスキップし、次のタスクに進む（催促を続けない）

### ブログ記事の公開前品質チェック（新規作成・改稿とも必須）
2026-08-16時点で、ビルド成功やE2Eといった構造面の検証だけでは記事の中身の質を担保できないことが判明した（既存featured記事に旧モデル廃止済み機能への言及が残ったまま公開されていた実例あり）。新規記事・既存記事の改稿（画像追加、FAQ追加等）を問わず、公開前に以下の観点を実際に検証し、パス/フェイルを明確にしてから完了報告する。

1. **数値・データ整合性**: 本文中の数値と表・図解の数値が一致しているか、計算式（期待値=的中率×オッズ等）を実際に再計算して検証する。他の既存記事で言及されている同じ数値（控除率25%等）と矛盾していないか横断確認する
2. **現行仕様との整合性**: 記事が言及する機能・UI要素・モデル名が現在も実在するか。過去のモデル刷新・機能撤去（3モデル切替→unified化等）で廃止済みの用語が残っていないか、`node scripts/maintenance/check-deprecated-terms.js`（フローC-10）で機械的に確認する
3. **検索意図の網羅性**: 対象キーワード（Search Console等で実際に観測されたクエリ）に対して、記事が実際に読者の疑問に答えられているか。見つかった観測クエリの一覧と記事の対応関係を確認する
4. **用語・表記ルール遵守**: `.claude/rules/code-style.md`（「競艇」使用禁止等）
5. **多言語間の一貫性**: 翻訳版がある場合、見出し数・主張・数値がja/en間で一致しているか
6. **構造要件**: 文字数（2,000〜3,500字目安。既存の長文記事を改稿する場合はこの限りではないが、超過時は理由を明示する）・画像・FAQセクションの有無。**データ・数値を扱う記事は、比較対象が3件以上ある場合や複数の指標を並べる場合、文章だけで羅列せず表や図解を使って構造化する**（2026-09-02追加、チャネル品質検証の合格基準として明示）

チェック結果は「合格/不合格」で明示し、不合格項目があれば必ず修正してから完了報告する。「ビルドとE2Eが通ったので完了」で済ませない。

### 新機能・新ページ追加時の多言語化の3区分（必須）
新しいページ・機能を実装する際は、必ず以下の3区分のどれに該当するかを決めてから着手する（2026-08-09合意、i18n監査で「未翻訳ページを全言語URLで配信しlang=enを宣言する」構造欠陥が発覚したため）。

1. **翻訳対象（translated）**: ユーザー獲得に直結する主要導線（ホーム・分析ツール・ガイド・会場ガイド等）。UI文言は直書き禁止で`t()`経由、**4言語のi18nキーを同じPRで追加**し、`src/config/languages.js`の`TRANSLATED_PATHS`に登録する。用語は`docs/reference/i18n-glossary.md`準拠（新用語はglossaryに追記してから翻訳）
2. **ja専用（ja-only）**: 規約・管理画面・成績ページ等、翻訳コストに見合わないもの。`TRANSLATED_PATHS`に登録しない（=言語プレフィックスURLはja版へ自動リダイレクトされ、`lang=ja`で配信されてブラウザのGoogle翻訳に委ねられる。hreflang非出力・言語スイッチャー無効化も自動で連動）。ブログは原則この区分だが、featured記事のうち英語対応済みのものは`src/config/languages.js`の`PARTIALLY_TRANSLATED_PATHS`で記事単位に例外扱いする（フローA-3「新機能リリース時のブログ記事ルール」参照）
3. **特定言語専用**: `/venues`系のような言語別コンテンツ。`LANGUAGE_ONLY_PATHS`に登録

共通ルール:
- 選手名等の固有名詞を表示する要素には`translate="no"`を付ける（ブラウザ自動翻訳で名前が壊れるのを防ぐ）
- 会場名は`venues.*`i18nキーを使う。日本語のVENUE_NAMES定数を新規に作らない
- 時刻表示は非ja言語で「JST」を付記する（`t("home.jstNote")`）

### SEO・集客施策の判断軸: SPAアーキテクチャによるクローラー制約
boatAIは`vercel.json`で `/((?!api/).*) → /index.html` のみを行う純粋なクライアントサイドSPAで、SSR・プリレンダリングの仕組みが無い。ページ固有のtitle/meta/OGPタグはReactコンポーネントがマウント後にJSで書き換える方式のため、**JavaScriptを実行しないクローラー（Facebook等）にはページ固有の変更が反映されない**（Googlebotや一部のX(Twitter)クローラーはJSレンダリング対応のため反映される）。

SEO・集客施策を検討・実装する際は、その施策が「JS実行後にしか反映されない変更かどうか」を必ず確認する。検索順位・インデックス精度に関わる施策はReactでの実装で概ね機能するが、SNSシェア時のリンクプレビュー（OGP/Twitterカード）はVercel Edge Functionでのボット判定＋静的HTML返却、またはSSG化が無ければ機能しない。DevTools/Playwrightでの確認はJS実行後の状態であり、非JS実行クローラーの見え方とは異なる点に注意する。詳細・具体例は`docs/reference/seo-architecture-constraints.md`を参照（BOA-161で発覚）。

### コミットメッセージ
形式: `<type>: <日本語の説明>`

| type | 用途 |
|------|------|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `content` | コンテンツ追加・更新 |
| `refactor` | リファクタリング |
| `docs` | ドキュメント |
| `chore` | 雑務・設定変更 |

### 環境変数

| 変数 | 用途 |
|------|------|
| `SUPABASE_URL` | Supabase接続 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase管理者操作 |
| `VITE_SUPABASE_URL` | フロントエンド用Supabase |
| `VITE_SUPABASE_ANON_KEY` | フロントエンド用Supabaseキー |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics |
| `LINEAR_API_KEY` | Linear連携 |
| `LINEAR_TEAM_ID` | LinearチームID |
| `SENDGRID_API_KEY` | メール送信 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google Sheets連携 |
| `GOOGLE_PRIVATE_KEY` | Google Sheets認証 |
| `GITHUB_MERGE_TOKEN` | ブログ記事Draft PRの自動マージ（sns-hub admin、Fine-grained PAT、ADR 0034） |
| `YOUTUBE_CLIENT_ID` | YouTube Data API v3連携（ADR 0035） |
| `YOUTUBE_CLIENT_SECRET` | YouTube Data API v3連携（ADR 0035） |
| `YOUTUBE_REFRESH_TOKEN` | YouTube Data API v3連携、ユーザー自身のOAuth同意で取得（ADR 0035） |

ローカルは `.env.local`、本番は Vercel環境変数で管理。

---

## よく使うコマンド

### 開発
```bash
npm run dev          # 開発サーバー起動
npm run build        # プロダクションビルド
npm run test:e2e     # E2Eスモークテスト（Playwright、e2e/smoke.spec.js）
```

### 日次スクリプト
```bash
node scripts/daily/generate-predictions.js
node scripts/daily/scrape-results.js
node scripts/daily/calculate-accuracy.js
```

### スラッシュコマンド

| コマンド | 用途 |
|---------|------|
| `/create-pr {ブランチ名}` | featureブランチ作成 → PR作成 |
| `/review-pr {PR番号}` | PRレビュー（ルール準拠チェック） |
| `/deploy-preview {PR番号}` | Vercel Preview URL確認 |
| `/analyze-venue {コード}` | 会場別詳細分析 |
| `/collect-stats` | 24会場の統計一括収集 |
| `/daily-report` | 本日の予測結果レポート |
| `/check-env` | 環境変数確認 |
| `/onboarding` | 環境セットアップ確認 |
| `/step1-spec {slug} [チケット番号]` | SDD Step1: 仕様書作成 |
| `/step1-screens {slug}` | SDD Step1: 画面洗い出し（UI機能） |
| `/step2 {slug}` | SDD Step2: システム設計 |
| `/step3 {slug}` | SDD Step3: タスク分解 |
| `/step4 {slug}` | SDD Step4: 次タスク実装 |
| `/codex-review [base]` | Codex (OpenAI) セカンドオピニオンレビュー |
| `/growth-report` | 集客状況レポート（Search Console先行指標の定点観測） |
| `/i18n-growth-report` | 多言語集客状況レポート（GA4需要+Search Console言語パス） |
| `/growth-pdca` | 集客状況の網羅分析→施策立案→小施策は即実行（「集客を分析して」等の自然言語でも起動） |
| `/x-growth-report` | X（Twitter）自体の集客PDCA（自アカウント投稿実績＋競合定点観測、SNS動画運用の一環） |
| `/x-reply-drafts` | X返信下書き生成（リプライ戦略の半自動化、1件ずつ承認） |
| `/tiktok-growth-report` | TikTok自体の集客PDCA（自アカウント投稿実績＋競合定点観測、SNS動画運用の一環） |
| `/note-growth-report` | note自体の集客PDCA（自アカウント記事実績の定点観測） |
| `/growth-monthly-summary` | SEO/X/TikTok集客PDCAの月次統合サマリー（事業ゴールへの進捗確認） |
| `/publish-blog {slug}` | ブログ記事の公開前品質チェック一括実行（note/X展開はsns-hubパイプラインが別途担当） |
| `/channel-algorithm-research {youtube\|tiktok\|note}` | プラットフォーム側のアルゴリズム・成長戦術を深堀り調査し`docs/reference/{platform}-algorithm-and-growth-notes.md`にまとめる（自アカウント実績を見る`/x-growth-report`等とは別役割） |

---

## 会場コード一覧

```
1:桐生, 2:戸田, 3:江戸川, 4:平和島, 5:多摩川, 6:浜名湖,
7:蒲郡, 8:常滑, 9:津, 10:三国, 11:びわこ, 12:住之江,
13:尼崎, 14:鳴門, 15:丸亀, 16:児島, 17:宮島, 18:徳山,
19:下関, 20:若松, 21:芦屋, 22:福岡, 23:唐津, 24:大村
```
