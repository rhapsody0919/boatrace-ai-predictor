# ネタ駆動マルチチャネルコンテンツパイプライン 制作ガイド

毎晩1本、ネタを選定してブログ・note・X・TikTok・YouTubeへ展開するRoutine向けの実行手順。設計の背景は[`docs/design/content-multi-channel-pipeline/`](../design/content-multi-channel-pipeline/)（spec.md/screens.md/plan.md）を参照。

**2026-09-02、位置づけを明確化**: 「1つのネタから全チャネルへ展開する」パイプラインはこのガイドが担う。既存の`sns-hub-content-generation` Routine（daily/evergreen、admin/sns-hubの「当日ネタを今すぐ生成」「会場攻略型などを今すぐ生成」ボタン）はPOC（概念実証）から発展した、**ネタ単位に紐づかない単発投稿の生成手段として引き続き維持する**（例: 特定のブログ記事と紐付かない、TikTok/X向けの単発投稿を1本追加したいだけの場合）。両者は併存し、片方を廃止する計画ではない。ただし、X/TikTok/YouTube向けの実際の映像制作技術（Remotionレンダリング手順・risk-rules照合・Supabase Storageアップロード等）は`sns-hub-content-generation`側で確立済みのものをそのまま再利用する（下記3節参照、車輪の再発明をしない）。

**着手前に必ず[`docs/reference/brand-kit.md`](../reference/brand-kit.md)のギャラリーを確認すること**。既存の採用実例と矛盾する独自デザインを作らない。

## 0. 蓄積されたフィードバックの確認（2026-09-02追加、2026-09-03に戦略insightを統合）

まだネタ・チャネルが決まっていない時点で実行するため、5プラットフォーム分すべてを確認しておく（2.でチャネルが決まった後、該当しないプラットフォーム分の情報は単に使わない）:

- **直近の却下理由**: `getRecentRevisions({ platform: "blog" })`・`getRecentRevisions({ platform: "note" })`・`getRecentRevisions({ platform: "x" })`・`getRecentRevisions({ platform: "tiktok" })`・`getRecentRevisions({ platform: "youtube" })`（`scripts/lib/contentRevisionHistory.js`）で直近30日の修正依頼・却下理由を取得する。理由コード（`revision_reason_codes`）だけでなく`revisionReasonFreetext`（自由記述）も必ず読む。同じ理由が3回以上累積した場合はGitHub Actions（`content-ops-nightly-check.yml`）が自動でLinearにcontent-qualityラベル付きIssueを起票する（`scripts/maintenance/content-ops-checks/check-revision-escalation.js`）ため、このRoutine側で追加の対応は不要
- **蓄積された戦略insight**: `getActiveInsights({ platform })`（`scripts/lib/snsStrategyInsights.js`、対象プラットフォームごとに呼ぶ）でactive状態のinsightを取得する（`/growth-pdca`ステップ7・ADR 0027参照。Search Console/GA4実績や修正指摘の`saveAsInsight`チェックボックス経由で「こう作ると効く」という知見が蓄積される設計）

どちらも該当が無ければ通常通り進めてよい。

## 1. ネタ選定

`scripts/lib/contentTopics/index.js`の`collectAllCandidates()`を呼び、4系統（新機能/会場特性/データ知見/成績）の候補を集める。

- 新機能ネタが1件でもあれば最優先（機会ベースのため、出た時に逃さない）
- 無ければ他3系統から選ぶ。データ知見・会場特性は各モジュールが未使用優先で候補をソート済みなので、先頭から選べばよい
- **頻度上限は系統合計で1晩1本**（spec.md非機能要件、品質が安定したと判断されるまでの初期運用値）
- 実データが必要な系統（データ知見・成績）で、Supabase接続失敗等により実データを検証できない場合は、**そのネタを見送り、翌日以降に再試行する**。プレースホルダーでの生成はしない（FR4）。これは「良いネタが無いから見送る」（design上明確に却下された考え方）とは別物——データ欠如という技術的な非該当条件

## 2. チャネル選定

`scripts/lib/contentChannels/channelMatrix.js`の`getChannelsForTopic(sourceId, options)`で、選んだネタが展開すべきチャネル一覧を取得する。

- **2026-09-02追加（TikTokガイドライン対応）**: 選んだ候補オブジェクトに`isGamblingRelevant`フィールドがある場合（`new-feature`系統の候補、`newFeatureSource.js`参照）、そのまま`getChannelsForTopic(sourceId, {isGamblingRelevant: candidate.isGamblingRelevant})`に渡す。フィールドが無い場合（`venue-characteristic`・`data-insight`・`daily-result`）は既定値（TikTok除外）のまま使う——個別ネタの安全性を独自に判断してオプションを付け足さない。安全と確信できる新しいネタ種別が必要な場合は、`docs/proposal/tiktok-non-gambling-content-ideas.md`のように新しいトピックモジュールとして設計してから追加する
- `competition-trivia`・`overseas-intro`・`service-trust`の3系統は現時点で`scripts/lib/contentTopics/`に候補生成ロジックが無い（`docs/design/content-multi-channel-pipeline/tasks.md`タスク41）ため、このRoutineでは選択できない

## 3. X/TikTok/YouTube動画の生成（2026-09-02追加、対象チャネルに含まれる場合）

2.で選定したチャネルにX・TikTok・YouTubeのいずれかが含まれる場合、このネタの実データを使って動画下書きを生成する。**含まれない場合はこの節を丸ごとスキップし、4.（ブログ本文の執筆）に進む**（この節は追加コストであり、全ネタに強制しない）。

### 3-1. 映像デザインの選定

- 実画面のスクリーンショットが使えるネタ（new-feature・data-insight）: 6.のブログ/note用カバー画像戦略と同じ実データ・実画面を動画内でも使う。`sns-video-studio/remotion/src/`配下の既存シーンコンポーネント（例: `noteVideoShared.jsx`の`SceneFeatures`）を再利用できないか先に確認する
- ランキング・比較型のデータ（venue-characteristic・data-insight）: `VenueRankingCM.jsx`の`SceneHook`/`RankRow`/`SceneCTA`等、既存のTikTok/Xランキング動画テンプレートをそのまま再利用する（2026-09-02、`BoatRankingCM_TechniqueConsistency`で実際に確立したパターン）
- 上記のいずれにも当てはまらない新しいデータ形状の場合のみ、新規コンポジションを作る。`sns_template_variants`テーブル（`active=true`）に既存の型が登録済みならそちらを優先し、新規コンポジションを作った場合のみ`created_by='routine'`で新規登録する（ADR 0029）
- YouTube向けは16:9（1920x1080）、X/TikTok向けは9:16（1080x1920）。同じネタでも尺・アスペクト比が異なるため、それぞれ専用に構成する（1つの動画を無理に両方へ流用しない）

### 3-2. TikTokガイドライン対応

2.の`getChannelsForTopic()`の戻り値に忠実に従う。TikTokが含まれていないネタでTikTok動画を作らない（`isGamblingRelevant`判定は2.で既に行っているため、ここで再判定しない）。

### 3-3. 実データ確認・レンダリング

`sns-hub-content-generation` Routine（`docs/operation/sns-video-producer-prompt.md`）で確立済みの技術手順をそのまま踏襲する:

- DBに実データがあることと、本番UIで実際に表示・再現できることは別物。台本確定前に必ずPlaywrightで実際の画面を確認する
- `sns-video-studio/remotion/`で`npm install`後レンダリングする。Remotion標準のヘッドレスChromeダウンロードはネットワーク許可リストでブロックされるため、環境にプリインストール済みのPlaywright用Chromiumヘッドレスシェルを明示的に指定する（`/opt/pw-browsers/`配下の`headless_shell`バイナリのパスを確認し、`--browser-executable`フラグまたは`remotion.config.mjs`の`Config.setBrowserExecutable()`で指定）
- ffmpegが無ければ`apt-get install -y ffmpeg`する
- 同ドキュメントのセルフレビューチェックリストで自己採点し、Failがあれば直して再レンダリングする
- `sns-video-studio/remotion/risk-rules.json`の各ルールを照合する。該当があれば`risk_flags`に記録する（ブロックしない、警告記録のみ）

### 3-4. サムネイル（YouTubeのみ）

`scripts/lib/contentChannels/renderCoverCard.js`の`COMPOSITION_IDS.youtubeThumbnail`（1280×720）で生成する。6.のブログ/noteカバー画像と同じ実データ・見出しを使い、チャネル間で見た目がバラバラにならないようにする。

### 3-5. アップロード・永続化

- Supabase Storageの非公開バケット`sns-hub-media`に動画・カバー画像をアップロードする（パス例: `{content_group_id}/{platform}-{language}.mp4`）
- `sns_drafts.video_storage_path`/`cover_image_path`には、**アップロード時に指定した生のStorageパス（例: `{content_group_id}/x-ja.mp4`）をそのまま保存する**（署名付きURLを保存しない）。読み取り側（管理画面の一覧取得`api/admin/sns-hub/drafts/index.js`・YouTube公開`publish-youtube.js`）が`api/_lib/snsHubHelpers.js`の`signStoragePath()`/`signStoragePaths()`で都度署名する設計に統一されている（2026-09-03確定）。**2026-09-02〜03に実際に発生した不具合**: 生成Routine側が`createSignedUrl()`で署名済みURLを直接列に保存した結果、読み取り側が「列の値は生パス」という前提で再署名しようとして失敗し、有効期限（当時は600秒→7日に延長して対処したが根本原因ではなかった）に関わらず管理画面が「動画準備中」表示のまま止まる不具合が発生した。生パス保存・都度署名への統一で解消済み
- `sns_drafts`テーブルにINSERTする。**`content_group_id`はブログ/note行（8.参照）と同じものを使う**（同一ネタであることをDB上で追跡できるようにする）。列: `format`（**ビジュアルテンプレート名のみ**。`sns_template_variants.format`と同じ語彙、Pipeline A（`sns-video-producer-prompt.md`）と統一する。ネタのsourceIdを入れない、2026-09-03修正）・`template_variant_id`・`language`（'ja'）・`platform`（'x'/'tiktok'/'youtube'）・`status`（'pending_review'）・`video_storage_path`・`cover_image_path`・`caption_text`・`hashtags`・`background_text`・`source_data`（使用した実データのJSON）・`risk_flags`
- キャプション・ハッシュタグは`docs/operation/x-operations-playbook.md`（X）・`docs/operation/sns-viral-copywriter-prompt.md`（TikTok）の作法に従う

## 4. ブログ本文の執筆

`.claude/CLAUDE.md`フローA-3の既存ルールに従う:
- 本文2,000〜3,500字目安、h2/h3で構造化
- 「よくある質問」セクション（`### 質問文`+回答形式、`## よくある質問`見出し必須）
- 「競艇」表記禁止（本文は「ボートレース」）
- 実データに基づく記述（`scripts/lib/supabaseClient.js`パターンで取得。取得できない場合は1.の見送りルールに従う）
- 既存記事（`public/blog/`配下の同系統記事）を参考に構成・文体を揃える
- 0.で確認済みの却下理由・戦略insightを構成・訴求の判断に反映する

## 5. note下書きの作成

1. 4.のブログ本文をもとに、`convert_to_note_markdown.py`と同じ変換ロジックでnote向けフォーマットに変換する（見出し記法・埋め込み構文の違いを吸収。ブログ本文と完全一致はさせない、ADR 0032参照）
2. 本文に画像、または新機能ネタの場合はYouTube動画リンクを必ず含める（文字だけの下書きにしない）。画像は6.で生成したカバー画像を使う
3. タグを付与する

## 6. カバー画像の生成（2026-09-02追加、旧「画像は人間が用意する」を置き換え）

`scripts/lib/contentChannels/coverImageStrategy.js`の`getCoverImageStrategy(topic)`で、選んだネタに対する調達方法を判定する。

- **`{ type: "screenshot", path }`**（新機能・データ知見ネタ）: `scripts/lib/contentChannels/captureScreenshot.js`の`captureScreenshot()`で、ローカルdevサーバー（`npm run dev`起動済み前提）の該当パスをPlaywrightで撮影する。ブログ用は1200×630のビューポートで撮影する
- **`{ type: "data-card" }`**（会場特性・成績ネタ）: `scripts/lib/contentChannels/renderCoverCard.js`の`renderCoverCard()`で`DataQuoteCard`（[`sns-video-studio/remotion/src/DataQuoteCard.jsx`](../../sns-video-studio/remotion/src/DataQuoteCard.jsx)）をレンダリングする。`COMPOSITION_IDS.blogOrNote`（1200×630、ブログ/note共通）を使う。**制作ルール（`docs/reference/brand-kit.md`「YouTube / ブログ / note カバー画像・サムネイル」参照、必須）**:
  - `headline`は本文の要点を15〜20字程度に要約したもの。表記ルール（「競艇」禁止等）に従う
  - `statValue`/`statLabel`には、**可能な限り**本文で使った実データの根拠数値（レース数・日数・会場数等、例:`"13,386レース"`/`"直近90日・24会場の実績データ"`）を入れる。定性的なネタ（会場特性の説明等）で該当する数値が無い場合は空文字列でよい（`caption`のみで表現する）
  - サイト名・タグライン・見出しゴールド固定・改行崩れ防止は`DataQuoteCard`自体が内蔵しているため、呼び出し側で追加対応は不要
- 保存先は`public/images/blog/{slug}.jpg`（Draft PRに含める）

## 7. 品質自己レビュー（FR4、多層防御）

1. **生成と採点を別ロール・別視点で行う**: 4.5で生成した内容を、初めて読む第三者として批判的に検証する。以下6項目（`.claude/CLAUDE.md`「ブログ記事の公開前品質チェック」と同一）:
   - 数値・データ整合性（元データから再計算し一致を確認する。目視のみで済ませない）
   - 現行仕様との整合性（`node scripts/maintenance/check-deprecated-terms.js`で機械確認）
   - 検索意図の網羅性
   - 用語・表記ルール
   - 多言語間の一貫性（該当する場合）
   - 構造要件（文字数・画像・FAQ）
2. 3.で動画を生成した場合、動画についても同ドキュメント（`sns-video-producer-prompt.md`）のセルフレビューチェックリストで別途採点済みであることを確認する（3-3で実施済み、ここで再実施はしない）
3. Failがあれば人間に見せる前に自分で修正し、1に戻って再採点する。Passするまで次のステップに進まない

## 8. 下書きの永続化（blog/note）

`sns_drafts`テーブルに以下の形でINSERTする（ADR 0032）。X/TikTok/YouTube動画分の下書きは3-5で既に永続化済みのため、ここではblog/note行のみを扱う:
- 同一ネタから派生するblog行・note行・（3.で作成した）x/tiktok/youtube行は同じ`content_group_id`を共有
- `platform`: `'blog'` / `'note'`
- `format`: **ビジュアルテンプレート名のみ**（6.で判定した`getCoverImageStrategy(topic).type`をそのまま使う、`'screenshot'`または`'data-card'`）。ネタのsourceIdをformat列に入れない（2026-09-03修正、要件12）。ネタ種別を後から知りたい場合は`content_group_id`経由で`sns_topics.content_type_id`を参照する設計に移行する（`docs/design/sns-topic-gate/`、ネタ生成ライン統合後）
- `title`・`caption_text`（本文）・`hashtags`（noteタグ）・`cover_image_path`または`embed_video_url`
- `status`: `'pending_review'`

ブログ行は同時にDraft PRも作成する（`git checkout -b`→ファイル作成→コミット→push→`gh pr create --draft`。2026-09-01のフローA Routine化検証で確立済みの手順と同じ）。作成したPR URLを`pr_url`列に保存する。6.で生成したカバー画像も同じPRに含める。

## 9. 使用履歴の更新

会場特性・データ知見ネタを使った場合、対応する`recordUsage()`関数（`venueCharacteristicSource.js`/`dataInsightSource.js`）を呼び、履歴JSONに使用日時を追記する。

## 制約（絶対厳守）

- 頻度上限（1晩1本）を超えて生成しない
- 7.の採点でFailのまま次に進まない
- masterへの直接コミット・マージは行わない、Draft PRのみ
- カバー画像は6.の仕組み（スクリーンショットまたはDataQuoteCard）で必ず用意する。人間が事前に用意した画像への依存はしない
- X/TikTok/YouTube動画は2.のチャネル判定結果に忠実に従う。判定に含まれないチャネル向けの動画を独自判断で追加生成しない
