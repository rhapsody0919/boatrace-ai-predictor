# FirstMarkAnimation / turnPrediction 実装詳細調査（Task #14）

## 結論サマリ

**Task #13 の「艇別展開予測は存在しない」という判断は誤り。**

`predictions.feature_contributions.turnPrediction` には、艇別（コース別）の2着・3着確率分布を含む `patterns` 配列が存在する。Task #13 はデータ取得時に**旧フォーマットの 2026-03-06 のサンプルだけ**を見て判断したため、`patterns` / `boatStrengths` / `secondPlace` / `thirdPlace` を見落とした。

| 項目 | Task #13 の判断 | 実際 | 正誤 |
|------|----------------|------|------|
| turnPrediction の構造 | `{technique, probability, distribution, winnerCourse}` のみ | 上記＋`patterns[]`＋`boatStrengths[]` | **誤** |
| 艇別展開予測の有無 | 存在しない | **存在する**（patterns[].secondPlace/thirdPlace） | **誤** |
| winnerCourse=1固定 | 全レース1固定 | `turnPrediction.winnerCourse`（=patterns[0]）は確かに1固定。ただし patterns[1],[2] は course 2/3/4/5 も出現 | 一部のみ正 |
| technique=nige固定 | 全レース nige固定 | patterns[0] は nige固定。patterns[1],[2] は sashi/makuri/makurizashi 等 | 一部のみ正 |
| 3モデルで完全一致 | 完全一致 | **正しい**（turnPrediction はレース単位で1回計算し3モデル行に同一格納） | 正 |

---

## 実装フロー図

```
[展開予測ロジック]                 [予測生成バッチ]              [DB]                      [データ取得]            [UI]
scripts/lib/turnPrediction.js  →  scripts/daily/             →  predictions テーブル  →  src/services/        →  src/components/race/
predictFirstMarkV2()              generate-predictions.js       feature_contributions     supabaseDataService     FirstMarkAnimation.jsx
                                  generateRacePrediction()      (JSONB).turnPrediction    .js                     （PredictionPanel 経由）
```

- 展開予測はレース単位で **1回だけ** 計算され、standard / safeBet / upsetFocus の3行すべてに**同一の** `feature_contributions` が格納される（`generate-predictions.js` L1219-1227）。
- `top_pick` / `top_2nd` / `top_3rd` はモデル別スコア関数（`calculateStandardScoreV2` / `calculateSafeBetScore` / `calculateUpsetFocusScore`）で**別々に**計算されるため、モデル間で異なる。展開予測（turnPrediction）自体はモデル非依存。

---

## turnPrediction の完全な構造

`predictFirstMarkV2()`（`scripts/lib/turnPrediction.js` L152-475）の出力 = DB 格納構造（`generate-predictions.js` L733-739）:

```jsonc
{
  "technique":    "nige",      // patterns[0].technique（最有力決まり手）
  "probability":  0.29,        // patterns[0].probability
  "winnerCourse": 1,           // patterns[0].winnerCourse（最有力1着コース）
  "distribution": {            // 決まり手別の合算確率（全パターン合計、合計≒1.0）
    "nige": 0.28, "sashi": 0.25, "makuri": 0.17,
    "makurizashi": 0.16, "nuki": 0.12, "megumare": 0.02
  },
  "patterns": [                // 上位3展開シナリオ（probability 降順）
    {
      "technique": "nige",
      "winnerCourse": 1,
      "probability": 0.29,
      "secondPlace": { "2":0.39, "3":0.27, "4":0.16, "5":0.11, "6":0.07 },  // 1着コース確定時の2着コース別確率（合計1.0）
      "thirdPlace":  { "2":0.27, "3":0.22, "4":0.19, "5":0.17, "6":0.14 }   // 同 3着コース別確率（合計1.0）
    },
    { "technique": "sashi",  "winnerCourse": 2, "probability": 0.09, "secondPlace": {...}, "thirdPlace": {...} },
    { "technique": "makuri", "winnerCourse": 2, "probability": 0.09, "secondPlace": {...}, "thirdPlace": {...} }
  ],
  "boatStrengths": [0.48,0.64,0.54,0.47,0.49,0.38]  // コース1-6の総合強さスコア（ST優位+モーター+選手力+展示）
}
```

### `distribution` の各キーの意味（決まり手）

| キー | 日本語 | 意味 |
|------|--------|------|
| `nige` | 逃げ | 1コースが先行のまま1着 |
| `sashi` | 差し | 内側を突いて1着（主に2コース） |
| `makuri` | まくり | 外から一気にまくって1着（主に3-4コース） |
| `makurizashi` | まくり差し | まくりつつ内を差して1着（主に4-5コース） |
| `nuki` | 抜き | 1マーク後の直線で抜いて1着 |
| `megumare` | 恵まれ | 先行艇のトラブルで繰り上がり1着 |

`distribution` は「**6つの決まり手それぞれが起きる確率**」の合算（全 patterns を技ごとに足し上げたもの）。`patterns` は「**起こりうる上位3つの具体シナリオ**（決まり手＋1着コース＋2-3着分布）」。

---

## turnPrediction 実データ例（1レース分）

race_id `2026-05-14-01-01`（桐生1R）, model `standard`:

```json
{
  "technique": "nige",
  "probability": 0.29,
  "winnerCourse": 1,
  "distribution": { "nige":0.28, "sashi":0.25, "makuri":0.17, "makurizashi":0.16, "nuki":0.12, "megumare":0.02 },
  "patterns": [
    { "technique":"nige", "winnerCourse":1, "probability":0.29,
      "secondPlace":{"2":0.39,"3":0.27,"4":0.16,"5":0.11,"6":0.07},
      "thirdPlace":{"2":0.27,"3":0.22,"4":0.19,"5":0.17,"6":0.14} }
    /* patterns[1], patterns[2] 省略 */
  ]
}
```

race_id `2026-05-10-05-01`（多摩川1R）— patterns[1],[2] が winnerCourse≠1 の例:

```
patterns[0]: nige   / winnerCourse 1 / prob 0.20
patterns[1]: sashi  / winnerCourse 2 / prob 0.09   ← winnerCourse=2
patterns[2]: makuri / winnerCourse 2 / prob 0.09   ← winnerCourse=2
```

---

## フォーマット変遷（Task #13 誤判断の原因）

| 期間 | turnPrediction フォーマット |
|------|---------------------------|
| **2026-03-06 のみ**（48件） | 旧: `{technique, probability, distribution, winnerCourse}`（patterns なし） |
| **2026-03-08 以降**（31,896件） | 現: 上記＋`patterns[]`＋`boatStrengths[]` |
| 2026-01-09 以前 | feature_contributions 自体が null（旧 `scores` 仕様） |

Task #13 はデータ取得で `.gte("race_id","2026-03-06")` を使い、`order ascending` の先頭40件＝すべて 2026-03-06 の旧フォーマットを取得していた。そのため `patterns` を含まないサンプルだけを見て「艇別展開予測なし」と誤判定した。**直近90日のほぼ全期間（2026-03-08〜）で patterns 付きフルフォーマットが利用可能。**

---

## 各レイヤーの詳細

### 1. 生成層 — `scripts/lib/turnPrediction.js` / `scripts/daily/generate-predictions.js`

- `predictFirstMarkV2(players, raceConditions)`：6艇の選手データ（ST・決まり手分布・モーター・級別）＋会場/気象から、コース×決まり手の統一確率を計算 → softmax正規化 → 上位3パターン抽出 → 各パターンに2着/3着分布（`getPlacementBaseline` ベース）を付与。
- `generate-predictions.js` L632 で `predictFirstMark()` を1回呼び、L733-739 で `feature_contributions.turnPrediction` に格納。L1219-1227 で3モデル行に**同一の** `featureContrib` を書き込む。
- 注：`generate-predictions.js` には feature_contributions を書く挿入経路が2つある（L917-960 と L1219-1227）。両方とも `race.turnPrediction`（patterns 含む）を格納する。

### 2. データ層 — `predictions` テーブル

- `feature_contributions`（JSONB）。`turnPrediction` サブオブジェクトに上記構造。`racerStats` サブオブジェクトに選手統計。
- `top_pick` / `top_2nd` / `top_3rd` はモデル別の最終買い目（turnPrediction とは別系統の計算）。

### 3. 取得層 — `src/services/supabaseDataService.js`

- L732：`standardPred.feature_contributions.turnPrediction` を取得（standard 行から。3モデル同一なのでどれでも可）。
- L733-738：`patterns` が無い旧データには `[{technique,winnerCourse,probability}]` のフォールバックを生成。
- `prediction.turnPrediction` として UI に渡す。

### 4. UI層 — `src/components/race/FirstMarkAnimation.jsx`（`PredictionPanel.jsx` L171-177 経由）

- props：`patterns` / `technique` / `probability` / `winnerCourse` / `distribution` / `boatStrengths` / `players`。
- `patterns[selectedPatternIndex]` の `technique` / `winnerCourse` を使って決まり手別 SVG アニメーションパスを生成。
- `getTopCourse(pattern.secondPlace)` / `getTopCourse(pattern.thirdPlace)` で2着・3着の最有力コースを抽出し表示。
- `distribution` を `DistributionBars` で確率バー表示。`boatStrengths` でアニメーション速度差を表現。
- → UI が「1マーク展開予測」を描けているのは、まさに `patterns[].secondPlace/thirdPlace` という艇別展開予測が DB に存在するため。Task #13 の結論と UI の存在が矛盾していたのは、Task #13 のデータ取得ミスが原因。

---

## 設計ドキュメントとの照合

- `docs/design/first-mark-animation-design.md`：Phase 3B で「結果を `feature_contributions.turnPrediction` として保存」「3モデルすべてに格納」と明記。Phase 4 で `patterns` 配列・`secondPlace`/`thirdPlace`・`boatStrengths` を UI が使う前提。
- `docs/design/turn-prediction-v3-design.md` / `turn-prediction-v2-design.md`：予測ロジックの詳細仕様。
- **実装と設計に乖離なし。** 設計どおり patterns 付きで保存・利用されている（2026-03-08 以降）。Task #13 が想定した「scores によるフル順位」は旧世代仕様で、現行は turnPrediction.patterns がその役割を担う。

---

## 「艇別展開予測の有無」最終判定

**艇別展開予測は存在する。** ただし「6艇のフル着順ランキング（1位→6位）」という形ではなく、以下の形で存在する：

1. **1着コース予測**：`patterns[].winnerCourse`（上位3シナリオ。patterns[0] は実質ほぼ常に1コース＝逃げ）
2. **2着コース別確率**：`patterns[].secondPlace`（1着確定時の各コース2着確率、合計1.0）
3. **3着コース別確率**：`patterns[].thirdPlace`（同 3着確率、合計1.0）
4. **艇別総合強さ**：`boatStrengths`（コース1-6の連続スコア）

→ これは「1着コース × 2着分布 × 3着分布」という条件付き構造であり、3連単の買い目評価には**そのまま使える**。`boatStrengths` をソートすれば「6艇の強さ順」も得られる。

---

## Task #12 / #13 への影響

**Task #13 の再分析が必要。** Task #13 は「turnPrediction に艇別予測が無い」前提で、`predictions.top_pick` のみを使い出目分布を外部適用した。実際には：

- `turnPrediction.patterns[].secondPlace/thirdPlace` という**モデル自身の2-3着予測**が存在する。
- `boatStrengths` で6艇の強さ順が得られるため、Task #12 が `scores` で実現しようとした「予測下位N艇の除外」も**現行データで実装可能**（直近90日で利用可）。

推奨：Task #12（予測下位N艇除外）と Task #13（出目分布統合）を、`turnPrediction.patterns` と `boatStrengths` を使った正しいデータ基盤で再実装する新タスクを起票すべき。
