# 旧3モデル依存ページのunified一本化 spec

種別: UI機能（BOA-178のみバックエンド改修を含む）
対応Linearチケット: BOA-174（/hit-races）、BOA-175（/accuracy）、BOA-178（/races一覧）

## 背景・目的

PR#286のAI予想モデル大規模改修（unifiedモデルへの一本化）後、`src/components/HitRaces.jsx`（`/hit-races`）・`src/components/AccuracyDashboard.jsx`（`/accuracy`）・`src/pages/RaceHistory.jsx`（`/races`一覧）の3ページは、旧3モデル（standard/safeBet/upsetFocus）のモデル切替タブ・単勝/複勝/3連複/3連単の4指標構成のまま取り残されている。unifiedモデルは複勝予想（topPick/top2nd）と展開予測（turnPrediction）の2種類しか生成しないため、モデル切替タブは意味を持たず、単勝的中・3連複的中・3連単的中の判定はほぼ発火しない実態と合わない指標になっている。

3ページとも同じ「unified一本化」というテーマで再設計するため、個別チケットではなく1つのspecで横断的に設計する。

3ページで共通利用されている`src/components/ModelComparisonTable.jsx`（旧モデル前提の比較表、80行、BOA-192で重複実装を解消したばかりの共通コンポーネント）は、その役割自体が旧3モデル比較のためのものであり、unified一本化後は不要になる。**今回廃止し、各ページ完結のUIに作り直す**（3ページ共通コンポーネントとしては維持しない）。

## 前提となる調査結果

### 的中判定の現状（BOA-173で確定済み、2026-08-14実装）
unifiedモデルでレース単位の二値的中判定が可能なのは以下2つ:
- **複勝的中**: `topPick`が実際の1着または2着と一致するか（`is_hit_place`としてDB保存済み、`scripts/lib/hitCalculator.js`）
- **展開予測的中**: `turnPrediction.patterns`のいずれかの`winnerCourse`が実際の1着コースと一致するか（**DBに保存されていない**。`predictions.feature_contributions.turnPrediction`から都度計算する方式。実測的中率は集計指標として別途約80%と算出されている）

イン崩れ指数（`volatilityPercentile`）は確率的傾向の予測であり、レース単位の二値的中判定の対象外（BOA-177で集計検証のみ扱う方針）。

**本spec（BOA-174/175/178の3ページ）では、的中判定を展開予測的中1種類に一本化する**（ユーザー決定、2026-08-15）。複勝的中は3ページとも表示しない。理由: 複勝予想の「実測精度%」表示（FAQ/About等の統計値）がBOA-180の回収率計算バグ修正に伴い算出方法見直し中のため一時停止中であり、この3ページの再設計でも複勝的中を扱わない方が一貫性がある。なお、RaceCard/RaceReview（個別レースページ、BOA-173で実装済み）の複勝的中+展開予測的中の2バッジ表示は本spec範囲外のため変更しない。

### BOA-178: race_history_cacheバッチの現状（今回調査）
`scripts/daily/update-race-history-cache.js`が`predictions`テーブルから`is_hit_win/is_hit_place/is_hit_trifecta/is_hit_trio`と各payoutを`model_id`別に集計し、`race_history_cache`（key=`race_history_summary_90`）にJSON保存している。

- `model_id`非依存の集計ロジックのため、`model_id='unified'`の行も自動的に集計対象に入るが、**unified行は`feature_contributions`（turnPrediction）を全く取得していないため展開予測的中は集計できない**
- したがってBOA-178の対応には、このバッチに「turnPredictionとrace_resultsを突き合わせて展開予測的中を計算するロジック」の追加が必須（新規実装）。展開予測的中一本化（後述）により、`is_hit_win`/`is_hit_place`/`is_hit_trifecta`/`is_hit_trio`ベースの既存集計ロジックは丸ごと不要になる
- 出力先の`race_history_cache`のデータ構造（`days[].models[]`が旧4指標×モデル別前提）も再設計が必要。モデル別内訳自体が不要になり、日別の展開予測的中率のみのシンプルな構造になる

### unified運用データの蓄積状況
unifiedモデルの運用開始は2026-08-11、spec作成時点（2026-08-15）で4日分のデータしかない。

## スコープ全体方針（3チケット共通）

- **unified一本化**: 3ページとも、旧3モデル（standard/safeBet/upsetFocus）のデータ・タブ・切替UIを完全に廃止する
- **過去データの扱い**: unified運用開始（2026-08-11）より前の期間は「データなし」表示とする。旧モデルの実績データとの混在・ハイブリッド表示は行わない
- **ModelComparisonTable.jsx**: 廃止。3ページそれぞれに専用UIを新規実装する

## 機能要件

### FR-1: /hit-races のunified一本化（BOA-174、優先度: 高）

- モデル切替タブ（`selectedModel` state、`MODEL_KEYS`ループ）を廃止
- `extractHitRaces()`の的中判定を「展開予測的中（turnPrediction.patternsのいずれかのwinnerCourseが1着と一致）」1種類に一本化。複勝的中・単勝的中・3連複的中・3連単的中の判定コードは全て削除
- 的中レースカード（`HitRaceCard`）を0から設計し直す。既存レイアウトを踏襲しない新レイアウト（具体的なビジュアルは`/step1-screens`で検討）
- 会場別統計（`VenueStatsTable`）・全体統計（`HitStats`）も展開予測的中率の1軸に作り替え
- 受入基準: `/hit-races`で本日・昨日・期間（unified運用開始以降）の的中レースが表示され、展開予測的中の判定が実データ（`race_results`との突き合わせ）と一致する。旧モデル・複勝的中のUIが一切表示されない

### FR-2: /accuracy のunified一本化（BOA-175、優先度: 高）

- 旧3モデルタブ・単勝/複勝/3連複/3連単の回収率カラムを廃止
- 主役指標を「展開予測的中率」（全体・期間推移）1本にする。複勝的中率は表示しない
- 会場別イン崩れ傾向: 既存`VolatilityAccuracySection`（`src/components/accuracy/VolatilityAccuracySection.jsx`、`dataService.getAccuracy()`が返す`summary.volatilityStats`を描画）を、会場別の内訳が見える形に拡張する。`scripts/daily/calculate-accuracy.js`の`calculateVolatilityStats()`が会場別データ（`byVenue`）を既に算出しているため、バックエンド計算は流用可能。BOA-177で実装済みの`/winning-technique`の「volatility」タブ（会場別内訳表示）と表示ロジックを共通化できないか確認する
- 受入基準: `/accuracy`で展開予測的中率・会場別イン崩れ傾向が表示され、旧モデル・複勝的中のUIが一切表示されない

### FR-3: /races 一覧のunified一本化（BOA-178、優先度: 高）

- `scripts/daily/update-race-history-cache.js`を改修:
  - 展開予測的中の計算ロジックを追加（`predictions.feature_contributions.turnPrediction`と`race_results`を突き合わせ）
  - `race_history_cache`のデータ構造をunified前提（日別: 総レース数・展開予測的中率）に再設計。旧モデル別の内訳・複勝的中は保持しない
- `src/pages/RaceHistory.jsx`のUIを、新しいキャッシュ構造・`ModelComparisonTable`廃止に合わせて作り替える（日付カード内の表示指標を展開予測的中率1つに簡素化）
- 受入基準: `/races`で日付ごとの展開予測的中率が表示され、`race_history_cache`の再計算結果が実データ（predictions/race_resultsからの独立集計）と一致する。unified運用開始（2026-08-11）より前の日付は「データなし」と表示される

## スコープ

### やること
- FR-1〜3（3ページのフロント再設計、BOA-178のみバックエンドバッチ改修も含む）
- `ModelComparisonTable.jsx`の完全廃止（3ページの置き換え先UI + `AccuracyHistory.jsx`への表示マークアップのインライン化を含む）
- 4言語（ja/en/zh-TW/ko）のi18nキー追加（3ページとも`TRANSLATED_PATHS`対象の既存ページ）
- 影響するe2eスモークテストの追随修正

### やらないこと
- 予想モデル・イン崩れ指数のロジック自体の変更
- 複勝予想の「実測精度%」表示の復活（BOA-180の見直し完了を待つ、別チケット）
- 旧モデル（standard/safeBet/upsetFocus）データの過去実績を残す・ハイブリッド表示する対応（今回はunified一本化・過去分は空白という方針で確定）
- RaceCard/RaceReview（個別レースページ、BOA-173実装済み）の複勝的中+展開予測的中2バッジ表示の変更（本specは/hit-races・/accuracy・/races一覧の3ページのみ対象）
- `AccuracyHistory.jsx`（`/accuracy/history`、旧3モデルの凍結された月別アーカイブ）自体のコンテンツ・方針変更。`ModelComparisonTable`廃止に伴うマークアップのインライン化のみ行い、表示内容・凍結アーカイブとしての位置づけは変えない

## 非機能要件

- モバイル320px〜で表示崩れなし
- 既存のe2eスモークテスト（`e2e/smoke.spec.js`）にデグレなし。3ページの新UIに対応するテストを追加・更新する
- `race_history_cache`の再計算バッチは既存の実行時間（現行: predictions 90日分の全件取得）から大きく劣化させない

## 制約・前提

- 「競艇」使用禁止ルールに従う
- 会場名は`venues.*`i18nキーを使う
- `race_history_cache`の再設計は破壊的変更のため、バッチとUIを同一PRで対応する（片方だけデプロイすると不整合が生じる）
- Supabase MCPのアクセストークンが失効中のため、マイグレーションが必要な場合は手動適用が必要（過去のBOA-181/032と同様の運用）

## 未確定事項

なし（2026-08-15、3件とも解消済み）。

- `AccuracyHistory.jsx`: 表示マークアップをページ内にインライン化し、`ModelComparisonTable.jsx`は完全削除する方針で確定
- FR-1の的中レースカードのビジュアル: 展開予測的中1本化を前提に0から設計し直す方針で確定。具体的なレイアウト案は`/step1-screens`で検討する
- FR-2/FR-3の複勝的中率表示: 3ページとも表示せず、展開予測的中率1本に統一する方針で確定
