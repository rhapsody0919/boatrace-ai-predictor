# 分析ドキュメント テンプレート集

`.claude/rules/analysis.md` から参照される各種テンプレート。

---

## スクリプトテンプレート（ES Modules + Supabase）

```javascript
// scripts/analysis/analyze-venue-XX.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // 分析ロジック
}

main().catch(console.error);
```

---

## 会場分析3点セット

### README.md テンプレート

```markdown
# {会場名}（会場コード: {コード}）分析

> **実装時は [RULE_SPECIFICATION.md](./RULE_SPECIFICATION.md) を参照**

## 会場特性
- **水面**: 淡水/海水/汽水
- **1号艇勝率**: XX%
- **特徴**: （特筆すべき傾向）

## 分析概要
- **対象期間**: YYYY-MM-DD 〜 YYYY-MM-DD
- **サンプル数**: XXXレース

## 発見したルール
（単勝/複勝/3連複/3連単ごとに表形式）

## 推奨賭け方
（優先度順）
```

### rules.json テンプレート

```json
{
  "venue_code": 10,
  "venue_name": "三国",
  "analysis_date": "YYYY-MM-DD",
  "status": "active",
  "win_rules": [],
  "place_rules": [],
  "trio_rules": [],
  "exacta_rules": []
}
```

### RULE_SPECIFICATION.md テンプレート

```markdown
# {会場名}（会場コード: {コード}）ルール実装仕様書

## 概要
- 分析対象、期間、サンプル数

## ルール一覧サマリー
（表形式: ID, betType, 条件, サンプル数, 的中率, 回収率）

## 実装例
（ruleMatchService.js への追加コード）

## ルールID命名規則
{会場prefix}-{betType略}-{連番}
```

---

## ルール実装テンプレート（ruleMatchService.js 用）

```javascript
const VENUE_RULES = [
  {
    id: 'XX-W001',
    patternName: 'VENUE-WIN-CONDITION',
    description: '条件の説明',
    betType: 'win',  // win | place | trio | exacta
    stats: { samples: 25, hits: 6, recovery: 218 },
    reliability: 'highest',  // highest | high | medium
    check: (pred, raceNo, conf, predSorted, has1) =>
      has1 && conf >= 70
  },
]
```

---

## 分析結果JSON保存形式

```json
{
  "venue_code": 3,
  "venue_name": "江戸川",
  "analysis_date": "YYYY-MM-DD",
  "rules": [
    {
      "name": "ルール名",
      "bet_type": "win",
      "conditions": {},
      "stats": {
        "sample_size": 150,
        "hit_rate": 0.72,
        "recovery_rate": 1.08
      }
    }
  ]
}
```
