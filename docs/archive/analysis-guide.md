# 分析ガイド

ルール発掘から実装までの分析ワークフロー、および展開予測の精度分析。

---

## 目次

1. [概要](#概要)
2. [ディレクトリ構造](#ディレクトリ構造)
3. [分析ワークフロー](#分析ワークフロー)
4. [分析スクリプト一覧](#分析スクリプト一覧)
5. [ルール発掘の手順](#ルール発掘の手順)
6. [ルール実装の手順](#ルール実装の手順)

---

## 概要

### 目標

各会場で「回収率100%超え」のルール・条件を統計的に発見し、厳選型のモデルを構築する。

### 基本方針

- **データドリブン**: 過去データから統計的に有効なパターンを発見
- **会場別最適化**: 会場ごとの特性を考慮したルール設計
- **厳選型**: サンプル数・回収率の基準を満たすルールのみ採用

---

## ディレクトリ構造

```
data/analysis/
├── summary/
│   └── venue-stats.json         # 全24会場の基本統計
│
├── venue-01/                    # 桐生
│   ├── README.md                # 会場特性・分析サマリー
│   ├── RULE_SPECIFICATION.md    # ルール実装仕様
│   └── rules.json               # ルール定義（JSON）
│
├── venue-03/                    # 江戸川
│   └── ...
│
├── all-rules-recalculation.json # 全ルール再計算結果
├── exacta-rules-discovery.json  # 3連単ルール発掘結果
├── trio-rules-recalculation.json # 3連複ルール再計算結果
├── profitable-strategies.json   # 高回収率戦略一覧
└── optimal-betting-strategy.json # 最適賭け戦略
```

### 各ファイルの役割

| ファイル | 用途 | 更新タイミング |
|---------|------|--------------|
| `summary/venue-stats.json` | 全会場の基本統計（レース数、1号艇勝率、回収率） | 月次 |
| `venue-XX/README.md` | 会場特性と発見したルールのサマリー | 分析時 |
| `venue-XX/RULE_SPECIFICATION.md` | ルールの実装仕様（コード例含む） | 分析時 |
| `venue-XX/rules.json` | ルール定義のJSON形式 | 分析時 |
| `all-rules-recalculation.json` | 全ルールの最新成績 | 週次/必要時 |

---

## 分析ワークフロー

### 全体フロー

```
[1. 全会場統計収集]
    │
    ▼
[2. 分析対象会場の選定]
    │  優先度: 回収率高い / サンプル多い / 未分析
    ▼
[3. 詳細分析の実行]
    │  条件探索: 艇番、レース番号、信頼度帯など
    ▼
[4. ルール候補の抽出]
    │  基準: 回収率100%超え、サンプル10件以上
    ▼
[5. 検証・精査]
    │  別期間での検証、過学習チェック
    ▼
[6. ルール実装]
    │  ruleMatchService.js にコード追加
    ▼
[7. ドキュメント作成]
    │  README.md, RULE_SPECIFICATION.md
    ▼
[8. 運用・監視]
    /admin/rules で成績を監視
```

### PDCA サイクル

```
[仮説立案] → [データ分析] → [ルール発見] → [検証] → [本番適用] → [結果確認]
     ↑                                                              ↓
     └──────────────────── フィードバック ←─────────────────────────┘
```

---

## 分析スクリプト一覧

### 統計収集

| スクリプト | 用途 | 使用例 |
|-----------|------|--------|
| `collect-venue-stats.js` | 全会場の基本統計を収集 | `node scripts/analysis/collect-venue-stats.js` |

**出力**: `data/analysis/summary/venue-stats.json`

### 会場別分析

| スクリプト | 用途 | 使用例 |
|-----------|------|--------|
| `analyze-venue-generic.js` | 汎用会場分析 | `node scripts/analysis/analyze-venue-generic.js --venue=03` |
| `analyze-venue-03.js` | 江戸川専用分析 | `node scripts/analysis/analyze-venue-03.js` |
| `analyze-venue-03-trio.js` | 江戸川3連複分析 | - |
| `analyze-venue-03-trifecta.js` | 江戸川3連単分析 | - |

### ルール検証・再計算

| スクリプト | 用途 | 使用例 |
|-----------|------|--------|
| `recalculate-all-rules.js` | 全ルールの成績再計算 | `node scripts/analysis/recalculate-all-rules.js` |
| `recalculate-trio-rules.js` | 3連複ルール再計算 | - |
| `discover-exacta-rules.js` | 3連単ルール発掘 | - |

### その他

| スクリプト | 用途 |
|-----------|------|
| `find-profitable-strategies.js` | 高回収率戦略の探索 |
| `verify-calculations.js` | 計算結果の検証 |
| `find-missing-dates.js` | 欠損データの特定 |

---

## ルール発掘の手順

### Step 1: 全会場統計の収集

```bash
node scripts/analysis/collect-venue-stats.js
```

**確認項目**:
- 各会場のレース数（サンプル数）
- 1号艇勝率
- 単勝/複勝/3連複の回収率
- 分析優先度スコア

### Step 2: 分析対象会場の選定

**優先度の基準**:

| 優先度 | 条件 |
|--------|------|
| 高 | 3連複回収率 400%以上、またはサンプル数500以上 |
| 中 | 複勝回収率 100%以上 |
| 低 | 既に分析済み、またはサンプル不足 |

### Step 3: 詳細分析の実行

```bash
# 汎用スクリプト
node scripts/analysis/analyze-venue-generic.js --venue=10

# または会場専用スクリプト
node scripts/analysis/analyze-venue-03.js
```

**分析対象の条件**:
- 艇番（top_pick: 1-6）
- 予測組み合わせ（top3の艇番パターン）
- 信頼度帯（confidence: 70-79, 80-89, 90+）
- レース番号（前半1-6R、後半7-12R）
- 1号艇の有無

### Step 4: ルール候補の抽出

**採用基準**:

| 指標 | 基準 |
|------|------|
| 回収率 | 100%以上（必須） |
| サンプル数 | 10以上（推奨20以上） |
| 的中率 | 参考値（回収率優先） |

**信頼性レベル**:

| レベル | 条件 |
|--------|------|
| highest | サンプル150以上 & 回収率100%以上 |
| high | サンプル50以上 & 回収率100%以上 |
| medium | サンプル10以上 & 回収率100%以上 |

### Step 5: 検証・精査

- 別期間のデータで再検証
- 過学習の兆候がないか確認
- 類似条件との比較

---

## ルール実装の手順

### Step 1: ルールIDの決定

**命名規則**: `{会場プレフィックス}-{種別}{連番}`

| 会場 | プレフィックス | 例 |
|------|---------------|-----|
| 江戸川(03) | E03 | E03-W001, E03-T002 |
| 平和島(04) | HW04 | HW04-EX001 |
| 浜名湖(06) | H06 | H06-P001 |
| 三国(10) | M10 | M10-W001 |
| 徳山(18) | TY18 | TY18-EX001 |

**種別サフィックス**:
- W: 単勝 (win)
- P: 複勝 (place)
- T: 3連複 (trio)
- EX: 3連単 (exacta)

### Step 2: コードの実装

**ファイル**: `src/services/ruleMatchService.js`

```javascript
// 会場別ルール定数に追加
const EDOGAWA_RULES = [
  {
    id: 'E03-W001',
    patternName: 'EDOGAWA-WIN-NO2-CONF70',
    description: '2号艇推し×conf70-80',
    betType: 'win',
    stats: { samples: 12, hits: 6, recovery: 203 },  // 発掘時の統計
    reliability: 'highest',
    check: (pred, raceNo, conf, predSorted, has1) =>
      pred.topPick === 2 && conf >= 70 && conf < 80
  },
  // ... 他のルール
]
```

**check関数のパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| pred | Object | 予測オブジェクト（topPick, top3, confidence） |
| raceNo | number | レース番号（1-12） |
| conf | number | 信頼度（0-100） |
| predSorted | string | top3をソートした文字列（例: "1-2-3"） |
| has1 | boolean | top3に1号艇が含まれるか |

### Step 3: ドキュメント作成

**必須ファイル**（3点セット）:

```
data/analysis/venue-{コード}/
├── README.md              # 会場特性・分析サマリー
├── RULE_SPECIFICATION.md  # ルール実装仕様（コード例）
└── rules.json             # ルール定義（JSON）
```

### Step 4: デプロイ

```bash
git add src/services/ruleMatchService.js
git add data/analysis/venue-XX/
git commit -m "feat: {会場名}ルールを追加"
git push origin master
```

---

## 運用・監視

### 週次チェック

1. `/admin/rules` にアクセス
2. 「概要」タブで全ルールの回収率を確認
3. 回収率100%未満のルールをリストアップ
4. 2週間連続で悪いルールは除外検討

### 月次分析

1. 全会場統計を再収集
2. 新しい高回収率パターンを探索
3. 有望なパターンがあればルール追加

---

## 展開予測の分析

### 概要

ルール発掘とは別に、1マーク展開予測の精度分析も重要な分析対象。

### 関連スクリプト

| スクリプト | 用途 |
|-----------|------|
| `scripts/lib/turnPrediction.js` | 展開予測ロジック本体 |
| `scripts/daily/generate-predictions.js` | 予測生成（turnPrediction含む） |

### 分析可能なデータ

| データ | テーブル | 用途 |
|--------|---------|------|
| 展開予測パターン | `predictions.feature_contributions` | 予測パターンの的中率分析 |
| 実際の決まり手 | `race_results.winning_technique` | 予測vs実績の比較 |
| 進入コース | `race_results.course_1〜6` | 枠なり率分析 |
| 本番ST | `race_start_timings` | ST予測の精度検証 |
| 展示ST | `exhibition_data` | 展示→本番のST相関分析 |
| 選手の攻防分布 | `racer_aggregated_stats` | 個人傾向の信頼性検証 |

### 分析の方向性

1. **展開予測的中率**: 最有力パターン（technique + winnerCourse）が実際の決まり手と一致する割合
2. **確率キャリブレーション**: 予測確率と実際の発生頻度の相関
3. **ST予測精度**: 展示STと本番STの乖離度分析
4. **コース別精度**: イン逃げ率が高い会場 vs 波乱の多い会場での精度差

---

## 参考: 会場コード一覧

```
01:桐生    02:戸田    03:江戸川  04:平和島  05:多摩川  06:浜名湖
07:蒲郡    08:常滑    09:津      10:三国    11:びわこ  12:住之江
13:尼崎    14:鳴門    15:丸亀    16:児島    17:宮島    18:徳山
19:下関    20:若松    21:芦屋    22:福岡    23:唐津    24:大村
```

---

## 関連ドキュメント

- [system-specification.md](./system-specification.md) - システム仕様書
- [database-design.md](../reference/database-design.md) - データベース設計書
- [RULE_OPERATION_GUIDE.md](rule-operation-guide.md) - ルール運用ガイド
