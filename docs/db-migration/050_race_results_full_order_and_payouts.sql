-- race_resultsに4〜6着の個別着順・タイム・追加の払戻金種別・人気を追加（BOA-238）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: レース結果ページ（RaceResult.jsx）の表示情報が薄い問題（BOA-238）を調査する過程で、
-- 公式サイト（boatrace.jp）・kyoteibiyori.comを実際に確認したところ、両サイトとも
-- 「6艇全ての着順＋タイム」「2連単・2連複・拡連複を含む全payout種別＋人気（人気順位）」を
-- 表示していることが判明した。scripts/daily/scrape-results.jsは既にHTMLをパースしているが、
-- scrapeRaceResult()が上位3着（index<3）で4〜6着行を読み捨て、scrapePayouts()も
-- 2連単/2連複/拡連複を判定はするが保存分岐が無いため捨てていた。新規スクレイピングは
-- 不要で、この読み捨て箇所を保存対象に広げるためのカラム追加。
--
-- 命名注意: 既存のpayout_trifecta/payout_trioはDB列名と英語名が歴史的経緯で逆転している
-- （trifecta列に3連複、trio列に3連単を格納）。この逆転は既存カラムのみの話であり、
-- 今回新設するカラムは実際の意味通りに正しく命名する（trifecta/trioの逆転を踏襲しない）。
--
-- バックフィル方針: 過去約4万件の再スクレイピングは高コストで価値が低いため行わない。
-- 既存行は新カラムがNULLのままになる。フロント側（RaceResult.jsx/RaceReview.jsx）は
-- NULLを前提に該当セクションを非表示にするグレースフルな設計にする。
--
-- 対象外: race_results.course_1〜6（進入コース）は全保存レースで艇番=コース番号と
-- 完全一致しており進入変化を検出できていない疑いがあるため、本マイグレーションでは
-- 触らない（別途データ品質調査が先決）。

ALTER TABLE race_results
    -- 4〜6着の艇番号（rank1〜3は既存）
    ADD COLUMN IF NOT EXISTS rank4 SMALLINT,
    ADD COLUMN IF NOT EXISTS rank5 SMALLINT,
    ADD COLUMN IF NOT EXISTS rank6 SMALLINT,

    -- 1〜6着のレースタイム（公式サイト表記そのまま、例: 1'50"6。5〜6着は空欄のことがある）
    ADD COLUMN IF NOT EXISTS race_time_1 VARCHAR(10),
    ADD COLUMN IF NOT EXISTS race_time_2 VARCHAR(10),
    ADD COLUMN IF NOT EXISTS race_time_3 VARCHAR(10),
    ADD COLUMN IF NOT EXISTS race_time_4 VARCHAR(10),
    ADD COLUMN IF NOT EXISTS race_time_5 VARCHAR(10),
    ADD COLUMN IF NOT EXISTS race_time_6 VARCHAR(10),

    -- 追加の払戻金種別（単勝/複勝/3連複=trifecta/3連単=trioは既存）
    ADD COLUMN IF NOT EXISTS payout_exacta INTEGER,     -- 2連単（rank1→rank2の順序通り）
    ADD COLUMN IF NOT EXISTS payout_quinella INTEGER,   -- 2連複（rank1,rank2の順不同）
    ADD COLUMN IF NOT EXISTS payout_wide_1 INTEGER,     -- 拡連複 rank1-rank2
    ADD COLUMN IF NOT EXISTS payout_wide_2 INTEGER,     -- 拡連複 rank1-rank3
    ADD COLUMN IF NOT EXISTS payout_wide_3 INTEGER,     -- 拡連複 rank2-rank3

    -- 人気（払戻金テーブルに実際に表示されている人気順位。オッズからの逆算ではなく
    -- ページに直接記載されている値をそのまま保存する。単勝・複勝は人気表示が無いため対象外）
    ADD COLUMN IF NOT EXISTS popularity_trifecta SMALLINT,
    ADD COLUMN IF NOT EXISTS popularity_trio SMALLINT,
    ADD COLUMN IF NOT EXISTS popularity_exacta SMALLINT,
    ADD COLUMN IF NOT EXISTS popularity_quinella SMALLINT,
    ADD COLUMN IF NOT EXISTS popularity_wide_1 SMALLINT,
    ADD COLUMN IF NOT EXISTS popularity_wide_2 SMALLINT,
    ADD COLUMN IF NOT EXISTS popularity_wide_3 SMALLINT;
