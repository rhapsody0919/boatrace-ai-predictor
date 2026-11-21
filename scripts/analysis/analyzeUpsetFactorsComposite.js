// 会場別1コース勝率（venueParameters.jsより）— キーはゼロ埋め2桁文字列で統一
const VENUE_1COURSE_WIN_RATE = {
  "01": 0.52,
  "02": 0.43,
  "03": 0.44,
  "04": 0.45,
  "05": 0.5,
  "06": 0.52,
  "07": 0.52,
  "08": 0.56,
  "09": 0.54,
  10: 0.52,
  11: 0.5,
  12: 0.54,
  13: 0.55,
  14: 0.56,
  15: 0.56,
  16: 0.55,
  17: 0.52,
  18: 0.57,
  19: 0.55,
  20: 0.54,
  21: 0.57,
  22: 0.56,
  23: 0.56,
  24: 0.62,
};

function pct(rate, n = 1) {
  return `${(rate * 100).toFixed(n)}%`;
}

// 各因子の正規化（有効範囲で0-1スケール）
// 「高いほど飛びやすい」方向に揃える
function normalize(val, min, max, invert = false) {
  if (val == null) return null;
  const n = Math.max(0, Math.min(1, (val - min) / (max - min)));
  return invert ? 1 - n : n;
}

// 統計から境界値を導出
function minMaxOf(rows, key) {
  const values = rows.map((r) => r[key]).filter((v) => v != null);
  return [Math.min(...values), Math.max(...values)];
}

// シンプルな重み付き複合スコア（各因子の予測力（spread）を重みに）
// 「飛びやすい = スコア高い」方向
function buildWeights(factorResults) {
  const spreadOf = (key) => factorResults[key]?.spread ?? 0;

  return {
    boat1WinRate: spreadOf("boat1WinRate"), // 低い勝率 → 飛びやすい (invert=true)
    venue1Rate: spreadOf("venue1Rate"), // 低い1コース率 → 飛びやすい (invert=true)
    boat1MotorRate: spreadOf("boat1MotorRate"), // 低いモーター → 飛びやすい (invert=true)
    winRateStddev: spreadOf("winRateStddev"), // 低いσ（接戦）→ 飛びやすい (invert=true)
    boat1AvgST: spreadOf("boat1AvgST"), // 遅いST → 飛びやすい (invert=false, STが高い=遅い)
    nigeProbAI: spreadOf("nigeProbAI"), // 低い逃げ確率 → 飛びやすい (invert=true)
  };
}

function printWeights(WEIGHTS) {
  const totalW = Object.values(WEIGHTS).reduce((s, v) => s + v, 0);
  console.log("\n  各因子の重み（予測力のspread比例）:");
  for (const [key, w] of Object.entries(WEIGHTS).sort((a, b) => b[1] - a[1])) {
    console.log(
      `    ${key.padEnd(16)}: ${(w * 100).toFixed(1)}pt → 重み${((w / totalW) * 100).toFixed(1)}%`,
    );
  }
}

// スコア計算
function scoreRows(rows, WEIGHTS) {
  const [minBW, maxBW] = minMaxOf(rows, "boat1WinRate");
  const [minMR, maxMR] = minMaxOf(rows, "boat1MotorRate");
  const [minSD, maxSD] = minMaxOf(rows, "winRateStddev");
  const [minST, maxST] = minMaxOf(rows, "boat1AvgST");
  const [minNP, maxNP] = minMaxOf(rows, "nigeProbAI");

  const rowsWithScore = [];
  for (const r of rows) {
    const feats = {
      boat1WinRate: normalize(r.boat1WinRate, minBW, maxBW, true), // 低→高飛び
      venue1Rate: normalize(
        r.venue1Rate,
        Math.min(...Object.values(VENUE_1COURSE_WIN_RATE)),
        Math.max(...Object.values(VENUE_1COURSE_WIN_RATE)),
        true,
      ),
      boat1MotorRate: normalize(r.boat1MotorRate, minMR, maxMR, true), // 低→高飛び
      winRateStddev: normalize(r.winRateStddev, minSD, maxSD, true), // 低σ（接戦）→高飛び
      boat1AvgST: normalize(r.boat1AvgST, minST, maxST, false), // 遅い→高飛び
      nigeProbAI: normalize(r.nigeProbAI, minNP, maxNP, true), // 低→高飛び
    };

    let score = 0,
      usedW = 0;
    for (const [key, w] of Object.entries(WEIGHTS)) {
      if (feats[key] != null && w > 0) {
        score += feats[key] * w;
        usedW += w;
      }
    }
    if (usedW === 0) continue;
    rowsWithScore.push({ ...r, compositeScore: score / usedW });
  }
  return rowsWithScore;
}

// 複合スコア四分位分析
function splitQuintiles(rowsWithScore) {
  const sortedByComp = [...rowsWithScore].sort(
    (a, b) => a.compositeScore - b.compositeScore,
  );
  const qn = Math.floor(sortedByComp.length / 5);
  return [0, 1, 2, 3, 4].map((i) => sortedByComp.slice(i * qn, (i + 1) * qn));
}

function printQuintiles(quintiles, baseline) {
  console.log("\n  【複合スコア 五分位別 1コース飛び率】");
  for (let i = 0; i < 5; i++) {
    const g = quintiles[i];
    const upsetRate = g.filter((r) => r.isUpset).length / g.length;
    const diff = upsetRate - baseline;
    const bar = "█".repeat(Math.round(upsetRate * 25));
    const minS = g[0].compositeScore.toFixed(2),
      maxS = g[g.length - 1].compositeScore.toFixed(2);
    console.log(
      `    Q${i + 1} (score ${minS}〜${maxS}, n=${g.length}): ${pct(upsetRate)} (${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}pt) ${bar}`,
    );
  }
}

// 複合スコア最高五分位の平均払戻
function printTopPayout(quintiles, rows) {
  const topQ = quintiles[4]; // 最も飛びやすいとされるグループ
  const topUpsets = topQ.filter((r) => r.isUpset && r.payout);
  const topAvgPayout =
    topUpsets.reduce((s, r) => s + r.payout, 0) / (topUpsets.length || 1);
  console.log(
    `\n  複合スコア最高Q5での飛んだ時の平均払戻: ¥${Math.round(topAvgPayout).toLocaleString()}`,
  );
  console.log(
    `  （全体平均払戻: ¥${Math.round(rows.filter((r) => r.isUpset && r.payout).reduce((s, r) => s + r.payout, 0) / rows.filter((r) => r.isUpset && r.payout).length).toLocaleString()}）`,
  );
}

// ---- 複合指標の構築 ----
function analyzeComposite(rows, factorResults, baseline) {
  console.log("=".repeat(65));
  console.log("【2】複合スコア — 各因子を0-1に正規化して合成");
  console.log("=".repeat(65));

  const WEIGHTS = buildWeights(factorResults);
  printWeights(WEIGHTS);

  const rowsWithScore = scoreRows(rows, WEIGHTS);

  console.log(
    `\n  複合スコア計算済み: ${rowsWithScore.length.toLocaleString()} 件`,
  );

  const quintiles = splitQuintiles(rowsWithScore);
  printQuintiles(quintiles, baseline);
  printTopPayout(quintiles, rows);
  return quintiles;
}

export { VENUE_1COURSE_WIN_RATE, pct, analyzeComposite };
