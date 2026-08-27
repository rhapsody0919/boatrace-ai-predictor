# racer-news-auto-collect タスク分解（tasks.md）

対応: [spec.md](./spec.md) / [plan.md](./plan.md)

- [x] **タスク1: 共通基盤（dedup / pendingReview / templates）**
  - `scripts/lib/racerNews/dedup.js`: `racer_news.source_url`存在チェック＋`pending.json`内の同一`sourceUrl`チェックを行う`isAlreadyProcessed(sourceUrl)`
  - `scripts/lib/racerNews/pendingReview.js`: `data/analysis/racer-news-pending-review/pending.json`の読み書き（`addPendingItem()`/`listPending()`/`updateStatus()`）。ファイルが存在しない場合は`{ items: [] }`で初期化
  - `scripts/lib/racerNews/templates.js`: FR2の定型文生成関数（plan.md 5節のテンプレート例を実装。当初はFR1向け関数も実装したが後述の通り削除）
  - 受入基準: 3ファイルとも単体でNode REPL/一時スクリプトから呼び出し、期待通りの入出力になることを確認する

- [x] **タスク2: FR1 グレードレース優勝の自動生成（`gradeRaceWins.js`）— 実装・検証後に見送り、コード削除済み**
  - 実装当初の内容: `races`（`race_grade IN ('SG','G1','G2','G3')`）×`race_results.rank1`×`race_entries.racer_id`から当日の1着選手を検出し`racer_news`へ自動投入
  - 実データ検証（2026-08-26）で1日17件生成された。中身を精査すると決勝戦の優勝と予選ヒートの1着を区別できておらず、「ニュース」として価値が薄いとユーザーとの議論の結果判断（詳細はspec.md「却下した要件」参照）
  - `scripts/lib/racerNews/gradeRaceWins.js`と`templates.js`の`generateGradeRaceWinNews`は削除済み。決勝戦判定には会場・グレード・日付でのグルーピングという追加スコープが必要になり、そのコストに見合う価値が無いと判断した

- [x] **タスク3: FR2 公式ニュースアーカイブの節目記録取り込み（`officialGradeAnnouncements.js`）**
  - **実装着手時の実HTML調査で判明**: 当初想定した「級別発表（勝率ランキング）」記事は「ニュース」カテゴリ（`is-pickup`）に属し「レーサーデータ」カテゴリ（`is-racer`）ではなかった。実際のレーサーデータカテゴリは`登録第{racer_id}号 {氏名}選手（{支部}支部）{達成内容}達成`という見出しで、登録番号が直接含まれる。spec.md/plan.md/ADR-0024を訂正済み（詳細は各ドキュメント参照）
  - `boatrace.jp/owpc/pc/site/news/racer/{年}/{月}/`（当月＋前月）の一覧から見出し・日付・記事URLを抽出（cheerio、記事本文の個別取得は不要）
  - 見出しから登録番号・支部・達成内容を正規表現抽出。登録番号が無い見出しは対象外としてスキップ。登録番号はあるが支部/達成内容の抽出に失敗した場合は`pendingReview`へ「見出しフォーマット解析失敗」として記録（将来の見出し変化をサイレントに見逃さないため）
  - 登録番号で`racer_profiles`を直接検索し支部が一致することを確認。一致すれば`templates.js`で生成し`racer_news`へINSERT。不一致・未存在は`pendingReview`へ
  - 受入基準: 実際に存在する記事（2026年7〜8月、菊地孝平/守田俊介/寺田祥/田中信一郎の4件）を対象に実行し、正しく抽出・照合・生成ができることを確認する（確認済み、4件とも正しい選手名・達成内容で生成、再実行で重複しないことも確認）

- [x] **タスク4: FR5 会場選手コメントの取り込み — 実装着手前の調査で見送り**
  - 着手時に開催中の複数会場（常滑・徳山・びわこ・福岡等）を実際に調査した結果、「全選手コメント」ページは唐津・芦屋の2会場でしか確認できず、他会場は「レース展望」という第三者編集記事（1記事内で10人以上の選手に言及）が中心だった
  - 唐津・芦屋も当時オフシーズンで、実際にコメントが入った状態を検証できていなかった
  - 当初の「選手自身の発言だから低リスクで自動化できる」という前提が崩れているため、ユーザーとの議論の結果FR5は見送ることにした（詳細はspec.md「却下した要件」参照）。実装（`venueComments/`）には着手していない

- [x] **タスク5: オーケストレーター（`scripts/daily/collect-racer-news.js`）**
  - FR2（`officialGradeAnnouncements.js`）のみを呼び出す
  - 実行サマリー（各ソースの生成件数・pending件数・エラー件数）を標準出力にログする
  - 受入基準: `officialGradeAnnouncements.js`が例外を投げても（モジュール内部でtry/catchしているため通常は起きないが）オーケストレーター自体が異常終了しないことを確認する

- [x] **タスク6: GitHub Actionsワークフロー（`.github/workflows/collect-racer-news.yml`）**
  - plan.md 3節のワークフロー定義を作成（`schedule: cron '10 14 * * *'` + `workflow_dispatch`、`continue-on-error`、pending.json変更時のcommit&push）
  - 受入基準: `workflow_dispatch`でのローカル相当実行（`node scripts/daily/collect-racer-news.js`を手元で実行）が成功する。YAML構文が既存ワークフローと一貫していることを目視確認する

- [x] **タスク7: セッション開始時提示ルールの追記（`.claude/CLAUDE.md`）**
  - plan.md 4節の文言を「セッション開始時のXツイート下書き投稿確認」等と同じ構成で追記する
  - 受入基準: 追記内容が既存の類似セクション（TikTok/X）とフォーマット・トーンが一致していること

- [x] **タスク8: 統合検証・PR作成**
  - `npm run build`: 成功
  - `npx playwright test e2e/smoke.spec.js -g "選手個別ページ"`: 3件とも成功（表示コンポーネント側は変更していないため退行なし）。初回実行時は別ワークツリーの5173番ポートdevサーバーをPlaywrightが誤って再利用し3件とも失敗したが、自分のワークツリー用に一時的にポートを分離して再実行し全件成功を確認（設定変更はコミットせず元に戻した）
  - PR作成、完了報告
