# 集客状況レポート（先行指標の定点観測）

Search Consoleの検索パフォーマンスから集客状況を確認し、トレンドを報告します。

**PVは遅行指標のため、見るべきはSearch Consoleの掲載順位・表示回数（先行指標）**（2026-07-28の戦略決定より）。

## 実行手順

1. **最新データ取得**
   ```bash
   node scripts/analysis/search-console-report.js
   ```
   `data/analysis/search-console/report-{日付}.json` に保存される（構造: `{generatedAt, days, topQueries, topPages, venuePages}`、各行は`{keys: [クエリ/URL], clicks, impressions, ctr, position}`）。

2. **トレンド分析**（Claudeが実施）
   過去のreport-*.jsonと比較して以下を算出・報告する：
   - **日割り正規化トレンド**: 各レポートの`days`で割った クリック/日・表示回数/日 の推移（レポートごとに集計期間が異なるため日割り必須）
   - **トップクエリの順位変動**: 上位10クエリの`position`を前回レポートと比較（+は下落、-は上昇）
   - **新機能記事・分析ツールの検索状況**: `/winning-technique`・`/blog/*-guide` 配下のclicks/impressions/position（公開直後の記事はimpressionsが1桁でも正常。SEO効果は2〜4週間のタイムラグがある）
   - **会場ガイド（/venues配下）**: venuePagesの状況（インバウンド施策の効果測定）

3. **解釈の注意点**
   - 30日ローリングウィンドウのため、直近の施策効果と過去の減衰が混ざる。施策公開日と照らして解釈する
   - Search Consoleデータは2〜3日の反映ラグがある
   - 悪化トレンドでも新施策公開から2〜4週間はSEO効果の判定期間として扱い、早計な戦略変更をしない
   - 報告は良い数字も悪い数字も正直に。判断が必要な悪化（コアクエリの順位2位以上の下落等）は明示する

4. **note/X投稿の消化状況を必ず報告する**（2026-08-22追加。推測ではなく機械的カウント）
   ```bash
   grep -c "^- \[ \] 投稿済み" note-articles/tweet-drafts.md
   ```
   未消化件数（上記コマンドの出力件数）を必ず報告する。投稿済みのものは`- [x] 投稿済み`にユーザーが更新する運用（`note-articles/tweet-drafts.md`冒頭の注記参照）。投稿滞留は集客の実質的なボトルネック（技術的なSEO対応だけでは解決しない、認知拡大の主要レバー）なので、件数が多い場合は明示的に指摘する

5. **併せて確認すると良いもの**
   - 月次であれば `node scripts/analysis/i18n-demand-report.js`（多言語需要）

## 関連

- 戦略背景: PV頭打ち診断（2026-07-28）→「分析ツールサイト化」転換。定点観測は2〜3週間間隔を推奨
- レポート実装: `scripts/analysis/search-console-report.js`（BOA-140、サービスアカウント認証）
