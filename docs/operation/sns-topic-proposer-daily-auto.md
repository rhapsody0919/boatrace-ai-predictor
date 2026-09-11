# 日次・一般ネタ自動提案Routine 制作ガイド

毎日（深夜〜早朝想定のcron、または管理画面の「🌅日次ネタ自動提案を今すぐ実行」ボタンによる随時手動発火）、当日の成績データから日次ネタ（型`daily-auto`）を1件提案し、**人間の承認を経ずに**そのまま承認済み扱いで登録するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038、2026-09-04追記）を参照。

**この型はネタ承認を経ない設計**（`sns_content_types.daily-auto`の`requires_topic_approval=false`）。人間が朝セッションを開いた時点で、既にチャネル別パイプラインが生成した下書きが承認待ちになっている状態を目指す。ネタ選定ロジックの質が承認レス運用の前提になるため、実データの裏付けを他の型以上に厳密に確認すること。

**このRoutineは下書き（動画・記事）を生成しない**。ネタを1件作り、対象チャネルの`sns_topic_targets`を`pending`状態で用意するところまでが役割。実際の生成はチャネル別パイプライン（`docs/operation/sns-pipeline-x.md`等）が行う。

## 実行トリガー

このRoutineは2つの起動方法を持つ。まず`<routine-fire-payload>`ブロックの有無を確認する（`docs/operation/sns-pipeline-x.md`の「実行トリガー」と同じパターン）。

- **無い場合（スケジュール起動、深夜〜早朝cron）**: ペイロードは無いので、2.の自動選定ロジックにそのまま進む
- **ある場合（管理画面「🌅日次ネタ自動提案を今すぐ実行」ボタン起動）**: ペイロード（`{categoryKey?: string}`）を確認する。**`categoryKey`が指定されていれば、2.の自動選定より優先してその型で題材を探す**（2026-09-04追加、要件: 日次ネタ生成で型を選べるようにする）。指定された型に対応する実データの裏付けが取れなければ、他の型で代替せず非該当として提案を見送る（安全側に倒す、承認レス運用の前提を崩さない）。`categoryKey`が空・未指定の場合は従来通り2.の自動選定に委ねる
  - **例外: `categoryKey: "humor"`が指定された場合**（2026-09-07追加）は当日データに一切依存しないため、1.（当日データの確認）を丸ごとスキップし、`scripts/lib/contentTopics/humorSource.js`の`getCandidates()`を直接呼ぶ。詳細は2.の表を参照

## 0. 蓄積されたフィードバックの確認

`getActiveInsights({ platform: null })`（`scripts/lib/snsStrategyInsights.js`）でactiveな戦略insightを取得する。ネタの切り口・訴求判断に反映する。

## 1. 当日データの確認・非該当判定

**`categoryKey: "humor"`が指定されている場合はこの章を丸ごとスキップし、2.の表の「ゆるユーモア型」の行に従う。**

`scripts/lib/contentTopics/dailyResultSource.js`の`getCandidates()`を呼ぶ。当日レース開催が無ければ空配列が返る——**この場合は提案せず、そのまま終了する**（品質低下ではなく単純な非該当、`daily-result`ソースの既存方針と同じ）。

候補（`{sourceId, topicKey: date, date, raceCount}`）が得られたら、当日の実データから具体的な注目ポイントを1つ探す。`scripts/daily/todays-volatility-digest.js`と同種のアプローチ（`predictions.feature_contributions`のイン崩れ注意度・的中実績等から、その日ならではの数字を拾う）を参考にする。「選手の調子」（直近成績の好調・不調）を扱う場合は`racer_aggregated_stats`等の実データで裏付けを取る。

## 2. ネタ本文（topic_text）の作成・型（カテゴリ）の分類

1〜2文で本文を作る。例:

> 直近の勝率が急上昇している選手を、実データランキングで紹介

- 「競艇」表記禁止、射幸心を煽らない
- 承認レス運用のため、**数値の裏付けが弱い・解釈が分かれる題材は選ばない**。明確に説明できる実データのみ扱う

**同時に、扱う題材が`sns_topic_categories`のどの型に該当するかを分類する**（2026-09-04更新、対象カテゴリを時間制約の有無で再整理した。以前は選手×艇番回収率型・出目分布型もこのRoutineの対象としていたが、それらはTikTokポリシー上どのみち新規制作を全面停止中のため対象から外した）。`daily-result`ソースに対応する既知の型（`category_key`）は以下の通り:

| 題材 | category_key | 生成に必要なデータ | 実行タイミングの目安 |
|---|---|---|---|
| 選手の調子（全国勝率の急上昇・急下降ランキング） | `racer-condition` | 当日開催選手の直近成績集計 | 早朝cronで問題なく生成可能 |
| モーター調子ランキング | `motor-condition` | 同上（モーター単位） | 早朝cronで問題なく生成可能 |
| イン崩れ注意度 | `volatility-index` | 当日レースの`predictions.feature_contributions` | 早朝cronで問題なく生成可能 |
| 予想数値フック型 | `prediction-hook` | **本日開催中・結果未確定のレース** | 早朝cron時点では対象レースが無いことが多い。日中の手動発火（🌅ボタン）が主な起動経路 |
| 的中・答え合わせ型（展開予想的中） | `prediction-accuracy` | **本日終了済みのレース結果** | 同上、レースが終了していないと生成できない |
| ゆるユーモア型（競技ルール・観戦あるある） | `humor` | 不要（`humorSource.js`の題材リストを使用、本文は毎回新規に書く） | いつでも生成可能。当日データに依存しないため早朝cron・🌅ボタンどちらでも同じ結果になる |

**`humor`のみ、他の型と本文作成の手順が異なる**（2026-09-07追加）。`scripts/lib/contentTopics/humorSource.js`の`getCandidates()`が返す候補（クールダウン内で未使用のものだけ）から先頭1件を選び、その`candidate.premise`（事実の材料）を元に、**下記「2-D. ゆるユーモアネタの本文作成」の指針に従って本文を毎回新しく書く**（固定文の使い回しはしない。同じpremiseが将来また選ばれても、その都度違う言い回しで書くこと）。候補が0件（全題材がクールダウン中）の場合は他の型にフォールバックせず、非該当として提案を見送る。

### 2-D. ゆるユーモアネタの本文作成

このカテゴリは複数回の試行錯誤（動画3回没→文字案も複数回没）を経て現在の方針に落ち着いた。同じ失敗を繰り返さないため、以下を必ず守る。

**絶対厳守（過去に却下された理由そのもの）**:
- **選手個人のデータ・言動には一切触れない**（成績・級・体重・年齢・支部等）。ゆるユーモア型の存在理由そのもの。個人データを扱いたい場合はtrivia型（`docs/operation/sns-topic-proposer-weekly.md`）を使う
- 選手を揶揄する・見下すトーンにしない（煽り・「以上です」的な突き放し・大げさな効果音的表現は使わない）

**「AIっぽい」と却下された構造上のパターン（避けること）**:
1. 「事実を述べる→無理に比喩で例える→自分ごと化の問いで締める」という3段構成を毎回律儀に繰り返す（型が透けて見える）
2. ボケた後に、さらに解説や問いかけを付け足す（オチを自分で説明してしまっている）。原則は言い切って終わる。問いかけで締めるのは時々でよく、毎回は使わない
3. ギャンブル・射幸心を連想させる比喩（「ガチャ」等）で例える。競技のルール自体をゆるく笑うことと、賭け事を想起させることは別物

**目指す形（承認済み参考例、`candidate.premise`ごとに書き方は変えてよい）**:
> ボートレースのモーター、選手は選べません。抽選です。人生でいちばん平等な瞬間、意外とレース前に来ます。

> フライングは0.01秒の世界。寝坊はセーフなのに0.01秒はアウトな競技、なかなか無い。

> 最前列で観戦して一番驚くのは、迫力でも轟音でもなく「思ったより濡れる」ということ。

共通点: 2〜3文で言い切って終わる。比喩は使うとしても1つまでで、使った比喩をさらに説明しない。「競艇」表記禁止・射幸心を煽らない、という制約はtrivia型と同じ。

**判断に迷ったら**: 書いた文を読み返して、「事実→こじつけた例え→律儀な質問」の3点セットになっていないか確認する。なっていたら削って短くする。

`payout-rate`（選手×艇番回収率型）・`outcome-distribution`（出目分布型）は対象外（`sns-video-producer-prompt.md`の新規制作停止方針に従う。category自体は`sns_topic_categories`に残っているが、このRoutineの候補選定では選ばない）。

**上記のいずれにも該当しない新しい題材の場合**、`sns_topic_categories`に新しい行が無いため、その日は保守的に`volatility-index`等の既存の近い型として扱うか、提案を見送る（新しい型を独自に作らない。型の新設はsns-hub「ネタ型設定」画面からのユーザー操作に委ねる）。

**`prediction-hook`/`prediction-accuracy`は実行時刻に応じて候補が無いことが正常**。早朝cronで対象レースが無ければ他の型（選手調子・モーター調子・イン崩れ）から選ぶか、非該当として提案を見送る。日中に人間が🌅ボタンで手動発火した場合は、その時点で進行中・終了済みのレースを対象に含めてよい。

## 3. チャネル判定

`getEnabledChannelsForCategory(categoryKey)`（`scripts/lib/snsTopics.js`）を、2.で分類したcategory_keyで呼び、有効なプラットフォーム一覧を取得する。**チャネル可否は`sns_topic_categories`/`sns_topic_category_channels`テーブルにデータとして持っており、sns-hub管理画面「ネタ型設定」でユーザーが随時変更する**（型を新設・調整する際はコード変更でなくこのテーブルへの行追加/更新で対応する）。TikTokが「制限された投稿」（削除を伴わない配信制限）になっても、そのこと自体は許容する運用方針——ガイドライン違反（削除・アカウント制限）を受けた場合のみ、ユーザーが管理画面でOFFに切り替える。

**除外したチャネルもsns_topic_targets行自体は作られる**（4.参照）。人間がsns-hub「ネタ承認」画面のチャネルトグルで個別にpendingへ変更できる（ただし`daily-auto`型は`requires_topic_approval=false`のため、承認待ちには出ず進捗マトリクスにのみ表示される）。

## 4. ネタの登録（承認レス）

1. **型ID（`contentTypeId`）は2.で分類したcategory_key経由で解決する**（`getContentTypeByKey("daily-auto")`の固定呼び出しは使わない）。`getTopicCategories()`（`scripts/lib/snsTopics.js`）でカテゴリ一覧を取得し、category_keyが一致する行の`content_type_id`列をそのまま`contentTypeId`として使う。理由: `racer-condition`/`motor-condition`/`volatility-index`は`sns_topic_categories`上で`daily-auto`型に紐づくが、`prediction-hook`/`prediction-accuracy`は同じテーブル上で**`race-time-critical`型に紐づいている**（`docs/db-migration/044_sns_topic_categories.sql`参照、当初「topic-gateにはまだ未接続」として登録されていた名残）。固定で`daily-auto`を使うと、この2型のネタが誤った`content_type_id`で登録されてしまう（2026-09-04、コードレビューで発覚）
2. `getTargetAccounts()`（同ファイル）でactiveな配信先アカウント一覧を取得し、3.で得たプラットフォーム名に該当するものを`targetAccountIds`（`status='pending'`にするアカウント）として集める
3. `createTopicWithTargets({ topicText, contentTypeId, sourceInsightIds, autoApprove: true, targetAccountIds })`を呼ぶ。**`autoApprove: true`固定**（`status='approved'`で即座に作成され、各チャネル別パイプラインのポーリング対象になる）。`targetAccountIds`に含まれないアカウントも行は作られるが`status='skipped'`になる（既定除外、人間が個別に変更可能）

## 制約（絶対厳守）

- 頻度上限は1日1本、ただしこれは**早朝cronでの自動実行**（`racer-condition`/`motor-condition`/`volatility-index`、`sns_content_types.daily-auto`の`trigger_mode='auto'`）に適用する上限（`cadence='daily'`と一致させる）。この上限は、性質が近い実データ集計投稿（当日の選手・モーター調子ランキング等）が同日に重複するのを防ぐためのもの。`prediction-hook`/`prediction-accuracy`（`race-time-critical`型、`trigger_mode='manual'`＝そもそも自動cronの対象外）は日中に人間が🌅ボタンでレースごとに複数回手動発火することを想定しており、この上限の対象外
  - **`humor`もこの上限の対象外とする**（2026-09-07追加）。同じ`daily-auto`型に属するが、実データに依存しない別ジャンルのコンテンツであり、`racer-condition`等との重複を防ぐ目的の上限を適用する理由が無い。重複防止自体は`humorSource.js`の30日クールダウン（題材単位）で別途行っている。今日すでに`racer-condition`等が1本登録済みでも、`categoryKey: "humor"`が指定された場合は登録してよい（逆も同様、`humor`が1本登録済みでも他の型の自動選定は妨げない）
- 当日レース開催が無い日、または実データの裏付けが取れない日は提案しない（見送りであり不具合ではない）
- 承認レス運用のため、このRoutineの判断品質が全体の信頼性に直結する。迷う題材は選ばず、より明確な題材か非該当（提案なし）を選ぶ
- このRoutineは`sns_drafts`（下書き）を一切生成しない。ネタの登録（`sns_topics`/`sns_topic_targets`）のみ
- コード・ドキュメントの変更・コミット・PR作成は行わない（データ登録のみのRoutine）
