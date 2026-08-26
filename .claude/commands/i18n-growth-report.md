# 多言語（i18n）集客状況PDCA

多言語プロジェクト（en/zh-TW/ko、`/{lng}/*`パス）の集客状況を確認し、次言語投資の判断材料を報告する。`/growth-pdca`が日本語SEOで「観測→施策立案→小施策即実行」のフルサイクルを持つのに対し、本スキルはこれまで観測のみに留まっていた（2026-08-26、ユーザー質問「多言語施策のPDCAは回っているか」への調査で発覚。growth-pdcaのCTRギャップ分析に多言語ページも候補として挙がるが見送りが続いたまま放置され、繁體中文・한국어のPVがほぼゼロのまま何ヶ月も具体的な検討がされていなかった）。ステップ5で施策立案・小施策即実行まで踏み込む。

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

5. **施策立案・小施策即実行**（2026-08-26追加）
   上記のデータを踏まえ、次の施策を立案する。判断基準は`/growth-pdca`と同じ「インパクト×工数」マッピングを使う（インパクト: 表示回数上位ページ・複数言語横断で効くか、工数: 何ファイル・何言語に影響するか）。

   - **小施策（即実行）の例**: 既存翻訳ページのtitle/meta description改善（`/growth-pdca`のCTRギャップ分析で多言語ページが「タイトル/メタ改善候補」に挙がった場合、日本語版と同じ変更履歴確認ルールを適用した上でこちらで対応してよい）、会場ガイド（`/{lng}/venues/*`）への観光情報追記、言語間・同言語内の内部リンク追加
   - **大施策（提案のみ）の例**: 未翻訳記事の翻訳追加（featured記事の追加翻訳等）、新規会場・新規言語の展開、5言語目投資判断
   - 即実行の場合も`.claude/CLAUDE.md`の開発フロー（ブランチ作成→実装→セルフレビュー→PR作成）は省略しない

   **低PV言語（zh-TW/ko）の判断基準**: PVが1〜2桁のまま**3ヶ月連続でOrganic Searchからの流入が発生しない場合**、コンテンツ拡充より先に「そもそもその言語圏に需要があるか」の再調査（WebSearch等での市場調査、`i18n_technical_and_demand_audit_2026_08_16`memory参照）を優先する。逆に特定記事・特定ジャンルだけOrganicが発生し始めた場合は、そのジャンルを優先的に拡充する。

   `/growth-pdca`のCTRギャップ分析で多言語ページが「権威・被リンク不足」に分類され見送りが続いている場合、本ステップで改めて「そもそもその言語での需要自体が薄いのか、権威不足だけの問題か」を切り分けて評価する。

## 関連

- 全体の集客状況: `/growth-report`（日本語版含む先行指標の定点観測）
- 多言語化の経緯: 4言語対応完了2026-07-19、会場ガイド英語版24会場化2026-07-27（venue-guide-expansion）、zh-TW横展開2026-07-24（BOA-134）
- セットアップ: `docs/operation/i18n-demand-report.md`
