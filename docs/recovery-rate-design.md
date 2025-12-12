# 実際の回収率計算機能 - 詳細設計書

## 1. 概要

現在の「推定回収率」を、実際の配当データを使った「実回収率」に変更する機能の設計。

## 2. 前提条件

### 購入パターン
- **単勝**: AI予想の本命（1位予想）を1点買い（100円）
- **複勝**: AI予想の本命（1位予想）を1点買い（100円）
- **3連複**: 実装対象外（組み合わせが複雑なため、今回は対象外）
- **3連単**: 実装対象外（組み合わせが複雑なため、今回は対象外）

### データソース
- **取得元URL**: `https://www.boatrace.jp/owpc/pc/race/raceresult?rno={raceNo}&jcd={venueCode}&hd={date}`
- 現在、順位のみ取得している同じページから配当も取得可能

## 3. データ取得の詳細

### 3.1 公式サイトのHTML構造（推定）

レース結果ページには、通常以下のような配当表があります：

```html
<!-- 単勝 -->
<table class="payoff-table">
  <tr>
    <th>単勝</th>
    <td>1</td>
    <td>320円</td>
  </tr>
</table>

<!-- 複勝 -->
<table class="payoff-table">
  <tr>
    <th>複勝</th>
    <td>1</td>
    <td>150円</td>
  </tr>
  <tr>
    <td></td>
    <td>3</td>
    <td>200円</td>
  </tr>
  <tr>
    <td></td>
    <td>2</td>
    <td>180円</td>
  </tr>
</table>

<!-- 3連単 -->
<table class="payoff-table">
  <tr>
    <th>3連単</th>
    <td>1-3-2</td>
    <td>4,560円</td>
  </tr>
</table>
```

**注意**: 実際のHTML構造は異なる可能性があるため、実装時に確認が必要。

### 3.2 スクレイピング処理の追加

**ファイル**: `scripts/scrape-results.js`

**追加する関数**:
```javascript
// 配当データをスクレイピング
function scrapePayouts($) {
  const payouts = {
    win: {},      // 単勝: { "1": 320 }
    place: {},    // 複勝: { "1": 150, "3": 200, "2": 180 }
    trifecta: {}, // 3連複: { "1-2-3": 1240 }
    trio: {}      // 3連単: { "1-2-3": 4560 }
  };

  // セレクタは実際のHTML構造に合わせて調整
  // 単勝の配当
  $('.単勝のセレクタ').each((i, el) => {
    const boatNumber = $(el).find('.艇番').text().trim();
    const payout = parseInt($(el).find('.配当').text().replace(/[^0-9]/g, ''));
    payouts.win[boatNumber] = payout;
  });

  // 複勝の配当
  $('.複勝のセレクタ').each((i, el) => {
    const boatNumber = $(el).find('.艇番').text().trim();
    const payout = parseInt($(el).find('.配当').text().replace(/[^0-9]/g, ''));
    payouts.place[boatNumber] = payout;
  });

  // 3連複・3連単も同様

  return payouts;
}
```

**scrapeRaceResult関数の修正**:
```javascript
async function scrapeRaceResult(venueCode, raceNo, dateStr) {
  // ... 既存のコード ...

  return {
    finished: true,
    rank1: rankings[0],
    rank2: rankings[1],
    rank3: rankings[2],
    payouts: scrapePayouts($),  // 追加
    updatedAt: new Date().toISOString(),
  };
}
```

## 4. データ構造の変更

### 4.1 予想データJSON

**ファイル**: `data/predictions/YYYY-MM-DD.json`

**変更前**:
```json
{
  "result": {
    "finished": true,
    "rank1": 1,
    "rank2": 3,
    "rank3": 2,
    "updatedAt": "2025-12-08T..."
  }
}
```

**変更後**:
```json
{
  "result": {
    "finished": true,
    "rank1": 1,
    "rank2": 3,
    "rank3": 2,
    "payouts": {
      "win": {
        "1": 320
      },
      "place": {
        "1": 150,
        "3": 200,
        "2": 180
      },
      "trifecta": {
        "1-2-3": 1240
      },
      "trio": {
        "1-2-3": 4560
      }
    },
    "updatedAt": "2025-12-08T..."
  }
}
```

### 4.2 統計サマリーJSON

**ファイル**: `data/predictions/summary.json`

**追加するフィールド**:
```json
{
  "overall": {
    "totalRaces": 476,
    "finishedRaces": 476,

    // 既存フィールド
    "topPickHits": 136,
    "topPickHitRate": 0.2857,

    // 新規フィールド（実回収率）
    "actualRecovery": {
      "win": {
        "totalInvestment": 47600,     // 476レース × 100円
        "totalPayout": 43520,          // 的中レースの配当合計
        "recoveryRate": 0.914          // 91.4%
      },
      "place": {
        "totalInvestment": 47600,
        "totalPayout": 48600,
        "recoveryRate": 1.021          // 102.1%
      }
    }
  },
  "thisMonth": {
    // 同様の構造
  },
  "yesterday": {
    // 同様の構造
  }
}
```

## 5. 計算ロジック

### 5.1 回収率の計算

**ファイル**: `scripts/calculate-accuracy.js`

**新規関数**:
```javascript
// 実際の回収率を計算
function calculateActualRecovery(races, betType) {
  let totalInvestment = 0;
  let totalPayout = 0;

  for (const race of races) {
    // 結果が確定していて配当データがあるレースのみ対象
    if (!race.result?.finished || !race.result?.payouts) {
      continue;
    }

    const prediction = race.prediction;
    const result = race.result;
    const payouts = result.payouts;

    // 投資額（1レースあたり100円）
    totalInvestment += 100;

    if (betType === 'win') {
      // 単勝：本命が1着なら配当を獲得
      if (prediction.topPick === result.rank1) {
        const payout = payouts.win[String(result.rank1)];
        if (payout) {
          totalPayout += payout;
        }
      }
    } else if (betType === 'place') {
      // 複勝：本命が2着以内なら配当を獲得
      const topPick = prediction.topPick;
      if (topPick === result.rank1 ||
          topPick === result.rank2) {
        const payout = payouts.place[String(topPick)];
        if (payout) {
          totalPayout += payout;
        }
      }
    }
  }

  return {
    totalInvestment,
    totalPayout,
    recoveryRate: totalInvestment > 0 ? totalPayout / totalInvestment : 0
  };
}
```

**calculateSummary関数の修正**:
```javascript
function calculateSummary(races) {
  // ... 既存のコード ...

  // 実回収率を追加
  const actualRecovery = {
    win: calculateActualRecovery(races, 'win'),
    place: calculateActualRecovery(races, 'place')
  };

  return {
    totalRaces,
    finishedRaces: finishedRaces.length,
    topPickHits,
    topPickHitRate: topPickHits / finishedRaces.length,
    topPickPlaces,
    topPickPlaceRate: topPickPlaces / finishedRaces.length,
    top3Hits,
    top3HitRate: top3Hits / finishedRaces.length,
    top3IncludedHits,
    top3IncludedRate: top3IncludedHits / finishedRaces.length,
    actualRecovery  // 追加
  };
}
```

## 6. UI表示の更新

### 6.1 AccuracyDashboard.jsx

**変更箇所**: 回収率テーブル

**変更前**:
```jsx
<td style={{...}}>
  {summary.thisMonth.totalRaces > 0
    ? (3.0 * summary.thisMonth.topPickHitRate * 100).toFixed(1) + '%'
    : '-'}
</td>
```

**変更後**:
```jsx
<td style={{...}}>
  {summary.thisMonth.actualRecovery?.win?.recoveryRate
    ? (summary.thisMonth.actualRecovery.win.recoveryRate * 100).toFixed(1) + '%'
    : summary.thisMonth.totalRaces > 0
      ? (3.0 * summary.thisMonth.topPickHitRate * 100).toFixed(1) + '%（推定）'
      : '-'}
</td>
```

**表示例**:
- 配当データがある場合: `91.4%`
- 配当データがない場合: `85.7%（推定）`

## 7. システムへの影響

### 7.1 変更が必要なファイル

1. **scripts/scrape-results.js** (中程度の変更)
   - `scrapePayouts()` 関数の追加
   - `scrapeRaceResult()` の修正
   - 約50-100行のコード追加

2. **scripts/calculate-accuracy.js** (中程度の変更)
   - `calculateActualRecovery()` 関数の追加
   - `calculateSummary()` の修正
   - 約50-80行のコード追加

3. **src/components/AccuracyDashboard.jsx** (軽微な変更)
   - 回収率表示ロジックの条件分岐追加
   - 約10-20行の修正

### 7.2 後方互換性

**問題**: 過去のレース（配当データがない）の扱い

**対応策**:
1. 配当データがある場合: 実回収率を表示
2. 配当データがない場合: 推定回収率を表示（「推定」と明記）
3. 混在する場合: 配当データがあるレースのみで実回収率を計算

### 7.3 エラーハンドリング

**想定されるエラー**:
1. HTMLの構造変更で配当データが取得できない
   - 対策: ログに警告を出力し、配当データなしで続行

2. 配当データのパースエラー（カンマ区切りなど）
   - 対策: 正規表現で数字のみ抽出

3. 予期しない艇番や配当形式
   - 対策: バリデーションを追加し、不正なデータはスキップ

## 8. 実装の難易度評価

### 8.1 技術的難易度

| 項目 | 難易度 | 理由 |
|------|--------|------|
| HTMLパース | 中 | セレクタの特定が必要 |
| データ構造変更 | 低 | 単純な追加のみ |
| 計算ロジック | 低 | シンプルな集計処理 |
| UI更新 | 低 | 条件分岐の追加のみ |
| **総合** | **中** | HTMLパースが少し複雑 |

### 8.2 リスク評価

| リスク | 深刻度 | 発生確率 | 対策 |
|--------|--------|----------|------|
| HTML構造変更 | 高 | 中 | セレクタを柔軟に設計 |
| 配当データ欠損 | 中 | 低 | 推定値へのフォールバック |
| パフォーマンス低下 | 低 | 低 | データ量は少ない |
| 後方互換性問題 | 中 | 中 | 段階的な移行 |

### 8.3 工数見積もり

| フェーズ | 工数 | 備考 |
|---------|------|------|
| HTML構造調査 | 30分 | 実際のページを確認 |
| スクレイピング実装 | 1-2時間 | セレクタの特定と実装 |
| 計算ロジック実装 | 30分-1時間 | シンプルな処理 |
| UI更新 | 30分 | 表示ロジックの修正 |
| テスト・調整 | 1-2時間 | データ確認と調整 |
| **合計** | **3-6時間** | 初回実装の場合 |

## 9. メリット・デメリット

### 9.1 メリット

1. **正確性の向上**
   - 推定ではなく実際のデータに基づく
   - ユーザーの信頼性向上

2. **透明性**
   - 「この予想方法で実際にいくら儲かるか」が明確

3. **改善の指標**
   - AIの予想精度を金額ベースで評価可能

### 9.2 デメリット

1. **メンテナンスコスト**
   - HTML構造変更時の対応が必要
   - スクレイピングの安定性維持

2. **データ不完全性**
   - 配当データが取得できないレースがある可能性
   - 過去データは推定値のまま

3. **システム複雑性の増加**
   - 配当データの管理が追加される
   - デバッグが若干複雑化

## 10. 実装の推奨事項

### 10.1 段階的な実装

**フェーズ1**: 最小限の実装
- 単勝・複勝のみ対応
- 新規レースのみ配当データ取得
- 推定値との併用表示

**フェーズ2**: 機能拡張（オプション）
- 3連複・3連単の対応
- 過去レースの配当データ取得
- グラフ化（回収率の推移）

### 10.2 実装するべきか？

**推奨: 実装する価値あり**

理由:
1. 技術的難易度は「中」で実現可能
2. ユーザー価値が高い（実際の収支が分かる）
3. 工数も3-6時間程度で許容範囲
4. リスクは管理可能（フォールバック機能あり）

ただし、以下の条件付き:
- HTMLパース部分はエラーハンドリングを厳密に
- 段階的に実装（まず単勝・複勝のみ）
- 推定値との併用表示で後方互換性を保つ

## 11. 次のステップ

実装を進める場合の手順:
1. 実際のHTMLを確認（手動でページアクセス）
2. セレクタの特定とテスト
3. scrape-results.jsの修正
4. calculate-accuracy.jsの修正
5. AccuracyDashboard.jsxの修正
6. テストと調整

---

## 結論

**実現可能性**: ✅ 十分に実現可能
**システム複雑性**: 🟡 中程度（管理可能な範囲）
**推奨度**: ⭐⭐⭐⭐☆ （5段階中4）
**実装すべきか**: はい（ただし段階的に）
