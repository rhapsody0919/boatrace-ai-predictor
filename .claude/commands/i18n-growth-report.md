# 多言語（i18n）集客状況レポート

多言語プロジェクト（en/zh-TW/ko、`/{lng}/*`パス）の集客状況を確認し、次言語投資の判断材料を報告します。

## 実行手順

1. **GA4需要データ取得**
   ```bash
   node scripts/analysis/i18n-demand-report.js --days=30
   ```
   `data/analysis/i18n-demand/report-{日付}.json` に保存される。
   構造: `{generatedAt, days, byLanguage: {lng: {pv, users}}, shareOfPv, languageSwitches, byCountry, bySource}`

2. **トレンド分析**（Claudeが実施）
   過去の`data/analysis/i18n-demand/report-*.json`と比較して以下を報告する：
   - **言語別PV・ユーザーの推移**: byLanguageの日割り比較（レポート間で`days`が異なる場合があるため）
   - **PVシェアの推移**: shareOfPv（多言語版が全体の何%を占めるか）
   - **国別内訳**: byCountryで「日本国内からの外国語アクセス」（在日外国人）と「海外アクセス」を区別する
   - **流入チャネル**: bySourceでOrganic Search比率を確認（SEO施策の効果はOrganicの伸びで測る。AI Assistantチャネルの有無はGEO対策の効果指標）

3. **Search Console側の言語パスSEO**（Claudeが実施）
   最新の`data/analysis/search-console/report-*.json`（無ければ`node scripts/analysis/search-console-report.js`を実行）から、`/en/`・`/zh-TW/`・`/ko/`を含むページ行を抽出し：
   - 言語別の合計clicks/impressions
   - 会場ガイド（`/{lng}/venues/*`）の掲載順位分布（インバウンド施策=venue-guide-expansionの効果測定）
   - 前回レポートとの比較

4. **判断基準・解釈の注意点**
   - **5言語目の投資判断**: 既存の合意（2026-07時点）では、5言語目追加は「翻訳リソースの遅延ロード化とLanguageSwitcherのドロップダウン化」が前提条件。byCountryで特定言語圏からの英語版アクセスが継続的に多い場合に検討する
   - 多言語版のSEOは日本語版よりさらにタイムラグが大きい（hreflang評価・国別インデックス）。月次程度の観測間隔で十分
   - zh-TW/koのPVが1桁でも、絶対数の小ささより「トレンドが伸びているか」「Organicが発生し始めたか」を見る
   - 会場ガイドは「訪日観光客が現地で検索する」ユースケースのため、旅行シーズン（春・秋）に季節性がある

## 関連

- 全体の集客状況: `/growth-report`（日本語版含む先行指標の定点観測）
- 多言語化の経緯: 4言語対応完了2026-07-19、会場ガイド英語版24会場化2026-07-27（venue-guide-expansion）、zh-TW横展開2026-07-24（BOA-134）
- セットアップ: `docs/operation/i18n-demand-report.md`
