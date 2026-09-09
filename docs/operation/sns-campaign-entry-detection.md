# 企画型パイプライン フェーズA運用手順（対象レース検出・買い目生成）

`docs/design/sns-hub-campaign-pipeline/spec.md`のパイロット企画
「龍神レーダーのAIに900円を託してみた——イン崩れ99%レースだけ1週間」の運用手順。

## 実行タイミング（2026-09-09〜自動化済み）

`.github/workflows/campaign-pipeline.yml`がJST 6:00〜23:59の間30分おきに自動実行する
（`workflow_dispatch`で手動実行も可能）。予測（`predictions.feature_contributions`）は
発走が近いレースから順次生成されるため（`scrape-scheduled.yml`が約5分おきに対象ウィンドウの
レースだけ再取得・再予測する設計）、朝1回だけでは対象レースを取りこぼす。1日を通して
繰り返し実行することで、予測が出そろい次第すぐ検出できるようにしている。

既に`race_results`が確定しているレースは`getRaceIdsWithResults()`で必ず除外する安全チェックを
持つため（企画の前提「結果が出る前に賭ける」に反しないため）、日中・夜間に何度実行しても
問題ない。既存エントリの有無でもスキップするため、同じレースを重複登録することもない。

1日に複数レースが対象条件を満たすことは想定通り（1日1件とは限らない）。

## 実行コマンド（手動実行・デバッグ用）

```bash
node --env-file=.env.local scripts/daily/campaign-detect-and-generate.js [YYYY-MM-DD]
```

日付を省略すると本日（JST、`scripts/lib/dateUtils.js`の`getTodayDateJST()`）が対象になる
（2026-09-09、UTC基準の`toISOString()`を使っていたためJST 0-9時台の実行で前日日付になって
しまっていた不具合を修正済み。GitHub Actionsでの1日複数回実行では必ず踏む時間帯のため、
自動化と合わせて対応した）。

## 処理内容

1. `sns_campaigns.status='active'`の企画を全件取得する
2. 各企画の`selection_criteria`（例: `{metric:'volatilityPercentile', operator:'>=', value:0.985}`。単一条件だけでなく
   配列（AND結合の複合条件）も指定できる、`findQualifyingRaces()`のJSDoc参照）を、
   対象日の`predictions.feature_contributions`と照合し、条件を満たすレースを検出する
   （`predictions`は同一race_idに複数行が存在しうるため、`predicted_at`最新の1件のみを見る）
   ⚠️ パイロット企画の`value`は0.985であり0.99ではない。ホーム画面
   （`TodaysVolatilityHighlights.jsx`）が`Math.round(値×100)`で四捨五入して
   「99%」と表示するため、生の閾値は「表示上99%以上に見えるレース」の下限
   （98.5%）に合わせている（2026-09-09、稼働中にユーザー指摘で調整。詳細は
   `scripts/maintenance/create-campaign.js`のコメント参照）
3. 既に`race_results`が確定しているレース、既に同企画でエントリ済みのレースは除外する
4. 対象レースについて`race_entries`（6艇分の勝率・モーター2連率）と
   `feature_contributions.turnPrediction`（1マーク展開予測）を取得し、
   `scripts/lib/campaignVolatilityModel.js`の`computeCampaignPicks()`で買い目
   （1号艇を除いた5艇のうち上位3艇、3連単3点）を生成する
5. `sns_campaign_entries`を1件作成し、同時に`sns_topics`（`venue-feature`型、
   `requires_topic_approval=true`）を作成して`campaign_id`を紐付ける
   （ネタ承認: `sns_campaigns.tone_spec.autoApproveTopics`が`true`の企画は
   `status='approved'`で作成される。falseの企画は人間承認が必要な状態
   （`status='proposed'`）で作成される。**ネタ承認とは別レイヤーの「下書き
   （実際のX画像・ブログ記事）の投稿承認」は、この設定に関わらず常に人間が行う**、
   `.claude/CLAUDE.md`「SNS投稿の自動化・自動承認は行わない」参照）

## 買い目生成モデルについて

当初spec.mdは「AI用コピペプロンプトを人間がAIに貼り付けて回答を得る」運用を想定していたが、
バックテスト（`scripts/analysis/campaign-backtest-*.js`、463レース・3週間分）で実際のAI都度判断が
決定的な計算式モデルより明確に劣ることが判明した（回収率27.2% vs 94.3%〜130.5%、詳細は
[PR #594](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/594)参照）ため、
買い目生成は`campaignVolatilityModel.js`のアルゴリズムで自動化している。
`sns_campaign_entries.ai_model_name`には実際のAIモデル名（'claude-sonnet-5'等）ではなく、
実態を正直に示す`'volatility-v5-stats-x-turnprediction'`を記録する。

## 人間の作業

作成された`sns_topics`は、`autoApproveTopics`が`false`の企画では「ネタ承認」画面
（sns-hub管理画面）に承認待ちとして現れるため、人間が確認・承認する。`true`の企画
（パイロット企画はこちら）ではこのネタ承認自体が自動化されるため、承認操作は不要。

承認（または自動承認）後、対象チャネル（x/blog）の生成Routineが自律的にポーリングして
下書きを作成する（`sns_topic_targets.claimed_by`に`x-pipeline-*`等の識別子が記録される、
既存のsns-topic-gate基盤がそのまま機能する。企画固有の追加対応は不要）。人間が行うのは、
生成された下書き（X画像・ブログ記事）の投稿承認のみ（常に必須、`.claude/CLAUDE.md`
「SNS投稿の自動化・自動承認は行わない」）。

## 既知の注意点

- 1レースのエントリ作成に失敗しても、他の対象レース・他の企画の処理は継続する
  （ログにエラーを出力してスキップする）
- GitHub Actionsのcronは正確な時刻に発火しない場合がある（数分の遅延は許容する設計）
