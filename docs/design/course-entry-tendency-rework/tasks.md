# 進入コース遷移傾向の再構築 tasks

対応: [spec.md](./spec.md) / [plan.md](./plan.md) / [screens.md](./screens.md) / [ADR-0064](../../adr/0064-course-entry-tendency-reuse-existing-infra.md) / [ADR-0065](../../adr/0065-venue-course-entry-baseline-precomputed-table.md)

## 着手順序

FR-1/FR-2/FR-6（データ基盤、FR-1のモデル反映は検証の結果不要）→ FR-3（出走表統合、最優先のUI）→ FR-4・FR-5（選手ページ・分析タブ、並行可）。各タスク完了後、`.claude/CLAUDE.md`の「実装完了後の自動レビュー」（`/code-review`・ビルド確認・E2E）を都度実施する。掲載場所は[BOA-348](https://linear.app/boat-ai/issue/BOA-348)で見直すため、UI系タスク（Task 8〜11）の着手前にBOA-348の結論を確認する。

---

## Phase 1: データ基盤（FR-1、BOA-284）

- [x] **Task 1: `calculateCourseEntryTendency`を`actual_course_1〜6`に切り替える**（`scripts/analysis/aggregate-racer-stats.js`）
  - 出力を新しい形（`since`・`all`・`venues`、回数と走数`n`、[plan.md](./plan.md)参照）に変更し、直近12ヶ月ウィンドウを追加。会場別の内訳は同じ関数内で1パスで作る。走数の下限は適用しない
  - 共通ロジックは`scripts/lib/courseEntryTendency.js`（`actualCourseOf`・`buildCourseEntryTendency`）。回帰テストは`npm run verify:course-entry-tendency`
  - 受入基準: [spec.md](./spec.md) FR-1・FR-2
  - 完了（2026-09-19、[PR #704](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/704)）: 本番データ（読み取りのみ、`--dry-run`）で選手3名（3072・3473・4444）の枠番別コース回数をSQLの手計算と突き合わせ、完全一致を確認した。**実装前に、設計ドキュメントの`actual_course_N`の添字の説明が誤っていた（正しくは添字=艇番、値=進入コース）ことに気づき、spec・plan・ADR・マイグレーション067・分析数値を訂正した**（旧列`course_1〜6`は添字=コース・値=艇番で向きが逆）
  - **範囲を縮小した**: 当初は`course_1〜6`を読む4関数すべてを切り替える予定だったが、Task 2の結果、`course_entry_tendency`以外の3関数（`course_race_counts`・`attack_distribution`・`defense_distribution`）は現行維持とした

- [x] **Task 2: FR-1の精度検証**（検証のみ、DB書き込みは伴わない）
  - `scripts/analysis/compare-course-rate-sources.js`（新規）: 既存の`analyze-indicator-predictive-power.js`等は現在の集計で過去を評価するためリークがある。日ごとに「その日より前のデータだけ」で集計を更新するウォークフォワードで、2026-03-01以降の29,421レースを比較した。結果は`data/analysis/course-entry-tendency/course-rate-comparison-2026-09-19.json`
    - 予測力（2着艇が上位2位に入る割合）: 切り替え前61.3%、切り替え後61.1〜61.3%、「実際に入ったコースが分かる」と仮定した上限でも61.6%。ほぼ変わらない
    - 複勝予想（上位2艇）: 的中率は切り替え前91.4%→切り替え後91.0%（-0.42±0.10pt、有意）、回収率は97.7%→95.6%（-2.1±1.3pt、有意でない）。2026-07-01以降のみでも同じ向き（的中-0.39±0.15pt、回収-0.8±0.6pt）
    - 参照側を「最も入りやすいコースで引く」に変えても改善しない（的中-0.36pt）。カバー率は枠番で引く場合に99.8%→98.8%に下がる
  - 結論: courseRateの実態は「枠番の強さ」で、正しい進入コースに直しても予測力は上がらず、わずかに下がる。BOA-284の「汚染を直せば精度が上がる」という前提は検証できなかった
  - 影響範囲: `course_race_counts`は選手ページの「枠番別成績（全会場計）」表にも使われ、切り替えると「枠番」と表示した表が実進入コース別に変わる。`attack_distribution`・`defense_distribution`は展開予測の入力で、切り替えの影響は未検証
  - 判断（2026-09-19ユーザー承認）: `course_entry_tendency`のみ切り替え、他の3関数は現行維持。BOA-284は「効果が確認できなかったため現行維持」とする。展開予測（attack/defense）の切り替え検証と、`courseRate`の説明文言の是正は別チケット

- ~~Task 3: 本番反映（`course_race_counts`の再計算・`INDICATOR_WEIGHTS`の見直し）~~: Task 2の結果、モデル入力を変更しないため不要（取り消し）。`course_entry_tendency`の再計算は夜間バッチ（`aggregate-stats.yml`）に乗る（既存の読み手が無いため影響なし）

## Phase 2: データ基盤（FR-6、会場平均）

- [ ] **Task 4: 江戸川の値が実態かを確認する**
  - Kファイルの実データ（江戸川、数レース分）と`actual_course_N`を突き合わせる。他会場の枠外進入率が5〜17%なのに江戸川だけほぼ0%
  - 実態でなく取得由来の問題なら、原因を特定して別チケットで起票する。修正までは江戸川の会場平均を非表示にする

- [ ] **Task 5: 会場平均の事前集計を実装する**
  - `docs/db-migration/067_venues_course_entry_baseline.sql`を本番に適用（**ユーザーの対話ターミナルで実行**。自動モードでは本番DBへのスキーマ変更ができない）
  - `scripts/maintenance/update-venue-course-entry-baseline.js`を新規作成（24会場について`compute_venue_course_entry_baseline`を呼び`venues.course_entry_baseline`を更新、`update-venue-stats.js`と同じ構成）
  - `.github/workflows/aggregate-stats.yml`にステップを追加
  - `supabaseDataService.js`に会場平均の取得関数（全会場を1回で取得しキャッシュ）を追加
  - 受入基準: [spec.md](./spec.md) FR-6

## Phase 3: 選手ページ用の集計（FR-2）

- [ ] **Task 6: クライアント側集計の追加**（`src/services/supabaseDataService.js`）
  - `getRacerRaceHistory()`の`race_results`select列に`actual_course_1〜6`を追加し、行に`actualCourse`を追加
  - 純関数`aggregateRacerCourseEntryStats(history, venueCode, boatNumber, raceGrade, raceStage)`を追加（`aggregateRacerVenueBoatStats`と同じフィルタ、直近12ヶ月、走数付きで返す）
  - 受入基準: [spec.md](./spec.md) FR-2

## Phase 4: レース出走表への統合（FR-3、最優先UI）

- [ ] **Task 7: 表示ロジックの共通関数**
  - `src/components/race/courseEntryCell.js`を新規作成（`resolveCourseEntryCell`: 解決順「会場別5走以上→全国5走以上→参考→データなし」・タグ判定「全国値」「参考」「動く傾向」・定数`MIN_SAMPLES=5`、`MOVE_GAP_PT=20`）
  - 純関数のため、単体テスト（`scripts/maintenance/verify-*.js`パターン）を用意する

- [ ] **Task 8: データ出走表に「枠なり率」行を追加**
  - `src/components/race/raceIndicators.jsx`に行を追加（値・走数・会場平均・タグ）、`termHints.js`にツールチップ文言を追加
  - `src/locales/{ja,en,zh-TW,ko}/common.json`に行ラベル・ツールチップ・タグ文言を4言語同一PRで追加（`docs/reference/i18n-glossary.md`準拠、用語「前づけ」「枠なり」の訳語が未確定ならglossary追記が先）
  - `DataRaceTable.jsx`本体の変更は不要
  - 受入基準: [spec.md](./spec.md) FR-3

## Phase 5: 選手ページ（FR-4）

- [ ] **Task 9: 概要バッジと詳細セクション**
  - `RacerCourseEntryBadge.jsx`・`.css`を新規作成（`RacerGradeBadge.jsx`と同じstateless設計、配色は新規）、`src/components/racer/index.js`に追加
  - `RacerPerformanceStats.jsx`の概要カード付近にバッジ、「STの推移」と「レース一覧」の間に詳細セクション（枠番ごとのコース積み上げバー・枠なり率（走数）・会場平均、参考は薄字）を追加
  - バッジ閾値を実データ分布を見て確定する
  - 受入基準: [spec.md](./spec.md) FR-4

## Phase 6: 分析タブ（FR-5）

- [ ] **Task 10: `RacerMaezukeChart.jsx`の新規実装**
  - `RacerTechniqueProfileChart.jsx`と同じ「会場選択→レース選択→出走6選手」のパターン。6選手の積み上げバー・枠なり率・走数・会場平均・タグ（Task 7の関数を共用）
  - 会場平均の表（全24会場、2〜6枠の枠外進入率）を同タブ内に追加
  - `src/components/analysis/index.js`に追加

- [ ] **Task 11: `/winning-technique`へのタブ追加**
  - `WinningTechniqueAnalysis.jsx`の`TAB_KEYS`・import・レンダー分岐を追加
  - `src/locales/{ja,en,zh-TW,ko}/common.json`にタブ名・説明文を4言語同一PRで追加
  - 受入基準: [spec.md](./spec.md) FR-5

## Phase 7: 完了確認

- [ ] **Task 12: 全体の完了監査**
  - `tasks.md`の全チェックボックスと実際のコミット・コードを突き合わせる（`.claude/rules/sdd-workflow.md`参照）
  - `/code-review`、`npm run build`、`npm run test:e2e`、`npm run verify:er-diagram`を実行
  - BOA-284・BOA-337・BOA-170・BOA-348（Linear）の状態を更新し、実装内容・検証結果をコメントする
