# API・RPC アーキテクチャ分析

**作成日**: 2026-05-05  
**目的**: `race_grade` の Source of Truth 統一に伴う、API キャッシュ戦略の再検討

---

## 現在のAPI構成

### 1. `api/races/today.js` (Vercel Edge Function)

**呼び出し対象**: `get_today_races()` RPC

**返却データソース**:
```
races (r) -- race_id
  + race_entries (e) -- foreign key
  + exhibition_data (ed) -- foreign key
```

**返却フィールド**:
- `venue_code`, `race_number`, `start_time` (races から)
- `race_grade` (races から ← 変更: race_conditions から)
- `volatility_score`, `volatility_level`, `recommended_model`, `volatility_reasons` (races から)
- `racers` (race_entries から)
- `exhibition_data` (exhibition_data から)

**重要**: race_conditions テーブルは**JOINしていない**  
→ weather, wind, wave, temperature 等のコンディション情報は返却されない

**キャッシュ戦略（現在）**: `s-maxage=3600, stale-while-revalidate=600` (1時間)

---

### 2. `api/predictions/[date].js` (Vercel Edge Function)

**呼び出し対象**: `get_predictions_by_date()` RPC

**返却データソース**:
```
races (r) -- race_id
  + race_entries (e) -- foreign key
  + exhibition_data (ed) -- foreign key
  + predictions (p) -- foreign key
  + race_results (res) -- foreign key
```

**返却フィールド**:
- レース基本情報 (races から)
- racer データ (race_entries から)
- 予想データ (predictions から)
- 結果データ (race_results から)
- exhibition_data (exhibition_data から)

**重要**: race_conditions テーブルは**JOINしていない**

**キャッシュ戦略**: `isToday ? 's-maxage=300' : 's-maxage=86400'` (5分 or 1日)

---

### 3. バックエンド: `update-race-info.js` (毎回朝 + 発走60分前)

**書き込み対象テーブル**:
- `race_conditions`: weather, wind_direction, wind_speed, wave_height, temperature, water_temperature, race_title
- `races`: race_grade ← **変更: 新規追加**

**実行タイミング**:
- **朝のバッチ** (`generate-predictions.js`): 全レースの race_conditions を初期化
- **発走60分前** (`update-race-info.js`): 該当レースの race_conditions を更新（天候変化対応）

---

### 4. バックエンド: `generate-predictions.js` (毎朝実行)

**読み取り対象**: race_conditions (リフレッシュモード時)  
**書き込み対象**:
- `predictions`: AI予想データ
- `races`: race_grade ← **変更: 新規追加**, volatility_score 等
- `race_conditions`: weather, wind, wave, temperature, race_title

---

## データフロー図

```
【朝のバッチ】
generate-predictions.js
  ├─ races テーブルへ書き込み
  │  ├─ race_grade (◆ Source of Truth)
  │  ├─ volatility_score
  │  └─ volatility_level
  └─ race_conditions へ書き込み
     ├─ weather
     ├─ wind_direction
     └─ temperature 等

【発走60分前】
update-race-info.js
  ├─ race_conditions へ書き込み（天候変化対応）
  └─ races へ書き込み（race_grade のみ ← 変更）

【フロントエンド】
API: api/races/today.js
  ↓
RPC: get_today_races()
  ↓
JOIN: races + race_entries + exhibition_data
  ↓
返却: race_grade (from races) ✅
      weather ✗ (race_conditions に含まれない)
      
API: api/predictions/[date].js
  ↓
RPC: get_predictions_by_date()
  ↓
JOIN: races + race_entries + predictions + race_results + exhibition_data
  ↓
返却: race_grade (from races) ✅
      weather ✗ (race_conditions に含まれない)
```

---

## 重要な発見

### ✅ race_conditions はフロントエンドに返却されない

`api/races/today.js` と `api/predictions/[date].js` の両RPC関数は、`race_conditions` テーブルを**JOINしていない**。

つまり：
- **天候データ** (weather, wind, temperature) はフロントエンドに返却されない
- **race_conditions** は **バックエンド内部専用** のテーブル
  - `generate-predictions.js` の **リフレッシュモード**で、条件変化時に予想を再計算するために使用
  - フロントエンドには天候情報そのものは不要（volatility_score という集約指標を返却）

### ✅ race_grade は races が Source of Truth

本改修後：
- `races.race_grade` が唯一の公式情報源
- `api/races/today.js` と `api/predictions/[date].js` 両方で返却可能（既に races に含まれているため）
- `race_conditions.race_grade` は廃止（不要）

---

## キャッシュ戦略の再検討

### 現在の設定（修正提案前）

| エンドポイント | 対象データ | キャッシュ | 理由 |
|---|---|---|---|
| `api/races/today.js` | 本日のレース情報 | 1時間 | race_grade は朝確定のため |
| `api/predictions/[date].js` | 本日の予想 | 5分 | 予想は逐次更新される（朝〜発走直前） |

### 問題点

- `api/races/today.js` の 1時間キャッシュは、**race_grade のためだけ**ではない
- racer データ（grade, win_rate 等）が朝確定後に変わるかどうかが明確でない
- exhibition_data は レース直前に確定する可能性あり（変更の可能性）

### 改修案の評価

**修正案**: `api/races/today.js` を 5分キャッシュに変更

**根拠**:
- `get_today_races()` の返却データのうち、実際に変わる可能性があるのは：
  - ✅ **exhibition_data** — レース直前に確定・変更される可能性
  - ✅ **volatility_score** — 発走直前に更新される可能性（update-race-info.js 実行時）
  - ✅ **racer データ** — 稀だが当日更新される可能性あり

- race_grade は朝確定だが、他のデータが頻繁に変わるため、**個別のキャッシュ分離は不可能**

**結論**: 1時間 → 5分への短縮は **妥当**

---

## 実装順序（再確認）

本改修の実装順序は変わらない：

```
1. スクリプト修正（update-race-info.js, generate-predictions.js）
2. デプロイ確認
3. DB マイグレーション（race_conditions.race_grade DROP）
4. api/races/today.js キャッシュ修正（1時間 → 5分）
```

キャッシュ修正の時期は **DB DROP 後** でも問題ない（スクリプト修正とは独立）。

---

## テスト計画への影響

キャッシュ戦略確認には以下を追加：

```bash
# キャッシュが有効に機能しているか確認（5分ごと）
curl -i https://www.boat-ai.jp/api/races/today \
  | grep -E "Cache-Control|Age|ETag"

# 実際のデータが 5分以内に更新されるか確認
# 朝〜発走60分前の時間帯で実行
node scripts/daily/update-race-info.js
# → exhibition_data や volatility_score の変化を確認
```

---

## Summary

| 項目 | 結論 |
|---|---|
| race_conditions の役割 | バックエンド内部専用。フロントには返却されない |
| race_grade の Source of Truth | races テーブル（確定） |
| api/races/today.js のキャッシュ | 5分への短縮が正当（exhibition_data などの変更に対応） |
| api/predictions/[date].js | 既に 5分キャッシュ。変更不要 |
| 実装順序 | スクリプト修正 → DB DROP → キャッシュ修正 |
