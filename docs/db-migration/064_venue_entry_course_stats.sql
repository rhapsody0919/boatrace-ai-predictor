-- 進入コース別選手成績（BOA-293、FR-6 Phase 6c）
-- 対応spec/plan: docs/design/scraping-full-coverage/spec.md FR-6 / plan.md FR-6 Phase 6c
--
-- 会場公式サイト（`/modules/raceinfo/?page=index_racecourse`）が公開する、
-- 「本日出走する選手ごとの、枠番→実進入コースの遷移確率」を保存する。
-- boatrace.jp（中央ポータル）の`race_results.course_1〜6`のスクレイピングバグ
-- （BOA-278）が未解消のため、進入コースの当日推定材料として代替・補完する。
--
-- 対象は常滑・三国・びわこ・尼崎・徳山・下関・若松・芦屋・唐津・多摩川の10会場
-- （戸田・浜名湖はToS制限、児島は非開催期間で実データ未確認のため対象外。
-- 詳細はdocs/design/scraping-full-coverage/plan.md・tasks.mdのFR-6参照）。
--
-- 集計値自体は選手の全国直近12ヶ月実績（会場側が算出）であり、当日の結果には
-- 依存しない。race_idに紐付ける理由は「その日その枠に実際に入っていた選手が誰か」
-- （race_entriesと同じ出走表）を一意に特定するため。

CREATE TABLE IF NOT EXISTS venue_entry_course_stats (
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    venue_code SMALLINT NOT NULL,          -- 冗長だが会場別クエリの簡便化のため保持（race_idからも導出可能）
    waku SMALLINT NOT NULL,                -- 出走表上の枠番（1-6）
    entry_course SMALLINT NOT NULL,        -- 実進入コース（1-6）。1枠につき6行（進入コースごとの内訳）

    -- 選手情報（race_entriesとの照合結果。会場サイトは選手登録番号を掲載しないため
    -- 氏名一致では解決できず、race_entries.race_id+boat_numberから引く。
    -- 見つからない場合（race_entries未登録・退艇差し替え等）はracer_idをNULLのまま
    -- racer_name_rawで監査できるようにする）
    racer_id INTEGER,
    racer_name_raw TEXT NOT NULL,          -- 会場サイト表示名（正規化前、そのまま保存）

    entry_rate DECIMAL(5,2),               -- 進入率(%)
    avg_st DECIMAL(4,2),                   -- 平均ST
    place_rate_1 DECIMAL(5,2),
    place_rate_2 DECIMAL(5,2),
    place_rate_3 DECIMAL(5,2),
    place_rate_4 DECIMAL(5,2),
    place_rate_5 DECIMAL(5,2),
    place_rate_6 DECIMAL(5,2),

    stats_period_start DATE,               -- 会場側の集計期間（「直近12ヶ月」の開始）
    stats_period_end DATE,

    scraped_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (race_id, waku, entry_course)
);

CREATE INDEX IF NOT EXISTS idx_venue_entry_course_stats_racer
    ON venue_entry_course_stats (racer_id)
    WHERE racer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venue_entry_course_stats_venue_date
    ON venue_entry_course_stats (venue_code, race_id);

COMMENT ON TABLE venue_entry_course_stats IS
    'BOA-293: 会場公式サイト由来の進入コース別選手成績（枠→実進入コース遷移確率）。対象10会場、日次スクレイピング。';
COMMENT ON COLUMN venue_entry_course_stats.entry_course IS
    '実際に進入したコース（1-6）。同一waku内で1-6の最大6行が存在しうる（会場側にデータが無いコースは行自体が省略される）。';
COMMENT ON COLUMN venue_entry_course_stats.racer_name_raw IS
    '会場サイトの表示名をそのまま保存（全角スペース等は未加工）。racer_id解決の監査・デバッグ用。';

-- 構造変化監視用（BOA-285のvenue_motor_stats向けdriftHealth.jsコアロジックを再利用、
-- reasonコード分類のみ本FR用に個別定義。健全性履歴自体はSupabaseテーブルではなく
-- data/analysis/venue-entry-course-stats-health.json にJSONファイルとして保持する
-- 設計のため、本マイグレーションでは追加テーブルは不要）
