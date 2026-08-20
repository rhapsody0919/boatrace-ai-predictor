# 龍神レーダー イン崩れ指数特化戦略

## ビジョン

**「ボートレースのイン崩れ（1コース不振）を最も正確に予測するサイト」**

- イン崩れスコア（0-100）で荒れ度を定量化
- スコア帯別に複数の買い目パターンを提供
- ユーザーが実際に買った買い目と結果を自動記録
- 「このスコア帯ではこの買い方が回収率130%」という実績データを蓄積

---

## Phase 1: イン崩れ指数の精度向上（3ヶ月）

### 目標
- **現在**: 的中率 50-55%, 回収率 95-110%
- **目標**: 的中率 55%以上, 回収率 110%以上（スコア帯別）

### 実装内容

#### 1.1 会場別ルール拡充
| 会場 | 状態 | ルール数 | 目標 |
|------|------|---------|------|
| 江戸川 | ✅ 実装済み | 3件 | 5件 |
| 平和島 | ✅ 実装済み | 2件 | 4件 |
| 浜名湖 | ✅ 実装済み | 2件 | 4件 |
| 蒲郡 | ✅ 実装済み | 1件 | 3件 |
| 津 | ✅ 実装済み | 1件 | 3件 |
| 三国 | ✅ 実装済み | 1件 | 3件 |
| びわこ | ✅ 実装済み | 1件 | 3件 |
| 鳴門 | ✅ 実装済み | 1件 | 3件 |
| 丸亀 | ✅ 実装済み | 1件 | 3件 |
| 児島 | ✅ 実装済み | 2件 | 4件 |
| 宮島 | ✅ 実装済み | 1件 | 3件 |
| 徳山 | ✅ 実装済み | 2件 | 4件 |
| 芦屋 | ✅ 実装済み | 2件 | 4件 |
| 福岡 | ✅ 実装済み | 2件 | 4件 |
| 大村 | ✅ 実装済み | 1件 | 3件 |
| 下関 | ❌ 未実装 | 0件 | 3件 |
| 若松 | ❌ 未実装 | 0件 | 3件 |
| 唐津 | ❌ 未実装 | 0件 | 3件 |
| 住之江 | ❌ 未実装 | 0件 | 3件 |
| 尼崎 | ❌ 未実装 | 0件 | 3件 |
| 常滑 | ❌ 未実装 | 0件 | 3件 |
| 戸田 | ❌ 未実装 | 0件 | 3件 |
| 桐生 | ❌ 未実装 | 0件 | 3件 |
| 多摩川 | ❌ 未実装 | 0件 | 3件 |

**実装ステップ**:
1. 未実装9会場の過去180日データ分析（月別：下関・若松、月別：唐津・住之江、月別：尼崎・常滑、月別：戸田・桐生・多摩川）
2. 既実装15会場は各ルール+2つ追加分析
3. 統計的検証: サンプル数20以上、回収率100%以上の条件で採用

**期待効果**: スコア計算時に条件マッチ → スコアが±5-10ポイント調整される

#### 1.2 ターン予測の精度向上

現在の実装:
```
展示ST → 「逃げが得意」「捲りが強い」を推測
```

改善案:
```
展示ST + 過去90日の決着パターン + 当地での展開適性
  → スコア調整: 
     「この選手は下関では逃げが走りやすい」
     「この選手は常滑では捲り成功率が高い」
```

**データベース拡張**: 
- `racer_venue_stats` テーブル: 選手×会場×展開パターン別の成績

#### 1.3 外的要因の組み込み

現在の計算に含まれていない要因:
- **気象**: 風速・波高（大荒れ = イン崩れしやすい）
- **レース序盤の流れ**: 直前レースの結果（枠番有利/不利）
- **モーター・ボート新交換**: 新機器はイン不利の傾向

**実装**: `conditions.wind_velocity` や `conditions.wave_height` をスコア計算に組み込み

---

## Phase 2: 複数買い目パターンの提供（2ヶ月）

### 設計: スコア帯別 × 買い方別の買い目生成

**原則: イン崩れスコアが高い（51以上）レースに限定して複数買い目を提供**

#### 2.1 買い目パターンの定義

**スコア帯: 0-20（本命が走りやすい）**
```json
{
  "patterns": [
    {
      "name": "スタンダード予想（複勝推奨）",
      "betType": "place",
      "description": "AI推奨の複勝買い目（現在通り）",
      "boats": [1, 2],
      "note": "複数パターンは提供しない（スコア低いため）"
    }
  ]
}
```

**スコア帯: 21-50（中程度の荒れ）**
```json
{
  "patterns": [
    {
      "name": "スタンダード予想",
      "betType": "place",
      "description": "AI推奨の複勝買い目（現在通り）",
      "boats": [1, 2, 3],
      "note": "複数パターンは提供しない（スコア中程度のため）"
    }
  ]
}
```

**スコア帯: 51-100（1コースが崩れやすい）← ここだけ複数買い目を提供**
```
【複数の3連単買い目を「出現確率が高い順」に提示】

パターン1（最も確率が高い）: 4→2→3
  出現確率: 12.5%（児島での過去180日: 50回中6回）
  回収率: 138%（180日の平均配当）
  理由: 外枠逃げ → 本命2着 → 展示優秀艇が3着

パターン2（次点）: 5→3→2
  出現確率: 11.2%
  回収率: 142%
  理由: さらに外からの捲り → 差し型

パターン3（その他有力）: 3→4→5
  出現確率: 9.8%
  回収率: 155%（高配当狙い）
  理由: 本命近い艇が2着争い
```

#### 2.1.1 出目分析テーブル

```sql
CREATE TABLE race_outcome_frequencies (
  id BIGINT PRIMARY KEY,
  venue_code INT NOT NULL,
  rank1_boat INT NOT NULL,        -- 1着艇（1-6）
  rank2_boat INT NOT NULL,        -- 2着艇（1-6）
  rank3_boat INT NOT NULL,        -- 3着艇（1-6）
  
  total_occurrences INT,          -- 過去180日での出現回数
  appearance_rate DECIMAL(5,2),   -- 出現率（%）
  
  avg_payout DECIMAL(8,2),        -- 平均配当
  recovery_rate DECIMAL(5,2),     -- 180日間の回収率
  
  last_updated TIMESTAMP,
  
  UNIQUE(venue_code, rank1_boat, rank2_boat, rank3_boat)
);
```

**更新スクリプト: `scripts/daily/update-outcome-frequencies.js`**

```javascript
// 毎日実行: 過去180日の出目を会場×組み合わせ別に集計
async function updateOutcomeFrequencies() {
  const venues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
  
  for (const venueCode of venues) {
    // 過去180日のレース結果を取得
    const { data: results } = await supabase
      .from('race_results')
      .select('race_id, rank1, rank2, rank3')
      .eq('venue_code', venueCode)
      .gte('race_date', last180Days);
    
    // 1着→2着→3着の組み合わせを集計
    const combinations = new Map();
    
    for (const result of results) {
      const key = `${result.rank1}-${result.rank2}-${result.rank3}`;
      if (!combinations.has(key)) {
        combinations.set(key, { count: 0, totalPayout: 0 });
      }
      combinations.get(key).count++;
      combinations.get(key).totalPayout += result.payout;
    }
    
    // DB更新
    for (const [key, data] of combinations.entries()) {
      const [r1, r2, r3] = key.split('-').map(Number);
      const appearanceRate = (data.count / results.length) * 100;
      const avgPayout = data.totalPayout / data.count;
      const recoveryRate = (data.totalPayout / (data.count * 100)) * 100; // 100円賭けと仮定
      
      await supabase.from('race_outcome_frequencies').upsert({
        venue_code: venueCode,
        rank1_boat: r1,
        rank2_boat: r2,
        rank3_boat: r3,
        total_occurrences: data.count,
        appearance_rate: appearanceRate,
        avg_payout: avgPayout,
        recovery_rate: recoveryRate
      });
    }
  }
}
```

#### 2.2 複数3連単買い目の生成ロジック

**データベース更新: `predictions` テーブル**

```sql
ALTER TABLE predictions 
ADD COLUMN volatile_patterns JSONB;  -- スコア 51-100 時のみ複数買い目

-- 例:
-- volatile_patterns = [
--   {
--     rank: 1,
--     pattern: "4→2→3",
--     probability: 12.5,
--     recovery_rate: 138,
--     reasoning: "外枠逃げ → 本命2着 → 展示優秀"
--   },
--   {
--     rank: 2,
--     pattern: "5→3→2",
--     probability: 11.2,
--     recovery_rate: 142,
--     reasoning: "外からの捲り → 差し型"
--   }
-- ]
```

**買い目生成関数: `generateVolatilePatterns(race, volatilityScore)`**

```javascript
// src/services/predictionService.js

async function generateVolatilePatterns(race, volatilityScore) {
  // スコア 51-100 の時だけ複数買い目を生成
  if (volatilityScore < 51) {
    return null;
  }
  
  const venueCode = race.placeCd;
  const predictedRank1 = race.predictions.upsetFocus.topPick; // イン崩れ時は穴狙いモデル採用
  
  // Step 1: 出目分析から「1着がこの艇の時の2着・3着パターン」を取得
  const { data: outcomePatterns } = await supabase
    .from('race_outcome_frequencies')
    .select('rank2_boat, rank3_boat, total_occurrences, appearance_rate, recovery_rate')
    .eq('venue_code', venueCode)
    .eq('rank1_boat', predictedRank1)
    .gte('appearance_rate', 5)  // 出現率 5% 以上のみ
    .order('recovery_rate', { ascending: false })
    .limit(5);  // トップ5の組み合わせ
  
  const patterns = [];
  
  for (let i = 0; i < outcomePatterns.length; i++) {
    const pattern = outcomePatterns[i];
    
    patterns.push({
      rank: i + 1,
      pattern: `${predictedRank1}→${pattern.rank2_boat}→${pattern.rank3_boat}`,
      probability: pattern.appearance_rate,
      recovery_rate: pattern.recovery_rate,
      reasoning: generateReasoningText(
        predictedRank1, 
        pattern.rank2_boat, 
        pattern.rank3_boat,
        race
      )
    });
  }
  
  return patterns;
}

function generateReasoningText(r1, r2, r3, race) {
  // 展示データ・選手データから根拠を生成
  const player1 = race.racers.find(r => r.boatNumber === r1);
  const player2 = race.racers.find(r => r.boatNumber === r2);
  const player3 = race.racers.find(r => r.boatNumber === r3);
  
  // 例: 逃げ型 → 差し型 → 捲り型
  let reasoning = '';
  
  if (r1 < r2 && r2 < r3) {
    reasoning = `枠順順 (内→中→外)`;
  } else if (r1 > r2 && r2 > r3) {
    reasoning = `外から内へ (高配当型)`;
  } else {
    reasoning = `出目分析: 過去180日で${...}パターン`;
  }
  
  return reasoning;
}
```

#### 2.2.1 複数3連単パターンの表示UI

**PredictionTable.jsx に「イン崩れ時の複数買い目」セクション追加**

```
【イン崩れスコア: 75 - 複数の3連単買い目（出目分析ベース）】

🎯 パターン1（最も有力）
4 → 2 → 3
出現率: 12.5% | 平均配当: 11.5倍 | 回収率: 138%
理由: 外枠逃げ → 本命2着 → 展示優秀艇

🎯 パターン2（次点）  
5 → 3 → 2
出現率: 11.2% | 平均配当: 12.8倍 | 回収率: 142%
理由: さらに外から捲り → 差し型

🎯 パターン3
3 → 4 → 5
出現率: 9.8% | 平均配当: 15.5倍 | 回収率: 155%
理由: 本命近い艇が2着争い

ℹ️ この統計は児島での過去180日のデータです
```

#### 2.3 実装ステップ

1. **出目分析テーブルの構築**（初期: 1ヶ月）
   - `race_outcome_frequencies` テーブル作成
   - 過去180日分の全レース結果を「会場×1着×2着×3着」で集計
   - 毎日更新スクリプト `update-outcome-frequencies.js` 実装

2. **買い目生成ロジック実装**（2週間）
   - `generateVolatilePatterns()` 関数実装
   - スコア 51-100 時のみ、出現率トップ5の3連単パターンを生成
   - 各パターンの理由文生成

3. **predictions テーブル更新**（1週間）
   - `volatile_patterns` フィールド追加
   - `generate-predictions.js` で高スコア時に複数パターンを生成

4. **フロントエンド対応**（2週間）
   - PredictionTable.jsx に「イン崩れ時の複数買い目」セクション追加
   - 出現率・配当・回収率・根拠を表示
   - タブで複数パターンを切り替え表示

---

## Phase 3: パターン実績分析の可視化（2ヶ月）

### 設計: AI生成パターンの過去実績統計表示

#### 3.1 新テーブル: `pattern_performance`

```sql
CREATE TABLE pattern_performance (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  pattern_name VARCHAR NOT NULL,           -- 「穴狙い（複勝）」
  bet_type VARCHAR NOT NULL,               -- place / win / trio / exacta
  volatility_score_min INT NOT NULL,       -- スコア帯下限
  volatility_score_max INT NOT NULL,       -- スコア帯上限
  venue_code INT,                          -- NULL = 全会場, 指定 = 会場別
  
  -- 実績統計（毎月更新）
  total_races INT DEFAULT 0,               -- 対象レース数
  hit_races INT DEFAULT 0,                 -- 的中レース数
  hit_rate DECIMAL(5,2),                   -- 的中率（%）
  recovery_rate DECIMAL(5,2),              -- 回収率（%）
  avg_payout DECIMAL(8,2),                 -- 平均配当
  
  last_updated TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(pattern_name, bet_type, volatility_score_min, volatility_score_max, venue_code)
);
```

#### 3.2 実績統計の定期更新

**スクリプト: `scripts/daily/update-pattern-performance.js`**

```javascript
// 毎月1日に実行（または手動トリガー）
async function updatePatternPerformance() {
  // 例: 過去30日間のデータで実績を計算
  
  const patterns = [
    { name: "穴狙い（複勝）", betType: "place", boats: [2,3,4], scoreMin: 51, scoreMax: 100 },
    { name: "堅い買い（単勝）", betType: "win", boats: [1], scoreMin: 0, scoreMax: 20 },
    // ... 全パターン
  ];
  
  for (const pattern of patterns) {
    // 過去30日で該当条件のレースを取得
    const { data: races } = await supabase
      .from('races')
      .select(`
        race_id,
        volatility_score,
        venue_code,
        race_results(rank1, rank2, rank3)
      `)
      .gte('race_date', last30Days)
      .gte('volatility_score', pattern.scoreMin)
      .lte('volatility_score', pattern.scoreMax);
    
    // パターンマッチ + 的中判定
    let hitCount = 0;
    let totalPayout = 0;
    
    for (const race of races) {
      const result = race.race_results[0];
      const isHit = judgeByBetType(pattern.betType, pattern.boats, result);
      if (isHit) {
        hitCount++;
        totalPayout += result.payout; // 要: odds テーブルと連携
      }
    }
    
    const hitRate = (hitCount / races.length) * 100;
    const recoveryRate = (totalPayout / races.length) * 100;
    
    // DB更新
    await supabase.from('pattern_performance').upsert({
      pattern_name: pattern.name,
      bet_type: pattern.betType,
      volatility_score_min: pattern.scoreMin,
      volatility_score_max: pattern.scoreMax,
      venue_code: null,
      total_races: races.length,
      hit_races: hitCount,
      hit_rate: hitRate,
      recovery_rate: recoveryRate,
      last_updated: new Date()
    });
  }
}
```

#### 3.3 フロントエンド: パターン実績表示

**PredictionTable.jsx に「実績」セクション追加**

```
📊 このパターンの過去実績（直近30日）

【スコア 51-100 × 複勝（穴狙い）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━
 的中率: 58%   回収率: 118%
 
 対象レース: 43件
 的中: 25件
 平均配当: 2.8倍
━━━━━━━━━━━━━━━━━━━━━━━━━━━

【会場別実績】
江戸川 (8レース):  的中率 62% | 回収率 128%
平和島 (6レース):  的中率 50% | 回収率 110%
児島 (5レース):    的中率 60% | 回収率 132% ✅ 最良
...
```

#### 3.4 データフロー

```
毎日: レース結果が確定
  ↓
レース結果を race_results テーブルに記録
  ↓
配当情報を odds テーブルに記録
  ↓
毎月1日: update-pattern-performance.js を実行
  ↓
過去30日のレースで各パターンの的中率・回収率を計算
  ↓
pattern_performance テーブルを更新
  ↓
フロントエンドが pattern_performance を表示
```

---

## Phase 4: 知見の発信・改善（継続）

### 継続的な改善サイクル

```
月初: pattern_performance 更新
  ↓
「このパターンは回収率が低下している」を発見
  ↓
データサイエンティストが原因分析
  ↓
会場別ルール追加 or パターン定義の修正
  ↓
ブログ・note で知見を発信
```

**発信例**:
```
「イン崩れスコア80以上の時は『穴狙い複勝』が効果的
 直近30日の実績: 的中率58% | 回収率128%」

「下関では展示ST差>0.05秒でイン不振確度が+20ポイント
 この条件でのみ穴狙い複勝の回収率が140%に」
```

→ ユーザー教育 + 信頼構築 + SEO効果 + ファン形成

---

## 優先実装順

| フェーズ | 項目 | 期間 | 主担当者 |
|---------|------|------|--------|
| Phase 1 | 会場別ルール分析（5会場/月） | 3ヶ月 | データサイエンティスト |
| Phase 1 | ターン予測精度向上 | 2ヶ月 | 機械学習 + 統計 |
| Phase 1 | 気象・外的要因組み込み | 1ヶ月 | バックエンド |
| **Phase 2** | **出目分析テーブル構築**（過去180日集計） | **1ヶ月** | **バックエンド** |
| **Phase 2** | **複数3連単買い目生成ロジック** | **2週間** | **バックエンド** |
| Phase 2 | predictions テーブルに volatile_patterns 追加 | 1週間 | バックエンド |
| Phase 2 | フロントエンド: 複数買い目表示UI | 2週間 | フロントエンド |
| Phase 3 | pattern_performance テーブル設計 | 1週間 | バックエンド |
| Phase 3 | 月次実績更新スクリプト実装 | 2週間 | バックエンド |
| Phase 3 | フロントエンド実績表示UI | 2週間 | フロントエンド |

---

## KPI・成功指標

| 指標 | 現在 | 3ヶ月 | 6ヶ月 |
|------|------|-------|-------|
| イン崩れスコア精度 | 50-55% | 55-60% | 60-65% |
| 会場別ルール数 | 34個 | 50個 | 72個 |
| 複数買い目提供 | ❌ | ✅ | ✅ |
| ユーザー成績記録 | ❌ | ✅ | ✅ |
| ユーザー回収率平均 | N/A | 105% | 110% |
| 月間アクティブユーザー | ? | +30% | +60% |

---

## 開発者向け注意事項

### 会場別ルール分析の進め方

```bash
# 月1回、5会場分析実施

npm run analyze-venue 01  # 桐生
npm run analyze-venue 02  # 戸田
npm run analyze-venue 05  # 多摩川
npm run analyze-venue 12  # 住之江
npm run analyze-venue 13  # 尼崎

# 結果を data/analysis/venue-XX/ に保存
# 統計検証: サンプル数20以上 + 回収率100%以上で採用
```

### スコア計算への新ルール組み込み

```javascript
// src/services/volatilityService.js

function calculateVolatilityScore(race) {
  let score = baseScore;
  
  // 既存: ターン予測
  score += turnPredictionAdjustment(race);
  
  // 新: 会場別ルール
  score += applyVenueRules(race);
  
  // 新: 気象・外的要因
  score += weatherAdjustment(race.windVelocity, race.waveHeight);
  
  // 新: ターン予測（詳細化）
  score += advancedTurnPrediction(race);
  
  return Math.max(0, Math.min(100, score));
}
```

### 出目分析の実装ポイント

**重要: 条件付き確率の計算**

```javascript
// 例: 児島で1着が4番の時の2着・3着パターン

const outcomePatterns = await supabase
  .from('race_outcome_frequencies')
  .select('*')
  .eq('venue_code', 16)           // 児島
  .eq('rank1_boat', 4)            // 1着が4番に限定
  .order('recovery_rate', { ascending: false })
  .limit(5);

// 結果: [
//   { rank2_boat: 2, rank3_boat: 3, recovery_rate: 138 },
//   { rank2_boat: 3, rank3_boat: 2, recovery_rate: 142 },
//   ...
// ]
```

**初期化時の処理**

- Phase 2 実装開始時、全24会場 × 過去180日分のレース結果を集計
- 毎日 `update-outcome-frequencies.js` で最新データを追加（前日分）
- 180日以前のデータは自動削除

### 複数3連単買い目生成の実装

```javascript
// src/services/predictionService.js

async function generateVolatilePatterns(race, volatilityScore) {
  if (volatilityScore < 51) {
    return null;  // スコア低い時は複数買い目なし
  }
  
  const venueCode = race.placeCd;
  const predictedRank1 = race.predictions.upsetFocus.topPick;
  
  // 出目分析: 1着がこの艇の時の有力パターン
  const { data: patterns } = await supabase
    .from('race_outcome_frequencies')
    .select('rank2_boat, rank3_boat, appearance_rate, recovery_rate')
    .eq('venue_code', venueCode)
    .eq('rank1_boat', predictedRank1)
    .gte('appearance_rate', 5)
    .order('recovery_rate', { ascending: false })
    .limit(5);
  
  return patterns.map((p, idx) => ({
    rank: idx + 1,
    pattern: `${predictedRank1}→${p.rank2_boat}→${p.rank3_boat}`,
    probability: p.appearance_rate,
    recovery_rate: p.recovery_rate,
    reasoning: inferReasoning(race, predictedRank1, p.rank2_boat, p.rank3_boat)
  }));
}

function inferReasoning(race, r1, r2, r3) {
  // ターン予測 + 展示データから根拠を推測
  const players = {
    1: race.racers.find(r => r.boatNumber === r1),
    2: race.racers.find(r => r.boatNumber === r2),
    3: race.racers.find(r => r.boatNumber === r3)
  };
  
  // 簡易: 枠番と展示STで判定
  // 今後: より精密な展開予測を組み込む
  
  return generateReasoningText(r1, r2, r3, players);
}
```

---

## リスク・注意事項

### 1. ユーザー行動への責任

現在の設計（「参考値」扱い）から、「実際に買う買い目を提示」に変わります。

**必須対応**:
- 利用規約に「AI予想は参考値であり、必ず当たるわけではない」と明記
- 免責事項を大きく表示
- ユーザーの買い目選択は「ユーザー自身の判断」と強調

### 2. データ品質

会場別ルール分析で「統計的に有意」な結果を出すため:
- サンプル数 20以上（必須）
- 回収率 100%以上（採用基準）
- ただし外的要因（新モーター、珍しい状況など）の影響を考慮

### 3. パフォーマンス

複数買い目パターン × 複数レース × 複数ユーザーで DB負荷増加。

**対応**:
- RLS（Row Level Security）で不要な行を取得しない
- キャッシュ戦略: 1時間キャッシュ
- インデックス最適化: `race_id + volatility_score` など

---

## 参考リソース

- `.claude/rules/analysis.md` - 会場別ルール分析ガイド
- `docs/design/first-mark-animation-design.md` - 展開予測実装参考
- `docs/db-migration/` - スキーマ変更の履歴
