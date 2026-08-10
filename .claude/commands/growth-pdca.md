# 集客状況PDCA（網羅分析→施策立案→実行）

Search Console・GA4・競合（kyoteibiyori）動向・キーワード需要を横断的に分析し、次に打つべき施策を立案する。
`/growth-report`・`/i18n-growth-report`が「定点観測レポート」に留まるのに対し、このスキルは**分析結果から具体的な施策を立案し、小さな施策はその場で実行する**ところまでを担う。

「集客を分析して」「集客状況どう？」等の自然言語依頼でもこのスキルを起動する。

## 実行手順

### 1. Search Console（先行指標）

```bash
node scripts/analysis/search-console-report.js
```

`data/analysis/search-console/report-{日付}.json`と過去レポートを比較し、日割りトレンド・トップクエリの順位変動・新機能記事/`/winning-technique`の検索状況・会場ガイド（`/venues`配下）の状況を確認する。詳細な解釈手順・注意点は`/growth-report`を参照。

### 2. GA4（多言語利用状況含む）

```bash
node scripts/analysis/i18n-demand-report.js --days=30
```

言語別PV・チャネル別流入・国別内訳を確認する。詳細な解釈手順は`/i18n-growth-report`を参照。

### 3. 競合（kyoteibiyori）新機能動向

```bash
node scripts/analysis/scrape-kyotei-vup.js
```

前回チェック日以降に追加された新規項目のみを抽出する（前回チェック日はmemory `vup_feature_analysis_skill.md`を参照）。boatAI未実装かつ既存データで実現可能な候補が無いか確認する。`docs/proposal/competitor-kyoteibiyori/`の実装優先度メモも参考にする。

**過去の教訓（`vup_feature_analysis_skill.md`より）**:
- kyoteibiyoriの指標名とboatAI側の集計テーブルの実際の定義（分母が何か）は一致するとは限らない。「率」系の指標を施策化する前に、該当カラムのテーブル定義コメントで分母を必ず確認する
- 新規スクレイピングが必要な候補（boatAIに無いデータ）は実現性が低いため早期に見切りをつける
- `race_results.payout_trifecta`は実態3連複・`payout_trio`が実態3連単（DB列名と英語名が歴史的経緯で逆転、`scripts/lib/payoutCalculator.js`参照）。配当額を扱う施策は必ず確認する

### 4. キーワード需要調査（コア + 地域密着）

WebSearch等で以下2軸を調査する。

**コアキーワード軸**: 「ボートレース AI予想」等の既存コアクエリ（Search Consoleのtop queries）周辺の関連キーワード・検索トレンドを調査し、コンテンツで拾えていない需要が無いか確認する。

**地域密着キーワード軸**: 24会場（桐生・戸田・江戸川・平和島・多摩川・浜名湖・蒲郡・常滑・津・三国・びわこ・住之江・尼崎・鳴門・丸亀・児島・宮島・徳山・下関・若松・芦屋・福岡・唐津・大村）それぞれについて、「{会場名} 観光」「{会場名} 周辺」「{会場名} グルメ」等、ボートレース目的に限らない検索需要を調査する。目的は、ボートレース会場周辺に来ている観光客等が検索から会場ガイド（`/venues/{slug}`）に辿り着ける導線を強化すること。既存の会場ガイドコンテンツと突き合わせ、観光情報が薄い・キーワードカバレッジが弱い会場を特定する。全24会場を毎回調査すると重いため、Search Consoleのimpressionsが伸びている会場や、直近未調査の会場から優先的に数会場ずつ回す。

### 5. 統合分析・施策立案

上記4つを踏まえ、次の施策を立案する。

**小施策（即実行）の例**:
- 既存ページのtitle/meta description改善
- 内部リンク追加
- 既存記事への軽微な追記（観光情報の追加等）
- sitemap反映漏れの修正

即実行の場合も`.claude/CLAUDE.md`の開発フロー（ブランチ作成→実装→セルフレビュー→PR作成）は省略しない。「即実行」は着手前のユーザー承認を待たないという意味であり、レビュー・マージ確認プロセスをスキップする意味ではない。マージ確認はサマリー+確認観点を添えて都度提示する（`feedback_merge_confirmation_summary`参照）。

**大施策（提案のみ）の例**:
- 新機能開発 → `/analyze-vup-feature`→`/create-vup-ticket`のVUPループに乗せる
- 新規ブログ記事の執筆
- 会場ガイドへの大規模な観光コンテンツ拡充

大施策は具体案を会話で提示し、実行はユーザー判断を仰ぐ。新機能はLinearチケット化（VUPループと同じ運用）。

## 判断基準（小 / 大）
- 小 = 1ファイル程度の軽微な変更、既存パターンの踏襲、リスクが低いもの
- 大 = 新規ページ・新規機能・新規コンテンツ作成、設計判断を伴うもの
- 迷ったら大側に倒して提案に留める

## 解釈の注意点（`/growth-report`・`/i18n-growth-report`から継承）
- 30日ローリングウィンドウのため、直近の施策効果と過去の減衰が混ざる。施策公開日と照らして解釈する
- Search Consoleデータは2〜3日の反映ラグがある
- 悪化トレンドでも新施策公開から2〜4週間はSEO効果の判定期間として扱い、早計な戦略変更をしない
- 報告は良い数字も悪い数字も正直に。判断が必要な悪化（コアクエリの順位2位以上の下落等）は明示する

## 関連

- `/growth-report`: Search Console単体の定点観測（このスキルは内包しつつ施策立案まで踏み込む）
- `/i18n-growth-report`: GA4多言語需要の定点観測（同上）
- `/analyze-vup-feature`, `/create-vup-ticket`: 大施策（新機能）の分析・チケット化
- 会場ガイド拡充の経緯: memory `venue_guide_expansion_project`
