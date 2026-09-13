-- BOA-221: exhibition_data に beforeinfoページの未取得セル（チルト・プロペラ交換・
-- 部品交換・調整重量）を追加する。既存の展示タイム(exhibition_time)と同じテーブル・
-- 同じrace_id+boat_number粒度で取得できるセルのため、新規テーブルは作らず既存テーブルに
-- 列追加する（motor_2rate/exhibition_timeのトレンド取得と同じrace_entries結合パターンを
-- そのまま流用できる）。
--
-- 全24会場のうち6会場（宮島・戸田・住之江・蒲郡・下関・芦屋）で実データを直接確認し、
-- セル位置・意味が完全に一致することを検証済み（BOA-221チケット参照）。

ALTER TABLE exhibition_data
  ADD COLUMN IF NOT EXISTS tilt DECIMAL(3,1),
  ADD COLUMN IF NOT EXISTS propeller_change TEXT,
  ADD COLUMN IF NOT EXISTS parts_changed TEXT[],
  ADD COLUMN IF NOT EXISTS adjustment_weight DECIMAL(4,1);
