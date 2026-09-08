# 企画型パイプライン フェーズB運用手順（結果確定後の実績書き戻し）

`docs/design/sns-hub-campaign-pipeline/spec.md`のパイロット企画
「龍神レーダーのAIに900円を託してみた——イン崩れ99%レースだけ1週間」の運用手順。

## 実行タイミング

対象レースが終了し、`race_results`が確定した後に実行する。1日の全レースが終わったタイミング
（夜）でまとめて実行すれば、その日に作成された全エントリの結果を一度に処理できる。

## 実行コマンド

```bash
node --env-file=.env.local scripts/daily/campaign-backfill-results.js
```

## 処理内容

1. `sns_campaigns.status='active'`の企画を全件取得する
2. 各企画の`sns_campaign_entries`のうち`actual_result`が未確定（null）のものを取得する
3. 対応する`race_results`を取得し、確定していれば以下を計算する:
   - `actual_result`: 実際の着順（例: `"2-1-4"`）
   - `hit`: `ai_picks`（3連単3点）のいずれかが実際の着順と一致するか
   - `payout_yen`: 的中時は`race_results.payout_trio`列（⚠️列名は"trio"だが実態は
     3連単の払戻。`scripts/lib/payoutCalculator.js`の既知の罠を参照）から計算。
     不的中・未確定時は0
   - `cumulative_net_yen`: この企画内で、このエントリより前に作成された全エントリの
     収支合計＋このエントリの収支
4. `sns_campaign_entries`をUPDATEする

## 人間の作業

書き戻された`actual_result`/`hit`/`payout_yen`/`cumulative_net_yen`は、対象チャネル
（x/blog）の生成Routineが「前回までの結果を踏まえた本文」を書く際のデータ源になる
（タスク8、別PR対応予定）。人間が直接この結果を編集する必要は無い。

## 企画終了時の扱い

`duration_days`経過後、`sns_campaigns.status`を`'completed'`に手動で更新する
（自動化はしない。最終まとめ投稿の内容を人間が確認してから区切りたいため）。
