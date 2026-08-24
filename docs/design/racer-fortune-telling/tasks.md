# racer-fortune-telling タスク分解

`docs/design/racer-fortune-telling/spec.md`・`plan.md`に基づくタスク一覧。依存順に並べており、上から順に実装する。

## タスク一覧

- [x] **1. マイグレーション適用: racer_profiles テーブル作成**
  [docs/db-migration/035_create_racer_profiles.sql](../../db-migration/035_create_racer_profiles.sql)（作成済み）をSupabaseに適用する。適用後、`racer_profiles`テーブルへservice role keyで1行INSERT/DELETEし、書き込み権限とRLS（匿名read-only）が設計通りか確認する。

- [x] **2. scripts/lib/statisticalTests.js 実装**
  `normalCDF`・`pearsonCorrelation`・`pearsonPValue`・`proportionZTest`を実装（[ADR 0020](../../adr/0020-fortune-correlation-statistical-method.md)準拠）。`node -e`等で既知の入力（例: 完全相関r=1、独立データr≈0、既知の二項比率）に対する出力を手計算値と突き合わせて正しさを確認する。

- [x] **3. scripts/lib/fortuneTelling/ 共通インターフェース + 西洋占星術**
  `scripts/lib/fortuneTelling/index.js`に`FORTUNE_SYSTEMS`配列の型（`{ id, name, calculateScore(birthDate, targetDate) }`）を定義。`westernAstrology.js`（太陽星座ベーストランジット、0-100スコア）を実装し`FORTUNE_SYSTEMS`に登録する。既存の占いツール（オンライン等）でのサンプル数件と結果を照合する（spec.md受入基準）。

- [x] **4. scripts/lib/fortuneTelling/shichuSuimei.js 実装**
  四柱推命（日柱まで、0-100スコア）を実装し`FORTUNE_SYSTEMS`に登録。サンプル照合を行う。

- [x] **5. scripts/lib/fortuneTelling/kyuseiKigaku.js 実装**
  九星気学（本命星+年盤、0-100スコア）を実装し`FORTUNE_SYSTEMS`に登録。サンプル照合を行う。

- [ ] **6. scripts/lib/fortuneTelling/rokuseiSenjutsu.js 実装**
  六星占術（運気リズム、0-100スコア）を実装し`FORTUNE_SYSTEMS`に登録。サンプル照合を行う。

- [ ] **7. scripts/maintenance/scrape-racer-profiles.js 実装**
  `backfill-racer-ids.js`と同じCLI規約（`--dry-run`/`--limit=N`/`--verbose`）で実装。`race_entries`のdistinct `racer_id`のうち`racer_profiles`未登録分を対象に、boatrace.jpプロフィールページを取得・`dl.list3`をcheerioでパースしupsertする。`dl.list3`が無い場合は失敗としてスキップ。レート制限500ms/リクエスト。`--limit=10`程度の小規模実行で正しく動くことを確認する。

- [ ] **8. 全選手データのスクレイピング実行**
  `scrape-racer-profiles.js`を全件（約1,637人、`--dry-run`無し）で実行し、`racer_profiles`にデータを投入する。実行後、成功/失敗件数と`data/analysis/racer-fortune-telling/profile-scrape-report.json`の内容をユーザーに報告する（spec.md受入基準「成功・失敗の内訳を件数で報告」）。目標成功率の妥当性判断はこの実測値を見てからユーザーが行う（spec.md未確定事項）。

- [ ] **9. scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js 実装**
  `racer_profiles`×`race_entries`（`racer_id IS NOT NULL`）を結合し、`extractDateFromRaceId`で対象日を取得。4占術それぞれのスコアを計算し、複勝圏内フラグ（`race_results.rank1〜3`）との`proportionZTest`（5分位バケット）、ST（`race_start_timings.start_timing`）との`pearsonCorrelation`/`pearsonPValue`を実行して`data/analysis/racer-fortune-telling/correlation-report-{実行日}.json`に保存する。

- [ ] **10. 検証実行・結果レポートの提示**
  `validate-fortune-correlation.js`を全データで実行し、生成された`correlation-report-*.json`を4占術横並びで比較できる形にまとめてユーザーに提示する。有効性の解釈（統計的に有意か）はClaudeが提案し、「占術として採用するか」の最終判断をユーザーに仰ぐ（spec.md受入基準）。ここまででStep1完了とし、Step2（サイトUI化）は別チケットとして扱う。
