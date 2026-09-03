# 週次ネタ提案Routine 制作ガイド

週1回（月曜想定）、会場特性ネタ（型`venue-feature`）を1件提案し、sns-hubの「ネタ承認」セクションに人間の承認待ちとして登録するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。

**このRoutineは下書き（動画・記事）を生成しない**。ネタを1件作り承認キューに乗せるところまでが役割。承認後の実際の生成は、チャネル別パイプライン（`docs/operation/sns-pipeline-x.md`等）が`sns_topic_targets`をポーリングして行う（疎結合、ADR 0036）。

## 0. 蓄積されたフィードバックの確認

`getActiveInsights({ platform: null })`（`scripts/lib/snsStrategyInsights.js`、scopeがnullで全体適用のものを含め全件確認）でactiveな戦略insightを取得する。ネタの切り口・訴求判断に反映する。該当が無ければ通常通り進めてよい。

## 1. ネタ候補の選定

`scripts/lib/contentTopics/venueCharacteristicSource.js`の`getCandidates()`を呼ぶ。戻り値は`{sourceId, topicKey, venueCode, angle, lastUsedAt}`の配列で、未使用（`lastUsedAt: null`）優先・次に最も古く使われた順にソート済み。**先頭の1件を選べばよい**（このRoutine自身でソートし直さない）。

- `venueCode`の表示名は`VENUE_NAMES[venueCode]`（`scripts/lib/supabaseClient.js`）から取得する。手打ち禁止（`sns-video-producer-prompt.md`絶対厳守12と同じ理由）
- `angle`（`access`/`water-type`/`technique-tendency`/`seasonal`）に応じて、その会場の実データ（`race_results`・`races`テーブル等、`scripts/lib/supabaseClient.js`経由）を確認し、具体的な数値を伴うネタ本文を組み立てる。定性的な説明だけで数値の裏付けが無い場合は、`getCandidates()`の次点候補に切り替える

## 2. ネタ本文（topic_text）の作成

1文〜2文で、何を伝えるネタかが分かる形にする。例（`angle: "technique-tendency"`の場合）:

> 「桐生」会場のイン逃げ率が全国平均より12%高い理由をデータで解説

- 「競艇」表記禁止、射幸心を煽らない（`sns-video-producer-prompt.md`絶対厳守1〜3と同じ制約がネタの時点から適用される）
- 具体的な数値を含める（1.で確認した実データの裏付け）

## 3. チャネル判定

`scripts/lib/contentChannels/channelMatrix.js`の`getChannelsForTopic("venue-characteristic")`を呼び、対象プラットフォーム一覧を取得する（現状`["blog", "note", "x", "youtube"]`、TikTokは既定で対象外——成績データを扱う性質上、TikTokガイドライン対応のため。詳細はコメント参照）。

**TikTok可否の個別ネタ判定（2026-09-03更新）**: `angle`が`access`（アクセス）等の勝率・決まり手等の成績データを一切含まない切り口の場合のみ、`getChannelsForTopic("venue-characteristic", { isGamblingRelevant: false })`を呼びTikTokも含める。`technique-tendency`（決まり手傾向）・`water-type`（水面特性が展開・決まり手に直結する場合）等、成績・確率に触れる切り口は`isGamblingRelevant`を渡さず既定（除外）のままにする。判断に迷う場合は安全側（除外）に倒す。

**除外したチャネルもsns_topic_targets行自体は作られる**（4.参照）。TikTokを既定除外にしても、そのネタが実際には安全だと人間が判断すれば、sns-hub「ネタ承認」画面のチャネルトグルで個別にpendingへ変更できる。

## 4. ネタの登録

1. `getContentTypeByKey("venue-feature")`（`scripts/lib/snsTopics.js`）で型IDを取得する
2. `getTargetAccounts()`（同ファイル）でactiveな配信先アカウント一覧を取得し、3.で得たプラットフォーム名に該当するものを`targetAccountIds`（`status='pending'`にするアカウント）として集める
3. `createTopicWithTargets({ topicText, contentTypeId, sourceInsightIds, autoApprove: false, targetAccountIds })`を呼ぶ。`venue-feature`型は`requires_topic_approval=true`のため`autoApprove: false`固定（`status='proposed'`のまま作成され、人間の承認を待つ）。`targetAccountIds`に含まれないアカウント（既定でTikTok）も行は作られるが`status='skipped'`になる（既定除外、人間が個別に変更可能）
4. `sourceInsightIds`には0.で参照した根拠insightのIDを入れる（無ければ空配列でよい）

## 5. 使用履歴の更新

`venueCharacteristicSource.js`の`recordUsage(venueCode, angle, usedAt)`を呼び、次回`getCandidates()`実行時に同じ組み合わせが再提案されないようにする。**4.の登録が成功した場合のみ呼ぶ**（提案自体が失敗した候補を使用済み扱いにしない）。

## 制約（絶対厳守）

- 頻度上限は週1本（`sns_content_types.venue-feature`の`cadence='weekly'`と一致させる）
- 実データの裏付けが取れない候補は提案せず、次点候補に切り替える。プレースホルダーでの提案はしない
- このRoutineは`sns_drafts`（下書き）を一切生成しない。ネタの登録（`sns_topics`/`sns_topic_targets`）のみ
- コード・ドキュメントの変更・コミット・PR作成は行わない（データ登録のみのRoutine）
