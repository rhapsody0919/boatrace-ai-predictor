# 過去データの取り込み（DB の変更の案）

> **未審査の案。適用の根拠にしない。** マイグレーションは作り手が作らない（AGENTS.md 安全の3）。審査（system-architect）の後、人がマイグレーションの PR を作り、オーナーが db-apply で当てる。設計は [plan.md](./plan.md)。

ここでは表の形と、出所の列との対応だけを書く。SQL の完全な形と PGlite の verify は、審査とオーナーの答え（plan.md §10）の後に、この文書へ足す。

## 1. `race_facts`（1レース1行）

| 列 | 型 | kb（2019-04-01〜2025-12-02） | main（2025-12-03〜） |
|---|---|---|---|
| race_id（PK） | text | kb_archive_races.race_id | races.race_id |
| era | text（'kb'・'main'） | 'kb' | 'main' |
| race_date・venue_code・race_number | date・smallint・smallint | kb_archive_races | races |
| race_grade | text | kb_archive_venue_days.race_grade | races.race_grade → race_series.grade → class_code（ADR-0104 決定4 の補正を書き手が当てる） |
| series_kind | text | race_series.kind を節で照合 | race_series.kind |
| stage_raw・is_final | text・boolean | kb_archive_races.stage と `isFinalStage`（v2） | race_conditions.race_stage と同じ関数 |
| deadline_time | time | kb_archive_races.deadline_time | races.start_time |
| weather・wind_direction・wind_speed・wave_height | text・text・smallint・smallint | kb_archive_races（レースの時点の確定値） | race_conditions（60分前の値。**時点が違う**ので `condition_source` 列で区別） |
| condition_source | text | 'k_file' | 'beforeinfo_60m' |
| temperature・water_temperature | numeric | kb_archive_extra（raceresult、段1の後。それまで NULL） | race_conditions |
| tide_cm・tide_phase | smallint・text | venue_tide_hourly から（§4、未確定。干満差の無い会場は tide_phase='none'） | 同じ |
| technique | text | kb_archive_races.technique | race_results の決まり手 |
| payout_win・payout_place_1・payout_place_2・payout_trifecta・combo_trifecta | integer・text | kb_archive_races | race_results（payout_trio は列名と中身が逆で3連単、data-columns.md 6行目） |
| has_result・race_status | boolean・text | kb_archive_races.has_result | race_results.race_status・races.cancellation_status |
| rule_version・built_at | smallint・timestamptz | 書き手 | 書き手 |

## 2. `run_facts`（1艇1行）

| 列 | 型 | kb | main |
|---|---|---|---|
| race_id・boat_number（PK） | text・smallint | kb_archive_boats | race_entries |
| racer_id | integer | kb_archive_boats.racer_id | race_entries.racer_id |
| racer_class | text | kb_archive_boats.class | race_entries.grade |
| motor_number | smallint | kb_archive_boats.motor_number | race_entries.motor_number |
| course | smallint | kb_archive_boats.course | race_results.actual_course_N |
| start_timing・is_flying・is_late | numeric・boolean・boolean | kb_archive_boats | race_start_timings |
| finish_code | text | kb_archive_boats.finish_raw | race_start_timings.official_finish_code（どちらも K の生コード。190 と同じ） |
| finish_rank | smallint | 着のコードから書き手が出す（01〜06 だけ） | 同じ |
| exhibition_time | numeric | kb_archive_boats.exhibition_time | exhibition_data |
| exhibition_st・tilt・weight・parts_changed | numeric・numeric・numeric・text[] | kb_archive_extra（beforeinfo、段2以降。それまで NULL） | exhibition_data |

- 索引: PK（race_id, boat_number）と (racer_id, race_id)。会場の月の集計は race_id の範囲（日付が先頭）で読む
- RLS 有効。anon・authenticated に SELECT だけ（GRANT を明示）。書き手は service_role だけ
- 容量（推定、実測なし）: 2019-04〜今で約253万艇。1行と索引で約180B として約 450MB、race_facts 約42万行で約 85MB。2005-01〜2019-03 を足すと約 +0.8GB

## 3. `kb_archive_extra`（K/B に無い過去分の生の値）

- 主キー (race_id, boat_number, source)。boat_number 0 はレースの行（気温・水温）。source は 'raceresult'・'beforeinfo'・'racelist'
- 値は jsonb でなく列で持つ（facts の組み立てが型で読む）。取得の時刻 fetched_at を持つ（後日の取得であることを残す）
- RLS 有効、anon・authenticated の権限なし（kb_archive と同じ）

## 4. `venue_tide_hourly`（潮位、plan.md §5 の未確認が解けてから）

- 主キー (venue_code, ts)。tide_cm・station_code・source（'jma_suisan'）
- 干満差の無い会場は行を持たない（facts 側は tide_phase='none'）

## 5. `backfill_progress`（取り込みの進み）

- 主キー (source, target_date)。status（'pending'・'done'・'no_race'・'failed'）・attempts・last_error・updated_at
- 書き手は service_role だけ。匿名の権限なし

## 6. `facts_coverage`（画面の注記の「いつから」）

- 主キー (item)。item は 'run'・'temperature'・'exhibition_st'・'tide' 等。first_date・last_date・computed_at
- 毎晩、facts から数え直す。anon に SELECT

## 7. 月ごとの件数の表（F、plan.md §7）

- 形は data-scientist の条件の区分が決まってから書く。主キーの案: (month, venue_code, boat_number, course, grade_bucket, is_final, condition_bucket)。値は件数（着の分布）と払戻の合計・二乗の合計（回収率の基準と同じ持ち方、ADR-0111）

## 8. 適用と戻し（案）

- 適用: マイグレーション（人）→ db-apply（オーナー）→ kb 層の CLI（オーナー、--apply）→ main 層の cron の行（人）→ mode を live（オーナー）
- 事後: anon の SELECT が true・INSERT が false、relrowsecurity、era ごとの行の数が kb_archive_boats・race_entries の数と一致、1選手の履歴が今の `getRacerRaceHistory` と同じ行を返す（main の期間）
- 戻し: 画面は今の表を読む形に戻すだけ。facts の表は DROP（元の表は変えないので失われる物は無い）
