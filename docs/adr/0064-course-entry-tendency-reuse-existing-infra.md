# ADR 0064: 進入コース遷移傾向は新規インフラを作らず既存基盤を拡張する

## ステータス
採用

## 背景

BOA-284（courseRate特徴量の修正）・BOA-337（BOA-293データのUI活用）・BOA-170（前づけ傾向表示、当初スコープに復元）を統合した設計（`docs/design/course-entry-tendency-rework/`）の着手にあたり、「選手×枠番→実進入コース遷移確率」を算出・配信する仕組みをどう作るかを判断する必要があった。

spec.md作成時点では、この統計量を算出する新規関数・新規テーブルが必要だと想定していた。しかし`/step2`でコードを調査した結果、BOA-257（Kファイル対応、PR #671）の時点で以下が既に実装済みだと判明した:

- `scripts/analysis/aggregate-racer-stats.js`の`calculateCourseEntryTendency(racerId, venueCode)`が、`race_entries`+`race_results`から「選手の枠番→実進入コース分布」を算出し、`racer_aggregated_stats.course_entry_tendency`（jsonb、`racer_id`+`venue_code`複合PK）に書き込む処理として存在する。ただし参照列が壊れた`course_1〜6`のまま
- `racer_aggregated_stats`は`venue_code`ごとに行を持つ設計のため、会場別の事前集計は既にテーブル構造として対応済み
- `src/services/supabaseDataService.js`の`getRacerRaceHistory()`＋`aggregateRacerVenueBoatStats()`/`aggregateRacerCrossStats()`が、選手ページの4軸フィルタ（会場×枠番×グレード×レース種別）をクライアント側で追加通信無しに再集計する設計として、PR #686（BOA-159、ADR-0063）で確立している

## 決定

新規テーブル・新規RPC・新規の重い集計パイプラインを作らず、上記2つの既存基盤をそれぞれ拡張する。

1. **`calculateCourseEntryTendency()`のデータソースを`course_1〜6`→`actual_course_1〜6`に切り替える**（列名の変更のみ、関数の構造・呼び出し元は変更しない）。これにより`racer_aggregated_stats.course_entry_tendency`が正しい値になり、以下すべてに波及する:
   - `unifiedModel.js`のcourseRate特徴量（BOA-284の本題）
   - レース出走表の新規行（FR-3、既存の`courseRateOf`と同じ経路で`racerStatsMap`から読む）
   - 分析タブ新設（FR-5、6選手分の`racerStatsMap`をそのまま使う）
   - 選手ページ概要バッジ（FR-4、`venue_code=0`の行を使う）
2. **選手ページの4軸フィルタ対応版（FR-2/FR-4詳細セクション）は、`getRacerRaceHistory()`の行に`actualCourse`フィールドを追加し、`aggregateRacerVenueBoatStats`と同じ形の新規純関数`aggregateRacerCourseEntryStats()`をクライアント側に追加する**（ADR-0063の設計をそのまま延長）

## 却下した選択肢

**新規の専用テーブル（例: `racer_course_entry_stats`）を作り、会場×グレード×レース種別ごとに事前集計して保存する方式**: 組み合わせ数が多く（24会場×グレード×レース種別）、バッチ処理のコスト・鮮度管理が複雑になる。かつ`racer_aggregated_stats`が既に`venue_code`単位の事前集計に対応済みで、グレード×レース種別の軸はページ側で選手ごとに数百件程度のデータをその場で絞り込む（ADR-0063が既に同じ規模で実証済み）方が実装・運用ともに軽い。却下。

**新規のPostgres RPC関数（例: `get_racer_course_entry_tendency(racer_id, venue_code, grade, stage)`）でDB側で都度集計する方式**: `aggregateRacerVenueBoatStats`/`aggregateRacerCrossStats`が既にクライアント側集計で確立しており、新規RPCを追加すると「一部はクライアント側集計、一部はDB側RPC」という一貫性の無い設計になる。既存パターンとの整合性を優先し却下。

**BOA-293方式（会場サイトスクレイピング）を全24会場に拡張する方式**: 対象外14会場は会場側が同種データを公開していないため技術的に不可能（`docs/design/scraping-full-coverage/tasks.md`のPhase 6a調査で確認済み）。自社データ（`actual_course_N`）による代替が必須。

## 影響

- 新規マイグレーションファイルは不要（`racer_aggregated_stats`・`race_results.actual_course_1〜6`とも既存）
- `calculateCourseEntryTendency()`の修正は、既存の`aggregate-racer-stats.js`バッチ実行スケジュールにそのまま乗る（新規GitHub Actionsワークフロー不要）
- BOA-293（`venue_entry_course_stats`、10会場）とのハイブリッド表示は、FR-3の表示ロジック内で「対象10会場は`venue_entry_course_stats`優先、それ以外は`racer_aggregated_stats.course_entry_tendency`」という分岐のみで実現する（データ取得経路自体は変更しない）

## 追記（2026-09-19、会場別対応時の訂正）

会場別対応の調査で、上記の記述に誤りがあると分かった。決定（新規の選手側テーブル・RPCを作らず既存基盤を拡張する）自体は変わらない。

- 「`racer_aggregated_stats`は`venue_code`ごとに行を持つため、会場別の事前集計は既に対応済み」は誤り。スキーマ上は可能だが、本番には`venue_code=0`の行しか無い（1,639選手、夜間バッチ`aggregate-stats.yml`が`--all`のみで実行するため）。会場別を別の行にすると選手数×会場数の追加クエリになるので、`venue_code=0`の行の`course_entry_tendency`の中に会場別の内訳（`venues`キー）を持たせる方針に変更した（`plan.md`参照）
- 「`calculateCourseEntryTendency()`の1箇所の修正がBOA-284に波及する」は誤り。courseRateの直接の入力は`course_race_counts`（`calculateCourseRaceCounts`）で、`course_1〜6`を読む4関数すべて（他に`calculateAttackDistribution`・`calculateDefenseDistribution`）を切り替える必要がある
- 選手×会場×枠番は走数が薄い（中央値2走、n≥5は組合せの6.6%）ため、専用テーブルを避けた判断はそのままに、走数の下限で`null`にせず走数付きで保存・表示する方針に変えた（`spec.md`背景5）
- 選手非依存の会場平均は別の粒度（24会場×6枠）で件数が十分あるため、別のADR（[ADR-0065](./0065-venue-course-entry-baseline-precomputed-table.md)）で`venues`のjsonb列に持つと決めた
