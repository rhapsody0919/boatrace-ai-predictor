# 展開予測・イン崩れ指数の棚卸し（BOA-822 の前提）

コードとマイグレーションのファイルから読んだもの（本番DB は未確認。Supabase MCP が接続できなかった）。spec の前提として使う。

## 計算と保存

- どちらも `scripts/daily/generate-unified-predictions.js:311-373` が朝に1回計算する（起動元 `scripts/lib/racesInit/job.js:140`・`morning-init.js:321`）。進入は枠なり、展示ST は使わない。展示後に作り直す処理は無い
- 保存先は `predictions`（`model_id='unified'`）の `feature_contributions`
  - 展開予測: `turnPrediction`（`patterns[≤3]`・`distribution`・`boatStrengths`）。的中は `predictions.is_hit_turn`（`scripts/lib/hitCalculator.js`）
  - イン崩れ指数: `volatilityComposite`（0〜1）・`volatilityPercentile`（0〜1、同じ会場の直近90日の中の順位）・`volatilityPercentileIsFallback`（20件未満で 0.5）・`volatilityReasons`（最大3件）
- 読み出し: RPC `get_predictions_by_date(_light)`（最新 109）・`get_today_races`（最新 110）→ `supabaseDataService.js:1062-1171`
- 実績の保存: `calculate-unified-model-accuracy.js`（`accuracy_cache.unified_model_accuracy`）・`calculate-unified-volatility-accuracy.js`（`unified_volatility_accuracy`）・`update-race-history-cache.js`（`race_history_cache`）・`morning_digest_rows.volatility_percentile`
- 旧ロジック: `generate-predictions.js:103-243` が今も `races.volatility_score / volatility_level / recommended_model / volatility_reasons / first_boat_avg_st` を書く。画面からは読まれていない（読み手は `calculate-accuracy.js:180`・`update-today-recommended-models.js`）

## イン崩れ指数の式（`scripts/lib/volatilityFactors.js:69-211`）

| 因子 | 重み | 換算 |
|---|---|---|
| 1号艇の全国勝率 | 0.42 | `1-wr/8.5` |
| 1号艇の平均ST（当サイトに蓄積した全期間、`racer_aggregated_stats.avg_st`） | 0.38 | `(st-0.07)/0.27` |
| AI逃げ確率（`turnPrediction.distribution.nige`） | 0.12 | `1-(p-0.2)/0.79` |
| 6艇の勝率のσ | 0.05 | `(σ-0.06)/2.69` |
| 会場の1コース勝率（静的値） | 0.03 | `1-(r-0.43)/0.19` |

- 使えた因子の重みで正規化。8会場で重みの上書きあり（:22-31）
- 段階（`src/utils/volatilityLevel.js`）: 0.7 以上「イン崩れ注意（高）」、0.3 以下「本命有利」、間は標準
- **イン崩れ指数は展開予測に依存する**（AI逃げ確率）。展開予測の計算を消すと値が変わる
- 平均ST が全期間なのは `docs/design/avg-st-definition/mock/APPROVED.md`（全期間の平均ST は全画面でやめる）と食い違う

## 表示している場所

| 機能 | 場所 |
|---|---|
| 展開予測 | AI予想タブ（発走前 `RaceAiPredictionTab.jsx:232-245`、確定後の答え合わせ `:182-201`）、レース一覧の的中バッジ（`RaceCard.jsx:59-75`）、`/hit-races`（`HitRaces.jsx`・`hits/*`）、`/accuracy`（`AccuracyDashboard.jsx:70-166`）、`/races` の日別的中率（`RaceHistory.jsx`）、シェア文（`share.js:298-410`）、AIコピー（`aiCopyText.js:110-155`）、About・FAQ・HowToUse・`HomeAiIntro.jsx` の「的中率約79%」等 |
| イン崩れ指数 | AI予想タブ（発走前 `VolatilityDisplay.jsx`、確定後の併記 `RaceAiPredictionTab.jsx:98-178`）、レース一覧のバッジと色線（`RaceCard.jsx:28-56`）、ホームの今日の上位・下位（`TodaysVolatilityHighlights.jsx`）、`/accuracy`・`/winning-technique?tab=volatility`（`VolatilityAccuracyChart`）、`/today`（`DigestRaceCard.jsx`・`FeaturedRaceCard.jsx`）、AIコピーのプロンプト選択（`aiCopyPrompts.js`）、HowToUse・FAQ・About・ブログ（volatility-*.json 7件）、SNS（`todays-volatility-digest.js`・`generate-morning-digest.js`・`campaign-detect-and-generate.js`・`campaignVolatilityModel.js`・`post-x-animation.js`） |

## 展開予測を消すと道連れになるもの

- イン崩れ指数の値（AI逃げ因子）
- `PredictionCard`（statKey `turn`）・`AccuracyStatBadge`
- `/hit-races` 全体（的中の定義が展開予測）、RaceCard の的中/外れバッジ、`/accuracy` の大きい数字、`/races` の日別的中率、「約79%」の文言
- `raceOutcome.js` の `TURN_JUDGEMENT`・`judgeTurnPrediction`（他の関数は残す）
- 結果確定後のシェア文（`panel.shareTurnHit.*`）、AIコピーの展開予測の節
- 共通の決まり手名 `TECHNIQUE_NAMES`（`src/utils/turnPrediction.js:7`）は `raceIndicators.jsx` も使う → 移す
- 計算ごと消す場合はさらに: AI予想の統合モデル（`unifiedModel.js:227-262`。展開パターンごとに1着を固定して2着・3着を決める）、`generate-unified-trifecta-reference.js`、SNS 企画の買い目（`campaignVolatilityModel.js`、展開予測に出た艇を3倍に優遇）

## 龍神ソナー・思考アシストとの重なり（計算は別物）

| 問い | 展開予測・イン崩れ指数 | ソナー・思考アシスト |
|---|---|---|
| 1号艇は飛ぶか | イン崩れ指数 | 思考アシスト「このレースは堅い？荒れる？」（`RoughCard.jsx`、`assistModel.js:114`。級の並びが同じレースの1号艇の1着率と万舟率、全国との比較） |
| 1号艇は逃げるか | 展開予測の逃げ確率 | 思考アシストの軸「1号艇は逃げる？」 |
| どう決まるか | 展開予測の決まり手の分布 | ソナーの展開シナリオ（進入の型・スリットの形ごとの1号艇の1着率、決まり手） |
| 2着・3着 | 展開予測の `secondPlace/thirdPlace` | 思考アシストの `WinFollowers`（BOA-831） |
| 会場の1号艇の強さ | 指数の会場因子 | 思考アシストの `VenueSheet`・`assistTheory.js:236` |

ソナー・思考アシストは turnPrediction・イン崩れ指数を参照していない。思考アシストは ja のみ、AI予想タブは4言語。

## 追記（セカンドオピニオン指摘8・9）

- ブログ: `public/blog` で展開予測に触れる記事は ja 41本（4言語で65ファイル）、`/hit-races`・`/accuracy` へのリンクは55ファイル。自然検索の記事1位 rough-race-signals（イン崩れ指数）・2位 first-mark-prediction-guide（展開予測）、`/about`（「展開予測的中率約79%」About.jsx:242,312）
- 動画: `sns-video-studio/remotion/src/` の13作品（AboutHeroCM・AccuracyProofCM・AnswerCheckHookCM・LivePredictionCM 系・MorningDigestCM・CampaignEntryCard など）
- `public/llms.txt` の記事の説明文
- URL: `/accuracy`・`/hit-races`・`/accuracy/history` は sitemap に載り、`/hit-races` は Header のナビにある。`/accuracy` はほぼ全部が展開予測とイン崩れの実績
- 検証スクリプト: verify-prediction-hit-judgement・verify-hit-verification-guidance・verify-race-outcome・verify-ai-copy-text（verify-registry.json）、`is_hit_turn` を書く scrape-results.js・backfill-is-hit-turn.js
- 統合モデルの2着3着: 3連単参考の表示は 2026-08-14 に廃止済み（PredictionPanel.jsx:8-9）。画面に出る統合モデルの出力は本命（出現パターンが使う）と `/accuracy/history`。残す理由は spec で利用先を列挙して決める
