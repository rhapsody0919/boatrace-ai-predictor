# 日次・一般ネタ自動提案Routine 制作ガイド

毎日（深夜〜早朝想定）、当日の成績データから日次ネタ（型`daily-auto`）を1件提案し、**人間の承認を経ずに**そのまま承認済み扱いで登録するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。

**この型はネタ承認を経ない設計**（`sns_content_types.daily-auto`の`requires_topic_approval=false`）。人間が朝セッションを開いた時点で、既にチャネル別パイプラインが生成した下書きが承認待ちになっている状態を目指す。ネタ選定ロジックの質が承認レス運用の前提になるため、実データの裏付けを他の型以上に厳密に確認すること。

**このRoutineは下書き（動画・記事）を生成しない**。ネタを1件作り、対象チャネルの`sns_topic_targets`を`pending`状態で用意するところまでが役割。実際の生成はチャネル別パイプライン（`docs/operation/sns-pipeline-x.md`等）が行う。

## 0. 蓄積されたフィードバックの確認

`getActiveInsights({ platform: null })`（`scripts/lib/snsStrategyInsights.js`）でactiveな戦略insightを取得する。ネタの切り口・訴求判断に反映する。

## 1. 当日データの確認・非該当判定

`scripts/lib/contentTopics/dailyResultSource.js`の`getCandidates()`を呼ぶ。当日レース開催が無ければ空配列が返る——**この場合は提案せず、そのまま終了する**（品質低下ではなく単純な非該当、`daily-result`ソースの既存方針と同じ）。

候補（`{sourceId, topicKey: date, date, raceCount}`）が得られたら、当日の実データから具体的な注目ポイントを1つ探す。`scripts/daily/todays-volatility-digest.js`と同種のアプローチ（`predictions.feature_contributions`のイン崩れ注意度・的中実績等から、その日ならではの数字を拾う）を参考にする。「選手の調子」（直近成績の好調・不調）を扱う場合は`racer_aggregated_stats`等の実データで裏付けを取る。

## 2. ネタ本文（topic_text）の作成

1〜2文。例:

> 直近の勝率が急上昇している選手を、実データランキングで紹介

- 「競艇」表記禁止、射幸心を煽らない
- 承認レス運用のため、**数値の裏付けが弱い・解釈が分かれる題材は選ばない**。明確に説明できる実データのみ扱う

## 3. チャネル判定

`scripts/lib/contentChannels/channelMatrix.js`の`getChannelsForTopic("daily-result")`を呼び、対象プラットフォーム一覧を取得する（現状`["blog", "note", "x", "youtube"]`、TikTokは既定で対象外）。

**TikTok可否の個別ネタ判定（2026-09-03更新）**: `daily-result`ソースは題材によって性質が異なるため、以下の基準で判定する。

- **選手の調子（全国勝率の急上昇・急下降ランキング）**: `getChannelsForTopic("daily-result", { isGamblingRelevant: false })`を呼びTikTokも含める。実際にTikTokへ投稿し再生されている実績で安全と判断済み（2026-09-03、ユーザー確認）。ただしTikTok側の「おすすめ対象外」判定（削除を伴わない配信制限）が付くリスクは許容する前提——**削除・アカウント違反に至らない限りは許容**という運用方針であり、「制限なしを保証する」という意味ではない
- **イン崩れ指数・的中検証等、勝敗確率・回収率に直結する統計**: 既定（除外）のまま。個別に安全と確信できない限り`isGamblingRelevant`は渡さない
- 上記以外の新しい題材を扱う場合は、`docs/operation/sns-video-producer-prompt.md`絶対厳守13の判断基準（「この数字・情報は、視聴者が今日の賭け目を選ぶ判断材料に直結するか？」）で都度判断し、Yesなら除外のままにする

**除外したチャネルもsns_topic_targets行自体は作られる**（4.参照）。人間がsns-hub「ネタ承認」画面のチャネルトグルで個別にpendingへ変更できる（ただし`daily-auto`型は`requires_topic_approval=false`のため、承認待ちには出ず進捗マトリクスにのみ表示される）。

## 4. ネタの登録（承認レス）

1. `getContentTypeByKey("daily-auto")`（`scripts/lib/snsTopics.js`）で型IDを取得する
2. `getTargetAccounts()`（同ファイル）でactiveな配信先アカウント一覧を取得し、3.で得たプラットフォーム名に該当するものを`targetAccountIds`（`status='pending'`にするアカウント）として集める
3. `createTopicWithTargets({ topicText, contentTypeId, sourceInsightIds, autoApprove: true, targetAccountIds })`を呼ぶ。**`autoApprove: true`固定**（`status='approved'`で即座に作成され、各チャネル別パイプラインのポーリング対象になる）。`targetAccountIds`に含まれないアカウントも行は作られるが`status='skipped'`になる（既定除外、人間が個別に変更可能）

## 制約（絶対厳守）

- 頻度上限は1日1本（`sns_content_types.daily-auto`の`cadence='daily'`と一致させる）
- 当日レース開催が無い日、または実データの裏付けが取れない日は提案しない（見送りであり不具合ではない）
- 承認レス運用のため、このRoutineの判断品質が全体の信頼性に直結する。迷う題材は選ばず、より明確な題材か非該当（提案なし）を選ぶ
- このRoutineは`sns_drafts`（下書き）を一切生成しない。ネタの登録（`sns_topics`/`sns_topic_targets`）のみ
- コード・ドキュメントの変更・コミット・PR作成は行わない（データ登録のみのRoutine）
