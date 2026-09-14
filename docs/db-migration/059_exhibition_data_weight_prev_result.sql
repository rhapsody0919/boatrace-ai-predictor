-- BOA-289: exhibition_data に beforeinfoページ未取得セルの残り2項目（当日体重・前走成績）を
-- 追加する。BOA-221（tilt/propeller_change/parts_changed/adjustment_weight）と同じテーブル・
-- 同じrace_id+boat_number粒度で取得できるセルのため、新規テーブルは作らず既存テーブルに列追加する。
--
-- today_weight: 当日計量の実測体重（kg）。race_entries由来の静的な体重（BOA-288、未実装）とは
-- 別物のため、両者を混同しないよう列名をweightではなくtoday_weightとする。
-- prev_race_no/prev_entry_course/prev_start_timing/prev_finish_rank: 今節（開催）内の
-- 直近レースの結果サマリー。下関・住之江の実データで確認済み（2026-09-14）:
-- beforeinfoページのtbody 1行目td[8]="R"（ラベル）+td[9]=前走のレース番号、
-- 2行目td[1]=前走の進入コース、3行目td[2]=前走のST（td[1]="ST"ラベル、td[0]は無関係の
-- 調整重量）、4行目td[1]=前走の着順（raceresultページへのリンク付き）。
-- 今節初戦の艇は前走が存在しないためすべてNULLになる。

ALTER TABLE exhibition_data
  ADD COLUMN IF NOT EXISTS today_weight DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS prev_race_no INTEGER,
  ADD COLUMN IF NOT EXISTS prev_entry_course INTEGER,
  ADD COLUMN IF NOT EXISTS prev_start_timing DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS prev_finish_rank INTEGER;
