# 進入コース遷移傾向の再構築 spec

## 種別

UI機能（データ・分析機能を含む複合機能。BOA-284は純粋なデータ・分析機能、BOA-170/BOA-337はUI機能）

## 対応チケット

- [BOA-284](https://linear.app/boat-ai/issue/BOA-284): 現行predictionモデルのcourseRate特徴量がBOA-278の進入コースバグの影響を受けている疑い
- [BOA-337](https://linear.app/boat-ai/issue/BOA-337): BOA-293の進入コース別選手成績データをUIで活用する
- [BOA-170](https://linear.app/boat-ai/issue/BOA-170): [boatAI提案] 会場別 前づけ（進入変更）発生率の表示（本specで当初スコープ「選手個別の前づけ傾向分析」に復元する）

## 背景（3チケットの関係）

1. **BOA-257**（Done、2026-09-15 PR #671でマージ）が、公式Kファイル（`https://www1.mbrace.or.jp/od2/K/{YYYYMM}/k{YYMMDD}.lzh`）経由で実進入コースを取得する仕組みを実装した。`race_results.actual_course_1〜6`として全24会場・2025-12-04〜のほぼ全期間（42,382/42,483件、2026-09-16確認）が既にバックフィル・日次同期済み。艇番との不一致率は1号艇1.1%→6号艇13.5%と物理的に妥当
2. 一方、既存の`race_results.course_1〜6`（旧列、触らない）は艇番と完全一致する不良データで、これを参照する箇所が2つ残っている:
   - **BOA-284**: `scripts/lib/unifiedModel.js`の`courseRate`特徴量（重み21.8、全10指標中最大）が、`scripts/analysis/aggregate-racer-stats.js`の`course_entry_tendency`（`course_1〜6`集計）経由で汚染されている
   - **BOA-170**: 「選手個別の前づけ傾向」を可視化する機能。2026-09-12、当時のBOA-257の中間結論（個別レース単位の進入コースは取得不可能）を受けて「会場単位の集計表示」＋「VenueCharacteristicsCardへの統合」に2段階縮小されていた
3. **BOA-293**（Done、PR #683）が対象10会場（常滑・三国・びわこ・尼崎・徳山・下関・若松・芦屋・唐津・多摩川）の会場公式サイトから、選手個別の「枠→実進入コース遷移確率」（直近12ヶ月集計）を日次取得する基盤を構築した
4. `actual_course_N`が全24会場・全期間分そろったことで、**BOA-170を当初スコープ（選手個別の前づけ傾向分析）に復元できる**。自社`race_entries`+`race_results.actual_course_N`から同じ統計を全24会場分、自前で計算できるため。BOA-293の10会場データは、この自前計算の検証・優先データとして活用する（ハイブリッド方針、2026-09-16ユーザー合意）

## 機能要件

### FR-1（P0）: `course_entry_tendency`集計ロジックの切り替え（BOA-284）

`scripts/analysis/aggregate-racer-stats.js`の`course_entry_tendency`算出を、`race_results.course_1〜6`から`race_results.actual_course_1〜6`に切り替える。

**受入基準**:
- [ ] `course_entry_tendency`が`actual_course_N`ベースで再計算される
- [ ] `scripts/analysis/analyze-indicator-predictive-power.js`で`courseRate`の予測力を再計測し、切り替え前後の差分を記録する
- [ ] `scripts/analysis/backtest-course-rate-only.js`で切り替え前後の的中率・回収率を比較する
- [ ] 予測力・回収率が悪化していないことを確認してから、`unifiedModel.js`の`INDICATOR_WEIGHTS`更新・本番反映を判断する（悪化していた場合はユーザーに報告し、reweighting要否を相談する。無条件の自動反映はしない）
- [ ] `.claude/rules/analysis.md`のデータ精度検証パターン（実データスポットチェック、妥当性の機械的チェック、独立した別経路での再計算）を実施する

### FR-2（P0）: 選手×枠番→実進入コース遷移確率の自前計算（全24会場）

`race_entries`+`race_results.actual_course_N`から、選手ごとに「出走した枠番→実際に進入したコース」の遷移確率・進入コースごとの平均ST・1〜6着率を算出する（BOA-293の会場サイトデータと同じ統計量、全24会場分を自社データのみで算出）。

**集計パラメータ**（8人パネル決定、2026-09-16）:
- 集計期間: 直近12ヶ月固定（会場ごとの差異は設けない、BOA-293会場サイト側の慣行と揃える）
- 最小サンプル数: 5件未満はデータ不足として除外（既存`MIN_COURSE_SAMPLES`パターン踏襲）

**受入基準**:
- [ ] 新規関数（例: `getRacerCourseEntryTendency(racerId)`）が、対象選手の枠番ごとの遷移確率・平均ST・1〜6着率を返す
- [ ] サンプル数5件未満の枠番は`null`または「データ不足」を返す
- [ ] 全24会場の選手で計算できることを実データで確認する

### FR-3（P0・最優先）: レース出走表への統合

レース詳細ページの出走表（データ出走表11指標のいずれかのカラム、または新規カラム）に「前づけ傾向」を追加する。今日のレースの枠番が確定した時点で、その選手のFR-2集計値から該当コースへの遷移確率を1つの数値として表示する。

**優先度の根拠**: 8人パネル全会一致で「買い目判断に直結する」として最優先とされた

**受入基準**:
- [ ] 既存のデータ出走表コンポーネント（`PredictionTable`等、`.claude/rules/component-reuse.md`準拠）に統合されている
- [ ] 対象10会場（BOA-293データあり）は会場サイトデータを優先表示し、自前計算値は参考値として保持する（2026-09-16ユーザー合意: 「会場データがある10会場はそちらを優先表示」）
- [ ] 対象外14会場は自前計算値（FR-2）を表示する
- [ ] サンプル不足でデータが無い場合の表示（非表示 or 「データ不足」表記）を実装する

### FR-4（P1、**PR #686待ち**）: 選手ページへのバッジ表示

選手個別ページ（`/racer/:racerId`）に、`RacerGradeBadge.jsx`と同じパターンで「前づけ傾向」を示すバッジを追加する（例: 特定の枠番から高確率で前づけする選手への視覚的マーキング）。

**着手条件（2026-09-16ユーザー指摘）**: [PR #686](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/686)（BOA-159、選手ページに会場×枠番×グレード×レース種別フィルタと「概要／決まり手／推移／レース一覧」4タブ構成を追加する大規模改修、2026-09-16時点OPEN）が選手ページの構造自体を作り変えている。PR #686がマージされるまでFR-4には着手しない（マージ前に着手するとPR #686の再構成（ADR-0062の4タブ構成）と競合し、手戻りになるため）。マージ後、バッジの配置先を新しいタブ構成（おそらく「概要」タブ）に合わせて再検討する。

**受入基準**:
- [ ] PR #686がマージされていることを確認してから着手する
- [ ] `RacerGradeBadge.jsx`と同じトーン・配置パターンで実装されている（PR #686後の新構成に合わせて配置先を再確認）
- [ ] バッジの判定基準（閾値）を定義する（未確定、/step2で検討）
- [ ] 全国集計（会場非依存）の値を使う

### FR-5（P2）: 分析タブ新設（`/winning-technique`）

既存の17タブ（`WinningTechniqueAnalysis.jsx`）と同じパターンで、選手横断の前づけ傾向比較タブを追加する。BOA-170当初案の`RacerMaezukeChart.jsx`・`get_race_maezuke_breakdown`相当のコンポーネント/RPCを、FR-2の自前計算ベースで作り直す。

**受入基準**:
- [ ] 既存タブ（`techprofile`/`formranking`等）と同じ選択パターン（会場・レース選択→出走選手の傾向一覧）
- [ ] 4言語i18n対応（`/winning-technique`は`TRANSLATED_PATHS`対象のため、`docs/reference/i18n-glossary.md`準拠で4言語キーを同一PRで追加）

## スコープ

**やること**:
- `course_entry_tendency`の`actual_course_N`への切り替え、予測力・回収率の再検証
- 選手×枠番→実進入コース遷移確率の自前計算（全24会場、FR-2）
- レース出走表への統合（FR-3、最優先）
- 選手ページバッジ（FR-4、**PR #686マージ後**に着手）
- 分析タブ新設（FR-5）
- BOA-293（10会場）とFR-2自前計算のハイブリッド表示（10会場は会場データ優先）

**着手順序**: FR-1/FR-2（データ基盤）→ FR-3（出走表統合、最優先）→ FR-5（分析タブ）→ FR-4（選手ページバッジ、PR #686マージ待ち）。FR-4はPR #686の進捗次第で他FRより後になる想定。

**やらないこと**:
- VenueCharacteristicsCardへの統合（2026-09-12の縮小案、8人パネルで撤回）
- BOA-293のスクレイピング対象会場の拡大（10会場のまま、戸田・浜名湖・児島は対象外）
- モデルの再学習アルゴリズム自体の変更（重み再計算のみ。Zスコア方式等のアーキテクチャ変更は対象外）
- 過去の`predictions`データの遡及的な再計算・修正

## 非機能要件

- courseRate切り替え後の予測力・回収率が切り替え前を悪化させないこと（FR-1受入基準参照、数値目標は/step2で確定）
- `/winning-technique`の新規タブは既存17タブと同じUI/UX規約に準拠すること

## 制約・前提

- 既存コンポーネント再利用: `RacerGradeBadge.jsx`（FR-4）、`RacerTechniqueProfileChart.jsx`等の既存分析タブパターン（FR-5）、`PredictionTable`等の出走表コンポーネント（FR-3）を踏襲する（`.claude/rules/component-reuse.md`）
- データ源: `race_entries`・`race_results.actual_course_1〜6`（自社DB）、`venue_entry_course_stats`（BOA-293、10会場）
- 用語: 「進入コース」「前づけ」等の表記は既存の`docs/reference/`用語集・`.claude/rules/code-style.md`に準拠する
- AI予測の性質上、新規指標もあくまで参考値であり結果を保証しない旨の既存ディスクレーマーの対象に含める
- `/winning-technique`は4言語翻訳対象（`TRANSLATED_PATHS`）、`/racer/:racerId`はja専用（`TRANSLATED_PATHS`未登録）

## 未確定事項

| 項目 | 内容 | いつ・誰が決めるか |
|---|---|---|
| FR-1の予測力・回収率の具体的な悪化許容範囲 | 「悪化していないこと」の数値基準（例: 回収率-2pt以内等） | /step2、実データでの再検証結果を見てユーザーと相談 |
| FR-3のカラム表示形式 | 既存11指標のどこに追加するか、独立カラムか既存カラムの補助表示か | /step1-screens |
| FR-4のバッジ判定閾値 | 「前づけ傾向あり」と判定する遷移確率のしきい値 | /step2、実データ分布を見てから |
| FR-4の配置先タブ | PR #686で選手ページが「概要／決まり手／推移／レース一覧」4タブ構成になる予定。バッジをどのタブに置くか | PR #686マージ後、/step1-screensで再検討 |
| FR-5のRPC設計 | `get_race_maezuke_breakdown`相当の新規RPCの入出力形式 | /step2 |
| BOA-284の再学習・本番反映の実施者・タイミング | 検証結果が良好だった場合、誰が最終的にINDICATOR_WEIGHTSの本番反映を実行するか | /step4実装時、検証結果を見てユーザーに確認 |
