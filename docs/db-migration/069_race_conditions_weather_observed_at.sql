-- race_conditionsに気象の観測時刻（weather_observed_at）を追加する（BOA-358）
--
-- 適用手順（ユーザーが実行する。コードのマージより先に適用する）:
--   Supabase Dashboard > SQL Editor で、次の全体を実行する。
--     BEGIN;
--     （このファイルのALTER TABLE・COMMENT）
--     COMMIT;
--   適用後の確認:
--     SELECT column_name, data_type FROM information_schema.columns
--      WHERE table_name = 'race_conditions' AND column_name = 'weather_observed_at';
--     → 1行（timestamp with time zone）が返ること。
--   ロールバック（必要な場合のみ）: ALTER TABLE race_conditions DROP COLUMN weather_observed_at;
--
-- 背景: レース詳細の気象が公式とずれる（多摩川1R 2026-09-19: 本サイトは「晴・22.0℃・風速2.0m」、
-- 公式は「曇り・24.0℃・風速1m」）。原因は、気象を発走60分前に1回しか取得していないこと
-- （scripts/daily/update-race-info.js。2026-09-15〜18の646レースで、保存時刻
-- race_conditions.created_atは発走の中央値60分前）。あわせて、行に「いつ時点の気象か」を示す列が
-- 無く、画面で鮮度を示せず、完了の定義B（可変データのタイミングを実測で検証する）も測れない。
--
-- 列の意味: 公式のbeforeinfoページ「水面気象情報　HH:MM現在」の観測時刻（JSTの当日日付+HH:MMから
-- 組み立てたtimestamptz）。レース結果ページ（raceresult）の気象は公式が観測時刻を載せないため、
-- 発走予定時刻を入れる（レース時点の確定値のため）。NULLは「観測時刻が不明」（この列の追加前に
-- 保存された行、または観測時刻を取得できなかった行）。
--
-- 影響: 既存行にはNULLが入るのみ（既定値なし・NULL可・ADD COLUMN IF NOT EXISTS）。テーブルの書き換え
-- （リライト）は発生せず、既存の読み書きにも影響しない。RPC（get_predictions_by_date等）は変更しない
-- （画面への受け渡しはRPC定義の後続の変更で行う。PR本文の「後続作業」参照）。
--
-- バックフィル方針: 過去レースへの遡及はしない。beforeinfoページは発走後も「その日の最新の観測」を
-- 表示し続けるため、過去レースに対して取得すると、そのレースの時点とは異なる気象が入る。
-- 追加日以降の新規取得分から、観測時刻が入る。

ALTER TABLE race_conditions
    ADD COLUMN IF NOT EXISTS weather_observed_at TIMESTAMPTZ;

COMMENT ON COLUMN race_conditions.weather_observed_at IS
    '気象（weather・wind_direction・wind_speed・wave_height・temperature・water_temperature）の観測時刻。公式beforeinfoの「水面気象情報 HH:MM現在」から組み立てる。raceresult由来の値は発走予定時刻。NULLは観測時刻不明';
