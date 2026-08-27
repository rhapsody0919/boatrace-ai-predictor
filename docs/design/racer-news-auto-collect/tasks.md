# racer-news-auto-collect タスク分解（tasks.md）

対応: [spec.md](./spec.md) / [plan.md](./plan.md)

- [x] **タスク1: 共通基盤（dedup / pendingReview / templates）**
  - `scripts/lib/racerNews/dedup.js`: `racer_news.source_url`存在チェック＋`pending.json`内の同一`sourceUrl`チェックを行う`isAlreadyProcessed(sourceUrl)`
  - `scripts/lib/racerNews/pendingReview.js`: `data/analysis/racer-news-pending-review/pending.json`の読み書き（`addPendingItem()`/`listPending()`/`updateStatus()`）。ファイルが存在しない場合は`{ items: [] }`で初期化
  - `scripts/lib/racerNews/templates.js`: FR1/FR2の定型文生成関数（plan.md 5節のテンプレート例を実装）
  - 受入基準: 3ファイルとも単体でNode REPL/一時スクリプトから呼び出し、期待通りの入出力になることを確認する

- [x] **タスク2: FR1 グレードレース優勝の自動生成（`gradeRaceWins.js`）**
  - `races`（`race_grade IN ('SG','G1','G2','G3')`）×`race_results.rank1`×`race_entries.racer_id`から当日の1着選手を検出
  - `racer_profiles`に該当`racer_id`が無い場合は`pendingReview`へ記録
  - `dedup.js`で重複チェック後、`templates.js`で生成し`racer_news`へINSERT
  - 受入基準: 過去の実際のSG/G1レース（本日分ではなく既存データ）を対象に`--dry-run`相当のオプションで実行し、正しい選手・正しい文言が生成されることを確認する。同じレースを2回実行しても重複INSERTされないことを確認する

- [x] **タスク3: FR2 公式ニュースアーカイブの節目記録取り込み（`officialGradeAnnouncements.js`）**
  - **実装着手時の実HTML調査で判明**: 当初想定した「級別発表（勝率ランキング）」記事は「ニュース」カテゴリ（`is-pickup`）に属し「レーサーデータ」カテゴリ（`is-racer`）ではなかった。実際のレーサーデータカテゴリは`登録第{racer_id}号 {氏名}選手（{支部}支部）{達成内容}達成`という見出しで、登録番号が直接含まれる。spec.md/plan.md/ADR-0024を訂正済み（詳細は各ドキュメント参照）
  - `boatrace.jp/owpc/pc/site/news/racer/{年}/{月}/`（当月＋前月）の一覧から見出し・日付・記事URLを抽出（cheerio、記事本文の個別取得は不要）
  - 見出しから登録番号・支部・達成内容を正規表現抽出。登録番号が無い見出しは対象外としてスキップ。登録番号はあるが支部/達成内容の抽出に失敗した場合は`pendingReview`へ「見出しフォーマット解析失敗」として記録（将来の見出し変化をサイレントに見逃さないため）
  - 登録番号で`racer_profiles`を直接検索し支部が一致することを確認。一致すれば`templates.js`で生成し`racer_news`へINSERT。不一致・未存在は`pendingReview`へ
  - 受入基準: 実際に存在する記事（2026年7〜8月、菊地孝平/守田俊介/寺田祥/田中信一郎の4件）を対象に実行し、正しく抽出・照合・生成ができることを確認する（確認済み、4件とも正しい選手名・達成内容で生成、再実行で重複しないことも確認）

- [ ] **タスク4: FR5 会場選手コメントの取り込み（1会場のみ、原文引用）**
  - 実装着手時点で開催中（または直近開催予定）の会場を1つ選定し、「全選手コメント」ページのHTML構造を調査する
  - `scripts/lib/racerNews/venueComments/{venueCode}.js`（選定会場の専用パーサー）と`index.js`（共通マッチングロジック：`races`×`race_entries`から今節の出走選手名一覧を取得し抽出結果と突合）を実装
  - 一意一致時は原文ママで`racer_news`へINSERT、0件/複数件一致時は`pendingReview`へ
  - 開催期間外（プレースホルダーのみ）の場合は何もせず正常終了することを確認する
  - 受入基準: 選定会場が開催中のタイミングで実行し、実際のコメントが正しい選手に紐づいて取得できることを確認する。開催期間外URLでも例外を吐かずスキップされることを確認する

- [ ] **タスク5: オーケストレーター（`scripts/daily/collect-racer-news.js`）**
  - タスク2〜4の3モジュールをFR1→FR2→FR5の順に呼び出す。各モジュールは独立してtry/catchし、1つの失敗が他を止めないようにする
  - 実行サマリー（各ソースの生成件数・pending件数・エラー件数）を標準出力にログする
  - 受入基準: 3モジュールのうち1つを意図的にエラーさせても残り2つが実行されることを確認する

- [ ] **タスク6: GitHub Actionsワークフロー（`.github/workflows/collect-racer-news.yml`）**
  - plan.md 3節のワークフロー定義を作成（`schedule: cron '10 14 * * *'` + `workflow_dispatch`、`continue-on-error`、pending.json変更時のcommit&push）
  - 受入基準: `workflow_dispatch`でのローカル相当実行（`node scripts/daily/collect-racer-news.js`を手元で実行）が成功する。YAML構文が既存ワークフローと一貫していることを目視確認する

- [ ] **タスク7: セッション開始時提示ルールの追記（`.claude/CLAUDE.md`）**
  - plan.md 4節の文言を「セッション開始時のXツイート下書き投稿確認」等と同じ構成で追記する
  - 受入基準: 追記内容が既存の類似セクション（TikTok/X）とフォーマット・トーンが一致していること

- [ ] **タスク8: 統合検証・PR作成**
  - `npm run build`実行、既存`racer_news`関連の想定挙動に影響がないか確認（表示コンポーネント側は変更していないため`npm run test:e2e`は必須ではないが、`/racer/:racerId`の既存テストが壊れていないことは確認する）
  - 生成された`racer_news`エントリを実際に`/racer/:racerId`ページで表示確認（Playwright）
  - PR作成、レビュー指摘の反映、完了報告
