# スクレイピング・Supabase データフロー比較

## 概要

現在のデータフローにおける、DBスキーマ定義 vs 実際の書き込み処理の乖離を整理。

---

## 1. races テーブル

### スキーマ定義
| カラム | 型 | 説明 |
|--------|-----|------|
| race_id | VARCHAR(20) | PK |
| race_date | DATE | 必須 |
| venue_code | SMALLINT | 必須 |
| race_number | SMALLINT | 必須 |
| start_time | TIME | |
| volatility_score | SMALLINT | |
| volatility_level | VARCHAR(10) | |
| recommended_model | VARCHAR(50) | |
| volatility_reasons | JSONB | |
| first_boat_grade | VARCHAR(5) | |
| first_boat_win_rate | DECIMAL(5,3) | |
| first_boat_motor_2rate | DECIMAL(5,2) | |
| win_rate_stddev | DECIMAL(5,3) | |
| win_rate_avg | DECIMAL(5,3) | |
| motor_2rate_stddev | DECIMAL(5,2) | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### 実際の書き込み (generate-predictions.js)

**状況: ✅ 完全一致** — 全カラム書き込み済み

---

## 2. race_entries テーブル

### スキーマ定義
| カラム | 型 | 説明 |
|--------|-----|------|
| race_id | VARCHAR(20) | PK |
| boat_number | SMALLINT | PK |
| player_name | VARCHAR(50) | |
| grade | VARCHAR(5) | |
| age | SMALLINT | |
| win_rate | DECIMAL(5,3) | 全国勝率 |
| global_2rate | DECIMAL(5,2) | 全国2連率 |
| local_win_rate | DECIMAL(5,3) | 当地勝率 |
| local_2rate | DECIMAL(5,2) | 当地2連率 |
| motor_number | SMALLINT | |
| motor_2rate | DECIMAL(5,2) | |
| boat_number_id | SMALLINT | |
| boat_2rate | DECIMAL(5,2) | |
| ai_score_standard | INTEGER | |
| ai_score_safe_bet | INTEGER | |
| ai_score_upset_focus | INTEGER | |
| racer_id | INTEGER | 選手登録番号 |

### 実際の書き込み

**状況: ✅ 完全一致** — global_2rate, local_2rate 含め全カラム書き込み済み

---

## 3. predictions テーブル

### スキーマ定義
| カラム | 型 | 説明 |
|--------|-----|------|
| prediction_id | SERIAL | PK |
| race_id | VARCHAR(20) | FK |
| model_id | VARCHAR(50) | FK |
| top_pick | SMALLINT | 必須 |
| top_2nd | SMALLINT | |
| top_3rd | SMALLINT | |
| confidence | SMALLINT | |
| scores | JSONB | |
| feature_contributions | JSONB | |
| is_hit_win | BOOLEAN | |
| is_hit_place | BOOLEAN | |
| is_hit_trifecta | BOOLEAN | |
| is_hit_trio | BOOLEAN | |
| payout_win | INTEGER | |
| payout_place | INTEGER | |
| payout_trifecta | INTEGER | |
| payout_trio | INTEGER | |
| is_shadow | BOOLEAN | |
| predicted_at | TIMESTAMPTZ | |

### 実際の書き込み
| カラム | generate-predictions.js | scrape-results.js | 状況 |
|--------|------------------------|-------------------|------|
| race_id〜top_3rd | ✅ | - | |
| confidence | ✅ | - | |
| scores | ❌ 未使用 | - | スキーマのみ |
| feature_contributions | ✅ | - | turnPrediction + racerStats を保存（下記参照） |
| is_hit_* | - | ✅ | |
| payout_* | - | ✅ | |
| is_shadow | ✅ | - | |

**状況: ⚠️ scores のみ未使用**

### feature_contributions の内容

`generate-predictions.js` が書き込む JSONB データ:

| キー | 内容 | フロントエンドでの用途 |
|------|------|----------------------|
| `turnPrediction.patterns` | 上位3展開パターン（コース・決まり手・確率） | FirstMarkAnimation |
| `turnPrediction.distribution` | 各コース勝率分布 | FirstMarkAnimation |
| `turnPrediction.boatStrengths` | 各艇の総合力 | FirstMarkAnimation |
| `racerStats` | 6艇の攻撃/防御分布・コース別レース数 | AttackDefenseTable |

### 対応方針
- `scores`: 現状不要。優先度低

---

## 4. race_results テーブル

### スキーマ定義
| カラム | 型 | 説明 |
|--------|-----|------|
| race_id | VARCHAR(20) | PK |
| rank1 | SMALLINT | 必須 |
| rank2 | SMALLINT | 必須 |
| rank3 | SMALLINT | 必須 |
| payout_win | INTEGER | |
| payout_place_1 | INTEGER | |
| payout_place_2 | INTEGER | |
| payout_trifecta | INTEGER | 3連単 |
| payout_trio | INTEGER | 3連複 |
| is_cancelled | BOOLEAN | |
| is_no_race | BOOLEAN | |
| course_1〜6 | SMALLINT | 進入コース |
| winning_technique | VARCHAR(20) | 決まり手 |
| result_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

### 実際の書き込み (scrape-results.js)

| カラム | 書き込み | 状況 |
|--------|---------|------|
| rank1〜3 | ✅ | |
| payout_* | ✅ | |
| course_1〜6 | ✅ | |
| winning_technique | ✅ | |
| is_cancelled | ❌ 未取得 | |
| is_no_race | ❌ 未取得 | |
| result_at | ✅ | |

**状況: ⚠️ 中止・不成立フラグが未取得**

### 対応方針
- `is_cancelled` / `is_no_race`: レース結果ページで結果が取得できない場合のハンドリングとして実装する
  - 現状はスキップされるだけで、中止レースが永遠に「未取得」状態のまま残る
  - 優先度: 低（発生頻度が低く、精度計算への影響も軽微）

---

## 5. race_conditions テーブル

### スキーマ定義
| カラム | 型 | 説明 |
|--------|-----|------|
| race_id | VARCHAR(20) | PK |
| weather | VARCHAR(10) | |
| wind_direction | VARCHAR(10) | |
| wind_speed | DECIMAL(4,1) | |
| wave_height | SMALLINT | |
| temperature | DECIMAL(4,1) | 気温 |
| water_temperature | DECIMAL(4,1) | 水温 |
| race_grade | VARCHAR(10) | SG/G1等 |
| race_title | VARCHAR(100) | |
| series_day | SMALLINT | 節何日目 |
| is_final_day | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

### 実際の書き込み (generate-predictions.js)

| カラム | 書き込み | 状況 |
|--------|---------|------|
| weather〜water_temperature | ✅ | scrape-to-json.jsで取得 → generate-predictions.jsでupsert |
| race_grade | ✅ | |
| race_title | ✅ | |
| series_day | ❌ 未取得 | |
| is_final_day | ❌ 未取得 | |

**状況: ⚠️ 節情報が未取得**

### 対応方針
- `series_day` / `is_final_day`: beforeinfo ページの「○日目」表記から取得可能
  - 優先度: 中（将来の予測モデル改善時に対応）

---

## 6. exhibition_data テーブル

### スキーマ定義
| カラム | 型 | 説明 |
|--------|-----|------|
| race_id | VARCHAR(20) | PK |
| boat_number | SMALLINT | PK |
| exhibition_time | DECIMAL(5,2) | 展示タイム |
| start_timing | DECIMAL(4,2) | 展示ST |
| created_at | TIMESTAMPTZ | |

### 実際の書き込み (generate-predictions.js)

**状況: ✅ 実装済み・運用中** — scrape-to-json.js で取得 → generate-predictions.js で upsert

- 毎時のフルパイプライン (scrape.yml) で取得
- 15分間隔の展示専用ワークフロー (scrape-exhibition.yml, JST 9-17時) でも取得
- フロントエンドからも `exhibition_data` テーブルを直接参照

### 既知の課題
- 展示データのタイミング問題 → 15分間隔ワークフローで改善済み（詳細は [DATA_SCRAPING_GAPS.md](../issues/DATA_SCRAPING_GAPS.md)）

---

## 7. race_start_timings テーブル

### スキーマ定義
| カラム | 型 | 説明 |
|--------|-----|------|
| race_id | VARCHAR(20) | PK |
| boat_number | SMALLINT | PK |
| start_timing | DECIMAL(4,2) | 本番ST |
| is_flying | BOOLEAN | フライング |
| is_late_start | BOOLEAN | 出遅れ |
| created_at | TIMESTAMPTZ | |

### 実際の書き込み (scrape-results.js)

**状況: ✅ 実装済み** — raceresult ページから取得・upsert

---

## 8. 未使用テーブル（スキーマ定義済み、書き込み処理なし）

| テーブル | 用途 | 対応方針 |
|----------|------|---------|
| race_odds | オッズ情報 | 期待値計算に必須。優先度: 高（配当妙味機能の実装時に対応） |
| bet_filters | 賭けフィルタ条件 | 配当妙味機能の一部。優先度: 中 |
| bet_recommendations | 賭け推奨 | 同上 |
| daily_bet_summary | 日次集計 | 同上 |
| user_visible_summary | 公開サマリー | 同上 |
| model_performance_daily | モデル日次成績 | 精度ダッシュボード改善時に対応。優先度: 低 |
| model_experiments | A/Bテスト | 将来のモデル比較実験用。優先度: 低 |

---

## 9. 未取得だが取得可能なデータ

| データ | 取得元 | 用途 | 優先度 |
|--------|--------|------|--------|
| 支部・出身地 | racelist ページ | 地元選手の有利不利分析 | 低 |
| 体重 | racelist ページ | 展示タイムとの相関分析 | 低 |
| 節情報（何日目） | beforeinfo ページ | 最終日の傾向分析 | 中 |
| 2連単/2連複/拡連複配当 | raceresult ページ | 配当分析の充実 | 低 |
| 単勝オッズ | odds ページ | 期待値計算 | 高 |
| レース中止フラグ | raceresult ページ | データクリーニング | 低 |

---

## データフロー図

```
[ボートレース公式サイト]
        │
        ▼
┌─────────────────────┐
│  scrape-to-json.js  │ ── data/races.json
└─────────────────────┘    (出走表・天候・展示データ)
        │
        ▼
┌───────────────────────────┐
│  generate-predictions.js  │  ← racer_aggregated_stats (攻防分布)
└───────────────────────────┘
        │
        ├─▶ races テーブル (✅ 完全)
        ├─▶ race_entries テーブル (✅ 完全)
        ├─▶ predictions テーブル (✅ feature_contributions: turnPrediction + racerStats)
        ├─▶ race_conditions テーブル (⚠️ 節情報未取得)
        └─▶ exhibition_data テーブル (✅ 運用中)

[15分間隔ワークフロー (scrape-exhibition.yml)]
        │ JST 9:00-17:00
        └─▶ 上記と同じ (scrape-to-json → generate-predictions、Supabaseのみ)

[レース終了後]
        │
        ▼
┌─────────────────────┐
│  scrape-results.js  │
└─────────────────────┘
        │
        ├─▶ race_results テーブル (⚠️ 中止フラグ未取得)
        ├─▶ race_start_timings テーブル (✅ 運用中)
        └─▶ predictions テーブル (的中フラグ・配当更新)

[未実装]
        │
        ├─✗ race_odds テーブル（期待値計算で対応予定）
        └─✗ bet_* テーブル群（同上）
```
