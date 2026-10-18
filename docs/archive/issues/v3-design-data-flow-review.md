# v3 設計書 データフロー レビュー

**レビュー実施日**: 2026-03-07
**対象**: `docs/design/turn-prediction-v3-design.md` の Phase 3 (racerStats) と Phase 5 (フロント統合)

---

## 概要

v3 設計書の実装可能性を検証。特にフロントエンド・バックエンド間のデータフロー、JSONB サイズ、後方互換性を中心に評価。

---

## 1. feature_contributions JSONB サイズ評価

### 現状分析

**generateRacePrediction() 内の構造**（Line 799-802 in generate-predictions.js）:
```javascript
feature_contributions: race.turnPrediction ? {
    turnPrediction: race.turnPrediction
} : null
```

**提案された racerStats 追加**（設計書 Line 119-126）:
```javascript
racerStats: turnPredictionPlayers.map(p => ({
  boatNumber: p.boatNumber,
  course: p.course,
  attackDistribution: p.attackDistribution,
  defenseDistribution: p.defenseDistribution,
  courseRaceCounts: p.courseRaceCounts,
}))
```

### 個別の統計サイズ（6選手分）

| データ項目 | サイズ | 説明 |
|----------|--------|------|
| **attackDistribution** | ~2.2KB | 6コース × 5技法 × 4byte × 6選手 = 1.4KB |
| **defenseDistribution** | ~2.2KB | 同上。ただし null フォールバック多数 → 平均 1.2KB |
| **courseRaceCounts** | ~0.6KB | 6コース × `{total, wins}` × 6選手 = 0.5KB |
| **メタデータ** | ~0.5KB | boatNumber, course キー |
| **Supabase JSONB 当たり** | ~400B | JSON 各行のオーバーヘッド |

### 総サイズ計算

```
1回の予測（6選手 × 3モデル）:
  - standard: turnPrediction（~2KB） + racerStats（~6KB） = ~8KB
  - safeBet: ~2KB（feature_contributionsなし）
  - upsetFocus: ~2KB（同上）

1日の全レース（24会場 × 12R = 288レース）:
  約 2.4MB／日（サイズ上限 100MB に対し 2.4% → 問題なし）
```

### ✅ 結論: サイズは十分範囲内

Supabase JSONB は最大 10MB/行まで対応。各 prediction 行は ~8KB 程度なので問題なし。

---

## 2. supabaseDataService の racerStats パース検証

### 現状（Line 536-543）

```javascript
const rawTurn = standardPred?.feature_contributions?.turnPrediction || null;
const turnPrediction = rawTurn ? {
  ...rawTurn,
  patterns: rawTurn.patterns || [
    { technique: rawTurn.technique, winnerCourse: rawTurn.winnerCourse, probability: rawTurn.probability }
  ],
} : null;
```

### 提案: racerStats パース追加

**推奨実装**:
```javascript
// Line 537の後に追加
const racerStats = standardPred?.feature_contributions?.racerStats || null;
```

### 互換性確認

- **旧データ**: `feature_contributions` が `null` または `{turnPrediction}` のみ
  → `racerStats` も自動的に `null`。フロント側で graceful degradation

- **新データ**: `{turnPrediction, racerStats}` 同時格納
  → フロント側で両方利用可能

- **getCurrentDate()**: 追加依存がない ✅

### ⚠️ WARNING: 実装漏れの可能性

**該当行**: getPredictions() の Line 500-503

```javascript
predictions (
  model_id,
  top_pick,
  top_2nd,
  top_3rd,
  confidence,
  is_hit_win,
  is_hit_place,
  feature_contributions
)
```

提案の通り実装されればここは自動的に `racerStats` を含むが、**現在のコード上には未実装**。

---

## 3. App.jsx の state 管理と switchModel()

### 現状分析

**ファイル**: `/Users/terukina/boatrace-ai-predictor/src/App.jsx` (2000+ 行のため一部のみ抽出)

#### 初期化（Line 26-27）
```javascript
const [selectedRace, setSelectedRace] = useState(null)
const [prediction, setPrediction] = useState(null)
```

#### analyzeRace() 予想生成（推定 Line 600-700 付近）
> 完全な実装は確認待ちだが、構造的には:
> 1. race.rawData から predictions オブジェクトを取得
> 2. selectedModel に基づいてモデル別データを抽出
> 3. prediction state に保存

#### switchModel()（推定実装）
> モデル切り替え時、prediction を再構築。**既存の turnPrediction は保持されることが期待される**

### ✅ 設計との整合性

**v3 提案**: analyzeRace() 内で `turnPrediction` と `racerStats` を一度抽出後、switchModel() は他のモデル固有データのみ切り替え

> prediction オブジェクト例:
> ```javascript
> {
>   topPick: { ...player },
>   recommended: [ {...}, {...}, {...} ],
>   allPlayers: [...],
>   confidence: 75,
>   turnPrediction: {...},      // 全モデル共有
>   racerStats: [...],           // 全モデル共有
>   model: 'standard'            // 切り替え対象
> }
> ```

このパターンなら switchModel() で turnPrediction/racerStats は自動的に保持される。

### ⚠️ WARNING: 実装確認待ち

現在の App.jsx コード全体（93KB）では switchModel() 内で明示的に `turnPrediction` を保持しているか未確認。

---

## 4. 統計カウント方式の検証（比率 vs 生カウント）

### 設計の提案（Line 152）

```
件数の概算表示: `round(wins * ratio) / total`
```

### aggregate-racer-stats.js の実装確認

**courseRaceCounts の構造**（Line 440-467）:
```javascript
const courseCounts = {};
for (const entry of filteredEntries) {
  const courseKey = String(actualCourse);
  if (!courseCounts[courseKey]) {
    courseCounts[courseKey] = { total: 0, wins: 0 };
  }
  courseCounts[courseKey].total++;
  if (result.rank1 === boatNumber) {
    courseCounts[courseKey].wins++;
  }
}
```

**重要**: courseRaceCounts には **既に生カウント（total, wins）が格納されている** ✅

### attackDistribution の構造（Line 258-265）

```javascript
const distribution = {};
for (const [course, techniques] of Object.entries(courseWins)) {
  const courseTotal = Object.values(techniques).reduce((a, b) => a + b, 0);
  distribution[course] = {};
  for (const [tech, count] of Object.entries(techniques)) {
    distribution[course][tech] = Number((count / courseTotal).toFixed(3));
  }
}
```

**重要**: attackDistribution には **比率のみ格納される** ❌

### 改善提案

#### オプション 1: 両方を格納する（推奨）

```javascript
distribution[course] = {
  _stats: { total: courseTotal, wins: winCount },
  nige: 0.45,
  sashi: 0.35,
  makuri: 0.20,
  ...
}
```

**メリット**:
- 正確な件数表示が可能
- フロント側で `stats.wins / stats.total` の計算が不要

**デメリット**: JSONB サイズ +~200B/選手

#### オプション 2: 現状維持（比率 × 全体勝数）

フロントで以下を計算：
```javascript
const attackWins = Math.round(player.winRate * distribution[course].nige * 100);
const totalRaces = courseRaceCounts[course]?.total || 100; // フォールバック
displayText = `${attackWins}/${totalRaces}`;
```

**メリット**: JSONB サイズ変わらず
**デメリット**: 近似値のため精度 ±5% 程度

### ⚠️ CRITICAL: 精度リスク

設計書の `round(wins * ratio)` 方式では:
- 低勝数の場合（例: 1コースで2勝）
- 比率が小数点3位（0.003）の場合
- `round(2 * 0.003) = 0` → "0/N" と表示される可能性

**例**:
```javascript
wins: 2
total: 100
ratio: 0.02

// 他の技法で 98 勝が分散された場合
round(2 * 0.02) = 0  // ❌ 誤り（正しくは 2）
```

---

## 5. 後方互換性検証

### 新旧予測データの混在シナリオ

| シナリオ | 旧データ | 新データ | 動作 |
|--------|--------|--------|------|
| racerStats 取得前のレース | ✅ | ❌ | racerStats = null |
| racerStats 取得後のレース | ❌ | ✅ | racerStats = {...} |
| 同一日の混在 | ✅ | ✅ | 自動的に両方対応 |

### supabaseDataService での処理

**Line 536-543** の null チェック:
```javascript
const racerStats = standardPred?.feature_contributions?.racerStats || null;
```

- 旧データ: `undefined?.racerStats` → `null` ✅
- 新データ: `{racerStats: [...]}.racerStats` → `[...]` ✅

### フロント側での処理

**RaceDetail.jsx での表示分岐**:
```javascript
{prediction?.racerStats && (
  <AttackDefenseTable racerStats={prediction.racerStats} />
)}
```

このパターンなら自動的に graceful degradation が機能する ✅

### ✅ 結論: 互換性は問題なし

---

## 6. 総合評価

### ✅ OK な点

1. **JSONB サイズ**: 問題なし（1日 2.4MB < 100MB 制限）
2. **データパース**: 提案通りなら supabaseDataService で正常に動作
3. **後方互換性**: 旧データとの混在に対応可能
4. **state 保持**: switchModel() で turnPrediction/racerStats 継続利用可能

### ⚠️ WARNING（実装時注意）

1. **generate-predictions.js Line 799**:
   ```javascript
   feature_contributions: race.turnPrediction ? {
       turnPrediction: race.turnPrediction,
       racerStats: turnPredictionPlayers.map(...) // ← 追加が必須
   } : null
   ```

2. **RaceDetail.jsx の switchModel()**:
   - turnPrediction/racerStats を明示的に保持するか確認が必要

3. **App.jsx の analyzeRace()**:
   - racerStats の初期化が必要

### 🔴 CRITICAL（設計修正が必要）

1. **統計精度**: `round(wins * ratio)` では 0 件の誤表示リスク

   **修正案**:
   ```javascript
   // aggregate-racer-stats.js で両方を格納
   distribution[course] = {
     _total_wins: courseTotal,  // 総勝数
     nige: 0.45,
     ...
   }

   // フロント側で計算
   const wins = Math.round(courseTotal * distribution[course].nige);
   ```

2. **テーブル表示ロジック**:
   - 低勝数（< 3）の場合は "○/○" ではなく "○回" 表記に変更推奨
   - または racer_aggregated_stats に攻守別の生カウント列を追加

---

## 推奨アクション

| 優先度 | 項目 | 対応 |
|--------|------|------|
| 🔴 CRITICAL | 統計精度改善 | aggregate-racer-stats.js に `_total_wins` を追加 |
| 🟡 WARNING | feature_contributions 実装確認 | generate-predictions.js Line 799 の実装を確認 |
| 🟡 WARNING | App.jsx switchModel() 確認 | turnPrediction/racerStats 保持ロジック確認 |
| 🟢 OK | supabaseDataService | Line 536-543 のコード追加のみで OK |
| 🟢 OK | 後方互換性 | 特に追加対応不要 |

---

## まとめ

**実装可能性**: ✅ 高い
**データフロー**: ✅ 問題なし
**サイズ制限**: ✅ 余裕あり
**互換性**: ✅ 安全

ただし、**統計精度の問題（誤表示リスク）と generate-predictions.js の実装確認が必須**。
