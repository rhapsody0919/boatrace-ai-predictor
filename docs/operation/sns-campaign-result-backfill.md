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
5. **運用フロー③（結果発表投稿）**: 4.で結果を書き戻した各エントリについて、
   `createResultAnnouncementTopic()`（`scripts/lib/snsCampaigns.js`）で「結果発表」用の
   `sns_topics`（`venue-feature`型）を1件作成する。Phase A（対象レース検出時）が
   作る「事前の買い目発表」（運用フロー②）とは別の、2件目のネタになる。
   `sns_campaigns.tone_spec.autoApproveTopics`が`true`ならネタ承認は自動化される
   （Phase Aと同じ、下記「人間の作業」参照）
6. **運用フロー④（企画終了時の最終まとめ投稿）**: `start_date + duration_days`が経過し、
   かつ企画内の全エントリの結果が確定済みなら、`createResultAnnouncementTopic()`で
   最終まとめ用の`sns_topics`を1件作成し、`sns_campaigns.status`を`'completed'`に
   更新する。以後`getActiveCampaigns()`の対象から外れるため、この処理は企画ごとに
   実質1回しか実行されない

## 人間の作業

`sns_campaigns.tone_spec.autoApproveTopics`が`false`（既定）の企画では、作成された
「結果発表」「企画終了まとめ」の`sns_topics`は通常のネタと同じくsns-hub管理画面の
「ネタ承認」で人間が確認・承認する。`true`の企画（パイロット企画はこちら、
2026-09-09ユーザー承認済み）ではこのネタ承認自体は自動化される。

承認後（または自動承認後）の本文生成は対象チャネル（x/blog）の生成Routineが担う。
過去エントリを踏まえた継続性のある本文の書き方は`docs/operation/sns-pipeline-x.md`
「2. 企画（キャンペーン）由来のネタの場合」を参照。

**ネタ承認の自動化と、実際の投稿承認は別レイヤー**であることに注意する。
`autoApproveTopics`はあくまで「このネタを本文生成の対象にしてよいか」の自動化で
あり、生成された実際のX画像・ブログ記事（`sns_drafts`）の投稿承認は、この設定に
関わらず常に人間がsns-hub管理画面で行う（`.claude/CLAUDE.md`「SNS投稿の自動化・
自動承認は行わない」、企画由来のブログ下書きが`finalize-blog-draft.js`の自動マージ
対象外になっているのも同じ理由、PR #594参照）。
