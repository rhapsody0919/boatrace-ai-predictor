-- 106: race_entries.weight_kg のコメントを「登録体重」から「当日体重」に直す（BOA-500）
--
-- 081 は、この列のコメントを「出走表の選手の登録体重（kg）。beforeinfo の当日体重は exhibition_data.today_weight」
-- としたが、実態は**当日体重**で、直前情報（beforeinfo）と同じ値・同じ時刻に公開される。
--
-- 裏づけ（3つ。いずれも独立）:
--   1. 本番の実測（2026-09-20〜28）: race_entries.weight_kg と exhibition_data.today_weight が同じ艇の
--      6,857 組のうち、6,810 組（99.3%）が完全一致。食い違う47組も差は最大0.8kg
--   2. 同じ実測で、整数の値は 2,489 / 6,857（36%）しかない。登録体重は整数で公開されるため、
--      この列が登録体重なら全て整数になるはず
--   3. BOA-422（出走表の複製汚染の復元）で、公式Bファイルの登録体重（整数）と、DBの race_entries.weight_kg
--      （小数）が別の量であることを確認済み。そのためBファイルからの復元対象から外した
--
-- 影響: コメントの文言だけ。列の型・値・権限・索引は変えない。データの書き換えも無い。
--
-- 確認（適用後）:
--   SELECT col_description('public.race_entries'::regclass, attnum)
--   FROM pg_attribute WHERE attrelid = 'public.race_entries'::regclass AND attname = 'weight_kg';
--
-- ロールバック（必要な場合のみ）: 081_race_entries_racelist_fields.sql の COMMENT を貼り直す

SET LOCAL lock_timeout = '10s';

COMMENT ON COLUMN race_entries.weight_kg IS '出走表の選手の当日体重（kg）。登録体重ではない（直前情報の exhibition_data.today_weight と同じ値・同じ時刻に公開される。2026-09-20〜28の実測で99.3%が完全一致）。081以前の行はNULL';
