# レガシー棚卸し（2026-10-18）

古い文書・使われていない仕組み・死んだコードを洗い出した表と、整理の順番の案。調べただけで、削除・書き換えはしていない。

- 基準のコミット: master `bf491fe06`
- 調べた範囲: docs/ 全体、.claude/、AGENTS.md、scripts/、.github/workflows/、api/、src/、ルート直下、メインの作業ツリーの未追跡ファイル、git のブランチと worktree
- 調べ方: 領域ごとに読み取り専用のサブエージェントを5つ並列で走らせ、主な指摘を親セッションで裏取りした

## 0. 調べ方と前提

### 分類

| 分類 | 意味 |
|---|---|
| 生きている | 今も使われ、現状と合っている |
| 古い | 参照はあるが、書いてあることが現状と食い違う |
| 死んでいる | どこからも使われない・参照されない |
| 重複 | 同じ内容が2か所以上にある |
| 履歴 | 経緯（「〜日に〜した」）や最終更新日が本文の多くを占める。`.claude/rules/documentation.md` に反する |

### 「現状」として使った根拠

| 項目 | 現状 | 根拠 |
|---|---|---|
| Codex | レビュアーと実装者の両方を担い、`codex/` から PR を直接出す | AGENTS.md:3,11（#1625） |
| TikTok | 2026-10-05 にアカウントがバンされた | docs/operation/sns-hub-rollout-status.md:46 |
| X の送信 | 検査が通れば承認なしで自動送信する | docs/adr/0094、.claude/CLAUDE.md「確認のバッチ化」の例外 |
| スクレイピング | Vercel に集約済み。`scrape.yml`・`scrape-exhibition.yml` は無い | docs/adr/0066 |
| ファンパネル | 4人。旧8人パネルは廃止 | .claude/CLAUDE.md:17 |
| note/X の下書き生成 | sns-hub に移行済み | .claude/rules/content-ops.md フローC-0 |
| Routine | `sns-hub-video-compaction` 以外の8件は 2026-09-15 から止まっている | docs/setup/claude-account-migration.md:37-47 |
| マスコット CM | 削除済み | docs/reference/brand-kit.md:86 |

### 手法の限界

- 「参照あり」は、ファイル名の grep が当たったかどうかだけで判定している。コメントや文書での言及も1件と数えるので、生きている側に寄る（特に scripts/analysis）。
- 最終更新日は、一括修正のコミット（2026-10-02 の236本など）で上書きされている。日付は使用状況を表していない。
- `session-start-check.js` は、このシェルの Node v16 では動かなかった（`blogPosts.js` が Node 20.16 以上を要求する）。セッション開始時の確認結果はこの文書に含めていない。

---

## 1. 棚卸しの表

### 1-1. メインの作業ツリーの未追跡・無視されたファイル

**他のセッションが作業中かもしれない。** 消す前に、持ち主のセッションへ確認する。

| パス | 追跡 | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|---|
| `4・5・6号艇の好走条件.md`（36KB） | 未追跡 | 死んでいる候補 | 2026-10-14 作成。外部 AI の調査報告の体裁。参照0 | 持ち主に確認する。要るなら `docs/reference/` に kebab-case で入れる | 中（作業中の可能性） |
| `AI動画生成の自動化戦略.md`（33KB） | 未追跡 | 死んでいる候補 | 2026-10-16 作成。動画生成の構成を調べた報告。参照0 | 同上。要るなら `docs/proposal/` へ | 中（同上） |
| `boa667-plan.json`（1.28MB）・`boa667-plan.log` | 未追跡 / log は無視 | 死んでいる | 2026-10-06。BOA-667 の backfill の計画出力。修正は dcac0c207 でマージ済み | 削除 | 低 |
| `backfill-{dec,jan,feb}.log` | 無視 | 死んでいる | 2026-02-13 の backfill のログ | 削除 | 無 |
| `.claude/settings.local.json.bak-doctor` | 未追跡 | 死んでいる | 2026-09-28、doctor が作ったバックアップ | 削除（オーナー個人の設定なので本人が行う） | 低 |
| `data/analysis/{i18n-demand,search-console,serp-snapshots,x-referral}/report-2026-09-2*.json`（5件） | 未追跡 | 古い | 2026-09-27〜29 のレポート出力で、コミットされていない | 他のレポートと同じ扱いでコミットするか、削除 | 低 |
| `data/analysis/growth-pdca-major-initiatives.json` | 追跡（変更あり） | 要確認 | 2行の未コミットの変更 | 持ち主に確認 | 中 |
| `test-results/`・`dist/` | 無視 | 生きている（生成物） | Playwright とビルドの出力 | そのまま | 無 |

### 1-2. ルート直下（git 追跡）

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| check-data-structure.mjs / check-patterns-exist.mjs / check-turnprediction.mjs | 死んでいる | 参照0。`feature_contributions` を一度だけ確かめた使い捨て。2026-05-24 | 削除 | 低 |
| convert_md_to_html.py / convert_to_note_format.py / normalize_markdown.py | 死んでいる・重複 | 参照0。2025-12-18 から更新なし。note 変換の旧版 | 削除 | 低 |
| convert_to_note_markdown.py | 古い | content-ops.md:103 に「廃止したが残置」とある。docs/operation/sns-pipeline-note.md:42 が変換ロジックの参照先にしている | docs/archive へ移し、sns-pipeline-note.md:42 を直す | 中（リンク切れ） |
| tmp.py | 死んでいる | 参照0。スクレイピングの試作（`pd` の import も無い）。2025-12-18 | 削除 | 低 |
| analysis/（25件） | 古い | ルートの analysis/ を指す参照は0（当たるのは data/analysis/）。model-volatility-correlation の一回きりの分析。2026-01-05 | docs/archive か scripts/analysis へ移す | 低 |
| archive/（32件） | 古い・重複 | 参照0。規則が定める置き場は docs/archive/。旧レポート、test-*.js、maintenance-scripts-deprecated/ | docs/archive と統合するか削除 | 低 |
| console_result/（4件） | 死んでいる | 参照0。コンソール出力の貼り付け。2025-12-18 | 削除 | 低 |
| screenshot/IMG_0908.PNG | 死んでいる | 参照0。2025-12-20 | 削除 | 低 |
| tmp/tmp | 死んでいる | 参照0。AdSense 審査についての会話ログ。2026-01-05 | 削除 | 低 |
| README.md | 古い | 食い違いは下の表 | AGENTS.md の概要に合わせて書き直す | 低 |
| playwright.config.js / playwright.x-send.config.js | 生きている | package.json の `test:e2e`・`test:x-send-ui`、CI から使われる | そのまま | 無 |
| playwright.acceptance.config.js | 生きている（手動用） | sdd-workflow.md:53、step4.md:22、acceptance-test-writer から手で実行する | npm script にする | 無 |
| playwright.{deadline-queue,mobile-approval,edit-assist}.config.js | 生きている（手動用）・重複 | docs/design/sns-hub-*/contract.md からだけ参照。edit-assist は mobile-approval を継承している | 1本の設定の projects にまとめる | 低（継承を一緒に直す） |
| playwright.existing-fixes.config.js | 古い寄り | 参照は verify-e2e-recorded-network-allowlist.json だけ | 統合（allowlist も直す） | 低 |
| note-articles/（64件） | 生きている（一部古い） | check-content-quality-audit.js:52 が読む。tweet-drafts.md は旧フロー | tweet-drafts まわりだけ整理する | 中（品質監査が既存ファイルを前提にしている） |

**README.md の食い違い**

| 行 | README の記述 | 現状 |
|---|---|---|
| L3, L73-79 | 旧3モデル体系 | holmes（Sherlock・Watson・Adler・Mycroft・Moriarty）と poirot。思考アシスト・類似レース・節・選手ページ・sns-hub・多言語の記述が無い |
| L22, L112 | PWA（オフライン対応） | service worker は無い（manifest.json だけ） |
| L52-57 | 毎時実行・JST 3:00-22:00 | Vercel cron と cron-job.org |
| L111 | react-helmet-async | package.json に無い |
| L140 | TodaysPicks.jsx | ファイルが無い |
| L171 | scripts/lib/supabase.js | ファイルが無い（実体は supabaseClient.js） |
| L181 | .github/workflows/scrape.yml | ファイルが無い |
| L231-259 | スコアの計算式 | 旧ロジックのまま |
| L280-290 | 環境変数 | .env.example と合わない |
| L322 | develop ブランチのプレビュー | GitHub Flow で運用している |
| L354 | MIT License | LICENSE ファイルも package.json の license 欄も無い |

### 1-3. docs/operation

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| RULE_OPERATION_GUIDE.md | 古い | :54,:146「ruleMatchService.js の配列に追加」。正本は src/config/venueRules.js:2（BOA-567）。名前が kebab-case でない | venueRules.js を基準に書き直し、名前を変える | 低（参照2） |
| add-language.md | 生きている | src/config/languages.js が参照 | そのまま | 中 |
| analogy-weekly-train-dispatch.md | 生きている | cron の説明が今と合う | そのまま | 低 |
| api-architecture-analysis.md | 履歴・古い | :3 に作成日。race_grade を統一した時点の分析 | archive | 低 |
| bug-cause-measurement.md | 生きている | sdd-workflow.md、acceptance-test-writer、bug-cause-report.js が参照 | そのまま | 高 |
| codex-backlog.md | 古い | :3「2026-10-22 以降、Codex は直接 PR」。AGENTS.md（#1625）はすでに直接 PR が前提で、日付が合わない。本文の大半は旧方式のパッチレーン | 旧レーンの記述を削り、雛形だけ残す | 低 |
| content-pipeline-token-setup-guide.md | 生きている | youtube-shorts-metrics.js が参照 | そのまま | 中 |
| db-apply.md | 生きている | guard-deploy-approval.sh、orchestrate、db-apply.yml、dbApplySql.js が参照 | そのまま | 高 |
| external-cron-setup.md | 生きている（要確認） | 参照6。パターン A/B が ADR-0066 と合っているかは未確認 | 読み合わせる | 中 |
| i18n-demand-report.md | 生きている | i18n-growth-report、i18n-demand-report.js が参照 | そのまま | 高 |
| linear-cli.md | 生きている | CLI がある | そのまま | 低 |
| linear-ticket-creation-guide.md | 死んでいる | BOA-99〜103 を起票した一回限りの手順（2026-05） | archive か削除 | 低 |
| note-video-producer-prompt.md | 生きている | 参照6。TikTok の言及が3か所 | TikTok の行だけ削る | 中 |
| sdd-and-codex-review.md | 古い | :31「2026-07 時点で見送り」、:35 サブスク不要論、:61「Codex はコードを書き換えない」。今は AGENTS.md:3,11 | Codex の節を今の運用に書き直す | 高（documentation.md・CLAUDE.md・growth-pdca が参照） |
| search-console-report.md | 生きている | content-ops.md と scripts が参照 | そのまま | 高 |
| session-progress.md | 履歴・死んでいる | 表題に 2026-05-03、:135 に「最終更新」。参照0 | 削除 | 低 |
| sns-campaign-entry-detection.md / sns-campaign-result-backfill.md | 生きている | campaign-pipeline.yml がある | そのまま | 低 |
| sns-hub-codex-intake-handoff.md | 古い | 2026-10-08 時点のパッチ取り込みの引き継ぎ。直接 PR への移行で旧方式になった | archive | 低 |
| sns-hub-profile-csv.md | 生きている | 関数の使い方 | そのまま | 低 |
| sns-hub-rollout-status.md | 古い（時点の記録） | 「2026-10-08 時点」。:59「#1315 は承認待ち」だが、153 は適用済み（APPLIED.md:200） | 書き直すか archive | 低 |
| sns-marketing-strategy.md | 履歴・古い | :3 で「追記型」と明言。:230 以降は日付つきの決定ログ（304行中90行）。:12 は TikTok 前提、:30 以降はマスコット施策 | 今の方針だけを残し、ログは git 履歴に任せる | 高（content-ops.md、x-/tiktok-growth-report が参照） |
| sns-pdca-loop-runbook.md | 生きている | push-bundle.js が参照。ADR-0094 を反映しているのはこれだけ | そのまま | 中 |
| sns-pipeline-blog.md / -note.md / -x.md / -youtube.md | 生きている（Routine は停止中） | api・agent・コマンドが参照 | そのまま。停止中であることを冒頭に1行書く | 高 |
| sns-pipeline-morning-digest.md | 生きている | generate-morning-digest.js が参照 | そのまま | 中 |
| sns-pipeline-tiktok.md | 古い | TikTok はバン済み | archive | 中（campaign-pipeline.yml・request-spec-change.js が `sns-pipeline-` の前方一致で探す） |
| sns-posting-operations.md | 古い | :10「TikTok はアカウント開設後」、:7「投稿は毎回ユーザーが承認」。ADR-0094 と合わない | 書き直す（x-operations-playbook と統合してもよい） | 中 |
| sns-preview-bundle-import.md | 生きている | | そのまま | 低 |
| sns-topic-proposer-daily-auto.md / -weekly.md | 生きている（Routine は停止中） | trigger-*.js が参照 | そのまま | 中 |
| sns-video-producer-prompt.md | 古い（一部） | :6,:10,:12,:23 が TikTok 前提。参照52 | TikTok の節を削る | 高（rules 2本・コマンド5本・agent が参照） |
| sns-viral-copywriter-prompt.md | 古い（一部） | :35 以降が TikTok のキャプションの作法 | 削る | 高 |
| ticket-update-plan.md | 死んでいる | 2026-05-03 作成、BOA-99 の更新計画 | 削除か archive | 低 |
| tiktok-posting-operations.md | 古い | TikTok アカウントが前提（バン済み） | archive | 中（tiktok-growth-report・channel-algorithm-research が参照） |
| unified-model-monthly-review.md | 生きている | review-unified-model-params.js がある | そのまま | 低 |
| weather-in-escape-refresh.md | 生きている | 四半期の運用 | そのまま | 低 |
| x-operations-playbook.md | 古い（一部） | :62 マスコットの3日間テスト、:77「型・キャラ・題材」、TikTok の言及5か所。自動送信が反映されていない | 書き直す | 高（content-ops.md・コマンド・scripts 2本が参照） |

### 1-4. docs/proposal

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| DATA_ACQUISITION_STRATEGY.md | 古い | :24 毎時の GitHub Actions、:79 外部 cron＋Actions。今は ADR-0066 | archive（正本は design/scraping-vercel-consolidation） | 中（参照6） |
| DATA_FLOW_COMPARISON.md | 採用済み | design/race-cancellation-detection と ADR-0040 が引用 | archive（リンクも直す） | 低 |
| ai-agent-era-strategy.md | 生きている | aiCrawlerBots.js と verify 3本が参照 | そのまま | 中 |
| ai-chat-analysis-feature.md | 死んでいる候補 | :3「検討中」のまま、2026-08-20 から動いていない。DifyChat.jsx は未接続（1-12） | 廃案かどうかをオーナーに確認して archive | 低 |
| boatrace-competitor-landscape-2026-09.md / boatrace-inbound-demand-and-marketing-2026-09.md | 生きている（時点の調査） | | そのまま | 低 |
| competitor-kyoteibiyori/01〜06, 10〜12, competitor-analysis-kyoteibiyori.md | 生きている（調査資料） | 参照0だが、競合の調査の原典 | そのまま | 低 |
| competitor-kyoteibiyori/07-racer.md / 08-motor.md / 09-venue-info.md | 一部採用 | design/racer-search-and-list、motor-strength-compare、venue-* に対応物がある | そのまま | 低 |
| competitor-kyoteibiyori/data-coverage-comparison-2026-09-14.md | 生きている | 参照8 | そのまま | 中 |
| competitor-kyoteibiyori/data-readiness-and-scraping-optimization-2026-09-15.md | 重複・採用済み | :37 で BOA-313 が「In Progress」のまま（実装済み）。data-inventory・DATA_SCRAPING_GAPS と重なる | archive | 低 |
| competitor-kyoteibiyori/race-detail-page-tab-comparison-2026-09-15.md | 採用済み | design/race-detail-ui-unify などに対応物がある | archive | 低 |
| competitor-kyoteibiyori/race-tab-item-inventory.md | 生きている | BOA-365 の網羅を確かめる基準 | そのまま | 低 |
| gemini-scraping-design.md | 生きている | design/scraping-vercel-consolidation と ADR-0067 が引用 | そのまま | 中 |
| holmes-model-methods-survey.md | 一部採用 | scripts/ml の2本と design/mycroft-transformer が参照 | そのまま | 中 |
| scraping-full-coverage/data-inventory-2026-09-15.md | 採用済み・重複 | design/scraping-full-coverage がある | archive | 低 |
| scraping-serverless-migration/investigation.md | 採用済み | :3「採用・実装済み」。参照10 | design/scraping-serverless-migration/ へ移す | 中（リンク10件） |
| sns-marketing-hub-external-draft.md | 採用済み・死んでいる | 1258行、参照0。採用版は design/sns-marketing-hub | archive | 低 |
| tiktok-non-gambling-content-ideas.md | 古い | 対象が TikTok。:3,:73 のリンク先は archive に移っていて切れている | archive | 中（channelMatrix.js・newFeatureSource.js のコメントが参照） |
| 方向性.md | 死んでいる | 改行の無い1行の要求メモ。参照0。名前が規約外 | 削除か archive | 低 |

### 1-5. docs/reference

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| analysis-guide.md | 古い | :37,:42,:58 などで、存在しないパスを10件挙げている | 書き直すか archive | 低 |
| api-implementation-guide.md | 死んでいる | 参照0 | archive | 低 |
| brand-kit.md | 生きている | rules 2本・agent・refine-creative・coverImageStrategy.js が参照 | :3 の TikTok の言及だけ直す | 高 |
| cache-strategy.md / css-scoping.md / design-system.md / i18n-glossary.md / seo-architecture-constraints.md | 生きている | rules・agent・CI が参照 | そのまま | 高 |
| database-design.md | 生きている | generate-database-design-sections.js がこのファイルを書き換える | 存在しない update-venue-course-entry-baseline.js への言及1行を直す | 高（生成スクリプトが依存） |
| deprecated-terms.json / display-coverage.md / shared-logic-index.md | 生きている（機械が読む） | check / generate / verify のスクリプトが読み書きする | そのまま | 高 |
| developer-overview.md | 古い | :26,:39-40,:178 が GitHub Actions でのスクレイピング（ADR-0066 と合わない）。:464 に作成日 | archive か書き直す | 低 |
| note-algorithm-and-growth-notes.md / x-…md / youtube-…md | 生きている・重複 | knowledge/{note,x,youtube}.md と中身が近い。knowledge/README.md:3 は「正本は1か所」と定めている | knowledge へ寄せるかを決める | 中 |
| race-conditions-table-design.md | 古い | :5「フロントエンドには返却されません」。今は get_today_races が JOIN して返す（APPLIED.md:163） | 書き直すか database-design に統合 | 低 |
| racer-score-rate-rules.md / rough-water-trait-verification.md | 生きている | | そのまま | 低 |
| shorts-hook-strength-audit-2026-09-10.md | 履歴 | 初回の監査の記録が本文の大半。恒久ルールは brand-kit にある | archive | 低 |
| sns-brand-guideline.md | 生きている・重複 | 参照9。brand-kit と役割が重なる | brand-kit に統合するか検討 | 中 |
| system-specification.md | 古い | :3,:33,:85 が旧3モデル体系。:224-225 の scrape.yml・scrape-exhibition.yml は無い | 書き直す | 低 |
| tiktok-algorithm-and-growth-notes.md | 古い | TikTok はバン済み | archive | 中（tiktok-growth-report が参照） |
| user-value-proposition.md | 死んでいる候補 | 参照は session-progress だけ | 内容をオーナーに確認する | 低 |

### 1-6. docs/setup・docs/analysis

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| setup/automation-setup.md | 古い | :138,:152 の send-email-notification.yml が無い | archive | 低 |
| setup/cache-verification-setup.md | 古い（一部） | :12,:114 が pre-push-verify-cache.sh を前提にしているが、このフックは登録されていない（1-10） | 「CI の verify-cache で検査する」に直す | 低 |
| setup/claude-account-migration.md | 生きている | Routine の正本の表 | そのまま | 中 |
| setup/claude-code-setup.md | 生きている（要確認） | 2026-02-15。中身は settings の確認程度 | 内容を確かめる | 低 |
| setup/claude-routines/index.json | 生きている | content-ops.md・AGENTS.md が参照 | tiktok の行を外す | 高 |
| setup/claude-routines/sns-hub-content-generation.prompt.md | 生きている（一部古い） | TikTok に5回触れている | TikTok を削る | 中 |
| setup/claude-routines/sns-hub-video-compaction.prompt.md | 生きている | 動いている唯一の Routine | そのまま | 高 |
| setup/claude-routines/sns-pipeline-{blog,note,x,youtube}.prompt.md、sns-topic-proposer-{daily-auto,weekly}.prompt.md | 生きている（停止中） | index.json が指す | そのまま | 中 |
| setup/claude-routines/sns-pipeline-tiktok.prompt.md | 古い | TikTok はバン済み | index.json と一緒に archive か削除 | 中 |
| setup/env-vars.md | 生きている | CLAUDE.md が参照 | そのまま | 高 |
| setup/google-sheets-setup.md | 死んでいる | 対応する update-google-sheets.yml が自動では動かない（1-11） | ワークフローと一緒に archive | 低 |
| setup/linear-setup.md | 古い（一部） | MCP が `.mcp.json` の http（OAuth）に変わったのに反映されていない | MCP の節を直す | 低 |
| setup/sendgrid-setup.md | 死んでいる | send-email-notification.js を起動するワークフローが無い | archive | 低 |
| analysis/firstmark-turnprediction-investigation.md | 死んでいる | 参照0。docs/analysis/ は documentation.md の配置表に無い | archive に移し、ディレクトリを消す | 低 |

### 1-7. docs/issues

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| .gitkeep | 死んでいる | ディレクトリは空でない | 削除 | 無 |
| CSS_CACHE_ISSUE.md | 解決済み | 表題に「解決済み」 | archive | 低 |
| DATA_SCRAPING_GAPS.md | 古い | :9 の scrape.yml が無い（ADR-0066） | 今のパイプラインに合わせて書き直す | 中（参照13、venueConfig.js も参照） |
| actual-course-null-after-results-backfill.md | 解決済み | BOA-523 の修正がマージ済み（82091740e） | archive | 低 |
| boa-327-missing-boat-rows.md | 解決済み | :26「#1195 で直した」 | archive | 低 |
| boa-380-missing-races.md / boa-544-refund-hit-flags-runbook.md / boa-679-motor-pretest-gap.md / boa-702-digest-motor-race-count.md / boa-721-missing-venue-days.md | 解決済み | それぞれ修正のコミットがある | archive | 低 |
| boa-580-opening-day-entries.md・.sql・-rollback.sql | 解決済み | 7d9d45aee | まとめて archive | 中（fix-opening-day-entries-from-b.js が参照） |
| boa-630-races-derived-backfill.sql（3009行） | 死んでいる | 参照0。BOA-630 はマージ済み | 削除か archive | 低 |
| boa-651-kb-archive-grade.md | 解決済み | 07f3aac1c | archive | 中（kbArchiveRows.js が参照） |
| boa-667-official-row-backfill.md・.sql | 解決済み（本番への適用は要確認） | dcac0c207 | archive | 中（disqualifiedFinishMark.js が参照） |
| boa-695-race-conditions-title-final-backfill.md | 解決済み | 25fdc001c | archive | 中（backfill-race-series-meta.js が参照） |
| boa-696-kb-archive-final-day.md | 要確認 | 修正のコミットを特定できなかった | 状態を確かめてから決める | 中 |
| boatcast-original-exhibition-investigation.md | 生きている | :89,:104 に未解決の項目 | そのまま | 中 |
| cancellation-status-readers-inventory.md / mikuni-2026-09-12-missed-results.md / series-day-mismatch-fix-2026-09-29.md | 解決済み | BOA-512・526・501 は修正済み | archive | 低 |
| opening-day-race-date-premise-reverification.md | 解決済み | c1a197fed | archive | 中（fix-tsu-2025-12-02-date.js が参照） |
| phantom-race-days-2026-04-onward-and-pipeline-review.md | 一部未解決 | :128 カテゴリ C が未解決 | 未解決の部分だけ残す | 低 |
| race-entries-duplicate-contamination-audit.md | 解決済み | 100 は適用済み | archive | 中（raceEntriesKbRestore.js が参照） |
| races-opening-day-missing.md | 一部未解決 | :135 の監視が未実装 | そのまま | 中 |
| trifecta-trio-naming-swap.md | 生きている | 命名の入れ替わりは今も注意が要る | そのまま | 中 |
| v3-design-data-flow-review.md | 死んでいる | 2026-03-07 時点のレビュー。参照0 | archive | 低 |
| venue-not-in-k-phantom-race-days.md | 解決済み | BOA-407 の調査は完了 | archive | 中（delete-phantom-race-days.js が参照） |

**注意**: issues/ をまとめて archive に移すと、scripts/ のコメント中のパスが切れる（上の「中」の行）。移すときは、参照しているスクリプトのコメントも同じ PR で直す。

### 1-8. docs/archive・docs/knowledge・docs/adr

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| archive/ISSUES.md・TODO.md・migration-plan.md・PERFORMANCE_IMPROVEMENT_PLAN.md・quick-reference.md・project-context.md・project-rules.md・token-optimization.md・claude-readme.md・claude-code-best-practices.md・新モデル案.md | 死んでいる | archive の中からしか参照されない | 削除（git 履歴に残る） | 無 |
| archive/linear-*.md（9本）・claude-code-linear-*.md（2本） | 死んでいる・重複 | 2026-01 の旧 Linear 連携 | 削除 | 無 |
| archive/ルール例・ルール例2・ルール例3・ルール例4 | 死んでいる | 拡張子が無い。ルール例2:11-28 は禁止されている「最終更新・変更履歴」の書き方の例そのもの | 削除 | 無 |
| archive/x-marketing-strategy.md | 死んでいる | :3「最終更新: 2025-12-12」 | 削除 | 無 |
| archive/SUPABASE_MIGRATION_SPEC.md | 死んでいる | db-migration/006 からだけ参照 | db-migration の整理と一緒に決める | 低 |
| archive/content-multi-channel-pipeline-prompt.md・-spec.md | archive 済み（参照あり） | content-ops.md:27 などが参照 | そのまま | 中 |
| archive/content-multi-channel-pipeline-plan.md・-screens.md・-tasks.md | 死んでいる | 参照0 | spec と一緒に残すか削除 | 無 |
| knowledge/（19件すべて） | 生きている | agent・rules・CLAUDE.md・AGENTS.md・discussion-panel が参照。知見の正本 | そのまま。README.md 末尾の「旧ファイルとの対応（2026-10-12 まで）」は期限を決めて削る | 最高 |
| adr/ の大半（0001-0009, 0011, 0014-0017, 0019-0029, 0031-0079, 0084, 0086-0089） | 生きている | 番号の重複は 0044-0052 への改名で解消済み。verify-adr-references.js が見張っている | そのまま | 高 |
| adr/0010・0018・0030・0062・0080 | 生きている | 置き換え・却下・一部改訂が明記されている | そのまま | 低 |
| adr/0012 | 古くなる見込み | 0095:4 が「画面に出す値」を置き換えるのに、0012 側に記載が無い | 0095 を採用したら追記 | 低 |
| adr/0013 | 状態が古い | 「提案中」のまま。本文には判定を2か所で実装済みとある | 採用か却下かを決める | 低 |
| adr/0081 | 状態が古い | 「提案中」。BOA-635 の T1・T2 はマージ済み（#1591） | 「採用」にする | 低 |
| adr/0082 | 置き換え済みなのに未更新 | :4「提案中」。0085:3 に「置き換えるもの: ADR-0082」 | 「置き換え済み（0085）」にする | 低 |
| adr/0083 | 一部置き換え済みなのに未更新 | 「採用」のまま。0085 が寄与度の部分を置き換えた | 一部置き換えを追記 | 低 |
| adr/0090〜0094 | 状態が古い | 5本とも「提案中」。153 は適用済み、x-oauth・x-send-stop・push-bundle はある | 「採用」にする | 中 |
| adr/0095 | 生きている | 「提案中」。155〜157 の適用状況は要確認 | design-reviewer の後に採用 | 低 |

### 1-9. docs/design（81エントリ）

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| _template/ | 生きている | content-ops.md が参照 | そのまま | 中 |
| ai-crawler-snapshot/ | 実装済み | 未完1（「PR作成」だけ）。generate-ai-snapshots.js がある | チェックを付ける | 低 |
| ai-model-redesign/ | 実装済み | 完了20。plan に旧パス（RaceDetail.jsx など） | そのまま | 中（030 が slug で参照） |
| analogy-finder/ | 生きている・履歴 | 366ファイル・18.6MB（mock 10.1MB）。旧 mock-v10〜v14、verification-round1〜11 が残っている。spec の冒頭に旧版の経緯 | 旧モックと verification を archive に移し、PNG を縮める | 高（workflow 2本が plan を参照、Python が analysis/t1 に書き出す、118・132・133） |
| analogy-reaction-measurement/ | 生きている | measurement-planner が ga4-custom-dimensions.md を参照 | そのまま | 中 |
| analysis-visualization-upgrade/ | 実装済み・履歴 | 完了45。plan §3.0 にスコープ差し替えの経緯 | 経緯を消す | 低 |
| avg-st-definition/ | 実装済み | APPROVED.md と画像 1.0MB | そのまま | 中（basicInfoStats.js・racerStStats.js・official-data-spec が参照） |
| blog-i18n/ | 実装済み | 完了35 | そのまま | 中 |
| boa-301-motor-venue-waku-stats/ | 重複 | 未完17・完了0 のままだが、getVenueMotorRanking・getMotorWakuStats は実装済み | motor-strength-compare に統合 | 低 |
| boa-885-meet-exhibition-trend/ | 実装済み | mock 2.5MB | そのまま（PNG は縮めてよい） | 中（MeetFormTrendCard.jsx が参照） |
| boatcast-original-exhibition/ | 実装済み | spec と plan だけ | そのまま | **高（verify-boatcast-job.js が spec と plan を読む。CI が落ちる）** |
| content-ops-flow/ | 実装済み（チェック未更新） | 未完11・完了0 だが、brand-kit・check スクリプトはある | チェックを付ける | 中 |
| course-entry-tendency-rework/ | 古い（止まっている） | Phase1 で止まった（精度は上がらないという結論）。067 の venues.course_entry_baseline 列はどこからも使われていない | 続けるかを決め、やめるなら archive | 中（067 の列が宙に浮く） |
| expected-value-feature.md | 死んでいる | valueService は作られず、TodaysPicks.jsx は削除済み | archive | **中（race_start_timings・racer_aggregated_stats の DDL の唯一の出典。1-10 参照）** |
| first-mark-animation-design.md | 死んでいる | FirstMarkAnimation.jsx は 08-14 に削除済み | archive | 中（同上） |
| in-collapse-caution/ | 生きている | 未完18・完了29 | そのまま | 中 |
| in-kuzure-specialization-strategy.md | 古い・重複 | 05-03 のビジョン。in-collapse-caution と同じテーマ | archive | 低 |
| kb-longterm-backfill/ | 実装済み | 074 は適用済み | そのまま | 中 |
| language-switcher-guide/ / race-detail-odds-list/ / venue-grade-matrix/ | 実装済み | content-index.json だけ | そのまま | 中（content-index の検査が数える） |
| meet-page/ | 生きている | 未完7（MeetRankingPreviewCard がまだ無い） | そのまま | 低 |
| morning-data-digest/ | 生きている・履歴 | 未完5。経緯の記述7 | 経緯を handoff に寄せる | 中 |
| motor-strength-compare/ | 実装済み | 未完4 はレビューなどの工程 | boa-301 の統合先 | 低 |
| mycroft-transformer.md | 実装済み | | そのまま | **既に壊れている参照**: scripts/ml/mycroft_model.py が `mycroft-transformer-design.md` という無い名前を指す |
| onboarding-guide-revamp/ | 古い（止まっている） | 未完6。termHints.js は削除済み | 書き直すか archive | 低 |
| outcome-distribution-integration-design.md | 死んでいる | BettingValueSection は削除済み | archive | 低 |
| outcome-distribution-validation-script.md / -validity-analysis.md | 実装済み・重複 | | 1本にまとめる | 低 |
| past-rate-check/ | 生きている | 未完5 | そのまま | 中 |
| pit-comments/ | 生きている（チェック一部未更新） | backfill-pit-reports.js は実装済みなのにチェックが無い | チェックを付ける | 中 |
| poirot-ml-models.md / pre-race-full-fields/ / race-ai-copy/ / race-cancellation-detection/ / race-deadline-status/ / race-detail-analysis-integration/ / race-detail-ui-unify/ / race-open-animation/ / race-result-full-fields/ / race-result-start-formation/ / racer-accident-rate/ / racer-fortune-telling/ / racer-links/ / racer-news-auto-collect/ / racer-search-and-list/ / racer-stats-drilldown/ / sns-hub-admin-ux-improvements/ / sns-hub-campaign-pipeline/ / sns-marketing-hub/ / sns-topic-gate/ / venue-guide-expansion/ / venue-list-redesign/ / weather-in-escape/ | 実装済み | 対応するコードがあり、タスクも完了している | そのまま | 低〜中（マイグレーションやコードのコメントが slug を参照するものがある） |
| quality-gate-ci/ | 実装済み（小さな食い違い） | verify-registry.js と書いているが、実際は .json | 1行直す | 中（quality-gates.yml が参照） |
| race-detail-pc-width/ | 実装済み | 画像23枚・5.6MB | 画像を減らすか archive | 中（CSS 2本がディレクトリを参照） |
| race-page-redesign/ | 古い・重複 | AiAnalysisSection・RaceReview は削除済み。後継は ui-unify と analysis-integration | archive | 低 |
| racer-news-feature/ | 実装済み（一部食い違い） | plan にある AdminRacerNews.jsx などは作られていない | 書き直す | 低 |
| racer-period-stats/ | 生きている（チェック未更新） | 083・084 は適用済みなのにチェックが無い | チェックを付ける | 低 |
| ryujin-radar-rebrand/ | 実装済み | source-assets の原画が 3.3MB | 原画を別の置き場へ | 低 |
| scraping-full-coverage/ | 古い・履歴 | 未完14。consolidation の WS3 で統合する対象 | consolidation に統合 | 中（scrape-racer-season-stats.yml が参照） |
| scraping-serverless-migration/ | 古い・重複 | spec だけ。WS3 で統合する対象 | 統合 | 中（exhibition-gap-monitor.yml が参照） |
| scraping-vercel-consolidation/ | 生きている・履歴 | 未完143（Phase7 の旧基盤の廃止がまだ）。spec.md が無い。992KB、日付が738か所 | 経緯と runbook を分ける | **高（verify-boatcast-job.js が tasks.md T4b-19 の `- [ ]` の行数を検査している。チェックを付けるだけで CI が落ちる）** |
| sns-hub-admin-refactoring/ | 古い | sns-hub/ に分けたが、SnsHubAdmin.jsx は 3,094行に戻っている（plan の見込みは430行） | 書き直す（リファクタリングの節 2-2 へ） | 低 |
| sns-hub-bundle-checks/・deadline-queue/・draft-diff/・edit-assist/・existing-fixes/・metrics/・mobile-approval/・month-calendar/・shorts-send/・x-send/（契約10本） | 実装済み・重複 | 依頼ごとの契約。対応するマイグレーションは適用済み | sns-marketing-hub に索引を置いてまとめる | 低（playwright の設定と sns-pdca-loop がリンク） |
| sns-hub-phase2-pdca-loop/ | 実装済み・履歴 | 完了10。経緯の記述5 | 経緯を削る | 中（コマンド3本と content-ops.md が参照） |
| sns-pdca-loop/ | 生きている | 未完24 | そのまま | 高（CLAUDE.md・x-channel・youtube-channel が spec を参照） |
| thinking-assist/ | 実装済み（食い違い） | master に spec・plan・tasks が無い。completion-audit.md が参照する tasks.md は feature ブランチにしか無い。PNG 10.1MB | spec などを master に入れ、PNG を減らす | 中 |
| turn-prediction-improvement-roadmap.md | 古い | 05-24 の目標のまま | archive | 低（コードから2件参照） |
| turn-prediction-v2-design.md | 死んでいる | v3 に置き換え済み | archive | 低（add-defense-distribution.sql の出典） |
| turn-prediction-v3-design.md | 古い | アニメーションの部分は削除済み | 書き直す | 低 |
| unified-model-legacy-pages/ | 実装済み（チェック未更新） | 未完12 だが実装済み | チェックを付ける | 低 |

### 1-10. docs/db-migration

`supabase/migrations` は無い。管理はここ1か所なので、二重管理は起きていない。

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| README.md | 古い | 2025-12-24 から更新なし。書かれた scripts/db/migrate.js などは無い。APPLIED.md・db-apply に触れていない | APPLIED.md・docs/operation/db-apply.md・番号の規則への案内に書き直す | 低 |
| CLAUDE_CODE_PROMPT / CLAUDE_CODE_QUICK_START / DB_MIGRATION_PLAN / DB_PLATFORM_COMPARISON / MIGRATION_STRATEGY / REVIEW_SUMMARY / TECH_STACK_COMPATIBILITY / JSONB_EXPLANATION / SCHEMA_EXTENSIBILITY（.md 9本） | 死んでいる | JSON から Supabase への移行計画で、移行は済んでいる | archive | 低（scripts/db/SCHEMA_DETAIL.md のリンクが切れる） |
| 002〜006 の番号つき .md | 古い | 設計資料 | archive | 低（verify-migration-numbers は .md を見ない） |
| 001〜071 の適用済み SQL（約80本） | 実装済み | 大半が適用済み | 動かさない | **高（約40本の verify・lib が個々の SQL を直接読む。verify-plan-erd.js は SQL 内の `docs/design/{slug}` で設計と結び付ける）** |
| 番号の重複（15番号） | 重複（凍結済み） | verify-migration-numbers.js の ALLOWED_DUPLICATES に登録済み | 名前を変えない | 高 |
| 007_RPC_FUNCTIONS などの大文字名・add-defense-distribution.sql | 古い（命名違反） | db-apply の正規表現に合わない。適用済み | そのまま | 中 |
| 048_add_cancellation_status_to_predictions_rpc.sql | 古い | 台帳は「未適用」。068・102 で解決済みなのに、APPLIED.md の注記は「直すなら新しいマイグレーションを」のまま | APPLIED.md の注記を直す | 低 |
| 117・121・122・125・156・159（未適用） | 生きている | | そのまま | 中 |
| 欠番の記載 | 食い違い | APPLIED.md は「欠番は024のみ」と書くが、実際は 072・073・087・088 など18個ある | APPLIED.md を直す | 低 |
| *-runbook.md（132・134〜137・153・158・160・161） | 実装済み | | そのまま | 高（153・158 は verify が読む） |
| APPLIED.md | 生きている | ファイルと台帳は一致している | 上の2か所の注記だけ直す | 最高 |
| 台帳に CREATE 文が無い表 | 食い違い | race_start_timings・racer_aggregated_stats の DDL が db-migration に無い。DDL 案は design の expected-value-feature.md と first-mark-animation-design.md にしか無い | 今の DDL をマイグレーションに起こしてから、design の2本を archive にする | 中 |

### 1-11. .claude/ と AGENTS.md

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| AGENTS.md | 生きている（一部重複） | 220行。「競」の字の規則が :76,:158-159,:206 と code-style・sns-content-generation に重複。RPC の照合（:92）と verify-registry（:83,:85,:181）が CLAUDE.md:159-160 と重複。:87-91 は Claude 向けの playwright の決まり | 3節（規則の書き換え案）を参照 | 中（Codex は AGENTS.md だけを読むので、削りすぎると判断できなくなる） |
| .claude/CLAUDE.md | 古い・履歴 | 36,174 バイト。AGENTS.md:3 が書く 32KiB の読み込み上限を超えていて、末尾が読まれていないおそれがある。:161 Codex は見送り（古い）、:14 tiktok-growth-report、経緯つきの日付が23か所 | 3節を参照 | 高 |
| .claude/settings.json | 生きている | フック8本を登録している。allow に、出どころ不明の `mcp__34bf5277…__list_issues`、`Skill(collect-stats/analyze-venue/daily-report/deploy-preview)`、claude-in-chrome がある | 不明な MCP の allow が要るかをオーナーに確認する | 低 |
| agents/（18本） | 生きている | CLAUDE.md の表と18件が一致している。data-scientist.md:29 の見出しに日付 | そのまま（見出しの日付は削る） | 低 |
| agents/content-qa.md | 生きている・重複 | 6観点が content-ops.md:168-177 と publish-blog にもある | ここを正本にする | 低 |
| agents/second-opinion-reviewer.md | 生きている（見直し候補） | 同じモデルで検証している。Codex を独立した検証役にする道がある | hq の「別ベンダーによる審査」の設計に合わせて見直す | 低 |
| skills/discussion-panel/SKILL.md | 生きている・履歴 | :6,:15 に旧8人パネルの経緯、:23 に hq の依頼の経緯 | 経緯を削る | 低 |
| skills/orchestrate/SKILL.md | 生きている・履歴・欠落 | 241行、日付18か所。:41 は期限（10-09）を過ぎた保留。`codex/*` の PR を誰が審査し、どの段階でマージするかが無い（AGENTS.md:114 は「hq が決める」と預けている） | 経緯を削り、Codex の PR の節を足す | 中（マージ権限の規則） |
| skills/orchestrate/scripts/patrol.sh・templates/merge-confirmation.md | 生きている | | そのまま | 低 |
| skills/orchestrate/templates/lane-request.md | 生きている | :49 に日付 | 日付を削る | 低 |
| commands/analyze-venue.md・collect-stats.md・daily-report.md | 生きている（古め） | 2026-01-16 から更新なし。settings で allow 済み | そのまま | 低 |
| commands/analyze-vup-features.md・calibration-report.md・refine-creative.md・step1-screens.md・step1-spec.md・step2.md・step3.md・i18n-growth-report.md | 生きている | | そのまま（i18n-growth-report の日付は削る） | 低 |
| commands/analyze-vup-feature.md・create-vup-ticket.md | 重複 | 分析の手順が重なる | 1本にまとめ、起票はフラグで分ける | 低 |
| commands/brushup.md | 死んでいる | 参照0。例が `BOAT-123`（チームは BOA） | 削除するか、例を直す | 低 |
| commands/channel-algorithm-research.md | 古い | :2,:3,:6,:35,:43 が TikTok を対象にしている | TikTok を外す | 低 |
| commands/check-env.md | 古い（危険） | :36 が鍵の先頭20文字を表示する。frontmatter が無い | 「設定済みか」だけを出すように直すか削除 | 中（鍵が会話記録に残る） |
| commands/codex-review.md | 死んでいる | 最終 07-24。今は GitHub の `@codex review`（AGENTS.md:189） | 削除し、step4.md:24・growth-pdca.md:85 の言及も消す | 低 |
| commands/create-pr.md | 古い | :28 が `feature/` 固定、:46 に経緯、:77 が `/review-pr` を案内（今は `/code-review`） | 書き直す | 低 |
| commands/deploy-preview.md | 生きている（価値は低い） | `codex/*` には Preview が無い（#1623） | Codex の PR は対象外と1行足す | 低 |
| commands/growth-monthly-summary.md | 古い | TikTok と tweet-drafts が前提。最後の出力は 2026-08 | 書き直す | 低 |
| commands/growth-pdca.md | 古い・履歴 | 176行・日付19か所。:85 Codex は見送り、:103 tweet-drafts、:168,:174 TikTok | 書き直す | 低 |
| commands/growth-report.md | 古い | :30-32 が tweet-drafts を数えさせる | 書き直す | 低 |
| commands/implement.md | 古い | `BOAT-123`・`feature/`。:70 の「レビュー待ち」は BOA に無い状態名で、CLAUDE.md が警告している誤更新を招く。spec-ambiguity-detector を呼ぶ手順が無い | 書き直す | 中（Linear の状態を誤って変える） |
| commands/implement-batch.md | 死んでいる | 参照0。存在しない状態名「進行中」。orchestrate のレーン制が代わりを果たしている | 削除 | 低 |
| commands/merge-pr.md | 重複 | 手順が orchestrate §6 と重なる。:12 に経緯 | どちらかを正本にする | 中（マージの手順が2か所にある） |
| commands/note-growth-report.md | 古い・履歴 | :5,:69,:78 TikTok、:7 新設の経緯 | 書き直す | 低 |
| commands/onboarding.md | 古い | :61,:82 で `npm run dev` を案内しており、CLAUDE.md の禁止に反する | 削除か書き直す | 低 |
| commands/publish-blog.md | 古い・重複 | 4つのレビュー（content-qa・wording-editor・ファン・seo-marketer）、つまり段階0 F の条件に触れていない | 4つのレビューを呼ぶ手順に書き直す | 中（公開の条件がずれる） |
| commands/review-pr.md | 重複 | `/code-review` と AGENTS.md のレビュー規則と重なる | 削除 | 低 |
| commands/step4.md | 古い | :24 に `/codex-review` | 1行直す | 低 |
| commands/tiktok-growth-report.md | 死んでいる | アカウントはバン済み。最後の出力は 09-05 | 削除（参照している5ファイルも直す） | 低 |
| commands/x-growth-report.md | 古い | 249行。:166 tweet-drafts、:9,:203 TikTok、:52,:141 マスコットの A/B/C テスト | 書き直す | 低 |
| commands/x-reply-drafts.md | 古い・履歴 | 227行のうち日付つきが60行（約26%）。:28,:138,:180 が Chrome 拡張 MCP を前提にしている | 使っているかをオーナーに確認する。使うなら経緯を削り、使わないなら削除 | 中（投稿・フォローの操作手順を含む） |
| rules/analysis.md | 生きている（paths 不一致） | paths の `data/venue-params/**` が無い。:115 の会場数・ルール数は手書き | paths を直し、数を消す | 低 |
| rules/code-style.md | 生きている・重複 | 「競」の字の例外2が sns-content-generation:47・AGENTS.md:159 と三重 | ここを正本にする | 低 |
| rules/component-reuse.md・data-acquisition.md・documentation.md・i18n-new-pages.md・mobile-ui.md | 生きている | data-acquisition の日付は判断の出典なので要る | そのまま（component-reuse:46 の経緯は1行に） | 低 |
| rules/content-ops.md | 古い・履歴 | 180行・日付23か所。paths の `tiktok-posts`、:114-121 フローC-3（TikTok）、:108 マスコット期間の3本/日、:98,:147,:162 tweet-drafts、:111,:120「自動化しない」が CLAUDE.md の自動送信の例外と合わない | 大きく削る | 中 |
| rules/frontend-data-fetch.md | 生きている・履歴 | :10-28 の「なぜこのルールがあるか」が経緯 | 2〜3行にまとめる | 低 |
| rules/review-fix-cycle.md | 生きている | paths が無く常に読み込まれる。P0〜P3 が AGENTS.md:124-128 と重複 | paths を付けるか検討する | 低 |
| rules/sdd-workflow.md | 履歴 | 54行・日付10か所。見出しに日付 | 日付と経緯を削る | 低 |
| rules/session-start-checks.md | 古い・履歴 | :13 BAN の注記、:21 tweetDrafts の残置、:32-35 分離の経緯 | 書き直す | 低 |
| rules/sns-content-generation.md | 古い・重複 | :16,:18 TikTok、:47 は code-style の例外2と重複 | 書き直す | 低 |
| hooks/（8本） | 生きている | settings.json に登録されている | そのまま | 低 |
| hooks/pre-push-verify-cache.sh | 死んでいる | settings.json にも `.git/hooks` にも無い。CI の verify-cache が代わりを果たしている | 削除し、docs/setup/cache-verification-setup.md を直す | 低 |
| plans/nifty-honking-hamster.md・replicated-sniffing-music.md | 死んでいる | 2026-03-10、追跡されている。一回限りの計画。参照0 | 削除 | 低 |
| templates/analysis-docs.md | 生きている | :3「CLAUDE.md から参照される」は誤り（実際は rules/analysis.md） | 1行直す | 低 |
| session-state/*.json（16件） | 生きている（実行時のデータ） | .gitignore で追跡外。消す処理が無く、増え続ける | 古いものを消す処理を足す | 低 |

### 1-12. scripts/（894本）

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| scripts/lib（205本） | 生きている | 202本はコードから参照される | そのまま。下の3本だけ削除候補 | 低 |
| scripts/lib/contentChannels/{captureScreenshot,coverImageStrategy,renderCampaignCard}.js | 死んでいる | どこからも import されない（docs にだけ出てくる） | 削除 | 低 |
| scripts/lib/contentChannels/channelMatrix.js:57,61,65,86 | 古い | 今も tiktok を配信先に含めている | tiktok を外し、verify-routine-routing.js:17・api/_lib/snsHubHelpers.js:233 も合わせて直す | 中（TikTok 向けの下書きを作る経路が残っている） |
| scripts/daily（42本） | 生きている | 41本は workflow・api・他のスクリプトから呼ばれる | そのまま | 低 |
| scripts/daily/update-outcome-frequencies.js | 古い | race_outcome_frequencies を作るはずだが、どの workflow・cron からも呼ばれない | 要るかを確かめ、要るなら cron に載せ、要らないなら削除 | 中（表が更新されないまま） |
| scripts/daily/todays-volatility-digest.js | 古い | verify のコメントにだけ出てくる | 削除候補 | 低 |
| scripts/daily/post-x-animation.js | 死んでいる | 対応する workflow の cron がコメントアウトされている（1-13） | workflow と一緒に削除 | 無 |
| scripts/maintenance（346本） | ほぼ生きている | verify-* 228本は verify-registry.json の228件と過不足なく一致している（ci 216・manual 12） | そのまま | 低 |
| scripts/maintenance の一回限りの backfill/fix/check-*（どこにも出ない15本、docs にだけ出る21本） | 死んでいる | 例: check-jan10.js、check-results-dates.js、fix-tsu-2025-12-02-date.js、rebrand-boatai.js、backfill-all-hits.js、backfill-is-hit-win.js、backfill-hit-flags-range.js、fix-missing-hits.js、fix-missing-payouts.js、restore-entries-branch-hometown.js、supervise-download.sh、update-prediction-payouts.js、update-today-labels.js、check-missing-results.js、migrate-to-supabase.js、test-workflow-dispatch.js | scripts/archive に移すか削除 | 低（手で再実行するために残している可能性） |
| scripts/maintenance/check-{morning-init,odds,pre-race,prediction-odds,result}-shadow.js | 古い | Vercel への移行のときの差分比較用 | 移行が終わっていれば archive | 低 |
| scripts/analysis（218本） | 古いものが多い | どこにも出ない58本、docs にだけ出る49本。版違いが多い（analyze-turn-prediction-accuracy* 5本、campaign-backtest v2〜v5、design-profitable-model と v2、correct-turn-pattern-integration と corrected-turn-outcome-integration、analyze-venue-03* 8本、analogy-finder-fr2-strat/*.py など） | どこにも出ない58本を削除か archive。train-* の3本は workflow が呼ぶので残す | 低 |
| scripts/ml（57本） | 生きている | tests/ の14本は pytest がディレクトリごと拾う | そのまま | 無 |
| scripts/verification/verify-meet-series-split.mjs・verify-semifinal-slots.mjs | 死んでいる | どこにも出ない。registry の対象外 | 削除するか registry に載せる | 低 |
| scripts/verification/verify-series-points-official.mjs | 古い | docs にだけ出てくる | 同上 | 低 |
| scripts/tests/sns-x-send.test.js | 死んでいる（CI に未接続） | `node --test` を呼ぶ所が無い | verify-* に移して registry に載せる | 中（X の送信の状態遷移のテストを誰も実行していない） |
| scripts/analyze-all-models.js・test-animation-record.js | 死んでいる | どこにも出ない | 削除 | 低 |
| scripts/send-email-notification.js | 死んでいる | 2025-12-11 から更新なし。起動する workflow が無い | sendgrid-setup.md と一緒に削除 | 低 |
| scripts/update-google-sheets.js | 死んでいる | 対応する workflow が自動では動かない | workflow と一緒に削除 | 低 |
| scripts/codex-review.sh | 死んでいる候補 | commands/codex-review.md からだけ使われる | コマンドと一緒に削除 | 低 |
| scripts/sns・scripts/db | 生きている | package.json・db-apply.yml が呼ぶ | そのまま | 無 |
| scripts/maintenance/session-start-check.js の tweetDrafts | 古い | 旧フローの下書きを数え続けている | 項目を外す | 低 |

**コメントアウトされたコード**: scripts/・workflows/・api/・src/ に、コードの形で5行以上続くものは無かった。代わりに、日付つきの経緯のコメントが多いファイルがある。

- scripts: verify-admin-rule-performance.js（8）、raceResultRows.js（8）、verify-pre-race-parsers.js（7）、scrape-exhibition-data.js（7）、verify-frontend-pure-functions.js（6）、scrape-odds.js（6）
- workflow: campaign-pipeline.yml、aggregate-stats.yml、aggregate-racer-course-technique-stats.yml、post-merge-checks.yml の冒頭

### 1-13. .github/workflows/（46本）

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| deploy.yml.disabled | 死んでいる | GitHub Pages へのデプロイ。2025-12-12 から更新なし。今は Vercel | 削除 | 無 |
| post-x-animation.yml | 死んでいる | cron がコメントアウトされている（対象の UI は 2026-08-14 に撤去済みで、毎日失敗していた） | スクリプトと一緒に削除 | 無 |
| update-google-sheets.yml | 死んでいる | workflow_run の対象「Scrape Race Data」という workflow が無いので、自動では動かない | スクリプトと一緒に削除 | 無 |
| aggregate-racer-course-technique-stats.yml | 古い・履歴 | 手動でしか起動しない（定時の実行は Vercel に移った）。冒頭のコメントが「JST 01:10」のまま | コメントを直す。障害時の手動復旧用に残す | 低 |
| nightly-verify-db.yml | 生きている（コメントが古い） | :6「tier=manual 5本」だが、実際は12本 | コメントを直す | 低 |
| train-analogy.yml | 生きている（コメントが古い） | コメントの api/cron/analogy-dispatch.js が無い（正しくは -train.js） | コメントを直す | 低 |
| quality-gates.yml | 生きている | コメントに検証用の1行が残っている | その1行を削る | 無 |
| campaign-pipeline.yml | 生きている・履歴 | cron のコメントに 2026-09-09 のレビューの経緯が長く書いてある | コメントを短くする | 低 |
| collect-racer-news.yml・scrape-point-rank.yml・scrape-racer-season-stats.yml・scrape-venue-entry-course-stats.yml・scrape-venue-motor-stats.yml | 重複（意図した予備） | Vercel cron と同じ時刻に起動し、gha-skip-gate で片方を飛ばす | Vercel 側が安定していれば、予備の定時実行を外す | 中 |
| scrape-scheduled.yml | 古い（予備） | 10分おき＋cron-job.org から5分おき。本体は Vercel cron が毎分動かしている | 予備の範囲を縮める | 中（二重に取得するおそれ） |
| update-{exhibition-time-top,losing-technique,nige-outcome-distribution,outcome-distribution,top-start,winning-technique}-stats.yml・aggregate-course-baseline-stats.yml | 重複した形 | 29〜34行で中身がほぼ同じ | matrix で1本にまとめる | 低 |
| post-merge-checks.yml | 一部重複 | quality-gates も master への push で走る。ただし Slack への通知は別の役割 | そのまま（統合の案はある） | 低 |
| e2e-rerecord.yml | 生きている | 428行で最大 | 分ける候補 | 低 |
| aggregate-stats.yml | 生きている | cron-job.org から毎日 23:00 に手動起動 | そのまま | 中（外部サービスに頼っている） |
| analogy-v16-morning.yml・bot-html-parity.yml・calculate-accuracy.yml・content-ops-nightly-check.yml・db-apply.yml・e2e-live.yml・e2e-smoke-test.yml・exhibition-gap-monitor.yml・generate-moriarty.yml・generate-morning-digest.yml・generate-poirot.yml・in-caution-nightly.yml・race-notices-drift-monitor.yml・regenerate-generated-docs.yml・scrape-monitor-liveness.yml・slack-notify-pr.yml・train-moriarty.yml・train-poirot.yml・train-sherlock.yml・update-moriarty.yml・update-sitemap.yml・verify-cache-config.yml | 生きている | 呼び先はすべてある。`if: false` は0件 | そのまま | 無〜低 |

### 1-14. api/

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| api/cron/scrape-pseudo.js | 死んでいる | cron に登録されておらず、呼ぶ所も無い。冒頭に「検証が終わったら、このファイルと registry.js の pseudo を削除してよい」とある | registry.js の pseudo と一緒に削除 | 低 |
| api/admin/sns-hub/drafts/[id]/queue-send.js | 死んでいる候補 | src・scripts・e2e から呼ばれない。docs/design/sns-hub-deadline-queue/contract.md にだけ出てくる | 用途を確かめて削除 | 低 |
| api/admin/sns-hub/maintenance/sync-youtube-titles.js | 古い | 2026-09-08 の不具合への一時的なツール（冒頭に明記）。呼ぶ所が無い | 削除 | 低 |
| api/_lib/snsHubHelpers.js:233 | 古い | `tiktok: "SNS_TIKTOK_ROUTINE"` | channelMatrix と一緒に外す | 中 |
| api/admin/sns-hub/{token-health,send-probe,x-oauth/start,x-oauth/callback}.js | 生きている | 手で開くか、外から呼ばれる。verify が検査している | そのまま | 無 |
| api/cron/* のほか・その他の api | 生きている | vercel.json の crons、src、middleware から呼ばれる | そのまま | 無 |

### 1-15. src/

| パス | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| src/components/DifyChat.jsx＋.css | 死んでいる | import 0件（親で確認済み）。proposal/ai-chat-analysis-feature.md:72 に「未接続」 | 削除（VITE_DIFY_CHAT_URL も不要になる） | 低 |
| src/components/RulePerformance.jsx | 死んでいる | import 0件（親で確認済み。当たったのは別名の fetchRulePerformance だけ）。076 の SQL のコメントにも「未使用」とある。後継は services/adminRulePerformance.js | 削除 | 低 |
| src/components/RuleTrendChart.jsx＋.css | 死んでいる | 自分の CSS からしか参照されない | 削除 | 低 |
| src/components/ShareButton.jsx＋.css | 死んでいる | import 0件（親で確認済み）。後継は SocialShareButtons.jsx | 削除し、design/ryujin-radar-rebrand/screens.md:80 も直す | 低 |
| src/components/holmes/HolmesPlaceholder.jsx | 死んでいる | 参照0（親で確認済み） | 削除 | 低 |
| src/components/race/analogy/ContributionView.jsx と、それだけが使う ContributionRadar.jsx・ContributionBreakdown.jsx・BoatCompareTable.jsx | 死んでいる | import 0件（親で確認済み）。analogy-finder/plan.md:321「旧 FR-1 の部品は v16 の公開後に消す」、ANALOGY_FINDER_PUBLIC = true | 削除（useAnalogyContribution は DataSources・AiOutlook が使うので残す） | 低 |
| src/utils/share.js の shareRacePredictionToX・shareHitRaceToX・shareDailyStatsToX（L33-275） | 使われていない export | 定義のほかに参照が無い | 削除 | 低 |
| src/services/supabaseDataService.js の getRacePlaceOdds・getSeriesResultsByRacer | 使われていない | 呼び出し0件 | 削除 | 低 |
| dateUtils.js:115 isYesterday・:124 formatDateJP、colors.js:22 MODEL_COLORS・:95 HIT_COLORS、constants/index.js:53 MODEL_KEY_MAP・MODEL_KEY_REVERSE_MAP、ruleMatchService.js:87 hasRulesForVenue・:94 getRulesForVenue、blogPosts.js:97 getPostsByCategory、formatters.js:137 formatRecoveryRate、digestMetrics.js の wilsonLowerPercent・NATIONAL_BASE_RATES、pretestRows.js:53 pickFirstPretestByRacer、analogyContribution.js:31 roundFromStageCategory | 使われていない | 定義だけ | 削除 | 低 |
| 同じファイルの中だけで使う定数の export（約70件） | 生きている | export が余分なだけ | そのまま | 無 |
| コメントアウトの塊 | 該当なし | `//` が5行以上続く所は145あるが、すべて説明文 | そのまま | 無 |

### 1-16. git のブランチ・worktree

| 対象 | 分類 | 根拠 | 推奨 | リスク |
|---|---|---|---|---|
| ローカルのブランチ 1,538本・リモートのブランチ 1,177本 | 大半は死んでいる | squash マージのため `--merged` では拾えない（拾えたのはローカル421本・リモート171本） | PR がマージ済み・閉じたブランチを gh で突き合わせ、まとめて消す | 中（作業中のブランチを消すおそれ。消す前に一覧を見る） |
| worktree 37本 | 一部は死んでいる | セッション開始時のフックが閾値12を超えたと警告。`recursing-poincare-93292f` の data/ml は gitに入らない取り直しの効かないデータ | `npm run check:worktrees` で確かめ、data/ml を退避してから消す | 高（data/ml は復元できない） |

---

## 2. 整理の範囲と順番の案

### 2-1. 順番

安全なもの（消しても何も壊れないもの）から始め、規則は最後にする。各段は独立した PR にする。

```
段1 メインの作業ツリーの一時ファイル（1-1）  ← 持ち主に確認してから
段2 参照0の docs・ルートのファイル（1-2〜1-8 の「削除」「archive」で、リスクが無・低のもの）
段3 死んだコード（src 1-15、api 1-14、workflow の3本、scripts の死んでいる候補）
段4 参照ありの docs の移動・書き直し（issues/ の archive、TikTok 一式、design の統合）
段5 状態の更新（ADR の状態、tasks.md のチェック、APPLIED.md の注記）
段6 規則（AGENTS.md・CLAUDE.md・SKILL・rules・commands）  ← hq と共有し、オーナーが承認してから
段7 git のブランチ・worktree の掃除
```

| 段 | 範囲 | PR の数の目安 | 誰が決めるか | 先に確かめること |
|---|---|---|---|---|
| 1 | 1-1 | PR なし（手で消す） | 持ち主のセッション、またはオーナー | `4・5・6号艇…md`・`AI動画生成…md`・growth-pdca の json が作業中か |
| 2 | docs/archive の死んだ文書（約30本）、ルートの check-*.mjs・*.py・tmp.py・console_result・screenshot・tmp、docs/operation の session-progress・ticket-update-plan・linear-ticket-creation-guide、docs/issues/.gitkeep | 1〜2本 | 段階0（docs だけ） | 参照の grep をもう一度 |
| 3 | src の死んだ部品10本と、使われない export、api の3本、workflow の3本（deploy.yml.disabled・post-x-animation・update-google-sheets）と対応するスクリプト、scripts の「どこにも出ない」77本 | 3本（src・api と workflow・scripts） | 段階0（画面が変わらない） | build・verify:ci・E2E が緑 |
| 4 | TikTok 一式（docs 5本＋コマンド・channelMatrix・snsHubHelpers）、issues の解決済み（スクリプトのコメントも直す）、proposal の採用済み、design の統合（boa-301→motor-strength-compare、scraping の3本→consolidation、sns-hub の契約10本→sns-marketing-hub の索引） | 3〜4本 | TikTok のコード経路を外すのは段階1。docs は段階0 | verify-boatcast-job.js が読むファイルを動かさない |
| 5 | ADR 0013・0081・0082・0083・0090〜0094 の状態、design の tasks.md のチェック、APPLIED.md の欠番・048 の注記 | 1本 | 段階0 | **scraping-vercel-consolidation/tasks.md の T4b-19 には触らない**（verify-boatcast-job.js が検査している） |
| 6 | 3節の案 | 2〜3本 | **オーナーが直接承認する**（.claude の変更） | hq の「社員の基盤」の設計と突き合わせる |
| 7 | ブランチ・worktree | PR なし | オーナー | data/ml の退避 |

### 2-2. 開発側のリファクタリングの候補

棚卸しとは別に、大きすぎるファイルと重複したロジック。どれも挙動を変えない整理で、着手するかは別途決める。

**大きすぎるファイル（本番のコード）**

| 行数 | ファイル | 問題 | 案 |
|---|---|---|---|
| 8,768 | src/services/supabaseDataService.js | 1つのオブジェクトに約90メソッド（レース24・選手13・会場11・モーター7など）。キャッシュの処理と集計の関数（L8604-）も同居している | ドメインごとのファイルに分ける。最大の候補 |
| 3,094 | src/pages/admin/SnsHubAdmin.jsx | 内部のコンポーネント37個、useState 52個。タブがすべて同居し、`Header` は src/components/Header.jsx と同じ名前。sns-hub-admin-refactoring の見込み（430行）から戻ってしまった | タブ単位で sns-hub/ に切り出す |
| 1,976 / 1,957 / 1,897 | src/data/venueGuides{En,Ko,ZhTw}.js | 言語ごとに同じ構造のデータを持っている | 共通のスキーマにするか locales へ移す |
| 523 / 521 / 444 | src/pages/{Ko,English,ZhTw}Guide.jsx | 言語ごとに同じページをコピーしている | i18n にして1本にまとめる |
| 1,916 | scripts/daily/generate-predictions.js | | 分ける |
| 1,669 | src/components/race/RaceMeetTab.jsx | 関数2つにロジックが集中 | 分ける |
| 1,655 | scripts/daily/scrape-results.js | | 分ける |
| 1,549 | src/components/analysis/MotorConditionChart.jsx | useState 19個。取得・絞り込み・描画が混ざっている | hook に分ける |
| 1,412 / 1,111 / 855 | src/components/race/Race{BasicInfo,BeforeInfo,WakuInfo}Tab.jsx | データの取得と表示が混ざっている | hook に分ける |
| 1,361 | src/components/race/RaceOddsListTab.jsx | comboLabel・formatJstTime が他と重複 | 共通の util を使う |
| 1,111 / 990 / 913 | src/components/race/{seriesPoints.js,basicInfoStats.js,raceIndicators.jsx} | 純粋なロジックが components/ にある | utils へ移す |
| 1,100 | src/components/racer/RacerPerformanceStats.jsx | 中で supabase を直接呼んでいる（frontend-data-fetch.md の方針と合わない可能性） | サービス層を通す |
| 1,005 / 929 / 905 / 719 | ThinkingAssistPage.jsx・LensSummary.jsx・assistModel.js・assistSummary.js | pct・st2・p0・comma が assist の中で重複 | まとめる |
| 863 / 812 | PredictionPanel.jsx・analogy/ScenarioTab.jsx | 1つの関数だけでできている | 分ける |
| 1,244 / 1,069 / 956 / 849 | generate-morning-digest.js・scrape-odds.js・scrapeJobs/monitor.js・scrapeJobs/registry.js | | 分ける |

**大きすぎる検査スクリプト**

| 行数 | ファイル | 問題 |
|---|---|---|
| 2,701 | verify-frontend-pure-functions.js | 1本になんでも入っている。分ける候補 |
| 2,669〜2,135 | verify-scrape-{pre-race,daily,result,monitor}-job.js、verify-data-health-job.js、verify-boatcast-job.js、verify-scrape-jobs.js | 同じ形の準備のコードを繰り返している。共通部分を切り出せる |

**重複したロジック**

| 内容 | 場所 | 案 |
|---|---|---|
| `jstToday` | services の6ファイル（sherlock・watson・mycroft・moriarty・poirot・supabaseData） | utils/dateUtils.js の getTodayJST に寄せる |
| slashDate（4）・isNum（4）・toNumber（3）・formatSt（3）・formatJstTime（3）・comboLabel（3）・pct/round1/num/techniqueLabel（aiCopyText と share）・isFinalStage（2） | src 全体 | formatters・dateUtils に集める |
| `RaceCardDataTable` | analysis/（312行）と race/（123行）で、同じ名前なのに中身が別 | 名前を変える |
| RankRow・RaceCard | holmes の Holmes*.jsx 4本にコピー | モデル別の部品を1つにまとめる |
| `parseArgs`（53ファイル）・自前の fetchAll*（35）・chunk（26）・createClient（25）・sleep（13） | scripts | 共通の lib を使う。特に fetchAll は BOA-753 で並び順を必須にした共通版を使っていない可能性がある |
| update-*-stats 系6本と対応する workflow | scripts/daily、.github/workflows | 1本の集計の枠組みと matrix の workflow にまとめる |
| GitHub Actions と Vercel cron の二重起動 | point-rank・entry-course-stats・venue-motor-stats・racer-news・racer-profiles の5組 | 予備を外すか、片方に寄せる |

---

## 3. 規則の書き換えの案（hq と共有するための案、実行しない）

`.claude/` の変更はオーナーの直接の承認が要る。hq が設計中の「社員の基盤」（別ベンダーによる審査など）と食い違わないよう、先に hq と突き合わせてから PR にする。

### 3-1. 方針

1. **正本を1か所にする**: 同じ規則が複数の場所にあるものは、正本を決め、他は参照にする。ただし AGENTS.md は Codex が単体で読むため、Codex に要る規則は AGENTS.md の中に1か所だけ残す。
2. **経緯を本文から外す**: 「2026-xx-xx に〜した」「〜で指摘された」は git 履歴か ADR に任せ、規則の文だけを残す。規則の理由が要るときは1行にまとめる。
3. **廃止した仕組みの記述を消す**: TikTok、tweet-drafts、旧8人パネル、Codex は見送り、マスコットのテスト、Chrome 拡張 MCP が前提の手順。
4. **CLAUDE.md を 32KiB 未満にする**: 今は 36,174 バイトで、末尾が読まれていないおそれがある。

### 3-2. ファイルごとの案

| ファイル | 削る・直すもの | 移す先 |
|---|---|---|
| .claude/CLAUDE.md | :161 の「/codex-review は 2026-07 時点で見送り」を「Codex は GitHub の `@codex review` でレビューし、`codex/` から PR も出す。規約は AGENTS.md」に直す。:14 の `/tiktok-growth-report` を消す。:17・:104・:149 の廃止の注記、:89・:102・:112・:114 などの実例と日付を消す。:159-160（RPC の照合・verify-registry）は AGENTS.md「検証・テスト」へのリンクにする | :60-65（Agent Teams を使わない理由）は docs/operation へ、:111-132（スコープの管理）は rules へ移す |
| AGENTS.md | :87-91 の Claude 向けの playwright の決まり（run-heavy.sh など）は、Claude と Codex に共通の事実だけを残す。:88-89 の「BOA-769 D、2026-10-12〜」などの経緯を消す。「競」の字の規則は :158-159 を正本にし、:76・:206 は節へのリンクにする | — |
| skills/orchestrate/SKILL.md | :9-11・:63・:143・:173・:180 の経緯と実例を消す。見出しの承認日（:61・:78・:85・:86・:90・:116）は台帳へ移す。:41 の期限切れの保留（10-09）は結論を書くか消す。**「Codex の PR（`codex/*`）」の節を足す**: 誰が審査するか、段階0〜2のどれに当たるか、Preview が無い（#1623）ので画面をどう確かめるか | hq の「別ベンダーによる審査」の設計に合わせる |
| skills/discussion-panel/SKILL.md | :6 の日付、:15 の旧8人パネル、:23 の hq の依頼の経緯 | — |
| rules/content-ops.md | フローC-3（:114-121、TikTok）を丸ごと消す。paths の `tiktok-posts`、:67・:70・:131・:133 の TikTok、:98・:147・:162 の tweet-drafts を消す。:19-21・:27・:103 の移行の経緯を消す。:108 のマスコット期間の本数は x-operations-playbook へのリンクにする。:111・:120 の「自動化しない」は CLAUDE.md の自動送信の例外を正本にして1行の参照にする。:168-177 の6観点は「content-qa・wording-editor・ファン・seo-marketer の4つを通す」の1行にする | 6観点の正本は agents/content-qa.md |
| rules/session-start-checks.md | :13 の BAN の注記、:21 tweetDrafts の行、:32-35 の分離の経緯 | session-start-check.js からも tweetDrafts を外す |
| rules/sns-content-generation.md | :16・:18 の TikTok。:47 は「code-style.md の例外2に従う」の1行にする | — |
| rules/sdd-workflow.md | 見出しの「（2026-xx-xx〜）」をすべて消す。:12 の検討の経緯を消す | — |
| rules/frontend-data-fetch.md | :10-28 の「なぜ」を2〜3行にまとめる | — |
| rules/analysis.md | paths の `data/venue-params/**` を消す。:115-118 の会場数・ルール数を消す | 数の正本は ruleMatchService / venueRules.js |
| rules/review-fix-cycle.md | paths を付けて常時読み込みから外すか検討する | — |
| content-ops.md・sns-content-generation.md の paths | `src/pages/admin/sns-hub/**` を足すか検討する（今は sns-hub の部品を触っても読み込まれない） | — |
| commands/codex-review.md・tiktok-growth-report.md・implement-batch.md・review-pr.md | 削除する | 参照している step4.md:24、growth-pdca.md:85、create-pr.md:77 と、tiktok-growth-report を参照する5ファイルも直す |
| commands/merge-pr.md | orchestrate §6 とどちらを正本にするか決め、もう一方は参照にする。:12 の経緯を消す | — |
| commands/implement.md | 例を BOA-123 に、ブランチを worktree と今の命名に直す。:70 の「レビュー待ち」を実在する状態名に直す。最初の手順に spec-ambiguity-detector を足す | — |
| commands/publish-blog.md | 「content-qa → wording-editor → ファン → seo-marketer。全部で P0・P1 が0なら段階0 F」の手順にする | — |
| commands/check-env.md | :36 の `value.substring(0,20)` をやめ、「設定済みか」だけを出す | — |
| commands/onboarding.md | :61-65・:82 の `npm run dev` の案内を消すか、ファイルごと削除する | — |
| commands/create-pr.md | :28 のブランチ名を今の運用に合わせ、:46 の経緯を消し、:77 を `/code-review` に直す | — |
| commands/growth-*.md・x-growth-report.md・note-growth-report.md・channel-algorithm-research.md | TikTok・tweet-drafts・マスコットの A/B/C テストの前提と経緯の段落を消す | — |
| commands/x-reply-drafts.md | 使っているかをオーナーに確認する。使うなら日付つきの経緯の約60行を削り、Chrome 拡張 MCP が前提の手順（:28・:138・:180）を今の手段に合わせる。使わないなら削除 | — |
| commands/analyze-vup-feature.md・create-vup-ticket.md | 1本にまとめる | — |
| agents/second-opinion-reviewer.md | Codex を独立した検証役にするかを決め、決めたら CLAUDE.md の「セカンドオピニオン検証」の手順も合わせる | hq の「別ベンダーによる審査」の設計 |
| hooks/pre-push-verify-cache.sh | 削除し、docs/setup/cache-verification-setup.md:12,114 を直す | — |
| plans/ の2件 | 削除する | — |
| templates/analysis-docs.md | :3 を「rules/analysis.md から参照される」に直す | — |
| settings.json | 出どころ不明の `mcp__34bf5277…__list_issues` の allow が要るかを確かめる（オーナーが判断する） | — |

### 3-3. hq と突き合わせたい点

1. **Codex の PR の審査とマージの段階**: AGENTS.md:114 は hq に預けている。orchestrate SKILL に何を書くかは、hq の「別ベンダーによる審査」の設計次第。
2. **second-opinion-reviewer を残すか**: 同じモデルの検証役を、Codex による審査に置き換えるのか、両方を使うのか。
3. **AGENTS.md と CLAUDE.md の切り分け**: 両方の社員（Claude と Codex）に共通する規則を AGENTS.md に寄せ、CLAUDE.md は Claude に固有のもの（サブエージェント・フック・デスクトップアプリ）だけにする案。hq 側に共通の基盤を置くなら、どちらを正本にするか。
4. **経緯の置き場**: 規則の本文から外した経緯を、git 履歴だけに任せるか、ADR や hq の決定の台帳に寄せるか。

---

## 4. 消すと壊れるもの（整理の PR を作るときに必ず確かめる）

| 対象 | 壊れるもの |
|---|---|
| docs/design/scraping-vercel-consolidation/tasks.md・verification-runbook.md、docs/design/boatcast-original-exhibition/spec.md・plan.md | verify-boatcast-job.js（verify:ci）。T4b-19 の `- [ ]` の行数を検査しているので、チェックを付けるだけでも落ちる |
| docs/design の slug の名前 | verify-plan-erd.js・erDiagramFromDdl.js（SQL 内の `docs/design/{slug}` で結び付けている） |
| docs/design/*/content-index.json | verify-content-index-coverage.js・check-missing-content-index.js |
| docs/db-migration の SQL・APPLIED.md・runbook | verify-migration-numbers.js、dbApplySql.js（db-apply.yml）、個々の SQL を読む約40本の verify |
| docs/reference/deprecated-terms.json・database-design.md・display-coverage.md・shared-logic-index.md、docs/operation/db-apply.md | それぞれを読み書きする generate / check / verify のスクリプト |
| docs/knowledge/ のすべて | agent・rules・CLAUDE.md・AGENTS.md・discussion-panel |
| docs/operation/sdd-and-codex-review.md・sns-video-producer-prompt.md・x-operations-playbook.md・sns-marketing-strategy.md | rules・コマンド・agent からのリンク |
| docs/operation/sns-pipeline-*.md の名前 | campaign-pipeline.yml・request-spec-change.js が `sns-pipeline-` の前方一致で探す |
| docs/setup/claude-routines/index.json | content-ops.md・AGENTS.md |
| docs/issues/ の解決済みの文書 | scripts/ のコメントのリンク（1-7 の「中」の行） |
| docs/design/expected-value-feature.md・first-mark-animation-design.md | race_start_timings・racer_aggregated_stats の DDL の唯一の出典（先に DDL をマイグレーションに起こす） |
| TikTok の docs 一式 | tiktok-growth-report・channel-algorithm-research のリンク。コマンドと同時に直す |

**すでに壊れている参照**（整理のときに一緒に直す）

- scripts/ml/mycroft_model.py → `docs/design/mycroft-transformer-design.md`（実際の名前は mycroft-transformer.md）
- docs/design/thinking-assist/completion-audit.md → tasks.md（master に無い）
- docs/proposal/tiktok-non-gambling-content-ideas.md:3,:73 → `docs/design/content-multi-channel-pipeline/`（archive に移動済み）
- workflows/train-analogy.yml のコメント → api/cron/analogy-dispatch.js（無い）
