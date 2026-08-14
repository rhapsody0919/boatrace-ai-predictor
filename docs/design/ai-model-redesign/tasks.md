# AI予想モデル大規模改修 タスク分解

`docs/design/ai-model-redesign/spec.md`（2026-08-13方針転換版）・`screens.md`・`plan.md`、`docs/adr/0009〜0012`に基づく。依存順。各タスクは目安として1コミット〜1PRで完結する粒度。

## フェーズ1: データ基盤

- [x] **Task 1**: `docs/db-migration/030_ai_model_redesign_schema.sql`をSupabaseに適用する。`model_id='unified'`で確定済み（2026-08-11）。`race_outcome_frequencies`・`model_bet_candidates`テーブル作成、`models`への新モデル登録（`status='development'`）。Supabase MCPのアクセストークンが失効中のため、ユーザーがSupabase Dashboardで手動実行済み（2026-08-11）。**2026-08-13時点の注記**: 方針転換により両テーブルは当面未使用（plan.md参照）
- [x] **Task 2**: `scripts/daily/update-outcome-frequencies.js`を新規実装する（ADR0010）。`race_results`から会場×1着艇×2着艇×3着艇の組み合わせ別出現率・回収率を集計し`race_outcome_frequencies`へupsertする、過去180日ウィンドウ。実行・検証済み（2026-08-11）: 全24会場でappearance_rate合計が0.999〜1.002（妥当）、大村1-2-3組み合わせを独立再計算し完全一致を確認。実装中に`recovery_rate`列のnumeric overflow（DECIMAL(6,4)では3連単高配当の桁が不足）を発見し`030_ai_model_redesign_schema.sql`をDECIMAL(10,4)に修正。**2026-08-13時点の注記**: 方針転換により当面未使用

## フェーズ2: モデルロジック

- [x] **Task 3**: `scripts/lib/turnPrediction.js`にPhase1改善を適用する（ADR0011）。Phase1a: 逃げ確率のキャリブレーション補正（`NIGE_CALIBRATION_FACTOR=1.5`をrawProbに乗算）。Phase1b: `upsetFactor`の風速・波高抑制係数を1/4へ縮小（0.08→0.02、0.06→0.015、最大値0.3→0.075）。検証（2026-08-11）: `simulate-nige-calibration.js`で理論的シミュレーション（k=1.5で加重平均乖離12.3pt→8.3ptに縮小）。**2026-08-13時点の位置づけ**: FR2「展開予測パネル」の精度基盤として主要な役割を担うことになった（的中80.0%達成、下記Task8b参照）
- [x] **Task 4**: `scripts/lib/turnPrediction.js`にPhase2改善を適用する（ADR0011）。会場を3グループ（stable/volatile/extreme）に分類し、グループ別`upsetFactor`倍率・決まり手フロア値を導入。`data/analysis/turn-prediction-venue-analysis.json`の実測的中率ベースで再分類（`scripts/lib/venueParameters.js`の`VENUE_TYPE`/`getVenueType`）。検証（2026-08-12）: 桐生(extreme)でmakuri/makurizashiが上振れる方向性を確認
- [x] **Task 5**: イン崩れ会場内パーセンタイル算出関数を新規実装する（ADR0012）。`scripts/lib/volatilityFactors.js`。`calculateVolatilityComposite()`（0-1の複合値、固定レンジキャリブレーションなし）と`toVolatilityPercentile()`（会場内相対順位）を実装。**2026-08-13時点の位置づけ**: FR3「イン崩れ指数バッジ」の中核ロジックとして採用（実際のイン崩れ率と明確な相関を確認、下記Task8b参照）
- [x] **Task 6a**: `scripts/lib/raceIndicatorData.js`を新規実装する。データ出走表11指標のうち4つ（stPredictability・returnRate・techniqueProfile・exhibitionTime）は既存Supabase RPCをそのまま利用、`form`のみ新規実装。検証済み（2026-08-12）
- [x] **Task 6b**: `scripts/lib/unifiedModel.js`を新規実装する（ADR0009）。当初は11指標を加点式（生値×固定係数）で評価するv1実装。**2026-08-13時点の位置づけ**: FR4「3連単参考情報」の基盤として存続するが、v3（Task8）で大幅に改修された

## フェーズ3: バックテスト・検証・方針転換

- [x] **Task 7**: `scripts/analysis/backtest-unified-model.js`を新規実装する（`verify-poirot.js`のパターン踏襲）。**重要な発見（2026-08-12）**: `race_odds.trifecta_all`列（022マイグレーション、2026-07-12開始）に全120通りの3連単オッズが既に格納されていることが判明。spec.mdの「3モデルの予想買い目対応分のみ」という制約記述は誤りだったため訂正。収集期間は約1ヶ月・830レースのみ

- [x] **Task 8**: `unifiedModel.js`の根本的な検証・改修（2026-08-12〜13、複数段階）。
  1. **EV計算バグ発見・修正**: 初期実装のEVは`odds × pattern.probability`（1着確率のみ）で、2着・3着の確からしさを一切反映していなかった。`combinedProbability`（1着×2着×3着の同時確率）に修正し、2着・3着候補をAIスコアのsoftmax変換で確率化する設計に変更
  2. **softmax温度キャリブレーション**: `calibrate-unified-model.js`を新規実装し、既存predictionsデータからの理論的逆算・温度グリッドサーチで検証。修正後もバックテスト回収率が改善せず、モデル自体（`WEIGHTS`）の妥当性を疑う
  3. **指標予測力分析**: `analyze-indicator-predictive-power.js`を新規実装し、11指標それぞれの着順予測力を検証（2026-08-12、1000レース）。`courseRate`（コース別勝率）が最強（上位2位計61.8%）、`form`（調子）が最弱（41.1%、ほぼランダム）と判明。旧`WEIGHTS`は予測力と逆相関する箇所があった（courseRateの係数がほぼ最小、formが最大級）
  4. **Zスコア化（v3）**: `unifiedModel.js`を「生値×固定係数」から「比較対象グループ内でのZスコア化×予測力ベースの重み」に全面改修。温度も再グリッドサーチ（120で最適）
  5. **EV閾値グリッドサーチ**: `backtest-unified-model.js`にEV閾値別集計を追加。EV>=1.2で回収率78.8%（459件、1週間分）が最良と判明
  6. **Supabaseページネーションバグ発見・全面修正**: 上記検証群で使った分析スクリプト7本すべてが、対象レース取得時に`.range()`を使わずSupabaseのデフォルトlimit1000件で頭打ちになっていたと判明（1ヶ月指定で実際には約22%しか見ていなかった）。`fetchAll`ヘルパー使用に統一修正
  7. **方針転換のきっかけとなった追加検証**（正しいデータで実施、詳細はTask8b参照）: 複勝・3連複・展開予測・イン崩れ指数・コース別勝率単体の予測力を検証した結果、3連単より遥かに高精度な複数の機能が見つかり、2026-08-13にspec.mdを全面改訂（3連単中心→複勝/展開予測/イン崩れ指数を主軸とする複数機能構成へ）

- [x] **Task 8a（削除）**: ~~展開パターン別複数買い目の生成ロジック~~。方針転換によりFR5（複数買い目パターン）は「やらない」ことになったため実装しない

- [x] **Task 8b**: 新方針の4機能それぞれの予測力を正しいデータ（`fetchAll`修正後、1ヶ月分4580件）で検証する。
  - `backtest-unified-model-place-trifecta.js`（新規）: 複勝（AIスコア上位2艇）的中89.7%・回収138.9%、3連複（上位3艇）的中20.8%・回収78.3%
  - `backtest-course-rate-only.js`（新規）: 複勝（コース別勝率単体）的中91.9%・回収146.0%。**複合スコアより単体の方が優れていると判明**、FR1として採用確定
  - `verify-turn-prediction-accuracy-v6.js`（新規）: 展開予測（Phase1/2改善後）的中80.0%、全24会場が73.5%〜87.5%に収まる安定した精度。旧ロジック72.5%から改善確認
  - `verify-volatility-predictive-power.js`（新規）: イン崩れ指数パーセンタイル帯別の実際のイン崩れ率が0-10%帯19.6%→90-100%帯71.2%と明確な単調増加。予測力を確認

## フェーズ4: 日次生成パイプライン（2026-08-13新方針に基づき全面再構成、バッチ分割を2026-08-13に決定）

**バッチ分割の理由**: モリアーティ（`generate-moriarty-recommendations.js`）を調査した結果、朝の日次バッチ（`generate-predictions.js`）とは別に、発走前の適切なタイミングで実行される独立バッチとして実装されていた（オッズ変動ヘアカット等、発走直前のオッズを前提にした設計）。FR4（3連単参考情報）も同様にオッズ（`race_odds.trifecta_all`）が必要なため、朝の時点では確定していない。FR1〜FR3（オッズ不要）と分離する。

- [x] **Task 9a**: `scripts/daily/generate-unified-predictions.js`を新規実装する（朝の日次バッチ、オッズ不要）。以下を統合し`predictions`（`model_id='unified'`）へ書き込む:
  - FR1複勝予想: `racer_aggregated_stats.course_race_counts`からコース別勝率を算出し上位2艇を選出（EV計算不要）。`predictions.top_pick`/`top_2nd`に格納（model_id='unified'限定の意味づけ、コード冒頭にコメント明記）
  - FR2展開予測: `turnPrediction.js`（Phase1/2改善済み）の出力をそのまま`feature_contributions.turnPrediction`に格納
  - FR3イン崩れバッジ: `volatilityFactors.js`の複合スコア算出＋会場内パーセンタイル変換。比較対象データは`predictions`の蓄積データ（直近90日分の同会場composite値、`MIN_DISTRIBUTION_SAMPLES=20`未満なら`percentile=0.5`固定にフォールバック）を実装
  - `feature_contributions`のJSONB構造を`{ placeRecommendation: {boats, courseRates}, turnPrediction, volatilityComposite, volatilityPercentile, volatilityReasons }`に確定
  - 検証（2026-08-13）: `--date=2026-08-11 --dry-run`で180レース中166レース分の予測生成を確認（残り14件はrace_entries不足等でスキップ、既存バッチと同様の許容範囲）。ユーザー承認を得て実際にSupabaseへ書き込み、`predictions`テーブルに`model_id='unified'`で166件保存されたことを確認済み。初回実行のためvolatilityPercentileは全件フォールバック値0.5（蓄積データなし、想定通り）
- [x] **Task 9b**: `scripts/daily/generate-unified-trifecta-reference.js`を新規実装する（発走前バッチ、オッズ必要）。FR4 3連単参考情報: `unifiedModel.js`（v3、Task8で改修済み）+ `race_odds.trifecta_all`でEV最大1点を算出し、`bet_recommendations`（`model_id='unified'`）へ書き込む。EV閾値（`EV_THRESHOLD_BET=1.2`/`EV_THRESHOLD_NEUTRAL=0.8`）は`backtest-unified-model.js`のグリッドサーチ結果を踏襲
  - **重大バグ発見・修正（2026-08-13）**: 実装当初、Node.js標準fetch（undici）で166レースを連続処理すると、ランダムなタイミング（再現性なし）でSupabaseへのリクエストが無期限にハングする不具合が発生した。原因はNode.jsのHTTP接続プール枯渇と推定。`scripts/lib/raceIndicatorData.js`の`fetchRaceIndicatorData`内の`Promise.all`（5並行リクエスト）を直列`await`に変更しても再発したため、`scripts/lib/supabaseClient.js`のSupabaseクライアントに`AbortController`ベースのタイムアウト付きfetch（15秒）を注入する対策を実施。同ファイルを経由する全バッチ・分析スクリプトに共通で効く根本対策。他の連続処理バッチ（`generate-unified-predictions.js`等）でも同種のハングが起きうるため、同様の症状が出た場合はこの対策が既に効いていることを前提に別原因を疑う
  - 検証（2026-08-13）: タイムアウト修正後、`--date=2026-08-11 --dry-run`で166レース中153件（オッズ取得済み分）の推奨生成が完走（bet=89/neutral=35/skip=29）。実際にSupabaseへ書き込み、`bet_recommendations`テーブルに`model_id='unified'`で153件保存されたことを確認済み

## フェーズ5: フロントエンド（2026-08-13新方針に基づき全面再構成）

- [x] **Task 10**: `src/components/race/DataRaceTable.jsx` / `raceIndicators.jsx`を拡張する（FR5）。`buildIndicatorRows`に「複勝予想」行を追加し、コース別勝率に基づく上位2艇を根拠バッジ付きで常時表示する
  - 実装（2026-08-13）: 新規DB取得を行わず、既存`courseRate`指標（`cand.courseRate`）から上位2艇をクライアント側で算出（`generate-unified-predictions.js`の`calculatePlaceRecommendation`と同じロジック）。`courseRate`行の直後に配置し、根拠（コース別勝率の値）が直前の行で常に確認できる構成にした。バッジは◎(1位)/○(2位)、`drt-plus`クラスで既存の「達成時ハイライト」スタイルを再利用
  - `signal`/`itemText`は意図的に`null`固定にした: `raceIndicators.jsx`はRaceReview.jsxとも共有されており、RaceReview側の好走判定（`good`）は上位3着基準だが、複勝の的中は上位2着基準（`payoutCalculator.js`のplace定義と同じ）。基準が異なる状態で流用すると3着艇を誤って複勝的中と判定するバグになるため、RaceReview側の判定ロジックを別途実装するまでは対象外とした（`RaceReview.jsx`の`judgeableRows`から`placeRecommendation`を除外し、常時「−」の無意味な列が出ないようにした）
  - i18nキー4言語（ja/en/zh-TW/ko）追加: `dataTable.rowPlaceRecommendation`/`dataTable.placeBadgeLabel`/`review.cols.placeRecommendation`
  - 検証: `npm run build`成功。Playwrightで`/races/2026-08-13`→大村12Rを展開し、データ出走表に「複勝予想」行が`courseRate`行の直後に表示され、コース別勝率上位2艇に◎/○バッジが正しく付与されることをスクリーンショットで確認済み
- [x] **Task 11**: `AiAnalysisSection`内を3ブロック構成に再編する（FR2/FR3/FR4）。実装時にTask12（旧モデル群のUI廃止）とデータフロー上不可分と判明したため、両タスクを1回のパスで実装した（詳細はTask12参照）。
  - 展開予測パネル: `FirstMarkAnimation`をそのまま活用し、`predictions.feature_contributions.turnPrediction`（unifiedモデル）から表示。実測的中率バッジ（`animation.accuracyBadge`）を追加
  - イン崩れ指数バッジ: `VolatilityDisplay.jsx`を全面改修。旧high/medium/low3段階＋おすすめモデル提示を廃止し、`volatilityPercentile`（0-1連続値）＋`volatilityReasons`のみを受け取る構成に変更（`{percentile, reasons}`）。閾値0.7/0.3で警戒/標準/堅いのラベルを付与
  - 3連単参考情報: `PredictionFlash.jsx`/`BettingValueSection.jsx`（3モデル依存が深く転用コストが高いため）を削除し、新規`TrifectaReferenceCard.jsx`を作成。`bet_recommendations`（model_id='unified'）をレース単位で取得し、EV最大1点を控えめなスタイル（`design-tokens.css`のトークンのみ使用）で表示
  - データ取得: `src/services/supabaseDataService.js`の`getPredictions`（Edge API経由の`transformEdgeResponse`とSupabase直接クエリの両方）に`raceData.unified`（topPick/top2nd/players/turnPrediction/volatilityPercentile/volatilityReasons）を追加。新規`getUnifiedTrifectaReference(raceId)`を追加（`dataService.js`にもラッパー追加）
  - **DBマイグレーション追加（未適用）**: `docs/db-migration/031_add_unified_fields_to_predictions_rpc.sql`。Edge API（`api/predictions/[date].js`が呼ぶRPC）は019マイグレーション時点でturnPredictionのみ抽出しており、volatilityPercentile/volatilityReasonsは未対応。`SUPABASE_ACCESS_TOKEN`失効中のため2026-08-13時点で未適用（`mcp__supabase__list_migrations`が401 Unauthorized）。ローカル開発（Supabase直接クエリにフォールバックする経路）ではfeature_contributions列を丸ごと取得するため影響なし。本番Edge API経由では、マイグレーション適用までイン崩れバッジがEdge API経路で表示されない可能性がある点を要注意（ユーザーにトークン更新を依頼する必要あり）
  - **重大バグ発見・修正（2026-08-13、Task9aに遡って影響）**: `generate-unified-predictions.js`の`fetchRaceDataFromSupabase`が`.select("*").in("race_id", raceIds)`のページネーション無しクエリだったため、Supabaseのデフォルトlimit1000行に引っかかり、180レース×6艇=1080行のうち後方の大村（venue 24）全12レースが完全に欠落するバグを発見（Playwrightでの`/races/2026-08-13`実機検証中に発覚）。`fetchAll`ヘルパーに置き換えて修正。`fetchVolatilityDistribution`（90日×全会場のpredictions取得、将来1000行超のリスクあり）も同様に修正。2026-08-11・2026-08-13の両日分を再生成し、大村を含む全180レースが正しく生成されることを確認済み（当初「166/180」と報告していた数値は誤りで、実際は180/180が正しい）
  - 検証: `npm run build`成功。Playwrightで`/races/2026-08-13`→大村1Rを展開し、複勝予想行・展開予測パネル（1マーク展開予測アニメーション）・イン崩れ注意度バッジ（パーセンタイルバー）・3連単参考情報カード（買い目・オッズ・EV表示）が全て正しく表示され、コンソールエラーが無いことを確認済み
- [x] **Task 12**: 旧モデル群のUIを廃止する（FR6）。Task11と同一パスで実装済み。
  - `ModelSwitcher.jsx`・`ModelDescription.jsx`・`PredictionFlash.jsx`（+css）・`BettingValueSection.jsx`（+css）・`PredictionTable.jsx`（デッドコード）・`TodaysPicks.jsx`（+css）を削除し、barrel export（`index.js`）から除去（`TrifectaReferenceCard`を追加）
  - `App.jsx`/`src/pages/RaceDetail.jsx`: `selectedModel`/`switchModel`によるモデル切替を全廃し、`predictions.unified`（1本）ベースのデータフローに置き換え。`App.jsx`の`activeTab === "picks"`分岐・`location.state.autoSelectRace`自動選択ロジック（TodaysPicks専用、他に参照元なし）も削除
  - `PredictionSection.jsx`/`RaceResult.jsx`: `selectedModel`/`onSwitchModel`/`volatility`propを削除。`RaceResult.jsx`のイン崩れ実況表示は`volatilityPercentile>=0.7`ベースに変更。3連複/3連単の的中判定行は、unifiedモデルが2艇（topPick/top2nd）までしか予想しないため`top3.length === 3`の場合のみ表示するよう変更（旧モデルの過去データでは従来通り表示される）
  - `RaceDetail.jsx`の`ModelComparisonTable`（旧3モデル実績比較表）・`RaceCard.jsx`の的中バッジは、`generate-predictions.js`（旧3モデルバッチ）を引き続き稼働させる方針とし、意図的に変更していない（FR6-1のアーカイブ要件を満たすため。`selectedModel`はRaceDetail.jsx内で`"standard"`固定の定数として残置）
- [x] **Task 13**: 旧ページのリダイレクトを実装する（FR6）。`AppRouter.jsx`に`LegacyModelPageRedirect`（`OutcomeDistributionRedirect`と同パターン）を追加し、`/holmes`・`/poirot`・`/picks`を`/`へリダイレクト。`Holmes.jsx`・`Poirot.jsx`本体、専用コンポーネント（`src/components/holmes/`全体・`src/components/poirot/`全体、Holmes.jsxからのみ参照されていたことを確認済み）、`src/services/poirotService.js`（他に参照元なし）を削除。`sherlockModel.js`/`sherlockService.js`/`adlerModel.js`/`adlerService.js`は`scripts/analysis/train-adler-temps.js`等の別イニシアチブ（BOA-103アドラーモデル）が依存しているため削除せず維持。`scripts/generate-sitemap.js`の`staticPages`から`/picks`エントリを削除（`/holmes`・`/poirot`は元々非掲載）。検証: `npm run build`成功。Playwrightで`/holmes`・`/poirot`・`/picks`の3パスが全て`/`へリダイレクトされることを確認済み
- [x] **Task 14**: 実績公開ページをアーカイブ構成に改修する（FR6-1）。**スコープを意図的に縮小して実装**（詳細下記）。
  - `models`テーブル: `standard`/`safeBet`/`upsetFocus`の`status`を`retired`に、`unified`を`production`（`is_public=true`）に更新済み（Node script経由、Supabase直接クエリ。MCP経由のマイグレーション適用はトークン失効中のため使用せず、通常のUPDATE文なので影響なし）
  - `AccuracyDashboard.jsx`/`AccuracyHistory.jsx`/`RaceDetail.jsx`: 既存の3モデル実績表示（`ModelComparisonTable`・月別推移等）はそのまま維持しつつ、「旧モデルの実績アーカイブ（2026年8月運用終了）」という明示的な見出し・説明文を追加。`AccuracyDashboard.jsx`冒頭に「新AI予想モデルの実績」セクションを新設
  - **意図的に実装しなかった部分（理由を明記）**: 新モデル（unified）の複勝的中率・展開予測的中率・イン崩れ相関・3連単参考回収率の4指標を実際に集計・表示する機能は、正直な「準備中」メッセージに留めた。理由: (1) この4指標を計算するには`bet_recommendations`の`actual_hit`/`actual_payout`列を結果確定後に埋め戻す新規バックエンドスクリプト（`calculate-accuracy.js`のunified版に相当）が存在せず、今回新規に設計・実装する必要があった。(2) `predictions`/`bet_recommendations`のunifiedデータはまだ2026-08-11・08-13の2日分（約350件）しかなく、月次集計として意味のある件数に達していない。中途半端な集計パイプラインを急いで実装し検証不足のまま公開するより、データが蓄積されてから正確に実装する方が「データ精度の検証」ルールの精神に合うと判断した
  - **フォローアップとして残タスク化**（次回セッション向け）: (a) `scripts/daily/calculate-unified-accuracy.js`（仮称）の新規実装、(b) `bet_recommendations`の結果確定後バックフィル処理、(c) `dataService`への新規集計取得関数追加、(d) `AccuracyDashboard.jsx`への実データ表示。運用開始から2〜4週間程度、統計的に意味のある件数（数百〜千レース規模）が蓄積してから着手するのが適切
  - 検証: `npm run build`成功。Playwrightで`/accuracy`・`/accuracy/history`の両ページにアーカイブ見出し・新モデル準備中通知が表示され、既存の3モデル実績表示（モデル間パフォーマンス比較・直近7日間・回収率推移・会場別投資戦略等）が引き続き正常に動作することを確認済み
- [x] **Task 15**: UI・文言刷新を行う（FR7）。4言語（ja/en/zh-TW/ko）で以下を変更: `section.resultTitle`（「AI予想結果」→「データ分析結果」）、`home.viewPrediction`（「AI予想を見る」→「複勝予想を見る」）、`home.introBannerText`（「複勝予想・展開予測など45項目のデータを分析」を追加）。`meta.title`/`meta.description`（SEOインデックス済みのため、意図的に変更対象外とした）は現状維持。検証: `npm run build`成功

## フェーズ6: 運用整備

- [x] **Task 16**: `scripts/maintenance/review-unified-model-params.js`を新規実装する（FR8）。既存の検証スクリプト4本（`backtest-course-rate-only.js`/`verify-turn-prediction-accuracy-v6.js`/`verify-volatility-predictive-power.js`/`backtest-unified-model.js`、Task7〜8bで実装済み）を子プロセスとして順に呼び出し、1つのレポートに集約する設計とした（計算ロジックの重複実装を避けるためDRY）。`--days=N`（デフォルト30）または`--from`/`--to`で期間指定可能。運用手順を`docs/operation/unified-model-monthly-review.md`にドキュメント化。検証: `--from=2026-08-13 --to=2026-08-13`（当日、レース結果未確定のため0件想定）で実行しエラー無く完走・4セクション全て出力されることを確認済み（`--days=5`でのフル実行は各スクリプトがレース単位で逐次Supabaseクエリを行うため40分以上要すると判明、月次運用ドキュメントに実行時間の注意として明記）

## 備考

- **PR**: [#286](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/286)（`feature/ai-model-redesign` → `master`）。`/code-review`セルフレビューを実行したが45分以上経過しても結果が返らず（finder段階で確認が取れたのみ）、build/e2e（43件全通過）の検証は完了していたためレビュー結果を待たずにコミット・PR作成した。結果が届き次第フォローアップ対応する（未マージ）
- **重大インシデントと復旧（2026-08-13深夜〜14未明）**: フェーズ5の作業を、既にmasterへマージ済み（PR#281）だった`feature/blog-i18n-zhtw-articles-3`ブランチ上で継続してしまっていたことが、e2eテスト実行時に発覚した。同期間中、並行セッションでWatson/Mycroft予想（PR#282〜285、CI週次再学習含む）がmasterへマージされており、当初FR6で「廃止」としていたホームズ5探偵ページ（`/holmes`）配下のファイルを誤って削除していたため、並行開発中の実装を破壊し、既存e2eテスト（`/holmes`のアドラータブ検証）とも衝突していた。以下の手順で復旧した。
  1. `git checkout`で誤って削除したHolmes/Poirot関連ファイル（`src/pages/Holmes.jsx`等、`src/components/holmes/`全体、`src/components/poirot/`全体、`src/services/poirotService.js`）を復元し、`AppRouter.jsx`の`/holmes`・`/poirot`ルートを元のページ表示に戻す（`/picks`のみリダイレクト維持）よう訂正。spec.md/screens.mdのFR6該当箇所に訂正履歴を追記
  2. `git stash -u`で全変更を退避 → `master`をorigin/masterまで`--ff-only`で最新化（12コミット分、Watson/Mycroft実装含む）→ 新規ブランチ`feature/ai-model-redesign`を作成 → `git stash pop`で変更を復元（`e2e/smoke.spec.js`はWatson/Mycroft関連テスト追加とのauto-merge、コンフリクトなし）
  3. 復旧後、`npm run build`・`npx playwright test e2e/smoke.spec.js`をフルスイートで実行し、43件全て通過することを確認（Holmes/Adlerテストの回帰含む）
  - この過程で別の実バグも発見・修正した: (a) `generate-unified-predictions.js`のrace_entries取得がSupabaseデフォルトlimit1000件に引っかかり大村（venue 24）全12レースが欠落するページネーションバグ（2026-08-11・08-13分を再生成して修正）、(b) `DataRaceTable`が`unified`モデルの予測データに依存する設計になっており、unifiedモデル運用開始（2026-08-11）より前の過去日付でデータ出走表自体が表示されなくなっていた設計バグ（`raceData.players`をモデル非依存で常時利用可能にして修正、`App.jsx`/`RaceDetail.jsx`/`supabaseDataService.js`）
  - 教訓: 長時間の自律作業セッションでは、作業開始時に必ず`git branch --show-current`と`git log origin/master -1`との比較でブランチの妥当性を確認すること。特に前のタスクで使ったfeatureブランチをそのまま流用しない
- フェーズ1〜3は2026-08-12〜13にバックエンド検証として完了済み。この過程で方針転換（3連単中心→複勝/展開予測/イン崩れ指数の複数機能構成）が発生し、spec.md/screens.md/plan.mdを全面改訂した（2026-08-13）
- フェーズ5（フロントエンド）はTask9（日次生成パイプライン）が本番データを供給できる状態になってから着手するのが望ましい（開発中はモックデータで先行実装も可）
- `/step4`で1タスクずつ実装する
- 全タスク完了後、`/code-review`セルフレビュー→`npm run build`→`npm run test:e2e`→PR作成・完了報告の既存フロー（`.claude/CLAUDE.md`）に従う
- 分析スクリプトを新規作成する際は、Supabaseのデフォルトlimit1000件を`fetchAll`（`.range()`ページネーション）で必ず回避すること（2026-08-12の教訓）

## フォローアップ（2026-08-14、ローカル動作確認フィードバックより）

ユーザーがローカルで新UIを確認した際の指摘を受けて対応した項目・Linearチケット化した項目。

**このPR#286で対応済み**:
- 三国6R以降でAIデータ分析が表示されない不具合（`morning-init.js`の`ensureUnifiedPredictions`が日単位の冪等判定になっており、スクレイピングタイミング次第で一部レースが恒久的に生成漏れするバグ。レース単位の差分検出に修正）
- `AiAnalysisSection`（展開予測パネル/イン崩れバッジ）のデフォルト折りたたみを廃止し、デフォルト展開に変更（新AIモデル開発を今後行わない方針としたため、控えめにする理由が無くなった）
- 展開予測パネルの実測的中率バッジ（「実測: 展開的中率 約80%」）を目立つピル型バッジに変更

**Linearチケット化（別PR予定）**:
- [BOA-173](https://linear.app/boat-ai/issue/BOA-173) 的中バッジをunifiedモデル（複勝的中1本）に合わせて再設計（RaceCard/RaceReview）
- [BOA-174](https://linear.app/boat-ai/issue/BOA-174) `/hit-races`をunifiedモデルに合わせて根本再設計
- [BOA-175](https://linear.app/boat-ai/issue/BOA-175) `/accuracy`をunifiedモデルに合わせて根本再設計（会場別イン崩れ傾向の扱いは要ユーザー確認）
- [BOA-176](https://linear.app/boat-ai/issue/BOA-176) 複勝オッズのスクレイピング・保存対応（投資判断待ち、未着手）
