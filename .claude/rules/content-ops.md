---
paths:
  - "public/blog/**"
  - "note-articles/**"
  - "sns-video-studio/**"
  - "src/data/blogPosts*.js"
  - "src/data/blog-posts/**"
  - "src/pages/admin/SnsHubAdmin*"
  - "src/pages/admin/sns-hub/**"
  - "scripts/lib/contentChannels/**"
  - "scripts/lib/contentTopics/**"
  - "data/analysis/x-posts/**"
  - "docs/design/content-ops-flow/**"
  - "docs/operation/sns-*"
---

# コンテンツ運用フロー（新機能展開・SNS運用・品質維持）

コンテンツ・SNSまわりを触るときに読み込まれる（上の`paths`）。セッション開始時の確認だけは常時発火する必要があるので、[`session-start-checks.md`](./session-start-checks.md)（常時読み込み）に置いてある。

## フローA: 新機能マルチチャネル展開

新機能の実装完了からYouTube解説動画・ブログ記事・X投稿・note投稿へ展開する一連の流れ。全体設計は [`docs/design/content-ops-flow/spec.md`](../../docs/design/content-ops-flow/spec.md) を参照。

**ネタ駆動のパイプライン（止まっている）**: 新機能／会場特性／データ知見／成績の4系統のネタから、チャネルごとにブログ・note・X・YouTubeのコンテンツを作る仕組みだった。`sns_topics`/`sns_topic_targets`によるネタゲート＋チャネル別パイプライン。Routine は止まり、ネタを書く口（朝の digest の登録・提案の起動・企画の検出・管理画面）も 2026-10-24 に消したので、今は新しいネタが作られない。今動いている投稿は全貌動画（hq の作り手→push-full-picture.js）と /today の X（snsTodayPlanner.js）（`docs/operation/sns-pipeline-{blog,note,x,youtube}.md`、設計は`docs/design/sns-topic-gate/`・ADR 0036〜0038）。sns-hub管理画面（`/admin/sns-hub`）で下書きの承認・（blog/youtubeは）自動公開を行う。管理画面のネタ承認・ネタ型設定・修正の依頼の口は、直近30日の利用0件のため 2026-10-24 に撤去した（hq SH01 R2）

### フローA-1: 並列着手とチャネル展開の基本ルール
- 機能実装完了（PRマージ）を単一トリガーとし、YouTube解説動画制作とブログ記事執筆は**並列で着手できる**。X・note投稿は両方の完成を待ってから着手する（記事だけ先に公開されて動画が後追いだとリンクが死ぬため）
- 別セッションが機能PRをマージして終了すると、誰も気づかず埋もれる。`session-start-check.js`の`missingContentIndex`が、AppRouter.jsxの新規ルートのうちcontent-index.json未カバーのものを検知して提示する（新ルート＝ブログが要る新機能とは限らないため強制はせず提示のみ）
- ブランド一貫性: 新しいチャネル向け画像・動画を作成する前に、必ず [`docs/reference/brand-kit.md`](../../docs/reference/brand-kit.md) のギャラリーを確認する。既存の採用実例と矛盾する独自デザイン（新しいロゴバッジの発明、実ヘッダーと異なるフォント処理等）を作らない。承認されたら、その場で`brand-kit.md`のギャラリーに実例を追記する
- 重複制作防止: フローA着手時、対応するLinearチケットを`In Progress`に変更する。新規の排他制御機構は作らない（並行時の実害は「同じ動画を2回作る」程度に留まるため）
- sns-hubへの連携: `content-index.json`（フローA-2）は`session-start-check.js`の`recentFlowAContent`経由でsns-hubの型選定（`docs/operation/x-operations-playbook.md`・`docs/operation/sns-video-producer-prompt.md`）からも参照される。新機能そのものの告知ではなく、その機能で見えるようになった実データ・実画面を素材として使う（「新機能告知単体は選ばない」）

### フローA-2: トレーサビリティ索引（content-index.json）
機能変更のたびに「どのページ・どのコンテンツが影響を受けるか」を機械的に特定するための索引。

- 新機能ごとに `docs/design/{feature-slug}/content-index.json` を作成する（テンプレート: `docs/design/_template/content-index.json`）。その機能に言及する静的ページ・note記事・ブログ記事・YouTube動画・X投稿を記録する
- 対象チャネルが無い機能は、空配列のまま放置せず `not_applicable: true` を明記する（「対象チャネルなしと確認済み」と「確認自体をしていない」を見分けるため）
- 既存の`content-index.json`の形式は`npm run verify:content-index`で確かめる（CI でも走る）。「本来必要なのに作られていない」の全自動検出はしない。新規作成は、その PR の完了条件として作業者が判断する

### フローA-3: 新機能リリース時のブログ記事ルール
新機能リリースは必ずブログ記事とセットで出す。記事作成時は以下を守る。

- **1機能1記事**: 複数機能をまとめた1記事にしない。SEOで異なる検索クエリを個別に拾うため
- **SEOを意識した文字数**: 1記事あたり本文2,000〜3,500字程度を目安にする。見出し（h2/h3）で構造化し、「何がわかるか」「使い方」「活用のポイント」「実践例」「まとめ」の型を基本にする
- **画像を組み合わせる**: 実際の機能のスクリーンショット（Playwrightで撮影したもので良い）を最低1枚、記事内に配置する。装飾目的の画像は不要
- 用語・文体は `.claude/rules/code-style.md`（「競艇」使用禁止等）に従う
- **「よくある質問」セクションを設ける**: `BlogPost.jsx`が`## よくある質問`セクションを自動検出してFAQPage構造化データを生成する（`src/utils/blogFaqSchema.js`）ため、`### 質問文` + 回答段落の形式でFAQセクションを含めると追加コード不要でSEO/AI引用対策になる
- **タイトル・メタディスクリプションの文字数**: `src/data/blog-posts/{slug}.json`の`title`は30〜60字、`description`は120〜160字に収める（検索結果で途中で切れるのを防ぐ）
- **画像alt属性**: カバー画像の`![alt](path)`は空文字にせず、内容を要約した説明を入れる
- **内部リンク**: 本文中に、関連する過去記事や分析ツール（`/winning-technique`等）へのリンクを最低1本含める
- **featured記事は英訳も同時作成する**: featured記事（`src/data/blog-posts/{slug}.json`の`featured: true`。並び順は`featuredRank`）を新規公開する際は、英語版（`public/blog/{slug}-en.md` + `src/data/blog-posts/en/{slug}.json`）も同一PRまたは近接PRで作成する。対象言語は英語のみ（zh-TW/koは需要が確認できるまで見送り）。実装パターンは`docs/design/blog-i18n/`・`docs/adr/0005〜0007`

### フローA-4: 新規ページ追加時のsitemap登録（必須）
新しい静的ページ・ルート（`AppRouter.jsx`に`<Route>`を追加するもの）を実装したら、**同じPRで**`scripts/generate-sitemap.js`の`staticPages`（多言語対応ページは`LOCALIZED_PAGES`/`LANGUAGE_ONLY_PAGES`）にも追記する。sitemap反映まで含めて1タスクとして扱う。

sitemap変更は`.github/workflows/update-sitemap.yml`で毎日自動反映され、変更があった場合はSearch Consoleへの再送信（`scripts/submit-sitemap.js`）も自動実行される。個々のページの即時インデックス登録を保証するものではない（`docs/operation/search-console-report.md`）。

登録漏れは`npm run verify:sitemap`（`scripts/maintenance/verify-sitemap-coverage.js`）が検知し、Quality Gates CI でも走る（ADR-0072）。意図的にsitemap非対象とするルート（リダイレクト専用・管理画面・非公開ページ等）は、スクリプト内の`EXPECTED_EXCLUSIONS`に理由付きで登録する。

---

## フローB: sns-hub日常運用

X・YouTube・note への定常投稿は SNS マーケティングハブ（`src/pages/admin/SnsHubAdmin.jsx`・`src/pages/admin/sns-hub/`、設計は`docs/design/sns-marketing-hub/`・`docs/design/sns-hub-phase2-pdca-loop/`・`docs/design/sns-pdca-loop/`）が担う。フローAの「新機能ローンチ」とは独立した、継続的なコンテンツサイクル。

- sns-hubの動画・画像生成プロンプトも、着手前に[`docs/reference/brand-kit.md`](../../docs/reference/brand-kit.md)を参照する。色・フォントを個別プロンプト内に直書きしない
- 無人のクラウドRoutineは外部サイト（X等）を閲覧できない（WebFetch/curlは許可リスト外ドメインに一律`EGRESS_BLOCKED`、ヘッドレスChromiumも外部接続不可。`docs/design/sns-hub-phase2-pdca-loop/spec.md`）。外部閲覧・生成・投稿が絡む作業は、Routineではなく対話セッションに委ねる
- **デザイン・BGM等の抜本的な作り込みはsns-hub UI上では行わない**。sns-hub UIは運用（生成物の承認・却下・軽微な修正指摘）に専念し、複数案を比較しながら作り込みたい場合は`/refine-creative`を対話で使う。sns-hub UI上で「制作仕様を変えたい」というフィードバックを受けた場合も、`/refine-creative`の利用を案内する
- 投稿の送信: 全貌動画と /today の X 投稿は、検査が通れば承認なしで自動で送る（`.claude/CLAUDE.md`「確認のバッチ化を標準運用にする」の例外、ADR-0094）。それ以外の投稿は、1件ごとにユーザーの承認を得てから送る

### フローB-1: 新しいネタ種別は、チャネル別の生成物をユーザーが確認してから実運用に入る

新しいネタ種別（`sns_topic_categories` の行）を追加してパイプラインに載せただけでは**実運用開始としない**。**チャネルごとに実データで生成した投稿内容をユーザーに提示し、明示的なOKを得てから**日常運用に組み入れる。仕様書・プロンプトのレビューでは出てこない問題（文字数の上限超過、画面との掲載順の食い違い、不自然な日本語、母数の小さい行を母数なしで載せる等）は、実際の投稿イメージを見て初めて分かる。

- X の文字数の上限は 280 weight（日本語1文字=2、URLは23）。X Premium は使っていないので長文は投稿できない

**手順**:
1. その種別の実データで、**有効な全チャネル分**の投稿内容を生成して提示する（Routineを待たず、対話セッションで書いてよい）
2. プラットフォームの制約を**実測**する（文字数はコードで数える。「だいたい収まるはず」で出さない）
3. ユーザーの指摘を各チャネルのプロンプト（`docs/operation/sns-pipeline-*.md`）に反映する
4. **ユーザーのOKが出るまでは実運用としない**。その間も下書きの生成自体は続けてよい（提示する材料になるため）が、投稿はしない
5. 重すぎる・不要と判断されたチャネルは、`sns_topic_category_channels` の `enabled` を落とす（管理画面の「ネタ型設定」は 2026-10-24 に撤去した。hq SH01 R2）

### フローB-2: 投稿の「型」を変える PR はチャネルの評価役を通す

投稿の「型」を変える PR は、チャネルの評価役の評価を必須にする。

| 変える型 | 必須の評価役 |
|---|---|
| /today の X 投稿 | `x-channel`（`.claude/agents/x-channel.md`） |
| 全貌動画（Remotion の型・文型） | `x-channel` と `youtube-channel`（`.claude/agents/youtube-channel.md`） |

- 評価の結果は PR コメントに書く
- P0 は直してからマージする。P1 は PR の本文に残す
- 毎日の投稿そのものは毎日は審査しない（関門は機械の検査だけ）。毎日の見返しは hq の X 担当が行う
- 根拠: 2026-10-20 オーナー承認（hq の `drafts/marketing-review-20261020.md` v2 の3）

---

## フローC: 既存コンテンツの品質・鮮度維持

機能追加・UI変更・モデル変更のたびに静的ページ・過去のnote/ブログ記事・視覚素材が陳腐化しうる問題、および各チャネルの画像・動画・CTAが場当たり的に作られ統一感を欠く問題への対策。設計の全体像は [`docs/design/content-ops-flow/spec.md`](../../docs/design/content-ops-flow/spec.md) を参照。

**核心の方針**: 「人間が覚えている」ことに依存する仕組みは形骸化する。機械的に判定できるものは実装完了チェックリスト（フローA-2）またはGitHub Actions、判断が要るものはセッション開始時の能動チェックまたはSlack通知のどちらかに必ず寄せる。

### フローC-0: セッション開始時チェックの統合（session-start-check.js）
以下のセッション開始時の確認（フローC-2・C-4・C-5・C-7・C-8・C-10・C-11）を、`node scripts/maintenance/session-start-check.js`が1回の実行で集約する（C-6 は依頼で起動するもの、C-9 は GitHub Actions）。**セッション開始時、このスクリプトを実行し、結果をこのセッションの最初の応答で報告する**（判定ロジックはスクリプト冒頭のコメント。以下の本文は、確認後に何をするかの手順）。

### フローC-2: セッション開始時のX動画投稿確認
Xは「可能な範囲で毎日投稿する」運用（`docs/operation/x-operations-playbook.md`）。本日の投稿状況は`session-start-check.js`の`xVideo`で取得できる。

- `data/analysis/x-posts/history.json`を確認し、本日の投稿本数が目標本数（`docs/operation/x-operations-playbook.md`）に達していなければ、**このセッションの最初の応答で**「本日Xに動画を投稿しますか？」と自発的に確認する（ユーザーから話しかけられるのを待たない）。「1本投稿した＝その日は完了」と早合点しない
- 「はい」と回答があれば、`docs/operation/x-operations-playbook.md`の型選定ロジックに従って本日の内容を判断し、一言で提案してから動画制作（または既存ストック動画の選定）に着手する。制作前に`docs/reference/brand-kit.md`を確認する
- セッション内で確認して「いいえ」または反応が無ければ、その日はスキップし`history.json`に`status: "skipped"`として記録、次のタスクに進む（催促を続けない）。この`skipped`は「確認した上で見送った日」専用で、セッションが一度も開かれなかった日はエントリを作らない
- 自動送信の対象（全貌動画と /today の X 投稿）以外は、動画が完成したらユーザーに提示し、承認を得てから投稿操作に進む
- 投稿完了後、`data/analysis/x-posts/history.json`に日付・型・題材・動画ファイルパス・投稿ステータスを追記する

### フローC-4: セッション開始時の選手ニュース要確認リスト提示
選手ニュース自動収集（`racer-news-auto-collect`）はVercel Cron（`api/cron/racer-news.js`。予備として GitHub Actions の`collect-racer-news.yml`も並走）で毎日実行され、`boatrace.jp`公式ニュースアーカイブ（レーサーデータカテゴリ）から選手の節目記録（通算◯勝達成等）を検出し、登録番号によるDB照合を通過したものは人手承認なしで`racer_news`へ自動投入する（ADR-0024）。選手の特定に失敗した候補（登録番号がDBに無い、支部が一致しない等）は自動投入されず、DBの表`racer_news_pending`（`docs/db-migration/080_racer_news_pending.sql`。旧来のファイル`data/analysis/racer-news-pending-review/pending.json`も読み、DBの状態を優先）に記録される。未確認件数・項目は`session-start-check.js`の`racerNews.pendingCount`・`racerNews.items`で取得できる。`racerNews.dbError`が出た場合は、DBの表に接続できず、ファイル分だけを数えている。

- `racerNews.pendingCount`が1件以上（`racerNews.items`に`id`・`reason`・`sourceUrl`）あれば、**このセッションの最初の応答で**自発的に提示し、`racer_news`への投入可否を確認する
- 承認されたら`scripts/maintenance/add-racer-news.js`でINSERTし、`node scripts/maintenance/resolve-racer-news-pending.js --id=<id> --status=approved`で該当項目を承認済みに、却下されたら`--status=rejected`に更新する（`--list`で未確認の一覧を表示できる。ファイル側だけにある項目は`pending.json`の`status`を書き換える）
- 掲載頻度自体が月1〜2件と低い。溜まっている場合は実行状況（Vercelの`racer_news`ジョブ＝`scrape_job_state`の`last_success_at`・`last_error`、予備の`.github/workflows/collect-racer-news.yml`）も確認する

### フローC-5: セッション開始時の集客調査スキル実行確認
SNSマーケティングハブ Phase 2（改善案の自律立案ループ、`docs/design/sns-hub-phase2-pdca-loop/`）は、`/x-growth-report`・`/note-growth-report`の定期実行結果をinsightとしてDBに登録し（ADR 0027）、週次で生成Routineへの反映を判定する（ADR 0030）。外部調査はクラウドRoutineでは実行できないため、対話セッション側でのスキル定期実行に依存する。鮮度は`session-start-check.js`の`growthSkills`で取得できる。

- `data/analysis/x-growth/`・`data/analysis/note-growth/`それぞれの最新レポートファイルの日付を確認し、どちらかが1週間以上前であれば、**このセッションの最初の応答で**該当スキル（`/x-growth-report`・`/note-growth-report`）の実行を自発的に提案する
- 「はい」と回答があれば該当スキルを実行する（両方が該当する場合、まとめて提案してよい）
- 「いいえ」または反応が無ければその日はスキップし、次のタスクに進む（催促を続けない）

### フローC-6: 自然言語「集客状況を調査して」トリガー時は3スキルセットで実行
「集客を分析して」「集客状況どう？」等の自然言語依頼（`/growth-pdca`と明示コマンド指定しない場合）では、`/growth-pdca`（Search Console/GA4、検索流入・ブログ側）に加えて`/x-growth-report`（Xの実績）・`/note-growth-report`（noteの実績）も続けてまとめて実行する。X・note の実績確認には Claude in Chrome での画面操作を含むので、実行時間が伸びる。`/growth-pdca`と明示コマンドで呼ばれた場合は対象外（Search Console/GA4単体で実行する）。
- 過去レポートが1件も無い場合は「初回実行の提案」として扱う

### フローC-7: 視覚素材の鮮度チェック
テキストのgrepでは検知できない`/about`のヒーロー動画のような素材の陳腐化に対応する。`session-start-check.js`の`visualAssetAge`で、`public/videos/`・`public/images/blog/`配下の主要素材の最終更新日一覧が確認できる（90日以上未更新の素材数を`staleCount`で提示）。**陳腐化の自動判定はしない**（判断は人間）。モデルを改修したら、紹介動画が古くなっていないかも確かめる。

### フローC-8: 「気づいたが手が回らない」品質課題の軽量バックログ化
デザイン・CTA・画像の質が最適でないという課題を、都度フルスペックで指摘しなくても拾える仕組み。Linearの`content-quality`ラベルで軽量起票する。粒度は「後で拾えるチケットの種」でよい。

- `session-start-check.js`の`qualityBacklog`で、ラベル付きIssueのうち起票日が古い順に2〜3件を提示する
- ブランド・デザイン品質に関する気づき（新しい画像・動画の制作時、既存チャネルのレビュー時等）は、都度この`content-quality`ラベルで起票する

### フローC-9: 押す（push）層 — GitHub Actions定期チェック＋Slack通知
`session-start-check.js`は「セッションが開かれたら実行される」引く仕組みで、セッションが長期間開かれなければ実行されない。判断・生成が要らない機械的チェック（トレーサビリティのカバレッジ・視覚素材の鮮度・品質バックログの件数）は`.github/workflows/content-ops-nightly-check.yml`で毎日夜間に実行し、閾値超過時（視覚素材90日超・品質バックログ10件超・content-index形式エラーあり）のみ`SLACK_WEBHOOK_URL`（`slack-notify-pr.yml`と同経路）へ通知する。

### フローC-10: 廃止済み用語の機械的検知（UI文言・note下書き・ブログ記事）
「廃止が確定している具体的な用語・機能名がまだ残っていないか」を機械的に検知する。

- `docs/reference/deprecated-terms.json`に廃止済み用語（旧3モデル体系・「今日のおすすめ」機能・旧ブランド名等）を一元管理する。新たに機能を廃止したら、都度このファイルに追記する
- `node scripts/maintenance/check-deprecated-terms.js`が、静的ページ（`About.jsx`・`FAQ.jsx`・`HowToUse.jsx`・各言語版ガイド）・オンボーディングUI（`FirstVisitGuideCard.jsx`）・note下書き（`note-articles/`）・ブログ記事（`public/blog/`）を対象にgrepし、ヒット件数を報告する
- `docs/reference/`配下の内部ドキュメント（用語集・DB設計等）は対象外
- 検知できるのは「この単語が存在すること」だけで、文脈が本当に矛盾しているかは目視確認が必要。ヒット件数は`session-start-check.js`の`deprecatedTerms`で取得できる

### フローC-11: セッション開始時の戦略メモ（insight）承認待ち確認
`sns_strategy_insights`の`status='proposed'`（要判断）は、sns-hub「戦略メモ」タブの手動採用ボタンで人間が個別に承認する。件数は`session-start-check.js`の`pendingInsights`で取得できる。

- `pendingInsights.pendingCount`が1件以上あれば、**このセッションの最初の応答で**最も古い1件（`oldest`）の内容を自発的に提示し、「戦略メモの承認画面で確認しますか？」と一言確認する
- 承認・却下の判断自体はsns-hub管理画面（`/admin/sns-hub/metrics`「戦略メモ」タブ）で行う（Claude Code側から代理で採用・却下しない）
- 「いいえ」または反応が無ければその日はスキップし、次のタスクに進む（催促を続けない）

## ブログ記事の公開前品質チェック（新規作成・改稿とも必須）
ビルドとE2Eだけでは記事の中身の質を担保できない。新規記事・既存記事の改稿（画像追加、FAQ追加等）を問わず、公開前に次の4つのレビューを通す。

1. `content-qa`（7観点。手順の正本は `.claude/commands/publish-blog.md` の「2. 公開前品質チェック」）で不合格が0
2. `wording-editor` で P0・P1 が0
3. ファンのレビュー（`boatrace-fan-reviewer` か `discussion-panel`）で P0・P1 が0
4. `seo-marketer` で P0・P1 が0

チェック結果は「合格/不合格」で明示し、不合格があれば直してそのレビューを回し直す。4つとも通れば、ブログ記事の掲載・改稿はユーザーの承認なしでマージしてよい（`.claude/skills/orchestrate/SKILL.md` 4節の段階0 F）。事業・法務・ブランドの表記、「競艇」の例外、誇大・的中率・回収率の表現、原稿の主張を変える改稿など判断が要るものはユーザーに回す。
