/**
 * 展開予測 × 払戻金 期待値分析レポート
 *
 * 期待値 = 予測確率 × オッズ（払戻金/100）
 * 個別レースごとにEVを算出し、EV>1の条件を検証する。
 *
 * 使い方:
 *   node scripts/analysis/expected-value-report.js
 *   node scripts/analysis/expected-value-report.js --model=safeBet
 *   node scripts/analysis/expected-value-report.js --from=2026-03-01 --to=2026-04-01
 */

import {
  isSupabaseEnabled,
  fetchAll,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";

const TECHNIQUE_MAP = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
};
const TECHNIQUE_MAP_REV = Object.fromEntries(
  Object.entries(TECHNIQUE_MAP).map(([k, v]) => [v, k]),
);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { model: "safeBet", from: null, to: null };
  for (const arg of args) {
    if (arg.startsWith("--model=")) opts.model = arg.split("=")[1];
    if (arg.startsWith("--from=")) opts.from = arg.split("=")[1];
    if (arg.startsWith("--to=")) opts.to = arg.split("=")[1];
  }
  return opts;
}


function fmt(v, digits = 1) {
  return v.toFixed(digits);
}

function fmtPct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtYen(v) {
  return `${Math.round(v).toLocaleString()}円`;
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const opts = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║    期待値分析レポート（EV = 予測確率 × オッズ）        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // --- データ取得 ---
  console.log("データ取得中...");

  const predictions = await fetchAll(
    "predictions",
    "race_id, feature_contributions, top_pick, top_2nd, top_3rd, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio, payout_win, payout_place, payout_trifecta, payout_trio",
    (q) =>
      q.eq("model_id", opts.model).not("feature_contributions", "is", null),
  );

  const results = await fetchAll(
    "race_results",
    "race_id, winning_technique, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio",
    (q) => q.not("winning_technique", "is", null),
  );

  const resultMap = new Map();
  for (const r of results) resultMap.set(r.race_id, r);

  // --- 突き合わせ ---
  const matched = [];
  let skipped = { noDistribution: 0, noResult: 0, noPayout: 0 };

  for (const p of predictions) {
    const tp = p.feature_contributions?.turnPrediction;
    if (!tp?.distribution) {
      skipped.noDistribution++;
      continue;
    }
    const result = resultMap.get(p.race_id);
    if (!result?.winning_technique) {
      skipped.noResult++;
      continue;
    }
    if (!result.payout_win) {
      skipped.noPayout++;
      continue;
    }

    const date = p.race_id.substring(0, 10);
    if (opts.from && date < opts.from) continue;
    if (opts.to && date > opts.to) continue;

    const dist = tp.distribution;
    const actualTechKey = TECHNIQUE_MAP_REV[result.winning_technique];

    // 最有力決まり手
    let dominantTech = null;
    let dominantProb = 0;
    for (const [tech, prob] of Object.entries(dist)) {
      if (prob > dominantProb && TECHNIQUE_MAP[tech]) {
        dominantProb = prob;
        dominantTech = tech;
      }
    }

    // 単勝オッズ（実際の1着の払戻 / 100）
    const winOdds = result.payout_win / 100;

    // 予測確率: top_pickに対応する決まり手の確率を使用
    // top_pick=1 → 逃げ確率, top_pick≠1 → 差し/まくり/まくり差しの合計
    const nigeProb = dist.nige || 0;
    let predictedWinProb;
    if (p.top_pick === 1) {
      predictedWinProb = nigeProb;
    } else {
      // top_pickが1以外 → 逃げ以外の確率の合計（簡易近似）
      predictedWinProb = 1 - nigeProb;
    }

    // 期待値（EV）= 予測確率 × オッズ
    // ※ オッズは的中時のみ既知。ハズレ時はオッズ不明なので計算不可
    const isHit = p.is_hit_win;
    const evIfHit = isHit ? predictedWinProb * winOdds : null;

    matched.push({
      raceId: p.race_id,
      date,
      venueCode: p.race_id.substring(11, 13),
      distribution: dist,
      dominantTech,
      dominantProb,
      actualTech: actualTechKey,
      topPick: p.top_pick,
      predictedWinProb,
      winOdds,
      isHit,
      evIfHit,
      payoutWin: p.payout_win || 0,
      payoutPlace: p.payout_place || 0,
      payoutTrifecta: p.payout_trifecta || 0,
      payoutTrio: p.payout_trio || 0,
      resultPayoutWin: result.payout_win,
    });
  }

  const dateRange =
    matched.length > 0
      ? `${matched[0].date} ~ ${matched[matched.length - 1].date}`
      : "N/A";

  const hitRaces = matched.filter((m) => m.isHit);
  const missRaces = matched.filter((m) => !m.isHit);

  console.log(`\nモデル: ${opts.model}`);
  console.log(`期間: ${dateRange}`);
  console.log(
    `分析対象: ${matched.length}レース（的中: ${hitRaces.length}, ハズレ: ${missRaces.length}）`,
  );
  console.log(
    `(distribution無し: ${skipped.noDistribution}, 結果無し: ${skipped.noResult}, 払戻無し: ${skipped.noPayout})\n`,
  );

  if (matched.length === 0) {
    console.log("分析対象データがありません。");
    return;
  }

  // =========================================
  // 1. 的中レースの期待値分布
  // =========================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1. 的中レースの期待値分布（EV = 予測確率 × オッズ）");
  console.log("   的中時のみEVを計算可能（ハズレ時は自分のpickのオッズ不明）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const evValues = hitRaces.map((m) => m.evIfHit);
  const evPositive = evValues.filter((v) => v >= 1.0);
  const evNegative = evValues.filter((v) => v < 1.0);
  const avgEv = evValues.reduce((s, v) => s + v, 0) / evValues.length;
  const medianEv = [...evValues].sort((a, b) => a - b)[
    Math.floor(evValues.length / 2)
  ];

  console.log(`  的中レース数: ${hitRaces.length}`);
  console.log(
    `  EV ≥ 1（+EV）: ${evPositive.length}件 (${fmtPct(evPositive.length / hitRaces.length)})`,
  );
  console.log(
    `  EV < 1（-EV）: ${evNegative.length}件 (${fmtPct(evNegative.length / hitRaces.length)})`,
  );
  console.log(`  平均EV: ${fmt(avgEv, 3)}`);
  console.log(`  中央値EV: ${fmt(medianEv, 3)}`);

  // EV帯別の分布
  const evBands = [
    [0, 0.5, "0.0-0.5"],
    [0.5, 1.0, "0.5-1.0"],
    [1.0, 1.5, "1.0-1.5"],
    [1.5, 2.0, "1.5-2.0"],
    [2.0, 3.0, "2.0-3.0"],
    [3.0, 100, "3.0+   "],
  ];
  console.log("\n  EV帯       件数   構成比   平均オッズ  平均確率");
  console.log("  ───────  ─────  ──────  ────────  ──────");
  for (const [lo, hi, label] of evBands) {
    const seg = hitRaces.filter((m) => m.evIfHit >= lo && m.evIfHit < hi);
    if (seg.length === 0) continue;
    const avgOdds = seg.reduce((s, m) => s + m.winOdds, 0) / seg.length;
    const avgProb =
      seg.reduce((s, m) => s + m.predictedWinProb, 0) / seg.length;
    console.log(
      `  ${label}   ${String(seg.length).padStart(5)}  ${fmtPct(seg.length / hitRaces.length).padStart(6)}  ${fmt(avgOdds, 1).padStart(6)}倍  ${fmtPct(avgProb).padStart(6)}`,
    );
  }

  // =========================================
  // 2. 確率帯別の期待値（全レース）
  // =========================================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("2. 予測確率帯別の実績（全レース）");
  console.log("   確率帯ごとに: 的中率, 平均オッズ(的中時), 実質EV, 回収率");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const probBands = [
    [0, 0.3],
    [0.3, 0.4],
    [0.4, 0.5],
    [0.5, 0.6],
    [0.6, 0.7],
    [0.7, 1.01],
  ];

  console.log(
    "  確率帯       N    的中率  平均オッズ  損益分岐  実質EV  回収率   判定",
  );
  console.log(
    "  ──────── ─────  ──────  ────────  ──────  ──────  ──────  ────",
  );

  for (const [lo, hi] of probBands) {
    const seg = matched.filter(
      (m) => m.predictedWinProb >= lo && m.predictedWinProb < hi,
    );
    if (seg.length < 10) continue;

    const hits = seg.filter((m) => m.isHit);
    const hitRate = hits.length / seg.length;
    const avgOddsWhenHit =
      hits.length > 0
        ? hits.reduce((s, m) => s + m.winOdds, 0) / hits.length
        : 0;
    const midProb = (lo + hi) / 2;
    const breakevenOdds = 1 / midProb; // この確率帯で+EVに必要な最低オッズ
    const totalPayout = seg.reduce((s, m) => s + m.payoutWin, 0);
    const recoveryRate = totalPayout / (seg.length * 100);
    // 実質EV = 的中率 × 平均オッズ（的中時）
    const realEv = hitRate * avgOddsWhenHit;
    const judgment = realEv >= 1.0 ? "🔥+EV" : realEv >= 0.9 ? "△" : "×";

    console.log(
      `  ${((lo * 100).toFixed(0) + "-" + (hi >= 1 ? "100" : (hi * 100).toFixed(0)) + "%").padEnd(10)} ${String(seg.length).padStart(5)}  ${fmtPct(hitRate).padStart(6)}  ${fmt(avgOddsWhenHit, 2).padStart(6)}倍  ${fmt(breakevenOdds, 2).padStart(5)}倍  ${fmt(realEv, 3).padStart(6)}  ${fmtPct(recoveryRate).padStart(6)}  ${judgment}`,
    );
  }

  console.log("\n  ※ 損益分岐 = 1/確率帯中央値。オッズがこれを超えれば+EV。");
  console.log("  ※ 実質EV = 的中率 × 平均オッズ（的中時）。1.0以上が利益圏。");

  // =========================================
  // 3. 「EV > 1 の時だけ買う」シミュレーション
  // =========================================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("3. 予測確率閾値シミュレーション");
  console.log("   「P ≥ 閾値のレースだけ買う」戦略の事後検証");
  console.log("   ※ 事前に使える情報は予測確率のみ（オッズは結果判明後）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 全レースの回収率（ベースライン）
  const baselinePayout = matched.reduce((s, m) => s + m.payoutWin, 0);
  const baselineRR = baselinePayout / (matched.length * 100);

  console.log(
    `  ベースライン: ${matched.length}レース × 100円 → 回収率 ${fmtPct(baselineRR)}\n`,
  );

  // 的中レースのEVでフィルタ: EV閾値を変えてシミュレーション
  // NOTE: ハズレレースはEV不明のため、確率ベースで近似フィルタ
  // 「確率 × 必要最低オッズ > 閾値」を事前判断として、
  // 実際の結果で検証する

  // 方法: 各レースの「損益分岐オッズ」を計算し、
  // 的中時のオッズが損益分岐を超えていたかで分析
  console.log(
    "  閾値     買いN  的中N   的中率   投資額    回収額    回収率    利益",
  );
  console.log(
    "  ────── ─────  ─────  ──────  ───────  ───────  ──────  ───────",
  );

  // 事前に使える情報: 予測確率のみ。オッズは不明。
  // → 確率が高いレースに絞る（低確率=高オッズ必要で不確実）戦略
  const probThresholds = [0, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7];
  for (const th of probThresholds) {
    const seg = matched.filter((m) => m.predictedWinProb >= th);
    if (seg.length < 10) continue;
    const hits = seg.filter((m) => m.isHit);
    const payout = seg.reduce((s, m) => s + m.payoutWin, 0);
    const investment = seg.length * 100;
    const rr = payout / investment;
    const profit = payout - investment;
    console.log(
      `  P≥${(th * 100).toFixed(0).padStart(2)}%  ${String(seg.length).padStart(5)}  ${String(hits.length).padStart(5)}  ${fmtPct(hits.length / seg.length).padStart(6)}  ${fmtYen(investment).padStart(9)}  ${fmtYen(payout).padStart(9)}  ${fmtPct(rr).padStart(6)}  ${(profit >= 0 ? "+" : "") + fmtYen(profit)}`,
    );
  }

  // =========================================
  // 4. オッズ別の回収率（的中時のオッズで分析）
  // =========================================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("4. オッズ帯別の回収率");
  console.log("   実際の単勝オッズ（=払戻金/100）で全レースを分類");
  console.log("   ※ オッズは結果判明後の値（1着のオッズ）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 的中レースの実際のオッズ分布
  const oddsBands = [
    [1, 2, "1-2倍"],
    [2, 3, "2-3倍"],
    [3, 5, "3-5倍"],
    [5, 10, "5-10倍"],
    [10, 20, "10-20倍"],
    [20, 1000, "20倍+"],
  ];

  console.log("  オッズ帯    的中N   平均確率  平均EV   平均払戻");
  console.log("  ────────  ─────  ──────  ──────  ────────");

  for (const [lo, hi, label] of oddsBands) {
    const seg = hitRaces.filter((m) => m.winOdds >= lo && m.winOdds < hi);
    if (seg.length === 0) continue;
    const avgProb =
      seg.reduce((s, m) => s + m.predictedWinProb, 0) / seg.length;
    const avgEv = seg.reduce((s, m) => s + m.evIfHit, 0) / seg.length;
    const avgPayout =
      seg.reduce((s, m) => s + m.resultPayoutWin, 0) / seg.length;
    console.log(
      `  ${label.padEnd(8)}  ${String(seg.length).padStart(5)}  ${fmtPct(avgProb).padStart(6)}  ${fmt(avgEv, 3).padStart(6)}  ${fmtYen(avgPayout).padStart(8)}`,
    );
  }

  // =========================================
  // 5. 確率 × オッズ クロス分析（的中レース）
  // =========================================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("5. 確率 × オッズ クロス分析（的中レースのEV）");
  console.log("   予測確率とオッズの組み合わせで期待値を可視化");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const crossProbBands = [
    [0.3, 0.5, "30-50%"],
    [0.5, 0.6, "50-60%"],
    [0.6, 0.7, "60-70%"],
    [0.7, 1.01, "70%+"],
  ];
  const crossOddsBands = [
    [1, 2, "1-2倍"],
    [2, 3, "2-3倍"],
    [3, 5, "3-5倍"],
    [5, 100, "5倍+"],
  ];

  // ヘッダー
  let header = "  確率＼オッズ  ";
  for (const [, , label] of crossOddsBands) {
    header += label.padStart(10);
  }
  console.log(header);
  console.log("  " + "─".repeat(header.length - 2));

  for (const [pLo, pHi, pLabel] of crossProbBands) {
    let row = `  ${pLabel.padEnd(12)}  `;
    for (const [oLo, oHi] of crossOddsBands) {
      const seg = hitRaces.filter(
        (m) =>
          m.predictedWinProb >= pLo &&
          m.predictedWinProb < pHi &&
          m.winOdds >= oLo &&
          m.winOdds < oHi,
      );
      if (seg.length < 3) {
        row += "     -    ";
      } else {
        const avgEv = seg.reduce((s, m) => s + m.evIfHit, 0) / seg.length;
        const marker = avgEv >= 1.0 ? "🔥" : "  ";
        row += `${fmt(avgEv, 2).padStart(6)}${marker}  `;
      }
    }
    console.log(row);
  }

  console.log("\n  ※ 値 = 平均EV（予測確率 × オッズ）。1.0以上が+EV。");

  // =========================================
  // 6. 決まり手別の期待値分析
  // =========================================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("6. 決まり手別の期待値");
  console.log("   各決まり手の確率帯で、EV > 1 が成立する条件");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (const [techKey, techName] of Object.entries(TECHNIQUE_MAP)) {
    // この決まり手の確率を使ってセグメント
    const techBands = [
      [0.1, 0.2],
      [0.2, 0.3],
      [0.3, 0.4],
      [0.4, 0.5],
      [0.5, 0.6],
      [0.6, 1.01],
    ];

    const rows = [];
    for (const [lo, hi] of techBands) {
      const seg = matched.filter((m) => {
        const prob = m.distribution[techKey] || 0;
        return prob >= lo && prob < hi;
      });
      if (seg.length < 20) continue;

      const hits = seg.filter((m) => m.isHit);
      const techActual = seg.filter((m) => m.actualTech === techKey);
      const hitRate = hits.length / seg.length;
      const techRate = techActual.length / seg.length;
      const totalPayout = seg.reduce((s, m) => s + m.payoutWin, 0);
      const rr = totalPayout / (seg.length * 100);

      // この決まり手が実現した場合の平均オッズ
      const techHitWithPayout = seg.filter(
        (m) => m.actualTech === techKey && m.isHit,
      );
      const avgOddsWhenTechHit =
        techHitWithPayout.length > 0
          ? techHitWithPayout.reduce((s, m) => s + m.winOdds, 0) /
            techHitWithPayout.length
          : 0;

      const midProb = (lo + hi) / 2;
      const ev = midProb * avgOddsWhenTechHit; // P(決まり手) × 平均オッズ

      rows.push({
        band: `${(lo * 100).toFixed(0)}-${(hi >= 1 ? 100 : hi * 100).toFixed(0)}%`,
        n: seg.length,
        techRate,
        hitRate,
        avgOdds: avgOddsWhenTechHit,
        ev,
        rr,
      });
    }

    if (rows.length === 0) continue;

    console.log(`  【${techName}】`);
    console.log(
      "  確率帯       N   実現率  的中率  平均ｵｯｽﾞ    EV    回収率  判定",
    );
    console.log(
      "  ──────── ─────  ──────  ──────  ──────  ──────  ──────  ────",
    );

    for (const r of rows) {
      const judgment = r.ev >= 1.0 ? "🔥+EV" : r.ev >= 0.8 ? " △" : " ×";
      console.log(
        `  ${r.band.padEnd(10)} ${String(r.n).padStart(5)}  ${fmtPct(r.techRate).padStart(6)}  ${fmtPct(r.hitRate).padStart(6)}  ${fmt(r.avgOdds, 2).padStart(5)}倍  ${fmt(r.ev, 3).padStart(6)}  ${fmtPct(r.rr).padStart(6)}  ${judgment}`,
      );
    }
    console.log("");
  }

  // =========================================
  // 7. 会場別の期待値特性
  // =========================================
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("7. 会場別: 的中時の平均EV（N≥20）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const byVenue = {};
  for (const m of matched) {
    if (!byVenue[m.venueCode]) byVenue[m.venueCode] = [];
    byVenue[m.venueCode].push(m);
  }

  const venueResults = [];
  for (const [code, races] of Object.entries(byVenue)) {
    const hits = races.filter((m) => m.isHit);
    if (hits.length < 20) continue;
    const avgEv = hits.reduce((s, m) => s + m.evIfHit, 0) / hits.length;
    const hitRate = hits.length / races.length;
    const totalPayout = races.reduce((s, m) => s + m.payoutWin, 0);
    const rr = totalPayout / (races.length * 100);
    const avgOdds = hits.reduce((s, m) => s + m.winOdds, 0) / hits.length;
    venueResults.push({
      code,
      name: VENUE_NAMES[code] || code,
      n: races.length,
      hits: hits.length,
      hitRate,
      avgEv,
      avgOdds,
      rr,
    });
  }

  venueResults.sort((a, b) => b.avgEv - a.avgEv);
  console.log("  会場          N    的中N  的中率  平均ｵｯｽﾞ  平均EV  回収率");
  console.log("  ──────────  ────  ─────  ──────  ──────  ──────  ──────");
  for (const v of venueResults) {
    const marker = v.rr >= 1.0 ? " 🔥" : "";
    console.log(
      `  ${v.name.padEnd(8)}  ${String(v.n).padStart(5)}  ${String(v.hits).padStart(5)}  ${fmtPct(v.hitRate).padStart(6)}  ${fmt(v.avgOdds, 2).padStart(5)}倍  ${fmt(v.avgEv, 3).padStart(6)}  ${fmtPct(v.rr).padStart(6)}${marker}`,
    );
  }

  // =========================================
  // 8. サマリー & 実用化への示唆
  // =========================================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("8. サマリー & 実用化への示唆");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const totalInvestment = matched.length * 100;
  const totalReturn = matched.reduce((s, m) => s + m.payoutWin, 0);
  const overallRR = totalReturn / totalInvestment;

  console.log(`  全体: ${matched.length}レース × 100円`);
  console.log(
    `  投資: ${fmtYen(totalInvestment)} → 回収: ${fmtYen(totalReturn)} (回収率: ${fmtPct(overallRR)})`,
  );

  // +EVレースの統計（的中レースのみ）
  const plusEvHits = hitRaces.filter((m) => m.evIfHit >= 1.0);
  const minusEvHits = hitRaces.filter((m) => m.evIfHit < 1.0);
  console.log(`\n  的中レースのEV分析:`);
  console.log(
    `    +EV（≥1.0）: ${plusEvHits.length}件 — 平均EV ${fmt(plusEvHits.length > 0 ? plusEvHits.reduce((s, m) => s + m.evIfHit, 0) / plusEvHits.length : 0, 3)}`,
  );
  console.log(
    `    -EV（<1.0）: ${minusEvHits.length}件 — 平均EV ${fmt(minusEvHits.length > 0 ? minusEvHits.reduce((s, m) => s + m.evIfHit, 0) / minusEvHits.length : 0, 3)}`,
  );

  // 最高EV Top5
  const topEv = [...hitRaces].sort((a, b) => b.evIfHit - a.evIfHit).slice(0, 5);
  console.log("\n  EV Top 5（的中レース）:");
  for (const m of topEv) {
    const venueName = VENUE_NAMES[m.venueCode] || m.venueCode;
    console.log(
      `    ${m.raceId}  ${venueName}  確率${fmtPct(m.predictedWinProb)} × ${fmt(m.winOdds, 1)}倍 = EV ${fmt(m.evIfHit, 2)}  払戻${fmtYen(m.resultPayoutWin)}`,
    );
  }

  console.log("\n  ─── 実用化に向けて ───");
  console.log("  現状: 払戻金（事後オッズ）で分析 → 事後検証のみ");
  console.log("  次のステップ:");
  console.log("    1. レース前のオッズデータ取得 → リアルタイムEV計算が可能に");
  console.log("    2. EV > 1 のレースだけ買う自動判定");
  console.log("    3. 確率帯 × オッズ帯の交差で最適な購入条件を特定");

  console.log("\n完了");
}

main().catch((e) => {
  console.error("❌ エラー:", e);
  process.exit(1);
});
