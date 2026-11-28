# データの欠け（レーン J）の DB の変更の案

> **未審査の案。適用の根拠にしない。** マイグレーションは窓口が作る（番号は PR を作るときに origin/master の最大＋1）。適用はオーナーの db-apply。設計は [plan.md](./plan.md)。system-architect の設計の審査（2026-11-28）の指摘は反映済みだが、この SQL はマイグレーションの PR で改めて審査する。

## 0. 変えない物と、変える物

| 段 | DB の変更 | マイグレーション | 理由 |
|---|---|---|---|
| J1a 種別（節）・グレード・風向の区分 | **なし** | — | race_facts の列（series_kind・race_grade・wind_sector）は 212 にある。書き手が race_series・風向を読むだけ |
| J1b 女子戦（レース単位） | race_facts に列 `field_gender` | M1（列と NOT VALID の CHECK）→ M2（VALIDATE） | 節の種別では拾えないレースがある（plan.md §5） |
| J1a の語彙の守り（任意） | race_facts に CHECK（wind_sector・tide_phase） | M1・M2 に同梱 | 書き手の語彙を DB でも守る。足さなくても動く |
| J2 潮位 | 新しい表 `tide_station_daily` | M3（検証の後） | どこにも無い |
| J3 結果のページの気象 | 新しい表 `race_result_weather` | M4（V0・V1・ADR-0101 の追記の後） | race_conditions を上書きすると学習に発走の後の値が入る。kb_archive_extra は main の期間に使えない（CHECK `race_date <= '2025-12-02'`） |

- 進みは `backfill_progress`（212）。日の単位でない取得は `unit_id='YYYY-MM-DD|<id>'`（212:202 の CHECK が先頭10文字と target_date の一致を求める）
- 戻しはマイグレーションごと。**先に書き手を戻し、その後に列・表を消す**（書き手が消えた列を送ると PostgREST が落ち、窓の書き込みが丸ごと止まる）

## 1. M1・M2 `race_facts.field_gender` と語彙の CHECK（J1b）

db-apply は1ファイルを1つのトランザクションで流す（docs/operation/db-apply.md:51-54）。同じファイルに ADD CONSTRAINT … NOT VALID と VALIDATE を置くと、ACCESS EXCLUSIVE の錠を COMMIT まで持ったまま全行を読む（今夜の後は kb の全行がある）。列の追加に CHECK を書いても同じく全行を読む。なので2本に分ける。

```sql
-- M1（未審査の案。適用の根拠にしない）。列は CHECK なしで足し、CHECK は名前つきの NOT VALID（新しく書く行にだけ効き、既存の行を読まない）
SET LOCAL lock_timeout = '10s';
ALTER TABLE public.race_facts ADD COLUMN IF NOT EXISTS field_gender text;
ALTER TABLE public.race_facts DROP CONSTRAINT IF EXISTS race_facts_field_gender_check;
ALTER TABLE public.race_facts ADD CONSTRAINT race_facts_field_gender_check
  CHECK (field_gender IS NULL OR field_gender IN ('female', 'male', 'mixed')) NOT VALID;
ALTER TABLE public.race_facts DROP CONSTRAINT IF EXISTS race_facts_wind_sector_check;
ALTER TABLE public.race_facts ADD CONSTRAINT race_facts_wind_sector_check
  CHECK (wind_sector IS NULL OR wind_sector IN ('tail_strong', 'tail', 'calm_cross', 'head', 'head_strong')) NOT VALID;
ALTER TABLE public.race_facts DROP CONSTRAINT IF EXISTS race_facts_tide_phase_check;
ALTER TABLE public.race_facts ADD CONSTRAINT race_facts_tide_phase_check
  CHECK (tide_phase IS NULL OR tide_phase IN ('rising', 'falling', 'high', 'low', 'none')) NOT VALID;
COMMENT ON COLUMN public.race_facts.field_gender IS
  '出走した艇（欠場を除く）の選手の性別（racer_profiles.sex）から書き手が決める区分。全員女子=female・全員男子=male・混ざる=mixed、1艇でも性別が分からなければ NULL（docs/design/data-gaps）';
```

```sql
-- M2（未審査の案。M1 の後の別のマイグレーション）。VALIDATE は SHARE UPDATE EXCLUSIVE で読みも書きも止めない
SET LOCAL lock_timeout = '10s';
ALTER TABLE public.race_facts VALIDATE CONSTRAINT race_facts_field_gender_check;
ALTER TABLE public.race_facts VALIDATE CONSTRAINT race_facts_wind_sector_check;
ALTER TABLE public.race_facts VALIDATE CONSTRAINT race_facts_tide_phase_check;
```

- 当てる時: kb の CLI が止まっている間で、`race_facts_main` の起動（30分ごと）の合間
- NULL を許す列の追加で既定値が無いので、表の書き換えは起きない
- `get_racer_runs` は `to_jsonb(f)` でレースの列を全部返すので、関数を直さずに画面へ届く。表の単位の GRANT と RLS が新しい列にも効く
- 本番の postgres が superuser でないことは問題にならない（表の持ち主は postgres、SET 句・GUC・DEFINER を使わない）
- 書き手の payload は全行が同じ列を持つ（db-operations.md:21）。**M1 の適用 → 定時の配備 → 書き手の PR** の順。逆にすると kb・main の書き込みが止まる
- 戻し（書き手を戻した後）: `BEGIN; SET LOCAL lock_timeout='10s'; ALTER TABLE public.race_facts DROP CONSTRAINT IF EXISTS race_facts_field_gender_check; ALTER TABLE public.race_facts DROP CONSTRAINT IF EXISTS race_facts_wind_sector_check; ALTER TABLE public.race_facts DROP CONSTRAINT IF EXISTS race_facts_tide_phase_check; ALTER TABLE public.race_facts DROP COLUMN IF EXISTS field_gender; COMMIT;`

## 2. M3 `tide_station_daily`（J2、検証の後）

- 1地点×1日を1行。気象庁の潮位表のファイルの1行（1日1地点）と1対1
- 毎時の行（past-data-backfill db-draft §4 の `venue_tide_hourly`）を取らない理由: 行が24倍（11地点×24時×365日×9年 ≒ 約87万行 対 約3.6万行）。書き手が半月の窓で読むのは 11地点×16日 ≒ 176行で、1000行の上限に掛からない。毎時で SQL から直に引く読み手は今は無い
- 会場でなく地点で持つ。会場と地点の対応は `src/data/` の定数（出典つき）。江戸川・平和島は同じ東京の行を読む
- 干満差の無い会場は行を持たない（facts では `tide_phase='none'`）

```sql
-- M3（未審査の案。適用の根拠にしない）
SET LOCAL lock_timeout = '10s';
CREATE TABLE IF NOT EXISTS public.tide_station_daily (
  station_code text        NOT NULL CHECK (station_code ~ '^[A-Z0-9]{2}$'),
  tide_date    date        NOT NULL,
  hourly_cm    smallint[]  NOT NULL CHECK (array_ndims(hourly_cm) = 1 AND array_lower(hourly_cm, 1) = 1
                                           AND array_length(hourly_cm, 1) = 24 AND array_position(hourly_cm, NULL) IS NULL),
  high_times   time[]      NOT NULL DEFAULT '{}',
  high_cm      smallint[]  NOT NULL DEFAULT '{}',
  low_times    time[]      NOT NULL DEFAULT '{}',
  low_cm       smallint[]  NOT NULL DEFAULT '{}',
  source       text        NOT NULL CHECK (source IN ('jma_suisan')),
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (station_code, tide_date),
  CHECK (cardinality(high_times) = cardinality(high_cm) AND cardinality(low_times) = cardinality(low_cm)),
  CHECK (cardinality(high_times) <= 4 AND cardinality(low_times) <= 4)
);
COMMENT ON TABLE public.tide_station_daily IS
  '気象庁の潮位表（推算・天文潮）の1地点1日1行（docs/design/data-gaps）。hourly_cm は 0〜23時（JST）の毎時の潮位（cm、地点ごとの潮位表基準面。地点の間で比べない）。満潮・干潮は時刻順、予測されない回（9999/999）は詰める。会場と地点の対応は src/data の定数。facts の書き手だけが読む。出典: 気象庁ホームページ';
ALTER TABLE public.tide_station_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tide_station_daily FROM anon;
REVOKE ALL ON public.tide_station_daily FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tide_station_daily TO service_role;
```

- 容量（推定、実測なし）: 1行 約150B と索引で 11地点×365日×9年 ≒ 約3.6万行・約7MB
- time[] は PostgREST が "HH:MM:SS" で返すので、書き手も同じ形で送る（違う形だと `unchangedRows.js` が毎回「変わった」と見て書き直す）
- 匿名の権限なし。画面は facts の `tide_cm`・`tide_phase` だけを読む（ADR-0113 の読み方のまま）
- 戻し: `BEGIN; SET LOCAL lock_timeout='10s'; DROP TABLE IF EXISTS public.tide_station_daily; COMMIT;`（書き手と Cron を先に止める。取り直しは気象庁の99ファイル）

## 3. M4 `race_result_weather`（J3、V0・V1・ADR-0101 の追記の後）

- 結果のページ（raceresult）の水面気象を1レース1行。両 era（kb 2019-04-15〜、main の前半）。今の結果の取得が書く race_conditions とは別に置き、学習のデータ（race_conditions を読む）に入れない
- 列は `toWeatherColumns`（scripts/lib/beforeinfoWeather.js:219）と同じ値。風向は取得した矢印の番号の名（race_conditions と同じ語彙）

```sql
-- M4（未審査の案。適用の根拠にしない）
SET LOCAL lock_timeout = '10s';
CREATE TABLE IF NOT EXISTS public.race_result_weather (
  race_id           text        PRIMARY KEY CHECK (race_id ~ '^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$'),
  race_date         date        NOT NULL,
  weather           text,
  wind_direction    text,
  wind_speed        numeric(4,1),
  wave_height       smallint,
  temperature       numeric(4,1),
  water_temperature numeric(4,1),
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (left(race_id, 10) = to_char(race_date, 'YYYY-MM-DD')),
  CHECK (num_nonnulls(weather, wind_direction, wind_speed, wave_height, temperature, water_temperature) > 0)
);
COMMENT ON TABLE public.race_result_weather IS
  '公式の結果のページの水面気象（レースの時点の値）を後日に取り直した1レース1行（docs/design/data-gaps §3.4）。race_conditions（学習のデータが読む）とは別。facts の書き手が condition_source=race_result の出所として読む。wind_direction は画面の矢印の番号の名（race_conditions と同じ）';
ALTER TABLE public.race_result_weather ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.race_result_weather FROM anon;
REVOKE ALL ON public.race_result_weather FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.race_result_weather TO service_role;
```

- 容量（推定、実測なし）: 1行 約100B。main の前半 約4万＋kb 1〜2年分 約5.5万〜11万で 10〜20MB
- 気象が1項目も読めないページは行を作らない（CHECK でも守る）。中止・不成立のレースは対象にしない
- 食い違い: past-data-backfill db-draft §3 は kb の気温・水温・16方位を `kb_archive_extra`（source='raceresult' のレースの行）に置く設計。J3 はこの表に移し、kb_archive_extra のその列は使わない。212 は列を持ったまま（消すかは窓口の判断）
- 戻し: 書き手を戻して facts を作り直してから `BEGIN; SET LOCAL lock_timeout='10s'; DROP TABLE IF EXISTS public.race_result_weather; COMMIT;`

## 4. 試験（マイグレーションの PR で、PGlite）

- 212 → 213 → M1 → M2 → M3 → M4 を流し、新しい verify（`scripts/maintenance/verify-data-gaps-migrations.js`）で
  - M1: 語彙の外の field_gender・wind_sector・tide_phase が拒まれる。M1 を2回流しても落ちない。get_racer_runs の jsonb に field_gender が出る
  - M2: 語彙の外の行が既にあると VALIDATE が落ちる（落ちる場合を作って確かめる）
  - M3: 24でない配列・2次元・下限が0・NULL を含む配列・満潮の時刻と値の数の違い・5回目の満潮が拒まれる。主キーの重なりで upsert が1行のまま
  - M4: 気象が全部 NULL の行・race_id と race_date の食い違いが拒まれる
  - 全部: `SET ROLE anon` の後の SELECT が permission denied
  - backfill_progress に `unit_id='2019-01-01|TK'`・`target_date='2019-01-01'` の行が入る（source='jma_tide'）。`'TK-2019'` が拒まれる
- 書き手の純関数（潮位の補い・位相・風向の区分・女子戦の判定）は DB に依らない verify で
- 表を足したら `node scripts/maintenance/generate-er-diagram.js data-gaps` を回す（db-operations.md:12）

## 5. 取得（ADR-0066 の共通のラッパ）

| ジョブ | 起動 | 1起動の量 | 書く先 | 止め方 |
|---|---|---|---|---|
| `tide_table`（J2） | 毎日（fan_period と同じ形、registry.js:323）。cron は UTC で書き JST を注釈。取っていない「地点×年」（2019〜翌年）が無ければ0リクエスト | 最大11ファイル（目安） | tide_station_daily（変わらない行は書かない `unchangedRows.js`） | 書式の違い（桁・地点記号）は構造の変更とみなし何も書かない（error）。365・366行でなければ error |
| raceresult の過去分（J3） | JST 01:00〜06:00。past-data-backfill §4 の段2 のジョブ | 20レース前後（目安） | race_result_weather | ADR-0101 に J3 の前に追記する（ブレーカーのキーを分けるか・1晩の上限）。それまで live にしない |

- どれも進みは `backfill_progress`（source='jma_tide'・'raceresult'）。0件の書き込みを成功にしない
- facts は書き手が毎回全部の出所を読んで作り直す。潮位・水温が入ったら race の版（`RACE_FACTS_RULE_VERSION`）だけ上げる（plan.md §3.1。run の版は上げない）
- vercel.json の crons が2行増える（今は82行、Vercel の上限は未確認）

## 6. 適用の前後

- 事前（読み取り）: plan.md §4 の Q6・Q7・Q9。J2 は検証、J3 は V0・V1 が通ったこと
- 適用: マイグレーション（窓口）→ db-apply（オーナー）→ 定時の配備 → 書き手・Cron の PR → vercel.json の crons の行（人）→ mode を live（オーナー）→ facts の作り直し（kb は CLI、main は毎晩の起動）
- 事後:
  - `relrowsecurity` が true、anon の SELECT が false、claude_ro が新しい表を SELECT できる（166 の既定の権限）
  - 地点ごとの行の数が年の日数と一致
  - facts の干満差のある12会場で `tide_phase` が埋まり、干満差の無い12会場で 'none'
  - Q6 で版ごとの行の数が作り直しの進みと合う
