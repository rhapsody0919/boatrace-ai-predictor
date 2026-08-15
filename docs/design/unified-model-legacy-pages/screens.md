# 旧3モデル依存ページのunified一本化 screens

`spec.md`のFR-1〜3に対応する、影響する画面・コンポーネントの一覧。`.claude/rules/component-reuse.md`に従い、新規/既存拡張/共通化方針を明記する。

## 共通で参照する既存パターン（新規実装時に必ず踏襲する）

的中判定ロジック（展開予測的中）は`src/components/race/RaceCard.jsx`の`isTurnHit`判定（`unified.turnPrediction.patterns`のいずれかの`winnerCourse`が`result.rank1`と一致）が既に実装・本番稼働中（BOA-173）。本specの3ページ全てが同じ判定を必要とするため、**判定ロジックをユーティリティ関数として切り出し、RaceCard.jsx・本spec対象コンポーネント・バックエンドバッチ（Node.js側は別実装になるが同一ロジック）で重複させない**方針とする（`.claude/rules/code-style.md`のDRY原則）。切り出し先は`src/utils/`配下に新規ファイルを追加する想定（`/step2`で確定）。

的中バッジの見た目（色・形）も`RaceCard.jsx`のバッジスタイル（インラインstyle、`raceCard.badgeTurn`キー）を踏襲し、新規デザイントークンは追加しない。

## FR-1: /hit-races（BOA-174）

| コンポーネント | 種別 | 役割・変更内容 |
|---|---|---|
| `src/components/HitRaces.jsx` | 既存拡張 | ページ本体。`selectedModel` state・`MODEL_KEYS`ループを削除。`extractHitRaces()`を展開予測的中1本の判定に全面書き換え（上記共通ユーティリティを使用） |
| `src/components/hits/HitRaceCard.jsx` | 既存を作り直し（0から設計） | 的中レース1件のカード表示。複勝的中バッジを削除し、展開予測的中のみのレイアウトに再設計。具体的なビジュアル案は`/step2`のUI設計で確定 |
| `src/components/hits/HitStats.jsx` | 既存拡張 | 全体サマリー統計。的中率の算出軸を展開予測的中率1つに変更 |
| `src/components/hits/VenueStatsTable.jsx` | 既存拡張 | 会場別的中統計テーブル。同上 |

新規コンポーネントは想定しない（既存3コンポーネントの内部ロジック・レイアウトの作り直しで完結）。

## FR-2: /accuracy（BOA-175）

| コンポーネント | 種別 | 役割・変更内容 |
|---|---|---|
| `src/components/AccuracyDashboard.jsx` | 既存拡張 | ページ本体。旧3モデルタブ・回収率カラムを削除し、展開予測的中率を主役指標にしたレイアウトに再構成 |
| `src/components/accuracy/ModelSelector.jsx` | **廃止** | 旧3モデル切替タブ専用。unified一本化後は不要 |
| `src/components/accuracy/StatsTable.jsx` | **廃止** | 旧モデルの回収率込み統計テーブル。展開予測的中率のみの新規表示に置き換え（既存構造の流用は困難なため作り直し） |
| `src/components/accuracy/RecoveryTrendChart.jsx` | **廃止** | 回収率推移グラフ。回収率自体を扱わないため不要。展開予測的中率の推移グラフが必要なら新規コンポーネントとして作る（`/step2`で要否確定） |
| `src/components/accuracy/VenueStrategyTable.jsx` | **廃止** | 旧モデル前提の会場別投資戦略テーブル |
| `src/components/accuracy/VenueDetailedAnalysis.jsx` | **廃止** | 上記`StatsTable`を内包する会場別詳細分析。廃止対象コンポーネントに依存するため道連れで廃止 |
| `src/components/accuracy/ReliabilityWarning.jsx` | 既存流用（変更なしで良い可能性） | 「サンプル数が少ない」警告。`races >= 100`のみに依存しモデル非依存のため、そのまま再利用できる見込み |
| `src/components/accuracy/VolatilityAccuracySection.jsx` + `.css` | 既存拡張 | 会場別イン崩れ傾向を追加表示できるよう拡張。`src/components/analysis/VolatilityAccuracyChart.jsx`（BOA-177、`/winning-technique`の「volatility」タブ）と表示ロジックの共通化を検討する（同じ`calculateVolatilityStats()`の`byVenue`データを描画する用途が重なるため） |

## FR-3: /races一覧（BOA-178）

| コンポーネント/スクリプト | 種別 | 役割・変更内容 |
|---|---|---|
| `scripts/daily/update-race-history-cache.js` | 既存拡張（バックエンド） | 展開予測的中の計算ロジックを追加（`predictions.feature_contributions.turnPrediction`と`race_results`を突き合わせ、共通ユーティリティのロジックをNode.js側でも同一実装）。旧4指標×モデル別の集計は削除し、日別の展開予測的中率のみを`race_history_cache`に保存する構造に変更 |
| `src/pages/RaceHistory.jsx` | 既存拡張 | ページ本体。新しいキャッシュ構造（モデル別内訳なし）に合わせて表示ロジックを書き換え |
| `src/pages/RaceHistory.css` | 既存拡張 | `ModelComparisonTable`依存のスタイルを整理 |

## 横断的な廃止・整理

| コンポーネント | 種別 | 役割・変更内容 |
|---|---|---|
| `src/components/ModelComparisonTable.jsx` | **完全廃止** | 旧3モデル比較表。FR-1〜3の3ページから参照を削除。唯一残る利用箇所（`AccuracyHistory.jsx`）は表示マークアップをページ内にインライン化してから、このファイル自体を削除する |
| `src/pages/AccuracyHistory.jsx`（`/accuracy/history`） | 既存拡張（最小限） | 旧3モデルの凍結された月別アーカイブページ。表示内容・位置づけ（凍結アーカイブ）は変更せず、`ModelComparisonTable`を使っていたマークアップ部分のみページ内にインライン化する |

## デザイントークン・CSSの扱い

- 色・サイズは既存の`src/styles/design-tokens.css`（`--color-primary-*`、`--color-success`等）を使用し、新規トークンは追加しない
- 的中バッジの色は`RaceCard.jsx`のインラインスタイル（展開予測的中バッジの配色）を踏襲する
- FR-1のカード0からの再設計に伴い、`src/components/hits/`配下のCSS（`HitRaces.css`）は的中種別バッジ部分を中心に書き換えが発生する見込み。会場カード・レイアウト骨格自体は既存CSSクラスの再利用を優先する

## i18n

**訂正（2026-08-15、`/step4`実装中に判明）**: `/accuracy`・`/hit-races`・`/races`はいずれも`src/config/languages.js`の`TRANSLATED_PATHS`（`/`, `/guide`, `/venues`, `/winning-technique`のみ）に含まれておらず、**ja専用ページ**（3区分の「ja-only」に該当、`t()`も使われていない直書き日本語）だった。当初spec.md/tasks.mdに記載していた「4言語のi18nキー追加」は誤りのため対象外とする。廃止する旧モデル関連の文言（`MODEL_NAMES`表示等）は未使用化するが、他ページで参照されていないか事前に確認してから削除する。
