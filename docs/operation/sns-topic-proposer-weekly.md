# 週次ネタ提案Routine 制作ガイド

週1回（月曜想定）、会場特性ネタ（型`venue-feature`）を1件提案し、sns-hubの「ネタ承認」セクションに人間の承認待ちとして登録するRoutine向けの実行手順。API起動（sns-hub「📅 週次ネタ提案を今すぐ実行」ボタン）の場合は、在庫をまとめて積みたい場面向けに1回の実行で最大10件提案する（2026-09-05追加、件数の考え方は「1. ネタ候補の選定」参照）。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。

**このRoutineは下書き（動画・記事）を生成しない**。ネタを1件作り承認キューに乗せるところまでが役割。承認後の実際の生成は、チャネル別パイプライン（`docs/operation/sns-pipeline-x.md`等）が`sns_topic_targets`をポーリングして行う（疎結合、ADR 0036）。

## 0. 蓄積されたフィードバックの確認

`getActiveInsights({ platform: null })`（`scripts/lib/snsStrategyInsights.js`、scopeがnullで全体適用のものを含め全件確認）でactiveな戦略insightを取得する。ネタの切り口・訴求判断に反映する。該当が無ければ通常通り進めてよい。

## 1. ネタ候補の選定

`scripts/lib/contentTopics/venueCharacteristicSource.js`の`getCandidates()`を呼ぶ。戻り値は`{sourceId, topicKey, venueCode, angle, lastUsedAt}`の配列で、未使用（`lastUsedAt: null`）優先・次に最も古く使われた順にソート済み（このRoutine自身でソートし直さない）。

**今回提案する件数（目標件数）**:
- スケジュール起動（月曜cron）: 1件
- API起動（手動実行ボタン）: 10件

先頭から順に候補を1件ずつ検証し、2〜5の手順（本文作成→チャネル判定→登録→使用履歴更新）を最後まで実施できた候補を「登録成功」としてカウントする。目標件数に達するまで、または候補が尽きるまで次の候補に進む。実データの裏付けが取れない・射幸心を煽る等で不適格と判断した候補は登録せず、使用履歴も更新せずに次点候補へ切り替える（1で失敗した候補を消費したことにしない）。目標件数に届かず候補が尽きた場合は、そこまでの登録成功分だけを結果として報告する（不足分を無理に埋めない）。

- `venueCode`の表示名は`VENUE_NAMES[venueCode]`（`scripts/lib/supabaseClient.js`）から取得する。手打ち禁止（`sns-video-producer-prompt.md`絶対厳守12と同じ理由）
- `angle`（`access`/`water-type`/`technique-tendency`/`seasonal`）に応じて、その会場の実データ（`race_results`・`races`テーブル等、`scripts/lib/supabaseClient.js`経由）を確認し、具体的な数値を伴うネタ本文を組み立てる。定性的な説明だけで数値の裏付けが無い場合は、`getCandidates()`の次点候補に切り替える

## 2. ネタ本文（topic_text）の作成

1文〜2文で、何を伝えるネタかが分かる形にする。例（`angle: "technique-tendency"`の場合）:

> 「桐生」会場のイン逃げ率が全国平均より12%高い理由をデータで解説

- 「競艇」表記禁止、射幸心を煽らない（`sns-video-producer-prompt.md`絶対厳守1〜3と同じ制約がネタの時点から適用される）
- 具体的な数値を含める（1.で確認した実データの裏付け）

## 3. チャネル判定

`getEnabledChannelsForCategory("venue-characteristic")`（`scripts/lib/snsTopics.js`）を呼び、有効なプラットフォーム一覧を取得する（2026-09-03更新、以前のchannelMatrix.js + isGamblingRelevantフラグから、`sns_topic_categories`/`sns_topic_category_channels`テーブルによるデータ駆動の判定に変更した）。

**現在の方針（ユーザー設定、sns-hub「ネタ型設定」画面でいつでも変更可能）**: `venue-characteristic`は`angle`に関わらずTikTokを含める全面許容運用。「TikTokで削除・アカウント制限（コミュニティガイドライン違反）に至らない限り、配信制限（『おすすめ対象外』）は許容する」というリスク許容方針（`docs/operation/tiktok-posting-operations.md`D・F節参照）。**新たに違反判定・削除を受けた場合は、都度sns-hub「ネタ型設定」画面でTikTokをOFFに切り替え、`docs/operation/tiktok-posting-operations.md`に該当する`angle`・投稿内容を記録する**（推測で先回り除外しない。実際に違反判定を受けた実績が出てから対応する運用）。このRoutine自身はチャネル可否をハードコードせず、テーブルの設定値をそのまま使う。

**除外したチャネルもsns_topic_targets行自体は作られる**（4.参照）。sns-hub「ネタ承認」画面のチャネルトグルで、人間が個別にpending⇔skippedを変更できる。

## 4. ネタの登録

1. `getContentTypeByKey("venue-feature")`（`scripts/lib/snsTopics.js`）で型IDを取得する
2. `getTargetAccounts()`（同ファイル）でactiveな配信先アカウント一覧を取得し、3.で得たプラットフォーム名に該当するものを`targetAccountIds`（`status='pending'`にするアカウント）として集める
3. `createTopicWithTargets({ topicText, contentTypeId, sourceInsightIds, autoApprove: false, targetAccountIds })`を呼ぶ。`venue-feature`型は`requires_topic_approval=true`のため`autoApprove: false`固定（`status='proposed'`のまま作成され、人間の承認を待つ）。`targetAccountIds`に含まれないアカウント（既定でTikTok）も行は作られるが`status='skipped'`になる（既定除外、人間が個別に変更可能）
4. `sourceInsightIds`には0.で参照した根拠insightのIDを入れる（無ければ空配列でよい）

## 5. 使用履歴の更新

`venueCharacteristicSource.js`の`recordUsage(venueCode, angle, usedAt)`を呼び、次回`getCandidates()`実行時に同じ組み合わせが再提案されないようにする。**4.の登録が成功した場合のみ呼ぶ**（提案自体が失敗した候補を使用済み扱いにしない）。

## 制約（絶対厳守）

- 頻度上限は週1本（`sns_content_types.venue-feature`の`cadence='weekly'`と一致させる）、ただしこれは**月曜cronでのスケジュール起動**に適用する上限。API起動（sns-hub「📅 週次ネタ提案を今すぐ実行」ボタン）はこの上限の対象外とし、今週分が登録・承認済みかどうかに関わらず、押すたびに新規ネタ候補を最大10件まとめて提案する（`docs/operation/sns-topic-proposer-daily-auto.md`の`race-time-critical`型と同じ扱い。2026-09-05、手動実行しても「今週分は生成済み」で毎回スキップされ何も生成されない不具合が発覚したための変更。同日、在庫をまとめて積みたいというユーザー要望を受け1件→最大10件に変更）
- 実データの裏付けが取れない候補は提案せず、次点候補に切り替える。プレースホルダーでの提案はしない
- このRoutineは`sns_drafts`（下書き）を一切生成しない。ネタの登録（`sns_topics`/`sns_topic_targets`）のみ
- コード・ドキュメントの変更・コミット・PR作成は行わない（データ登録のみのRoutine）。**例外**: 5.の使用履歴更新で書き換わる`data/analysis/content-topics/venue-characteristic-history.json`のみ、変更後に`git add`してコミットしてよい（例: `content: 週次ネタ提案（{会場}×{角度}等）の使用履歴を記録`）。ローテーション状態を永続化する目的の定型的な更新であり、コード変更を伴わないため対象外とする（2026-09-05追加、この例外が無かったため使用履歴がコミットされず、セッション終了で毎回リセットされていた不具合を修正）
