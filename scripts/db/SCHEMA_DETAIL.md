# データベーススキーマ詳細設計書

## 📊 テーブル一覧

1. `venues` - ボートレース場マスタ
2. `races` - レース情報
3. `racers` - 選手データ
4. `predictions` - AI予想データ
5. `volatility` - 荒れ度スコア
6. `results` - レース結果
7. `accuracy_stats` - 的中率統計
8. `venue_recommendations` - 会場別推奨モデル

---

## 1. venues - ボートレース場マスタ

**目的:** 24会場のマスタデータを保持

**カラム:**
- `venue_code` (INTEGER, PRIMARY KEY) - 会場コード（1-24）
- `venue_name` (VARCHAR(50)) - 会場名（桐生、戸田、...）
- `created_at` (TIMESTAMP) - 作成日時
- `updated_at` (TIMESTAMP) - 更新日時

**初期データ:**
```sql
INSERT INTO venues (venue_code, venue_name) VALUES
(1, '桐生'), (2, '戸田'), (3, '江戸川'), (4, '平和島'), (5, '多摩川'), (6, '浜名湖'),
(7, '蒲郡'), (8, '常滑'), (9, '津'), (10, '三国'), (11, 'びわこ'), (12, '住之江'),
(13, '尼崎'), (14, '鳴門'), (15, '丸亀'), (16, '児島'), (17, '宮島'), (18, '徳山'),
(19, '下関'), (20, '若松'), (21, '芦屋'), (22, '福岡'), (23, '唐津'), (24, '大村');
```

---

## 2. races - レース情報

**目的:** レースの基本情報を保持

**カラム:**
- `race_id` (VARCHAR(20), PRIMARY KEY) - レースID（'2025-12-05-01-01'形式）
- `date` (DATE) - レース日
- `venue_code` (INTEGER, FK → venues) - 会場コード
- `race_number` (INTEGER) - レース番号（1-12）
- `start_time` (TIME) - 開始時刻
- `weather` (VARCHAR(20)) - 天候
- `air_temp` (DECIMAL(4,1)) - 気温
- `wind_direction` (INTEGER) - 風向
- `wind_velocity` (DECIMAL(4,1)) - 風速
- `water_temp` (DECIMAL(4,1)) - 水温
- `wave_height` (INTEGER) - 波高
- `metadata` (JSONB) - 将来の拡張データ用（湿度、気圧など）
- `scraped_at` (TIMESTAMP) - スクレイピング日時
- `created_at` (TIMESTAMP) - 作成日時
- `updated_at` (TIMESTAMP) - 更新日時

**制約:**
- `UNIQUE(date, venue_code, race_number)` - 同じ日・会場・レース番号の重複を防止

**インデックス:**
- `idx_races_date` - 日付での検索
- `idx_races_venue` - 会場での検索
- `idx_races_date_venue` - 日付×会場での検索
- `idx_races_metadata` - JSONB検索用（GINインデックス）

**拡張性:**
- `metadata` JSONBカラムで将来のスクレイピングデータ（湿度、気圧など）を追加可能
- 詳細は `docs/db-migration/SCHEMA_EXTENSIBILITY.md` を参照

**race_id の生成ルール:**
```javascript
const raceId = `${date}-${String(venueCode).padStart(2, '0')}-${String(raceNumber).padStart(2, '0')}`;
// 例: "2025-12-05-01-01"
```

---

## 3. racers - 選手データ

**目的:** 各レースの選手情報を保持（1レースあたり6艇）

**カラム:**
- `id` (SERIAL, PRIMARY KEY) - 自動採番ID
- `race_id` (VARCHAR(20), FK → races) - レースID
- `lane` (INTEGER) - 艇番（1-6）
- `name` (VARCHAR(50)) - 選手名
- `grade` (VARCHAR(5)) - 級別（A1, A2, B1, B2）
- `age` (INTEGER) - 年齢
- `global_win_rate` (DECIMAL(5,2)) - 全国勝率
- `global_2_rate` (DECIMAL(5,2)) - 全国2連率
- `local_win_rate` (DECIMAL(5,2)) - 当地勝率
- `local_2_rate` (DECIMAL(5,2)) - 当地2連率
- `motor_number` (INTEGER) - モーター番号
- `motor_2_rate` (DECIMAL(5,2)) - モーター2連率
- `boat_number` (INTEGER) - ボート番号
- `boat_2_rate` (DECIMAL(5,2)) - ボート2連率
- `metadata` (JSONB) - 将来の拡張データ用（スタート成績、コース取り成績など）
- `created_at` (TIMESTAMP) - 作成日時

**制約:**
- `UNIQUE(race_id, lane)` - 同じレースで同じ艇番の重複を防止

**インデックス:**
- `idx_racers_race_id` - レースIDでの検索
- `idx_racers_metadata` - JSONB検索用（GINインデックス）

**拡張性:**
- `metadata` JSONBカラムで将来の選手データ（スタート成績、コース取り成績など）を追加可能
- 詳細は `docs/db-migration/SCHEMA_EXTENSIBILITY.md` を参照

---

## 4. predictions - AI予想データ

**目的:** 3モデル（standard, safeBet, upsetFocus）の予想データを保持（将来のモデル追加に対応）

**カラム:**
- `id` (SERIAL, PRIMARY KEY) - 自動採番ID
- `race_id` (VARCHAR(20), FK → races) - レースID
- `model_type` (VARCHAR(20)) - モデル種別（'standard', 'safeBet', 'upsetFocus', 将来のモデルも追加可能）
- `top_pick` (INTEGER) - 本命艇番（1-6）
- `top3` (INTEGER[]) - トップ3艇番の配列（例: [1, 4, 3]）
- `confidence` (INTEGER) - 信頼度（70-95）
- `ai_scores` (JSONB) - 各艇のAIスコア（例: {"1": 3253, "2": 2890, ...}）（拡張可能）
- `reasoning` (TEXT[]) - 予想理由の配列
- `generated_at` (TIMESTAMP) - 予想生成日時
- `created_at` (TIMESTAMP) - 作成日時
- `updated_at` (TIMESTAMP) - 更新日時

**制約:**
- `UNIQUE(race_id, model_type)` - 同じレースで同じモデルの重複を防止

**インデックス:**
- `idx_predictions_race_id` - レースIDでの検索
- `idx_predictions_model` - モデル種別での検索

**拡張性:**
- `model_type` に新しいモデル（例: 'advanced'）を追加可能（INSERTのみで対応）
- `ai_scores` JSONBで新しいスコア項目を追加可能
- 詳細は `docs/db-migration/SCHEMA_EXTENSIBILITY.md` を参照

**JSONB の ai_scores 例:**
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

---

## 5. volatility - 荒れ度スコア

**目的:** レース展開の波乱度を評価したスコアを保持

**カラム:**
- `id` (SERIAL, PRIMARY KEY) - 自動採番ID
- `race_id` (VARCHAR(20), FK → races) - レースID
- `score` (INTEGER) - 荒れ度スコア（0-100）
- `level` (VARCHAR(10)) - 荒れ度レベル（'low', 'medium', 'high'）
- `recommended_model` (VARCHAR(20)) - 推奨モデル（'standard', 'safeBet', 'upsetFocus'）
- `reasons` (TEXT[]) - 理由の配列
- `calculated_at` (TIMESTAMP) - 計算日時
- `created_at` (TIMESTAMP) - 作成日時

**制約:**
- `UNIQUE(race_id)` - 1レースに1つの荒れ度スコア

**インデックス:**
- `idx_volatility_race_id` - レースIDでの検索
- `idx_volatility_score` - スコアでの検索

**level と recommended_model の対応:**
- `score < 35` → `level = 'low'`, `recommended_model = 'safeBet'`
- `35 <= score < 65` → `level = 'medium'`, `recommended_model = 'standard'`
- `65 <= score` → `level = 'high'`, `recommended_model = 'upsetFocus'`

---

## 6. results - レース結果

**目的:** レースの結果と払戻金データを保持

**カラム:**
- `id` (SERIAL, PRIMARY KEY) - 自動採番ID
- `race_id` (VARCHAR(20), FK → races) - レースID
- `finished` (BOOLEAN) - レース完了フラグ
- `rank1` (INTEGER) - 1着艇番
- `rank2` (INTEGER) - 2着艇番
- `rank3` (INTEGER) - 3着艇番
- `payouts` (JSONB) - 払戻金データ
- `updated_at` (TIMESTAMP) - 更新日時
- `created_at` (TIMESTAMP) - 作成日時

**制約:**
- `UNIQUE(race_id)` - 1レースに1つの結果

**インデックス:**
- `idx_results_race_id` - レースIDでの検索
- `idx_results_finished` - 完了フラグでの検索

**JSONB の payouts 例:**
```json
{
  "win": {
    "1": 320
  },
  "place": {
    "1": 110,
    "4": 240
  },
  "trifecta": {
    "1-3-4": 1850
  },
  "trio": {
    "1-4-3": 5420
  }
}
```

---

## 7. accuracy_stats - 的中率統計

**目的:** モデル別・会場別・期間別の的中率と回収率を集計して保持

**カラム:**
- `id` (SERIAL, PRIMARY KEY) - 自動採番ID
- `model_type` (VARCHAR(20)) - モデル種別（'standard', 'safeBet', 'upsetFocus'）
- `venue_code` (INTEGER, FK → venues, NULL可) - 会場コード（NULLは全体）
- `period_type` (VARCHAR(20)) - 期間種別（'overall', 'yesterday', 'thisMonth', 'lastMonth', 'daily', 'monthly'）
- `period_value` (DATE, NULL可) - 日別・月別の場合の日付
- `total_races` (INTEGER) - 総レース数
- `finished_races` (INTEGER) - 完了レース数
- `top_pick_hits` (INTEGER) - 本命的中数
- `top_pick_hit_rate` (DECIMAL(5,4)) - 本命的中率
- `top_pick_places` (INTEGER) - 複勝的中数
- `top_pick_place_rate` (DECIMAL(5,4)) - 複勝的中率
- `top3_hits` (INTEGER) - 3連複的中数
- `top3_hit_rate` (DECIMAL(5,4)) - 3連複的中率
- `top3_included_hits` (INTEGER) - 3連単的中数
- `top3_included_rate` (DECIMAL(5,4)) - 3連単的中率
- `recovery_win` (JSONB) - 単勝回収率データ
- `recovery_place` (JSONB) - 複勝回収率データ
- `recovery_trifecta` (JSONB) - 3連複回収率データ
- `recovery_trio` (JSONB) - 3連単回収率データ
- `calculated_at` (TIMESTAMP) - 計算日時
- `created_at` (TIMESTAMP) - 作成日時
- `updated_at` (TIMESTAMP) - 更新日時

**インデックス:**
- `idx_accuracy_stats_model` - モデル種別での検索
- `idx_accuracy_stats_venue` - 会場コードでの検索
- `idx_accuracy_stats_period` - 期間種別×期間値での検索

**JSONB の recovery_* 例:**
```json
{
  "totalInvestment": 12000,
  "totalPayout": 8540,
  "hitCount": 45,
  "recoveryRate": 0.712
}
```

**period_type の説明:**
- `overall` - 全体統計（venue_code が NULL の場合は全体、指定の場合は会場別全体）
- `yesterday` - 前日統計
- `thisMonth` - 今月統計
- `lastMonth` - 先月統計
- `daily` - 日別統計（period_value に日付を指定）
- `monthly` - 月別統計（period_value に月初日を指定）

---

## 8. venue_recommendations - 会場別推奨モデル

**目的:** 会場ごとに最も収益性の高いモデル×券種を保持

**カラム:**
- `id` (SERIAL, PRIMARY KEY) - 自動採番ID
- `venue_code` (INTEGER, FK → venues) - 会場コード
- `period_type` (VARCHAR(20)) - 期間種別（'overall', 'thisMonth'）
- `best_model` (VARCHAR(20)) - 最適モデル（'standard', 'safeBet', 'upsetFocus'）
- `best_bet_type` (VARCHAR(20)) - 最適券種（'win', 'place', 'trifecta', 'trio'）
- `recovery_rate` (DECIMAL(5,4)) - 回収率
- `calculated_at` (TIMESTAMP) - 計算日時
- `created_at` (TIMESTAMP) - 作成日時
- `updated_at` (TIMESTAMP) - 更新日時

**制約:**
- `UNIQUE(venue_code, period_type)` - 同じ会場・期間の重複を防止

**インデックス:**
- `idx_venue_recommendations_venue` - 会場コードでの検索
- `idx_venue_recommendations_period` - 期間種別での検索

---

## 🔗 テーブル間の関係

```
venues (1) ──< (N) races
races (1) ──< (N) racers
races (1) ──< (N) predictions (3モデル分)
races (1) ──< (1) volatility
races (1) ──< (1) results
venues (1) ──< (N) accuracy_stats
venues (1) ──< (N) venue_recommendations
```

---

## 📊 データ量の見積もり

**1日あたりのデータ量:**
- レース数: 約144レース（12会場 × 12レース）
- races: 144レコード
- racers: 144 × 6 = 864レコード
- predictions: 144 × 3 = 432レコード（3モデル）
- volatility: 144レコード
- results: 144レコード（レース終了後）
- accuracy_stats: 約100レコード（モデル別・会場別・期間別）
- venue_recommendations: 48レコード（24会場 × 2期間）

**1年あたりのデータ量:**
- races: 144 × 365 = 52,560レコード
- racers: 864 × 365 = 315,360レコード
- predictions: 432 × 365 = 157,680レコード
- volatility: 144 × 365 = 52,560レコード
- results: 144 × 365 = 52,560レコード
- accuracy_stats: 約36,500レコード（日別統計含む）
- venue_recommendations: 48レコード（更新される）

**ストレージ見積もり:**
- 1レコードあたり平均1KBと仮定
- 1年あたり: 約600MB
- 5年保存: 約3GB

---

## 🔍 よく使うクエリパターン

### 1. 日付でレース一覧を取得
```sql
SELECT r.*, v.venue_name
FROM races r
JOIN venues v ON r.venue_code = v.venue_code
WHERE r.date = '2025-12-05'
ORDER BY r.venue_code, r.race_number;
```

### 2. レースIDで予想データを取得（3モデル）
```sql
SELECT p.*
FROM predictions p
WHERE p.race_id = '2025-12-05-01-01'
ORDER BY p.model_type;
```

### 3. レースIDで結果を取得
```sql
SELECT r.*
FROM results r
WHERE r.race_id = '2025-12-05-01-01'
AND r.finished = true;
```

### 4. モデル別の的中率統計を取得
```sql
SELECT *
FROM accuracy_stats
WHERE model_type = 'standard'
AND period_type = 'overall'
AND venue_code IS NULL
ORDER BY calculated_at DESC
LIMIT 1;
```

### 5. 会場別推奨モデルを取得
```sql
SELECT vr.*, v.venue_name
FROM venue_recommendations vr
JOIN venues v ON vr.venue_code = v.venue_code
WHERE vr.period_type = 'overall'
ORDER BY vr.venue_code;
```

---

## ⚠️ 注意事項

1. **race_id の一意性:** 必ず `date-venue-race` 形式で生成
2. **トランザクション:** 複数テーブルの更新はトランザクションで保護
3. **インデックス:** 検索頻度の高いカラムにインデックスを設定
4. **JSONB:** `payouts`, `ai_scores`, `recovery_*` は JSONB 型を使用
5. **配列型:** `top3`, `reasoning`, `reasons` は配列型を使用

