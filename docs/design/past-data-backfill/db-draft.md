# 過去データの取り込み（DB の変更の案）

> **未審査の案。適用の根拠にしない。** マイグレーションは作り手が作らない（AGENTS.md 安全の3）。人がマイグレーションの PR を作り、オーナーが db-apply で当てる。設計は [plan.md](./plan.md)。system-architect の1回目の審査（2026-11-27、plan.md §12）の指摘は反映したが、表の形の再審査はまだ。

ここでは表の形と、出所の列との対応だけを書く。SQL の完全な形と PGlite の verify は、オーナーの答え（plan.md §10）と本番の読み取りの実測（plan.md §9）の後に足す。

## 0. 共通の決まり

- **書き手は1つ**（組み立ての関数）。毎回、kb_archive・kb_archive_extra・潮位・本体を全部読んで1行を作る。列の一部だけを書く書き手は作らない
- 全行が同じ列を持つ payload で `upsertChangedRows`。`built_at` は値の比べから外す
- 窓の中の PK の集合の差で、消えたレースの行を消す
- RLS 有効。facts の2表は anon・authenticated に SELECT を付けるが、ポリシーで1選手の行だけを通す（ADR-0113 決定4: run_facts は racer_id と RPC が立てる設定、race_facts は run_facts への EXISTS）。表を直に引くと0行。`facts_coverage` と件数の表は USING (true)。GRANT を明示（076 以降は既定で剥がす）。書き手は service_role だけ。RPC は1関数1文で REVOKE・GRANT

## 1. `race_facts`（1レース1行）

| 列 | 型 | kb（2019-04-01〜2025-12-02） | main（2025-12-03〜） |
|---|---|---|---|
| race_id（PK） | text | kb_archive_races.race_id | races.race_id |
| era | text | 'kb' | 'main' |
| race_date・venue_code・race_number | date・smallint・smallint | kb_archive_races | races |
| race_title・series_day・is_final_day | text・smallint・boolean | kb_archive_venue_days（title・series_day・is_final_day） | race_conditions（race_title・series_day・is_final_day） |
| race_grade | text（NULL 可） | kb_archive_venue_days.race_grade（NULL がありうる。数は未確認） | races.race_grade → race_series.grade → class_code（ADR-0104 決定4） |
| series_kind | text | race_series.kind を節で照合 | race_series.kind |
| stage_raw・is_final | text・boolean | kb_archive_races.stage と `isFinalStage`（v2） | race_conditions.race_stage と同じ関数 |
| deadline_time | time | kb_archive_races.deadline_time | races.start_time |
| weather・wind_speed・wave_height | text・smallint・smallint | kb_archive_races（レースの時点） | race_conditions |
| wind_sector | text | K の8方位から検証済みの扇形 | 16方位から同じ扇形 |
| condition_source | text | 'k_file' | **行ごと**: 結果ページで上書きした行（2026-09-19〜、raceResultPersist.js:230）は 'race_result'、K で埋めた行は 'k_file'、発走前の値の行は 'before_race'。条件の軸は 'before_race' の行を数えない |
| temperature・water_temperature | numeric | kb_archive_extra（raceresult、段2の後。それまで NULL） | race_conditions |
| tide_cm・tide_phase | smallint・text | venue_tide_hourly（plan.md §5 の検証の後）。干満差の無い会場は tide_phase='none'・tide_cm NULL。干満差のある会場で tide_cm が NULL なら欠け（COMMENT に書く） | 同じ |
| technique | text | kb_archive_races.technique | race_results の決まり手 |
| dead_heat | boolean | kb_archive_races.dead_heat | false（本体は同着を持てない。COMMENT に書く） |
| payout_win・payout_3tan・combo_3tan・payout_3fuku | integer・integer・text・integer | kb_archive_races（payout_win・payout_3tan・combo_3tan・payout_3fuku） | race_results（payout_win、**payout_trio が3連単**・payout_trifecta が3連複。列名と中身が逆、data-columns.md 6行目） |
| payout_place_1・payout_place_2 | integer（NULL 可） | **無い**（074 に複勝の列が無い。パーサーは読むが kbArchiveRows.js:107-109 で保存しない。LZH から読み直すまで NULL） | race_results |
| has_result・race_status | boolean・text | kb_archive_races.has_result | race_results.race_status・races.cancellation_status |
| rule_version・built_at | smallint・timestamptz | 書き手 | 書き手 |

- CHECK: `(era='kb' AND race_date<='2025-12-02') OR (era='main' AND race_date>='2025-12-03')`。2025-12-02 は kb から作る（kbArchiveBoundary.js）
- 列の名前は kb の `payout_3tan`・`payout_3fuku` に合わせる。本体の `payout_trifecta`（3連複）と同じ名前を3連単に使わない

## 2. `run_facts`（1艇1行）

| 列 | 型 | kb | main |
|---|---|---|---|
| race_id・boat_number（PK） | text・smallint | kb_archive_boats | race_entries |
| era・race_date | text・date | race_facts と同じ（CHECK も同じ） | 同じ |
| racer_id | integer | kb_archive_boats.racer_id | race_entries.racer_id |
| racer_class・f_count | text・smallint | kb_archive_boats.class・（F数は B に有るかを確かめる、未確認） | race_entries.grade・f_count |
| motor_number | smallint | kb_archive_boats.motor_number | race_entries.motor_number |
| course | smallint | kb_archive_boats.course | race_start_timings.entry_course → race_results.actual_course_N（racerRaceHistoryRows.js:92 と同じ順） |
| start_timing・is_flying・is_late_start | numeric・boolean・boolean | kb_archive_boats | race_start_timings |
| finish_code | text | kb_archive_boats.finish_raw | race_start_timings.official_finish_code（どちらも K の生コード、190 と同じ） |
| finish_mark・finish_rank | text・smallint | 着のコードから書き手が出す | race_start_timings.finish_mark・着のコードから |
| exhibition_time | numeric | kb_archive_boats.exhibition_time | exhibition_data |
| weight・weight_source | numeric・text | kb_archive_boats.weight（B の登録の体重）・'b_file' | exhibition_data（当日）・'beforeinfo' |
| tilt・parts_changed | numeric・text[] | kb_archive_extra（段3の後。それまで NULL） | exhibition_data |
| oriten_lap・oriten_turn・oriten_straight | numeric | kb_archive_extra（BOATCAST、段1の後） | race_original_exhibition_values |

- 索引: PK と (racer_id, race_id)。一括で入れるときは索引を後で作るか race_id の順に入れる
- 容量（推定、実測なし）: 2019-04〜今で約253万艇。1行と索引で約180B として約 450MB、race_facts 約42万行で約 85MB。2005-01〜2019-03 を足すと約 +0.8GB
- 選手の読み: `get_racer_runs(p_racer_id, p_from)`（SECURITY INVOKER・plpgsql・`SET boatai.facts_racer_id = ''` の句、本文で `PERFORM set_config(..., true)` を先に、anon に EXECUTE、jsonb を1つ返す。jsonb_agg に ORDER BY race_id）。細部は ADR-0113 決定4。走の多い選手で3秒に収まるかは適用前に EXPLAIN で測る（SET ROLE anon で）

## 3. `kb_archive_extra`（K/B に無い過去分の生の値）

- 主キー (race_id, boat_number, source)。boat_number 0 はレースの行（気温・水温・16方位の風向）。source は 'boatcast_oriten'・'raceresult'・'beforeinfo'
- 値は列で持つ。fetched_at を持つ（後日の取得であることを残す）
- RLS 有効、anon・authenticated の権限なし（kb_archive と同じ）

## 4. `venue_tide_hourly`（潮位、plan.md §5 の検証の後）

- 主キー (venue_code, ts)。tide_cm・station_code・source（'jma_suisan'）
- 干満差の無い会場は行を持たない

## 5. `backfill_progress`（取り込みの進み）

- 主キー (source, target_date)。status（'pending'・'done'・'no_race'・'failed'）・attempts・last_error・updated_at
- 書き手は service_role だけ。匿名の権限なし

## 6. `facts_coverage`（画面の注記の「いつから」）

- 主キー (item)。item は 'run'・'temperature'・'oriten'・'tide' 等。first_date・last_date・computed_at
- 毎晩、facts から数え直す。anon に SELECT

## 7. 月ごとの件数の表（F、plan.md §7）

- 条件の軸1つずつ別の表（月×会場×進入×条件1つ）。区分は検証済みの線を細かく持つ（風は m ごと、波は 0-2/3-5/6-9/10+）。値は着の分布の件数と払戻の合計・二乗の合計（ADR-0111 と同じ持ち方）。月の何日分を含むかの列を持つ
- 形は V4 とセルの数の実測の後に書く。会場の90日程度は facts を直に数える RPC の方が軽いこともある

## 8. 適用と戻し（案）

- 事前（読み取り）: pg_database_size と契約のディスクの上限、`kb_archive_venue_days.race_grade` の NULL の数、1か月分の組み立てと走の多い選手の読みの EXPLAIN (ANALYZE, BUFFERS)
- 適用: マイグレーション（人）→ db-apply（オーナー）→ kb 層の CLI（オーナー、半月ずつ・夜間・--apply）→ 当日と毎晩の cron の行（人）→ mode を live（オーナー）
- 事後: anon の SELECT が true・INSERT が false、relrowsecurity、era ごとの行の数が kb_archive_boats（〜2025-12-02）と race_entries（2025-12-03〜）と一致、2025-12-02 の行が全て era='kb'、1選手の main の期間の履歴が今の `getRacerRaceHistory` と同じ、今日の結果が30分以内に facts に入る
- 戻し: 画面は今の表を読む形に戻すだけ。facts の表は DROP（元の表は変えないので失われる物は無い）
