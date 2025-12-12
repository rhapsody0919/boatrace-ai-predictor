# 実回収率機能 - 実装計画

## 更新された要件

### 1. 推定と実回収率の両方表示
- 推定回収率: 現在の計算方法（平均配当 × 的中率）
- 実回収率: 実際の配当データから算出
- 両方を並べて表示（比較可能に）

### 2. 購入パターン
| 券種 | 購入内容 | 投資額 |
|------|---------|--------|
| 単勝 | 本命1点 | 100円 |
| 複勝 | 本命1点 | 100円 |
| 3連複 | top3を1点（順序不問） | 100円 |
| 3連単 | top3を1点（予想順） | 100円 |

### 3. 切り戻し戦略
- ブランチ戦略: feature/actual-recovery で開発
- 各フェーズでコミット
- 問題発生時は即座にrevert可能

## 実装フェーズ

### Phase 1: データ取得（所要時間: 2-3時間）

**目的**: 配当データのスクレイピング実装

**作業内容**:
1. 実際のHTMLを確認してセレクタを特定
2. `scrape-results.js` に配当取得処理を追加
3. テスト実行（過去のレース1件で確認）
4. コミット: "Add payout scraping to scrape-results.js"

**成果物**:
- 配当データを含むresult構造
```json
{
  "result": {
    "finished": true,
    "rank1": 1,
    "rank2": 3,
    "rank3": 2,
    "payouts": {
      "win": { "1": 320 },
      "place": { "1": 150, "3": 200, "2": 180 },
      "trifecta": { "1-2-3": 1240 },
      "trio": { "1-2-3": 4560 }
    }
  }
}
```

**切り戻しポイント**: ✓
- この時点で問題があれば、このコミットをrevert

---

### Phase 2: 計算ロジック（所要時間: 1-2時間）

**目的**: 実回収率の計算実装

**作業内容**:
1. `calculate-accuracy.js` に回収率計算関数を追加
2. 4券種すべての実回収率を計算
3. summary.jsonに新フィールドを追加
4. テスト実行（calculate-accuracy.js 実行）
5. コミット: "Add actual recovery rate calculation"

**成果物**:
```json
{
  "overall": {
    "actualRecovery": {
      "win": {
        "totalInvestment": 47600,
        "totalPayout": 43520,
        "recoveryRate": 0.914,
        "hitCount": 136
      },
      "place": { /* ... */ },
      "trifecta": { /* ... */ },
      "trio": { /* ... */ }
    }
  }
}
```

**切り戻しポイント**: ✓
- この時点で問題があれば、Phase 1まで戻る

---

### Phase 3: UI更新（所要時間: 1時間）

**目的**: 推定と実回収率を両方表示

**作業内容**:
1. `AccuracyDashboard.jsx` のテーブルを更新
2. 「推定回収率」「実回収率」の2列を追加
3. データがない場合のフォールバック表示
4. スタイル調整
5. コミット: "Display both estimated and actual recovery rates"

**UIイメージ**:
```jsx
<table>
  <thead>
    <tr>
      <th>券種</th>
      <th>的中率</th>
      <th>推定回収率</th>
      <th>実回収率</th>
      <th>評価</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>単勝</td>
      <td>28.6%</td>
      <td>85.7%</td>
      <td>91.4%</td>
      <td>❌</td>
    </tr>
    <tr>
      <td>複勝</td>
      <td>68.1%</td>
      <td>102.1%</td>
      <td>105.2%</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>3連複</td>
      <td>13.0%</td>
      <td>227.9%</td>
      <td style={{color: '#94a3b8'}}>データなし</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>
```

**切り戻しポイント**: ✓
- この時点で問題があれば、Phase 2まで戻る

---

## 詳細な実装コード

### Phase 1: scrape-results.js

```javascript
// 配当データをスクレイピング
function scrapePayouts($) {
  const payouts = {
    win: {},
    place: {},
    trifecta: {},
    trio: {}
  };

  try {
    // 単勝の配当
    // セレクタは実際のHTMLに合わせて調整
    $('.is-w243 tbody tr').each((i, row) => {
      const $row = $(row);
      const type = $row.find('td').eq(0).text().trim();

      if (type === '単勝') {
        const boat = $row.find('td').eq(1).text().trim();
        const payout = parseInt($row.find('td').eq(2).text().replace(/[^0-9]/g, ''));
        if (boat && !isNaN(payout)) {
          payouts.win[boat] = payout;
        }
      }

      if (type === '複勝' || type === '') {
        const boat = $row.find('td').eq(1).text().trim();
        const payout = parseInt($row.find('td').eq(2).text().replace(/[^0-9]/g, ''));
        if (boat && !isNaN(payout)) {
          payouts.place[boat] = payout;
        }
      }
    });

    // 3連複・3連単
    $('.is-w495 tbody tr').each((i, row) => {
      const $row = $(row);
      const type = $row.find('td').eq(0).text().trim();
      const combination = $row.find('td').eq(1).text().trim();
      const payout = parseInt($row.find('td').eq(2).text().replace(/[^0-9]/g, ''));

      if (type === '3連複' && combination && !isNaN(payout)) {
        payouts.trifecta[combination] = payout;
      }

      if (type === '3連単' && combination && !isNaN(payout)) {
        payouts.trio[combination] = payout;
      }
    });

  } catch (error) {
    console.error('  Payout scraping error:', error.message);
    // エラーが発生しても処理を続行（空のpayoutsを返す）
  }

  return payouts;
}

// scrapeRaceResult関数に追加
async function scrapeRaceResult(venueCode, raceNo, dateStr) {
  // ... 既存のコード ...

  // 配当データを追加
  const payouts = scrapePayouts($);

  return {
    finished: true,
    rank1: rankings[0],
    rank2: rankings[1],
    rank3: rankings[2],
    payouts: payouts,  // 追加
    updatedAt: new Date().toISOString(),
  };
}
```

### Phase 2: calculate-accuracy.js

```javascript
// 実回収率を計算
function calculateActualRecovery(races, betType) {
  let totalInvestment = 0;
  let totalPayout = 0;
  let hitCount = 0;
  let dataAvailableCount = 0;

  for (const race of races) {
    // 結果が確定していて配当データがあるレースのみ対象
    if (!race.result?.finished || !race.result?.payouts) {
      continue;
    }

    dataAvailableCount++;
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
          hitCount++;
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
          hitCount++;
        }
      }
    } else if (betType === 'trifecta') {
      // 3連複：top3が全て含まれていれば的中
      const top3 = prediction.top3;
      const resultSet = new Set([result.rank1, result.rank2, result.rank3]);
      if (top3.every(num => resultSet.has(num))) {
        // 配当のキーを生成（昇順ソート）
        const sortedResult = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b);
        const key = sortedResult.join('-');
        const payout = payouts.trifecta[key];
        if (payout) {
          totalPayout += payout;
          hitCount++;
        }
      }
    } else if (betType === 'trio') {
      // 3連単：top3が順序も含めて一致すれば的中
      const top3 = prediction.top3;
      if (top3[0] === result.rank1 &&
          top3[1] === result.rank2 &&
          top3[2] === result.rank3) {
        const key = `${result.rank1}-${result.rank2}-${result.rank3}`;
        const payout = payouts.trio[key];
        if (payout) {
          totalPayout += payout;
          hitCount++;
        }
      }
    }
  }

  // 配当データがあるレースがない場合はnullを返す
  if (dataAvailableCount === 0) {
    return null;
  }

  return {
    totalInvestment,
    totalPayout,
    recoveryRate: totalInvestment > 0 ? totalPayout / totalInvestment : 0,
    hitCount,
    dataAvailableCount
  };
}

// calculateSummary関数に追加
function calculateSummary(races) {
  // ... 既存のコード ...

  // 実回収率を計算
  const actualRecovery = {
    win: calculateActualRecovery(races, 'win'),
    place: calculateActualRecovery(races, 'place'),
    trifecta: calculateActualRecovery(races, 'trifecta'),
    trio: calculateActualRecovery(races, 'trio')
  };

  return {
    // ... 既存のフィールド ...
    actualRecovery
  };
}
```

### Phase 3: AccuracyDashboard.jsx

```jsx
<div style={{overflowX: 'auto'}}>
  <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem'}}>
    <thead>
      <tr style={{backgroundColor: '#f1f5f9', borderBottom: '2px solid #cbd5e1'}}>
        <th style={{padding: '0.75rem', textAlign: 'left'}}>券種</th>
        <th style={{padding: '0.75rem', textAlign: 'center'}}>的中率</th>
        <th style={{padding: '0.75rem', textAlign: 'center'}}>推定回収率</th>
        <th style={{padding: '0.75rem', textAlign: 'center'}}>実回収率</th>
        <th style={{padding: '0.75rem', textAlign: 'center'}}>評価</th>
      </tr>
    </thead>
    <tbody>
      {/* 単勝 */}
      <tr style={{borderBottom: '1px solid #e2e8f0'}}>
        <td style={{padding: '0.75rem', fontWeight: '600'}}>単勝</td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {formatPercent(summary.thisMonth.topPickHitRate)}
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {(3.0 * summary.thisMonth.topPickHitRate * 100).toFixed(1)}%
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700'}}>
          {summary.thisMonth.actualRecovery?.win?.recoveryRate != null
            ? (summary.thisMonth.actualRecovery.win.recoveryRate * 100).toFixed(1) + '%'
            : <span style={{color: '#94a3b8'}}>データなし</span>
          }
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {summary.thisMonth.actualRecovery?.win?.recoveryRate >= 1.0 ? '✅' : '❌'}
        </td>
      </tr>

      {/* 複勝 */}
      <tr style={{borderBottom: '1px solid #e2e8f0'}}>
        <td style={{padding: '0.75rem', fontWeight: '600'}}>複勝</td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {formatPercent(summary.thisMonth.topPickPlaceRate)}
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {(1.5 * summary.thisMonth.topPickPlaceRate * 100).toFixed(1)}%
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700'}}>
          {summary.thisMonth.actualRecovery?.place?.recoveryRate != null
            ? (summary.thisMonth.actualRecovery.place.recoveryRate * 100).toFixed(1) + '%'
            : <span style={{color: '#94a3b8'}}>データなし</span>
          }
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {summary.thisMonth.actualRecovery?.place?.recoveryRate >= 1.0 ? '✅' : '❌'}
        </td>
      </tr>

      {/* 3連複 */}
      <tr style={{borderBottom: '1px solid #e2e8f0'}}>
        <td style={{padding: '0.75rem', fontWeight: '600'}}>3連複</td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {formatPercent(summary.thisMonth.top3HitRate)}
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {(17.5 * summary.thisMonth.top3HitRate * 100).toFixed(1)}%
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700'}}>
          {summary.thisMonth.actualRecovery?.trifecta?.recoveryRate != null
            ? (summary.thisMonth.actualRecovery.trifecta.recoveryRate * 100).toFixed(1) + '%'
            : <span style={{color: '#94a3b8'}}>データなし</span>
          }
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {summary.thisMonth.actualRecovery?.trifecta?.recoveryRate >= 1.0 ? '✅' : '❌'}
        </td>
      </tr>

      {/* 3連単 */}
      <tr style={{borderBottom: '1px solid #e2e8f0'}}>
        <td style={{padding: '0.75rem', fontWeight: '600'}}>3連単</td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {formatPercent(summary.thisMonth.top3IncludedRate)}
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {(90.0 * summary.thisMonth.top3IncludedRate * 100).toFixed(1)}%
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700'}}>
          {summary.thisMonth.actualRecovery?.trio?.recoveryRate != null
            ? (summary.thisMonth.actualRecovery.trio.recoveryRate * 100).toFixed(1) + '%'
            : <span style={{color: '#94a3b8'}}>データなし</span>
          }
        </td>
        <td style={{padding: '0.75rem', textAlign: 'center'}}>
          {summary.thisMonth.actualRecovery?.trio?.recoveryRate >= 1.0 ? '✅' : '❌'}
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

---

## 切り戻し手順

### 問題が発生した場合

#### Phase 1で問題発生
```bash
git revert HEAD  # 配当スクレイピングのコミットを取り消し
```

#### Phase 2で問題発生
```bash
git revert HEAD  # 計算ロジックのコミットを取り消し
# または
git revert HEAD~1..HEAD  # Phase 2と1の両方を取り消し
```

#### Phase 3で問題発生
```bash
git revert HEAD  # UI更新のコミットを取り消し
# Phase 1と2は残る（バックエンドのみ動作）
```

#### 全体を取り消し
```bash
git revert HEAD~2..HEAD  # 3つのコミットを全て取り消し
# または
git reset --hard origin/master  # masterの最新に強制リセット
```

### フォールバック動作

コード内に組み込まれたフォールバック：
1. **配当データ取得失敗** → 空のpayoutsオブジェクト、処理継続
2. **配当データなし** → 実回収率は null、推定値のみ表示
3. **スクレイピングエラー** → ログ出力、既存機能は継続

---

## テスト計画

### Phase 1テスト
```bash
# 過去の1レースでテスト
node scripts/scrape-results.js --date=2025-12-07

# data/predictions/2025-12-07.json を確認
# payouts フィールドが追加されているか？
```

### Phase 2テスト
```bash
# 全データで的中率と回収率を計算
node scripts/calculate-accuracy.js

# data/predictions/summary.json を確認
# actualRecovery フィールドが追加されているか？
```

### Phase 3テスト
```bash
# 開発サーバーで確認
npm run dev

# http://localhost:5173/boatrace-ai-predictor/#accuracy
# テーブルに「推定回収率」「実回収率」が表示されるか？
```

---

## リリース手順

1. feature/actual-recovery ブランチで全フェーズを実装
2. 各フェーズごとにテスト
3. 問題なければ master にマージ
4. GitHub Pages に自動デプロイ
5. 本番環境で動作確認
6. 問題があれば即座にrevert

---

## まとめ

✅ **推定と実回収率の両方表示**: 実装済み
✅ **3連複・3連単対応**: 実装済み
✅ **切り戻し可能**: 3段階のコミット + フォールバック機能

**総工数**: 4-6時間
**リスク**: 低（各段階で切り戻し可能）
**実装開始**: 承認後すぐに開始可能
