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

- [ ] [BOA-220](https://linear.app/boat-ai/issue/BOA-220)（今節得点率）とのスコープ重複を整理し、統合方針を確定する
- [ ] 得点率の公式計算ルール（着順→得点の対応表、優勝戦の加重等）を一次情報源で確認し、`docs/reference/`にまとめる
- [ ] [BOA-226](https://linear.app/boat-ai/issue/BOA-226)（`races.series_day`）の実装状況を確認する（未完了なら本タスクの前提として先に完了させる）— **2026-09-15時点の状況（要決定）**: BOA-226は2026-09-12にスコープが転換しており、`series_day`（節内の何日目かという日数）そのものは実装されていない。代わりに`race_conditions.race_stage`（予選/準優勝戦/優勝戦等のラウンド種別文字列、`.title16_titleDetail__add2020`から抽出）が実装・本番適用済み（058マイグレーション、`scrapeRaceStage()`）。race_stageは「このレースが優勝戦か」の判定（BOA-326等）には使えるが、「節内の何日目まで進んだか」という日数の情報は持たないため、本FRが前提とする`series_day`列によるJOIN設計はこのままでは成立しない。着手前に次のいずれかを決定すること: (a) series_day（日数）を別途スクレイピング実装する、(b) `races.race_date`の会場内連続日数から節の日数を導出するロジックに設計変更する、(c) 今節成績の範囲特定に日数そのものは不要と判断し別の絞り込み条件に変更する
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

- [x] 24会場を実際にCMS構造で分類する（`/modules/`パス構成の共通CMS群、レガシー静的HTML/ASP群、その他）（2026-09-16、4体の調査エージェント＋メインセッションで24会場全てを実機確認。`/modules/`系16会場・レガシー/独自系8会場と確定。ADR-0055策定時点の見立て（10会場前後）より`/modules/`系の比率が高いと判明。詳細は`docs/issues/DATA_SCRAPING_GAPS.md`「2026-09-16 横断調査（第4弾）」参照）
- [x] 各会場のToS本文を確認する（robots.txtは全24会場確認済み・禁止なし、ToS本文は未確認）（2026-09-16、24会場全件のToS本文を確認。**戸田・浜名湖・宮島の3会場で複製・転載を制限する明示的な著作権条項を発見**、この3会場はスクレイピング対象から除外する。残り21会場は個人情報保護方針のみで、データ自体の複製・自動収集を制限する文言は無いことを確認。加えてBOA-294「コンピ指数」が会場公式サイトのデータではなく第三者（日刊スポーツ`raceyosou.jp`）の商用予想コンテンツであり、そのToSに**AI学習目的のデータ収集を明示的に禁止する条項**があることを発見した。詳細・引用は`docs/issues/DATA_SCRAPING_GAPS.md`参照）
- [x] [BOA-294](https://linear.app/boat-ai/issue/BOA-294)残存項目（前検ランキング・コンピ指数）の会場側更新頻度を確認する（2026-09-16。前検ランキング: 戸田で「開催日の前夜（午後7時頃）に更新予定」と確認、節に1回のみの更新でBOA-266が採用する常滑の同種ページもToS制限なしのため同じ前提で運用可能。コンピ指数: 上記の通り第三者の商用予想コンテンツと判明したため、更新頻度の調査自体が無意味になり**FR-6のスコープから完全に除外**することを決定）

**Phase 6a完了に伴うスコープ変更（2026-09-16）**: 上記調査結果を反映し、以下の訂正・除外を確定した。
- BOA-293「進入コース別選手成績」の個別選手データ保有会場は12→**13会場**（多摩川を追加、第3弾調査時は確認時期の関係で見落とし）。うち常滑・三国・びわこ・尼崎・徳山・下関・若松・芦屋・唐津・浜名湖・多摩川の**11会場は完全に同一URL（`/modules/raceinfo/?page=index_racecourse`）・同一テーブル構造**を持つ共有テンプレート対象
- 上記11会場のうち**浜名湖はToS制限（戸田と同一文言の著作権条項）のためスクレイピング対象から除外**。実装対象は**常滑・三国・びわこ・尼崎・徳山・下関・若松・芦屋・唐津・多摩川の10会場**
- 戸田（ToS制限で対象外）・児島（別CMS`/asp/htmlmade/`、非開催期間で実データ未確認）は個別対応の要否を含め本Phaseでは実装せず別タスク送りとする
- BOA-294「コンピ指数」は前述の理由でFR-6のスコープから完全に除外（会場公式サイト由来ではない、第三者ToSでAI学習目的の収集を明示的に禁止）
- BOA-295「潮汐」: 徳山の潮汐ページのみ未確認（要フォロー）。大村は今節分のみでアーカイブが無いため「年1回バルク取得」ではなく開催期間中の日次スクレイピング＋自前蓄積に設計変更が必要（plan.md要更新）
- BOA-296「レイアウト変更履歴」: 唐津の水面特性ページに解説文中の単発注記としてピット位置変更の記載を確認（構造化データではないため、実装時はテキスト差分監視程度に留める）

### Phase 6b: テンプレート実装

- [x] CMSベンダー分類ごとに1つの共有パーサーを実装する（Phase 6aの分類結果に基づく。BOA-293の10会場共有テンプレートが最優先候補）（2026-09-16、`scripts/lib/venueEntryCourseStats/parser.js`。Phase 6aで確認済みの10会場URL・列構成（枠/選手名/進入/進入率/平均ST/1〜6着率）一致を実装時に対象10会場全件へのHTTPリクエストで再検証済み（7会場は実データ、常滑・尼崎・びわこ・下関・唐津・多摩川・徳山は開催中で実データ行を確認、三国・若松・芦屋は非開催期間で「次節開催までしばらくお待ちください」表示を確認）、会場別の個別パーサーは不要と裏付けられた。テーブルのclass名自体は会場により異なる（`par-table01`/`com-table01`/`c_table`等）ため、クラス名ではなく見出しテキストで対象テーブルを解決する設計にした）

### Phase 6c: データ別実装（優先順）

- [x] [BOA-293](https://linear.app/boat-ai/issue/BOA-293)（進入コース別選手成績、**常滑・三国・びわこ・尼崎・徳山・下関・若松・芦屋・唐津・多摩川の10会場が最優先**、戸田・浜名湖・児島は上記理由により対象外）: `venue_entry_course_stats`テーブル作成・スクレイパー実装・日次実行の**コード実装は完了**（2026-09-16。`docs/db-migration/064_venue_entry_course_stats.sql`・`scripts/daily/scrape-venue-entry-course-stats.js`・`.github/workflows/scrape-venue-entry-course-stats.yml`（JST 20:00日次）・構造変化監視（`scripts/maintenance/check-venue-entry-course-stats-drift.js`、`driftHealth.js`のコア再利用）。会場サイトは選手登録番号を掲載しないため、racer_idは氏名一致ではなく自社`race_entries`（当日の出走表）から`race_id`+`waku`で解決する設計にした。実データ3会場（常滑・徳山・唐津）+非開催期間1会場（三国）のHTMLフィクスチャで回帰テスト（`npm run verify:venue-entry-course-stats`）。セルフレビューで発見した2件を修正済み: (1)見出し一致テーブル探索がDOM順で最初に見つかった部分一致テーブルを即採用してしまい、本来のテーブルがそれより後にある場合に取りこぼすバグ、(2)「次節開催」の誤検知防止スコープ（`.section_inner`/`main`）が両方とも無い場合にページ全体へフォールバックし、防止したかったヘッダーニュース欄の誤検知を再現してしまう経路。racer_id解決はrace_entries未整備の日には全行NULLになる設計だが、これはサイト構造監視（drift検知）とは別レイヤーの問題のため、drift検知には混ぜずログ警告のみで可視化した（判断が分かれる点として明記）
  - [x] **マイグレーション適用済み**（2026-09-16、ユーザーの対話ターミナルで適用。`venue_entry_course_stats`テーブル・PK`(race_id, waku, entry_course)`・`races`へのFKを本番DBの`information_schema`/`pg_constraint`で確認済み）
  - [ ] GitHub Actions初回実行結果の確認（`.github/workflows/scrape-venue-entry-course-stats.yml`、JST 20:00日次。マージ・初回実行後にフォロー）
- [ ] 前検ランキング（BOA-294残存分）: [BOA-266](https://linear.app/boat-ai/issue/BOA-266)（常滑を情報源とする実装）と重複するため、BOA-266側の完了状況を見てFR-6独自の実装要否を再判断する
- [ ] 水面特性（BOA-294残存分）: 年1回取得
- [ ] ~~コンピ指数（BOA-294残存分）~~: **2026-09-16、FR-6のスコープから除外（会場公式サイト由来ではなく第三者の商用予想コンテンツ、AI学習目的のデータ収集を明示的に禁止するToSのため実装しない）**
- [ ] [BOA-295](https://linear.app/boat-ai/issue/BOA-295)（潮汐）: `venue_tide_data`テーブル作成。若松・鳴門・丸亀は年1回バルク取得、**大村は開催期間中の日次スクレイピング＋自前蓄積**（今節分のみでアーカイブが無いため）、徳山は着手前に潮汐ページの有無を再確認する
- [ ] [BOA-296](https://linear.app/boat-ai/issue/BOA-296)（レイアウト変更履歴）: `venue_layout_changes`テーブル作成・月次軽量チェック（唐津の水面特性ページの定型文言をテキスト差分監視する程度の簡易実装で十分）
- [ ] 各スクレイパーに`driftHealth.js`ベースの構造変化監視を組み込む（データ項目ごとにreasonコード分類を定義）

## FR-7: 残存する個別ギャップ（参照のみ）

以下は各チケット単体で完結させる。本tasks.mdでは扱わない: [BOA-288](https://linear.app/boat-ai/issue/BOA-288)（racelist体重）・[BOA-290](https://linear.app/boat-ai/issue/BOA-290)（展示コース列）・[BOA-266](https://linear.app/boat-ai/issue/BOA-266)（前検タイム等）・[BOA-273](https://linear.app/boat-ai/issue/BOA-273)（選手コメント）・[BOA-292](https://linear.app/boat-ai/issue/BOA-292)（SG/G1限定ページ）。

## 横断タスク（優先度: 中、複数FR完了後にまとめて着手可）

- [ ] SG/G1グレードレースの優先度ティア（時間窓許容誤差±3分→±1分）を、FR-4・FR-1の実装完了後に追加検討する（`race_conditions.race_grade`で判定）
- [ ] オッズのデータ保存量（Supabaseストレージ使用率）を監視し、必要になった時点でアーカイブ方針を検討する
