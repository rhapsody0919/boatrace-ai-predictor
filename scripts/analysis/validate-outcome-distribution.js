/**
 * 出目分布 価値測定 検証スクリプト
 *
 * 設計書: docs/design/outcome-distribution-validation-script.md
 *
 * 目的:
 *   outcome_distribution テーブル（過去90日の3連単出目集計）が AI 予測に対して
 *   どの程度の付加価値を持つかを定量的に測定する。
 *
 * 主要メトリクス:
 *   - distribution_hit_rate            : TopN カバレッジ
 *   - distribution_theoretical_recovery: TopN 平等買い回収率
 *   - ai_intersect_distribution_recovery : AI ∩ 分布 の回収率
 *   - lift_vs_ai_only                  : 改善度（主指標）
 *
 * 使い方:
 *   node scripts/analysis/validate-outcome-distribution.js \
 *     [--period 30] [--venue 03] [--model standard] [--top-n 5] \
 *     [--format json|csv|html|all] [--output-dir <path>] \
 *     [--include-trio] [--min-samples 30]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI 引数パース
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    period: 30,
    venue: null,
    model: null,
    topN: 5,
    format: "json",
    outputDir: path.join(
      __dirname,
      "../../data/analysis/outcome-distribution-validation",
    ),
    includeTrio: false,
    minSamples: 30,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--period":
        args.period = parseInt(next, 10);
        i++;
        break;
      case "--venue":
        args.venue = String(next).padStart(2, "0");
        i++;
        break;
      case "--model":
        args.model = next;
        i++;
        break;
      case "--top-n":
        args.topN = parseInt(next, 10);
        i++;
        break;
      case "--format":
        args.format = next;
        i++;
        break;
      case "--output-dir":
        args.outputDir = next;
        i++;
        break;
      case "--include-trio":
        args.includeTrio = true;
        break;
      case "--min-samples":
        args.minSamples = parseInt(next, 10);
        i++;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  // format は "json,csv,html" のようなカンマ区切りも許容
  args.formats = args.format
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (args.formats.includes("all")) args.formats = ["json", "csv", "html"];

  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/analysis/validate-outcome-distribution.js [options]",
      "",
      "Options:",
      "  --period <N>         検証対象期間（日数, default: 30）",
      "  --venue <code>       特定会場のみ（例: 03）",
      "  --model <id>         standard|safeBet|upsetFocus",
      "  --top-n <N>          採用候補とする分布上位 N パターン（default: 5）",
      "  --format <fmt>       json|csv|html|all、カンマ区切り可（default: json）",
      "  --output-dir <path>  出力ディレクトリ",
      "  --include-trio       3連複の評価も含める",
      "  --min-samples <N>    会場ごとの最低サンプル数（default: 30）",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// 日付ユーティリティ
// ---------------------------------------------------------------------------

function getTodayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

function getDateNDaysAgoJST(days) {
  const now = new Date();
  const d = new Date(
    now.getTime() - days * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
  );
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// データ取得
// ---------------------------------------------------------------------------

async function fetchOutcomeDistribution(venueFilter) {
  console.log("→ outcome_distribution を取得中...");
  const data = await fetchAll(
    "outcome_distribution",
    "venue_code, first_boat, second_boat, third_boat, count_90days, total_races, probability, avg_payout",
    (q) => {
      let query = q
        .order("venue_code", { ascending: true })
        .order("probability", { ascending: false });
      if (venueFilter)
        query = query.eq("venue_code", parseInt(venueFilter, 10));
      return query;
    },
  );

  const byVenue = new Map();
  for (const row of data) {
    if (!byVenue.has(row.venue_code)) byVenue.set(row.venue_code, []);
    byVenue.get(row.venue_code).push(row);
  }

  // 各 venue 内で probability 降順にソート（取得時に order 済みだが念のため）
  for (const [, arr] of byVenue) {
    arr.sort((a, b) => b.probability - a.probability);
  }

  console.log(`  取得完了: ${data.length}件 (${byVenue.size}会場)`);
  return byVenue;
}

async function fetchRaceResults(periodDays, venueFilter) {
  const fromDate = getDateNDaysAgoJST(periodDays);
  console.log(
    `→ race_results を取得中（${fromDate} 以降, period=${periodDays}日）...`,
  );

  const data = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, rank3, payout_trifecta, payout_trio, payout_win, payout_place_1, payout_place_2",
    (q) => {
      let query = q
        .eq("is_cancelled", false)
        .eq("is_no_race", false)
        .not("rank1", "is", null)
        .not("rank2", "is", null)
        .not("rank3", "is", null)
        .gte("race_id", fromDate);
      if (venueFilter) {
        query = query.like("race_id", `%-${venueFilter}-%`);
      }
      return query;
    },
  );

  // race_id から venue_code を抽出
  const enriched = data
    .map((r) => {
      const parts = r.race_id.split("-");
      if (parts.length < 4) return null;
      const venueCode = parseInt(parts[3], 10);
      if (!venueCode || isNaN(venueCode)) return null;
      return { ...r, venue_code: venueCode };
    })
    .filter(Boolean);

  console.log(`  取得完了: ${enriched.length}件`);
  return enriched;
}

async function fetchPredictions(periodDays, venueFilter, modelFilter) {
  const fromDate = getDateNDaysAgoJST(periodDays);
  console.log(
    `→ predictions を取得中（${fromDate} 以降${modelFilter ? `, model=${modelFilter}` : ""}）...`,
  );

  const data = await fetchAll(
    "predictions",
    "race_id, model_id, top_pick, top_2nd, top_3rd, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio, payout_win, payout_place, payout_trifecta, payout_trio",
    (q) => {
      let query = q
        .eq("is_shadow", false)
        .not("is_hit_win", "is", null)
        .gte("race_id", fromDate);
      if (venueFilter) query = query.like("race_id", `%-${venueFilter}-%`);
      if (modelFilter) query = query.eq("model_id", modelFilter);
      return query;
    },
  );

  console.log(`  取得完了: ${data.length}件`);
  return data;
}

// ---------------------------------------------------------------------------
// レース単位の照合
// ---------------------------------------------------------------------------

function buildMatchedRows({ raceResults, predictions, distMap, topN }) {
  // predictions を race_id × model_id でインデックス化
  const predIndex = new Map();
  for (const p of predictions) {
    const key = `${p.race_id}::${p.model_id}`;
    predIndex.set(key, p);
  }

  // モデル候補（ユニーク化）
  const modelIds = Array.from(new Set(predictions.map((p) => p.model_id)));

  const matched = [];
  for (const race of raceResults) {
    const actualPattern = `${race.rank1}-${race.rank2}-${race.rank3}`;
    const venueDist = distMap.get(race.venue_code) ?? [];
    const topNPatterns = venueDist.slice(0, topN);

    if (topNPatterns.length === 0) continue;

    const distHit = topNPatterns.some(
      (p) =>
        `${p.first_boat}-${p.second_boat}-${p.third_boat}` === actualPattern,
    );
    const distInvestment = topNPatterns.length * 100;
    // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
    const distPayout = distHit ? race.payout_trio || 0 : 0;

    // モデル別の合議結果
    for (const modelId of modelIds) {
      const pred = predIndex.get(`${race.race_id}::${modelId}`);
      if (!pred) continue;
      if (pred.top_pick == null || pred.top_2nd == null || pred.top_3rd == null)
        continue;

      const aiPattern = `${pred.top_pick}-${pred.top_2nd}-${pred.top_3rd}`;
      const aiHit = aiPattern === actualPattern;
      const aiPayout = pred.payout_trio || 0;
      const aiInDist = topNPatterns.some(
        (p) => `${p.first_boat}-${p.second_boat}-${p.third_boat}` === aiPattern,
      );

      matched.push({
        race_id: race.race_id,
        venue_code: race.venue_code,
        model_id: modelId,
        actualPattern,
        aiPattern,
        first_boat_actual: race.rank1,
        distHit,
        distInvestment,
        distPayout,
        aiHit,
        aiPayout,
        aiInDist,
      });
    }
  }

  return matched;
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

function aggregate(rows) {
  if (rows.length === 0) {
    return emptyMetrics();
  }
  const n = rows.length;
  const distHits = rows.filter((r) => r.distHit).length;
  const distInvestment = rows.reduce((s, r) => s + r.distInvestment, 0);
  const distPayout = rows.reduce((s, r) => s + r.distPayout, 0);

  const aiHits = rows.filter((r) => r.aiHit).length;
  const aiPayout = rows.reduce((s, r) => s + (r.aiPayout || 0), 0);
  const aiInvestment = n * 100;

  const inDistRows = rows.filter((r) => r.aiInDist);
  const inDistN = inDistRows.length;
  const inDistHits = inDistRows.filter((r) => r.aiHit).length;
  const inDistPayout = inDistRows.reduce((s, r) => s + (r.aiPayout || 0), 0);
  const inDistInvestment = inDistN * 100;

  const distributionHitRate = distHits / n;
  const distributionRecovery =
    distInvestment > 0 ? distPayout / distInvestment : 0;
  const aiHitRate = aiHits / n;
  const aiRecovery = aiPayout / aiInvestment;
  const intersectHitRate = inDistN > 0 ? inDistHits / inDistN : 0;
  const intersectRecovery =
    inDistInvestment > 0 ? inDistPayout / inDistInvestment : 0;
  const lift = intersectRecovery - aiRecovery;

  return {
    races: n,
    distribution_hit_rate: round(distributionHitRate, 4),
    distribution_theoretical_recovery: round(distributionRecovery, 4),
    ai_top_trifecta_hit_rate: round(aiHitRate, 4),
    ai_top_trifecta_recovery: round(aiRecovery, 4),
    ai_in_dist_share: round(inDistN / n, 4),
    ai_intersect_distribution_hit_rate: round(intersectHitRate, 4),
    ai_intersect_distribution_recovery: round(intersectRecovery, 4),
    lift_vs_ai_only: round(lift, 4),
  };
}

function emptyMetrics() {
  return {
    races: 0,
    distribution_hit_rate: 0,
    distribution_theoretical_recovery: 0,
    ai_top_trifecta_hit_rate: 0,
    ai_top_trifecta_recovery: 0,
    ai_in_dist_share: 0,
    ai_intersect_distribution_hit_rate: 0,
    ai_intersect_distribution_recovery: 0,
    lift_vs_ai_only: 0,
  };
}

function round(v, digits) {
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** digits;
  return Math.round(v * factor) / factor;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function verdict(metrics, minSamples) {
  if (metrics.races < minSamples) return "insufficient_samples";
  const lift = metrics.lift_vs_ai_only;
  if (lift >= 0.1) return "valuable";
  if (lift >= 0.05) return "promising";
  if (lift <= -0.05) return "harmful";
  return "neutral";
}

// ---------------------------------------------------------------------------
// 出力（JSON / CSV / HTML）
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "");
    return;
  }
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(
      cols
        .map((c) => {
          const v = r[c];
          if (v == null) return "";
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
  }
  fs.writeFileSync(filePath, lines.join("\n"));
}

function pct(v) {
  return (v * 100).toFixed(1) + "%";
}

function renderHtml({
  summary,
  byVenueRows,
  byModelRows,
  byFirstBoatRows,
  findings,
  config,
}) {
  const styles = `
    body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
           max-width: 1200px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1, h2 { border-bottom: 2px solid #4a90e2; padding-bottom: 0.25rem; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; }
    th, td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: right; font-size: 13px; }
    th { background: #f5f5f5; }
    td:first-child, th:first-child { text-align: left; }
    tr.valuable { background: #e8f7e8; }
    tr.promising { background: #fff8d6; }
    tr.harmful { background: #fce8e8; }
    tr.insufficient_samples { color: #999; }
    .note { background: #fff8d6; padding: 0.5rem 0.8rem; border-left: 4px solid #f5b942;
            margin: 1rem 0; font-size: 13px; }
    ul.findings li { margin-bottom: 0.3rem; }
  `;

  const overallTable = `
    <table>
      <tr><th>項目</th><th>値</th></tr>
      <tr><td>対象期間</td><td>${config.period}日 (${config.fromDate} 〜 ${config.toDate})</td></tr>
      <tr><td>対象レース数（モデル×レース）</td><td>${summary.overall.races.toLocaleString()}</td></tr>
      <tr><td>TopN</td><td>${config.topN}</td></tr>
      <tr><td>分布TopN 的中率</td><td>${pct(summary.overall.distribution_hit_rate)}</td></tr>
      <tr><td>分布TopN 平等買い回収率</td><td>${pct(summary.overall.distribution_theoretical_recovery)}</td></tr>
      <tr><td>AI 3連単 的中率</td><td>${pct(summary.overall.ai_top_trifecta_hit_rate)}</td></tr>
      <tr><td>AI 3連単 回収率</td><td>${pct(summary.overall.ai_top_trifecta_recovery)}</td></tr>
      <tr><td>AI 予測が分布TopN に入っていた割合</td><td>${pct(summary.overall.ai_in_dist_share)}</td></tr>
      <tr><td>AI ∩ 分布 的中率</td><td>${pct(summary.overall.ai_intersect_distribution_hit_rate)}</td></tr>
      <tr><td>AI ∩ 分布 回収率</td><td><b>${pct(summary.overall.ai_intersect_distribution_recovery)}</b></td></tr>
      <tr><td>Lift (∩ − AI単独)</td><td><b>${(summary.overall.lift_vs_ai_only * 100).toFixed(1)}pt</b></td></tr>
    </table>
  `;

  const venueTable =
    byVenueRows.length === 0
      ? "<p>該当データなし</p>"
      : `
    <table>
      <tr>
        <th>会場</th><th>レース数</th><th>分布的中率</th><th>分布回収率</th>
        <th>AI回収率</th><th>∩回収率</th><th>Lift(pt)</th><th>判定</th>
      </tr>
      ${byVenueRows
        .map(
          (r) => `
        <tr class="${r.verdict}">
          <td>${r.venue_name}(${String(r.venue_code).padStart(2, "0")})</td>
          <td>${r.races}</td>
          <td>${pct(r.distribution_hit_rate)}</td>
          <td>${pct(r.distribution_theoretical_recovery)}</td>
          <td>${pct(r.ai_top_trifecta_recovery)}</td>
          <td>${pct(r.ai_intersect_distribution_recovery)}</td>
          <td>${(r.lift_vs_ai_only * 100).toFixed(1)}</td>
          <td>${r.verdict}</td>
        </tr>
      `,
        )
        .join("")}
    </table>
  `;

  const modelTable =
    byModelRows.length === 0
      ? "<p>該当データなし</p>"
      : `
    <table>
      <tr><th>モデル</th><th>レース数</th><th>AI回収率</th><th>∩回収率</th><th>Lift(pt)</th></tr>
      ${byModelRows
        .map(
          (r) => `
        <tr>
          <td>${r.model_id}</td>
          <td>${r.races}</td>
          <td>${pct(r.ai_top_trifecta_recovery)}</td>
          <td>${pct(r.ai_intersect_distribution_recovery)}</td>
          <td>${(r.lift_vs_ai_only * 100).toFixed(1)}</td>
        </tr>
      `,
        )
        .join("")}
    </table>
  `;

  const firstBoatTable =
    byFirstBoatRows.length === 0
      ? "<p>該当データなし</p>"
      : `
    <table>
      <tr><th>1着艇</th><th>レース数</th><th>分布的中率</th><th>分布回収率</th></tr>
      ${byFirstBoatRows
        .map(
          (r) => `
        <tr>
          <td>${r.first_boat}号艇</td>
          <td>${r.races}</td>
          <td>${pct(r.distribution_hit_rate)}</td>
          <td>${pct(r.distribution_theoretical_recovery)}</td>
        </tr>
      `,
        )
        .join("")}
    </table>
  `;

  const findingsHtml =
    findings.length === 0
      ? "<p>注目すべき所見なし</p>"
      : `<ul class="findings">${findings.map((f) => `<li>${f}</li>`).join("")}</ul>`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>出目分布 価値測定レポート</title>
<style>${styles}</style>
</head>
<body>
<h1>出目分布 価値測定レポート</h1>
<p>生成: ${summary.generated_at}</p>

<div class="note">
  <b>近似に関する注記:</b> outcome_distribution は現スナップショット（過去90日集計）
  のみ保持しているため、評価期間内の各レース時点での分布ではなく、
  現スナップショットを全期間に適用しています。期間 ${config.period}日は
  この近似誤差が許容範囲となる目安として選定。
</div>

<h2>全体サマリ</h2>
${overallTable}

<h2>注目所見</h2>
${findingsHtml}

<h2>会場別（Lift 降順）</h2>
${venueTable}

<h2>モデル別</h2>
${modelTable}

<h2>1着艇別（分布カバレッジ）</h2>
${firstBoatTable}

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  console.log("=== 出目分布 価値測定 検証スクリプト ===");
  console.log(`実行日時: ${new Date().toISOString()}`);
  console.log(
    `設定: period=${args.period}日, top-n=${args.topN}, venue=${args.venue ?? "all"}, model=${args.model ?? "all"}, format=${args.formats.join(",")}`,
  );
  console.log("");
  console.log(
    "⚠️  近似: outcome_distribution は現スナップショットのみ保持のため、",
  );
  console.log("    現分布を評価期間内の全レースに適用する近似で計算します。");
  console.log("");

  if (!supabase) {
    console.error(
      "❌ Supabase が設定されていません（SUPABASE_SERVICE_KEY が必要）",
    );
    process.exit(1);
  }

  const config = {
    period: args.period,
    topN: args.topN,
    minSamples: args.minSamples,
    fromDate: getDateNDaysAgoJST(args.period),
    toDate: getTodayJST(),
  };

  // ===== Phase 1: データ取得 =====
  console.log("=== Phase 1: データ取得 ===");
  const distMap = await fetchOutcomeDistribution(args.venue);
  const raceResults = await fetchRaceResults(args.period, args.venue);
  const predictions = await fetchPredictions(
    args.period,
    args.venue,
    args.model,
  );

  if (raceResults.length === 0) {
    console.log("\n対象レースなし。終了。");
    return;
  }
  if (distMap.size === 0) {
    console.log(
      "\noutcome_distribution が空。先に scripts/daily/update-outcome-distribution.js を実行してください。",
    );
    return;
  }

  // ===== Phase 2: 照合 =====
  console.log("\n=== Phase 2: レース単位の照合 ===");
  const matched = buildMatchedRows({
    raceResults,
    predictions,
    distMap,
    topN: args.topN,
  });
  console.log(`  照合行数: ${matched.length}`);

  if (matched.length === 0) {
    console.log(
      "\n照合結果なし。predictions に該当データが存在するか確認してください。",
    );
    return;
  }

  // ===== Phase 3: 集計 =====
  console.log("\n=== Phase 3: 集計 ===");
  const overall = aggregate(matched);

  // 会場別
  const byVenueGroups = groupBy(matched, (r) => r.venue_code);
  const byVenueRows = [];
  for (const [venueCode, rows] of byVenueGroups) {
    const m = aggregate(rows);
    byVenueRows.push({
      venue_code: venueCode,
      venue_name: VENUE_NAMES[venueCode] || `会場${venueCode}`,
      ...m,
      verdict: verdict(m, args.minSamples),
    });
  }
  byVenueRows.sort((a, b) => b.lift_vs_ai_only - a.lift_vs_ai_only);

  // モデル別
  const byModelGroups = groupBy(matched, (r) => r.model_id);
  const byModelRows = [];
  for (const [modelId, rows] of byModelGroups) {
    byModelRows.push({ model_id: modelId, ...aggregate(rows) });
  }
  byModelRows.sort((a, b) => b.lift_vs_ai_only - a.lift_vs_ai_only);

  // 1着艇別（重複レースを除くため model_id を1つに絞る）
  const firstModel = byModelRows[0]?.model_id;
  const matchedSingleModel = firstModel
    ? matched.filter((r) => r.model_id === firstModel)
    : matched;
  const byFirstBoatGroups = groupBy(
    matchedSingleModel,
    (r) => r.first_boat_actual,
  );
  const byFirstBoatRows = [];
  for (const [firstBoat, rows] of byFirstBoatGroups) {
    byFirstBoatRows.push({ first_boat: firstBoat, ...aggregate(rows) });
  }
  byFirstBoatRows.sort((a, b) => a.first_boat - b.first_boat);

  // ===== Phase 4: 知見抽出 =====
  const findings = [];
  for (const r of byVenueRows) {
    if (r.verdict === "valuable") {
      findings.push(
        `${r.venue_name}(${String(r.venue_code).padStart(2, "0")}): AI∩分布で ${pct(r.ai_intersect_distribution_recovery)} 回収（単独AI: ${pct(r.ai_top_trifecta_recovery)}、+${(r.lift_vs_ai_only * 100).toFixed(1)}pt lift, n=${r.races}）— 採用候補`,
      );
    } else if (r.verdict === "promising" && r.races >= 50) {
      findings.push(
        `${r.venue_name}(${String(r.venue_code).padStart(2, "0")}): +${(r.lift_vs_ai_only * 100).toFixed(1)}pt lift（n=${r.races}）— 要追加検証`,
      );
    } else if (r.verdict === "harmful" && r.races >= 50) {
      findings.push(
        `${r.venue_name}(${String(r.venue_code).padStart(2, "0")}): lift ${(r.lift_vs_ai_only * 100).toFixed(1)}pt（n=${r.races}）— 採用すると悪化`,
      );
    }
  }
  if (overall.distribution_theoretical_recovery >= 1.0) {
    findings.push(
      `全体: 分布TopN${args.topN}の平等買いだけで回収率 ${pct(overall.distribution_theoretical_recovery)}（理論値、機械的買い）`,
    );
  }

  // ===== Phase 5: 出力 =====
  console.log("\n=== Phase 5: 出力 ===");
  ensureDir(args.outputDir);
  ensureDir(path.join(args.outputDir, "by-venue"));

  const summary = {
    generated_at: new Date().toISOString(),
    config: {
      period_days: args.period,
      from_date: config.fromDate,
      to_date: config.toDate,
      venue_filter: args.venue,
      model_filter: args.model,
      top_n: args.topN,
      min_samples: args.minSamples,
      include_trio: args.includeTrio,
    },
    approximation_note:
      "outcome_distribution は現スナップショットのみ保持。本評価は現分布を全期間に適用する近似値。",
    overall,
    by_model: byModelRows,
    by_venue: byVenueRows,
    by_first_boat: byFirstBoatRows,
    findings,
  };

  if (args.formats.includes("json")) {
    const p = path.join(args.outputDir, "summary.json");
    writeJson(p, summary);
    console.log(`  ✅ JSON: ${p}`);

    // 会場別 JSON も出力（venue フィルタなし時のみ）
    if (!args.venue) {
      for (const row of byVenueRows) {
        const vp = path.join(
          args.outputDir,
          "by-venue",
          `venue-${String(row.venue_code).padStart(2, "0")}.json`,
        );
        writeJson(vp, row);
      }
      console.log(`  ✅ by-venue: ${byVenueRows.length}件`);
    }
  }

  if (args.formats.includes("csv")) {
    const p = path.join(args.outputDir, "summary.csv");
    // 会場×モデルの組み合わせを行に展開
    const csvRows = [];
    for (const v of byVenueRows) {
      const venueModelGroups = groupBy(
        matched.filter((r) => r.venue_code === v.venue_code),
        (r) => r.model_id,
      );
      for (const [modelId, rows] of venueModelGroups) {
        const m = aggregate(rows);
        csvRows.push({
          venue_code: String(v.venue_code).padStart(2, "0"),
          venue_name: v.venue_name,
          model_id: modelId,
          races: m.races,
          dist_hit_rate: m.distribution_hit_rate,
          dist_recovery: m.distribution_theoretical_recovery,
          ai_hit_rate: m.ai_top_trifecta_hit_rate,
          ai_recovery: m.ai_top_trifecta_recovery,
          intersect_hit_rate: m.ai_intersect_distribution_hit_rate,
          intersect_recovery: m.ai_intersect_distribution_recovery,
          lift: m.lift_vs_ai_only,
          verdict: verdict(m, args.minSamples),
        });
      }
    }
    writeCsv(p, csvRows);
    console.log(`  ✅ CSV: ${p} (${csvRows.length}行)`);
  }

  if (args.formats.includes("html")) {
    const p = path.join(args.outputDir, "report.html");
    const html = renderHtml({
      summary,
      byVenueRows,
      byModelRows,
      byFirstBoatRows,
      findings,
      config,
    });
    fs.writeFileSync(p, html);
    console.log(`  ✅ HTML: ${p}`);
  }

  // ===== コンソール最終サマリ =====
  console.log("\n=== 全体サマリ ===");
  console.log(`  対象レース数(行): ${overall.races}`);
  console.log(`  分布TopN 的中率: ${pct(overall.distribution_hit_rate)}`);
  console.log(
    `  分布TopN 回収率: ${pct(overall.distribution_theoretical_recovery)}`,
  );
  console.log(`  AI 単独 回収率: ${pct(overall.ai_top_trifecta_recovery)}`);
  console.log(
    `  AI ∩ 分布 回収率: ${pct(overall.ai_intersect_distribution_recovery)}`,
  );
  console.log(`  Lift: ${(overall.lift_vs_ai_only * 100).toFixed(1)}pt`);
  if (findings.length > 0) {
    console.log("\n注目所見:");
    for (const f of findings.slice(0, 10)) console.log(`  - ${f}`);
    if (findings.length > 10) console.log(`  ... 他 ${findings.length - 10}件`);
  }
  console.log("\n=== 完了 ===");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  console.error(err.stack);
  process.exit(1);
});
