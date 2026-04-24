/**
 * イン崩れ指数精度検証 — 1コースが飛ぶレースをどれだけ予測できているか
 *
 * 分析内容:
 * 1. イン崩れ指数レベル別の「1コースが飛んだ率」（ベースラインと比較）
 * 2. イン崩れ指数スコア帯別（10点刻み）の1コース飛び率
 * 3. 決まり手（winning_technique）別のイン崩れ指数分布
 * 4. 高配当レースで事前にイン崩れ指数highが付いていたか
 * 5. racesテーブルの特徴量と1コース飛びの相関
 */

import { supabase } from "../lib/supabaseClient.js";

const DAYS = 90;

function pct(rate, n = 1) {
  return `${(rate * 100).toFixed(n)}%`;
}

function pad(s, n) {
  return String(s).padStart(n);
}

// ページネーションつき全件取得
async function fetchAll(table, query) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  const sinceStr = since.toISOString().split("T")[0];

  console.log("🔍 イン崩れ指数精度検証\n");
  console.log(`📅 期間: 過去${DAYS}日 (${sinceStr} 〜)\n`);

  // races（volatility付き）
  const races = await fetchAll("races", (from, to) =>
    supabase
      .from("races")
      .select(
        "race_id, venue_code, volatility_score, volatility_level, volatility_reasons, first_boat_win_rate, first_boat_motor_2rate, win_rate_stddev",
      )
      .not("volatility_level", "is", null)
      .gte("race_date", sinceStr)
      .range(from, to),
  );

  // race_results
  const results = await fetchAll("race_results", (from, to) =>
    supabase
      .from("race_results")
      .select(
        "race_id, rank1, payout_win, winning_technique, is_cancelled, is_no_race",
      )
      .gte("race_id", sinceStr)
      .eq("is_cancelled", false)
      .eq("is_no_race", false)
      .range(from, to),
  );

  console.log(`イン崩れ指数データ: ${races.length.toLocaleString()} 件`);
  console.log(`結果データ:   ${results.length.toLocaleString()} 件\n`);

  // JOIN
  const resultMap = new Map(results.map((r) => [r.race_id, r]));
  const joined = [];
  for (const race of races) {
    const res = resultMap.get(race.race_id);
    if (!res || !res.winning_technique) continue;
    joined.push({ ...race, ...res });
  }
  console.log(`結合済みデータ: ${joined.length.toLocaleString()} 件\n`);

  if (joined.length === 0) {
    console.log("❌ 結合データが0件。データを確認してください。");
    process.exit(1);
  }

  // --- ベースライン ---
  // 「1コース飛び」= rank1が1号艇以外、または winning_technique が逃げ以外
  const nige1stRate =
    joined.filter((r) => r.winning_technique === "逃げ").length / joined.length;
  const rank1WinRate =
    joined.filter((r) => r.rank1 === 1).length / joined.length;

  console.log("=".repeat(65));
  console.log("【ベースライン】");
  console.log("=".repeat(65));
  console.log(
    `  全体の「逃げ」率（1コース勝ち）: ${pct(nige1stRate)} (n=${joined.length})`,
  );
  console.log(`  全体の1号艇1着率:               ${pct(rank1WinRate)}`);
  console.log(`  → 1コースが飛ぶ率（逃げ以外）:  ${pct(1 - nige1stRate)}\n`);

  // --- 1. イン崩れ指数レベル別 ---
  console.log("=".repeat(65));
  console.log("【1】イン崩れ指数レベル別 — 1コース飛び率と決まり手");
  console.log("=".repeat(65));

  const baseUpsettRate = 1 - nige1stRate;

  for (const [level, label] of [
    ["low", "堅い       (score<42) "],
    ["medium", "標準       (42≤s<55) "],
    ["high", "崩れやすい (score≥55) "],
  ]) {
    const entries = joined.filter((r) => r.volatility_level === level);
    if (entries.length === 0) {
      console.log(`  ${label}: データなし`);
      continue;
    }

    const upsetRate =
      1 -
      entries.filter((r) => r.winning_technique === "逃げ").length /
        entries.length;
    const diff = upsetRate - baseUpsettRate;
    const arrow = diff > 0.04 ? "⬆" : diff < -0.04 ? "⬇" : "→";

    // 決まり手分布
    const tech = {};
    entries.forEach((r) => {
      tech[r.winning_technique] = (tech[r.winning_technique] || 0) + 1;
    });

    // 払戻統計（飛んだ時）
    const upseted = entries.filter(
      (r) => r.winning_technique !== "逃げ" && r.payout_win,
    );
    const avgPayout =
      upseted.length > 0
        ? upseted.reduce((s, r) => s + r.payout_win, 0) / upseted.length
        : 0;

    console.log(`\n  [${label}] n=${entries.length}`);
    console.log(
      `    1コース飛び率: ${pct(upsetRate)} (${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}pt) ${arrow}`,
    );
    console.log(
      `    飛んだ時の平均単勝払戻: ¥${Math.round(avgPayout).toLocaleString()}`,
    );
    console.log(
      `    決まり手: ${Object.entries(tech)
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${t}${c}件(${pct(c / entries.length, 0)})`)
        .join(" / ")}`,
    );
  }
  console.log();

  // --- 2. スコア帯別（10点刻み） ---
  console.log("=".repeat(65));
  console.log("【2】スコア帯別（10点刻み） — スコアと飛び率の単調性");
  console.log("=".repeat(65));

  const bands = {};
  for (let lo = 0; lo < 100; lo += 10) bands[lo] = [];
  for (const r of joined) {
    const b = Math.min(Math.floor(r.volatility_score / 10) * 10, 90);
    bands[b].push(r);
  }

  for (const [lo, entries] of Object.entries(bands).sort(
    (a, b) => +a[0] - +b[0],
  )) {
    if (entries.length === 0) continue;
    const uRate =
      1 -
      entries.filter((r) => r.winning_technique === "逃げ").length /
        entries.length;
    const bar = "█".repeat(Math.round(uRate * 25));
    const diff = uRate - baseUpsettRate;
    console.log(
      `  ${pad(lo, 2)}-${+lo + 9}点 (n=${pad(entries.length, 4)}): ${pct(uRate).padStart(6)} ${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}pt  ${bar}`,
    );
  }
  console.log();

  // --- 3. 高配当レースでイン崩れ指数が当たっていたか ---
  console.log("=".repeat(65));
  console.log("【3】実際に高配当だったレース — 事前のイン崩れ指数は？");
  console.log("  (本当に使える指標なら high が多いはず)");
  console.log("=".repeat(65));

  for (const [threshold, label] of [
    [1000, "単勝1000円超（波乱）"],
    [2000, "単勝2000円超（大波乱）"],
    [5000, "単勝5000円超（超万券）"],
  ]) {
    const bigHit = joined.filter((r) => r.payout_win >= threshold);
    if (bigHit.length === 0) continue;

    const levelDist = { low: 0, medium: 0, high: 0 };
    bigHit.forEach((r) => {
      levelDist[r.volatility_level] = (levelDist[r.volatility_level] || 0) + 1;
    });

    console.log(`\n  ${label}: ${bigHit.length}件`);
    for (const [lv, cnt] of Object.entries(levelDist)) {
      const bar = "█".repeat(Math.round((cnt / bigHit.length) * 20));
      console.log(
        `    ${lv.padEnd(7)}: ${pad(cnt, 3)}件 (${pct(cnt / bigHit.length)}) ${bar}`,
      );
    }
  }
  console.log();

  // --- 4. racesの特徴量別 × 1コース飛び相関 ---
  console.log("=".repeat(65));
  console.log("【4】個別特徴量 × 1コース飛び率（どの指標が効くか）");
  console.log("=".repeat(65));

  // first_boat_win_rate 分位別
  const withRate = joined.filter((r) => r.first_boat_win_rate != null);
  if (withRate.length > 0) {
    const sorted = [...withRate].sort(
      (a, b) => a.first_boat_win_rate - b.first_boat_win_rate,
    );
    const q = Math.floor(sorted.length / 4);
    const quartiles = [
      sorted.slice(0, q),
      sorted.slice(q, q * 2),
      sorted.slice(q * 2, q * 3),
      sorted.slice(q * 3),
    ];
    console.log("\n  1号艇の全国勝率（低い→高いの四分位）:");
    for (let i = 0; i < 4; i++) {
      const g = quartiles[i];
      const minR = g[0].first_boat_win_rate.toFixed(2);
      const maxR = g[g.length - 1].first_boat_win_rate.toFixed(2);
      const u =
        1 - g.filter((r) => r.winning_technique === "逃げ").length / g.length;
      const diff = u - baseUpsettRate;
      console.log(
        `    Q${i + 1} (${minR}〜${maxR}, n=${g.length}): 飛び率=${pct(u)} (${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}pt)`,
      );
    }
  }

  // first_boat_motor_2rate 分位別
  const withMotor = joined.filter((r) => r.first_boat_motor_2rate != null);
  if (withMotor.length > 0) {
    const sorted = [...withMotor].sort(
      (a, b) => a.first_boat_motor_2rate - b.first_boat_motor_2rate,
    );
    const q = Math.floor(sorted.length / 4);
    const quartiles = [
      sorted.slice(0, q),
      sorted.slice(q, q * 2),
      sorted.slice(q * 2, q * 3),
      sorted.slice(q * 3),
    ];
    console.log("\n  1号艇のモーター2連率（低い→高いの四分位）:");
    for (let i = 0; i < 4; i++) {
      const g = quartiles[i];
      const minR = g[0].first_boat_motor_2rate.toFixed(1);
      const maxR = g[g.length - 1].first_boat_motor_2rate.toFixed(1);
      const u =
        1 - g.filter((r) => r.winning_technique === "逃げ").length / g.length;
      const diff = u - baseUpsettRate;
      console.log(
        `    Q${i + 1} (${minR}〜${maxR}%, n=${g.length}): 飛び率=${pct(u)} (${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}pt)`,
      );
    }
  }

  // win_rate_stddev 分位別（選手間のバラつき）
  const withStd = joined.filter((r) => r.win_rate_stddev != null);
  if (withStd.length > 0) {
    const sorted = [...withStd].sort(
      (a, b) => a.win_rate_stddev - b.win_rate_stddev,
    );
    const q = Math.floor(sorted.length / 4);
    const quartiles = [
      sorted.slice(0, q),
      sorted.slice(q, q * 2),
      sorted.slice(q * 2, q * 3),
      sorted.slice(q * 3),
    ];
    console.log("\n  選手間の勝率標準偏差（接戦→実力差大の四分位）:");
    for (let i = 0; i < 4; i++) {
      const g = quartiles[i];
      const minR = g[0].win_rate_stddev.toFixed(2);
      const maxR = g[g.length - 1].win_rate_stddev.toFixed(2);
      const u =
        1 - g.filter((r) => r.winning_technique === "逃げ").length / g.length;
      const diff = u - baseUpsettRate;
      console.log(
        `    Q${i + 1} (σ=${minR}〜${maxR}, n=${g.length}): 飛び率=${pct(u)} (${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}pt)`,
      );
    }
  }
  console.log();

  // --- 5. サマリー・結論 ---
  console.log("=".repeat(65));
  console.log("【まとめ・結論】");
  console.log("=".repeat(65));

  const highEntries = joined.filter((r) => r.volatility_level === "high");
  const lowEntries = joined.filter((r) => r.volatility_level === "low");
  const highUpsetRate =
    highEntries.length > 0
      ? 1 -
        highEntries.filter((r) => r.winning_technique === "逃げ").length /
          highEntries.length
      : null;
  const lowUpsetRate =
    lowEntries.length > 0
      ? 1 -
        lowEntries.filter((r) => r.winning_technique === "逃げ").length /
          lowEntries.length
      : null;

  console.log(`\n  ベースライン（1コース飛び率）: ${pct(baseUpsettRate)}`);
  if (highUpsetRate !== null)
    console.log(
      `  イン崩れ指数high時:           ${pct(highUpsetRate)} (${highUpsetRate - baseUpsettRate >= 0 ? "+" : ""}${((highUpsetRate - baseUpsettRate) * 100).toFixed(1)}pt)`,
    );
  if (lowUpsetRate !== null)
    console.log(
      `  イン崩れ指数low時:            ${pct(lowUpsetRate)} (${lowUpsetRate - baseUpsettRate >= 0 ? "+" : ""}${((lowUpsetRate - baseUpsettRate) * 100).toFixed(1)}pt)`,
    );

  const lift = highUpsetRate != null ? highUpsetRate - baseUpsettRate : 0;
  console.log();
  if (lift > 0.08) {
    console.log("  ✅ イン崩れ指数に有意な予測力あり（8pt超のリフト）");
  } else if (lift > 0.03) {
    console.log("  ⚠️  イン崩れ指数に弱い予測力（3〜8ptのリフト）→ 改善余地大");
  } else {
    console.log(
      "  ❌ イン崩れ指数がほぼランダム（3pt未満）→ 根本的な再設計が必要",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
