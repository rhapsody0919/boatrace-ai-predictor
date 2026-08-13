# AI予想モデル大規模改修 システム設計

`docs/design/ai-model-redesign/spec.md`（2026-08-13方針転換版）・`screens.md`と、`docs/adr/0009〜0012`に基づく。

## 方針転換に伴う既存資産の扱い（重要）

2026-08-13の方針転換前（Task1〜2）に、「展開パターン×3買い目」の複数買い目パターン機能向けに以下を作成済みだったが、この機能は実装しないことになった（spec.md「やらない」参照）。

- `race_outcome_frequencies`テーブル（会場×1着×2着×3着の出現率・回収率、Task1で作成・Task2で日次バッチ実装済み）
- `model_bet_candidates`テーブル（展開パターン×3買い目、Task1で作成、日次バッチ未実装のまま）

これらは**削除せず、当面未使用のまま残す**（破壊的操作を避ける。テーブル自体は軽量で運用上の負担は小さい）。`update-outcome-frequencies.js`（日次バッチ）も当面は実行を継続してよいが、参照する機能が無いため優先度は低い。将来「類似条件過去実績」のような機能を追加する際に再利用できる可能性がある。

## 全体アーキテクチャ

**バッチ分割（2026-08-13決定）**: `generate-moriarty-recommendations.js`を調査した結果、モリアーティは朝の日次バッチ（`generate-predictions.js`）とは別に、発走前の適切なタイミングで実行される独立バッチだった（オッズ変動ヘアカット等、発走直前のオッズを前提にした設計）。FR4（3連単参考情報）も同様にオッズが必要なため、朝の時点では確定していない。FR1〜FR3（オッズ不要）と分離する。

```
[朝の日次バッチ、オッズ不要]
scripts/daily/generate-unified-predictions.js（新規、Task9a）
  ├── scripts/lib/turnPrediction.js（既存活用、ADR0011のPhase1/2改善適用済み、的中80.0%）
  │     → 1マーク展開パターン（最大3、決まり手×確率×コース）を算出。FR2の展開予測パネルはこの出力をそのまま使う
  ├── コース別勝率（racer_aggregated_stats.course_race_counts）を取得し、上位2艇を複勝予想として算出（FR1）
  │     → EV計算不要（オッズを経由しない、順位のみのシンプルなロジック）
  ├── scripts/lib/volatilityFactors.js（Task5、ADR0012）
  │     → イン崩れ複合スコアを算出。会場内パーセンタイルは predictions の蓄積データ
  │       （直近90日・同会場のcomposite値）から算出（2026-08-13決定）。運用開始直後は
  │       データが薄いためフォールバック処理が必要
  └── 書き込み:
        predictions（model_id='unified'、feature_contributions に
          複勝予想・展開予測パターン・イン崩れパーセンタイルを格納）

[発走前バッチ、オッズ必要]
scripts/daily/generate-unified-trifecta-reference.js（新規、Task9b）
  ├── scripts/lib/unifiedModel.js（Task6b/8、Zスコア合成版）
  │     → 展開パターンごとに艇別AIスコアを算出し、EV最大の3連単1点を参考情報として算出（FR4、補助的）
  ├── race_odds.trifecta_all から3連単オッズを取得しEVを算出
  │     → モリアーティのオッズ変動ヘアカット・EV閾値設計を参考にする
  └── 書き込み:
        bet_recommendations（model_id='unified'、3連単参考情報のEVサマリー）

[月次バッチ/手動、FR8]
scripts/maintenance/review-unified-model-params.js（新規）
  └── 直近1ヶ月の複勝的中率・展開予測的中率・イン崩れ相関・3連単参考回収率を出力し、
      係数見直しの判断材料とする（自動でパラメータを書き換えない）

[検証、FR9]
scripts/analysis/backtest-course-rate-only.js（実装済み、複勝FR1検証）
scripts/analysis/verify-turn-prediction-accuracy-v6.js（実装済み、展開予測FR2検証）
scripts/analysis/verify-volatility-predictive-power.js（実装済み、イン崩れFR3検証）
scripts/analysis/backtest-unified-model.js（実装済み、3連単FR4検証）
  └── いずれも期間指定でシミュレーションを実行できる。fetchAll（.range()ページネーション）必須

[フロントエンド]
src/services/supabaseDataService.js（既存拡張）
  └── predictions（model_id='unified'）取得 → DataRaceTable の複勝予想行（FR5）、
      AiAnalysisSection内の展開予測パネル・イン崩れバッジ・3連単参考情報（screens.md参照）
```

## データ設計

### 既存テーブルの再利用方針

調査の結果、`models`/`predictions`/`bet_recommendations`/`daily_bet_summary`/`model_performance_daily`/`user_visible_summary`は全て`model_id`列で拡張可能な設計になっている（`001_schema.sql`）。モリアーティ（`model_id='moriarty'`）が既にこのパターンで本番稼働しており、新モデルも`model_id='unified'`を1つ追加登録するだけで、実績集計・回収率計算の既存インフラの大半を再利用できる。

| テーブル | 再利用方法 |
|---|---|
| `models` | `model_id='unified'`で登録済み（Task1、`status='development'`）。旧3モデルはFR6-1のタイミングで`status='retired'`に変更 |
| `predictions` | `model_id='unified'`の行を朝の日次バッチ（Task9a）で生成。`feature_contributions`(JSONB)に複勝予想・展開予測・イン崩れパーセンタイルを格納（3連単参考情報は含まない） |
| `bet_recommendations` | `model_id='unified'`で発走前バッチ（Task9b）が3連単参考情報（FR4）のEV/Kelly基準サマリーを格納（モリアーティと同型）。複勝には使わない（EV計算を経由しないため） |
| `race_odds.trifecta_all` | FR4（3連単参考情報）のオッズ取得元。2026-07-12開始・約1ヶ月分の制約あり |
| `daily_bet_summary`/`model_performance_daily`/`user_visible_summary` | `model_id='unified'`分が加わるだけで、FR6-1の新モデル実績集計に対応できる見込み |
| `racer_aggregated_stats.course_race_counts` | FR1（複勝予想）の唯一のデータ源。コース別の勝数/出走数から勝率を算出する |

### 新規テーブル

今回の方針転換で新規テーブルは不要（複勝・展開予測・イン崩れは全て既存データ・既存ロジックの組み合わせで実現できる）。`030_ai_model_redesign_schema.sql`で作成済みの`race_outcome_frequencies`/`model_bet_candidates`は前述の通り未使用のまま残す。

### 使わない既存テーブル

`prediction_odds`は`trifecta_pred_standard`のようにモデル名がカラム名に埋め込まれた3モデル固定構造のため、新モデルでは使用しない。

## コンポーネント構成・データフロー（フロントエンド）

`screens.md`のカテゴリ1（予想表示コア）に対応する。

```
PredictionSection
  └── PredictionPanel
        ├── DataRaceTable（既存拡張）
        │     └── raceIndicators.jsx の buildIndicatorRows に「複勝予想」行を追加（FR5）
        │         データ元: predictions.feature_contributions.placeRecommendation（コース別勝率上位2艇）
        │
        └── AiAnalysisSection（既存、折りたたみコンテナ）
              ├── 展開予測パネル（FirstMarkAnimation、既存活用、FR2）
              │     データ元: predictions.feature_contributions.turnPrediction
              │     的中率80.0%を裏付けとして訴求する文言・バッジを追加
              ├── イン崩れ指数バッジ（VolatilityDisplay改修、FR3）
              │     データ元: predictions.feature_contributions.volatilityPercentile
              └── 3連単参考情報（PredictionFlash/BettingValueSection縮小版、FR4）
                    データ元: bet_recommendations（model_id='unified'、Task9b発走前バッチ生成）
                    （EV最大1点のみ、控えめなスタイルで表示。発走前バッチが未実行の時間帯は
                      非表示またはローディング表示にする、screens.md/実装時に検討）
```

## 既存サービス層との連携

- `src/services/supabaseDataService.js`: `getPredictions(date)`が`model_id='unified'`のpredictionsを取得できるよう拡張する。3モデル分岐ロジック（`standardPred`等）を`unified`単一モデル用に簡略化する
- `src/services/moriartyService.js`のパターン（`model_performance_daily`から`model_id`でフィルタして集計）を踏襲し、新モデル用の実績取得関数（複勝的中率・展開予測的中率等）を`src/services/`に追加する
- `scripts/lib/volatilityFactors.js`（Task5実装済み）: イン崩れ会場内パーセンタイル算出。日次バッチでは同期間の同会場レース群のcomposite分布を都度計算するか、事前集計するかは実装時に検討（現状のバックテストスクリプトは都度計算方式）
- `scripts/lib/turnPrediction.js`: ADR0011のPhase1/2改善適用済み（変更不要、再学習等の追加投資はしない）
- `scripts/lib/unifiedModel.js`: Task8のZスコア合成版（`SCORE_SOFTMAX_TEMP=120`）をFR4（3連単参考情報）にそのまま使う

## FR6-1（実績ページアーカイブ化）との連携

`AccuracyDashboard.jsx`/`AccuracyHistory.jsx`は現状`model_id`を`['standard', 'safeBet', 'upsetFocus']`にハードコードしている。これを「旧モデル（アーカイブ、`status='retired'`）」「新モデル（`model_id='unified'`）」の2グループに分けて集計するよう改修する。新モデルの実績は3連単中心だった旧設計と異なり、**複勝的中率・展開予測的中率・イン崩れ相関・3連単参考回収率の4指標**を表示する構成に変わる（`ModelComparisonTable.jsx`の列構成見直しが必要、screens.md参照）。

## 実装順序の大枠（詳細は`/step3`でタスク分解）

**フェーズ2（モデルロジック）・フェーズ3（バックテスト）は2026-08-12〜13に完了済み**（Task3〜8b相当、tasks.md参照）。残タスクは以下。

1. 日次生成パイプライン（2バッチに分割、2026-08-13決定）: `generate-unified-predictions.js`（朝、Task9a）で複勝予想（FR1）・展開予測（FR2）・イン崩れバッジ（FR3）を`predictions`へ書き込む。`generate-unified-trifecta-reference.js`（発走前、Task9b）で3連単参考情報（FR4）を`bet_recommendations`へ書き込む
2. フロントエンド: `DataRaceTable`に複勝予想行を追加（FR5）→ `AiAnalysisSection`内を3ブロック構成に再編（FR2/FR3/FR4）→ 旧モデル群の廃止・リダイレクト（FR6）→ 実績ページアーカイブ化（FR6-1）→ UI文言刷新（FR7）
3. 運用整備: 月次パラメータ見直しスクリプト（FR8）

## 未確定事項（`/step3`着手前に必要なら確認）

- `predictions.feature_contributions`のJSONB構造（`placeRecommendation`/`turnPrediction`/`volatilityPercentile`のキー名・形式）の詳細設計
- `AiAnalysisSection`内3ブロックの表示順序・レイアウト（screens.md未確定事項と同一）
- 3連複の扱い（spec.md未確定事項と同一）
- `generate-unified-predictions.js`と既存`generate-predictions.js`の関係（旧3モデル廃止後、後者をarchiveするか、しばらく並存させるか）
- `generate-unified-trifecta-reference.js`の実行タイミング（発走何分前か）とモリアーティのオッズ変動ヘアカット係数をそのまま流用するか
