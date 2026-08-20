# 龍神レーダー Supabase移行 要件定義書

## 1. 概要

### 1.1 目的
- JSONファイルベースのデータ管理からSupabase（PostgreSQL）への移行
- 3ヶ月後のモデル作成・チューニングに向けたデータ蓄積基盤の構築
- 統計分析に最適化されたテーブル構造の設計

### 1.2 目標
- 回収率100%超えを実現するための「賭ける/見送る」判定ロジックの基盤
- 会場別・条件別のパフォーマンス分析が容易な構造
- 将来の機械学習モデル構築に対応したデータ設計

### 1.3 想定データ量（3ヶ月後）
| テーブル | 推定レコード数 |
|---------|---------------|
| races | 約10,000件（1日約110レース × 90日）|
| race_entries | 約60,000件（レース × 6選手）|
| predictions | 約30,000件（レース × 3モデル）|
| race_results | 約10,000件 |

---

## 2. テーブル設計

### 2.1 ER図（概念）

```
┌─────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   venues    │       │     races       │       │  race_results   │
│─────────────│       │─────────────────│       │─────────────────│
│ code (PK)   │◄──────│ venue_code (FK) │───────│ race_id (FK,PK) │
│ name        │       │ race_id (PK)    │       │ rank1           │
│ cluster     │       │ race_date       │       │ rank2           │
│ first_win_% │       │ race_number     │       │ rank3           │
└─────────────┘       │ volatility_score│       │ payout_win      │
                      │ volatility_level│       │ payout_place    │
                      │ start_time      │       │ payout_trifecta │
                      └─────────────────┘       │ payout_trio     │
                              │                 └─────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌─────────────────┐ ┌─────────────────┐
    │  race_entries   │ │   predictions   │
    │─────────────────│ │─────────────────│
    │ race_id (FK)    │ │ race_id (FK)    │
    │ boat_number     │ │ model_type      │
    │ player_name     │ │ top_pick        │
    │ grade           │ │ top3            │
    │ win_rate        │ │ confidence      │
    │ motor_2rate     │ │ ai_scores       │
    │ ai_score        │ │ is_hit_win      │
    └─────────────────┘ │ is_hit_place    │
                        │ is_hit_trifecta │
                        │ recovery_win    │
                        └─────────────────┘
```

---

### 2.2 テーブル定義

#### 2.2.1 venues（会場マスタ）

```sql
CREATE TABLE venues (
    code SMALLINT PRIMARY KEY,          -- 1-24
    name VARCHAR(20) NOT NULL,          -- 桐生, 戸田, etc.

    -- 分析用クラスタ情報
    cluster VARCHAR(20),                -- 'out_strong', 'in_strong', 'balanced'
    water_type VARCHAR(10),             -- 'fresh', 'sea', 'brackish'

    -- 統計情報（定期更新）
    avg_first_win_rate DECIMAL(5,4),    -- 過去90日の1号艇勝率
    avg_volatility_score DECIMAL(5,2),  -- 平均ボラティリティ

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初期データ
INSERT INTO venues (code, name, water_type) VALUES
(1, '桐生', 'fresh'), (2, '戸田', 'fresh'), (3, '江戸川', 'brackish'),
(4, '平和島', 'sea'), (5, '多摩川', 'fresh'), (6, '浜名湖', 'brackish'),
(7, '蒲郡', 'sea'), (8, '常滑', 'sea'), (9, '津', 'sea'),
(10, '三国', 'fresh'), (11, 'びわこ', 'fresh'), (12, '住之江', 'sea'),
(13, '尼崎', 'sea'), (14, '鳴門', 'sea'), (15, '丸亀', 'sea'),
(16, '児島', 'sea'), (17, '宮島', 'sea'), (18, '徳山', 'sea'),
(19, '下関', 'sea'), (20, '若松', 'sea'), (21, '芦屋', 'sea'),
(22, '福岡', 'sea'), (23, '唐津', 'sea'), (24, '大村', 'sea');
```

#### 2.2.2 races（レース情報）

```sql
CREATE TABLE races (
    -- 主キー
    race_id VARCHAR(20) PRIMARY KEY,    -- '2026-01-04-01-01' 形式

    -- 基本情報
    race_date DATE NOT NULL,
    venue_code SMALLINT NOT NULL REFERENCES venues(code),
    race_number SMALLINT NOT NULL,      -- 1-12
    start_time TIME,

    -- ボラティリティ情報（分析の要）
    volatility_score SMALLINT,          -- 0-100
    volatility_level VARCHAR(10),       -- 'low', 'medium', 'high'
    recommended_model VARCHAR(20),      -- 'standard', 'safeBet', 'upsetFocus'
    volatility_reasons JSONB,           -- 理由の配列

    -- 1号艇情報（分析用に非正規化）
    first_boat_grade VARCHAR(5),        -- 'A1', 'A2', 'B1', 'B2'
    first_boat_win_rate DECIMAL(5,3),   -- 勝率
    first_boat_motor_2rate DECIMAL(5,2),-- モーター2連率

    -- 選手間の実力差（分析用に計算済み）
    win_rate_stddev DECIMAL(5,3),       -- 勝率の標準偏差
    win_rate_avg DECIMAL(5,3),          -- 勝率の平均
    motor_2rate_stddev DECIMAL(5,2),    -- モーター2連率の標準偏差

    -- メタ情報
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- 制約
    UNIQUE(race_date, venue_code, race_number)
);

-- インデックス（分析クエリ用）
CREATE INDEX idx_races_date ON races(race_date);
CREATE INDEX idx_races_venue ON races(venue_code);
CREATE INDEX idx_races_volatility ON races(volatility_score);
CREATE INDEX idx_races_date_venue ON races(race_date, venue_code);
CREATE INDEX idx_races_analysis ON races(venue_code, volatility_level, race_number);
```

#### 2.2.3 race_entries（出走選手情報）

```sql
CREATE TABLE race_entries (
    -- 主キー
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    boat_number SMALLINT NOT NULL,      -- 1-6

    -- 選手情報
    player_name VARCHAR(50),
    grade VARCHAR(5),                   -- 'A1', 'A2', 'B1', 'B2'
    age SMALLINT,

    -- 成績情報
    win_rate DECIMAL(5,3),              -- 全国勝率
    local_win_rate DECIMAL(5,3),        -- 当地勝率

    -- 機材情報
    motor_number SMALLINT,
    motor_2rate DECIMAL(5,2),           -- モーター2連率
    boat_number_id SMALLINT,            -- ボート番号
    boat_2rate DECIMAL(5,2),            -- ボート2連率

    -- AI評価（モデル別に異なる可能性があるが、standardのスコアを基準に）
    ai_score_standard INTEGER,
    ai_score_safe_bet INTEGER,
    ai_score_upset_focus INTEGER,

    PRIMARY KEY (race_id, boat_number)
);

-- インデックス
CREATE INDEX idx_entries_race ON race_entries(race_id);
CREATE INDEX idx_entries_grade ON race_entries(grade);
```

#### 2.2.4 predictions（予測情報）

```sql
CREATE TYPE model_type AS ENUM ('standard', 'safeBet', 'upsetFocus');

CREATE TABLE predictions (
    -- 主キー
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    model model_type NOT NULL,

    -- 予測内容
    top_pick SMALLINT NOT NULL,         -- 1着予想の艇番
    top_2nd SMALLINT,                   -- 2着予想
    top_3rd SMALLINT,                   -- 3着予想
    confidence SMALLINT,                -- 信頼度 0-100

    -- 結果との照合（race_resultsから自動計算）
    is_hit_win BOOLEAN,                 -- 単勝的中
    is_hit_place BOOLEAN,               -- 複勝的中（2着以内）
    is_hit_trifecta BOOLEAN,            -- 3連複的中
    is_hit_trio BOOLEAN,                -- 3連単的中

    -- 回収情報（100円賭けた場合）
    payout_win INTEGER,                 -- 単勝配当（的中時のみ）
    payout_place INTEGER,               -- 複勝配当
    payout_trifecta INTEGER,            -- 3連複配当
    payout_trio INTEGER,                -- 3連単配当

    -- 期待値計算用（将来の拡張）
    expected_value_win DECIMAL(8,2),    -- 期待値（単勝）

    PRIMARY KEY (race_id, model)
);

-- インデックス（分析クエリ用）
CREATE INDEX idx_predictions_model ON predictions(model);
CREATE INDEX idx_predictions_hit ON predictions(model, is_hit_win);
CREATE INDEX idx_predictions_pick ON predictions(model, top_pick);
```

#### 2.2.5 race_results（レース結果）

```sql
CREATE TABLE race_results (
    -- 主キー
    race_id VARCHAR(20) PRIMARY KEY REFERENCES races(race_id) ON DELETE CASCADE,

    -- 着順
    rank1 SMALLINT NOT NULL,            -- 1着艇番
    rank2 SMALLINT NOT NULL,            -- 2着艇番
    rank3 SMALLINT NOT NULL,            -- 3着艇番

    -- 配当金
    payout_win INTEGER,                 -- 単勝配当
    payout_place_1 INTEGER,             -- 複勝1着配当
    payout_place_2 INTEGER,             -- 複勝2着配当
    payout_trifecta INTEGER,            -- 3連複配当
    payout_trio INTEGER,                -- 3連単配当

    -- レース状況
    is_cancelled BOOLEAN DEFAULT FALSE, -- 中止
    is_no_race BOOLEAN DEFAULT FALSE,   -- 不成立

    result_at TIMESTAMPTZ,              -- 確定時刻
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_results_rank1 ON race_results(rank1);
```

---

### 2.3 分析用ビュー

#### 2.3.1 予測パフォーマンス詳細ビュー

```sql
CREATE VIEW v_prediction_performance AS
SELECT
    p.race_id,
    p.model,
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

    -- 的中判定
    p.is_hit_win,
    p.is_hit_place,
    p.is_hit_trifecta,
    p.is_hit_trio,

    -- 配当
    p.payout_win,
    p.payout_trifecta,

    -- 分析用カラム
    CASE
        WHEN r.race_number <= 4 THEN 'early'
        WHEN r.race_number <= 8 THEN 'mid'
        ELSE 'late'
    END AS race_period,

    CASE
        WHEN r.volatility_score >= 70 THEN 'high'
        WHEN r.volatility_score >= 40 THEN 'medium'
        ELSE 'low'
    END AS volatility_bucket,

    -- 1号艇関連
    r.first_boat_grade,
    r.first_boat_win_rate

FROM predictions p
JOIN races r ON p.race_id = r.race_id
JOIN venues v ON r.venue_code = v.code
LEFT JOIN race_results res ON p.race_id = res.race_id
WHERE res.race_id IS NOT NULL;
```

#### 2.3.2 会場×条件別サマリービュー

```sql
CREATE VIEW v_venue_condition_stats AS
SELECT
    venue_code,
    venue_name,
    model,
    volatility_level,
    race_period,

    COUNT(*) AS total_races,
    SUM(CASE WHEN is_hit_win THEN 1 ELSE 0 END) AS win_hits,
    AVG(CASE WHEN is_hit_win THEN 1.0 ELSE 0.0 END) AS hit_rate,
    AVG(COALESCE(payout_win, 0)) AS avg_payout,
    SUM(COALESCE(payout_win, 0))::DECIMAL / (COUNT(*) * 100) AS recovery_rate

FROM v_prediction_performance
GROUP BY venue_code, venue_name, model, volatility_level, race_period;
```

#### 2.3.3 予測艇番別パフォーマンスビュー

```sql
CREATE VIEW v_pick_performance AS
SELECT
    model,
    top_pick,
    volatility_level,

    COUNT(*) AS total_predictions,
    SUM(CASE WHEN is_hit_win THEN 1 ELSE 0 END) AS hits,
    AVG(CASE WHEN is_hit_win THEN 1.0 ELSE 0.0 END) AS hit_rate,
    AVG(CASE WHEN is_hit_win THEN payout_win ELSE NULL END) AS avg_payout_when_hit,
    SUM(COALESCE(payout_win, 0))::DECIMAL / (COUNT(*) * 100) AS recovery_rate

FROM v_prediction_performance
GROUP BY model, top_pick, volatility_level;
```

---

### 2.4 マテリアライズドビュー（ダッシュボード用）

```sql
-- 日次サマリー（高速なダッシュボード表示用）
CREATE MATERIALIZED VIEW mv_daily_summary AS
SELECT
    r.race_date,
    p.model,
    COUNT(*) AS total_races,
    SUM(CASE WHEN p.is_hit_win THEN 1 ELSE 0 END) AS win_hits,
    SUM(CASE WHEN p.is_hit_place THEN 1 ELSE 0 END) AS place_hits,
    SUM(CASE WHEN p.is_hit_trifecta THEN 1 ELSE 0 END) AS trifecta_hits,
    SUM(COALESCE(p.payout_win, 0)) AS total_payout_win,
    SUM(COALESCE(p.payout_trifecta, 0)) AS total_payout_trifecta

FROM predictions p
JOIN races r ON p.race_id = r.race_id
JOIN race_results res ON p.race_id = res.race_id
GROUP BY r.race_date, p.model;

-- リフレッシュ用インデックス
CREATE UNIQUE INDEX idx_mv_daily ON mv_daily_summary(race_date, model);

-- 定期リフレッシュ（cron等で実行）
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_summary;
```

---

## 3. 分析クエリ例

### 3.1 会場×ボラティリティ別の回収率

```sql
SELECT
    v.name AS venue,
    r.volatility_level,
    p.model,
    COUNT(*) AS races,
    ROUND(AVG(CASE WHEN p.is_hit_win THEN 1.0 ELSE 0.0 END) * 100, 1) AS hit_rate,
    ROUND(SUM(COALESCE(p.payout_win, 0))::DECIMAL / (COUNT(*) * 100) * 100, 1) AS recovery_rate
FROM predictions p
JOIN races r ON p.race_id = r.race_id
JOIN venues v ON r.venue_code = v.code
JOIN race_results res ON p.race_id = res.race_id
WHERE p.model = 'upsetFocus'
GROUP BY v.name, r.volatility_level, p.model
HAVING COUNT(*) >= 20
ORDER BY recovery_rate DESC;
```

### 3.2 「賭けるべきレース」の抽出

```sql
-- 回収率100%超が期待できる条件のレースを抽出
SELECT
    r.race_id,
    v.name AS venue,
    r.race_number,
    r.volatility_score,
    p.top_pick,
    p.confidence,

    -- この条件での過去実績
    stats.hit_rate,
    stats.avg_payout,
    stats.recovery_rate

FROM races r
JOIN venues v ON r.venue_code = v.code
JOIN predictions p ON r.race_id = p.race_id AND p.model = 'upsetFocus'
LEFT JOIN race_results res ON r.race_id = res.race_id
LEFT JOIN LATERAL (
    -- 同条件での過去実績を取得
    SELECT
        AVG(CASE WHEN p2.is_hit_win THEN 1.0 ELSE 0.0 END) AS hit_rate,
        AVG(CASE WHEN p2.is_hit_win THEN p2.payout_win ELSE NULL END) AS avg_payout,
        SUM(COALESCE(p2.payout_win, 0))::DECIMAL / NULLIF(COUNT(*) * 100, 0) AS recovery_rate
    FROM predictions p2
    JOIN races r2 ON p2.race_id = r2.race_id
    WHERE p2.model = 'upsetFocus'
      AND r2.venue_code = r.venue_code
      AND r2.volatility_level = r.volatility_level
      AND p2.top_pick = p.top_pick
      AND r2.race_date < r.race_date
) stats ON TRUE

WHERE res.race_id IS NULL  -- まだ結果が出ていないレース
  AND p.top_pick != 6      -- 6号艇予測を除外
  AND r.race_number <= 8   -- 終盤戦を除外
  AND (v.cluster = 'out_strong' OR r.volatility_score >= 70)
ORDER BY stats.recovery_rate DESC NULLS LAST;
```

### 3.3 期待値(EV)計算

```sql
-- 各レースの期待値を計算
SELECT
    r.race_id,
    p.model,
    p.top_pick,

    -- 過去の同条件での的中率
    hist.hit_rate,

    -- 予想配当（過去の同艇番勝利時の平均配当）
    hist.avg_payout,

    -- 期待値 = 的中率 × 配当 - 100円
    ROUND(hist.hit_rate * hist.avg_payout - 100, 0) AS expected_value

FROM races r
JOIN predictions p ON r.race_id = p.race_id
JOIN LATERAL (
    SELECT
        AVG(CASE WHEN p2.is_hit_win THEN 1.0 ELSE 0.0 END) AS hit_rate,
        AVG(CASE WHEN p2.is_hit_win THEN p2.payout_win ELSE NULL END) AS avg_payout
    FROM predictions p2
    JOIN races r2 ON p2.race_id = r2.race_id
    WHERE p2.model = p.model
      AND r2.venue_code = r.venue_code
      AND r2.volatility_level = r.volatility_level
      AND p2.top_pick = p.top_pick
) hist ON TRUE

WHERE hist.hit_rate IS NOT NULL;
```

---

## 4. 関数・トリガー

### 4.1 予測結果の自動更新トリガー

```sql
-- race_results挿入時に、predictionsの的中フラグを自動更新
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
            WHEN (ARRAY[p.top_pick, p.top_2nd, p.top_3rd]::SMALLINT[]
                  @> ARRAY[NEW.rank1, NEW.rank2, NEW.rank3]::SMALLINT[])
            THEN NEW.payout_trifecta
            ELSE NULL
        END
    WHERE p.race_id = NEW.race_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_predictions
AFTER INSERT ON race_results
FOR EACH ROW
EXECUTE FUNCTION update_prediction_results();
```

### 4.2 会場統計の定期更新関数

```sql
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
```

---

## 5. データ移行手順

### 5.1 移行スクリプト（Node.js）

```javascript
// migrate-to-supabase.js（概要）
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function migrateDay(dateStr) {
    const filePath = `public/data/predictions/${dateStr}.json`
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))

    for (const race of data.races) {
        // 1. races テーブル
        await supabase.from('races').upsert({
            race_id: race.raceId,
            race_date: dateStr,
            venue_code: race.venueCode,
            race_number: race.raceNumber,
            volatility_score: race.volatility?.score,
            volatility_level: race.volatility?.level,
            // ...
        })

        // 2. race_entries テーブル
        for (const player of race.predictions.standard.players) {
            await supabase.from('race_entries').upsert({
                race_id: race.raceId,
                boat_number: player.number,
                player_name: player.name,
                // ...
            })
        }

        // 3. predictions テーブル
        for (const [model, pred] of Object.entries(race.predictions)) {
            await supabase.from('predictions').upsert({
                race_id: race.raceId,
                model: model,
                top_pick: pred.topPick,
                // ...
            })
        }

        // 4. race_results テーブル
        if (race.result?.finished) {
            await supabase.from('race_results').upsert({
                race_id: race.raceId,
                rank1: race.result.rank1,
                // ...
            })
        }
    }
}
```

### 5.2 移行チェックリスト

- [ ] Supabaseプロジェクト作成
- [ ] テーブル・ビュー・関数の作成
- [ ] RLS（Row Level Security）ポリシー設定
- [ ] 既存JSONデータの移行
- [ ] 日次バッチ処理の実装（新規データ取得→DB挿入）
- [ ] フロントエンドのデータソース切り替え
- [ ] 旧JSONファイルのバックアップ・削除

---

## 6. 今後の拡張

### 6.1 Phase 2（3ヶ月後）で追加予定

```sql
-- ベット判定テーブル
CREATE TABLE bet_decisions (
    race_id VARCHAR(20) REFERENCES races(race_id),
    model model_type,

    should_bet BOOLEAN,                 -- 賭けるべきか
    decision_reason VARCHAR(100),       -- 判定理由
    expected_value DECIMAL(8,2),        -- 期待値

    -- 結果（実際に賭けた場合）
    actual_bet BOOLEAN DEFAULT FALSE,
    actual_payout INTEGER,

    PRIMARY KEY (race_id, model)
);

-- モデル別フィルタリング条件テーブル
CREATE TABLE model_filters (
    filter_id SERIAL PRIMARY KEY,
    model model_type,

    -- フィルタ条件
    venue_codes SMALLINT[],             -- 対象会場
    volatility_min SMALLINT,
    volatility_max SMALLINT,
    race_number_max SMALLINT,
    excluded_picks SMALLINT[],          -- 除外する予測艇番

    -- このフィルタの実績
    total_races INTEGER,
    recovery_rate DECIMAL(5,4),

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.2 機械学習モデル用の特徴量テーブル

```sql
-- レースごとの特徴量（ML用）
CREATE TABLE race_features (
    race_id VARCHAR(20) PRIMARY KEY REFERENCES races(race_id),

    -- 基本特徴量
    f_venue_code SMALLINT,
    f_race_number SMALLINT,
    f_volatility_score SMALLINT,
    f_first_boat_grade_encoded SMALLINT,  -- A1=4, A2=3, B1=2, B2=1
    f_first_boat_win_rate DECIMAL(5,3),
    f_win_rate_stddev DECIMAL(5,3),

    -- 派生特徴量
    f_venue_cluster_encoded SMALLINT,     -- out_strong=0, balanced=1, in_strong=2
    f_race_period_encoded SMALLINT,       -- early=0, mid=1, late=2
    f_is_high_volatility BOOLEAN,

    -- ターゲット変数
    target_first_boat_won BOOLEAN,
    target_rank1 SMALLINT
);
```

---

## 7. 非機能要件

### 7.1 パフォーマンス
- ダッシュボード表示: 500ms以内
- 分析クエリ: 3秒以内
- データ挿入: 1レースあたり100ms以内

### 7.2 データ保持
- 最低1年分のデータを保持
- 古いデータは月次で集計テーブルに移行可能

### 7.3 バックアップ
- Supabaseの自動バックアップを利用
- 週次でローカルにエクスポート

---

## 8. 補足：現状のJSONからの主な変更点

| 現状（JSON） | 移行後（Supabase） | 理由 |
|-------------|-------------------|------|
| 各モデルのplayers配列が重複 | race_entriesで一元管理 | データ正規化 |
| 日付ごとに別ファイル | 単一テーブルで時系列管理 | クエリ効率 |
| summaryで集計済み | ビューで動的集計 | リアルタイム性 |
| volatility.reasons配列 | JSONB型で保持 | 柔軟性維持 |
| 結果はresultオブジェクト内 | 別テーブルで管理 | 分析効率 |

---

**作成日**: 2026-01-05
**バージョン**: 1.0
**作成者**: Claude Code

---

## 9. 設計評価と改善案（データサイエンティスト視点）

### 9.1 致命的な欠落データ

現在の設計には、モデル構築に**致命的に不足しているデータ**がある。

| 欠落データ | 重要度 | 理由 | 取得可能性 |
|-----------|--------|------|-----------|
| **オッズデータ** | ★★★★★ | 期待値計算の核心。配当予測不可。 | ◎ 公式API/スクレイピング |
| **展示タイム** | ★★★★★ | 当日のモーター調子の最重要指標 | ◎ 公式サイト |
| **スタートタイミング(ST)** | ★★★★★ | スタート力の定量化 | ◎ 公式サイト |
| **天候・風向・風速・波高** | ★★★★☆ | ボートレースは風と波の影響大 | ◎ 公式サイト |
| **レースグレード** | ★★★★☆ | SG/G1/一般で傾向が全く異なる | ◎ 公式サイト |
| **進入コース** | ★★★★☆ | 枠番≠コース番号の場合がある | △ 結果確定後のみ |

### 9.2 追加すべきテーブル

#### 9.2.1 race_conditions（レース条件）

```sql
CREATE TABLE race_conditions (
    race_id VARCHAR(20) PRIMARY KEY REFERENCES races(race_id),
    
    -- 天候
    weather VARCHAR(10),            -- '晴', '曇', '雨', '雪'
    wind_direction VARCHAR(10),     -- '北', '北東', '東', etc.
    wind_speed DECIMAL(4,1),        -- m/s
    wave_height SMALLINT,           -- cm
    temperature DECIMAL(4,1),       -- 気温
    water_temperature DECIMAL(4,1), -- 水温
    
    -- レースグレード
    race_grade VARCHAR(10),         -- 'SG', 'G1', 'G2', 'G3', 'ippan'
    race_title VARCHAR(100),        -- 'グランプリ', '新鋭王座決定戦', etc.
    
    -- 節情報
    series_day SMALLINT,            -- 節の何日目か (1-7)
    is_final_day BOOLEAN,           -- 最終日か
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 9.2.2 race_odds（オッズ情報）

```sql
CREATE TABLE race_odds (
    race_id VARCHAR(20) REFERENCES races(race_id),
    captured_at TIMESTAMPTZ,        -- オッズ取得時刻
    
    -- 単勝オッズ（6艇分）
    odds_win_1 DECIMAL(6,1),
    odds_win_2 DECIMAL(6,1),
    odds_win_3 DECIMAL(6,1),
    odds_win_4 DECIMAL(6,1),
    odds_win_5 DECIMAL(6,1),
    odds_win_6 DECIMAL(6,1),
    
    -- 複勝オッズ（6艇分、上限-下限）
    odds_place_1_min DECIMAL(5,1),
    odds_place_1_max DECIMAL(5,1),
    -- ... 他艇も同様
    
    -- 3連単人気上位（分析用）
    trifecta_popular_1 VARCHAR(10), -- '1-2-3' 形式
    trifecta_odds_1 DECIMAL(8,1),
    trifecta_popular_2 VARCHAR(10),
    trifecta_odds_2 DECIMAL(8,1),
    trifecta_popular_3 VARCHAR(10),
    trifecta_odds_3 DECIMAL(8,1),
    
    PRIMARY KEY (race_id, captured_at)
);

-- 締切直前のオッズを取得するビュー
CREATE VIEW v_final_odds AS
SELECT DISTINCT ON (race_id) *
FROM race_odds
ORDER BY race_id, captured_at DESC;
```

#### 9.2.3 exhibition_data（展示情報）

```sql
CREATE TABLE exhibition_data (
    race_id VARCHAR(20) REFERENCES races(race_id),
    boat_number SMALLINT,
    
    -- 展示タイム
    exhibition_time DECIMAL(5,2),   -- 6.75秒 など
    
    -- スタート展示
    start_timing DECIMAL(4,2),      -- ST 0.12秒 など
    
    -- 周回展示の評価（スクレイピング困難な場合はnull許容）
    turn_evaluation VARCHAR(10),    -- 'A', 'B', 'C' など
    
    PRIMARY KEY (race_id, boat_number)
);

-- race_entriesに展示データを結合したビュー
CREATE VIEW v_entries_with_exhibition AS
SELECT 
    e.*,
    ex.exhibition_time,
    ex.start_timing,
    -- 展示タイムの偏差値（会場別平均との差）
    ex.exhibition_time - venue_avg.avg_time AS exhibition_diff
FROM race_entries e
LEFT JOIN exhibition_data ex ON e.race_id = ex.race_id AND e.boat_number = ex.boat_number
LEFT JOIN LATERAL (
    SELECT AVG(exhibition_time) AS avg_time
    FROM exhibition_data ex2
    JOIN races r ON ex2.race_id = r.race_id
    WHERE r.venue_code = (SELECT venue_code FROM races WHERE race_id = e.race_id)
) venue_avg ON TRUE;
```

#### 9.2.4 player_form（選手直近フォーム）

```sql
CREATE TABLE player_form (
    player_name VARCHAR(50),
    as_of_date DATE,                -- この日時点での成績
    
    -- 直近成績
    recent_10_results SMALLINT[],   -- 直近10走の着順 [1,2,3,1,4,...]
    recent_10_avg DECIMAL(3,2),     -- 直近10走の平均着順
    recent_30_win_rate DECIMAL(5,4),-- 直近30走の勝率
    
    -- トレンド
    form_trend VARCHAR(10),         -- 'up', 'stable', 'down'
    
    PRIMARY KEY (player_name, as_of_date)
);
```

### 9.3 既存テーブルの改善

#### 9.3.1 racesテーブルの拡張

```sql
ALTER TABLE races ADD COLUMN IF NOT EXISTS
    race_grade VARCHAR(10),                    -- 'SG', 'G1', etc.
    series_day SMALLINT,                       -- 節の日目
    is_qualifying BOOLEAN,                     -- 予選か
    is_semifinal BOOLEAN,                      -- 準優か
    is_final BOOLEAN;                          -- 優勝戦か
```

#### 9.3.2 race_resultsテーブルの拡張

```sql
ALTER TABLE race_results ADD COLUMN IF NOT EXISTS
    -- 進入コース（結果確定後に判明）
    course_1 SMALLINT,                         -- 1コースに入った艇番
    course_2 SMALLINT,
    course_3 SMALLINT,
    course_4 SMALLINT,
    course_5 SMALLINT,
    course_6 SMALLINT,
    is_flying BOOLEAN[],                       -- フライングした艇
    is_late_start BOOLEAN[],                   -- 出遅れた艇
    
    -- 決まり手
    winning_technique VARCHAR(20);             -- '逃げ', '差し', 'まくり', etc.
```

### 9.4 改善後のER図

```
┌──────────────┐
│   venues     │
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│    races     │────▶│  race_conditions │     │    race_odds     │
└──────┬───────┘     └──────────────────┘     └──────────────────┘
       │                                              ▲
       ├───────────────┬───────────────┬──────────────┘
       ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ race_entries │ │  predictions │ │ race_results │
└──────┬───────┘ └──────────────┘ └──────────────┘
       │
       ▼
┌──────────────────┐     ┌──────────────────┐
│ exhibition_data  │     │   player_form    │
└──────────────────┘     └──────────────────┘
```

### 9.5 優先度付き実装ロードマップ

```
【Phase 1】必須（移行時に実装）
├── races, race_entries, predictions, race_results（現設計）
├── race_conditions（天候・グレード）★新規
└── 基本的なビュー

【Phase 2】高優先度（1ヶ月以内）
├── race_odds（オッズ取得の仕組み構築）★新規
├── exhibition_data（展示タイム）★新規
└── race_resultsの進入コース拡張

【Phase 3】中優先度（3ヶ月以内）
├── player_form（直近フォーム計算バッチ）★新規
├── 機械学習用特徴量テーブル
└── bet_decisions（賭け判定記録）

【Phase 4】低優先度（必要に応じて）
├── 選手マスタ（コース別成績等）
├── モーター履歴
└── 水面特性詳細
```

### 9.6 データ取得方法の検討

| データ | 取得元 | 方法 | 難易度 |
|--------|--------|------|--------|
| 天候・風 | BOATRACE公式 | スクレイピング | 易 |
| 展示タイム | BOATRACE公式 | スクレイピング | 易 |
| オッズ | BOATRACE公式 | スクレイピング | 中（複数回取得要） |
| レースグレード | BOATRACE公式 | スクレイピング | 易 |
| 進入コース | BOATRACE公式 | 結果ページから | 易 |
| 決まり手 | BOATRACE公式 | 結果ページから | 易 |

### 9.7 期待される効果

```
【オッズデータ追加による効果】
- 真の期待値計算が可能に
- 「人気薄だが勝つ」パターンの検出
- オッズと予測の乖離で妙味発見

【展示データ追加による効果】
- 当日調子の定量化
- モーター2連率より信頼性の高い指標
- 展示タイムと勝率の相関分析

【天候データ追加による効果】
- 風向きと1号艇勝率の相関
- 荒天時の穴狙い精度向上
- 会場×天候の組み合わせ分析

【グレードデータ追加による効果】
- SG/G1は本命決着傾向の定量化
- 一般戦での穴狙い強化
- グレード別の最適モデル選択
```

---

## 10. 結論

### 現設計の評価: **65点 / 100点**

**良い点:**
- 基本的なテーブル設計は分析に適している
- ボラティリティの概念を取り入れている
- ビュー設計で分析効率を考慮

**致命的な欠点:**
- オッズデータがない → 期待値計算不可
- 展示データがない → 当日調子を考慮できない
- 天候データがない → 重要な外部要因を無視

### 推奨アクション

1. **Phase 1でrace_conditionsを必ず追加**
   - 天候・グレードは取得が容易で効果大

2. **Phase 2でオッズ・展示データを追加**
   - これがないとモデルの精度向上に限界

3. **データ取得バッチの設計を進める**
   - DB設計だけでなく、データパイプラインの構築が必要
   - JSON並行運用なし、Supabaseに一気に切り替え

---

**更新日**: 2026-01-06
**バージョン**: 1.2（並行運用なしに変更、データ欠損防止策追加）

---

## 11. モデル拡張性の設計改善

### 11.1 現設計の問題点

| 問題 | 影響 | 深刻度 |
|------|------|--------|
| model_typeがENUM | 新モデル追加にDB変更が必要 | ★★★★★ |
| バージョン管理なし | モデル更新の追跡不可 | ★★★★☆ |
| A/Bテスト不可 | 新モデルの検証が困難 | ★★★★☆ |
| メタ情報なし | 再現性・説明性がない | ★★★☆☆ |
| 特徴量寄与度なし | 改善ポイントが不明 | ★★★☆☆ |

### 11.2 改善設計

#### 11.2.1 modelsテーブル（モデルマスタ）★新規

```sql
CREATE TABLE models (
    model_id VARCHAR(50) PRIMARY KEY,     -- 'upsetFocus_v2_kiryu' など自由
    
    -- 基本情報
    display_name VARCHAR(100),            -- '穴狙い v2（桐生特化）'
    description TEXT,
    model_type VARCHAR(20),               -- 'upset', 'safe', 'standard', 'venue_specific'
    
    -- バージョン管理
    version VARCHAR(20),                  -- 'v2.1.0'
    parent_model_id VARCHAR(50),          -- 派生元モデル（継承関係）
    
    -- 対象範囲
    target_venues SMALLINT[],             -- 対象会場（nullなら全会場）
    target_volatility_min SMALLINT,       -- 対象ボラティリティ下限
    target_volatility_max SMALLINT,       -- 対象ボラティリティ上限
    
    -- 学習情報
    trained_at TIMESTAMPTZ,               -- 学習日時
    training_data_from DATE,              -- 学習データ期間（開始）
    training_data_to DATE,                -- 学習データ期間（終了）
    training_race_count INTEGER,          -- 学習に使ったレース数
    
    -- パラメータ（JSON形式で柔軟に）
    hyperparameters JSONB,                -- {"learning_rate": 0.01, "depth": 5, ...}
    feature_list JSONB,                   -- ["volatility_score", "first_boat_win_rate", ...]
    
    -- 状態管理
    status VARCHAR(20) DEFAULT 'development', -- 'development', 'shadow', 'production', 'retired'
    is_public BOOLEAN DEFAULT FALSE,      -- ユーザーに公開するか
    
    -- 実績サマリー（定期更新）
    total_predictions INTEGER DEFAULT 0,
    hit_rate_win DECIMAL(5,4),
    recovery_rate_win DECIMAL(5,4),
    last_evaluated_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 本番モデルのみ取得
CREATE VIEW v_production_models AS
SELECT * FROM models WHERE status = 'production' AND is_public = TRUE;

-- 会場別モデルの取得例
-- SELECT * FROM models WHERE 1 = ANY(target_venues);
```

#### 11.2.2 predictionsテーブルの改善

```sql
-- ENUMをやめてVARCHAR + 外部キーに変更
DROP TYPE IF EXISTS model_type;

CREATE TABLE predictions (
    -- 主キー（複合キー：同じレースに複数モデル・複数バージョンの予測可能）
    prediction_id SERIAL PRIMARY KEY,
    
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    model_id VARCHAR(50) NOT NULL REFERENCES models(model_id),
    
    -- 予測内容
    top_pick SMALLINT NOT NULL,
    top_2nd SMALLINT,
    top_3rd SMALLINT,
    confidence SMALLINT,
    
    -- 予測の詳細スコア（説明可能性のため）
    scores JSONB,                         -- {"1": 1670, "2": 811, "3": 1338, ...}
    
    -- 特徴量の寄与度（説明可能性のため）
    feature_contributions JSONB,          -- {"volatility": 0.3, "first_boat": -0.2, ...}
    
    -- 結果との照合
    is_hit_win BOOLEAN,
    is_hit_place BOOLEAN,
    is_hit_trifecta BOOLEAN,
    is_hit_trio BOOLEAN,
    
    -- 配当
    payout_win INTEGER,
    payout_place INTEGER,
    payout_trifecta INTEGER,
    payout_trio INTEGER,
    
    -- メタ情報
    is_shadow BOOLEAN DEFAULT FALSE,      -- シャドウモード（非公開テスト）
    predicted_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 同じレース×モデルの重複を防ぐ（シャドウモードは除く）
    UNIQUE NULLS NOT DISTINCT (race_id, model_id, is_shadow)
);

-- インデックス
CREATE INDEX idx_predictions_race ON predictions(race_id);
CREATE INDEX idx_predictions_model ON predictions(model_id);
CREATE INDEX idx_predictions_shadow ON predictions(is_shadow) WHERE is_shadow = TRUE;
```

#### 11.2.3 model_experiments（A/Bテスト管理）★新規

```sql
CREATE TABLE model_experiments (
    experiment_id SERIAL PRIMARY KEY,
    name VARCHAR(100),                    -- '穴狙いv2 vs v1 比較実験'
    description TEXT,
    
    -- 比較対象
    control_model_id VARCHAR(50) REFERENCES models(model_id),      -- 既存モデル
    treatment_model_id VARCHAR(50) REFERENCES models(model_id),    -- 新モデル
    
    -- 実験期間
    start_date DATE,
    end_date DATE,
    
    -- 結果
    control_predictions INTEGER,
    control_hit_rate DECIMAL(5,4),
    control_recovery_rate DECIMAL(5,4),
    treatment_predictions INTEGER,
    treatment_hit_rate DECIMAL(5,4),
    treatment_recovery_rate DECIMAL(5,4),
    
    -- 統計的有意性
    p_value DECIMAL(6,5),
    is_significant BOOLEAN,
    
    -- 結論
    conclusion VARCHAR(20),               -- 'treatment_wins', 'control_wins', 'no_diff'
    notes TEXT,
    
    status VARCHAR(20) DEFAULT 'running', -- 'running', 'completed', 'cancelled'
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 11.2.4 model_performance_daily（日次パフォーマンス）★新規

```sql
CREATE TABLE model_performance_daily (
    model_id VARCHAR(50) REFERENCES models(model_id),
    date DATE,
    
    -- 基本統計
    total_predictions INTEGER,
    win_hits INTEGER,
    place_hits INTEGER,
    trifecta_hits INTEGER,
    
    -- 回収率
    investment INTEGER,                   -- 投資額（100円 × 予測数）
    payout_win INTEGER,
    payout_trifecta INTEGER,
    recovery_rate_win DECIMAL(5,4),
    recovery_rate_trifecta DECIMAL(5,4),
    
    -- 条件別内訳（JSONB）
    by_venue JSONB,                       -- {"1": {"hits": 5, "total": 10}, ...}
    by_volatility JSONB,                  -- {"low": {...}, "medium": {...}, "high": {...}}
    
    PRIMARY KEY (model_id, date)
);

-- 日次でこのテーブルを更新するバッチを実行
```

### 11.3 改善後のモデル運用フロー

```
【新モデル開発フロー】

1. modelsテーブルに新モデルを登録（status='development'）
   INSERT INTO models (model_id, display_name, status, ...)
   VALUES ('upsetFocus_v2_kiryu', '穴狙いv2桐生特化', 'development', ...);

2. シャドウモードで予測を記録（ユーザーには見せない）
   INSERT INTO predictions (race_id, model_id, is_shadow, ...)
   VALUES ('2026-01-05-01-01', 'upsetFocus_v2_kiryu', TRUE, ...);

3. 1-2週間のシャドウ運用後、A/Bテスト開始
   INSERT INTO model_experiments (control_model_id, treatment_model_id, ...)
   VALUES ('upsetFocus', 'upsetFocus_v2_kiryu', ...);

4. 統計的に有意な差が出たら本番昇格
   UPDATE models SET status = 'production', is_public = TRUE
   WHERE model_id = 'upsetFocus_v2_kiryu';

5. 旧モデルを退役
   UPDATE models SET status = 'retired'
   WHERE model_id = 'upsetFocus';
```

### 11.4 会場別モデルの運用例

```sql
-- 桐生専用モデルを作成
INSERT INTO models (
    model_id, 
    display_name, 
    model_type,
    target_venues,
    target_volatility_min,
    status
) VALUES (
    'upset_kiryu_v1',
    '穴狙い（桐生専用）',
    'venue_specific',
    ARRAY[1],           -- 桐生のみ
    60,                 -- ボラ60以上
    'development'
);

-- このモデルを使うべきレースを取得
SELECT r.race_id, m.model_id
FROM races r
JOIN models m ON 
    r.venue_code = ANY(m.target_venues)
    AND r.volatility_score >= COALESCE(m.target_volatility_min, 0)
    AND r.volatility_score <= COALESCE(m.target_volatility_max, 100)
WHERE m.status = 'production';
```

### 11.5 特徴量の寄与度記録

```sql
-- 予測時にfeature_contributionsを記録
INSERT INTO predictions (
    race_id, 
    model_id, 
    top_pick,
    scores,
    feature_contributions
) VALUES (
    '2026-01-05-01-01',
    'upsetFocus_v2',
    5,
    '{"1": 1200, "2": 800, "3": 1100, "4": 950, "5": 1500, "6": 700}',
    '{
        "volatility_score": 0.25,
        "first_boat_weakness": 0.20,
        "motor_2rate_diff": 0.15,
        "player_grade_advantage": 0.30,
        "local_win_rate": 0.10
    }'
);

-- どの特徴量が的中に貢献したか分析
SELECT 
    feature_key,
    AVG(CASE WHEN is_hit_win THEN feature_value ELSE NULL END) AS avg_when_hit,
    AVG(CASE WHEN NOT is_hit_win THEN feature_value ELSE NULL END) AS avg_when_miss
FROM predictions p,
LATERAL jsonb_each_text(p.feature_contributions) AS f(feature_key, feature_value_text),
LATERAL (SELECT f.feature_value_text::DECIMAL AS feature_value) AS fv
WHERE p.model_id = 'upsetFocus_v2'
GROUP BY feature_key;
```

### 11.6 改善後の評価

| 観点 | 改善前 | 改善後 |
|------|--------|--------|
| 新モデル追加 | ALTER TYPEが必要 | INSERTのみ |
| バージョン管理 | なし | models.versionで管理 |
| A/Bテスト | 不可 | experimentsで管理 |
| シャドウモード | 不可 | is_shadowフラグ |
| 会場別モデル | 困難 | target_venuesで柔軟に |
| 特徴量追跡 | なし | feature_contributionsで記録 |
| モデル系譜 | なし | parent_model_idで継承関係 |

**改善後の評価: 90点 / 100点**


---

## 12. 賭け推奨/スキップの判定と集計設計

### 12.1 ユーザーに公開したい情報

| 情報 | 表示例 | 用途 |
|------|--------|------|
| 全レースの成績 | 的中率25%、回収率77% | 参考情報 |
| **推奨レースの成績** | 的中率32%、**回収率112%** | メイン訴求 |
| スキップレースの成績 | 的中率18%、回収率52% | 「スキップして正解」の証明 |
| 推奨に従った場合の収支 | +12,000円（100円均等） | 具体的な効果 |

### 12.2 追加テーブル設計

#### 12.2.1 bet_recommendations（賭け推奨判定）★新規

```sql
CREATE TABLE bet_recommendations (
    -- 主キー
    race_id VARCHAR(20) REFERENCES races(race_id),
    model_id VARCHAR(50) REFERENCES models(model_id),
    
    -- 推奨判定
    recommendation VARCHAR(20) NOT NULL,  -- 'strong_bet', 'bet', 'neutral', 'skip'
    
    -- 判定理由（ユーザーに表示）
    reasons JSONB,                        -- ["会場相性◎", "高ボラティリティ", ...]
    
    -- 判定に使った条件
    filter_id INTEGER,                    -- どのフィルタ条件を使ったか
    
    -- 期待値（計算できる場合）
    expected_value DECIMAL(8,2),          -- +15円 など
    expected_hit_rate DECIMAL(5,4),       -- 過去同条件の的中率
    expected_payout INTEGER,              -- 過去同条件の平均配当
    
    -- 結果（レース終了後に更新）
    actual_hit BOOLEAN,
    actual_payout INTEGER,
    
    -- 判定のスコア（ソート用）
    recommendation_score DECIMAL(5,2),    -- 0-100
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (race_id, model_id)
);

-- インデックス
CREATE INDEX idx_bet_rec_recommendation ON bet_recommendations(recommendation);
CREATE INDEX idx_bet_rec_model ON bet_recommendations(model_id, recommendation);
```

#### 12.2.2 bet_filters（フィルタ条件マスタ）★新規

```sql
CREATE TABLE bet_filters (
    filter_id SERIAL PRIMARY KEY,
    name VARCHAR(100),                    -- '穴狙い推奨フィルタv1'
    model_id VARCHAR(50) REFERENCES models(model_id),
    
    -- フィルタ条件（JSONB形式で柔軟に）
    conditions JSONB NOT NULL,
    /*
    {
        "venue_whitelist": [2, 3, 4, 14, 15],  -- 推奨会場
        "venue_blacklist": [24, 20, 1],        -- 非推奨会場
        "volatility_min": 70,
        "volatility_max": null,
        "race_number_max": 8,
        "excluded_picks": [6],                  -- 6号艇予測は除外
        "min_expected_value": 0                 -- EV0以上
    }
    */
    
    -- このフィルタの実績（定期更新）
    total_races INTEGER DEFAULT 0,
    hit_count INTEGER DEFAULT 0,
    total_payout INTEGER DEFAULT 0,
    recovery_rate DECIMAL(5,4),
    
    -- 有効期間
    valid_from DATE,
    valid_to DATE,                        -- nullなら現在有効
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 12.2.3 daily_bet_summary（日次集計）★新規

```sql
CREATE TABLE daily_bet_summary (
    date DATE,
    model_id VARCHAR(50) REFERENCES models(model_id),
    
    -- 全レースの成績
    all_races INTEGER,
    all_hits INTEGER,
    all_payout INTEGER,
    all_recovery_rate DECIMAL(5,4),
    
    -- 推奨レース（strong_bet + bet）の成績
    recommended_races INTEGER,
    recommended_hits INTEGER,
    recommended_payout INTEGER,
    recommended_recovery_rate DECIMAL(5,4),
    
    -- スキップレースの成績（答え合わせ用）
    skipped_races INTEGER,
    skipped_hits INTEGER,                 -- もし賭けてたら当たってた数
    skipped_payout INTEGER,               -- もし賭けてたら得てた配当
    skipped_recovery_rate DECIMAL(5,4),
    
    -- 推奨の効果
    recovery_improvement DECIMAL(5,4),    -- 推奨回収率 - 全体回収率
    
    -- 収支シミュレーション（100円均等賭け）
    profit_if_all INTEGER,                -- 全レース賭けた場合の収支
    profit_if_recommended INTEGER,        -- 推奨のみ賭けた場合の収支
    
    PRIMARY KEY (date, model_id)
);
```

#### 12.2.4 user_visible_summary（ユーザー公開用集計）★新規

```sql
-- ユーザーに公開するサマリーテーブル（日次バッチで更新）
CREATE TABLE user_visible_summary (
    summary_id SERIAL PRIMARY KEY,
    
    -- 集計期間
    period_type VARCHAR(20),              -- 'daily', 'weekly', 'monthly', 'all_time'
    period_start DATE,
    period_end DATE,
    
    model_id VARCHAR(50) REFERENCES models(model_id),
    
    -- 全レースの成績
    all_total INTEGER,
    all_hit_rate DECIMAL(5,4),
    all_recovery_rate DECIMAL(5,4),
    
    -- 推奨レースの成績（メイン表示）
    rec_total INTEGER,
    rec_hit_rate DECIMAL(5,4),
    rec_recovery_rate DECIMAL(5,4),
    rec_avg_payout INTEGER,
    
    -- 収支シミュレーション
    rec_profit INTEGER,                   -- 100円均等の収支
    rec_profit_rate DECIMAL(5,4),         -- 収支率
    
    -- スキップの効果
    skip_saved INTEGER,                   -- スキップで「避けた損失」
    
    -- 更新日時
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ユニーク制約
CREATE UNIQUE INDEX idx_user_summary_unique 
ON user_visible_summary(period_type, period_start, period_end, model_id);
```

### 12.3 ユーザー向けビュー

#### 12.3.1 今日の推奨レース一覧

```sql
CREATE VIEW v_todays_recommendations AS
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
    
    -- 結果（あれば）
    res.rank1 AS actual_winner,
    br.actual_hit,
    br.actual_payout

FROM races r
JOIN venues v ON r.venue_code = v.code
JOIN predictions p ON r.race_id = p.race_id
JOIN models m ON p.model_id = m.model_id
LEFT JOIN bet_recommendations br ON r.race_id = br.race_id AND p.model_id = br.model_id
LEFT JOIN race_results res ON r.race_id = res.race_id
WHERE r.race_date = CURRENT_DATE
  AND m.status = 'production'
  AND m.is_public = TRUE
ORDER BY br.recommendation_score DESC NULLS LAST, r.start_time;
```

#### 12.3.2 期間別パフォーマンス比較ビュー

```sql
CREATE VIEW v_performance_comparison AS
SELECT 
    model_id,
    period_type,
    period_start,
    period_end,
    
    -- 全レース
    all_total AS "全レース数",
    ROUND(all_hit_rate * 100, 1) AS "全体的中率%",
    ROUND(all_recovery_rate * 100, 1) AS "全体回収率%",
    
    -- 推奨レース
    rec_total AS "推奨レース数",
    ROUND(rec_hit_rate * 100, 1) AS "推奨的中率%",
    ROUND(rec_recovery_rate * 100, 1) AS "推奨回収率%",
    
    -- 効果
    ROUND((rec_recovery_rate - all_recovery_rate) * 100, 1) AS "改善幅%",
    rec_profit AS "収支(100円均等)"

FROM user_visible_summary
WHERE period_type IN ('weekly', 'monthly')
ORDER BY period_start DESC;
```

#### 12.3.3 スキップの効果検証ビュー

```sql
CREATE VIEW v_skip_validation AS
SELECT 
    date,
    model_id,
    
    -- 推奨レースの成績
    recommended_races,
    recommended_recovery_rate,
    
    -- スキップレースの成績
    skipped_races,
    skipped_recovery_rate,
    
    -- スキップの効果
    CASE 
        WHEN skipped_recovery_rate < 1.0 
        THEN '✅ スキップ正解（回収率' || ROUND(skipped_recovery_rate * 100) || '%）'
        ELSE '❌ スキップ失敗（回収率' || ROUND(skipped_recovery_rate * 100) || '%）'
    END AS skip_evaluation,
    
    -- 避けた損失
    CASE 
        WHEN skipped_recovery_rate < 1.0 
        THEN (skipped_races * 100) - skipped_payout
        ELSE 0
    END AS avoided_loss

FROM daily_bet_summary
ORDER BY date DESC;
```

### 12.4 フロントエンド表示イメージ

```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 穴狙いモデル パフォーマンス                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  【今週の成績】                                                  │
│                                                                 │
│  ┌──────────────┬──────────────┬──────────────┐                │
│  │              │   全レース   │  推奨のみ 🎯  │                │
│  ├──────────────┼──────────────┼──────────────┤                │
│  │ レース数     │     156      │     42       │                │
│  │ 的中率       │    25.0%     │   33.3%      │                │
│  │ 回収率       │    77.4%     │  ⭐ 118.5%   │                │
│  │ 収支(100円)  │   -3,500円   │  +7,770円    │                │
│  └──────────────┴──────────────┴──────────────┘                │
│                                                                 │
│  💡 推奨レースのみに賭けることで +41.1% 回収率が改善             │
│                                                                 │
│  📉 スキップしたレース (114件) の回収率: 52.3%                   │
│     → スキップして正解！ 約5,400円の損失を回避                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 🎯 今日の推奨レース                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🔥 強く推奨 (3件)                                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 戸田 5R  ⚡ボラ82 │ 予想: 3号艇 │ 期待値+23円           │    │
│  │ 理由: 会場相性◎ / 高ボラティリティ / 3号艇A1選手        │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 丸亀 7R  ⚡ボラ75 │ 予想: 4号艇 │ 期待値+18円           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ⚪ 通常推奨 (8件)                                               │
│  ...                                                            │
│                                                                 │
│  ⚫ 見送り推奨 (15件) ← 展開すると詳細表示                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 12.5 日次バッチ処理

```sql
-- 毎日0時に実行するバッチ

-- 1. bet_recommendationsの結果を更新
UPDATE bet_recommendations br
SET 
    actual_hit = (p.is_hit_win),
    actual_payout = (p.payout_win)
FROM predictions p
WHERE br.race_id = p.race_id 
  AND br.model_id = p.model_id
  AND br.actual_hit IS NULL
  AND p.is_hit_win IS NOT NULL;

-- 2. daily_bet_summaryを更新
INSERT INTO daily_bet_summary (date, model_id, ...)
SELECT 
    r.race_date,
    p.model_id,
    
    -- 全レース
    COUNT(*),
    SUM(CASE WHEN p.is_hit_win THEN 1 ELSE 0 END),
    SUM(COALESCE(p.payout_win, 0)),
    SUM(COALESCE(p.payout_win, 0))::DECIMAL / NULLIF(COUNT(*) * 100, 0),
    
    -- 推奨レース
    SUM(CASE WHEN br.recommendation IN ('strong_bet', 'bet') THEN 1 ELSE 0 END),
    SUM(CASE WHEN br.recommendation IN ('strong_bet', 'bet') AND p.is_hit_win THEN 1 ELSE 0 END),
    SUM(CASE WHEN br.recommendation IN ('strong_bet', 'bet') THEN COALESCE(p.payout_win, 0) ELSE 0 END),
    ...
    
FROM races r
JOIN predictions p ON r.race_id = p.race_id
LEFT JOIN bet_recommendations br ON p.race_id = br.race_id AND p.model_id = br.model_id
WHERE r.race_date = CURRENT_DATE - INTERVAL '1 day'
GROUP BY r.race_date, p.model_id
ON CONFLICT (date, model_id) DO UPDATE SET ...;

-- 3. user_visible_summaryを更新（週次・月次）
-- ... 類似のロジック
```

### 12.6 API設計（フロントエンド用）

```
GET /api/recommendations/today
  → 今日の推奨レース一覧

GET /api/recommendations/today?model=upsetFocus
  → 特定モデルの今日の推奨

GET /api/performance/summary?period=weekly
  → 週間パフォーマンスサマリー

GET /api/performance/comparison
  → 全レース vs 推奨レースの比較

GET /api/skip-validation?date=2026-01-04
  → スキップの効果検証
```

### 12.7 改善後の評価

| 観点 | 改善前 | 改善後 |
|------|--------|--------|
| 賭け推奨の記録 | なし | bet_recommendationsで記録 |
| 推奨のみの集計 | 不可 | daily_bet_summaryで集計 |
| スキップ効果の検証 | 不可 | v_skip_validationで検証 |
| ユーザー向け表示 | 全レースのみ | 推奨/全体/スキップを比較表示 |
| フィルタ条件の管理 | ハードコード | bet_filtersで履歴管理 |

**ユーザー公開対応度: 95点 / 100点**

