# コンテンツ運用フロー（新機能展開・SNS運用・品質維持）

このファイルはフロントマターを持たないため、対象パス・実行環境に関わらず全セッションに自動的に読み込まれる（`.claude/rules/sns-content-generation.md`と同じ扱い）。フローC-0〜C-11がセッション開始時の能動チェックに依存し、特定のファイル編集を伴わないため、パス条件では正しく発火しない（2026-09-16、プロジェクトCLAUDE.mdの肥大化対策[BOA-317]でこのファイルに分離した際の判断）。

## フローA: 新機能マルチチャネル展開

新機能の実装完了からYouTube解説動画・ブログ記事・X投稿・note投稿へ展開する一連の流れ。全体設計・現状の課題分析は [`docs/design/content-ops-flow/spec.md`](../../docs/design/content-ops-flow/spec.md) を参照（2026-09-01策定）。

**ネタ駆動マルチチャネルパイプライン（2026-09-04時点: sns-topic-gate体系へ移行済み）**: 新機能／会場特性／データ知見／成績の4系統のネタから、チャネルごとに最適化したブログ・note・X・TikTok・YouTubeコンテンツを生成する仕組み。2026-09-01策定の初期設計（`content-multi-channel-pipeline-prompt.md`、単一Routineが5チャネル全生成を担当する方式）は、ネタ承認前に全チャネル分を生成してしまう・修正ルールが伝播しないという課題から`docs/design/sns-topic-gate/`（spec/plan、ADR 0036〜0038）へ再設計され、`sns_topics`/`sns_topic_targets`によるネタゲート＋チャネル別パイプライン（`docs/operation/sns-pipeline-{blog,note,x,tiktok,youtube}.md`）に置き換わった（旧設計文書は`docs/archive/`へ移動済み）。sns-hub管理画面（`/admin/sns-hub`）にTikTok/X/YouTube/Note/Blogの5プラットフォームタブが追加されており、下書きの承認・却下・（blog/youtubeは）自動公開をここで行う。

### フローA-1: 並列着手とチャネル展開の基本ルール
- 機能実装完了（PRマージ）を単一トリガーとし、YouTube解説動画制作とブログ記事執筆は**並列で着手できる**（互いを待つ理由がない）。X・note投稿は両方の完成を待ってから着手する（記事だけ先に公開されて動画が後追いだとリンクが死ぬため）
- 「PRマージを単一トリガーとする」だけでは、別セッションが機能PRをマージして終了した場合に誰も気づかず埋もれるリスクがあった（2026-09-01発覚）。`session-start-check.js`の`missingContentIndex`が、AppRouter.jsxの新規ルートのうちcontent-index.json未カバーのものを機械的に検知し提示する（新ルート＝ブログが要る新機能とは限らないため強制はせず提示のみ）
- ブランド一貫性: 新しいチャネル向け画像・動画を作成する前に、必ず [`docs/reference/brand-kit.md`](../../docs/reference/brand-kit.md) のギャラリーを確認する。既存の採用実例と矛盾する独自デザイン（新しいロゴバッジの発明、実ヘッダーと異なるフォント処理等）を作らない。承認されたら、その場で`brand-kit.md`のギャラリーに実例を追記する（後日まとめての更新にしない）
- 重複制作防止: フローA着手時、対応するLinearチケットを`In Progress`に変更する。新規の排他制御機構は作らない（複数セッション並行時の実害は「同じ動画を2回作る」程度に留まるため、厳密な排他制御より軽い運用で十分と判断）
- sns-hubへの連携: `content-index.json`（フローA-2）は`session-start-check.js`の`recentFlowAContent`経由でsns-hubの型・キャラ選定ロジック（`docs/operation/x-operations-playbook.md`・`docs/operation/sns-video-producer-prompt.md`）からも参照される。新機能そのものの告知ではなく、その機能で見えるようになった実データ・実画面を推し活・人間味のある文脈の"素材"として使う位置づけ（「新機能告知単体は選ばない」という既存ルールは変更しない）

### フローA-2: トレーサビリティ索引（content-index.json）
機能変更のたびに「どのページ・どのコンテンツが影響を受けるか」を機械的に特定する手段がなかったことへの対策。

- 新機能ごとに `docs/design/{feature-slug}/content-index.json` を作成する（テンプレート: `docs/design/_template/content-index.json`）。その機能に言及する静的ページ・note記事・ブログ記事・YouTube動画・X投稿を記録する
- 対象チャネルが無い機能は、空配列のまま放置せず `not_applicable: true` を明記する（「対象チャネルなしと確認済み」と「確認自体をしていない」を機械的に見分けるため）
- **実装完了後の自動レビュー（プロジェクトCLAUDE.md参照）で`npm run verify:content-index`を実行**し、既存の`content-index.json`の形式が壊れていないかを確認する。「本来必要なのに作られていない」の全自動検出はしない（機能の一覧を機械的に列挙する手段がsitemapのルートほど自明ではないため）。新規作成自体は、このPRの完了条件として人間（多くはClaude自身）が判断する

### フローA-3: 新機能リリース時のブログ記事ルール
2026-07-30時点で「新機能リリースは必ずブログ記事とセットで出す」運用を再開した（4月以降ブログ更新が止まったことがPV下落の一因だったため）。記事作成時は以下を守る。

- **1機能1記事**: 複数機能をまとめた1記事にしない。SEOで異なる検索クエリを個別に拾うため、機能ごとに記事を分ける
- **SEOを意識した文字数**: 1記事あたり本文2,000〜3,500字程度を目安にする（既存記事の分量感を踏襲）。見出し（h2/h3）で構造化し、「何がわかるか」「使い方」「活用のポイント」「実践例」「まとめ」の型を基本にする
- **画像を組み合わせる**: 実際の機能のスクリーンショット（Playwrightで撮影したもので良い）を最低1枚、記事内に配置する。装飾目的の画像は不要
- 用語・文体は `.claude/rules/code-style.md`（「競艇」使用禁止等）に従う
- **「よくある質問」セクションを設ける**: `BlogPost.jsx`が`## よくある質問`セクションを自動検出してFAQPage構造化データを生成する（`src/utils/blogFaqSchema.js`）ため、`### 質問文` + 回答段落の形式でFAQセクションを含めると追加コード不要でSEO/AI引用対策になる
- **タイトル・メタディスクリプションの文字数**: `blogPosts.js`の`title`は30〜60字、`description`は120〜160字に収める（2026-09-08追加。検索結果でタイトル・スニペットが途中で切れるのを防ぐ）
- **画像alt属性**: カバー画像の`![alt](path)`は空文字にせず、内容を要約した説明を入れる（画像SEO）
- **内部リンク**: 本文中に、関連する過去記事や分析ツール（`/winning-technique`等）へのリンクを最低1本含める
- **featured記事は英訳も同時作成する（2026-08-11〜）**: featured記事（`blogPosts.js`の`featured: true`）を新規公開する際は、英語版（`public/blog/{slug}-en.md` + `src/data/blogPostsEn.js`へのエントリ追加）も同一PRまたは近接PRで作成する。対象言語は英語のみ（zh-TW/koは対象外、需要が確認できるまで見送り）。ブログi18nの実装パターン・設計判断は`docs/design/blog-i18n/`（spec/screens/plan/tasks）・`docs/adr/0005〜0007`を参照

### フローA-4: 新規ページ追加時のsitemap登録（必須）
2026-07-31時点で、`/winning-technique`が`scripts/generate-sitemap.js`への追加漏れで長期間sitemap.xmlに未掲載、Google未インデックスのままだった実績あり（Search Console実データで検索クリック・表示回数0件と確認）。同じ漏れを繰り返さないため、新しい静的ページ・ルート（`AppRouter.jsx`に`<Route>`を追加するもの）を実装したら、**同じPRで**`scripts/generate-sitemap.js`の`staticPages`（多言語対応ページは`LOCALIZED_PAGES`/`LANGUAGE_ONLY_PAGES`）にも追記する。ページ単体の実装が完了した時点で完了とせず、sitemap反映まで含めて1タスクとして扱う。

sitemap変更は`.github/workflows/update-sitemap.yml`で毎日自動反映され、変更があった場合はSearch Consoleへの再送信（`scripts/submit-sitemap.js`）も自動実行される。ただし個々のページの即時インデックス登録を保証するものではない（詳細は`docs/operation/search-console-report.md`）。

登録漏れは`npm run verify:sitemap`（`scripts/maintenance/verify-sitemap-coverage.js`）で機械的に検知できる。AppRouter.jsxの静的ルートとgenerate-sitemap.jsのstaticPagesを突き合わせ、未登録があれば失敗する。新規ルート追加を含むPRでは実装完了後の自動レビュー（`npm run build`実行時）にこのコマンドも合わせて実行する。意図的にsitemap非対象とするルート（リダイレクト専用・管理画面・非公開ページ等）は、スクリプト内の`EXPECTED_EXCLUSIONS`に理由付きで登録する。

---

## フローB: sns-hub日常運用

X/TikTokへの定常投稿は `src/pages/admin/SnsHubAdmin.jsx` 等で構築中のSNSマーケティングハブ（Phase 1稼働中、Phase 2でPDCAループ設計中、`docs/design/sns-marketing-hub/`参照）が担う。フローAの「新機能ローンチ」とは独立した、既存ユーザー向けの継続的なコンテンツサイクル。詳細な運用ルールは`docs/design/sns-marketing-hub/`・`docs/design/sns-hub-phase2-pdca-loop/`を参照。

- sns-hubの動画・画像生成プロンプトも、着手前に[`docs/reference/brand-kit.md`](../../docs/reference/brand-kit.md)を参照する。色・フォントを個別プロンプト内に直書きしない
- 無人のクラウドRoutineは外部サイト（X/TikTok等）を自律的に閲覧できないと確定済み（WebFetch/curlは許可リスト外ドメインに一律`EGRESS_BLOCKED`、ヘッドレスChromiumも外部接続不可。`docs/design/sns-hub-phase2-pdca-loop/spec.md`参照）。外部閲覧・生成・投稿が絡む作業は、Routineではなく対話セッションに委ねる設計を維持する
- **デザイン・BGM等の抜本的な作り込みはsns-hub UI上では行わない**（2026-09-04）。sns-hub UIは運用（生成物の承認・却下・軽微な修正指摘）に専念し、複数案を比較しながら作り込みたい場合は`/refine-creative`スキルをClaude Codeとの対話で使う。sns-hub UI上で「制作仕様を変えたい」というフィードバックを受けた場合も、その旨をユーザーに伝え`/refine-creative`の利用を案内する

---

## フローC: 既存コンテンツの品質・鮮度維持

機能追加・UI変更・モデル変更のたびに静的ページ・過去のnote/ブログ記事・視覚素材が陳腐化しうる問題、および各チャネルの画像・動画・CTAがセッションごとに場当たり的に作られ統一感を欠く問題への対策。設計の全体像・検討過程は [`docs/design/content-ops-flow/spec.md`](../../docs/design/content-ops-flow/spec.md) を参照。

**核心の方針**: 「人間が覚えている」ことに依存する仕組みは遅かれ早かれ形骸化する（tweet-draftsが14件→38件まで滞留した実績あり）。機械的に判定できるものは実装完了チェックリスト（フローA-2参照）またはGitHub Actions、判断が要るものはセッション開始時の能動チェックまたはSlack通知のいずれかに必ず寄せる。

### フローC-0: セッション開始時チェックの統合（session-start-check.js）
以下の既存確認ルール（フローC-2〜C-5）に加え、トレーサビリティ索引カバレッジ・視覚素材鮮度・品質バックログの3項目を、`node scripts/maintenance/session-start-check.js`が1回の実行で集約する。**セッション開始時、このスクリプトを実行し、結果をこのセッションの最初の応答で報告する**（各項目の判定ロジック詳細はスクリプト冒頭のコメントを参照。以下フローC-2〜C-5の本文は、確認後に実際に何をするか＝実行手順として引き続き有効）。

note.com向け下書き生成・Xツイート下書き生成・投稿滞留チェック（旧フローC-1）は、sns-hubパイプライン（ネタ→チャネル別下書き自動生成→admin承認）に代替されたため廃止した（2026-09-05）。`note-articles/tweet-drafts.md`・`convert_to_note_markdown.py`・`scripts/generate-tweet-draft.js`自体は削除せず残置している。

### フローC-2: セッション開始時のX動画投稿確認（2026-08-24〜）
X運用の長期戦略議論を経て、Xも「可能な範囲で毎日投稿する」運用に変更した（`docs/operation/x-operations-playbook.md`の「X投稿頻度・型選定ロジック」参照）。上記のXツイート下書き（noteブログ告知等のテキスト投稿）とは別に、**動画投稿**については以下をセッション開始時に必ず行う（本日の投稿状況は`session-start-check.js`の`xVideo`で機械的に取得できる）。

- `data/analysis/x-posts/history.json`を確認し、本日の投稿本数が目標本数（マスコットテスト期間中は3本/日、`docs/operation/x-operations-playbook.md`参照）に達していなければ、**このセッションの最初の応答で**「本日Xに動画を投稿しますか？」と自発的に確認する（ユーザーから話しかけられるのを待たない）。「1本投稿した＝その日は完了」と早合点しない
- 「はい」と回答があれば、`docs/operation/x-operations-playbook.md`の「型・キャラ選定ロジック」に従って本日の内容を判断し、一言で提案してから動画制作（または既存ストック動画の選定）に着手する。制作前に`docs/reference/brand-kit.md`を確認する
- セッション内で確認して「いいえ」または反応が無ければ、その日はスキップし`history.json`に`status: "skipped"`として記録、次のタスクに進む（催促を続けない）。この`skipped`は「確認した上で見送った日」専用で、セッションが一度も開かれなかった日はエントリを作らない
- **SNS投稿の自動化・自動承認は行わない**（1件ごとの明示的承認が必須という制約は不変）。動画が完成したらユーザーに提示し、承認を得てから投稿操作に進む
- 投稿完了後、`data/analysis/x-posts/history.json`に日付・キャラ・型・題材・動画ファイルパス・投稿ステータスを追記する

### フローC-3: セッション開始時のTikTok投稿確認（2026-08-24〜）
TikTokは運用が軌道に乗り次第「毎日投稿」を目標とする運用に合意した（`docs/operation/sns-marketing-strategy.md`のフェーズ設計を参照）。Xの下書きと異なり事前に用意された下書きは無く、**その日の題材・型をClaudeが投稿履歴から判断して新規に考える**運用のため、以下をセッション開始時に必ず行う（本日の投稿状況は`session-start-check.js`の`tiktok`で機械的に取得できる）。

- `data/analysis/tiktok-posts/history.json`を確認し、本日まだ投稿していなければ、**このセッションの最初の応答で**「本日TikTokに動画を投稿しますか？」と自発的に確認する（ユーザーから話しかけられるのを待たない）
- 「はい」と回答があれば、`docs/operation/sns-video-producer-prompt.md`の「TikTok投稿頻度・型選定ロジック」に従って本日の型・題材を判断し、一言で提案してから動画制作に着手する。制作前に`docs/reference/brand-kit.md`を確認する
- セッション内で確認して「いいえ」または反応が無ければ、その日はスキップし`history.json`に`status: "skipped"`として記録、次のタスクに進む（催促を続けない）。**この`skipped`は「確認した上で見送った日」専用**であり、そもそもその日セッションが一度も開かれなかった日は誰も確認していないため`skipped`を書き込まない（無理に埋め合わせない、記録が単に存在しない日として扱う）
- **SNS投稿の自動化・自動承認は行わない**（Xツイート下書きと同じ制約。送信を伴うアクションは1件ごとの明示的承認が必須）。動画が完成したらユーザーに提示し、承認を得てから投稿操作に進む
- 投稿完了後、`data/analysis/tiktok-posts/history.json`に日付・型・題材・動画ファイルパス・投稿ステータスを追記する

### フローC-4: セッション開始時の選手ニュース要確認リスト提示（2026-08-27〜）
選手ニュース自動収集（`racer-news-auto-collect`）はGitHub Actionsで毎日自動実行され、`boatrace.jp`公式ニュースアーカイブ（レーサーデータカテゴリ）から選手の節目記録（通算◯勝達成等）を検出し、登録番号によるDB照合を通過したものは人手承認なしで`racer_news`へ自動投入する（ADR-0024参照）。ただし選手の特定に失敗した候補（登録番号がDBに無い、支部が一致しない等）は自動投入されず、`data/analysis/racer-news-pending-review/pending.json`に記録される（未確認件数は`session-start-check.js`の`racerNews.pendingCount`で機械的に取得できる）。

- `pending.json`に`status: "pending"`の項目があれば、**このセッションの最初の応答で**自発的に提示し、`racer_news`への投入可否を確認する（ユーザーから話しかけられるのを待たない）
- 承認されたら`scripts/maintenance/add-racer-news.js`でINSERTし該当項目の`status`を`approved`に、却下されたら`rejected`に更新する
- 掲載頻度自体が月1〜2件と低いため、このリストは頻繁には溜まらない想定。溜まっている場合はGitHub Actionsの実行状況（`.github/workflows/collect-racer-news.yml`）も確認する

### フローC-5: セッション開始時の集客調査スキル実行確認（2026-08-29〜、2026-09-05にnote追加）
SNSマーケティングハブPhase 2（改善案の自律立案ループ、`docs/design/sns-hub-phase2-pdca-loop/`）は、`/x-growth-report`・`/tiktok-growth-report`・`/note-growth-report`の定期実行結果をinsightとしてDBに登録し（ADR 0027）、週次で生成Routineへの反映を判定する（ADR 0030）設計。外部調査（競合・隣接ジャンル観測）はクラウドRoutineでは技術的に実行できないと確定しているため（`sns_marketing_hub_operational_state.md`メモリ参照）、対話セッション側でのスキル定期実行に運用が依存する。過去にX戦略の定期施策が「決めただけで仕組み化されず自然消滅した」実績（2025-12）があるため、以下をセッション開始時に必ず行う（鮮度は`session-start-check.js`の`growthSkills`で機械的に取得できる）。

- `data/analysis/x-growth/`・`data/analysis/tiktok-growth/`・`data/analysis/note-growth/`それぞれの最新レポートファイルの日付を確認し、いずれかが1週間以上前であれば、**このセッションの最初の応答で**該当スキル（`/x-growth-report`・`/tiktok-growth-report`・`/note-growth-report`）の実行を自発的に提案する（ユーザーから話しかけられるのを待たない）
- 「はい」と回答があれば該当スキルを実行する（複数プラットフォームが該当する場合、まとめて提案してよい）
- 「いいえ」または反応が無ければその日はスキップし、次のタスクに進む（催促を続けない）

### フローC-6: 自然言語「集客状況を調査して」トリガー時は4スキルセットで実行（2026-08-31〜、2026-09-05にnote追加）
「集客を分析して」「集客状況どう？」等の自然言語依頼（`/growth-pdca`と明示コマンド指定しない場合）では、`/growth-pdca`（Search Console/GA4、検索流入・ブログ側）に加えて`/x-growth-report`（Xプラットフォーム自体の実績）・`/tiktok-growth-report`（TikTokプラットフォーム自体の実績）・`/note-growth-report`（noteプラットフォーム自体の実績）も続けてまとめて実行する。4スキル合計でChrome in Claudeでの画面操作（X/TikTok/noteは実績確認のため）を含み実行時間が伸びる点、Search Console等の反映ラグ（2〜3日）と比べて高頻度で聞くと同じデータの再取得になりやすい点を踏まえた上でユーザーが合意済み（2026-08-31、note追加は2026-09-05）。`/growth-pdca`と明示コマンドで呼ばれた場合は対象外（これまで通りSearch Console/GA4単体で実行、X/TikTok/note分析は含めない）。
- 過去レポートが1件も無い場合は「初回実行の提案」として扱う

### フローC-7: 視覚素材の鮮度チェック
テキストのgrepでは検知できない`/about`のヒーロー動画のような素材の陳腐化に対応する。`node scripts/maintenance/session-start-check.js`の`visualAssetAge`で、`public/videos/`・`public/images/blog/`配下の主要素材の最終更新日一覧が確認できる（90日以上未更新の素材数を`staleCount`で提示）。**陳腐化の自動判定はしない**（判断は人間）。過去に「モデル刷新後も古い動画のまま5日間放置」が実際に発生している（`promo_video_stale_after_model_change.md`メモリ参照）。

### フローC-8: 「気づいたが手が回らない」品質課題の軽量バックログ化
陳腐化だけでなく、そもそもデザイン・CTA・画像の質が最適でないという課題を、都度フルスペックで指摘しなくても拾える仕組み。Linearの`content-quality`ラベル（2026-09-01新設）で軽量起票する（このセッションの`spawn_task`相当の代替）。粒度は「詳細な要件定義」ではなく「後で拾えるチケットの種」でよい。

- `node scripts/maintenance/session-start-check.js`の`qualityBacklog`で、ラベル付きIssueのうち起票日が古い順に2〜3件を提示する（tweet-draftsと同じ鮮度優先ペース）
- ブランド・デザイン品質に関する気づき（新しい画像・動画の制作時、既存チャネルのレビュー時等）は、都度この`content-quality`ラベルで起票する。起票して終わりにせず、`session-start-check.js`経由で定期的に拾われる前提の運用とする

### フローC-9: 押す（push）層 — GitHub Actions定期チェック＋Slack通知
`session-start-check.js`は「セッションが開かれたら実行される」引く仕組みであり、セッションが長期間開かれなければ一度も実行されない。この穴を埋めるため、判断・生成が要らない機械的チェック（トレーサビリティのカバレッジ・視覚素材の鮮度・品質バックログの件数）は`.github/workflows/content-ops-nightly-check.yml`で毎日夜間に定期実行し、閾値超過時（視覚素材90日超・品質バックログ10件超・content-index形式エラーあり）のみ既存の`SLACK_WEBHOOK_URL`（`slack-notify-pr.yml`と同経路）へ通知する。無人Routineが外部サイトを閲覧できない制約（フローB参照）とは異なり、このワークフローはリポジトリ内スクリプト＋Linear APIのみで完結するため無人実行に適する。

### フローC-10: 廃止済み用語の機械的検知（UI文言・note下書き・ブログ記事）
「このオンボーディングカードの文言は今の仕様と矛盾している」という意味理解による陳腐化検知は不可能。ただし「廃止が確定している具体的な用語・機能名がまだ残っていないか」は機械的に検知できる（ブログ記事の公開前チェック「現行仕様との整合性」で既に確立していた手法を横展開）。

- `docs/reference/deprecated-terms.json`に廃止済み用語（3モデル体系・「今日のおすすめ」機能・旧ブランド名「BoatAI」等）を一元管理する。新たに機能を廃止したら、都度このファイルに追記する
- `node scripts/maintenance/check-deprecated-terms.js`が、静的ページ（`About.jsx`・`FAQ.jsx`・`HowToUse.jsx`・各言語版ガイド）・オンボーディングUI（`FirstVisitGuideCard.jsx`）・note下書き（`note-articles/`）・ブログ記事（`public/blog/`）を対象にgrepし、ヒット件数を報告する
- `docs/reference/`配下の内部ドキュメント（用語集・DB設計等）は対象外（歴史的経緯の記録として旧用語を含んでいてよいため）
- 検知できるのは「この単語が存在すること」だけで、文脈が本当に矛盾しているかは目視確認が必要。ヒット件数は`session-start-check.js`の`deprecatedTerms`で件数のみ機械的に取得できる

### フローC-11: セッション開始時の戦略メモ（insight）承認待ち確認（2026-09-05〜）
`sns_strategy_insights`の`status='proposed'`（要判断）は、sns-hub「戦略メモ」タブの手動採用ボタン（PR #514）で人間が個別に承認する設計。tweet-drafts.md（最大38件滞留）・X動画投稿・TikTok投稿と同じ「セッション開始時チェックが無いと人間が承認を忘れて滞留する」パターンの再発を防ぐため、以下をセッション開始時に必ず行う（件数は`session-start-check.js`の`pendingInsights`で機械的に取得できる）。

- `pendingInsights.pendingCount`が1件以上あれば、**このセッションの最初の応答で**最も古い1件（`oldest`）の内容を自発的に提示し、「戦略メモの承認画面で確認しますか？」と一言確認する（ユーザーから話しかけられるのを待たない）
- 承認・却下の判断自体はsns-hub管理画面（`/admin/sns-hub`「戦略メモ」タブ）で行う（Claude Code側から代理で採用・却下しない、insight内容の妥当性判断は人間に委ねる）
- 「いいえ」または反応が無ければその日はスキップし、次のタスクに進む（催促を続けない）

## ブログ記事の公開前品質チェック（新規作成・改稿とも必須）
2026-08-16時点で、ビルド成功やE2Eといった構造面の検証だけでは記事の中身の質を担保できないことが判明した（既存featured記事に旧モデル廃止済み機能への言及が残ったまま公開されていた実例あり）。新規記事・既存記事の改稿（画像追加、FAQ追加等）を問わず、公開前に以下の観点を実際に検証し、パス/フェイルを明確にしてから完了報告する。

1. **数値・データ整合性**: 本文中の数値と表・図解の数値が一致しているか、計算式（期待値=的中率×オッズ等）を実際に再計算して検証する。他の既存記事で言及されている同じ数値（控除率25%等）と矛盾していないか横断確認する
2. **現行仕様との整合性**: 記事が言及する機能・UI要素・モデル名が現在も実在するか。過去のモデル刷新・機能撤去（3モデル切替→unified化等）で廃止済みの用語が残っていないか、`node scripts/maintenance/check-deprecated-terms.js`（フローC-10）で機械的に確認する
3. **検索意図の網羅性**: 対象キーワード（Search Console等で実際に観測されたクエリ）に対して、記事が実際に読者の疑問に答えられているか。見つかった観測クエリの一覧と記事の対応関係を確認する
4. **用語・表記ルール遵守**: `.claude/rules/code-style.md`（「競艇」使用禁止等）
5. **多言語間の一貫性**: 翻訳版がある場合、見出し数・主張・数値がja/en間で一致しているか
6. **構造要件**: 文字数（2,000〜3,500字目安。既存の長文記事を改稿する場合はこの限りではないが、超過時は理由を明示する）・画像・FAQセクションの有無。**データ・数値を扱う記事は、比較対象が3件以上ある場合や複数の指標を並べる場合、文章だけで羅列せず表や図解を使って構造化する**（2026-09-02追加、チャネル品質検証の合格基準として明示）

チェック結果は「合格/不合格」で明示し、不合格項目があれば必ず修正してから完了報告する。「ビルドとE2Eが通ったので完了」で済ませない。
