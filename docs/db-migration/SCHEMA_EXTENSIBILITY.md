# スキーマ拡張性設計書

## 📋 概要

このドキュメントは、将来的な拡張（新しいスクレイピングデータの追加、新しいモデルの追加など）を考慮したスキーマ設計の評価と改善案を説明します。

---

## 🔍 現在のスキーマの拡張性評価

### ✅ 拡張可能な設計

#### 1. モデルの追加
**現状:** ✅ **拡張可能**

**理由:**
- `predictions.model_type` は `VARCHAR(20)` で、値の追加が容易
- `UNIQUE(race_id, model_type)` 制約により、新しいモデルを追加しても既存データと競合しない
- 新しいモデルを追加する場合、`model_type` に新しい値を挿入するだけ

**例:**
```sql
-- 新しいモデル 'advanced' を追加
INSERT INTO predictions (race_id, model_type, top_pick, top3, ...)
VALUES ('2025-12-05-01-01', 'advanced', 2, [2, 1, 4], ...);
```

**注意点:**
- `volatility.recommended_model` も新しいモデルに対応する必要がある
- `accuracy_stats.model_type` も新しいモデルに対応する必要がある

---

#### 2. JSONB型を使用している部分
**現状:** ✅ **拡張可能**

**理由:**
- `predictions.ai_scores` (JSONB) - 新しいスコア項目を追加可能
- `results.payouts` (JSONB) - 新しい券種を追加可能
- `accuracy_stats.recovery_*` (JSONB) - 新しい統計項目を追加可能

**例:**
```json
// ai_scores に新しい項目を追加
{
  "1": 3253,
  "2": 2890,
  "newScoreType": 150  // 新しいスコア項目
}

// payouts に新しい券種を追加
{
  "win": {"1": 320},
  "place": {"1": 110},
  "newBetType": {"1-2": 500}  // 新しい券種
}
```

---

### ⚠️ 拡張に制約がある設計

#### 1. racesテーブル - 固定カラム
**現状:** ⚠️ **ALTER TABLEが必要**

**現在のカラム:**
- `weather`, `air_temp`, `wind_direction`, `wind_velocity`, `water_temp`, `wave_height`

**問題点:**
- 新しいスクレイピングデータ（例: 湿度、気圧、視程など）を追加する場合、`ALTER TABLE` が必要
- マイグレーションが必要

**改善案:**
- `metadata` (JSONB) カラムを追加して、将来の拡張データを格納

---

#### 2. racersテーブル - 固定カラム
**現状:** ⚠️ **ALTER TABLEが必要**

**現在のカラム:**
- `global_win_rate`, `local_win_rate`, `motor_2_rate`, `boat_2_rate` など

**問題点:**
- 新しい選手データ（例: スタート成績、コース取り成績など）を追加する場合、`ALTER TABLE` が必要
- マイグレーションが必要

**改善案:**
- `metadata` (JSONB) カラムを追加して、将来の拡張データを格納

---

## 🚀 改善されたスキーマ設計

### 改善案1: metadata JSONBカラムの追加

#### racesテーブルに追加

```sql
ALTER TABLE races ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;

-- インデックス（JSONB検索用）
CREATE INDEX idx_races_metadata ON races USING GIN (metadata);
```

**使用例:**
```sql
-- 新しいデータを追加（例: 湿度、気圧）
UPDATE races 
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{humidity}',
  '65.5'::jsonb
)
WHERE race_id = '2025-12-05-01-01';

-- クエリ例
SELECT * FROM races 
WHERE metadata->>'humidity' IS NOT NULL;
```

---

#### racersテーブルに追加

```sql
ALTER TABLE racers ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;

-- インデックス（JSONB検索用）
CREATE INDEX idx_racers_metadata ON racers USING GIN (metadata);
```

**使用例:**
```sql
-- 新しいデータを追加（例: スタート成績、コース取り成績）
UPDATE racers 
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{startPerformance}',
  '{"avgStartTime": 0.45, "goodStartRate": 0.75}'::jsonb
)
WHERE race_id = '2025-12-05-01-01' AND lane = 1;

-- クエリ例
SELECT * FROM racers 
WHERE (metadata->'startPerformance'->>'goodStartRate')::float > 0.7;
```

---

### 改善案2: モデル追加の標準化

#### モデルマスタテーブルの追加（オプション）

```sql
CREATE TABLE prediction_models (
    model_code VARCHAR(20) PRIMARY KEY,
    model_name VARCHAR(50) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 初期データ
INSERT INTO prediction_models (model_code, model_name, description) VALUES
('standard', 'スタンダード', 'バランス重視の万能型モデル'),
('safeBet', '本命狙い', '堅実な的中率を追求するモデル'),
('upsetFocus', '穴狙い', '高配当を狙う逆張り型モデル');

-- 新しいモデルを追加する場合
INSERT INTO prediction_models (model_code, model_name, description) VALUES
('advanced', 'アドバンス', '機械学習を活用した高度なモデル');
```

**メリット:**
- モデルの管理が容易
- モデルの有効/無効を制御可能
- モデルの説明を一元管理

**使用例:**
```sql
-- 有効なモデルのみ取得
SELECT p.* 
FROM predictions p
JOIN prediction_models pm ON p.model_type = pm.model_code
WHERE pm.is_active = TRUE;
```

---

## 📊 拡張性の比較

### 現在の設計

| 項目 | 拡張性 | 追加方法 | マイグレーション |
|------|--------|---------|----------------|
| **モデル追加** | ✅ 高い | INSERTのみ | 不要 |
| **JSONBデータ** | ✅ 高い | JSON更新 | 不要 |
| **races固定カラム** | ⚠️ 低い | ALTER TABLE | 必要 |
| **racers固定カラム** | ⚠️ 低い | ALTER TABLE | 必要 |

### 改善後の設計

| 項目 | 拡張性 | 追加方法 | マイグレーション |
|------|--------|---------|----------------|
| **モデル追加** | ✅ 高い | INSERTのみ | 不要 |
| **JSONBデータ** | ✅ 高い | JSON更新 | 不要 |
| **races固定カラム** | ✅ 高い | metadata更新 | 不要（初回のみ） |
| **racers固定カラム** | ✅ 高い | metadata更新 | 不要（初回のみ） |

---

## 🔧 推奨される改善スキーマ

### 1. racesテーブル（改善版）

```sql
CREATE TABLE races (
    race_id VARCHAR(20) PRIMARY KEY,
    date DATE NOT NULL,
    venue_code INTEGER NOT NULL REFERENCES venues(venue_code),
    race_number INTEGER NOT NULL,
    start_time TIME,
    -- 既存の固定カラム
    weather VARCHAR(20),
    air_temp DECIMAL(4,1),
    wind_direction INTEGER,
    wind_velocity DECIMAL(4,1),
    water_temp DECIMAL(4,1),
    wave_height INTEGER,
    -- 拡張用カラム（追加）
    metadata JSONB DEFAULT '{}'::jsonb,  -- 将来の拡張データ用
    scraped_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, venue_code, race_number)
);

-- JSONB検索用インデックス
CREATE INDEX idx_races_metadata ON races USING GIN (metadata);
```

---

### 2. racersテーブル（改善版）

```sql
CREATE TABLE racers (
    id SERIAL PRIMARY KEY,
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    lane INTEGER NOT NULL,
    name VARCHAR(50) NOT NULL,
    grade VARCHAR(5),
    age INTEGER,
    -- 既存の固定カラム
    global_win_rate DECIMAL(5,2),
    global_2_rate DECIMAL(5,2),
    local_win_rate DECIMAL(5,2),
    local_2_rate DECIMAL(5,2),
    motor_number INTEGER,
    motor_2_rate DECIMAL(5,2),
    boat_number INTEGER,
    boat_2_rate DECIMAL(5,2),
    -- 拡張用カラム（追加）
    metadata JSONB DEFAULT '{}'::jsonb,  -- 将来の拡張データ用
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(race_id, lane)
);

-- JSONB検索用インデックス
CREATE INDEX idx_racers_metadata ON racers USING GIN (metadata);
```

---

### 3. prediction_modelsテーブル（オプション）

```sql
CREATE TABLE prediction_models (
    model_code VARCHAR(20) PRIMARY KEY,
    model_name VARCHAR(50) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,  -- 表示順序
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 初期データ
INSERT INTO prediction_models (model_code, model_name, description, display_order) VALUES
('standard', 'スタンダード', 'バランス重視の万能型モデル', 1),
('safeBet', '本命狙い', '堅実な的中率を追求するモデル', 2),
('upsetFocus', '穴狙い', '高配当を狙う逆張り型モデル', 3);
```

---

## 📝 拡張時の実装手順

### ケース1: 新しいスクレイピングデータの追加

**例: 湿度データを追加**

```sql
-- 方法1: metadata JSONBを使用（推奨）
UPDATE races 
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{humidity}',
  '65.5'::jsonb
)
WHERE race_id = '2025-12-05-01-01';

-- 方法2: 固定カラムを追加（頻繁に使用する場合）
ALTER TABLE races ADD COLUMN humidity DECIMAL(4,1);
CREATE INDEX idx_races_humidity ON races(humidity);
```

**推奨:**
- 頻繁に使用するデータ → 固定カラムを追加
- 実験的なデータ → metadata JSONBを使用

---

### ケース2: 新しいモデルの追加

**例: 'advanced' モデルを追加**

```sql
-- 1. モデルマスタに追加（オプション）
INSERT INTO prediction_models (model_code, model_name, description) VALUES
('advanced', 'アドバンス', '機械学習を活用した高度なモデル');

-- 2. 予想データを挿入
INSERT INTO predictions (race_id, model_type, top_pick, top3, ...)
VALUES ('2025-12-05-01-01', 'advanced', 2, [2, 1, 4], ...);

-- 3. 統計データを計算（既存のロジックを使用）
-- calculate-accuracy.js を実行すると自動的に統計が更新される
```

**注意点:**
- `volatility.recommended_model` も新しいモデルに対応する必要がある
- フロントエンドで新しいモデルを表示する必要がある

---

### ケース3: 新しい選手データの追加

**例: スタート成績データを追加**

```sql
-- metadata JSONBを使用（推奨）
UPDATE racers 
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{startPerformance}',
  '{
    "avgStartTime": 0.45,
    "goodStartRate": 0.75,
    "recentStarts": [0.42, 0.48, 0.44]
  }'::jsonb
)
WHERE race_id = '2025-12-05-01-01' AND lane = 1;

-- クエリ例
SELECT 
  name,
  metadata->'startPerformance'->>'avgStartTime' as avg_start_time,
  metadata->'startPerformance'->>'goodStartRate' as good_start_rate
FROM racers
WHERE race_id = '2025-12-05-01-01';
```

---

## ✅ 拡張性チェックリスト

### 現在のスキーマで対応可能

- [x] **モデルの追加** - `predictions.model_type` に新しい値を追加するだけ
- [x] **JSONBデータの拡張** - `ai_scores`, `payouts`, `recovery_*` は拡張可能
- [x] **期間種別の追加** - `accuracy_stats.period_type` に新しい値を追加可能

### 改善が必要

- [ ] **racesテーブルの拡張** - `metadata` JSONBカラムを追加（推奨）
- [ ] **racersテーブルの拡張** - `metadata` JSONBカラムを追加（推奨）
- [ ] **モデル管理** - `prediction_models` テーブルを追加（オプション）

---

## 🎯 推奨事項

### 即座に実装すべき改善

1. **racesテーブルに `metadata` JSONBカラムを追加**
   - 将来のスクレイピングデータ拡張に対応
   - マイグレーション不要でデータ追加可能

2. **racersテーブルに `metadata` JSONBカラムを追加**
   - 将来の選手データ拡張に対応
   - マイグレーション不要でデータ追加可能

### オプションの改善

3. **prediction_modelsテーブルを追加**
   - モデル管理を一元化
   - モデルの有効/無効を制御可能

---

## 📚 参考実装例

### metadata JSONBの活用例

```sql
-- 新しいデータを追加
UPDATE races 
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{newField}',
  '"value"'::jsonb
);

-- 複数のデータを一度に追加
UPDATE races 
SET metadata = metadata || '{"humidity": 65.5, "pressure": 1013.2}'::jsonb
WHERE race_id = '2025-12-05-01-01';

-- データを取得
SELECT 
  race_id,
  metadata->>'humidity' as humidity,
  metadata->>'pressure' as pressure
FROM races
WHERE metadata ? 'humidity';  -- キーの存在確認

-- インデックスを使用した検索
SELECT * FROM races 
WHERE metadata @> '{"humidity": 65.5}'::jsonb;
```

---

## ⚠️ 注意事項

### JSONB使用時の注意点

1. **パフォーマンス**
   - JSONB検索は固定カラムより遅い可能性がある
   - 頻繁に検索するデータは固定カラムを検討

2. **型の一貫性**
   - JSONB内の値の型を統一する
   - 数値は文字列ではなく数値型で保存

3. **インデックス**
   - GINインデックスでJSONB検索を高速化
   - ただし、インデックスサイズが大きくなる可能性

---

## 📊 まとめ

### 現在のスキーマの拡張性

| 項目 | 評価 | 改善案 |
|------|------|--------|
| **モデル追加** | ✅ 高い | 現状のまま |
| **JSONBデータ** | ✅ 高い | 現状のまま |
| **races拡張** | ⚠️ 中程度 | `metadata` JSONB追加 |
| **racers拡張** | ⚠️ 中程度 | `metadata` JSONB追加 |

### 推奨される改善

1. **racesテーブルに `metadata` JSONBカラムを追加**
2. **racersテーブルに `metadata` JSONBカラムを追加**
3. **prediction_modelsテーブルを追加（オプション）**

これらの改善により、将来的な拡張に対して柔軟に対応できるスキーマになります。

