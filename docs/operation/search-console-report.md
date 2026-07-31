# Search Console 検索パフォーマンスレポート 運用ガイド

venue-guide-expansion（会場別ビジターガイド全会場化・SEOフル拡充、BOA-140）の計測基盤。検索クエリ・ページ別の掲載順位・クリック率（CTR）を取得し、コンテンツ・技術SEO施策の効果を測る。

## 初回セットアップ

### 1. Search Console へのプロパティ登録確認

`https://www.boat-ai.jp/` が Search Console に登録済みであることを確認する（未登録の場合は先にプロパティを追加し、所有権を確認する）。

### 2. Google Cloud プロジェクトで Search Console API を有効化

サービスアカウントのプロジェクトで **Google Search Console API** が有効になっている必要がある（GA4/Sheets連携で既に有効化された別のAPIとは無関係。これを見落とすと後述の権限付与を正しく行っても`accessNotConfigured`エラーで失敗する）。

1. https://console.developers.google.com/apis/library/searchconsole.googleapis.com を開く（サービスアカウントが属するプロジェクトを選択した状態で）
2. 「有効にする」をクリック
3. 反映まで数分かかる場合がある

### 3. サービスアカウントへの権限付与

GA4 連携と同じサービスアカウント（`credentials/google-service-account.json` の `client_email`）を使う。GA4 とは付与画面・権限モデルが異なる点に注意。

1. Search Console の対象プロパティを開く
2. 「設定」→「ユーザーと権限」
3. 「ユーザーを追加」で `credentials/google-service-account.json` の `client_email`（GA4 と同一のサービスアカウント。権限エラー時はスクリプトのエラーメッセージにも表示される）を入力
4. 権限は「制限付き」（読み取りのみで十分）

この操作は対話ターミナルでの実施が必要（GA4 導入時と同様）。

### 4. 環境変数の設定

`.env.local` に追加。**プロパティの種類によって書式が異なる**（Search Console設定画面のURLに `resource_id=sc-domain%3A...` と出ていればドメインプロパティ、`resource_id=https%3A%2F%2F...` と出ていればURLプレフィックスプロパティ）。

```
# ドメインプロパティ（例: boat-ai.jp 全体を登録している場合）
SEARCH_CONSOLE_SITE_URL=sc-domain:boat-ai.jp

# URLプレフィックスプロパティ（例: https://www.boat-ai.jp/ を登録している場合、末尾スラッシュ必須）
SEARCH_CONSOLE_SITE_URL=https://www.boat-ai.jp/
```

書式を間違えると「アクセス権限がありません」という誤ったエラーになるため要注意（実際にドメインプロパティにURLプレフィックス形式を指定してハマった経緯がある）。

## レポートの実行

```bash
node scripts/analysis/search-console-report.js           # 直近30日
node scripts/analysis/search-console-report.js --days=90 # 直近90日
```

出力:
- コンソール: 検索クエリ上位・ページ別検索パフォーマンス上位・会場ガイドページ（`/venues`配下）の検索パフォーマンス
- JSON: `data/analysis/search-console/report-YYYY-MM-DD.json`（推移比較用）

Search Console の性質上、直近2-3日分のデータは未確定のため集計対象から自動的に除外される。

## 会場ガイド拡充の効果測定

venue-guide-expansion の数値目標（`docs/design/venue-guide-expansion/spec.md`）と合わせて、以下を月次で確認する。

| 指標 | 見るポイント |
|------|------------|
| `/venues`配下ページのOrganic Search掲載順位 | 会場追加・コンテンツ拡充後に改善しているか |
| `/venues`配下ページのCTR | タイトル・descriptionの検索結果での訴求力 |
| 検索クエリ上位 | 想定していた観光系クエリ（"how to get there"等）で実際に流入しているか |

GA4側のPV推移（`scripts/analysis/i18n-demand-report.js`）と合わせて総合的に判断する。

## sitemap自動再送信（BOA-152関連: SEO未対応の是正、2026-07導入）

`/winning-technique`がsitemap.xmlに一度も掲載されておらず未インデックスだった問題を受け、
`.github/workflows/update-sitemap.yml`にsitemap変更時のGoogleへの再送信ステップを追加した
（`scripts/submit-sitemap.js`、Search Console API の`sitemaps.submit`を使用）。

**個々の新規ページの即時インデックス登録を保証するものではない**（それにはGoogleの
Indexing APIが必要だが、求人情報・ライブ配信ページ専用で一般ページへの使用は規約違反となる
ため使用しない）。あくまで「sitemapが変わったのでGoogleに再クロールを促す」正規の手段。

### 追加セットアップ（このステップだけ既存のレポート機能とは別に必要）

1. **サービスアカウントの権限を「フル」に変更**（上記レポート機能は「制限付き」で足りるが、
   sitemap再送信は書き込み系APIのため「フル」権限が必須）
   - Search Console の対象プロパティ →「設定」→「ユーザーと権限」
   - `credentials/google-service-account.json`の`client_email`のアクセスレベルを「制限付き」→「フル」に変更
   - この操作はGoogleアカウント側の設定のため、必ず対話ターミナル（人間）が実施する
2. **GitHub Secretsに以下を追加**（リポジトリの Settings → Secrets and variables → Actions）
   - `GOOGLE_SERVICE_ACCOUNT_KEY`（`update-google-sheets.yml`と共用、未設定なら追加）
   - `SEARCH_CONSOLE_SITE_URL`（`.env.local`と同じ値）

権限変更前は`scripts/submit-sitemap.js`が権限エラーで失敗するが、CI上は`update-sitemap.yml`の
該当ステップが失敗するだけで、sitemap.xml自体の更新・デプロイには影響しない。
