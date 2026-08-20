# フロントエンド API 実装ガイド

## 概要

このドキュメントは、龍神レーダー フロントエンドが使用する API エンドポイント、RPC 関数、キャッシュ戦略を実装レベルで解説します。

---

## API エンドポイント一覧

### 1. `GET /api/races/today`（Vercel Edge Function）

**用途**: 本日のレース基本情報を取得（会場選択、レースカード表示）

**呼び出し対象**: `get_today_races()` RPC

**返却データ**:
```json
{
  "races": [
    {
      "raceId": "2026-05-06-01-01",
      "venue": "桐生",
      "venueCode": 1,
      "raceNumber": 1,
      "startTime": "10:00",
      "volatility": {
        "score": 48,
        "level": "中",
        "recommendedModel": "safe_bet",
        "reasons": ["1号艇の勝率が低い", "展示優秀艇が限定的"]
      },
      "entries": [
        {
          "number": 1,
          "name": "選手名",
          "grade": "A1",
          "winRate": "6.52",
          "localWinRate": "5.21",
          // ...
        }
      ],
      "exhibitionData": [
        {
          "boatNumber": 1,
          "exhibitionTime": "9:45",
          "startTiming": 0.12
        }
      ]
    }
  ]
}
```

**データソース**:
```sql
SELECT 
  r.race_id, r.venue_code, r.race_number, r.start_time,
  r.race_grade,                    -- ← races テーブル
  r.volatility_score, r.volatility_level,
  r.recommended_model, r.volatility_reasons,
  e.boat_number, e.player_name, e.grade, e.win_rate, ...  -- race_entries
  ed.boat_number, ed.exhibition_time, ed.start_timing     -- exhibition_data
FROM races r
LEFT JOIN race_entries e ON r.race_id = e.race_id
LEFT JOIN exhibition_data ed ON r.race_id = ed.race_id
WHERE r.race_date = TODAY()
```

**キャッシュ戦略**: `s-maxage=300, stale-while-revalidate=60`（5分キャッシュ）

**キャッシュ根拠**:
- 返却データに含まれるもの:
  - `start_time` ✅（朝確定、変わらない）
  - `race_grade` ✅（朝確定、発走60分前に確認）
  - `volatility_score` ✅（朝計算、発走直前に更新可能）
  - `entries.winRate` ✅（朝時点で確定、当日更新なし）
  - `exhibitionData` ⚠️（発走直前に確定される）
  
- 返却データに**含まれないもの**（race_conditions は JOIN されない）:
  - ❌ weather, wind, wave_height, temperature（フロントエンドに不要）

**結論**: 個別キャッシュ分離は実装上不可能（全データが返却される）。exhibition_data の更新に対応するため 5分キャッシュが適切。

---

### 2. `GET /api/predictions/[date]?light=true/false`（Vercel Edge Function）

**用途**: 指定日付の AI 予想データを取得（AI 予想ページ表示）

**呼び出し対象**: 
- `light=true`: `get_predictions_by_date_light()` RPC（turnPrediction と racerStats を除外）
- `light=false` (デフォルト): `get_predictions_by_date()` RPC（全データ返却）

**返却データ**:
```json
{
  "date": "2026-05-06",
  "races": [
    {
      "raceId": "2026-05-06-01-01",
      "entries": [...],
      "predictions": {
        "standard": {
          "topPick": 2,
          "top3": [2, 3, 4],
          "confidence": 0.65,
          "isHitWin": null,
          "payoutWin": null,
          "turnPrediction": {...},
          "racerStats": {...}
        }
      },
      "result": {
        "finished": true,
        "rank1": 2,
        "rank2": 3,
        // ...
      }
    }
  ]
}
```

**データソース**:
```sql
SELECT 
  r.race_id, r.venue_code, r.race_number,
  e.*,                    -- race_entries
  p.*,                    -- predictions（model_id でキー分割）
  res.*,                  -- race_results
  ed.*                    -- exhibition_data
FROM races r
LEFT JOIN race_entries e ON r.race_id = e.race_id
LEFT JOIN predictions p ON r.race_id = p.race_id
LEFT JOIN race_results res ON r.race_id = res.race_id
LEFT JOIN exhibition_data ed ON r.race_id = ed.race_id
WHERE r.race_date = $1
```

**キャッシュ戦略**:
```javascript
const today = new Date().toISOString().split('T')[0];
const isToday = date === today;

const cacheControl = isToday
  ? 's-maxage=300, stale-while-revalidate=60'     // 本日: 5分
  : 's-maxage=86400, stale-while-revalidate=3600'; // 過去: 1日
```

**キャッシュ根拠**:
- **本日**: 予想が朝のバッチで生成され、発走直前に再計算される可能性がある → 5分ごとに更新
- **過去日**: 結果が確定して変わらない → 1日ごとで十分

---

## RPC 関数（Supabase）

### get_today_races()

**説明**: 本日（UTC 日付）のレース一覧を返却

```sql
CREATE OR REPLACE FUNCTION get_today_races()
RETURNS JSON
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN json_build_object(
    'races', COALESCE((
      SELECT json_agg(race_data ORDER BY venue_code, race_number)
      FROM (
        SELECT
          r.venue_code,
          r.race_number,
          json_build_object(
            'raceId', r.race_id,
            'venue', CASE r.venue_code WHEN 1 THEN '桐生' ... END,
            'venueCode', r.venue_code,
            'raceNumber', r.race_number,
            'startTime', TO_CHAR(r.start_time, 'HH24:MI'),
            'volatility', json_build_object(
              'score', r.volatility_score,
              'level', r.volatility_level,
              'recommendedModel', r.recommended_model,
              'reasons', COALESCE(r.volatility_reasons, '[]'::jsonb)
            ),
            'entries', (
              SELECT json_agg(...)
              FROM race_entries e
              WHERE e.race_id = r.race_id
            ),
            'exhibitionData', (
              SELECT json_agg(...)
              FROM exhibition_data ed
              WHERE ed.race_id = r.race_id
            )
          ) AS race_data
        FROM races r
        WHERE r.race_date = CURRENT_DATE  -- UTC 日付
      ) subq
    ), '[]'::json)
  );
END;
$$;
```

**重要**: `race_date = CURRENT_DATE` は **UTC 日付** です。日本時間との時差に注意。

**JOINs**:
- ✅ races: グレード、開始時刻、イン崩れ指数
- ✅ race_entries: 選手情報
- ✅ exhibition_data: 展示データ
- ❌ race_conditions: 天候情報（返却されない）

---

### get_predictions_by_date(target_date DATE)

**説明**: 指定日付の予想データを返却

```sql
CREATE OR REPLACE FUNCTION get_predictions_by_date(target_date DATE)
RETURNS JSON
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN json_build_object(
    'date', target_date,
    'generatedAt', NOW(),
    'races', COALESCE((
      SELECT json_agg(race_data ORDER BY venue_code, race_number)
      FROM (
        SELECT
          r.race_id,
          json_build_object(
            'raceId', r.race_id,
            'entries', (
              SELECT json_agg(...)
              FROM race_entries e
              WHERE e.race_id = r.race_id
            ),
            'predictions', (
              SELECT json_object_agg(
                p.model_id,
                json_build_object(
                  'topPick', p.top_pick,
                  'top3', ARRAY[p.top_pick, p.top_2nd, p.top_3rd],
                  'confidence', p.confidence,
                  'turnPrediction', p.feature_contributions->'turnPrediction',
                  'racerStats', p.feature_contributions->'racerStats'
                )
              )
              FROM predictions p
              WHERE p.race_id = r.race_id
            ),
            'result', (
              SELECT json_build_object(
                'finished', true,
                'rank1', res.rank1,
                'rank2', res.rank2,
                'rank3', res.rank3
              )
              FROM race_results res
              WHERE res.race_id = r.race_id
              LIMIT 1
            )
          ) AS race_data
        FROM races r
        WHERE r.race_date = target_date
      ) subq
    ), '[]'::json)
  );
END;
$$;
```

**JOINs**:
- ✅ races: レース基本情報
- ✅ race_entries: 選手情報
- ✅ predictions: AI 予想（model_id でキー分割）
- ✅ race_results: 結果データ
- ✅ exhibition_data: 展示データ
- ❌ race_conditions: 天候情報（返却されない）

---

## キャッシュ戦略の設計

### パターン別キャッシュ時間

| パターン | キャッシュ時間 | 理由 |
|---|---|---|
| **API: 本日** | 5分 | exhibition_data が発走直前に確定 |
| **API: 過去日** | 1日 | データが確定して変わらない |
| **朝のバッチ後** | N/A | キャッシュリセット（新データ生成） |

### CDN キャッシュと stale-while-revalidate

```
s-maxage=300, stale-while-revalidate=60
  ├── s-maxage: 300秒（キャッシュ有効期間）
  └── stale-while-revalidate: 60秒（有効期限切れ後も古いデータを返却可）
```

**動作**:
1. キャッシュ取得（0-300秒） → 即返却
2. キャッシュ更新中（300-360秒） → 古いデータを返却しつつ、バックグラウンドで更新
3. キャッシュ完全失効（360秒以降） → オリジンに問い合わせ

---

## フロントエンド実装時の注意

### 1. race_grade の取得
```javascript
// ❌ 誤り: race_conditions から取得
const grade = raceConditions[raceId]?.race_grade;

// ✅ 正しい: races（API 返却データ）から取得
const grade = race.raceGrade;  // get_today_races() の返却値
```

### 2. 天候情報の取得
```javascript
// ❌ 天候情報はフロントエンド API に含まれない
const weather = race.weather;  // undefined

// ✅ イン崩れ指数を使用（天候が既に因子に含まれている）
const volatility = race.volatility.score;
```

### 3. キャッシュ戦略の理解
```javascript
// API 呼び出し直後（300秒以内）
GET /api/races/today
  → キャッシュから返却（遅延 < 100ms）

// 朝のバッチ実行直後（キャッシュ期限内）
generate-predictions.js 完了 → DB 更新 → キャッシュは古いまま（5分以内更新）

// 発走60分前（キャッシュ更新中）
update-race-info.js → DB 更新 → キャッシュ更新中（stale-while-revalidate で対応）
```

---

## トラブルシューティング

### 問題: フロントエンドに race_grade が表示されない

**原因 1**: キャッシュが古い
```bash
# CDN キャッシュをクリア
curl -X PURGE https://www.boat-ai.jp/api/races/today
```

**原因 2**: 朝のバッチが未実行
```bash
# generate-predictions.js を手動実行
node scripts/daily/generate-predictions.js
```

### 問題: API から天候データが返却されない

**これは予期した動作です**。天候データはフロントエンドに返却されません。イン崩れ指数（volatility）を使用してください。

---

## 参考

- `docs/operation/api-architecture-analysis.md` - API・RPC アーキテクチャ分析
- `docs/reference/race-conditions-table-design.md` - race_conditions テーブル設計
- `scripts/daily/generate-predictions.js` - バッチスクリプト
- `api/races/today.js` - Edge Function 実装
- `api/predictions/[date].js` - Edge Function 実装
