# ADR 0004: Search Console レポートスクリプトの構成

## ステータス
採用

## 背景
spec.mdの要件7で、Google Search Console連携により検索順位・CTRを計測できるようにする。既存の`scripts/analysis/i18n-demand-report.js`がGA4 Data APIをGoogleサービスアカウント経由で叩く前例があり、認証まわり（dotenv読み込み・サービスアカウントJWT生成）がほぼ同一のロジックになる見込み。

## 決定
新規スクリプト`scripts/analysis/search-console-report.js`を追加し、`i18n-demand-report.js`と同じGoogleサービスアカウント（`credentials/google-service-account.json`）を共用する。認証部分（dotenv読み込み・JWTクライアント生成）は`scripts/lib/googleServiceAuth.js`（新規）に共通化し、両スクリプトから呼び出す（`.claude/rules/analysis.md`の「共通ユーティリティはscripts/lib/に切り出す」に準拠）。出力は`data/analysis/search-console/report-{日付}.json`に保存し、既存の`i18n-demand-report.js`の出力パターンを踏襲する。

## 却下した選択肢
- **`i18n-demand-report.js`に統合**: スクリプト数は減るが、GA4（利用者側の言語別トラフィック分析）とSearch Console（検索エンジン側の掲載順位・CTR分析）という異なる関心事を1ファイルに混在させることになり、既存の「分析ごとにスクリプトを分ける」設計方針から外れる
- **Search Console Data APIのBigQueryエクスポート + Supabase経由での参照**: 小規模なレポート用途に対して過剰な構成（YAGNI違反）。既存の月次レポートスクリプト群と整合しない

## 影響
- ユーザー側の作業として、Search Consoleの「設定 > ユーザーと権限」からサービスアカウントのEmail（GA4と同一）を「制限付き」ユーザーとして追加する必要がある（GA4のIAM閲覧者権限とは付与画面・権限モデルが異なる点に注意。GA4導入時と同様、対話ターミナルでの実施が必要）
- `scripts/lib/googleServiceAuth.js`抽出に伴い、`i18n-demand-report.js`も軽微なリファクタリングが必要（動作は変えない）
- 新しい`googleapis`のスコープ（`webmasters.readonly`）を追加する
