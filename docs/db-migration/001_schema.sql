-- ============================================================================
-- 龍神レーダー Supabase Schema
-- Version: 1.0.0
-- Created: 2026-01-05
-- ============================================================================

-- ============================================================================
-- PHASE 1: コアテーブル
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1 会場マスタ
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venues (
    code SMALLINT PRIMARY KEY,
    name VARCHAR(20) NOT NULL,

    -- 水面特性
    water_type VARCHAR(10),                    -- 'fresh', 'sea', 'brackish'

    -- 分析用クラスタ（定期更新）
    cluster VARCHAR(20),                       -- 'in_strong', 'out_strong', 'balanced'

    -- 統計情報（90日ローリング）
    avg_first_win_rate DECIMAL(5,4),
    avg_volatility_score DECIMAL(5,2),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会場マスタ初期データ
INSERT INTO venues (code, name, water_type) VALUES
    (1, '桐生', 'fresh'),
    (2, '戸田', 'fresh'),
    (3, '江戸川', 'brackish'),
    (4, '平和島', 'sea'),
    (5, '多摩川', 'fresh'),
    (6, '浜名湖', 'brackish'),
    (7, '蒲郡', 'sea'),
    (8, '常滑', 'sea'),
    (9, '津', 'sea'),
    (10, '三国', 'fresh'),
    (11, 'びわこ', 'fresh'),
    (12, '住之江', 'sea'),
    (13, '尼崎', 'sea'),
    (14, '鳴門', 'sea'),
    (15, '丸亀', 'sea'),
    (16, '児島', 'sea'),
    (17, '宮島', 'sea'),
    (18, '徳山', 'sea'),
    (19, '下関', 'sea'),
    (20, '若松', 'sea'),
    (21, '芦屋', 'sea'),
    (22, '福岡', 'sea'),
    (23, '唐津', 'sea'),
    (24, '大村', 'sea')
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.2 レース情報
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS races (
    race_id VARCHAR(20) PRIMARY KEY,           -- '2026-01-04-01-01' 形式

    -- 基本情報
    race_date DATE NOT NULL,
    venue_code SMALLINT NOT NULL REFERENCES venues(code),
    race_number SMALLINT NOT NULL,             -- 1-12
    start_time TIME,

    -- ボラティリティ
    volatility_score SMALLINT,                 -- 0-100
    volatility_level VARCHAR(10),              -- 'low', 'medium', 'high'
    recommended_model VARCHAR(50),
    volatility_reasons JSONB,

    -- 1号艇情報（分析用に非正規化）
    first_boat_grade VARCHAR(5),
    first_boat_win_rate DECIMAL(5,3),
    first_boat_motor_2rate DECIMAL(5,2),

    -- 選手間の実力差
    win_rate_stddev DECIMAL(5,3),
    win_rate_avg DECIMAL(5,3),
    motor_2rate_stddev DECIMAL(5,2),

    -- メタ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(race_date, venue_code, race_number)
);

CREATE INDEX IF NOT EXISTS idx_races_date ON races(race_date);
CREATE INDEX IF NOT EXISTS idx_races_venue ON races(venue_code);
CREATE INDEX IF NOT EXISTS idx_races_volatility ON races(volatility_score);
CREATE INDEX IF NOT EXISTS idx_races_date_venue ON races(race_date, venue_code);

-- ----------------------------------------------------------------------------
-- 1.3 出走選手情報
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS race_entries (
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    boat_number SMALLINT NOT NULL,             -- 1-6

    -- 選手情報
    racer_id INTEGER,                          -- 選手登録番号（4桁）
    player_name VARCHAR(50),
    grade VARCHAR(5),
    age SMALLINT,

    -- 成績情報
    win_rate DECIMAL(5,3),
    local_win_rate DECIMAL(5,3),
    global_2rate DECIMAL(5,2),             -- 全国2連率
    local_2rate DECIMAL(5,2),              -- 当地2連率
    global_3rate DECIMAL(5,2),             -- 全国3連率
    local_3rate DECIMAL(5,2),              -- 当地3連率

    -- 機材情報
    motor_number SMALLINT,
    motor_2rate DECIMAL(5,2),
    motor_3rate DECIMAL(5,2),              -- モーター3連率
    boat_number_id SMALLINT,
    boat_2rate DECIMAL(5,2),
    boat_3rate DECIMAL(5,2),               -- ボート3連率

    -- AIスコア（モデル別）
    ai_score_standard INTEGER,
    ai_score_safe_bet INTEGER,
    ai_score_upset_focus INTEGER,

    PRIMARY KEY (race_id, boat_number)
);

CREATE INDEX IF NOT EXISTS idx_entries_race ON race_entries(race_id);

-- ----------------------------------------------------------------------------
-- 1.4 モデルマスタ
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS models (
    model_id VARCHAR(50) PRIMARY KEY,

    -- 基本情報
    display_name VARCHAR(100),
    description TEXT,
    model_type VARCHAR(20),                    -- 'standard', 'safe', 'upset', 'venue_specific'

    -- バージョン管理
    version VARCHAR(20),
    parent_model_id VARCHAR(50) REFERENCES models(model_id),

    -- 対象範囲
    target_venues SMALLINT[],
    target_volatility_min SMALLINT,
    target_volatility_max SMALLINT,

    -- 学習情報
    trained_at TIMESTAMPTZ,
    training_data_from DATE,
    training_data_to DATE,
    training_race_count INTEGER,

    -- パラメータ
    hyperparameters JSONB,
    feature_list JSONB,

    -- 状態
    status VARCHAR(20) DEFAULT 'development',  -- 'development', 'shadow', 'production', 'retired'
    is_public BOOLEAN DEFAULT FALSE,

    -- 実績サマリー
    total_predictions INTEGER DEFAULT 0,
    hit_rate_win DECIMAL(5,4),
    recovery_rate_win DECIMAL(5,4),
    last_evaluated_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初期モデル登録
INSERT INTO models (model_id, display_name, model_type, status, is_public) VALUES
    ('standard', 'スタンダード', 'standard', 'production', TRUE),
    ('safeBet', '本命狙い', 'safe', 'production', TRUE),
    ('upsetFocus', '穴狙い', 'upset', 'production', TRUE)
ON CONFLICT (model_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.5 予測情報
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS predictions (
    prediction_id SERIAL PRIMARY KEY,

    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    model_id VARCHAR(50) NOT NULL REFERENCES models(model_id),

    -- 予測内容
    top_pick SMALLINT NOT NULL,
    top_2nd SMALLINT,
    top_3rd SMALLINT,
    confidence SMALLINT,

    -- 詳細スコア
    scores JSONB,
    feature_contributions JSONB,

    -- 結果照合（トリガーで自動更新）
    is_hit_win BOOLEAN,
    is_hit_place BOOLEAN,
    is_hit_trifecta BOOLEAN,
    is_hit_trio BOOLEAN,

    -- 配当
    payout_win INTEGER,
    payout_place INTEGER,
    payout_trifecta INTEGER,
    payout_trio INTEGER,

    -- メタ
    is_shadow BOOLEAN DEFAULT FALSE,
    predicted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predictions_race ON predictions(race_id);
CREATE INDEX IF NOT EXISTS idx_predictions_model ON predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_predictions_race_model ON predictions(race_id, model_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_unique
    ON predictions(race_id, model_id) WHERE is_shadow = FALSE;

-- ----------------------------------------------------------------------------
-- 1.6 レース結果
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS race_results (
    race_id VARCHAR(20) PRIMARY KEY REFERENCES races(race_id) ON DELETE CASCADE,

    -- 着順
    rank1 SMALLINT NOT NULL,
    rank2 SMALLINT NOT NULL,
    rank3 SMALLINT NOT NULL,

    -- 配当
    payout_win INTEGER,
    payout_place_1 INTEGER,
    payout_place_2 INTEGER,
    payout_trifecta INTEGER,
    payout_trio INTEGER,

    -- レース状況
    is_cancelled BOOLEAN DEFAULT FALSE,
    is_no_race BOOLEAN DEFAULT FALSE,

    -- 進入コース（結果確定後）
    course_1 SMALLINT,
    course_2 SMALLINT,
    course_3 SMALLINT,
    course_4 SMALLINT,
    course_5 SMALLINT,
    course_6 SMALLINT,

    -- 決まり手
    winning_technique VARCHAR(20),

    result_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_rank1 ON race_results(rank1);

-- ============================================================================
-- PHASE 2: 拡張テーブル（天候・オッズ・展示）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 レース条件（天候・グレード）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS race_conditions (
    race_id VARCHAR(20) PRIMARY KEY REFERENCES races(race_id) ON DELETE CASCADE,

    -- 天候
    weather VARCHAR(10),
    wind_direction VARCHAR(10),
    wind_speed DECIMAL(4,1),
    wave_height SMALLINT,
    temperature DECIMAL(4,1),
    water_temperature DECIMAL(4,1),

    -- グレード
    race_grade VARCHAR(10),                    -- 'SG', 'G1', 'G2', 'G3', 'ippan'
    race_title VARCHAR(100),

    -- 節情報
    series_day SMALLINT,
    is_final_day BOOLEAN,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2.2 オッズ情報
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS race_odds (
    race_id VARCHAR(20) REFERENCES races(race_id) ON DELETE CASCADE,
    captured_at TIMESTAMPTZ,

    -- 単勝オッズ
    odds_win_1 DECIMAL(6,1),
    odds_win_2 DECIMAL(6,1),
    odds_win_3 DECIMAL(6,1),
    odds_win_4 DECIMAL(6,1),
    odds_win_5 DECIMAL(6,1),
    odds_win_6 DECIMAL(6,1),

    -- 3連単人気上位
    trifecta_popular_1 VARCHAR(10),
    trifecta_odds_1 DECIMAL(8,1),
    trifecta_popular_2 VARCHAR(10),
    trifecta_odds_2 DECIMAL(8,1),
    trifecta_popular_3 VARCHAR(10),
    trifecta_odds_3 DECIMAL(8,1),

    PRIMARY KEY (race_id, captured_at)
);

-- ----------------------------------------------------------------------------
-- 2.3 展示情報
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exhibition_data (
    race_id VARCHAR(20) REFERENCES races(race_id) ON DELETE CASCADE,
    boat_number SMALLINT,

    exhibition_time DECIMAL(5,2),
    start_timing DECIMAL(4,2),

    PRIMARY KEY (race_id, boat_number)
);

-- ============================================================================
-- PHASE 3: 賭け推奨・集計テーブル
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3.1 フィルタ条件マスタ
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bet_filters (
    filter_id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    model_id VARCHAR(50) REFERENCES models(model_id),

    conditions JSONB NOT NULL,

    -- 実績
    total_races INTEGER DEFAULT 0,
    hit_count INTEGER DEFAULT 0,
    total_payout INTEGER DEFAULT 0,
    recovery_rate DECIMAL(5,4),

    -- 有効期間
    valid_from DATE,
    valid_to DATE,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3.2 賭け推奨判定
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bet_recommendations (
    race_id VARCHAR(20) REFERENCES races(race_id) ON DELETE CASCADE,
    model_id VARCHAR(50) REFERENCES models(model_id),

    recommendation VARCHAR(20) NOT NULL,       -- 'strong_bet', 'bet', 'neutral', 'skip'
    reasons JSONB,
    filter_id INTEGER REFERENCES bet_filters(filter_id),

    expected_value DECIMAL(8,2),
    expected_hit_rate DECIMAL(5,4),
    expected_payout INTEGER,

    actual_hit BOOLEAN,
    actual_payout INTEGER,

    recommendation_score DECIMAL(5,2),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (race_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_bet_rec_recommendation ON bet_recommendations(recommendation);
CREATE INDEX IF NOT EXISTS idx_bet_rec_model ON bet_recommendations(model_id);

-- ----------------------------------------------------------------------------
-- 3.3 日次集計
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_bet_summary (
    date DATE,
    model_id VARCHAR(50) REFERENCES models(model_id),

    -- 全レース
    all_races INTEGER,
    all_hits INTEGER,
    all_payout INTEGER,
    all_recovery_rate DECIMAL(5,4),

    -- 推奨レース
    recommended_races INTEGER,
    recommended_hits INTEGER,
    recommended_payout INTEGER,
    recommended_recovery_rate DECIMAL(5,4),

    -- スキップレース
    skipped_races INTEGER,
    skipped_hits INTEGER,
    skipped_payout INTEGER,
    skipped_recovery_rate DECIMAL(5,4),

    -- 効果
    recovery_improvement DECIMAL(5,4),
    profit_if_all INTEGER,
    profit_if_recommended INTEGER,

    PRIMARY KEY (date, model_id)
);

-- ----------------------------------------------------------------------------
-- 3.4 ユーザー公開用サマリー
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_visible_summary (
    summary_id SERIAL PRIMARY KEY,

    period_type VARCHAR(20),                   -- 'daily', 'weekly', 'monthly', 'all_time'
    period_start DATE,
    period_end DATE,
    model_id VARCHAR(50) REFERENCES models(model_id),

    -- 全レース
    all_total INTEGER,
    all_hit_rate DECIMAL(5,4),
    all_recovery_rate DECIMAL(5,4),

    -- 推奨レース
    rec_total INTEGER,
    rec_hit_rate DECIMAL(5,4),
    rec_recovery_rate DECIMAL(5,4),
    rec_avg_payout INTEGER,

    -- 収支
    rec_profit INTEGER,
    rec_profit_rate DECIMAL(5,4),
    skip_saved INTEGER,

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_summary_unique
    ON user_visible_summary(period_type, period_start, period_end, model_id);

-- ----------------------------------------------------------------------------
-- 3.5 モデル日次パフォーマンス
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_performance_daily (
    model_id VARCHAR(50) REFERENCES models(model_id),
    date DATE,

    total_predictions INTEGER,
    win_hits INTEGER,
    place_hits INTEGER,
    trifecta_hits INTEGER,

    investment INTEGER,
    payout_win INTEGER,
    payout_trifecta INTEGER,
    recovery_rate_win DECIMAL(5,4),
    recovery_rate_trifecta DECIMAL(5,4),

    by_venue JSONB,
    by_volatility JSONB,

    PRIMARY KEY (model_id, date)
);

-- ----------------------------------------------------------------------------
-- 3.6 A/Bテスト管理
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_experiments (
    experiment_id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    description TEXT,

    control_model_id VARCHAR(50) REFERENCES models(model_id),
    treatment_model_id VARCHAR(50) REFERENCES models(model_id),

    start_date DATE,
    end_date DATE,

    control_predictions INTEGER,
    control_hit_rate DECIMAL(5,4),
    control_recovery_rate DECIMAL(5,4),
    treatment_predictions INTEGER,
    treatment_hit_rate DECIMAL(5,4),
    treatment_recovery_rate DECIMAL(5,4),

    p_value DECIMAL(6,5),
    is_significant BOOLEAN,
    conclusion VARCHAR(20),
    notes TEXT,

    status VARCHAR(20) DEFAULT 'running',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 予測パフォーマンス詳細ビュー
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_prediction_performance AS
SELECT
    p.prediction_id,
    p.race_id,
    p.model_id,
    m.display_name AS model_name,
    r.race_date,
    r.venue_code,
    v.name AS venue_name,
    v.cluster AS venue_cluster,
    r.race_number,
    r.volatility_score,
    r.volatility_level,
    p.top_pick,
    p.confidence,
    res.rank1 AS actual_winner,

    p.is_hit_win,
    p.is_hit_place,
    p.is_hit_trifecta,
    p.payout_win,
    p.payout_trifecta,

    CASE
        WHEN r.race_number <= 4 THEN 'early'
        WHEN r.race_number <= 8 THEN 'mid'
        ELSE 'late'
    END AS race_period,

    r.first_boat_grade,
    r.first_boat_win_rate

FROM predictions p
JOIN races r ON p.race_id = r.race_id
JOIN venues v ON r.venue_code = v.code
JOIN models m ON p.model_id = m.model_id
LEFT JOIN race_results res ON p.race_id = res.race_id
WHERE p.is_shadow = FALSE;

-- ----------------------------------------------------------------------------
-- 本番モデルビュー
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_production_models AS
SELECT * FROM models
WHERE status = 'production' AND is_public = TRUE;

-- ----------------------------------------------------------------------------
-- 今日の推奨レースビュー
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_todays_recommendations AS
SELECT
    r.race_id,
    v.name AS venue,
    r.race_number,
    r.start_time,
    r.volatility_score,
    r.volatility_level,

    m.display_name AS model_name,
    p.top_pick,
    p.confidence,

    br.recommendation,
    br.reasons,
    br.expected_value,
    br.expected_hit_rate,
    br.recommendation_score,

    res.rank1 AS actual_winner,
    br.actual_hit,
    br.actual_payout

FROM races r
JOIN venues v ON r.venue_code = v.code
JOIN predictions p ON r.race_id = p.race_id AND p.is_shadow = FALSE
JOIN models m ON p.model_id = m.model_id
LEFT JOIN bet_recommendations br ON r.race_id = br.race_id AND p.model_id = br.model_id
LEFT JOIN race_results res ON r.race_id = res.race_id
WHERE r.race_date = CURRENT_DATE
  AND m.status = 'production'
  AND m.is_public = TRUE
ORDER BY br.recommendation_score DESC NULLS LAST, r.start_time;

-- ----------------------------------------------------------------------------
-- パフォーマンス比較ビュー
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_performance_comparison AS
SELECT
    model_id,
    period_type,
    period_start,
    period_end,

    all_total,
    ROUND(all_hit_rate * 100, 1) AS all_hit_rate_pct,
    ROUND(all_recovery_rate * 100, 1) AS all_recovery_rate_pct,

    rec_total,
    ROUND(rec_hit_rate * 100, 1) AS rec_hit_rate_pct,
    ROUND(rec_recovery_rate * 100, 1) AS rec_recovery_rate_pct,

    ROUND((rec_recovery_rate - all_recovery_rate) * 100, 1) AS improvement_pct,
    rec_profit

FROM user_visible_summary
ORDER BY period_start DESC;

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 予測結果の自動更新トリガー
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_prediction_results()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE predictions p
    SET
        is_hit_win = (p.top_pick = NEW.rank1),
        is_hit_place = (p.top_pick IN (NEW.rank1, NEW.rank2)),
        is_hit_trifecta = (
            ARRAY[p.top_pick, p.top_2nd, p.top_3rd]::SMALLINT[]
            @> ARRAY[NEW.rank1, NEW.rank2, NEW.rank3]::SMALLINT[]
        ),
        is_hit_trio = (
            p.top_pick = NEW.rank1
            AND p.top_2nd = NEW.rank2
            AND p.top_3rd = NEW.rank3
        ),
        payout_win = CASE WHEN p.top_pick = NEW.rank1 THEN NEW.payout_win ELSE NULL END,
        payout_place = CASE
            WHEN p.top_pick = NEW.rank1 THEN NEW.payout_place_1
            WHEN p.top_pick = NEW.rank2 THEN NEW.payout_place_2
            ELSE NULL
        END,
        payout_trifecta = CASE
            WHEN ARRAY[p.top_pick, p.top_2nd, p.top_3rd]::SMALLINT[]
                 @> ARRAY[NEW.rank1, NEW.rank2, NEW.rank3]::SMALLINT[]
            THEN NEW.payout_trifecta
            ELSE NULL
        END,
        payout_trio = CASE
            WHEN p.top_pick = NEW.rank1 AND p.top_2nd = NEW.rank2 AND p.top_3rd = NEW.rank3
            THEN NEW.payout_trio
            ELSE NULL
        END
    WHERE p.race_id = NEW.race_id;

    -- bet_recommendationsも更新
    UPDATE bet_recommendations br
    SET
        actual_hit = (
            SELECT is_hit_win FROM predictions p
            WHERE p.race_id = br.race_id AND p.model_id = br.model_id AND p.is_shadow = FALSE
            LIMIT 1
        ),
        actual_payout = (
            SELECT payout_win FROM predictions p
            WHERE p.race_id = br.race_id AND p.model_id = br.model_id AND p.is_shadow = FALSE
            LIMIT 1
        )
    WHERE br.race_id = NEW.race_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_predictions ON race_results;
CREATE TRIGGER trg_update_predictions
AFTER INSERT OR UPDATE ON race_results
FOR EACH ROW
EXECUTE FUNCTION update_prediction_results();

-- ----------------------------------------------------------------------------
-- 会場統計更新関数
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_venue_stats()
RETURNS void AS $$
BEGIN
    UPDATE venues v
    SET
        avg_first_win_rate = subq.first_win_rate,
        avg_volatility_score = subq.avg_vol,
        cluster = CASE
            WHEN subq.first_win_rate >= 0.60 THEN 'in_strong'
            WHEN subq.first_win_rate < 0.50 THEN 'out_strong'
            ELSE 'balanced'
        END,
        updated_at = NOW()
    FROM (
        SELECT
            r.venue_code,
            AVG(CASE WHEN res.rank1 = 1 THEN 1.0 ELSE 0.0 END) AS first_win_rate,
            AVG(r.volatility_score) AS avg_vol
        FROM races r
        JOIN race_results res ON r.race_id = res.race_id
        WHERE r.race_date >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY r.venue_code
    ) subq
    WHERE v.code = subq.venue_code;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (Supabase用)
-- ============================================================================

-- 読み取り専用の公開アクセスを許可
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE races ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_visible_summary ENABLE ROW LEVEL SECURITY;

-- 公開読み取りポリシー
CREATE POLICY "Public read access" ON venues FOR SELECT USING (true);
CREATE POLICY "Public read access" ON races FOR SELECT USING (true);
CREATE POLICY "Public read access" ON race_entries FOR SELECT USING (true);
CREATE POLICY "Public read access" ON predictions FOR SELECT USING (is_shadow = FALSE);
CREATE POLICY "Public read access" ON race_results FOR SELECT USING (true);
CREATE POLICY "Public read access" ON models FOR SELECT USING (is_public = TRUE);
CREATE POLICY "Public read access" ON bet_recommendations FOR SELECT USING (true);
CREATE POLICY "Public read access" ON user_visible_summary FOR SELECT USING (true);
