# データベース設計書

龍神レーダー Supabaseデータベースの設計仕様。

---

## 目次

1. [概要](#概要)
2. [テーブル一覧と使用状況](#テーブル一覧と使用状況)
3. [コアテーブル詳細](#コアテーブル詳細)
4. [テーブル関係図](#テーブル関係図)
5. [ソースコード別テーブル使用状況](#ソースコード別テーブル使用状況)
6. [スキーマの差異と課題](#スキーマの差異と課題)

---

## 概要

### データベース情報

| 項目 | 値 |
|------|-----|
| プラットフォーム | Supabase (PostgreSQL) |
| スキーマファイル | `docs/db-migration/001_schema.sql` |
| RPC関数 | `docs/db-migration/007_RPC_FUNCTIONS.sql` |

### 設計の経緯

1. **初期設計** (`scripts/db/SCHEMA_DETAIL.md`): 8テーブル構成
2. **拡張設計** (`docs/db-migration/001_schema.sql`): 17テーブル + ビュー構成
3. **追加テーブル** (`docs/db-migration/008_venue_rules.sql`): ルール管理用2テーブル

**現在の運用**: 拡張設計のうち、一部のテーブルのみを実際に使用中。

---

## テーブル一覧と使用状況

### 実際に使用中のテーブル

| テーブル名 | 用途 | 使用場所 |
|-----------|------|---------|
| `predictions` | AI予測データ | フロント、日次スクリプト、分析 |
| `race_results` | レース結果 | フロント、日次スクリプト、分析 |
| `races` | レース基本情報 | 日次スクリプト、分析 |
| `race_entries` | 出走選手情報 | 日次スクリプト、分析 |
| `race_conditions` | 天候等条件 | 予測生成スクリプト |
| `exhibition_data` | 展示タイム・ST | 予測生成スクリプト、フロント |
| `race_start_timings` | 本番ST | 結果スクレイピング |
| `racer_aggregated_stats` | 選手集計統計 | 予測生成（攻防分布等） |
| `models` | モデルマスタ | 日次スクリプト |
| `venues` | 会場マスタ | メンテナンススクリプト |

### 定義済みだが未使用のテーブル

| テーブル名 | 設計意図 | 未使用理由 |
|-----------|---------|-----------|
| `race_odds` | オッズ情報 | スクレイピング未実装 |
| `bet_filters` | フィルタ条件マスタ | ルールはコードにハードコード |
| `bet_recommendations` | 賭け推奨判定 | ルールマッチはコードで実行 |
| `daily_bet_summary` | 日次集計 | フロントでリアルタイム計算 |
| `user_visible_summary` | ユーザー向けサマリー | フロントでリアルタイム計算 |
| `model_performance_daily` | モデル日次パフォーマンス | 未実装 |
| `model_experiments` | A/Bテスト管理 | 未実装 |

### 追加定義されたテーブル（部分的使用）

| テーブル名 | 用途 | 使用状況 |
|-----------|------|---------|
| `venue_rules` | 会場別ルール定義 | `RulePerformance.jsx`で参照（現在は未使用） |
| `rule_applications` | ルール適用ログ | `daily-rule-tracking.js`で使用（現在は未使用） |

### 旧スキーマのテーブル（参照のみ）

| テーブル名 | 備考 |
|-----------|------|
| `results` | `race_results`に統合。一部スクリプトに残存参照あり |
| `daily_accuracy` | 未使用。`check-jan10.js`に残存参照あり |
| `racers` | `race_entries`にリネーム |
| `volatility` | `races`テーブルに統合 |

---

## コアテーブル詳細

### predictions

AI予測データを格納。最も頻繁にアクセスされるテーブル。

```sql
CREATE TABLE predictions (
    prediction_id SERIAL PRIMARY KEY,
    race_id VARCHAR(20) NOT NULL,        -- '2026-01-04-01-01' 形式
    model_id VARCHAR(50) NOT NULL,       -- 'standard', 'safeBet', 'upsetFocus'

    -- 予測内容
    top_pick SMALLINT NOT NULL,          -- 1着予測 (1-6)
    top_2nd SMALLINT,                    -- 2着予測 (1-6)
    top_3rd SMALLINT,                    -- 3着予測 (1-6)
    confidence SMALLINT,                 -- 信頼度 (0-100)

    -- 詳細スコア
    scores JSONB,                        -- 各艇のスコア（未使用）
    feature_contributions JSONB,         -- 展開予測+選手統計（下記参照）

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
```

**インデックス:**
- `idx_predictions_race` (race_id)
- `idx_predictions_model` (model_id)
- `idx_predictions_race_model` (race_id, model_id)

**feature_contributions の構造:**

```jsonc
{
  "turnPrediction": {
    "patterns": [              // 上位3パターン（展開予測）
      { "course": 1, "technique": "逃げ", "probability": 0.52, "name": "1コース逃げ" },
      // ...
    ],
    "technique": "逃げ",       // 最有力決まり手
    "probability": 0.52,       // 最有力パターンの確率
    "winnerCourse": 1,         // 最有力1着コース
    "distribution": [...],     // 各コース勝率分布
    "boatStrengths": [...]     // 各艇の総合力
  },
  "racerStats": [              // 6艇の攻防統計
    {
      "boatNumber": 1,
      "course": 1,
      "attackDistribution": { "nige": 0.95, "sashi": 0.02, ... },
      "defenseDistribution": { "nigasare": 0.05, "sasare": 0.1, ... },
      "courseRaceCounts": { "1": 150, "2": 5, ... }
    },
    // ... 計6艇分
  ]
}
```

**使用パターン:**
```javascript
// フロントエンド (supabaseDataService.js)
supabase.from('predictions')
  .select('*')
  .eq('race_id', raceId)

// 日次スクリプト (generate-predictions.js)
supabase.from('predictions')
  .upsert(predictionData)  // feature_contributions含む
```

---

### racer_aggregated_stats

選手ごとの集計統計。`aggregate-racer-stats.js --all` で日次更新（`aggregate-stats.yml`）。

| カラム | 型 | 説明 |
|--------|-----|------|
| `racer_id` | integer | 選手登録番号（PK） |
| `venue_code` | integer | 会場コード（0=全会場集計）（PK） |
| `avg_st` | decimal(5,3) | 平均スタートタイミング |
| `avg_st_last_30` | decimal(5,3) | 直近30走の平均ST |
| `st_stddev` | decimal(5,3) | ST標準偏差 |
| `flying_rate` | decimal(5,4) | フライング率 |
| `attack_distribution` | JSONB | コース別決まり手分布 |
| `defense_distribution` | JSONB | 1コース時の被決まり手分布 |
| `course_race_counts` | JSONB | コース別出走数・勝利数 |
| `course_entry_tendency` | JSONB | 枠番→コース進入傾向 |
| `total_races` | integer | 総レース数 |

**複合PK:** `(racer_id, venue_code)`

**更新頻度:** 日次（`aggregate-stats.yml` — JST 23:00）

**データソース:** `race_entries` + `race_start_timings` + `race_results` から集計

**使用箇所:** `turnPrediction.js`（展開予測）、`generate-predictions.js`（スコア計算）

**使用パターン:**
```javascript
// 予測生成時 (generate-predictions.js)
supabase.from('racer_aggregated_stats')
  .select('*')
  .in('racer_id', racerIds)
  .eq('venue_code', 0)  // 全会場集計

// 集計スクリプト (aggregate-racer-stats.js)
supabase.from('racer_aggregated_stats')
  .upsert(record, { onConflict: 'racer_id,venue_code' })
```

---

### race_results

レース結果（着順・配当）を格納。

```sql
CREATE TABLE race_results (
    race_id VARCHAR(20) PRIMARY KEY,

    -- 着順
    rank1 SMALLINT NOT NULL,
    rank2 SMALLINT NOT NULL,
    rank3 SMALLINT NOT NULL,

    -- 配当
    payout_win INTEGER,                  -- 単勝
    payout_place_1 INTEGER,              -- 複勝1着
    payout_place_2 INTEGER,              -- 複勝2着
    payout_trifecta INTEGER,             -- 3連複
    payout_trio INTEGER,                 -- 3連単

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
```

**使用パターン:**
```javascript
// フロントエンド
supabase.from('race_results')
  .select('*')
  .in('race_id', raceIds)

// 日次スクリプト (scrape-results.js)
supabase.from('race_results')
  .upsert(resultData)
```

---

### races

レース基本情報を格納。

```sql
CREATE TABLE races (
    race_id VARCHAR(20) PRIMARY KEY,     -- '2026-01-04-01-01' 形式

    -- 基本情報
    race_date DATE NOT NULL,
    venue_code SMALLINT NOT NULL,        -- 1-24
    race_number SMALLINT NOT NULL,       -- 1-12
    start_time TIME,

    -- ボラティリティ
    volatility_score SMALLINT,           -- 0-100
    volatility_level VARCHAR(10),        -- 'low', 'medium', 'high'
    recommended_model VARCHAR(50),
    volatility_reasons JSONB,

    -- 1号艇情報（分析用に非正規化）
    first_boat_grade VARCHAR(5),
    first_boat_win_rate DECIMAL(5,3),
    first_boat_motor_2rate DECIMAL(5,2),

    -- メタ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(race_date, venue_code, race_number)
);
```

**race_id 形式:**
```
2026-02-05-03-07
    │       │  └─ レース番号（07 = 7R）
    │       └──── 会場コード（03 = 江戸川）
    └──────────── 日付（YYYY-MM-DD）
```

---

### race_entries

出走選手情報を格納。

```sql
CREATE TABLE race_entries (
    race_id VARCHAR(20) NOT NULL,
    boat_number SMALLINT NOT NULL,       -- 1-6

    -- 選手情報
    player_name VARCHAR(50),
    grade VARCHAR(5),                    -- 'A1', 'A2', 'B1', 'B2'
    age SMALLINT,

    -- 成績情報
    win_rate DECIMAL(5,3),
    local_win_rate DECIMAL(5,3),
    global_2rate DECIMAL(5,2),
    local_2rate DECIMAL(5,2),

    -- 機材情報
    motor_number SMALLINT,
    motor_2rate DECIMAL(5,2),
    boat_number_id SMALLINT,
    boat_2rate DECIMAL(5,2),

    -- AIスコア（モデル別）
    ai_score_standard INTEGER,
    ai_score_safe_bet INTEGER,
    ai_score_upset_focus INTEGER,

    PRIMARY KEY (race_id, boat_number)
);
```

---

### models

モデルマスタ。

```sql
CREATE TABLE models (
    model_id VARCHAR(50) PRIMARY KEY,    -- 'standard', 'safeBet', 'upsetFocus'

    display_name VARCHAR(100),
    description TEXT,
    model_type VARCHAR(20),

    -- 状態
    status VARCHAR(20) DEFAULT 'development',
    is_public BOOLEAN DEFAULT FALSE,

    -- 実績サマリー
    total_predictions INTEGER DEFAULT 0,
    hit_rate_win DECIMAL(5,4),
    recovery_rate_win DECIMAL(5,4),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**初期データ:**
```sql
INSERT INTO models (model_id, display_name, model_type, status, is_public) VALUES
    ('standard', 'スタンダード', 'standard', 'production', TRUE),
    ('safeBet', '本命狙い', 'safe', 'production', TRUE),
    ('upsetFocus', '穴狙い', 'upset', 'production', TRUE);
```

---

### venues

会場マスタ。

```sql
CREATE TABLE venues (
    code SMALLINT PRIMARY KEY,           -- 1-24
    name VARCHAR(20) NOT NULL,
    water_type VARCHAR(10),              -- 'fresh', 'sea', 'brackish'
    cluster VARCHAR(20),                 -- 'in_strong', 'out_strong', 'balanced'
    avg_first_win_rate DECIMAL(5,4),
    avg_volatility_score DECIMAL(5,2),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### race_conditions

天候・水面コンディション情報を格納。

```sql
CREATE TABLE race_conditions (
    race_id VARCHAR(20) PRIMARY KEY,

    -- 天候
    weather VARCHAR(10),
    wind_direction VARCHAR(10),
    wind_speed DECIMAL(4,1),
    wave_height SMALLINT,
    temperature DECIMAL(4,1),          -- 気温
    water_temperature DECIMAL(4,1),    -- 水温

    -- レースグレード
    race_grade VARCHAR(10),            -- SG, G1, G2, G3, 一般
    race_title VARCHAR(100),

    -- 節情報（未取得）
    series_day SMALLINT,
    is_final_day BOOLEAN,

    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### exhibition_data

展示航走データを格納。15分間隔ワークフロー（scrape-exhibition.yml）で取得。

```sql
CREATE TABLE exhibition_data (
    race_id VARCHAR(20) NOT NULL,
    boat_number SMALLINT NOT NULL,

    exhibition_time DECIMAL(5,2),      -- 展示タイム（秒）
    start_timing DECIMAL(4,2),         -- 展示ST（秒）

    created_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (race_id, boat_number)
);
```

**使用パターン:**
```javascript
// 予測生成 (generate-predictions.js)
supabase.from('exhibition_data')
  .upsert(exhibitionRows)

// フロントエンド (supabaseDataService.js)
supabase.from('exhibition_data')
  .select('*')
  .eq('race_id', raceId)
```

---

### race_start_timings

本番レースのスタートタイミング情報。

```sql
CREATE TABLE race_start_timings (
    race_id VARCHAR(20) NOT NULL,
    boat_number SMALLINT NOT NULL,

    start_timing DECIMAL(4,2),         -- 本番ST（秒）
    is_flying BOOLEAN DEFAULT FALSE,   -- フライング
    is_late_start BOOLEAN DEFAULT FALSE, -- 出遅れ

    created_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (race_id, boat_number)
);
```

---

## テーブル関係図

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ER Diagram (実使用テーブル)                    │
└─────────────────────────────────────────────────────────────────────┘

  venues                     models
  ┌──────────┐              ┌──────────┐
  │ code (PK)│              │model_id  │
  │ name     │              │(PK)      │
  │ ...      │              │ ...      │
  └────┬─────┘              └────┬─────┘
       │                         │
       │ 1:N                     │ 1:N
       ▼                         ▼
  ┌──────────────────────────────────────┐
  │               races                   │
  │ race_id (PK)                         │
  │ race_date                            │
  │ venue_code (FK) ────────────────────►│
  │ race_number                          │
  │ ...                                  │
  └──────────┬───────────────────────────┘
             │
             │ 1:N
             ▼
  ┌──────────────────────────────────────┐
  │           race_entries                │
  │ race_id (FK) + boat_number (PK)      │
  │ player_name, grade, ...              │
  │ ai_score_standard, ...               │
  └──────────────────────────────────────┘
             │
             │ 1:N (via race_id)
             ▼
  ┌──────────────────────────────────────┐
  │           predictions                 │
  │ prediction_id (PK)                   │
  │ race_id (FK) ────────────────────────│
  │ model_id (FK) ───────────────────────│
  │ top_pick, confidence, ...            │
  │ feature_contributions (JSONB)        │
  │ is_hit_win, payout_win, ...          │
  └──────────────────────────────────────┘
             │
             │ 1:1 (via race_id)
             ▼
  ┌──────────────────────────────────────┐
  │           race_results                │
  │ race_id (PK)                         │
  │ rank1, rank2, rank3                  │
  │ payout_win, payout_trifecta, ...     │
  │ winning_technique, course_1~6        │
  └──────────────────────────────────────┘
             │
             │ 1:N (via race_id)
             ▼
  ┌──────────────────────────────────────┐
  │         race_start_timings            │
  │ race_id + boat_number (PK)           │
  │ start_timing, is_flying              │
  └──────────────────────────────────────┘

  ┌──────────────────────────────────────┐
  │          exhibition_data              │
  │ race_id + boat_number (PK)           │
  │ exhibition_time, start_timing        │
  └──────────────────────────────────────┘

  ┌──────────────────────────────────────┐
  │          race_conditions              │
  │ race_id (PK)                         │
  │ weather, wind, temperature, ...      │
  │ race_grade, race_title               │
  └──────────────────────────────────────┘
```

---

## ソースコード別テーブル使用状況

### フロントエンド (src/)

| ファイル | テーブル | 操作 |
|---------|---------|------|
| `ruleMatchService.js` | predictions | SELECT |
| `ruleMatchService.js` | race_results | SELECT |
| `ruleMatchService.js` | races | SELECT |
| `adminRuleService.js` | predictions | SELECT |
| `adminRuleService.js` | race_results | SELECT |
| `supabaseDataService.js` | races | SELECT |
| `supabaseDataService.js` | models | SELECT |
| `supabaseDataService.js` | predictions | SELECT |
| `RulePerformance.jsx` | venue_rules | SELECT (未使用) |
| `RulePerformance.jsx` | rule_applications | SELECT (未使用) |

### 日次スクリプト (scripts/daily/)

| ファイル | テーブル | 操作 |
|---------|---------|------|
| `generate-predictions.js` | races | UPSERT |
| `generate-predictions.js` | race_entries | UPSERT |
| `generate-predictions.js` | predictions | UPSERT |
| `generate-predictions.js` | race_conditions | UPSERT |
| `generate-predictions.js` | exhibition_data | UPSERT |
| `scrape-results.js` | races | SELECT |
| `scrape-results.js` | race_results | UPSERT |
| `scrape-results.js` | race_start_timings | UPSERT |
| `scrape-results.js` | predictions | SELECT, UPDATE |
| `calculate-accuracy.js` | predictions | SELECT |
| `calculate-accuracy.js` | race_results | SELECT |
| `calculate-accuracy.js` | models | UPDATE |

### 分析スクリプト (scripts/analysis/)

| ファイル | テーブル | 操作 |
|---------|---------|------|
| `collect-venue-stats.js` | predictions | SELECT |
| `collect-venue-stats.js` | race_results | SELECT |
| `collect-venue-stats.js` | race_entries | SELECT |
| `analyze-venue-*.js` | predictions | SELECT |
| `analyze-venue-*.js` | race_results | SELECT |
| `analyze-venue-*.js` | race_entries | SELECT |

### メンテナンススクリプト (scripts/maintenance/)

| ファイル | テーブル | 操作 |
|---------|---------|------|
| `update-venue-stats.js` | races | SELECT |
| `update-venue-stats.js` | venues | SELECT, UPDATE |
| `backfill-*.js` | predictions | SELECT, UPDATE |
| `backfill-*.js` | race_results | SELECT |

---

## スキーマの差異と課題

### 1. 設計と実装の乖離

**当初設計されたが未使用のテーブル:**

| テーブル | 設計意図 | 現状 |
|---------|---------|------|
| `bet_recommendations` | DBでルール判定結果を保存 | コードでリアルタイム計算 |
| `daily_bet_summary` | 日次集計をDB保存 | フロントでリアルタイム計算 |
| `user_visible_summary` | ユーザー向けサマリー | フロントでリアルタイム計算 |
| `race_odds` | オッズ情報 | スクレイピング未実装 |

**理由:**
- ルールマッチングは `ruleMatchService.js` にハードコード、DBへの保存は行っていない
- 集計はページ読み込み時にリアルタイムで計算

### 2. 名称の不整合

| 項目 | 旧名称 | 現名称 | 残存参照 |
|------|--------|--------|---------|
| 選手テーブル | `racers` | `race_entries` | なし |
| 結果テーブル | `results` | `race_results` | `check-jan10.js` |
| ボラティリティ | `volatility` (別テーブル) | `races.volatility_*` (統合) | なし |

### 3. 未使用の追加テーブル

`008_venue_rules.sql` で定義された以下のテーブルは、コンポーネントで参照されているが実際には使用されていない:

```sql
-- venue_rules: ルール定義（現在はコードにハードコード）
-- rule_applications: ルール適用ログ（daily-rule-tracking.jsで使用予定だったが未運用）
```

**推奨対応:**
1. コードのルール定義をDBに移行するか
2. 未使用テーブルを削除してスキーマを整理するか

### 4. トリガーの実装状況

`001_schema.sql` で定義されたトリガー:

```sql
-- race_results にINSERT/UPDATE時に predictions を自動更新
CREATE TRIGGER trg_update_predictions
AFTER INSERT OR UPDATE ON race_results
FOR EACH ROW
EXECUTE FUNCTION update_prediction_results();
```

**注意:** このトリガーがSupabaseで有効化されているか確認が必要。
現在 `scrape-results.js` で手動更新している部分と重複する可能性あり。

### 5. 推奨アクション

| 優先度 | アクション | 説明 |
|--------|-----------|------|
| 高 | 残存参照の削除 | `check-jan10.js` の `results`, `daily_accuracy` 参照を削除 |
| 中 | 未使用テーブルの整理 | `venue_rules`, `rule_applications` の使用可否を決定 |
| 低 | 集計テーブルの活用 | パフォーマンス改善のため `daily_bet_summary` 等の活用を検討 |

---

## 参考: RPC関数

Supabaseに登録されているRPC関数:

| 関数名 | 用途 |
|--------|------|
| `get_today_races()` | 本日のレース一覧取得 |
| `get_predictions_by_date(DATE)` | 指定日の予測データ取得 |

定義: `docs/db-migration/007_RPC_FUNCTIONS.sql`
