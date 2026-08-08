# BoatAI プロジェクト - Claude Code 設定

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
4. `npm run build` を実行し、ビルドエラーが無いことを確認する。既存のページ挙動・共通コンポーネント（Header、LanguageSwitcher、`src/components/race/` 等）・ルーティングに影響しうる変更の場合は `npm run test:e2e`（`e2e/smoke.spec.js`、Playwright）も実行し、デグレが無いことを確認する。CI連携はせず、毎回Claude自身が手元で実行する。新しい主要導線を追加した場合はスモークテストにも追記する
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

### 新機能リリース時のブログ記事ルール
2026-07-30時点で「新機能リリースは必ずブログ記事とセットで出す」運用を再開した（4月以降ブログ更新が止まったことがPV下落の一因だったため）。記事作成時は以下を守る。

- **1機能1記事**: 複数機能をまとめた1記事にしない。SEOで異なる検索クエリを個別に拾うため、機能ごとに記事を分ける
- **SEOを意識した文字数**: 1記事あたり本文2,000〜3,500字程度を目安にする（既存記事の分量感を踏襲）。見出し（h2/h3）で構造化し、「何がわかるか」「使い方」「活用のポイント」「実践例」「まとめ」の型を基本にする
- **画像を組み合わせる**: 実際の機能のスクリーンショット（Playwrightで撮影したもので良い）を最低1枚、記事内に配置する。装飾目的の画像は不要
- 用語・文体は `.claude/rules/code-style.md`（「競艇」使用禁止等）に従う
- **「よくある質問」セクションを設ける**: `BlogPost.jsx`が`## よくある質問`セクションを自動検出してFAQPage構造化データを生成する（`src/utils/blogFaqSchema.js`）ため、`### 質問文` + 回答段落の形式でFAQセクションを含めると追加コード不要でSEO/AI引用対策になる
- **note.com向け下書きを同時生成する（2026-08-04〜）**: 新規ブログ記事作成時は`python3 convert_to_note_markdown.py public/blog/{slug}.md`を実行し、出力された`{slug}_note.md`を`note-articles/{slug}.md`にリネームして配置する。note.comへの実際の投稿・公開は自動化できない（公開APIが存在しない）ため、生成した下書きをユーザーがnoteエディタに貼り付けて手動公開する
- **Xツイート下書きも同時生成する（2026-08-04〜）**: 新規ブログ記事作成時は`node scripts/generate-tweet-draft.js {post-id}`を実行し、`note-articles/tweet-drafts.md`に下書きを追記する。投稿はユーザーが内容を確認の上、手動でXに行う（2025-12時点の同種の取り組みが下書き作成後1週間で止まった実績があるため、「記事公開のたびに機械的に生成する」運用に固定し、単発の週次計画には戻さない）
- **note/X投稿のリマインドを毎回行う（2026-08-08〜）**: ブログ記事を作成したPRの完了報告・マージ確認には、必ず「note/Xへの投稿依頼」を含める。具体的には①note下書きのファイルパス（`note-articles/{slug}.md`）②tweet-drafts.md内の該当セクション（日付見出し）③「noteエディタに貼り付けて公開→対応ツイートをXに投稿」の手順を明示する。リマインドなしで記事だけ公開して投稿が溜まった実績（2026-07-30〜08-08の14記事が未投稿で滞留）があるため、下書き生成だけで完了とせず、リマインド提示までを記事作成タスクの完了条件とする

### 新規ページ追加時のsitemap登録（必須）
2026-07-31時点で、`/winning-technique`が`scripts/generate-sitemap.js`への追加漏れで長期間sitemap.xmlに未掲載、Google未インデックスのままだった実績あり（Search Console実データで検索クリック・表示回数0件と確認）。同じ漏れを繰り返さないため、新しい静的ページ・ルート（`AppRouter.jsx`に`<Route>`を追加するもの）を実装したら、**同じPRで**`scripts/generate-sitemap.js`の`staticPages`（多言語対応ページは`LOCALIZED_PAGES`/`LANGUAGE_ONLY_PAGES`）にも追記する。ページ単体の実装が完了した時点で完了とせず、sitemap反映まで含めて1タスクとして扱う。

sitemap変更は`.github/workflows/update-sitemap.yml`で毎日自動反映され、変更があった場合はSearch Consoleへの再送信（`scripts/submit-sitemap.js`）も自動実行される。ただし個々のページの即時インデックス登録を保証するものではない（詳細は`docs/operation/search-console-report.md`）。

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

---

## 会場コード一覧

```
1:桐生, 2:戸田, 3:江戸川, 4:平和島, 5:多摩川, 6:浜名湖,
7:蒲郡, 8:常滑, 9:津, 10:三国, 11:びわこ, 12:住之江,
13:尼崎, 14:鳴門, 15:丸亀, 16:児島, 17:宮島, 18:徳山,
19:下関, 20:若松, 21:芦屋, 22:福岡, 23:唐津, 24:大村
```
