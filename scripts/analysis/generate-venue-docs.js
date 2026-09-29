// 各会場のREADME.mdとRULE_SPECIFICATION.mdを自動生成するスクリプト
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 会場情報
const VENUE_INFO = {
  '01': { name: '桐生', water: '淡水', feature: '全国屈指の静水面、インコース有利' },
  '02': { name: '戸田', water: '淡水', feature: '狭いコース幅で内枠有利、まくりが効きにくい' },
  '04': { name: '平和島', water: '海水', feature: '潮の影響あり、外枠の活躍が多い' },
  '05': { name: '多摩川', water: '淡水', feature: '静水面だが風の影響を受けやすい' },
  '08': { name: '常滑', water: '海水', feature: '広いコース、差しが決まりやすい' },
  '09': { name: '津', water: '海水（汽水）', feature: '潮位変動あり、荒れやすい' },
  '13': { name: '尼崎', water: '淡水', feature: '静水面、インコース有利' },
  '14': { name: '鳴門', water: '海水', feature: '潮の影響大、うねりが発生しやすい' },
  '16': { name: '児島', water: '海水', feature: '潮の影響あり、スロー有利' },
  '17': { name: '宮島', water: '海水', feature: '潮位差が大きい、インコース有利' },
  '18': { name: '徳山', water: '海水', feature: '静かな水面、インコース安定' },
  '19': { name: '下関', water: '海水', feature: '潮流の影響あり、荒れやすい' },
  '20': { name: '若松', water: '海水', feature: '広いコース、スピード勝負' },
  '21': { name: '芦屋', water: '淡水', feature: 'ナイターレース、インコース有利' },
  '23': { name: '唐津', water: '海水', feature: '風の影響を受けやすい' },
  '24': { name: '大村', water: '海水', feature: 'ナイターレース、インコース非常に有利' }
};

// 信頼性の日本語表記
const RELIABILITY_JP = {
  'very_high': '最高',
  'high': '高',
  'medium': '中',
  'low': '低'
};

// README.mdを生成
function generateReadme(venueCode, data) {
  const info = VENUE_INFO[venueCode] || { name: data.venue_name, water: '不明', feature: '特徴データなし' };

  // 回収率が高い順にルールをソート
  const sortedWinRules = [...(data.win_rules || [])].sort((a, b) =>
    parseFloat(b.stats.recovery_rate) - parseFloat(a.stats.recovery_rate)
  ).slice(0, 10);

  const sortedPlaceRules = [...(data.place_rules || [])].sort((a, b) =>
    parseFloat(b.stats.recovery_rate) - parseFloat(a.stats.recovery_rate)
  ).slice(0, 10);

  const sortedTrioRules = [...(data.trio_rules || [])].sort((a, b) =>
    parseFloat(b.stats.recovery_rate) - parseFloat(a.stats.recovery_rate)
  ).slice(0, 10);

  // 全体統計を計算
  const totalWinSamples = (data.win_rules || []).reduce((sum, r) => sum + r.stats.sample_size, 0);
  const totalPlaceSamples = (data.place_rules || []).reduce((sum, r) => sum + r.stats.sample_size, 0);
  const totalTrioSamples = (data.trio_rules || []).reduce((sum, r) => sum + r.stats.sample_size, 0);

  let content = `# ${info.name}（会場コード: ${venueCode}）分析

> **実装時は [RULE_SPECIFICATION.md](./RULE_SPECIFICATION.md) を参照**
>
> このREADMEは分析結果のサマリー。実装に必要な条件定義・コード例は仕様書に記載。

## 会場特性

- **水面**: ${info.water}
- **特徴**: ${info.feature}

## 分析概要

- **対象期間**: ${data.period?.start || 'N/A'} 〜 ${data.period?.end || 'N/A'}
- **サンプル数**: ${data.sample_size || 'N/A'}レース

## 発見したルール

`;

  // 単勝ルール
  if (sortedWinRules.length > 0) {
    content += `### 単勝ルール（${data.win_rules.length}件）

| ID | 条件 | 回収率 | サンプル | 信頼性 |
|----|------|--------|---------|--------|
`;
    for (const rule of sortedWinRules) {
      content += `| ${rule.id} | ${rule.name} | ${rule.stats.recovery_rate} | ${rule.stats.sample_size} | ${RELIABILITY_JP[rule.reliability] || rule.reliability} |\n`;
    }
    content += '\n';
  }

  // 複勝ルール
  if (sortedPlaceRules.length > 0) {
    content += `### 複勝ルール（${data.place_rules.length}件）

| ID | 条件 | 回収率 | サンプル | 信頼性 |
|----|------|--------|---------|--------|
`;
    for (const rule of sortedPlaceRules) {
      content += `| ${rule.id} | ${rule.name} | ${rule.stats.recovery_rate} | ${rule.stats.sample_size} | ${RELIABILITY_JP[rule.reliability] || rule.reliability} |\n`;
    }
    content += '\n';
  }

  // 3連複ルール
  if (sortedTrioRules.length > 0) {
    content += `### 3連複ルール（${data.trio_rules.length}件）

| ID | 条件 | 回収率 | サンプル | 信頼性 |
|----|------|--------|---------|--------|
`;
    for (const rule of sortedTrioRules) {
      content += `| ${rule.id} | ${rule.name} | ${rule.stats.recovery_rate} | ${rule.stats.sample_size} | ${RELIABILITY_JP[rule.reliability] || rule.reliability} |\n`;
    }
    content += '\n';
  }

  // 重要な発見（回収率トップのルールから抽出）
  const topRules = [
    ...sortedWinRules.slice(0, 2),
    ...sortedPlaceRules.slice(0, 2),
    ...sortedTrioRules.slice(0, 3)
  ].filter(r => parseFloat(r.stats.recovery_rate) >= 150);

  if (topRules.length > 0) {
    content += `## 注目ポイント

`;
    let i = 1;
    for (const rule of topRules) {
      content += `${i}. **${rule.name}**: 回収率${rule.stats.recovery_rate}（${rule.stats.sample_size}レース）\n`;
      i++;
    }
    content += '\n';
  }

  // 推奨賭け方
  const bestWin = sortedWinRules[0];
  const bestPlace = sortedPlaceRules[0];
  const bestTrio = sortedTrioRules[0];

  content += `## 推奨賭け方

| 優先度 | 賭け方 | 最高回収率 | コメント |
|--------|--------|----------|----------|
`;

  if (bestTrio && parseFloat(bestTrio.stats.recovery_rate) >= 100) {
    content += `| 1 | 3連複 | ${bestTrio.stats.recovery_rate} | ${bestTrio.name} |\n`;
  }
  if (bestWin && parseFloat(bestWin.stats.recovery_rate) >= 100) {
    content += `| 2 | 単勝 | ${bestWin.stats.recovery_rate} | ${bestWin.name} |\n`;
  }
  if (bestPlace && parseFloat(bestPlace.stats.recovery_rate) >= 100) {
    content += `| 3 | 複勝 | ${bestPlace.stats.recovery_rate} | ${bestPlace.name} |\n`;
  }

  return content;
}

// RULE_SPECIFICATION.mdを生成
function generateSpec(venueCode, data) {
  const info = VENUE_INFO[venueCode] || { name: data.venue_name };

  let content = `# ${info.name}（会場コード: ${venueCode}）ルール実装仕様書

## 概要

このドキュメントは、分析で発見したルールを**実装するための仕様**を定義する。

**分析対象**: スタンダードモデル (standard)
**分析期間**: ${data.period?.start || 'N/A'} 〜 ${data.period?.end || 'N/A'}
**サンプル数**: ${data.sample_size || 'N/A'}レース

---

## データソース

### 使用テーブル

| テーブル | 用途 |
|---------|------|
| \`predictions\` | AI予測結果 |
| \`race_results\` | レース結果・払戻金 |
| \`race_entries\` | 出走選手情報 |

### 主要カラム

#### predictions
\`\`\`
race_id: string      # "YYYY-MM-DD-VV-RR" 形式（VV=会場コード, RR=レース番号）
model_id: string     # "standard" | "safeBet" | "upsetFocus"
top_pick: number     # 1着予測の艇番 (1-6)
top_2nd: number      # 2着予測の艇番 (1-6)
top_3rd: number      # 3着予測の艇番 (1-6)
confidence: number   # 信頼度 (0-100)
\`\`\`

#### race_results
\`\`\`
race_id: string
rank1: number        # 1着の艇番
rank2: number        # 2着の艇番
rank3: number        # 3着の艇番
payout_win: number   # 単勝払戻金
payout_place_1: number  # 複勝払戻金（1着艇）
payout_place_2: number  # 複勝払戻金（2着艇）
payout_trifecta: number  # 3連複払戻金（列名と中身が逆: payout_trifecta=3連複、payout_trio=3連単）
\`\`\`

---

## ルール一覧サマリー

`;

  // サマリーテーブル
  const allRules = [
    ...(data.win_rules || []),
    ...(data.place_rules || []),
    ...(data.trio_rules || [])
  ].filter(r => parseFloat(r.stats.recovery_rate) >= 100)
   .sort((a, b) => parseFloat(b.stats.recovery_rate) - parseFloat(a.stats.recovery_rate));

  content += `| ID | 賭け方 | 条件 | サンプル | 回収率 | 信頼性 |
|----|--------|------|---------|--------|--------|
`;

  for (const rule of allRules) {
    content += `| ${rule.id} | ${rule.bet_type} | ${rule.name} | ${rule.stats.sample_size} | **${rule.stats.recovery_rate}** | ${RELIABILITY_JP[rule.reliability] || rule.reliability} |\n`;
  }

  content += `
---

## ルール詳細

`;

  // 各ルールの詳細
  for (const rule of allRules.slice(0, 15)) { // 上位15件のみ詳細記載
    content += `### ${rule.id}: ${rule.name}

**回収率: ${rule.stats.recovery_rate} | サンプル: ${rule.stats.sample_size}戦 | 信頼性: ${RELIABILITY_JP[rule.reliability] || rule.reliability}**

\`\`\`javascript
// 条件
const conditions = ${JSON.stringify(rule.conditions, null, 2)};

// 賭け方
const betType = "${rule.bet_type}";
\`\`\`

---

`;
  }

  // 実装例
  content += `## 実装例

### ルール適用関数

\`\`\`javascript
function shouldBet_${venueCode}(prediction, ruleId) {
  const raceNo = parseInt(prediction.race_id.split('-')[4]);
  const conf = prediction.confidence || 0;
  const predSorted = [prediction.top_pick, prediction.top_2nd, prediction.top_3rd]
    .sort((a, b) => a - b).join('-');
  const has1 = [prediction.top_pick, prediction.top_2nd, prediction.top_3rd].includes(1);

  // ルール別の条件チェック
  // ※各ルールの条件に応じて実装
  return false;
}
\`\`\`

---

## ルールID命名規則

\`\`\`
${allRules[0]?.id?.split('-')[0] || 'XX'}-T001
│   └── 連番
└────── 賭け方: W=単勝, P=複勝, T=3連複
\`\`\`
`;

  return content;
}

// メイン処理
function main() {
  console.log('=== 会場ドキュメント生成 ===\n');

  const analysisDir = path.join(__dirname, '..', '..', 'data', 'analysis');
  const targetVenues = Object.keys(VENUE_INFO);

  let generated = 0;
  let skipped = 0;

  for (const venueCode of targetVenues) {
    const venueDir = path.join(analysisDir, `venue-${venueCode}`);
    const rulesPath = path.join(venueDir, 'rules.json');

    if (!fs.existsSync(rulesPath)) {
      console.log(`⚠️  ${venueCode}: rules.json not found`);
      skipped++;
      continue;
    }

    const data = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));

    // 江戸川形式かチェック
    if (!data.win_rules?.[0]?.id) {
      console.log(`⚠️  ${venueCode}: 江戸川形式でないためスキップ`);
      skipped++;
      continue;
    }

    // README.md生成
    const readmePath = path.join(venueDir, 'README.md');
    const readmeContent = generateReadme(venueCode, data);
    fs.writeFileSync(readmePath, readmeContent);

    // RULE_SPECIFICATION.md生成
    const specPath = path.join(venueDir, 'RULE_SPECIFICATION.md');
    const specContent = generateSpec(venueCode, data);
    fs.writeFileSync(specPath, specContent);

    console.log(`✅ ${venueCode} (${data.venue_name}): README.md & RULE_SPECIFICATION.md 生成完了`);
    generated++;
  }

  console.log(`\n=== 完了 ===`);
  console.log(`生成: ${generated}件`);
  console.log(`スキップ: ${skipped}件`);
}

main();
