// 各会場のrules.jsonから上位ルールを抽出してJavaScriptコードを生成
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 会場名（英語）
const VENUE_NAMES_EN = {
  '01': 'KIRYU',
  '02': 'TODA',
  '04': 'HEIWAJIMA',
  '05': 'TAMAGAWA',
  '08': 'TOKONAME',
  '09': 'TSU',
  '13': 'AMAGASAKI',
  '14': 'NARUTO',
  '16': 'KOJIMA',
  '17': 'MIYAJIMA',
  '18': 'TOKUYAMA',
  '20': 'WAKAMATSU',
  '21': 'ASHIYA',
  '23': 'KARATSU',
  '24': 'OMURA'
};

// 会場名（日本語）
const VENUE_NAMES_JP = {
  '01': '桐生',
  '02': '戸田',
  '04': '平和島',
  '05': '多摩川',
  '08': '常滑',
  '09': '津',
  '13': '尼崎',
  '14': '鳴門',
  '16': '児島',
  '17': '宮島',
  '18': '徳山',
  '20': '若松',
  '21': '芦屋',
  '23': '唐津',
  '24': '大村'
};

// 艇番の条件（1号艇は has1 を使う）
function boatCheck(boat) {
  return boat === 1 ? 'has1' : `pred.top3.includes(${boat})`;
}

// 最小・最大の範囲条件（min → max の順）
function rangeChecks(range, variable) {
  const checks = [];
  if (range.min) {
    checks.push(`${variable} >= ${range.min}`);
  }
  if (range.max) {
    checks.push(`${variable} <= ${range.max}`);
  }
  return checks;
}

// 艇に関する条件（includes_boat → includes_boat_1 → includes_boats の順）
function boatChecks(conditions) {
  const checks = [];

  // includes_boat条件（単一）
  if (conditions.includes_boat) {
    checks.push(boatCheck(conditions.includes_boat));
  }

  // includes_boat_1条件
  if (conditions.includes_boat_1) {
    checks.push('has1');
  }

  // includes_boats条件（複数）
  if (conditions.includes_boats) {
    for (const boat of conditions.includes_boats) {
      checks.push(boatCheck(boat));
    }
  }

  return checks;
}

// ルール名からcheck関数を生成
function generateCheckFunction(rule) {
  const conditions = rule.conditions || {};
  const checks = [];

  // top_pick条件
  if (conditions.top_pick) {
    checks.push(`pred.topPick === ${conditions.top_pick}`);
  }

  checks.push(...boatChecks(conditions));

  // prediction_sorted条件（3連複の組み合わせ）
  if (conditions.prediction_sorted) {
    checks.push(`predSorted === '${conditions.prediction_sorted}'`);
  }

  // confidence条件
  if (conditions.confidence) {
    checks.push(...rangeChecks(conditions.confidence, 'conf'));
  }

  // race_number条件
  if (conditions.race_number) {
    checks.push(...rangeChecks(conditions.race_number, 'raceNo'));
  }

  // excludes_boat_1条件
  if (conditions.excludes_boat_1) {
    checks.push('!has1');
  }

  if (checks.length === 0) {
    return 'true // TODO: 条件を確認';
  }

  return checks.join(' && ');
}

// 信頼性をreliabilityに変換
function mapReliability(reliability) {
  const map = {
    'very_high': 'highest',
    'high': 'high',
    'medium': 'medium',
    'low': 'low'
  };
  return map[reliability] || reliability;
}

// ルールをフィルタリング
function filterTopRules(rules, betType, maxCount = 3) {
  if (!rules || rules.length === 0) return [];

  return rules
    .filter(r => {
      const recovery = parseFloat(r.stats.recovery_rate);
      const samples = r.stats.sample_size;
      const reliability = r.reliability;

      // 条件: 回収率150%以上、またはサンプル30以上で回収率120%以上
      const isHighRecovery = recovery >= 150;
      const isReliable = samples >= 30 && recovery >= 120;
      const isVeryReliable = samples >= 50 && recovery >= 100;

      // 信頼性がhigh以上
      const hasGoodReliability = ['very_high', 'high'].includes(reliability);

      return (isHighRecovery || isReliable || isVeryReliable) && hasGoodReliability;
    })
    .sort((a, b) => {
      // 回収率 × log(サンプル数) でソート
      const scoreA = parseFloat(a.stats.recovery_rate) * Math.log(a.stats.sample_size + 1);
      const scoreB = parseFloat(b.stats.recovery_rate) * Math.log(b.stats.sample_size + 1);
      return scoreB - scoreA;
    })
    .slice(0, maxCount);
}

// 会場のルールコードを生成
function generateVenueCode(venueCode, data) {
  const nameEn = VENUE_NAMES_EN[venueCode];
  const nameJp = VENUE_NAMES_JP[venueCode];

  if (!nameEn) return null;

  const winRules = filterTopRules(data.win_rules, 'win', 2);
  const placeRules = filterTopRules(data.place_rules, 'place', 2);
  const trioRules = filterTopRules(data.trio_rules, 'trio', 3);

  const allRules = [...winRules, ...placeRules, ...trioRules];

  if (allRules.length === 0) return null;

  let code = `// ${nameJp}（${venueCode}）のルール定義\n`;
  code += `const ${nameEn}_RULES = [\n`;

  for (const rule of allRules) {
    const betTypeUpper = rule.bet_type.toUpperCase();
    const patternName = `${nameEn}-${betTypeUpper}-${rule.id.split('-')[1]}`;
    const checkFn = generateCheckFunction(rule);
    const recovery = parseFloat(rule.stats.recovery_rate);
    const samples = rule.stats.sample_size;
    const hits = Math.round(samples * parseFloat(rule.stats.hit_rate) / 100);

    code += `  {\n`;
    code += `    id: '${rule.id}',\n`;
    code += `    patternName: '${patternName}',\n`;
    code += `    description: '${rule.name}',\n`;
    code += `    betType: '${rule.bet_type}',\n`;
    code += `    stats: { samples: ${samples}, hits: ${hits}, recovery: ${recovery} },\n`;
    code += `    reliability: '${mapReliability(rule.reliability)}',\n`;
    code += `    check: (pred, raceNo, conf, predSorted, has1) =>\n`;
    code += `      ${checkFn}\n`;
    code += `  },\n`;
  }

  code += `]\n`;

  return { code, constName: `${nameEn}_RULES`, venueCode };
}

// メイン処理
function main() {
  console.log('=== 上位ルールコード生成 ===\n');

  const analysisDir = path.join(__dirname, '..', '..', 'data', 'analysis');
  const targetVenues = Object.keys(VENUE_NAMES_EN);

  const allCode = [];
  const venueMapEntries = [];

  for (const venueCode of targetVenues) {
    const rulesPath = path.join(analysisDir, `venue-${venueCode}`, 'rules.json');

    if (!fs.existsSync(rulesPath)) {
      console.log(`⚠️  ${venueCode}: rules.json not found`);
      continue;
    }

    const data = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));

    if (!data.win_rules?.[0]?.id) {
      console.log(`⚠️  ${venueCode}: 江戸川形式でない`);
      continue;
    }

    const result = generateVenueCode(venueCode, data);

    if (result) {
      allCode.push(result.code);
      venueMapEntries.push(`  '${result.venueCode}': ${result.constName},`);

      const ruleCount = (result.code.match(/id: '/g) || []).length;
      console.log(`✅ ${venueCode} (${VENUE_NAMES_JP[venueCode]}): ${ruleCount}ルール`);
    } else {
      console.log(`⚠️  ${venueCode}: 条件を満たすルールなし`);
    }
  }

  // 出力ファイルに書き込み
  const output = `// 自動生成されたルール定義（${new Date().toISOString().split('T')[0]}）
// scripts/analysis/generate-rule-code.js で生成

${allCode.join('\n')}

// VENUE_RULESへの追加エントリ
// 以下をVENUE_RULESオブジェクトに追加してください:
/*
${venueMapEntries.join('\n')}
*/
`;

  const outputPath = path.join(__dirname, 'generated-rules.js');
  fs.writeFileSync(outputPath, output);

  console.log(`\n=== 完了 ===`);
  console.log(`出力: ${outputPath}`);
}

main();
