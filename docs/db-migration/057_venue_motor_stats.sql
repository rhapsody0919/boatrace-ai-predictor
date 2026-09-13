-- BOA-264: 会場公式サイトが公開しているモーター成績（節数・出走回数・優出回数・
-- 優勝回数・1着率等）を会場ごとに取得・保存するテーブル。
--
-- 全24会場のうち戸田・平和島は該当データ自体が存在しないため対象外。残り22会場は
-- 7系統のテンプレートに分かれ、会場によって取得できる列が異なるため全列NULL許容。
--
-- 「モーター成績」と「ボート成績」は別々の物理機材（別番号体系）のため、モーター側に
-- 出走回数等が無い会場（常滑・津・三国等）でもボート側の値を代用してはいけない
-- （代用すると別物の機材の出走回数をモーターの出走回数として誤表示することになる）。
-- このテーブルはモーター由来のデータのみを対象とする。
--
-- scraped_date を主キーに含めることで、節数・出走回数の推移を後から見たくなった場合に
-- 対応できる（現時点でのUIは最新1件のみ参照する想定）。

CREATE TABLE IF NOT EXISTS venue_motor_stats (
  venue_code SMALLINT NOT NULL,
  motor_number SMALLINT NOT NULL,
  scraped_date DATE NOT NULL,

  meet_count SMALLINT,              -- 節数
  race_count SMALLINT,              -- 出走回数（抽選後の通算出走数）
  final_count SMALLINT,             -- 優出回数
  championship_count SMALLINT,      -- 優勝回数
  first_place_count SMALLINT,       -- 1着数
  second_place_count SMALLINT,      -- 2着数
  third_place_count SMALLINT,       -- 3着数
  win_rate DECIMAL(4,2),            -- 勝率
  top2_rate DECIMAL(5,2),           -- 2連対率
  top3_rate DECIMAL(5,2),           -- 3連対率
  accident_rate DECIMAL(5,2),       -- 事故率
  best_time DECIMAL(5,2),           -- 最高タイム(1800m)
  avg_exhibition_time DECIMAL(5,2), -- 平均展示タイム（下関/motordata型のみ）
  stats_period_start DATE,          -- 算出期間の開始（大村等、期間明示型のみ）
  stats_period_end DATE,            -- 算出期間の終了

  source_template TEXT NOT NULL,    -- どのテンプレート系統で取得したか（後述の定数参照）

  PRIMARY KEY (venue_code, motor_number, scraped_date)
);

CREATE INDEX IF NOT EXISTS idx_venue_motor_stats_latest
ON venue_motor_stats (venue_code, motor_number, scraped_date DESC);
