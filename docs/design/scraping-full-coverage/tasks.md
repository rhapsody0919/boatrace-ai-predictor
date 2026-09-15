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

- [ ] 期別成績ページ（`boatrace.jp/owpc/pc/data/racersearch/season?toban=`）を複数選手（級別の異なる選手を含む）で実機確認し、HTML構造・セレクタを特定する
- [ ] `docs/db-migration/061_racer_profiles_season_stats.sql`をベースに、現行mainブランチの最新マイグレーション番号を確認した上で正式なマイグレーションファイルを作成・適用する（`ability_index`/`flying_count_period`/`false_start_count_period`/`period_label`/`official_win_rate_period`等）
- [ ] `scripts/maintenance/scrape-racer-profiles.js`を拡張し、既存の選手プロフィール取得と同じ巡回で期別成績も取得する
- [ ] 新規GitHub Actionsワークフローを作成する（月次実行＋5/1・11/1直後2週間は週次にブースト、`docs/db-migration/061`のコメントに記載した発表タイミングの推定を実装時に複数年分の公式ニュースで裏取りする）
- [ ] 自社`racer_aggregated_stats`との検算スクリプトを作成し、初回実行結果を記録する（`.claude/rules/analysis.md`のデータ精度検証パターンに準拠）
- [ ] [BOA-323](https://linear.app/boat-ai/issue/BOA-323)の修正状況を確認した上で、`race_start_timings.is_flying`を使ったF休み期間の自社計算ロジックを検証する（可能なら日和の「F休み期間」相当のスクレイピング自体が不要になる）

## FR-1: レース特記事項ページ

- [x] `race/information`ページ（会場・日付単位）で、実際に「事故・内規違反・減点」「モーター・ボート変更」「欠場・帰郷」の通知がある日を探し、3区分それぞれのHTML構造・表記パターンを確認する（2026-09-15、検索エンジンのインデックス経由でjcd=12 hd=20171224の実例を発見・3区分とも実データ確認済み。直近日付では通知自体が非常に低頻度で見つからなかったが、上記実例で受入基準を満たす。フィクスチャ化してscripts/maintenance/verify-race-notices-parser.jsで回帰テスト化済み）
- [x] `docs/db-migration/060_race_special_notes.sql`をベースに正式なマイグレーションを作成する（race_notices_health含む）。**適用済み**（2026-09-15、Supabase Management APIのdatabase/queryエンドポイント経由。Supabase MCPは読み取り専用のため`CREATE TABLE`が拒否されたが、SUPABASE_ACCESS_TOKENでのMangement API直接呼び出しは可能と判明し適用した。`race_special_notes`・`race_notices_health`両テーブルの存在を`information_schema`で確認済み）
- [x] `scripts/daily/scrape-race-information.js`を実装する（`run(schedule, date)`パターン、3区分をまとめて取得）。本番Supabaseの本日のスケジュール（13会場）+本番boatrace.jpに対する実行で、パース処理自体は正常動作を確認済み（マイグレーション適用済みのため書き込みも今後の実行で検証可能）
- [x] `api/cron/race-notices.js`を実装する（BOA-313 Phase1と同じ「即時応答＋`waitUntil`バックグラウンド継続」パターン、`CRON_SECRET`認証）
- [x] `scripts/lib/venueMotorStats/driftHealth.js`のコアロジック（`updateVenueHealth`、`DRIFT_ALERT_THRESHOLD_DAYS`）を再利用し、本FR用のreasonコード分類（`notice_section_not_found`/`unexpected_section_count`）を定義して構造変化監視を組み込む。`findDriftAlerts`はvenue_motor_stats固有のreason語彙にハードコードされておりそのままでは一致しないため再利用せず、同じ形で返す`findRaceNoticesDriftAlerts`を`check-race-notices-drift.js`側に個別定義した（コードレビューで発覚・修正、ADR-0059の「reasonコード分類はスクレイパーごとに個別定義」を実装面でも徹底）。Vercel Functionはファイルシステム永続化・git commitができないため、`race_notices_health`テーブル（会場×日付単位の当日集計）をSupabaseに持ち、`scripts/maintenance/check-race-notices-drift.js`（GitHub Actions日次実行、`race-notices-drift-monitor.yml`）が直近日数分を畳み込む設計に変更した（venue_motor_statsのローカルJSON+git commit方式はサーバーレス実行に適用できないため）
- [ ] cron-job.orgにジョブを追加する（10分間隔、7:00-23:00 JST）※cron-job.org側の外部アカウント操作が必要なためユーザー対応待ち
- [ ] 単体デプロイで実データ確認する（マイグレーション適用済みのため、Vercelへのデプロイ後に実施可能）
- [ ] 数日〜1週間運用し、取得成功率・エラー率を確認してから本番運用に移行する（上記デプロイ後の運用タスクのため未着手）

## FR-3: 今節成績（節内の日別進捗）

- [ ] [BOA-220](https://linear.app/boat-ai/issue/BOA-220)（今節得点率）とのスコープ重複を整理し、統合方針を確定する
- [ ] 得点率の公式計算ルール（着順→得点の対応表、優勝戦の加重等）を一次情報源で確認し、`docs/reference/`にまとめる
- [ ] [BOA-226](https://linear.app/boat-ai/issue/BOA-226)（`races.series_day`）の実装状況を確認する（未完了なら本タスクの前提として先に完了させる）
- [ ] `getSeriesResultsByRacer(racerId, venueCode, meetStartDate)`を`supabaseDataService.js`に実装する（`races`/`race_results`/`race_entries`のJOIN、過去日分）
- [ ] [BOA-323](https://linear.app/boat-ai/issue/BOA-323)の修正・バックフィル状況を確認した上で、当日分（結果確定に連動する部分）の動作を実データで検証する

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
