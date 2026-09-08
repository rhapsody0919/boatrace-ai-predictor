# 企画型パイプライン フェーズA運用手順（対象レース検出・買い目生成）

`docs/design/sns-hub-campaign-pipeline/spec.md`のパイロット企画
「龍神レーダーのAIに900円を託してみた——イン崩れ99%レースだけ1週間」の運用手順。

## 実行タイミング

**毎朝、その日のレースが始まる前に実行する。** 日中に実行すると、既に結果が確定した
レースを検出してしまう可能性があるため（企画の前提「結果が出る前に賭ける」に反する）。
`scripts/daily/campaign-detect-and-generate.js`は確定済みレースを必ず除外する安全チェックを
持つが、対象レースを取りこぼさないためにも朝の実行を基本とする。

1日に複数レースが対象条件を満たすことは想定通り（1日1件とは限らない）。

## 実行コマンド

```bash
node --env-file=.env.local scripts/daily/campaign-detect-and-generate.js [YYYY-MM-DD]
```

日付を省略すると本日（実行時点のサーバー日付）が対象になる。

## 処理内容

1. `sns_campaigns.status='active'`の企画を全件取得する
2. 各企画の`selection_criteria`（例: `{metric:'volatilityPercentile', operator:'>=', value:0.99}`）を、
   対象日の`predictions.feature_contributions`と照合し、条件を満たすレースを検出する
   （`predictions`は同一race_idに複数行が存在しうるため、`predicted_at`最新の1件のみを見る）
3. 既に`race_results`が確定しているレース、既に同企画でエントリ済みのレースは除外する
4. 対象レースについて`race_entries`（6艇分の勝率・モーター2連率）と
   `feature_contributions.turnPrediction`（1マーク展開予測）を取得し、
   `scripts/lib/campaignVolatilityModel.js`の`computeCampaignPicks()`で買い目
   （1号艇を除いた5艇のうち上位3艇、3連単3点）を生成する
5. `sns_campaign_entries`を1件作成し、同時に`sns_topics`（`venue-feature`型、
   `requires_topic_approval=true`）を作成して`campaign_id`を紐付ける
   （人間承認が必要な状態で作成される。自動承認はしない）

## 買い目生成モデルについて

当初spec.mdは「AI用コピペプロンプトを人間がAIに貼り付けて回答を得る」運用を想定していたが、
バックテスト（`scripts/analysis/campaign-backtest-*.js`、463レース・3週間分）で実際のAI都度判断が
決定的な計算式モデルより明確に劣ることが判明した（回収率27.2% vs 94.3%〜130.5%、詳細は
[PR #594](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/594)参照）ため、
買い目生成は`campaignVolatilityModel.js`のアルゴリズムで自動化している。
`sns_campaign_entries.ai_model_name`には実際のAIモデル名（'claude-sonnet-5'等）ではなく、
実態を正直に示す`'volatility-v5-stats-x-turnprediction'`を記録する。

## 人間の作業

作成された`sns_topics`は「ネタ承認」画面（sns-hub管理画面）に承認待ちとして現れる。
承認すると、対象チャネル（x/blog）の生成Routineがポーリングして下書きを作成する
（チャネル側の連携詳細はタスク8、別PRで対応予定）。

## 既知の注意点

- **朝以外の時間帯に手動実行する場合は要注意**: 2026-09-08の試験実行で、日中実行により
  結果確定済みレースを検出し登録しかけたことがある。`getRaceIdsWithResults()`が確定済み
  レースを除外するため実害は無いが、対象レースの取りこぼし（レース開始後は検出対象から
  漏れる可能性）は防げないため、朝の実行を徹底する
- 1レースのエントリ作成に失敗しても、他の対象レース・他の企画の処理は継続する
  （ログにエラーを出力してスキップする）
