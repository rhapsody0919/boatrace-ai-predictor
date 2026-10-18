# race_conditions テーブル設計

## 概要

`race_conditions` テーブルは、各レースの **天候・気象情報** を格納するテーブルです。レースの進行に伴い、気象データが変化するため、**バックエンド内部で使用**され、フロントエンドには返却されません。

---

## テーブルスキーマ

```sql
CREATE TABLE race_conditions (
  race_id TEXT PRIMARY KEY,           -- YYYY-MM-DD-VV-RR
  weather TEXT,                       -- 天候（晴、曇り、雨など）
  wind_direction TEXT,                -- 風向（北、北東など）
  wind_speed NUMERIC,                 -- 風速 (m/s)
  wave_height NUMERIC,                -- 波高 (cm)
  temperature NUMERIC,                -- 気温 (°C)
  water_temperature NUMERIC,          -- 水温 (°C)
  race_title TEXT,                    -- レースタイトル（廃止予定）
  series_day INT,                     -- シリーズ開催日（未使用）
  is_final_day BOOLEAN,               -- 最終日フラグ（未使用）
  created_at TIMESTAMP                -- 作成日時
);
```

**注**: `race_grade` カラムは 2026-05-05 に削除されました。詳細は「廃止カラム」を参照。

---

## データフロー

### 1️⃣ 朝のバッチ（generate-predictions.js）

```
boatrace.jp スクレイピング
  ↓
天候・気象情報を抽出
  ↓
race_conditions.upsert({
  race_id, weather, wind_direction, wind_speed,
  wave_height, temperature, water_temperature,
  race_title
})
```

**実行時刻**: 毎朝 5:00-6:30 JST  
**対象**: 本日のすべてのレース  
**更新頻度**: 初回のみ（朝のバッチで一度だけ）

---

### 2️⃣ 発走60分前（update-race-info.js）

```
boatrace.jp 最新情報を再スクレイピング
  ↓
該当レースの天候・気象情報が変わっていないか確認
  ↓
変化がある場合のみ race_conditions を更新
```

**実行時刻**: 発走60分前  
**対象**: 該当レースのみ  
**更新頻度**: 気象変化があった場合のみ

---

## 使用箇所

### バックエンド内部

#### generate-predictions.js（リフレッシュモード）

リフレッシュモードでは、レース直前に天候が変わった場合、予想スコアを再計算する必要があります。

```javascript
// リフレッシュモードで race_conditions から天候データを読み込み
const cond = conditionsByRace.get(raceId) || {};
const race = racesByRace.get(raceId) || {};

races.push({
  raceId,
  weather: cond.weather || null,           // race_conditions から
  airTemp: cond.temperature ?? null,       // race_conditions から
  windVelocity: cond.wind_speed ?? null,   // race_conditions から
  waveHeight: cond.wave_height ?? null,    // race_conditions から
  raceGrade: race.race_grade || null,      // races から（2026-05-05 より）
  // ...
});
```

**役割**: 気象変化の検出と、イン崩れ指数の再計算

---

## フロントエンドに返却されないデータ

フロントエンド API（`api/races/today.js`、`api/predictions/[date].js`）は、`race_conditions` テーブルを **JOIN しません**。

```javascript
// api/races/today.js
const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_today_races`, {
  // RPC: get_today_races()
  // JOINs: races + race_entries + exhibition_data
  // NOT includes: race_conditions
});
```

**理由**:
- 天候情報そのものはフロントエンドで使用されない
- フロントエンドに必要な情報は、バックエンドで計算済みの **イン崩れ指数（volatility_score）** で、天候は既に因子に含まれている
- 個別の気象データを公開する必要がない

---

## 廃止カラム

### race_grade（2026-05-05 削除）

**何が変わった**:
- **以前**: `race_conditions.race_grade` がバッチで書き込まれていた
- **現在**: `races.race_grade` が唯一の Source of Truth

**理由**:
- グレード情報は朝のバッチで一度確定し、発走60分前に再取得される
- バッチ（generate-predictions.js）と発走60分前（update-race-info.js）の両方が `race_grade` を書き込んでいた → 二重管理
- `races` テーブルに統一することで、データの一貫性を確保

**マイグレーション**:
```sql
-- 2026-05-05 実行済み
ALTER TABLE race_conditions DROP COLUMN IF EXISTS race_grade;
```

過去データについては、すべて `races.race_grade` に反映済み。

---

## 未使用カラム

| カラム | 理由 |
|---|---|
| `race_title` | race_conditions に格納されているが、フロントで使用されていない。廃止予定 |
| `series_day` | シリーズ開催日。現在は設定されていない。廃止予定 |
| `is_final_day` | 最終日フラグ。現在は設定されていない。廃止予定 |

---

## 設計のポイント

### 1. バックエンド専用のテーブル
- race_conditions は「バックエンドの計算材料」であり、フロントエンドへの直接返却を前提としない
- イン崩れ指数（volatility_score）という集約指標に変換してからフロントに返却

### 2. 朝のバッチと発走60分前の分離
- **朝のバッチ**: 本日全レースの基本データを一括取得・初期化
- **発走60分前**: 該当レースのみ「最新の気象変化」を検出・更新
- リアルタイムで気象データが変わる可能性に対応

### 3. Source of Truth の明確化
- race_grade: `races` テーブル（確定情報）
- 天候情報: `race_conditions` テーブル（変動可能性あり）
- 予想結果: `predictions` テーブル（固定）

---

## 参考

- `docs/archive/api-architecture-analysis.md` - API・RPC アーキテクチャ分析
- `scripts/daily/generate-predictions.js` - バッチスクリプト実装
- `scripts/daily/update-race-info.js` - 発走60分前スクリプト実装
