# Blogチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、blog向けに割り当てられた`sns_topic_targets`をポーリングして記事下書き（Draft PR）を生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。`docs/operation/sns-pipeline-x.md`と同じ構成をテンプレートにしている。

**このRoutineはネタを自分で選定しない**。`sns-topic-proposer-weekly.md`・`sns-topic-proposer-daily-auto.md`が作った承認済みネタを拾って生成するだけの、疎結合な下流工程。

**noteパイプライン（`sns-pipeline-note.md`）はこのRoutineが生成した記事本文に依存する**（note下書きはblog記事をnote形式に変換して作る設計）。そのため、このRoutineは他チャネルより先に処理されることが望ましいが、厳密な順序保証はしない（noteパイプライン側がblog未完了時にスキップ・再試行する設計、`sns-pipeline-note.md`参照）。

## 実行トリガー

- 週次型（`venue-feature`）: 1時間おきのcronでポーリングする（2026-09-05、初期値の12時間おきから変更）
- 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする
- API起動（修正指摘）: `api/admin/sns-hub/drafts/[id]/redo.js`（2026-09-04、旧revise.jsと統合済み）（`platform='blog'`の下書きのみ）
- API起動（今すぐ生成、要件26）: `api/admin/sns-hub/topics/[id]/targets/[targetId]/fire.js`からのペイロード（`{action: 'generate_now', targetId}`）。`status='pending'`であることは検証済みの1件のみが対象。「1. claim対象の取得・claim」を丸ごとスキップし、`claimTopicTarget(targetId, routineRunId)`（`scripts/lib/snsTopics.js`）を`targetId`に対して直接呼ぶ（`docs/operation/sns-pipeline-x.md`の「A''. 即時生成フロー」と同じ思想）。戻り値がnullなら生成せず終了する（ADR 0036）。ただし0.5のチェックは省略しない

## 0. 蓄積されたフィードバックの確認

- `getRecentRevisions({ platform: "blog" })`（`scripts/lib/contentRevisionHistory.js`）
- `getActiveInsights({ platform: "blog" })`（`scripts/lib/snsStrategyInsights.js`）
- どちらも該当が無ければ通常通り進めてよい

## 0.5. 未マージDraft PRの重複防止チェック

`hasOpenBlogDraft()`（`scripts/lib/snsTopics.js`）を呼ぶ。trueなら**claimせずここで終了する**（通常ポーリング・今すぐ生成の両方で必須、省略しない）。

- 理由: blogチャネルの生成物（`src/data/blogPosts.js`の記事メタデータ配列）は全ての記事が同じ挿入位置に追記される共有ファイルのため、未マージのDraft PRが複数同時に存在すると、先にマージされた方が後発のPRを必ずコンフリクトさせる（2026-09-05、PR #519とPR #509/#512/#525が相互に複数回コンフリクトし直した実績あり）
- 恒久対策は`src/data/blogPosts.js`を手書き配列から個別ファイル由来の自動生成に置き換えること（未着手、将来のリファクタ課題）。それまでの間はclaim側を直列化して同時オープンPRの発生自体を防ぐ

## 1. claim対象の取得・claim

`docs/operation/sns-pipeline-x.md`の「1. claim対象の取得・claim」と同じ手順。`platform='blog'`のアカウントIDで`getClaimableTopicTargets()`を呼ぶ。1回の実行で処理するのは1件まで。

## 2. ネタ本文・根拠insightの確認

claimしたターゲットに紐づく`sns_topics.topic_text`・型・`source_insight_ids`を確認する（`sns-pipeline-x.md`の「2.」と同じ）。

## 3. ブログ本文の執筆

`.claude/CLAUDE.md`フローA-3の既存ルールに従う:
- 本文2,000〜3,500字目安、h2/h3で構造化
- 「よくある質問」セクション（`### 質問文`+回答形式、`## よくある質問`見出し必須）
- 「競艇」表記禁止（本文は「ボートレース」）
- 実データに基づく記述（`scripts/lib/supabaseClient.js`パターンで取得）
- 既存記事（`public/blog/`配下の同系統記事）を参考に構成・文体を揃える。**ただしカバー画像の挿入位置は4.のルールを優先する**（同系統の過去記事が4.のルール制定前に生成されたものだと、画像が文中に埋もれた構成をそのまま踏襲してしまうため）
- 0.で確認済みの却下理由・戦略insightを構成・訴求の判断に反映する
- **`src/data/blogPosts.js`の`title`は30〜60字、`description`は120〜160字に収める**（2026-09-08追加。6.5の機械的品質チェックの合格基準と一致させている。「既存記事を参考に」だけでは長さが揃う保証が無く、実際にこの2項目が原因で自動マージが働かないケースが判明したため明記した）
- **本文中に、サイト内の別ページへの内部リンク（`/blog/{slug}`・`/winning-technique?tab=...`等）を最低1本含める**（同上の理由で明記。既存記事を書き起こす際、関連する過去記事や分析ツールへの導線を必ず1箇所は入れる）

## 4. カバー画像の生成

`scripts/lib/contentChannels/coverImageStrategy.js`の`getCoverImageStrategy(topic)`で調達方法を判定する。

- **`{ type: "screenshot", path }`**: `scripts/lib/contentChannels/captureScreenshot.js`の`captureScreenshot()`でPlaywright撮影（1200×630）
- **`{ type: "data-card" }`**（会場特性・成績ネタは基本こちら）: `scripts/lib/contentChannels/renderCoverCard.js`の`renderCoverCard()`で`DataQuoteCard`をレンダリング（`COMPOSITION_IDS.blogOrNote`、1200×630）。`docs/reference/brand-kit.md`「YouTube / ブログ / note カバー画像・サムネイル」の制作ルールに従う
- 保存先は`public/images/blog/{slug}.jpg`（Draft PRに含める）
- **Markdown本文への挿入位置は記事の一番上に固定する**: タイトル見出し（`#`、存在する場合）の直後・本文の最初の段落（「はじめに」等の導入文）より前に配置する。「## はじめに」セクションの後や、データ解説セクションの直前など文中に挿入しない（2026-09-07、既存記事の構成を参考にする過程で画像が文中に埋もれるパターンが自己再生産され、複数記事で発生していたため明記。既存公開済み記事の位置修正はスコープ外、本ルールは以降の新規生成のみに適用する）
- **`![alt](path)`のaltは空文字にせず、画像の内容を要約した説明を必ず入れる**（2026-09-08追加。画像SEO・6.5の機械的品質チェックの合格基準）

## 5. 品質自己レビュー

`.claude/CLAUDE.md`「ブログ記事の公開前品質チェック」の6項目（数値・データ整合性、現行仕様との整合性、検索意図の網羅性、用語・表記ルール、多言語間の一貫性、構造要件）で自己採点する。Failがあれば直して再採点する。Passするまで次に進まない。

## 6. 下書きの永続化（Draft PR）

- `sns_drafts`テーブルにINSERTする。`content_group_id`はclaimしたネタの`sns_topics.id`をそのまま使う。列: `platform`（'blog'）・`format`（4.で判定したカバー画像戦略の`type`、`'screenshot'`または`'data-card'`）・`title`・`caption_text`（本文）・`cover_image_path`・`status`（'pending_review'）・`routine_run_id`
- `git checkout -b`→ファイル作成（`public/blog/{slug}.md`）→コミット→push→`gh pr create --draft`（`master`をベースブランチにする）。作成したPR URLを`pr_url`列に保存する。4.のカバー画像も同じPRに含める

## 6.5. 機械的な品質チェック→合格時のみ自動マージ

`node scripts/maintenance/finalize-blog-draft.js <draftId>`を実行する（2026-09-07追加、ユーザー要望: ブログの承認ステップを、自動チェック合格時のみ省略できるようにしたい）。6.でINSERTした`sns_drafts`のidをそのまま渡す。**このRoutine自身が実行する**（別セッション・GitHub Actions等を待たない）。

- `scripts/maintenance/verify-blog-draft-quality.js`が、文字数・サムネ画像の位置・旧モデル廃止済み機能への言及・禁止用語（「競艇」）・メタディスクリプションの文字長・タイトルの文字長・画像alt属性・内部リンクの有無・よくある質問セクションの9項目を機械的にチェックする
- **全項目合格の場合のみ**、このスクリプトがPRを自動マージ（`gh pr merge --squash`）し、`sns_drafts.status`を`'posted'`・`approver_id`を`sns_approvers`の「自動承認（品質チェック合格）」行に更新する。これで7.に進んでよい
- **1項目でも不合格の場合は何もしない**。`sns_drafts`は`status='pending_review'`のまま残り、これまで通りsns-hub管理画面で人間が確認・承認する（本節が無かった場合と同じ状態）
- ここでチェックできるのは文字列・構造として機械的に判定できる項目のみ。`.claude/CLAUDE.md`「ブログ記事の公開前品質チェック」6項目のうち、数値・データ整合性／検索意図の網羅性／多言語間の内容一貫性は意味理解が要るため対象外（この3項目に問題がある記事も、他の9項目さえ揃っていれば自動マージされうる、という残存リスクを認識しておく）

## 7. claimしたターゲットの完了処理

`markTopicTargetGenerated(targetId, draftId)`（`scripts/lib/snsTopics.js`）を呼ぶ。

## 制約（絶対厳守）

- 1回の実行で処理するネタは1件まで
- **platform='blog'の未マージDraft PRが存在する間は新規claimしない**（0.5参照）。通常ポーリング・今すぐ生成のどちらの起動経路でも例外なく適用する
- **1つのclaim済みターゲットにつき、`sns_drafts`行・Draft PRは必ず1件だけ作る**。3.の執筆後、レース結果が出ている・前提が古い等の理由で自分で内容の誤りに気づいた場合も、同一セッション内で2件目の記事・PRを作り直さない。誤りに気づいたら、まだINSERT/PR作成前ならその場で書き直してよいが、**一度`sns_drafts`にINSERTしてPRを作った後は、その回の生成物が最終版**とし、7.の完了処理（`markTopicTargetGenerated`）まで進める。修正は人間の下書き承認画面からの修正指摘操作に委ねる（2026-09-03、レース発走前提で書いた記事とレース結果を反映した記事の2件を同一セッションで作ってしまう不具合が発生し判明。誤った方のPRは`gh pr close`でクローズして解決した）
- claim対象が0件、または実データの裏付けが取れない場合は生成せず終了する
- masterへの直接コミットは行わない（Draft PRのみ）
- 「競艇」表記禁止（本文は「ボートレース」）
