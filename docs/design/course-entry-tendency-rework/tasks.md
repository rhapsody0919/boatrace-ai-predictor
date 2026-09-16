# 進入コース遷移傾向の再構築 tasks

対応: [spec.md](./spec.md) / [plan.md](./plan.md) / [screens.md](./screens.md) / [ADR-0064](../../adr/0064-course-entry-tendency-reuse-existing-infra.md)

## 着手順序

FR-1（データ基盤・BOA-284本体）→ FR-2（選手ページ用クライアント集計）→ FR-3（出走表統合、最優先のUI）→ FR-4・FR-5（選手ページ・分析タブ、並行可）。各タスク完了後、`.claude/CLAUDE.md`の「実装完了後の自動レビュー」（`/code-review`・ビルド確認・E2E）を都度実施する。

---

## Phase 1: データ基盤（FR-1）

- [ ] **Task 1: `calculateCourseEntryTendency()`のデータソース切り替え**（`scripts/analysis/aggregate-racer-stats.js`）
  - `race_results`のselect列を`course_1〜6`→`actual_course_1〜6`に変更
  - `result[`course_${c}`]`参照を`result[`actual_course_${c}`]`に変更
  - 直近12ヶ月ウィンドウを追加（`race_id`の日付部分で絞り込み）
  - 最小サンプル数`MIN_COURSE_SAMPLES = 5`未満の枠番を除外するロジックを追加
  - 受入基準: [spec.md](./spec.md) FR-1

- [ ] **Task 2: FR-1の精度検証**（実装・DB書き込みは伴わない、検証のみ）
  - `scripts/analysis/analyze-indicator-predictive-power.js`でcourseRateの予測力を切り替え前後で比較
  - `scripts/analysis/backtest-course-rate-only.js`で的中率・回収率を切り替え前後で比較
  - `.claude/rules/analysis.md`のデータ精度検証パターンに従い、実選手2〜3名を手動スポットチェック
  - 結果をまとめてユーザーに報告し、Task 3着手の要否を確認する（**着手前に必ずユーザー確認**、判断が分かれる可能性がある点のため）

- [ ] **Task 3: （条件付き）モデル反映**
  - Task 2の検証結果が良好な場合のみ着手。悪化していた場合はスキップし、reweighting要否を別途相談する
  - 本番`racer_aggregated_stats.course_entry_tendency`の再計算バッチを実行（既存の`aggregate-racer-stats.js`実行フローに乗せる）
  - `unifiedModel.js`の`INDICATOR_WEIGHTS`は変更不要（[plan.md](./plan.md)参照、絶対値のみ変わり重み自体は再計算不要という判断のため。ただしTask 2の結果次第でこの判断自体を見直す可能性はある）
  - **本番反映の実行はユーザーの明示的な承認を得てから行う**（[spec.md](./spec.md)未確定事項参照）

## Phase 2: データ基盤（FR-2）

- [ ] **Task 4: 選手ページ用クライアント側集計の追加**（`src/services/supabaseDataService.js`）
  - `getRacerRaceHistory()`の`race_results`select列に`actual_course_1〜6`を追加
  - 返却行に`actualCourse`フィールドを追加（`calculateCourseEntryTendency()`と同じ導出ロジック）
  - 新規純関数`aggregateRacerCourseEntryStats(history, venueCode, boatNumber, raceGrade, raceStage)`を追加（`aggregateRacerVenueBoatStats`と同じフィルタパターン、直近12ヶ月・`MIN_COURSE_SAMPLES=5`）
  - 受入基準: [spec.md](./spec.md) FR-2、[plan.md](./plan.md)

## Phase 3: レース出走表への統合（FR-3、最優先UI）

- [ ] **Task 5: データ出走表に「前づけ傾向」行を追加**
  - `src/components/race/raceIndicators.jsx`に新規行`maezuke`を追加（表示値の優先順位: 対象10会場は`venue_entry_course_stats`優先、無ければ`racer_aggregated_stats.course_entry_tendency`の会場別行→全国集計行の順にフォールバック、それも無ければ「データ不足」表示）
  - `src/components/race/termHints.js`に`maezuke`のツールチップ文言を追加
  - `src/locales/{ja,en,zh-TW,ko}/common.json`に`dataTable.rowMaezuke`/`review.cols.maezuke`を4言語同一PRで追加（`docs/reference/i18n-glossary.md`準拠、用語「前づけ」の訳語が未確定ならglossary追記が先）
  - `DataRaceTable.jsx`本体の変更は不要（行定義追加のみで自動反映）
  - 受入基準: [spec.md](./spec.md) FR-3

## Phase 4: 選手ページ（FR-4）

- [ ] **Task 6: 概要バッジの追加**
  - `src/components/racer/RacerCourseEntryBadge.jsx`を新規作成（`RacerGradeBadge.jsx`と同じstateless設計）
  - `src/components/racer/RacerCourseEntryBadge.css`を新規作成（前づけ傾向用の新規配色トークン、グレードバッジの配色は転用しない）
  - `src/components/racer/index.js`のbarrel exportに追加
  - `RacerPerformanceStats.jsx`の`.racer-stat-cards-grid`（「平均ST」カード付近）にバッジを統合
  - バッジ判定閾値を実データ分布を見て確定する
  - 受入基準: [spec.md](./spec.md) FR-4（概要バッジ部分）

- [ ] **Task 7: 詳細セクション「進入コース遷移傾向」の追加**
  - `RacerPerformanceStats.jsx`に新規セクションを追加（「STの推移」と「レース一覧」の間、既存4セクションと同じ`h3`見出し＋条件付きレンダリングパターン）
  - Task 4の`aggregateRacerCourseEntryStats()`を呼び出し、現在のフィルタ状態（4軸）で絞り込んだ結果を表示
  - `RacerPerformanceStats.css`にレイアウト調整を追加（既存セクションのクラスを流用）
  - 受入基準: [spec.md](./spec.md) FR-4（詳細セクション部分）

## Phase 5: 分析タブ新設（FR-5）

- [ ] **Task 8: `RacerMaezukeChart.jsx`の新規実装**
  - `src/components/analysis/RacerMaezukeChart.jsx`を新規作成（`RacerTechniqueProfileChart.jsx`と同じ「会場選択→レース選択→出走6選手の内訳表示」パターン）
  - `racerStatsMap`（`racer_aggregated_stats`、会場別行→全国集計行の順にフォールバック）から6選手分の`course_entry_tendency`を取得して表示
  - 既存の`MotorConditionChart.css`等の流用を優先、新規CSSは列構成差分のみ
  - `src/components/analysis/index.js`のbarrel exportに追加
  - 受入基準: [spec.md](./spec.md) FR-5

- [ ] **Task 9: `/winning-technique`へのタブ追加**
  - `src/pages/WinningTechniqueAnalysis.jsx`の`TAB_KEYS`に`"maezuke"`を追加、import・レンダー分岐を追加
  - `src/locales/{ja,en,zh-TW,ko}/common.json`に新規タブのラベル・説明文を4言語同一PRで追加
  - `BLOG_LINKS`へのエントリ要否を判断する
  - 受入基準: [spec.md](./spec.md) FR-5

## Phase 6: 完了確認

- [ ] **Task 10: 全体の完了監査**
  - `tasks.md`の全チェックボックスと実際のコミット・コードを突き合わせる（`.claude/rules/sdd-workflow.md`参照）
  - `/code-review`実施、`npm run build`・`npm run test:e2e`実行
  - BOA-284・BOA-337・BOA-170（Linear）の状態を更新し、実装内容・検証結果をコメントする
