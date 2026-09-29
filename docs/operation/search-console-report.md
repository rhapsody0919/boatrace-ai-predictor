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

## SEOワード戦略のKPI（集客レーン、2026-09-29〜）

`search-console-report.js` は毎回、最後に「SEOワード戦略のKPI」を出力し、JSON の `seoKpi` に保存する。集計ロジックは `scripts/lib/seoKeywordKpi.js`、その検証は `scripts/maintenance/verify-seo-keyword-kpi.js`（CI）。

| 出力 | 中身 |
|------|------|
| サイト全体（週次） | 直近12週のクリック/日・表示/日・CTR・順位。週は月曜始まり |
| 主要クエリ（週次） | `TRACKED_QUERIES`（ボートai、ボートレースai、boatai、競艇ai予想 無料、競艇ai、競艇 ai 予想、龍神レーダー）。**KPIはこの単位で判定する** |
| クエリのクラスタ | 旧名系・会場名×AI予想・今日系・AI予想一般・予想（非AI）・その他。名前の出るクエリのクリックとサイト合計も並べる |
| 着地ページ | トップ `/`・会場ページ・`/today`・ブログ・その他・多言語の絶対数 |

### 読み方の注意

- **比較の基準は2026-08-31以降の週**。7/7〜8/18 は Googlebot に `/` の英語版を返していたバグの影響期間（0213b2e5e で修正）で、その谷と比べると改善が過大に見える
- **旧名系は一般のAI予想クエリと分けて見る**。8/20 のリブランドで title から「BoatAI（ボートアイ）」が消え、「ボートai」「ボートレースai」は順位ほぼそのままで CTR が約1/3になった
- **クラスタ合計のCTRで判定しない**。匿名化クエリの比率が期間で変わる（名前の出るクエリのクリックは 61〜75%）
- 端の週（7日未満）には印が付く。前後比較では使わない
- SG・G1 開催週は会場名×AI予想の表示が跳ねる（桐生SGの週に「桐生競艇予想 ai」が1週で1,489表示）。季節要因として扱う

### 施策の投入日台帳

`data/analysis/search-console/seo-measures.json` に、施策（`kind: measure`）と外部要因・障害（`kind: event`）の日付を記録する。レポートは該当する週に `← id` を付けて出す。SEO施策のPRをマージしたら、本番に反映された日を1行足す。

### 目標値（期限 2026-11-30、中間 2026-10-31）

| 種別 | 指標 | 現状 | 目標 |
|------|------|------|------|
| 先行 | 「競艇ai予想 無料」「競艇ai」の順位 | 6.4／6.3（9/21週） | 5.0以下 |
| 先行 | 会場ページ（/venue/*）の表示 | 90日で約30 | SG・G1開催週に500/週 |
| 先行 | /today の表示 | 90日で2 | 300/28日 |
| 遅行 | サイト全体クリック/日 | 68.3（9/21週） | 85 |
| 遅行 | トップ以外への着地クリック（絶対数） | 203/30日 | 400/28日 |
| 遅行 | オーガニック新規ユーザー/週（GA4） | PR#935 修正後に基準を取り直す | 基準比 +50% |
| 参考 | 「ボートai」「ボートレースai」のCTR | 6.5%／2.4%（9/21週） | 目標なし（推移だけ見る） |

2026-09-29 のユーザー判断で決めた方針:

- **旧名（BoatAI）の併記はしない**（title・JSON-LD の alternateName とも）。旧名系クエリは施策の対象外なので、目標を置かない参考値にした。取り戻す施策をしない場合に自然にどう推移するかを見るため、`TRACKED_QUERIES` からは外していない
- 施策の優先順位は、トップ本文の強化 → SG・G1 開催場の会場ページ → /today の今日系。会場データ系・得点率は、中間レビュー（10/31）で判断する
- サイト全体の目標は、当初案の100から85に下げた。6/29週（115/日）との差のうち約30/日は旧名系が占めており、その分を回収しない前提にしたため
- 「競艇」は画面に表示されない場所（meta description・keywords・OGP）にだけ使う。`<title>` に入れるかどうかはユーザーの確認待ち

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
