-- race_entriesにracer_idのインデックスを追加（2026-09-07）
-- Supabase Dashboard > SQL Editor で実行する。
-- CONCURRENTLYはトランザクション内で実行できないため、SQL Editorで
-- 他の文と分けてこの1文だけを実行すること。
--
-- 背景: BOA-258（選手個別ページ・会場別レース一覧のデータ拡充）の実装中、
-- race_entries（25万行超）にracer_id単体のインデックスが存在せず、
-- racer_idで絞り込む全てのクエリが全表スキャンになっていることが判明した
-- （EXPLAIN ANALYZEで確認、Parallel Seq Scanで対象行の99.9%以上を破棄）。
-- 選手個別ページの成績・調子セクション（getRacerStats）はrace_entriesを
-- racer_idで絞り込むクエリを5つ同時実行するため（getRacerFormTrend・
-- getRacerTechniqueProfile・getRacerBoatReturnRate・getExhibitionTimeTrend・
-- 新規追加のgetRacerVenueStats）、実際に選手ページを開くと
-- "canceling statement due to statement timeout" で複数セクションが
-- 表示されなくなる現象をローカル検証で再現した（既存4関数も同じ原因で
-- 元々脆弱だった。新規関数の追加で同時実行数が4→5に増え表面化した）。

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_entries_racer_id
    ON public.race_entries (racer_id);
