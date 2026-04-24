-- イン崩れ指数の精度向上のため、1号艇の今節avgSTカラムを追加
-- 分析で26.7ptの予測力（全6指標中2位）が確認された重要因子
-- 実行方法: Supabase SQL Editorで実行
ALTER TABLE races ADD COLUMN IF NOT EXISTS first_boat_avg_st DECIMAL(4,3);
