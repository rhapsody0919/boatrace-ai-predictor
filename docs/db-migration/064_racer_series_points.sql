-- 今節得点率（BOA-220/BOA-291、FR-3）
-- 対応spec/plan: docs/design/scraping-full-coverage/plan.md
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: docs/adr/0053-series-results-derivation-vs-scraping.md の追記(2026-09-16)を参照。
-- 得点率は自社の減点ルール再現ではなく、boatrace.jp「得点率一覧」ページ
-- （pointrank、SG/G1等の記念競走でのみ提供、一般戦・特別選抜競走には
-- 存在しない）を直接スクレイピングし、公式の計算結果をそのまま保存する。
--
-- meet_start_date（開催初日）は race_conditions.series_day（BOA-226）を
-- 使って対象日から逆算する（scripts/daily/scrape-point-rank.js参照）。

CREATE TABLE IF NOT EXISTS racer_series_points (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venue_code SMALLINT NOT NULL,
    meet_start_date DATE NOT NULL,
    racer_id INTEGER NOT NULL,
    race_grade VARCHAR(10),
    player_name VARCHAR(50),
    grade VARCHAR(5),
    rank SMALLINT,
    score_rate NUMERIC(4, 2),
    placements TEXT,
    total_points SMALLINT,
    penalty_points SMALLINT,
    remarks VARCHAR(30),
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (venue_code, meet_start_date, racer_id)
);

COMMENT ON TABLE racer_series_points IS
    'boatrace.jp得点率一覧ページ（pointrank）から取得した今節得点率。SG/G1等の記念競走のみ存在し、一般戦・特別選抜競走（オールレディース/マスターズ等）は対象外（該当開催はレコード自体が作られない）';
COMMENT ON COLUMN racer_series_points.rank IS
    '得点率順位。賞典除外・途中帰郷等でページ側が"-"の場合はNULL';
COMMENT ON COLUMN racer_series_points.score_rate IS
    '得点率（(得点-減点)/出走回数相当、公式計算済みの値）。賞典除外・途中帰郷等はNULL';
COMMENT ON COLUMN racer_series_points.placements IS
    '今節の着順を1走ごとに1文字で並べた生文字列（例: "１　１２３１４"、Ｆ=フライング/妨=妨害/エ=エンスト等）。未消化分は全角空白のまま保持し、位置情報を保つ';
COMMENT ON COLUMN racer_series_points.penalty_points IS
    '減点。賞典除外時は99等の特殊値が入る（公式の生値をそのまま保存、意味の解釈はしない）';
COMMENT ON COLUMN racer_series_points.race_grade IS
    'racesテーブルの当該venue_code・当日のrace_grade（SG/G1/G2等）。pointrankページ自体には含まれず、参考情報として別途付与する';

CREATE INDEX IF NOT EXISTS idx_racer_series_points_racer
    ON racer_series_points (racer_id, meet_start_date);
