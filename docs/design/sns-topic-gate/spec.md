# SNSコンテンツ ネタ生成ライン＋チャネル別パイプライン分離

**種別**: UI機能（`/admin/sns-hub`の画面・データ構造変更を含む）。この後 `/step1-screens` に進む。
**対応Linearチケット**: なし（PR #466のパイプライン統合作業を起点に、ユーザーとの設計議論からSDD化）

## 背景・最終ゴール

`docs/design/content-multi-channel-pipeline/`（Pipeline B、ネタ駆動マルチチャネル展開）と`sns-hub-content-generation` Routine（Pipeline A、単発投稿生成）の2系統が併存する中で、以下の課題が顕在化した。

1. **無駄な生成コスト**: ネタ自体が採用に値するか承認する前に、5チャネル分（blog/note/x/tiktok/youtube）のコンテンツを生成してしまう
2. **修正・技術ルールがパイプライン間で伝播しない**: `getRecentRevisions()`・`getActiveInsights()`・テキストフィット規則などが片方のパイプラインにしか実装されず、繰り返し同じ種類の漏れが発生した（本セッション中に3回発生）
3. **承認前に中身を確認できないチャネルがある**: youtube/x/tiktokの下書きが「動画準備中」のまま承認できない、blog/noteは全文を確認する手段が無い
4. **ネタの性質ごとに運用モデルが異なる**のに、単一のバッチ処理・単一の承認モデルしか無い（会場特性のような事前準備向けのネタと、選手の調子のような当日ネタと、イン崩れ注意度のようなレース時間制約のあるネタでは、承認要否・生成タイミング・投稿方法が本質的に異なる）
5. **将来のチャネル追加（Instagram等）・アカウント追加（別ペルソナのXアカウント等）に対して拡張しにくい**設計になっている

本specは、ネタ（トピック）を人間承認の中心単位とし、承認されたネタを各チャネル別の独立したパイプラインが自律的にポーリングして生成する、疎結合なアーキテクチャへの再設計を対象とする。既存の`sns_drafts`・`sns_strategy_insights`・`riskRules.js`等、Phase 1/Phase 2で構築済みの基盤はそのまま再利用し、車輪の再発明はしない。

## 前提として再利用する既存基盤（新規に作らないもの）

- `sns_strategy_insights`・`getActiveInsights()`・`createInsight()`（`docs/design/sns-hub-phase2-pdca-loop/`で実装済み）: ネタの提案根拠として直接参照する
- `scripts/lib/riskRules.js`・`sns-video-studio/remotion/risk-rules.json`（同上、ADR 0028）: ネタ・下書きのリスクチェックにそのまま使う
- 下書き承認UIの基本パターン（`DraftCard`・`RevisionPanel`・処理中バッジ・手動更新ボタン、`docs/design/sns-hub-admin-ux-improvements/`で実装済み）
- 既存の手動生成ボタン（「当日ネタを今すぐ生成」「会場攻略型などを今すぐ生成」、PR #448）とその中のレース選定ロジック（イン崩れ注意度`volatilityPercentile`によるレース選定、`sns-video-producer-prompt.md`に実装済み）: 日次・時間制約型パイプラインの土台としてそのまま使う
- `sns_drafts`テーブル自体（構造変更なし、`content_group_id`で本specの`sns_topics`と紐付ける）

## 機能要件

| # | 要件 | 優先度 | 受入基準 |
|---|---|---|---|
| 1 | `sns_content_types`テーブル新設 | 高 | 型定義をコードでなくデータとして持つ。列: `type_key`（一意）・`cadence`（`weekly`/`daily`）・`requires_topic_approval`（bool）・`trigger_mode`（`poll`/`auto`/`manual`）・`active`（bool）。初期データ3件を投入する: `venue-feature`相当（週次・承認あり・poll）、`daily-auto`相当（日次・承認なし・auto）、`race-time-critical`相当（日次・承認なし・manual）。PDCAで型を追加・廃止する際はコード変更ではなく行の追加/`active=false`更新で対応できる |
| 2 | `sns_target_accounts`テーブル新設（アカウント/ターゲットレジストリ） | 高 | 列: `platform`（'blog'/'note'/'x'/'tiktok'/'youtube'、将来追加可能な文字列でENUM制約はかけない）・`account_label`（表示名）・`brand_kit_ref`（声色・ルール参照先、今は自由記述でよい）・`credential_ref`（認証情報の参照先キー、今は未使用でも列だけ用意）・`active`。初期データは現行運用中の5チャネル分（1プラットフォーム1アカウント）のみ投入する。**アカウント新規登録UIは今回作らない**（DB行の追加は手動、要件18参照） |
| 3 | `sns_topics`テーブル新設 | 高 | 列: `topic_text`・`status`（`proposed`/`approved`/`rejected`）・`content_type_id`（→要件1）・`source_insight_ids`（UUID[]、`sns_strategy_insights.id`を参照）・`proposed_at`・`approved_at`・`approver_id`（→`sns_approvers`） |
| 4 | `sns_topic_targets`テーブル新設（ネタ×アカウントの中間テーブル） | 高 | 列: `topic_id`（→要件3）・`target_account_id`（→要件2）・`status`（`pending`/`claimed`/`generated`/`skipped`）・`claimed_by`（`routine_run_id`）・`claimed_at`・`draft_id`（→`sns_drafts`、生成後に設定）。ネタ提案時、`active`な全アカウント分の行がデフォルトで`pending`作成される。人間・または生成側パイプラインが`skipped`に変更できる（要件12・13参照） |
| 5 | claim機構のアトミック実装 | 高 | 各チャネル別パイプラインは、担当`target_account_id`かつ`status='pending'`（型が`requires_topic_approval=true`の場合は紐づく`sns_topics.status='approved'`も条件）な`sns_topic_targets`行を、`UPDATE ... WHERE status='pending' RETURNING *`のようなアトミックなSQLで1件ずつclaimする。読んでから書く（read-then-write）実装は禁止する。同じ行が複数パイプラインに二重生成されないことをテストで確認する |
| 6 | 週次型パイプラインの定期実行 | 高 | 型`cadence='weekly'`の承認済みネタについて、各チャネル別パイプラインが12時間おきのcronで起動し、要件5のclaim→生成→`sns_drafts`作成→対応する`sns_topic_targets.status='generated'`更新を行う。cron間隔（12時間）は初期値として明記し、運用実績を見て変更可能とする |
| 7 | 日次・一般型パイプラインの自動実行 | 高 | 型`requires_topic_approval=false`かつ`trigger_mode='auto'`のネタについて、ネタ提案から下書き生成までを人間の承認を挟まず自動で行う。深夜〜早朝に実行し、朝には下書きが承認待ちの状態になっていることを目安とする |
| 8 | 日次・時間制約型パイプラインの手動起動 | 高 | 型`trigger_mode='manual'`のネタは、既存の「今すぐ生成」ボタン相当の手動トリガーで起動する（要件17のUI拡張と統合）。ネタ承認は行わず、生成後の下書き承認のみとする。レース選定ロジックは既存の`sns-video-producer-prompt.md`の実装をそのまま引き継ぐ |
| 9 | `.claude/rules/sns-content-generation.md`新設・master直マージ | 高 | フロントマター無しのファイルとして、全パイプライン共通の技術ルール（`getRecentRevisions()`/`getActiveInsights()`の使い方、`fitHeadline()`、ストレージパス署名規約等、本セッション中に伝播漏れが発覚した項目）を集約する。チャネル固有ルール（TikTokガンブル規制等）は各チャネル別パイプラインの専用プロンプトファイルに残し、この共通ファイルには入れない |
| 10 | チャネル別パイプラインの分離 | 高 | blog/note/x/tiktok/youtubeそれぞれに専用のRoutine・専用の発火トークンを用意する。TikTok向けパイプラインは、既存`sns-video-producer-prompt.md`のTikTokガンブル規制ルール（2026-09-01/02確立、「賭けの結果に影響する統計・インサイトを扱わない」制約）をそのまま引き継ぐ |
| 11 | revise/redoの正しいパイプラインへのルーティング修正 | 高 | 現在`revise.js`/`redo.js`が下書きの生成元パイプラインに関わらず一律`SNS_HUB_ROUTINE`環境変数を発火している既存バグを修正する。下書きの`platform`（または`routine_run_id`から逆引きしたパイプライン種別）に応じて、正しいチャネル別パイプラインの発火トークンを使うようにする |
| 12 | `format`列の語彙統一 | 高 | Pipeline B（ネタ駆動）が`sns_drafts.format`列に「ネタ種別」（`venue-characteristic`等）を格納している現状の誤用を修正し、ネタ種別は本specで新設する`sns_topics.content_type_id`で表現する。`sns_drafts.format`は全パイプライン共通で「ビジュアルテンプレート名」（`sns_template_variants.format`と同じ語彙）のみを格納するよう統一する |
| 13 | ネタ承認キューUI | 高 | sns-hub管理画面に「ネタ承認」タブを新設する。`status='proposed'`なネタを型バッジ（週次/日次・一般/日次・時間制約）付きで一覧表示し、承認・却下をタップで行える。対象は`requires_topic_approval=true`の型のみ（日次・一般/時間制約型はここに出てこない、要件7・8で自動/個別トリガーのため） |
| 14 | チャネルラベルの初期値と手動調整 | 高 | ネタ提案時、`active`な全アカウントに対応する`sns_topic_targets`行がデフォルトで`pending`（＝配信対象）作成される。ネタ承認キューUI・下書き一覧UIの両方から、個別のターゲットを`skipped`にする/`pending`に戻すトグル操作ができる |
| 15 | 進捗マトリクスUI | 中 | 承認済み（または自動生成対象の）ネタについて、ネタ×アカウントの生成状況（`pending`/`claimed`/`generated`/`skipped`）を一覧できるテーブルビューを設ける。`generated`は対応する下書きへのリンクを表示する。想定より生成が進んでいないネタがあれば、人間が気づいて個別に再生成を促せる |
| 16 | sns-hub IA再設計 | 中 | **2026-09-03コードレビューで既存構造を確認**: `TABS`は既に`PLATFORM_TABS`（チャネル別、下書き承認）＋`NON_PLATFORM_TABS`（戦略メモ・フォーマットカタログ）に分かれており、当初想定した「下書き承認（チャネル別タブ）」「戦略・振り返り」の区分は概ね実現済み。本specで追加するのは新規「ネタ承認」タブのみ（`NON_PLATFORM_TABS`に追加、または独立の上位区分にするかは`/step1-screens`で判断） |
| 17 | 既存の手動生成ボタンの拡張 | 高 | 既存の「当日ネタを今すぐ生成」「会場攻略型などを今すぐ生成」ボタンを、型（`sns_content_types`）を選んで生成できるように拡張する。日次・時間制約型の手動トリガーはこのボタン群の延長として実装する（要件8） |
| 18 | blog/note全文プレビュー・note用サムネ/YouTube動画プレビュー | 高 | **2026-09-03コードレビューで既存実装済みと判明**。`TextDraftPreview`（`SnsHubAdmin.jsx`）が本文全文展開トグル（「▼全文を見る」）・カバー画像・埋め込み動画リンクを既に提供している。本specでは新規実装せず、「ネタ承認カード」追加時に同じ水準のプレビューを踏襲することのみを要件とする |
| 19 | プレビューコンポーネントの意図的な分離実装 | 中 | **2026-09-03コードレビューで既存実装済みと判明**。`TextDraftPreview`（blog/note用、全文展開トグル）・`VideoPreview`（動画系チャネル用、インライン動画プレイヤー＋サムネ）は`DraftCard`内で`TEXT_DRAFT_PLATFORMS`により既に分岐・分離実装されている。本specで新規に作るのは「ネタ承認カード」用の3つ目のコンポーネントのみ（要件13で使用） |
| 20 | claim機構の並行実行テスト | 高 | 複数パイプラインが同じ`sns_topic_targets`行を同時にclaimしようとしても、claimに成功するのは1件のみであることを自動テストで検証する（例: 同一行に対する並行UPDATE呼び出しをシミュレートし、成功件数が1であることを確認するテストスクリプト）。目視確認のみで済ませない |
| 21 | revise/redoルーティングの回帰テスト | 高 | 下書きの生成元パイプライン（`platform`または`routine_run_id`）に応じて正しい発火トークンが選ばれることを自動テストで検証する。特に「Pipeline B（ネタ駆動）産の下書きがPipeline A用のRoutineに誤発火する」という既存バグ（要件11）の再発防止として、各チャネル×各下書きソースの組み合わせを網羅するテストケースを用意する |
| 22 | format列移行の整合性検証 | 中 | 要件12（format列語彙統一）の移行後、既存の`sns_drafts`データに対して「Pipeline A産の行は引き続きテンプレート名が入っている」「Pipeline B産の新規行はテンプレート名のみでネタ種別を含まない」ことを検証するスクリプトを用意し、実行結果を記録する |

## スコープ

### やる
- 上記機能要件1〜19

### やらない（今回、Linear起票済み: BOA-239）
- ネタ提案の有効期限フラグ・緊急度Slack通知
- ネタのチャネル適性分類タグ（SEO軸/フック軸等）— デフォルト全アカウントON＋自動除外で代替
- 新パイプラインプロンプトのドライラン検証モード（`status=test`）
- 週次型ポーリング生成のトークン予算上限ガードレール

### やらない（今回、スキーマ設計のみ対応）
- 複数アカウント/ペルソナの実運用（Instagram追加、別Xアカウント追加等）。`sns_target_accounts`のテーブル設計・列は将来の追加を見込むが、アカウント管理UIや実際のアカウント追加作業は今回行わない

### やらない（今後も対象外、既存方針を踏襲）
- X・TikTokの投稿実行自体のAPI自動化（人間が予約キューから当日投稿する運用を継続。YouTubeのみ既存API自動投稿を維持）
- レース時間制約型ネタの新規レース一覧ピッカーUI（既存パイプラインのレース選定ロジックをそのまま使うため不要）

## 非機能要件

- **コスト**: 新規の月額固定費追加を避ける。チャネル別パイプライン分離により発火頻度・token消費は増加するが、上限ガードレールは今回スコープ外とし、実績を見て別途検討する
- **モバイル対応**: 既存sns-hub同様、スマホブラウザからも操作可能なこと
- **既存機能への非干渉**: 既存の`/admin/rules`等、他の管理画面ページ・既存の「当日ネタを今すぐ生成」ボタンの動作に影響を与えない

## 制約・前提

- **新規Routineの発火トークン登録は人間の手動作業**（Claude Codeからは自動化不可、2026-09-03に2回検証済み）。チャネル別パイプライン×5を新設する場合、その分の手動セットアップ工数が発生することを前提とする
- **Routine間でのプロンプト相互参照はできない**。共通ルールは`.claude/rules/*.md`（フロントマター無し、master配置）でのみ全Routineに伝播する。この仕組みはRoutineセッションのブートストラップ時（デフォルトブランチ基準）に一度だけ読み込まれるため、featureブランチ上のルールファイルは対象Routineがそのブランチをまだ持たない限り反映されない（2026-09-03、実地検証済み）
- **claimはアトミックなSQL更新で実装する**（要件5）。素朴なread-then-writeは複数パイプラインの同時ポーリングで二重生成を招く
- **既存2パイプラインをN個のチャネル別パイプラインへ統合・分離する過程は、目視確認だけでなく自動テストで検証する**（要件20〜22）。特にclaimの並行性・revise/redoのルーティング・format列移行は、本セッション中に繰り返し発覚した「片方のパイプラインだけ直って他方に伝播しない」類のバグが再発しやすい箇所のため、`/step3`のタスク分解時に各タスクへテストケース作成を明示的に組み込む
- **既存コンポーネント再利用**: 下書き承認UIの基本パターン（`DraftCard`等）は流用する。プレビューUIのみ意図的に3種類へ分離する（`.claude/rules/component-reuse.md`の例外として明記）
- **用語ルール**: 「競艇」使用禁止等、`.claude/rules/code-style.md`準拠
- **法的制約**: TikTok向けチャネルは既存のガンブル関連ポリシー制約（`docs/operation/tiktok-posting-operations.md`、2026-09-01/02確立）を、分離後の専用パイプラインにそのまま引き継ぐ

## 未確定事項

| # | 項目 | いつ・誰が決めるか |
|---|---|---|
| 1 | `sns_content_types`・`sns_target_accounts`の具体的なカラム型・制約 | `/step2`（システム設計）で確定 |
| 2 | 進捗マトリクスUIの詳細レイアウト・型バッジの配色 | `/step1-screens`で画面設計時に確定 |
| 3 | claimのタイムアウト・解放ロジック（claimしたパイプラインが異常終了した場合の扱い） | `/step2`で確定。当面は手動でのステータス修正で対応する案もある |
| 4 | 週次型cronの実行時刻（12時間おきの起点） | 実装時にVercel Cron/RemoteTriggerの設定可能な粒度を見て確定 |
| 5 | チャネル別パイプライン新設に伴う発火トークンの実際の登録作業スケジュール | ユーザーが実装完了後に手動で実施 |
