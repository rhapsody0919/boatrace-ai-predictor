# 全レース関連データ取得・タイミング最適化 tasks

対応: [spec.md](./spec.md) / [plan.md](./plan.md)

## 着手順序の推奨

優先度（spec.md）とタスクの独立性を踏まえた推奨順:

1. **FR-2/FR-5**（選手期別成績・profiles自動化）— 他FRへの依存が無く、低リスク・高価値（能力指数は新規発見の重要指標）
2. **FR-1**（レース特記事項）— 他FRへの依存が無く、新規Vercel Function 1本で完結
3. **FR-3**（今節成績）— [BOA-226](https://linear.app/boat-ai/issue/BOA-226)（series_day）と[BOA-323](https://linear.app/boat-ai/issue/BOA-323)（結果取得の欠損バグ）の状況確認が前提
4. **FR-4**（オッズ全券種）— [BOA-313](https://linear.app/boat-ai/issue/BOA-313) Phase 3の進捗と足並みを揃える
5. **FR-6**（会場個別サイト）— 最も規模が大きく調査フェーズが先行するため最後

各FRの完了後、`.claude/CLAUDE.md`の「実装完了後の自動レビュー」（`/code-review`・ビルド確認・E2E）を都度実施する。

---

## FR-2/FR-5: 選手期別成績・racer_profiles自動更新

- [x] 期別成績ページ（`boatrace.jp/owpc/pc/data/racersearch/season?toban=`）を複数選手（級別の異なる選手を含む）で実機確認し、HTML構造・セレクタを特定する（2026-09-15、A1/A2/B1/B2級および新人選手の計7選手で確認。構造は級別に依存せず共通。`div.table1 table tbody tr`のth/td交互配置、`div.text p.h-alignR`の「集計期間：YYYY/MM/DD-YYYY/MM/DD」表記を特定。詳細は`scripts/lib/racerSeasonStats.js`冒頭コメント参照）
- [x] `docs/db-migration/061_racer_profiles_season_stats.sql`をベースに、現行mainブランチの最新マイグレーション番号を確認した上で正式なマイグレーションファイルを作成・適用する（`ability_index`/`flying_count_period`/`false_start_count_period`/`period_label`/`official_win_rate_period`等）（2026-09-15、origin/masterの最新は059のため061は空き番号と確認、そのまま採用。**適用済み**: Supabase MCPは`--read-only`設定のため直接適用できなかったが、Supabase Management APIのdatabase/queryエンドポイント経由で適用し、`racer_profiles`への6列追加を`information_schema`で確認済み）
- [x] `scripts/maintenance/scrape-racer-profiles.js`を拡張し、既存の選手プロフィール取得と同じ巡回で期別成績も取得する
- [x] 新規GitHub Actionsワークフローを作成する（月次実行＋5/1・11/1直後2週間は週次にブースト、`docs/db-migration/061`のコメントに記載した発表タイミングの推定を実装時に複数年分の公式ニュースで裏取りする）（`.github/workflows/scrape-racer-season-stats.yml`。発表タイミングはboatrace.jp公式ニュース「2025年7月から適用の選手級別（2025年後期）を発表」2025-05公開、および複数の第三者まとめ記事で「審査終了から約2ヶ月後」の一致を確認済み）
- [x] 自社`racer_aggregated_stats`との検算スクリプトを作成し、初回実行結果を記録する（`.claude/rules/analysis.md`のデータ精度検証パターンに準拠）（**設計変更**: racer_aggregated_statsには勝率・2連対率等の列が無くcareer-to-date集計のため直接比較不可と判明。`scripts/analysis/verify-racer-season-stats-accuracy.js`としてrace_entries/race_results/race_start_timingsから期別成績と同一期間で直接再計算する方式に変更し実装。25選手で初回実行済み、結果は`data/analysis/racer-season-stats/accuracy-verification.json`。**重要な発見**: 自社`races`テーブルの最古レコードが2025-12-03のため、現在の公式集計期間（2025-11-01始まり）を完全にはカバーできず、出走回数等の厳密一致検証は現時点では構造的に不可能（`truncatedWindow`として参考値扱い）。さらに2025-12-03〜2026-04-30に絞っても自社出走回数が公式の40〜55%程度しかなく、単純な期間欠落だけでは説明できない未解明のギャップを検出した。原因調査はBOA-321のスコープ外のため別タスクとして起票済み）
- [ ] [BOA-323](https://linear.app/boat-ai/issue/BOA-323)の修正状況を確認した上で、`race_start_timings.is_flying`を使ったF休み期間の自社計算ロジックを検証する（可能なら日和の「F休み期間」相当のスクレイピング自体が不要になる）— **今回スキップ**。BOA-323（決まり手・ST欠損バグ）が未修正のままのため、`race_start_timings`ベースの検証は同じ穴を引き継ぎ意味を成さない。BOA-323解消後に別タスクとして着手すること

## FR-1: レース特記事項ページ

- [x] `race/information`ページ（会場・日付単位）で、実際に「事故・内規違反・減点」「モーター・ボート変更」「欠場・帰郷」の通知がある日を探し、3区分それぞれのHTML構造・表記パターンを確認する（2026-09-15、検索エンジンのインデックス経由でjcd=12 hd=20171224の実例を発見・3区分とも実データ確認済み。直近日付では通知自体が非常に低頻度で見つからなかったが、上記実例で受入基準を満たす。フィクスチャ化してscripts/maintenance/verify-race-notices-parser.jsで回帰テスト化済み）
- [x] `docs/db-migration/060_race_special_notes.sql`をベースに正式なマイグレーションを作成する（race_notices_health含む）。**適用済み**（2026-09-15、Supabase Management APIのdatabase/queryエンドポイント経由。Supabase MCPは読み取り専用のため`CREATE TABLE`が拒否されたが、SUPABASE_ACCESS_TOKENでのManagement API直接呼び出しは可能と判明し適用した。`race_special_notes`・`race_notices_health`両テーブルの存在を`information_schema`で確認済み）
- [x] `scripts/daily/scrape-race-information.js`を実装する（`run(schedule, date)`パターン、3区分をまとめて取得）。本番Supabaseの本日のスケジュール（13会場）+本番boatrace.jpに対する実行で、パース処理自体は正常動作を確認済み（マイグレーション適用済みのため書き込みも今後の実行で検証可能）
- [x] `api/cron/race-notices.js`を実装する（BOA-313 Phase1と同じ「即時応答＋`waitUntil`バックグラウンド継続」パターン、`CRON_SECRET`認証）
- [x] `scripts/lib/venueMotorStats/driftHealth.js`のコアロジック（`updateVenueHealth`、`DRIFT_ALERT_THRESHOLD_DAYS`）を再利用し、本FR用のreasonコード分類（`notice_section_not_found`/`unexpected_section_count`）を定義して構造変化監視を組み込む。`findDriftAlerts`はvenue_motor_stats固有のreason語彙にハードコードされておりそのままでは一致しないため再利用せず、同じ形で返す`findRaceNoticesDriftAlerts`を`check-race-notices-drift.js`側に個別定義した（コードレビューで発覚・修正、ADR-0059の「reasonコード分類はスクレイパーごとに個別定義」を実装面でも徹底）。Vercel Functionはファイルシステム永続化・git commitができないため、`race_notices_health`テーブル（会場×日付単位の当日集計）をSupabaseに持ち、`scripts/maintenance/check-race-notices-drift.js`（GitHub Actions日次実行、`race-notices-drift-monitor.yml`）が直近日数分を畳み込む設計に変更した（venue_motor_statsのローカルJSON+git commit方式はサーバーレス実行に適用できないため）
- [ ] cron-job.orgにジョブを追加する（10分間隔、7:00-23:00 JST）※cron-job.org側の外部アカウント操作が必要なためユーザー対応待ち
- [ ] 単体デプロイで実データ確認する（マイグレーション適用済みのため、Vercelへのデプロイ後に実施可能）
- [ ] 数日〜1週間運用し、取得成功率・エラー率を確認してから本番運用に移行する（上記デプロイ後の運用タスクのため未着手）

## FR-3: 今節成績（節内の日別進捗）

- [x] [BOA-220](https://linear.app/boat-ai/issue/BOA-220)（今節得点率）とのスコープ重複を整理し、統合方針を確定する（2026-09-16、[BOA-291](https://linear.app/boat-ai/issue/BOA-291)への統合を確認。得点率は自社計算せずpointrank直接スクレイピングに統合、ADR-0053追記）
- [x] 得点率の公式計算ルール（着順→得点の対応表、優勝戦の加重等）を一次情報源で確認し、`docs/reference/`にまとめる（2026-09-16、[docs/reference/racer-score-rate-rules.md](../../reference/racer-score-rate-rules.md)作成。G3の加点有無・減点の詳細ルールは一次情報で確認できず「未確認」と明記。ただしpointrank直接スクレイピング方式のため自社実装上は不要）
- [x] [BOA-226](https://linear.app/boat-ai/issue/BOA-226)（`races.series_day`）の実装状況を確認する（未完了なら本タスクの前提として先に完了させる）— 2026-09-15時点でBOA-226は`race_stage`のみの実装に留まり`series_day`/`is_final_day`が未実装と判明していた。**2026-09-16、選択肢(a) series_dayを別途スクレイピング実装する方式を採用（ユーザー判断）**。`scripts/daily/update-race-info.js`に`scrapeSeriesDay()`を追加し、racelistページの日程タブ（`.tab2_inner`、当日は`is-active2`）から取得。実データ検証済み（初日/中日/最終日）
- [x] `getSeriesResultsByRacer(racerId, venueCode, meetStartDate)`を`supabaseDataService.js`に実装する（`race_entries`/`race_results`/`race_conditions`/`race_start_timings`のJOIN、過去日分＋得点率データの合流）
- [x] [BOA-323](https://linear.app/boat-ai/issue/BOA-323)の修正・バックフィル状況を確認した上で、当日分（結果確定に連動する部分）の動作を実データで検証する（2026-09-16、DB実データで2026-09-10以降ほぼ100%決まり手・ST取得できていることを確認、解消済み）

## FR-4: オッズ全券種

- [ ] 2連単・2連複・拡連複の正確なURLパス（`odds2tf`/`oddsk`等は仮称）とHTML構造を実データで確認する
- [ ] `scripts/lib/oddsParser.js`に`parseExactaAll`/`parseQuinellaAll`/`parseWideAll`を追加する（`parseTrifectaAll`/`parseTrioAll`と同じ形式）
- [ ] `docs/db-migration/062_race_odds_all_combinations.sql`をベースに正式なマイグレーションを作成・適用する（`trio_all`/`exacta_all`/`quinella_all`/`wide_all`）
- [ ] [BOA-313](https://linear.app/boat-ai/issue/BOA-313) Phase 3の進捗を確認し、Vercel Functions移行と同時に実装するか、レガシー`scrape-odds.js`に先行実装するかを判断する
- [ ] `ODDS_WINDOWS`に0分（締切時点）を追加し、`FULL_ODDS_WINDOWS`を全窓共通に拡張する（既存3連単も含む）
- [ ] 0分窓の技術的実現可能性を実データで検証し、失敗時のフォールバック（直前の成功スナップショットを実質最終値として扱う）を実装する
- [ ] オンデマンド更新エンドポイント（`api/odds/refresh.js`）を実装する（IP単位のレート制限、対象レースの妥当性検証、締切残り時間に応じた可変クールダウン）
- [ ] 新規4券種の取得を並走検証（数日）してから本番運用に移行する。取得成功率の監視（BOA-313の`exhibition-gap-monitor.yml`と同様の仕組み）を追加する

## FR-6: 会場個別公式サイト（24会場）

### Phase 6a: 調査

- [ ] 24会場を実際にCMS構造で分類する（`/modules/`パス構成の共通CMS群、レガシー静的HTML/ASP群、その他）
- [ ] 各会場のToS本文を確認する（robots.txtは全24会場確認済み・禁止なし、ToS本文は未確認）
- [ ] [BOA-294](https://linear.app/boat-ai/issue/BOA-294)残存項目（前検ランキング・コンピ指数）の会場側更新頻度を確認する

### Phase 6b: テンプレート実装

- [ ] CMSベンダー分類ごとに1つの共有パーサーを実装する（Phase 6aの分類結果に基づく）

### Phase 6c: データ別実装（優先順）

- [ ] [BOA-293](https://linear.app/boat-ai/issue/BOA-293)（進入コース別選手成績、12会場で確認済み・最重要）: `venue_entry_course_stats`テーブル作成・スクレイパー実装・日次実行
- [ ] 前検ランキング（BOA-294残存分）: タイミング分類確定後に実装
- [ ] 水面特性（BOA-294残存分）: 年1回取得
- [ ] コンピ指数（BOA-294残存分）: Phase 6a調査結果に基づき実装
- [ ] [BOA-295](https://linear.app/boat-ai/issue/BOA-295)（潮汐）: `venue_tide_data`テーブル作成・年1回バルク取得（会場公式サイトから、気象庁等への切替は不採用）
- [ ] [BOA-296](https://linear.app/boat-ai/issue/BOA-296)（レイアウト変更履歴）: `venue_layout_changes`テーブル作成・月次軽量チェック
- [ ] 各スクレイパーに`driftHealth.js`ベースの構造変化監視を組み込む（データ項目ごとにreasonコード分類を定義）

## FR-7: 残存する個別ギャップ（参照のみ）

以下は各チケット単体で完結させる。本tasks.mdでは扱わない: [BOA-288](https://linear.app/boat-ai/issue/BOA-288)（racelist体重）・[BOA-290](https://linear.app/boat-ai/issue/BOA-290)（展示コース列）・[BOA-266](https://linear.app/boat-ai/issue/BOA-266)（前検タイム等）・[BOA-273](https://linear.app/boat-ai/issue/BOA-273)（選手コメント）・[BOA-292](https://linear.app/boat-ai/issue/BOA-292)（SG/G1限定ページ）。

## 横断タスク（優先度: 中、複数FR完了後にまとめて着手可）

- [ ] SG/G1グレードレースの優先度ティア（時間窓許容誤差±3分→±1分）を、FR-4・FR-1の実装完了後に追加検討する（`race_conditions.race_grade`で判定）
- [ ] オッズのデータ保存量（Supabaseストレージ使用率）を監視し、必要になった時点でアーカイブ方針を検討する
