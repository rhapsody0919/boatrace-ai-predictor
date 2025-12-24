# JSONBデータ型の説明

## 📋 概要

**JSONB**は、PostgreSQLが提供する**JSONデータを効率的に保存・検索できるデータ型**です。

---

## 🔍 JSONBとは？

### 基本的な説明

**JSONB = JSON Binary（JSONバイナリ）**

- **JSON形式のデータ**をそのままデータベースに保存できる
- **検索やインデックス**が可能
- **構造化されていないデータ**を柔軟に保存できる

### 通常のカラムとの違い

#### 通常のカラム（固定構造）
```sql
-- 固定カラムの場合
CREATE TABLE races (
    air_temp DECIMAL(4,1),  -- 気温のみ
    humidity DECIMAL(4,1),  -- 新しいデータを追加するにはALTER TABLEが必要
    pressure DECIMAL(6,2)   -- さらに追加するにはまたALTER TABLEが必要
);
```

**問題点:**
- 新しいデータを追加するたびに `ALTER TABLE` が必要
- マイグレーションが必要
- スキーマ変更が大変

#### JSONBカラム（柔軟な構造）
```sql
-- JSONBカラムの場合
CREATE TABLE races (
    air_temp DECIMAL(4,1),  -- よく使うデータは固定カラム
    metadata JSONB          -- 将来の拡張データはJSONBに
);
```

**メリット:**
- 新しいデータを追加する際、スキーマ変更不要
- 柔軟にデータを保存できる
- 検索も可能（GINインデックス使用）

---

## 💡 具体例

### 例1: レース情報の拡張

#### 現在のデータ
```json
{
  "air_temp": 18.5,
  "wind_velocity": 3.2
}
```

#### 将来、新しいデータを追加したい場合

**固定カラムの場合:**
```sql
-- マイグレーションが必要
ALTER TABLE races ADD COLUMN humidity DECIMAL(4,1);
ALTER TABLE races ADD COLUMN pressure DECIMAL(6,2);
ALTER TABLE races ADD COLUMN visibility DECIMAL(4,1);
-- データを追加するたびにALTER TABLEが必要
```

**JSONBの場合:**
```sql
-- マイグレーション不要、すぐに追加可能
UPDATE races 
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{humidity}',
  '65.5'::jsonb
)
WHERE race_id = '2025-12-05-01-01';

-- さらに追加も簡単
UPDATE races 
SET metadata = metadata || '{"pressure": 1013.2, "visibility": 10.5}'::jsonb
WHERE race_id = '2025-12-05-01-01';
```

**保存されるデータ:**
```json
{
  "humidity": 65.5,
  "pressure": 1013.2,
  "visibility": 10.5
}
```

---

### 例2: 選手データの拡張

#### 現在のデータ
```json
{
  "name": "山田太郎",
  "global_win_rate": 5.50,
  "motor_2_rate": 35.2
}
```

#### 将来、スタート成績を追加したい場合

**JSONBの場合:**
```sql
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
```

**保存されるデータ:**
```json
{
  "startPerformance": {
    "avgStartTime": 0.45,
    "goodStartRate": 0.75,
    "recentStarts": [0.42, 0.48, 0.44]
  }
}
```

---

## 🔍 JSONBの検索方法

### 1. キーの存在確認

```sql
-- 湿度データがあるレースを検索
SELECT * FROM races 
WHERE metadata ? 'humidity';
```

### 2. 値の取得

```sql
-- 湿度の値を取得
SELECT 
  race_id,
  metadata->>'humidity' as humidity
FROM races
WHERE metadata ? 'humidity';
```

### 3. 値での検索

```sql
-- 湿度が65以上のレースを検索
SELECT * FROM races 
WHERE (metadata->>'humidity')::float > 65;
```

### 4. ネストされたデータの検索

```sql
-- スタート成績の平均スタートタイムを取得
SELECT 
  name,
  metadata->'startPerformance'->>'avgStartTime' as avg_start_time
FROM racers
WHERE metadata ? 'startPerformance';
```

---

## 📊 JSONB vs 通常のカラム

### 比較表

| 項目 | 通常のカラム | JSONBカラム |
|------|------------|------------|
| **構造** | 固定 | 柔軟 |
| **新しいデータ追加** | ALTER TABLE必要 | UPDATEのみ |
| **マイグレーション** | 必要 | 不要 |
| **検索速度** | 高速 | インデックスで高速 |
| **型チェック** | 厳密 | 緩い（注意が必要） |
| **使用場面** | 頻繁に使用するデータ | 拡張性が必要なデータ |

---

## 🎯 このプロジェクトでの使用例

### 1. predictions.ai_scores（JSONB）

**目的:** 各艇のAIスコアを保存

```json
{
  "1": 3253,
  "2": 2890,
  "3": 2456,
  "4": 2389,
  "5": 1838,
  "6": 1324
}
```

**メリット:**
- 新しいスコア項目を追加してもスキーマ変更不要
- 例: `{"1": 3253, "newScore": 150}` のように追加可能

---

### 2. results.payouts（JSONB）

**目的:** 払戻金データを保存

```json
{
  "win": {"1": 320},
  "place": {"1": 110, "4": 240},
  "trifecta": {"1-3-4": 1850},
  "trio": {"1-4-3": 5420}
}
```

**メリット:**
- 新しい券種を追加してもスキーマ変更不要
- 例: `{"win": {...}, "newBetType": {...}}` のように追加可能

---

### 3. races.metadata（JSONB）- 改善案

**目的:** 将来のスクレイピングデータを保存

```json
{
  "humidity": 65.5,
  "pressure": 1013.2,
  "visibility": 10.5
}
```

**メリット:**
- 新しい天候データを追加してもスキーマ変更不要
- 実験的なデータも保存可能

---

### 4. racers.metadata（JSONB）- 改善案

**目的:** 将来の選手データを保存

```json
{
  "startPerformance": {
    "avgStartTime": 0.45,
    "goodStartRate": 0.75
  },
  "coursePerformance": {
    "innerCourseRate": 0.60,
    "outerCourseRate": 0.40
  }
}
```

**メリット:**
- 新しい選手データを追加してもスキーマ変更不要
- 複雑な構造のデータも保存可能

---

## ⚠️ 注意事項

### 1. パフォーマンス

**JSONB検索は固定カラムより遅い可能性がある**

**対策:**
- 頻繁に検索するデータは固定カラムを使用
- JSONB検索にはGINインデックスを使用

```sql
-- GINインデックスで高速化
CREATE INDEX idx_races_metadata ON races USING GIN (metadata);
```

---

### 2. 型の一貫性

**JSONB内の値の型を統一する**

**悪い例:**
```json
{
  "humidity": "65.5",  // 文字列
  "pressure": 1013.2   // 数値
}
```

**良い例:**
```json
{
  "humidity": 65.5,    // 数値
  "pressure": 1013.2   // 数値
}
```

---

### 3. NULL値の扱い

**JSONBはNULLを扱える**

```sql
-- NULLチェック
SELECT * FROM races 
WHERE metadata IS NULL OR metadata = '{}'::jsonb;

-- キーの存在確認
SELECT * FROM races 
WHERE metadata ? 'humidity';
```

---

## 🔧 実用的なクエリ例

### 1. データの追加

```sql
-- 単一の値を追加
UPDATE races 
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{humidity}',
  '65.5'::jsonb
)
WHERE race_id = '2025-12-05-01-01';

-- 複数の値を一度に追加
UPDATE races 
SET metadata = metadata || '{"humidity": 65.5, "pressure": 1013.2}'::jsonb
WHERE race_id = '2025-12-05-01-01';
```

---

### 2. データの取得

```sql
-- 単一の値を取得
SELECT metadata->>'humidity' as humidity FROM races;

-- ネストされた値を取得
SELECT metadata->'startPerformance'->>'avgStartTime' as avg_start_time 
FROM racers;

-- 型変換して取得
SELECT (metadata->>'humidity')::float as humidity FROM races;
```

---

### 3. データの検索

```sql
-- キーの存在確認
SELECT * FROM races WHERE metadata ? 'humidity';

-- 値での検索
SELECT * FROM races 
WHERE (metadata->>'humidity')::float > 65;

-- JSONB演算子での検索
SELECT * FROM races 
WHERE metadata @> '{"humidity": 65.5}'::jsonb;
```

---

### 4. データの更新

```sql
-- 既存の値を更新
UPDATE races 
SET metadata = jsonb_set(metadata, '{humidity}', '70.0'::jsonb)
WHERE race_id = '2025-12-05-01-01';

-- 複数の値を更新
UPDATE races 
SET metadata = metadata || '{"humidity": 70.0, "pressure": 1015.0}'::jsonb
WHERE race_id = '2025-12-05-01-01';
```

---

### 5. データの削除

```sql
-- キーを削除
UPDATE races 
SET metadata = metadata - 'humidity'
WHERE race_id = '2025-12-05-01-01';

-- 複数のキーを削除
UPDATE races 
SET metadata = metadata - ARRAY['humidity', 'pressure']
WHERE race_id = '2025-12-05-01-01';
```

---

## 📚 JSONB演算子一覧

| 演算子 | 説明 | 例 |
|--------|------|-----|
| `->` | JSONオブジェクトのキーで値を取得（JSONB型） | `metadata->'humidity'` |
| `->>` | JSONオブジェクトのキーで値を取得（テキスト型） | `metadata->>'humidity'` |
| `?` | キーの存在確認 | `metadata ? 'humidity'` |
| `?&` | すべてのキーが存在するか確認 | `metadata ?& ARRAY['humidity', 'pressure']` |
| `?\|` | いずれかのキーが存在するか確認 | `metadata ?\| ARRAY['humidity', 'pressure']` |
| `@>` | 左側が右側を含むか確認 | `metadata @> '{"humidity": 65.5}'::jsonb` |
| `<@` | 左側が右側に含まれるか確認 | `'{"humidity": 65.5}'::jsonb <@ metadata` |
| `\|\|` | JSONBオブジェクトを結合 | `metadata \|\| '{"new": "value"}'::jsonb` |
| `-` | キーを削除 | `metadata - 'humidity'` |

---

## 🎯 まとめ

### JSONBとは

- **JSON形式のデータ**をデータベースに保存できる型
- **柔軟な構造**で、新しいデータを追加しやすい
- **検索も可能**（GINインデックス使用）

### このプロジェクトでの使い方

1. **よく使うデータ** → 固定カラム（`air_temp`, `wind_velocity`など）
2. **将来拡張する可能性があるデータ** → JSONB（`metadata`）
3. **複雑な構造のデータ** → JSONB（`payouts`, `ai_scores`）

### メリット

- ✅ スキーマ変更不要でデータ追加可能
- ✅ 柔軟なデータ構造
- ✅ 検索も可能（インデックス使用）

### デメリット

- ⚠️ 固定カラムより検索が遅い可能性（インデックスで改善）
- ⚠️ 型チェックが緩い（注意が必要）

---

## 📖 参考資料

- PostgreSQL JSONB公式ドキュメント: https://www.postgresql.org/docs/current/datatype-json.html
- JSONB演算子: https://www.postgresql.org/docs/current/functions-json.html

