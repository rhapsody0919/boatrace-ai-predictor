# 龍神レーダー パフォーマンス改善計画

## 概要

Supabase移行後のデータ読み込み速度を改善し、将来のモデル追加にも対応できる拡張性のあるアーキテクチャを構築する。

---

## 現状分析

### パフォーマンス計測結果（2026-01-12）

| API | 呼び出し元 | クエリ時間 | データ量 |
|-----|-----------|-----------|----------|
| `getRaces` | App.jsx (ホーム) | **1,310ms** | 207KB |
| `getPredictions` | App.jsx, RaceDetail, HitRaces | 378ms | 570KB |
| `getAccuracy` | AccuracyDashboard | 273ms | 427KB |
| `getAvailableDates` | RaceHistory | 244ms | ~10KB |
| `getPredictions×14` | HitRaces (的中) | 1,328ms | ~8MB |

### 問題点

1. **初期表示が遅い**: getRacesに1.3秒かかり、ユーザー体験を損なう
2. **毎回フルフェッチ**: データは1時間に1回しか更新されないのに、毎回DBクエリ
3. **大量データ転送**: 180レース×6選手×3モデル = 3,240行を毎回転送
4. **拡張性の欠如**: モデル追加にスキーマ変更が必要

### 現在のアーキテクチャ

```
ブラウザ ──→ Supabase REST API ──→ PostgreSQL
   │              │                    │
 毎回           毎回                 毎回
フルフェッチ  ネットワーク往復      複雑なJOIN
```

---

## 目標アーキテクチャ

```
┌──────────┐    ┌─────────────┐    ┌──────────────────────┐
│ ブラウザ │───→│ Vercel Edge │───→│ 静的JSON (CDN)       │
│          │    │ (キャッシュ) │    │ ← スクレイピング時生成│
└──────────┘    └─────────────┘    └──────────────────────┘
     │                                       ↑
     │ 本日データのみ                        │
     ↓                                       │
┌──────────────┐                    ┌────────┴───────┐
│ Supabase RPC │←───────────────────│ 毎時スクレイピング│
│ (最適化クエリ)│                    │ + JSON生成     │
└──────────────┘                    └────────────────┘
```

### 目標性能

| シナリオ | 現状 | 目標 |
|----------|------|------|
| 初回アクセス（本日データ） | 1,310ms | 300ms |
| 2回目以降（キャッシュ） | 0.1ms | 0.1ms |
| ページリロード後 | 1,310ms | 0.1ms (localStorage) |
| 過去データ | 378ms | 5ms (CDN) |

---

## 実装計画

### Phase 1: キャッシュ強化（即効性）

**目標**: ページリロード後も高速表示

#### 1.1 localStorage永続化キャッシュ

**ファイル**: `src/services/supabaseDataService.js`

```javascript
/**
 * 2層キャッシュ（メモリ + localStorage）
 * - メモリ: 最速、セッション中のみ
 * - localStorage: ページリロード後も有効
 */
const CACHE_TTL = 30 * 60 * 1000; // 30分

const cache = {
  memory: new Map(),

  get(key) {
    // 1. メモリから（最速）
    const memCached = this.memory.get(key);
    if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
      console.log(`[Cache HIT] Memory: ${key}`);
      return memCached.data;
    }

    // 2. localStorageから（ページリロード後も有効）
    try {
      const stored = localStorage.getItem(`boatai:${key}`);
      if (stored) {
        const { data, timestamp } = JSON.parse(stored);
        if (Date.now() - timestamp < CACHE_TTL) {
          console.log(`[Cache HIT] localStorage: ${key}`);
          this.memory.set(key, { data, timestamp });
          return data;
        }
      }
    } catch (e) {
      console.warn('localStorage read error:', e);
    }

    return null;
  },

  set(key, data) {
    const timestamp = Date.now();
    this.memory.set(key, { data, timestamp });

    try {
      localStorage.setItem(`boatai:${key}`, JSON.stringify({ data, timestamp }));
    } catch (e) {
      console.warn('localStorage write error:', e);
    }
  },

  clear(key = null) {
    if (key) {
      this.memory.delete(key);
      localStorage.removeItem(`boatai:${key}`);
    } else {
      this.memory.clear();
      Object.keys(localStorage)
        .filter(k => k.startsWith('boatai:'))
        .forEach(k => localStorage.removeItem(k));
    }
  }
};
```

#### 1.2 不要フィールドの削除

**getRaces**: ホーム画面では選手詳細不要

```javascript
// Before: 全フィールド取得
race_entries (boat_number, player_name, grade, age, win_rate,
              local_win_rate, motor_number, motor_2rate, boat_number_id, boat_2rate)

// After: 必要最小限
race_entries (boat_number, player_name, grade, win_rate)
```

**期待効果**: データ量 207KB → 100KB（50%削減）

#### Phase 1 チェックリスト

- [ ] localStorage永続化キャッシュ実装
- [ ] getRacesの取得フィールド最適化
- [ ] キャッシュクリア時のlocalStorage連動
- [ ] 動作確認・ベンチマーク

**工数**: 1.5時間

---

### Phase 2: クエリ最適化（短期）

**目標**: サーバー側でデータ整形、ネットワーク往復削減

#### 2.1 Supabase RPC関数

**ファイル**: Supabase Dashboard > SQL Editor

```sql
-- 本日のレース一覧（ホーム用）
CREATE OR REPLACE FUNCTION get_today_races()
RETURNS JSON
LANGUAGE SQL
STABLE
AS $$
  SELECT json_build_object(
    'success', true,
    'scrapedAt', NOW(),
    'data', COALESCE((
      SELECT json_agg(
        json_build_object(
          'placeCd', venue_code,
          'placeName', CASE venue_code
            WHEN 1 THEN '桐生' WHEN 2 THEN '戸田' WHEN 3 THEN '江戸川'
            WHEN 4 THEN '平和島' WHEN 5 THEN '多摩川' WHEN 6 THEN '浜名湖'
            WHEN 7 THEN '蒲郡' WHEN 8 THEN '常滑' WHEN 9 THEN '津'
            WHEN 10 THEN '三国' WHEN 11 THEN 'びわこ' WHEN 12 THEN '住之江'
            WHEN 13 THEN '尼崎' WHEN 14 THEN '鳴門' WHEN 15 THEN '丸亀'
            WHEN 16 THEN '児島' WHEN 17 THEN '宮島' WHEN 18 THEN '徳山'
            WHEN 19 THEN '下関' WHEN 20 THEN '若松' WHEN 21 THEN '芦屋'
            WHEN 22 THEN '福岡' WHEN 23 THEN '唐津' WHEN 24 THEN '大村'
          END,
          'races', races_data
        )
      )
      FROM (
        SELECT
          venue_code,
          json_agg(
            json_build_object(
              'raceNo', race_number,
              'startTime', SUBSTRING(start_time, 1, 5),
              'date', race_date,
              'placeCd', venue_code
            ) ORDER BY race_number
          ) as races_data
        FROM races
        WHERE race_date = CURRENT_DATE
        GROUP BY venue_code
        ORDER BY venue_code
      ) grouped
    ), '[]'::json)
  );
$$;

-- 予測データ取得（日付指定）
CREATE OR REPLACE FUNCTION get_predictions_by_date(target_date DATE)
RETURNS JSON
LANGUAGE SQL
STABLE
AS $$
  SELECT json_build_object(
    'date', target_date,
    'generatedAt', NOW(),
    'races', COALESCE((
      SELECT json_agg(race_data)
      FROM (
        SELECT json_build_object(
          'raceId', r.race_id,
          'venue', CASE r.venue_code ... END,
          'raceNumber', r.race_number,
          'startTime', SUBSTRING(r.start_time, 1, 5),
          'predictions', (
            SELECT json_object_agg(p.model_id, json_build_object(
              'topPick', p.top_pick,
              'top3', ARRAY[p.top_pick, p.top_2nd, p.top_3rd],
              'confidence', p.confidence
            ))
            FROM predictions p WHERE p.race_id = r.race_id
          ),
          'result', (
            SELECT json_build_object(
              'finished', true,
              'rank1', res.rank1,
              'rank2', res.rank2,
              'rank3', res.rank3
            )
            FROM race_results res WHERE res.race_id = r.race_id
          )
        ) as race_data
        FROM races r
        WHERE r.race_date = target_date
        ORDER BY r.venue_code, r.race_number
      ) subq
    ), '[]'::json)
  );
$$;
```

#### 2.2 フロントエンド呼び出し

```javascript
// supabaseDataService.js
async getRaces() {
  return withCache('races-today', async () => {
    const { data, error } = await supabase.rpc('get_today_races');
    if (error) throw error;
    return data;
  });
}
```

#### 2.3 Vercel Edge API（CDNキャッシュ）

**ファイル**: `api/races/today.js`

```javascript
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const data = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_today_races`, {
    headers: { 'apikey': SUPABASE_KEY }
  }).then(r => r.json());

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
      // CDNで5分キャッシュ、10分は古いデータを返しつつ裏で更新
    }
  });
}
```

#### Phase 2 チェックリスト

- [ ] Supabase RPC関数作成（get_today_races）
- [ ] Supabase RPC関数作成（get_predictions_by_date）
- [ ] フロントエンドをRPC呼び出しに変更
- [ ] Vercel Edge APIルート作成
- [ ] CDNキャッシュヘッダー設定
- [ ] 動作確認・ベンチマーク

**工数**: 4時間

---

### Phase 3: 静的生成（恒久対策）

**目標**: 過去データはCDNから即座に配信

#### 3.1 スクレイピング時にJSON生成

**ファイル**: `scripts/scrape-results.js`

```javascript
async function generateStaticJson(date) {
  console.log(`[Static] Generating JSON for ${date}...`);

  // Supabaseから整形済みデータ取得
  const { data } = await supabase.rpc('get_predictions_by_date', {
    target_date: date
  });

  // Vercel Blob Storage または Supabase Storage にアップロード
  await uploadToStorage(`predictions/${date}.json`, JSON.stringify(data));

  console.log(`[Static] Generated: predictions/${date}.json`);
}

// スクレイピング完了後に実行
await generateStaticJson(targetDate);
```

#### 3.2 フロントエンドの読み込み分岐

```javascript
async getPredictions(date) {
  const today = getTodayJST();

  if (date === today) {
    // 本日データ: Supabaseから（リアルタイム性重視）
    return withCache(`predictions-${date}`, () =>
      supabase.rpc('get_predictions_by_date', { target_date: date })
    );
  } else {
    // 過去データ: 静的JSONから（CDN経由で高速）
    return withCache(`predictions-${date}`, () =>
      fetch(`/api/static/predictions/${date}.json`).then(r => r.json())
    );
  }
}
```

#### Phase 3 チェックリスト

- [ ] Supabase Storage または Vercel Blob 設定
- [ ] スクレイピングスクリプトにJSON生成追加
- [ ] 過去データの静的JSON一括生成（移行用）
- [ ] フロントエンドの読み込み分岐実装
- [ ] CDN設定・キャッシュヘッダー最適化

**工数**: 半日

---

### Phase 4: スキーマ拡張性（将来対応）

**目標**: モデル追加時にスキーマ変更不要

#### 4.1 現状のスキーマ問題

```sql
-- 現在: カラムが固定
CREATE TABLE race_entries (
  ai_score_standard INT,
  ai_score_safe_bet INT,
  ai_score_upset_focus INT
  -- 新モデル追加 = ALTER TABLE必要
);
```

#### 4.2 改善案: JSONB使用

```sql
-- 改善: JSONBで柔軟に
ALTER TABLE race_entries
ADD COLUMN ai_scores JSONB DEFAULT '{}';

-- データ例
-- {"standard": 2974, "safeBet": 3400, "upsetFocus": 17153, "newModel": 5000}

-- マイグレーション
UPDATE race_entries SET ai_scores = json_build_object(
  'standard', ai_score_standard,
  'safeBet', ai_score_safe_bet,
  'upsetFocus', ai_score_upset_focus
);

-- 旧カラム削除（後日）
-- ALTER TABLE race_entries DROP COLUMN ai_score_standard, ...;
```

#### 4.3 フロントエンド対応

```javascript
// 動的にモデルを取得
const createPlayers = (entries, modelId) => entries.map(e => ({
  ...e,
  aiScore: e.ai_scores?.[modelId] || 0
})).sort((a, b) => b.aiScore - a.aiScore);
```

#### Phase 4 チェックリスト

- [ ] ai_scores JSONBカラム追加
- [ ] データマイグレーション実行
- [ ] フロントエンドをJSONB対応に変更
- [ ] 予想生成スクリプト更新
- [ ] 旧カラム削除（十分なテスト後）

**工数**: 1日

---

## 実装スケジュール

```
Week 1:
├── Day 1: Phase 1（キャッシュ強化）
│   ├── localStorage永続化キャッシュ
│   └── 不要フィールド削除
│
├── Day 2-3: Phase 2（クエリ最適化）
│   ├── Supabase RPC関数作成
│   ├── Vercel Edge API
│   └── テスト・ベンチマーク
│
Week 2:
├── Day 4-5: Phase 3（静的生成）
│   ├── ストレージ設定
│   ├── JSON生成スクリプト
│   └── フロントエンド分岐
│
├── Day 6-7: Phase 4（スキーマ拡張）
│   ├── JSONB移行
│   └── 全体テスト
```

---

## 期待効果

### パフォーマンス

| シナリオ | Before | After | 改善率 |
|----------|--------|-------|--------|
| 初回（本日） | 1,310ms | 300ms | **77%** |
| 2回目以降 | 0.1ms | 0.1ms | - |
| リロード後 | 1,310ms | 0.1ms | **99.99%** |
| 過去データ | 378ms | 5ms | **99%** |
| 的中ページ | 1,328ms | 100ms | **92%** |

### 拡張性

- モデル追加: スキーマ変更不要（JSONキー追加のみ）
- 新機能追加: RPC関数追加で対応可能
- スケーリング: CDN活用で無限スケール

---

## リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| localStorage容量制限(5MB) | 古いキャッシュで溢れる | LRU方式で古いものから削除 |
| RPC関数のバグ | 全ユーザーに影響 | ステージング環境でテスト |
| CDNキャッシュ事故 | 古いデータが表示される | パージAPIの準備 |
| JSONB移行失敗 | データ損失 | バックアップ後に実行 |

---

## 関連ファイル

- `src/services/supabaseDataService.js` - データ取得ロジック
- `src/services/dataService.js` - サービス層
- `scripts/scrape-results.js` - スクレイピング
- `scripts/generate-predictions.js` - 予想生成

---

## 参考資料

- [Supabase RPC Functions](https://supabase.com/docs/guides/database/functions)
- [Vercel Edge Functions](https://vercel.com/docs/functions/edge-functions)
- [PostgreSQL JSONB](https://www.postgresql.org/docs/current/datatype-json.html)
