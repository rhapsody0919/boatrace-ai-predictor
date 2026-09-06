# 週次ネタ提案Routine 制作ガイド

週1回（月曜想定）、`requires_topic_approval=true`（要承認・ストック管理）の3カテゴリ——**会場特性ネタ**（`category_key: venue-characteristic`）・**機能紹介ネタ**（`category_key: feature-intro`）・**豆知識ネタ**（`category_key: trivia`）——を合わせて提案し、sns-hubの「ネタ承認」セクションに人間の承認待ちとして登録するRoutine向けの実行手順。3カテゴリとも型`venue-feature`（週次・要承認）に紐づく。API起動（sns-hub「📅 週次ネタ提案を今すぐ実行」ボタン）の場合は、在庫をまとめて積みたい場面向けに1回の実行で最大10件提案する（2026-09-05追加、件数の考え方は「1. ネタ候補の選定」参照）。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。

**このRoutineは下書き（動画・記事）を生成しない**。ネタを1件作り承認キューに乗せるところまでが役割。承認後の実際の生成は、チャネル別パイプライン（`docs/operation/sns-pipeline-x.md`等）が`sns_topic_targets`をポーリングして行う（疎結合、ADR 0036）。

**2026-09-05追記（機能紹介ネタの追加）**: `feature-intro`カテゴリは当初「新機能紹介型（一覧アピール型）」の未接続プレースホルダーとして登録され、実際にはフローA（新機能マルチチャネル展開）が担当する別概念だった。ユーザーとの対話で「分析ツール(`/winning-technique`)の既存17タブを1つずつ紹介するネタ」という第3の概念が必要と判明し、既に実装済みだが未接続だった`scripts/lib/contentTopics/dataInsightSource.js`をこの行に繋ぎ直した（`docs/db-migration/047_sns_topic_categories_feature_intro_repurpose.sql`参照）。「一覧アピール型」自体・フローAの新機能告知は本Routineの対象外のまま（BOA-239参照）。

**2026-09-05追記（豆知識ネタの追加）**: `trivia`カテゴリも同様に「未実装、提案元モジュール未着手」のプレースホルダーだった（チャネル設定は先行してblog/note/x/youtube/tiktok全てON済み）。ユーザー要望（フォロワー獲得・集客のための新しい週次ネタ軸）を受け、新規実装した`scripts/lib/contentTopics/triviaSource.js`をこの行に接続した（`docs/db-migration/049_sns_topic_categories_trivia_connect.sql`参照）。会場特性ネタ（1会場 vs 全国平均）・機能紹介ネタ（ツールタブの紹介）のどちらとも異なり、**特定の会場・ツールに紐づかない全国横断の選手属性ネタ**という第3の軸を担う。本文作成の考え方は「2-C. 豆知識ネタの本文作成」参照。

**2026-09-06追記（15軸への拡張・再利用ルールの変更）**: 初版は6軸（級別・年代・体重・支部・経験年数・身長）で「直近3回を避ける」カウントベースの再利用回避だったが、ユーザー指摘（軸が少ないと十数週で同じ軸が一巡し「またこの話か」という繰り返し感が出る、理想は毎回別の軸、無理なら軸を15個程度に増やしてほしい）を受け、出身地・スタート・フライング率・地元成績ギャップ・コース配置・級別年齢・支部別A1比率・モーター運の8軸を追加し15軸に拡張した。再利用ルールも「直近180日以内に使った軸を避ける」長期クールダウン方式に変更し、軸が尽きて型自体が枯渇する事態（`getCandidates()`が空配列を返し続ける）を避けつつ、実運用上は長期間同じ軸が再登場しないようにした。

**2026-09-06追記（型指定トリガーの追加）**: API起動（sns-hub「📅 週次ネタ提案を今すぐ実行」ボタン）に型（カテゴリ）選択ドロップダウンを追加した（ユーザー要望: 豆知識型など特定の型だけをいつでも手動生成したい、`sns-topic-proposer-daily-auto.md`の型指定と同じ仕組みを週次にも展開してほしい）。詳細は下記「実行トリガー」参照。

## 実行トリガー

このRoutineは2つの起動方法を持つ。まず`<routine-fire-payload>`ブロックの有無を確認する（`docs/operation/sns-pipeline-x.md`・`sns-topic-proposer-daily-auto.md`の「実行トリガー」と同じパターン）。

- **無い場合（スケジュール起動、月曜cron）**: ペイロードは無いので、「1. ネタ候補の選定」の3ソース交互取り出しにそのまま進む
- **ある場合（sns-hub「📅 週次ネタ提案を今すぐ実行」ボタン起動）**: ペイロード（`{categoryKey?: string}`）を確認する。**`categoryKey`が指定されていれば、3ソース交互取り出しより優先してその型（`venue-characteristic`/`feature-intro`/`trivia`のいずれか1つ）のみを候補源にする**（2026-09-06追加）。指定された型の候補が尽きている・実データの裏付けが取れない場合は、他の型で代替せず非該当として提案を見送る（安全側に倒す、`daily-auto`の型指定と同じ考え方）。`categoryKey`が空・未指定の場合は従来通り3ソース交互取り出しに委ねる

## 0. 蓄積されたフィードバックの確認

`getActiveInsights({ platform: null })`（`scripts/lib/snsStrategyInsights.js`、scopeがnullで全体適用のものを含め全件確認）でactiveな戦略insightを取得する。ネタの切り口・訴求判断に反映する。該当が無ければ通常通り進めてよい。

## 1. ネタ候補の選定

**`categoryKey`が指定されている場合はこの節をスキップし、対応する1ソースの`getCandidates()`だけを呼ぶ**（`venue-characteristic`→`venueCharacteristicSource.js`、`feature-intro`→`dataInsightSource.js`、`trivia`→`triviaSource.js`。「実行トリガー」参照）。以下は`categoryKey`が無い場合（従来の自動選定）の手順。

3つのソースから候補を集める。

- `scripts/lib/contentTopics/venueCharacteristicSource.js`の`getCandidates()`。戻り値は`{sourceId: "venue-characteristic", topicKey, venueCode, angle, lastUsedAt}`の配列
- `scripts/lib/contentTopics/dataInsightSource.js`の`getCandidates()`。戻り値は`{sourceId: "data-insight", topicKey, tabId, lastUsedAt}`の配列
- `scripts/lib/contentTopics/triviaSource.js`の`getCandidates()`。戻り値は`{sourceId: "trivia", topicKey, angle, lastUsedAt}`の配列

いずれも未使用（`lastUsedAt: null`）優先・次に最も古く使われた順にソート済み（このRoutine自身でソートし直さない）。3つのリストを**交互に**（venue-characteristic→data-insight→trivia→venue-characteristic→…の順で）取り出して1本の候補列を作る。途中でいずれかのソースが尽きたら、その順番をスキップし残ったソースだけで続ける。この交互取り出しにより、複数件まとめて提案する場合に3カテゴリが自然に混ざる（2026-09-05、会場特性ネタだけを大量登録すると同じ切り口に偏る問題が発覚したための設計。2ソース時代の設計をそのまま3ソースに拡張）。

**今回提案する件数（目標件数、3カテゴリ合計）**:
- スケジュール起動（月曜cron）: 1件
- API起動（手動実行ボタン）: 10件

先頭から順に候補を1件ずつ検証し、2〜5の手順（本文作成→チャネル判定→登録→使用履歴更新）を最後まで実施できた候補を「登録成功」としてカウントする。目標件数に達するまで、または全ソースの候補が尽きるまで次の候補に進む。実データの裏付けが取れない・射幸心を煽る等で不適格と判断した候補は登録せず、使用履歴も更新せずに次点候補へ切り替える（1で失敗した候補を消費したことにしない）。目標件数に届かず候補が尽きた場合は、そこまでの登録成功分だけを結果として報告する（不足分を無理に埋めない）。

- `venueCode`の表示名は`VENUE_NAMES[venueCode]`（`scripts/lib/supabaseClient.js`）から取得する。手打ち禁止（`sns-video-producer-prompt.md`絶対厳守12と同じ理由）
- `venue-characteristic`の`angle`別データ確認方法は「2-A. 会場特性ネタの本文作成」を参照
- `data-insight`の`tabId`別データ確認方法は「2-B. 機能紹介ネタの本文作成」を参照
- `trivia`の`angle`別データ確認方法・フォロー獲得のための訴求の型は「2-C. 豆知識ネタの本文作成」を参照
- 定性的な説明だけで数値の裏付けが無い場合は、`getCandidates()`の次点候補に切り替える

## 2-A. 会場特性ネタ（`venue-characteristic`）の本文作成

`angle`ごとに、以下のテーブルから該当会場（`venue_code`）の実データを取得し、全国平均（または同水面種別平均）と比較した具体的な数値を1つ示す。1文〜2文で、何を伝えるネタかが分かる形にする。

| angle | データ源（テーブル・列） | 比較の作り方 |
|---|---|---|
| `water-type` | `venues.avg_first_win_rate`・`water_type` | 同じ`water_type`の会場群の平均と比較 |
| `technique-tendency` | `winning_technique_stats`（`boat_number=1`、`winning_technique`別`percentage`） | 全国平均の決まり手構成比と比較 |
| `outcome-distribution` | `outcome_distribution`（`first_boat`/`second_boat`/`third_boat`別`probability`・`avg_payout`） | その会場で最も出現率が高い出目の`probability`を全国平均の同じ出目パターンと比較 |
| `top-start` | `top_start_stats`（`boat_number`別`top_start_rate`・`win_rate_when_top_start`） | `boat_number=1`の`top_start_rate`または`win_rate_when_top_start`を全国平均と比較 |
| `losing-technique` | `losing_technique_stats`（`boat_number=1`、`losing_technique`別`percentage`） | 1号艇が負けた時に最も多い決まり手の`percentage`を全国平均と比較 |
| `nige-outcome` | `nige_outcome_distribution`（`first_boat=1`に絞り込み、`second_boat`/`third_boat`別`probability`） | 1号艇が逃げた時に最も多い2着艇の`probability`を全国平均と比較 |
| `exhibition-time-top` | `exhibition_time_top_stats`（`boat_number`別`fastest_rate`・`win_rate_when_fastest`） | `win_rate_when_fastest`（展示最速艇の1着率）を全国平均と比較 |
| `seasonal` | 未実装（月別集計クエリ無し、BOA-245参照） | 現状は常に次点候補へ切り替える |

全国平均は各テーブルを`venue_code`で絞り込まず全会場分集計して算出する（`water-type`のみ同水面種別会場群平均、既存方針を踏襲）。例（`angle: "technique-tendency"`の場合）:

> 「桐生」会場のイン逃げ率が全国平均より12%高い理由をデータで解説

- 「競艇」表記禁止、射幸心を煽らない（`sns-video-producer-prompt.md`絶対厳守1〜3と同じ制約がネタの時点から適用される）
- 具体的な数値を含める（実データの裏付け）

## 2-B. 機能紹介ネタ（`feature-intro`）の本文作成

`tabId`は`/winning-technique`のタブキー（`src/pages/WinningTechniqueAnalysis.jsx`の`TAB_KEYS`と一致、全17種）。**「この機能を使うと何が分かるか」の一般説明だけで終わらせず、venue-characteristicと同様に実データのスナップショットを1つ添える**（2026-09-05、ユーザー判断）。現状は以下6タブに限定する（2-Aと同じ会場別集計テーブルをそのまま流用でき、実データ取得方法が明確なため）。残り11タブ（`motor`/`st`は会場別集計クエリが未実装、`racer`/`extrend`/`techprofile`/`formranking`/`returnrate`/`attackdefense`/`racecard`/`venueranking`/`volatility`は主語が選手個人・特定レース・モデル精度等でこのRoutineの「会場テーブル流用」パターンに乗らない）への対応はBOA-246で起票済み、将来対応。

| tabId | 紹介する機能 | 実データの取得元 |
|---|---|---|
| `outcome` | 出目分布 | `outcome_distribution` |
| `technique` | 決まり手分析 | `winning_technique_stats` |
| `topstart` | トップスタート分析 | `top_start_stats` |
| `losing` | 負け決まり手分析 | `losing_technique_stats` |
| `nige` | 逃げ複勝分布 | `nige_outcome_distribution` |
| `extime` | 展示タイム最速分析 | `exhibition_time_top_stats` |

本文は「〇〇タブでは、このような発見ができる」という機能紹介の型にする。例（`tabId: "outcome"`の場合）:

> AIデータ分析の「出目分布」タブでは、会場ごとの決まり手の出やすさが一目でわかる。実際に◯◯会場では△△の出目が出現率X%と、全国平均よりYpt高い

- 「競艇」表記禁止、射幸心を煽らない
- どのURL（`/winning-technique?tab={tabId}`）で見られる機能かに軽く触れてもよいが必須ではない（本文の主役は発見した数値）

## 2-C. 豆知識ネタの本文作成

会場特性ネタ（1会場 vs 全国平均）・機能紹介ネタ（ツールタブの紹介）はどちらも「見せる対象」が最初から決まっている。豆知識ネタは対象を自分で選ぶ分、**同じ実データでも切り口次第でバズるかどうかが大きく変わる**。以下は「どの2群を対比させるか」「どう言い換えるか」を判断するための実務プロンプトで、venue-feature型が使う`SceneHookCompareTwo`（`VenueRankingCM.jsx`、`docs/operation/sns-pipeline-x.md`3.参照）が「対比する2つの値」をそのまま主役にする設計のため、`topic_text`の時点で**必ず2群の対比に絞り込む**（3群以上の分布をそのまま書かない）。

**軸は15種類あり、`triviaSource.js`は直近180日以内に使った軸を候補から除外する長期クールダウン方式でローテーションする**（2026-09-06、6軸・直近3回避けの旧方式から変更。軸が少ないと十数週で同じ軸が一巡し「またこの話か」という繰り返し感が出るため、軸数を増やした上でクールダウン期間も長くした）。

### データ取得

| angle | データ源（テーブル・列） | 対比する2群の選び方 |
|---|---|---|
| `grade-win-rate` | `race_entries`（`grade`・`win_rate`。直近30日以内、`racer_id`ごとに最新1件を採用し二重集計を避ける） | 最高位（A1）と最低位（B2）を対比する。中間層（A2/B1）は本文には含めない |
| `age-win-rate` | `race_entries`（`age`・`win_rate`、同上の重複排除） | 年代を4区分（20代以下/30代/40代/50代以上）に分け、最も平均`win_rate`が高い年代と、直感的に体力が有利と思われがちな20代以下を対比する（実データでピークが30代等の別年代になった場合はその年代を主役にする） |
| `weight-win-rate` | `racer_profiles.weight_kg` × `race_entries.win_rate`（`racer_id`でJOIN、同上の重複排除） | 実データの分布を見て3階級程度に区切り、最も平均`win_rate`が高い階級と低い階級を対比する（境界値は毎回実データから決める、固定の閾値をハードコードしない） |
| `branch-win-rate` | `racer_profiles.branch` × `race_entries.win_rate`（`racer_id`でJOIN、同上の重複排除） | 支部別平均`win_rate`の上位1支部と全国平均（または下位1支部）を対比する |
| `experience-win-rate` | `racer_profiles.registration_period` × `race_entries.win_rate`（`racer_id`でJOIN、同上の重複排除） | 登録期を経過年数の目安に変換し、最も浅い層と最も深い層（ベテラン）を対比する |
| `height-win-rate` | `racer_profiles.height_cm` × `race_entries.win_rate`（`racer_id`でJOIN、同上の重複排除） | 高身長層・低身長層を対比する。相関が弱い/無い結果になった場合は無理に対比を作らず、「身長は勝率に関係なかった」という結果自体を意外性として使ってよい |
| `hometown-win-rate` | `racer_profiles.hometown` × `race_entries.win_rate`（`racer_id`でJOIN、同上の重複排除） | `branch`（支部）とは別の実データ列（出身都道府県、47種）。上位1都道府県と全国平均（または下位1都道府県）を対比する |
| `start-timing-by-grade` | `racer_aggregated_stats.avg_st`（`racer_id`ごとに全会場平均してから級別集計） | 最高位と最低位のスタートタイミング平均を対比する（値が小さいほどスタートが早い） |
| `flying-rate-by-grade` | `racer_aggregated_stats.flying_rate`（同上、級別集計） | 最高位と最低位のフライング率を対比する |
| `local-vs-national-gap` | `race_entries.local_win_rate` と `win_rate` の全国平均ギャップ | 級別等のグループ分けはせず、「全国勝率」と「地元開催時の勝率」という2つの平均値そのものを対比する |
| `course-assignment-by-grade` | `race_entries`（`racer_id`ごと直近1件の`boat_number`。1号艇＝true/falseの比率を級別集計） | 最高位と最低位で「1号艇（イン）に入る割合」を対比する |
| `age-by-grade` | `race_entries`（`racer_id`ごと直近1件の`age`、級別集計）。`age-win-rate`とは切り口が異なる（年齢→勝率ではなく級→年齢） | 最も平均年齢が低い級と高い級を対比する |
| `branch-elite-ratio` | `racer_profiles`（支部別の`grade_at_scrape='A1級'`比率）。`branch-win-rate`とは別metric | 上位1支部と全国平均（または下位1支部）のA1級比率を対比する |
| `motor-luck` | `race_entries.motor_2rate` × `race_results.rank1`（`race_id`でJOIN、`motor_2rate`を5分位程度に分け実際の1着率を集計） | 最上位分位と最下位分位で実際の1着率を対比する |
| `flying-rate-by-experience` | `racer_aggregated_stats.flying_rate` × `racer_profiles.registration_period`（経験年数帯別集計）。`flying-rate-by-grade`とは異なるグルーピング軸 | 最も浅い層と最も深い層（ベテラン）のフライング率を対比する |

- 「競艇」表記禁止、射幸心を煽らない（`sns-video-producer-prompt.md`絶対厳守1〜3と同じ制約がネタの時点から適用される）
- `race_entries`は同一選手が複数レース分の行を持つため、**必ず`racer_id`ごとに直近1件へ絞ってから平均を取る**（絞らずに集計すると出走数の多い選手の値が重複加算され、平均が歪む）。`racer_aggregated_stats`は`racer_id`×`venue_code`単位のため、級別・経験年数別集計の前に`racer_id`ごとに全会場平均を取ってから集計する
- 血液型（`racer_profiles.blood_type`）は軸に含めない。相関があっても因果を主張できず、データの正確性を重視するブランド方針（`.claude/rules/`参照）に反する疑似科学的な訴求になりやすいため
- 定性的な説明だけで数値の裏付けが無い場合、または対比が実データ上ほとんど差が無い場合は、`getCandidates()`の次点候補に切り替える

### 訴求の型（フォロー獲得のための言い換え）

同じ数値でも言い換え方で反応が変わる。`topic_text`を書く時点で以下を適用する。

1. **pt差ではなく倍率で言う**: 「A1級6.74% vs B2級2.69%」ではなく「A1級はB2級の**2.5倍**勝ちやすい」。差分（pt）より倍率のほうが直感的な驚きに変換されやすい
2. **直感への裏切りを主役にする**: 視聴者が漠然と信じていそうな前提（体力全盛期は20代、大きい選手が有利そう等）をあえて一度肯定してから、実データでひっくり返す構成にする。「20代が一番強そうだけど、実は30代が一番勝っている」のように、常識→裏切りの順で言う
3. **自分ごと化の一言を添える**: 「あなたの応援する選手は何級？」「自分の好きな選手は何支部？」など、視聴者が自分の知識・推し選手と照らし合わせたくなる問いを本文の最後に入れる（`sns-viral-copywriter-prompt.md`の「視聴者を巻き込んでいるか」チェックと同じ狙い）
4. **コメントで終わらせる**: 「知ってた？」で言い切らず、「他にもこういう傾向があったらコメントで教えて」のように、コメント欄での反応を明示的に誘う一文で締める（Xのランキングアルゴリズムがリプライを最重視する、`x-algorithm-and-growth-notes.md`と同じ根拠）
5. **シリーズであることが伝わる言い回しにする**: 「週刊・ボートレース豆知識」のような一貫した言い回しを`topic_text`に含める（各チャネルパイプラインのキャプション生成にそのまま引き継がれる）。豆知識型は単発の情報より「また来週も見たい」という期待形成に向いている型のため、フォローする動機を作る

### 出力例

> `grade-win-rate`の場合: 「A1級選手の平均勝率はB2級選手の**2.5倍**。あなたの推し選手は何級？」
> `age-win-rate`の場合: 「体力全盛期は20代…と思いきや、実は**30代が最も勝率が高い**（20代より1.3pt高い）」

## 3. チャネル判定

`getEnabledChannelsForCategory(categoryKey)`（`scripts/lib/snsTopics.js`）を、1.で選んだ候補の`sourceId`に対応する`categoryKey`（`sourceId: "venue-characteristic"`→`categoryKey: "venue-characteristic"`、`sourceId: "data-insight"`→`categoryKey: "feature-intro"`、`sourceId: "trivia"`→`categoryKey: "trivia"`）で呼び、有効なプラットフォーム一覧を取得する（2026-09-03更新、以前のchannelMatrix.js + isGamblingRelevantフラグから、`sns_topic_categories`/`sns_topic_category_channels`テーブルによるデータ駆動の判定に変更した）。

**現在の方針（ユーザー設定、sns-hub「ネタ型設定」画面でいつでも変更可能）**: 3カテゴリとも角度・タブに関わらずTikTokを含める全面許容運用。「TikTokで削除・アカウント制限（コミュニティガイドライン違反）に至らない限り、配信制限（『おすすめ対象外』）は許容する」というリスク許容方針（`docs/operation/tiktok-posting-operations.md`D・F節参照）。**新たに違反判定・削除を受けた場合は、都度sns-hub「ネタ型設定」画面でTikTokをOFFに切り替え、`docs/operation/tiktok-posting-operations.md`に該当するカテゴリ・角度/タブ・投稿内容を記録する**（推測で先回り除外しない。実際に違反判定を受けた実績が出てから対応する運用）。このRoutine自身はチャネル可否をハードコードせず、テーブルの設定値をそのまま使う。

**除外したチャネルもsns_topic_targets行自体は作られる**（4.参照）。sns-hub「ネタ承認」画面のチャネルトグルで、人間が個別にpending⇔skippedを変更できる。

## 4. ネタの登録

1. **型ID（`contentTypeId`）は`getTopicCategories()`（`scripts/lib/snsTopics.js`）でカテゴリ一覧を取得し、3.で使った`categoryKey`が一致する行の`content_type_id`列をそのまま使う**（`getContentTypeByKey("venue-feature")`の固定呼び出しは使わない。3カテゴリとも現状は同じ`venue-feature`型に紐づくが、将来いずれかだけ型を変更する可能性があるため、固定値ではなくテーブル参照で解決する）
2. `getTargetAccounts()`（同ファイル）でactiveな配信先アカウント一覧を取得し、3.で得たプラットフォーム名に該当するものを`targetAccountIds`（`status='pending'`にするアカウント）として集める
3. `createTopicWithTargets({ topicText, contentTypeId, sourceInsightIds, autoApprove: false, targetAccountIds })`を呼ぶ。`venue-feature`型は`requires_topic_approval=true`のため`autoApprove: false`固定（`status='proposed'`のまま作成され、人間の承認を待つ）。`targetAccountIds`に含まれないアカウント（既定でTikTok）も行は作られるが`status='skipped'`になる（既定除外、人間が個別に変更可能）
4. `sourceInsightIds`には0.で参照した根拠insightのIDを入れる（無ければ空配列でよい）

## 5. 使用履歴の更新

**4.の登録が成功した場合のみ**、候補の`sourceId`に応じて対応するモジュールの`recordUsage()`を呼ぶ（提案自体が失敗した候補を使用済み扱いにしない）。

- `sourceId: "venue-characteristic"`の場合: `venueCharacteristicSource.js`の`recordUsage(venueCode, angle, usedAt)`
- `sourceId: "data-insight"`の場合: `dataInsightSource.js`の`recordUsage(tabId, usedAt)`
- `sourceId: "trivia"`の場合: `triviaSource.js`の`recordUsage(angle, usedAt)`

## 制約（絶対厳守）

- 頻度上限は週1本（`sns_content_types.venue-feature`の`cadence='weekly'`と一致させる）、ただしこれは**月曜cronでのスケジュール起動**に適用する上限。API起動（sns-hub「📅 週次ネタ提案を今すぐ実行」ボタン）はこの上限の対象外とし、今週分が登録・承認済みかどうかに関わらず、押すたびに新規ネタ候補を最大10件まとめて提案する（`docs/operation/sns-topic-proposer-daily-auto.md`の`race-time-critical`型と同じ扱い。2026-09-05、手動実行しても「今週分は生成済み」で毎回スキップされ何も生成されない不具合が発覚したための変更。同日、在庫をまとめて積みたいというユーザー要望を受け1件→最大10件に変更）
- 実データの裏付けが取れない候補は提案せず、次点候補に切り替える。プレースホルダーでの提案はしない
- このRoutineは`sns_drafts`（下書き）を一切生成しない。ネタの登録（`sns_topics`/`sns_topic_targets`）のみ
- コード・ドキュメントの変更・コミット・PR作成は行わない（データ登録のみのRoutine）。**例外**: 5.の使用履歴更新で書き換わる`data/analysis/content-topics/venue-characteristic-history.json`・`data-insight-history.json`・`trivia-history.json`のみ、変更後に`git add`してコミットしてよい（例: `content: 週次ネタ提案（{会場}×{角度}等）の使用履歴を記録`）。ローテーション状態を永続化する目的の定型的な更新であり、コード変更を伴わないため対象外とする（2026-09-05追加、この例外が無かったため使用履歴がコミットされず、セッション終了で毎回リセットされていた不具合を修正）
