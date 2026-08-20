# Linear チケット作成ガイド（BOA-99・100・101・102・103）

> イン崩れ指数の精度向上と複数買い目提供機能の実装に向けて

---

## 概要

この手順では、以下のチケットを Linear で作成・更新します：

| 作業 | チケット | 説明 |
|------|---------|------|
| 更新 | **BOA-99** | イン崩れ指数の複数買い目提供機能へスコープ変更 |
| 作成 | **BOA-100** | 出目分析テーブル構築（race_outcome_frequencies） |
| 作成 | **BOA-101** | 複数3連単買い目生成ロジック |
| 作成 | **BOA-102** | フロントエンド - 複数買い目表示UI |
| 作成 | **BOA-103** | パターン実績統計テーブル（pattern_performance） |

**総期間**: 約2.5ヶ月（Phase 1: 1ヶ月、Phase 2: 1.5ヶ月）

---

## Step 1: BOA-99 の更新

### Linear での操作
1. Linear で **BOA-99** を開く
2. **Edit** をクリック
3. **Title** と **Description** を以下に変更

### 新しいタイトル
```
出目分析テーブル構築と複数買い目表示（イン崩れ特化戦略）
```

### 新しい説明文
```
## 概要
イン崩れ指数（スコア 51-100）が高いレースで、複数の買い目パターンを提示する機能を実装。

## 目標
- スコア 51-100 の時のみ複数の3連単買い目を提示
- 出目分析から「回収率が高い順」に5パターンまで表示
- 月次実績統計で改善サイクルを構築

## サブチケット
- [ ] BOA-100: 出目分析テーブル構築（race_outcome_frequencies）
- [ ] BOA-101: 複数3連単買い目生成ロジック
- [ ] BOA-102: フロントエンド - 複数買い目表示UI
- [ ] BOA-103: パターン実績統計テーブル

## 関連ドキュメント
- `docs/design/in-kuzure-specialization-strategy.md` - 全体戦略
- `docs/operation/ticket-update-plan.md` - 実装計画
```

---

## Step 2: BOA-100 の作成

### Linear での操作
1. Linear で **Create issue** をクリック
2. **Project**: 龍神レーダー
3. **Title**: 以下の内容を貼り付け
4. **Description**: 以下の内容を貼り付け
5. **Parent**: BOA-99 を指定
6. **Estimate**: 1ヶ月

### タイトル
```
出目分析テーブル構築（race_outcome_frequencies）
```

### 説明文
```
## 目的
過去180日の出目パターン（1着→2着→3着）を会場別に記録し、複数買い目の根拠データとする

## 実装内容

### 1. テーブル作成: race_outcome_frequencies
```sql
CREATE TABLE race_outcome_frequencies (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  venue_code INT NOT NULL,          -- 会場コード（1-24）
  rank1_boat INT NOT NULL,          -- 1着艇番（1-6）
  rank2_boat INT NOT NULL,          -- 2着艇番（1-6）
  rank3_boat INT NOT NULL,          -- 3着艇番（1-6）
  
  total_occurrences INT,            -- 過去180日での出現回数
  appearance_rate DECIMAL(5,2),     -- 出現率（%）
  
  avg_payout DECIMAL(8,2),          -- 平均配当
  recovery_rate DECIMAL(5,2),       -- 180日間の回収率（%）
  
  last_updated TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(venue_code, rank1_boat, rank2_boat, rank3_boat)
);
```

### 2. 初期化スクリプト: scripts/db/init-outcome-frequencies.js
- 過去180日のレース結果を race_results テーブルから取得
- 会場×1着→2着→3着 の組み合わせごとに集計
- 出現率・回収率を計算して race_outcome_frequencies に挿入
- 実行時間: 約5-10分

### 3. 毎日更新スクリプト: scripts/daily/update-outcome-frequencies.js
- 前日のレース結果を取得して追加
- 180日以前のデータを削除（ローリングウィンドウ）
- scrape-scheduled.js から毎日呼び出し

## テスト計画
- [ ] テーブルが正常に作成されたことを確認
- [ ] 初期化後、各会場×組み合わせ別に行数を確認
- [ ] 各行の appearance_rate と recovery_rate が正常に計算されていることを確認
- [ ] 毎日更新スクリプトが正常に動作すること

## 依存
なし
```

---

## Step 3: BOA-101 の作成

### Linear での操作
1. Linear で **Create issue** をクリック
2. **Title**: 以下を貼り付け
3. **Description**: 以下を貼り付け
4. **Parent**: BOA-99
5. **Depends on**: BOA-100 を指定
6. **Estimate**: 2週間

### タイトル
```
複数3連単買い目生成ロジック
```

### 説明文
```
## 目的
スコア 51-100 の時に、出目分析から有力な3連単パターンを複数生成する

## 実装内容

### 1. generateVolatilePatterns() 関数
**場所**: src/services/predictionService.js

```javascript
async function generateVolatilePatterns(race, volatilityScore) {
  // スコア < 51 なら複数買い目なし
  if (volatilityScore < 51) {
    return null;
  }
  
  const venueCode = race.placeCd;
  const predictedRank1 = race.predictions.upsetFocus.topPick;
  
  // 出目分析から「この1着の時の有力パターン」を取得
  const { data: patterns } = await supabase
    .from('race_outcome_frequencies')
    .select('rank2_boat, rank3_boat, appearance_rate, recovery_rate')
    .eq('venue_code', venueCode)
    .eq('rank1_boat', predictedRank1)
    .gte('appearance_rate', 5)     // 出現率 5% 以上のみ
    .order('recovery_rate', { ascending: false })
    .limit(5);                      // トップ5パターン
  
  return patterns.map((p, idx) => ({
    rank: idx + 1,
    pattern: \`\${predictedRank1}→\${p.rank2_boat}→\${p.rank3_boat}\`,
    probability: p.appearance_rate,
    recovery_rate: p.recovery_rate,
    reasoning: inferReasoning(race, predictedRank1, p.rank2_boat, p.rank3_boat)
  }));
}
```

### 2. predictions テーブル更新
- volatile_patterns フィールド追加（JSONB型）

### 3. generate-predictions.js 更新
- generateRacePrediction() で generateVolatilePatterns() を呼び出し
- race.volatility.score >= 51 の時のみ実行

## テスト計画
- [ ] スコア < 51 のレースで null が返されること
- [ ] スコア >= 51 のレースで複数パターンが返されること
- [ ] パターンの probability が降順になっていること
```

---

## Step 4: BOA-102 の作成

### Linear での操作
1. Linear で **Create issue** をクリック
2. **Title**: 以下を貼り付け
3. **Description**: 以下を貼り付け
4. **Parent**: BOA-99
5. **Depends on**: BOA-101 を指定
6. **Estimate**: 2週間

### タイトル
```
フロントエンド - 複数買い目表示UI
```

### 説明文
```
## 目的
ユーザーが複数の3連単買い目を視覚的に確認できるようにする

## 実装内容

### 1. PredictionTable.jsx 更新
- 「イン崩れ時の複数買い目」セクション追加
- volatility_score >= 51 の時のみ表示
- 現在の「複勝おすすめ買い目」セクションの下に配置

### 2. UI レイアウト
```
【イン崩れスコア: 75 - 複数の3連単買い目（出目分析ベース）】

🎯 パターン1（最も有力）
4 → 2 → 3
出現率: 12.5% | 平均配当: 11.5倍 | 回収率: 138%
理由: 外枠逃げ → 本命2着 → 展示優秀艇

[タブで切り替え]
パターン2 | パターン3 | パターン4 | パターン5

ℹ️ この統計は児島での過去180日のデータです
```

### 3. コンポーネント設計
- VolatilePatternsDisplay.jsx (新規コンポーネント)
  - volatile_patterns 配列をタブ or カード形式で表示
  - 各パターンの説明を表示

## テスト計画
- [ ] スコア < 51 のレースで UI が表示されないこと
- [ ] スコア >= 51 のレースでパターン表示が表示されること
- [ ] 複数パターンをタブで切り替えできること
- [ ] モバイル端末での表示が正常であること
```

---

## Step 5: BOA-103 の作成

### Linear での操作
1. Linear で **Create issue** をクリック
2. **Title**: 以下を貼り付け
3. **Description**: 以下を貼り付け
4. **Parent**: BOA-99
5. **Estimate**: 1ヶ月

### タイトル
```
パターン実績統計テーブル（pattern_performance）
```

### 説明文
```
## 目的
月次でAI買い目パターンの実績を記録し、改善に活用する

## 実装内容

### 1. テーブル作成: pattern_performance
```sql
CREATE TABLE pattern_performance (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  pattern_name VARCHAR NOT NULL,         -- 「穴狙い（複勝）」など
  bet_type VARCHAR NOT NULL,             -- place / win / trio / exacta
  volatility_score_min INT NOT NULL,     -- スコア帯下限
  volatility_score_max INT NOT NULL,     -- スコア帯上限
  venue_code INT,                        -- NULL = 全会場, 指定値 = 会場別
  
  -- 実績統計（毎月更新）
  total_races INT DEFAULT 0,             -- 対象レース数
  hit_races INT DEFAULT 0,               -- 的中レース数
  hit_rate DECIMAL(5,2),                 -- 的中率（%）
  recovery_rate DECIMAL(5,2),            -- 回収率（%）
  avg_payout DECIMAL(8,2),               -- 平均配当
  
  last_updated TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(pattern_name, bet_type, volatility_score_min, volatility_score_max, venue_code)
);
```

### 2. 月次更新スクリプト: scripts/daily/update-pattern-performance.js
- 過去30日のレース結果を取得
- 各パターンごとに的中数・回収率を計算
- pattern_performance に更新

### 3. フロントエンド表示
- PredictionTable に「実績」セクション追加
- 「このパターンは過去30日で的中率58%、回収率118%」と表示

## テスト計画
- [ ] テーブルが正常に作成されたことを確認
- [ ] 月次更新スクリプトが正常に動作すること
- [ ] フロントエンドで実績統計が表示されること
```

---

## 実装順序

```
BOA-100: 出目分析テーブル構築 (1ヶ月)
   ↓ (完了後)
BOA-101: 買い目生成ロジック (2週間)
   ↓ (完了後)
BOA-102: フロントエンド UI (2週間) [並列で進行可能]
BOA-103: 実績統計テーブル (1ヶ月) [並列で進行可能]
```

**総期間**: 約2.5ヶ月

---

## チェックリスト

- [ ] BOA-99 のタイトル・説明を更新
- [ ] BOA-100 を作成（親: BOA-99）
- [ ] BOA-101 を作成（親: BOA-99、依存: BOA-100）
- [ ] BOA-102 を作成（親: BOA-99、依存: BOA-101）
- [ ] BOA-103 を作成（親: BOA-99）
- [ ] 各チケットが正しく親子関係・依存関係を持っていることを確認
