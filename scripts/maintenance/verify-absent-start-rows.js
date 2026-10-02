/**
 * verify-absent-start-rows.js - race_start_timings の欠場艇の行（finish_mark='欠'、start_timing は NULL）を、
 * 読み手が出走・ST として数えないことの検証。DBにも取得先にも接続しない。
 *
 * 欠場艇にも行がある（2026-09-21 以降の結果ページの取得。過去分は K からの補完で足す予定）。行の有無や ST の
 * NULL をそのまま扱う読み手が、欠場を出走に数えたり、NULL を 0 として計算に混ぜたりしていた。
 *
 *   (a) stDeviation（展示STと本番STのズレ。supabaseDataService の getStDeviationTrend・getRaceStPredictabilityBreakdown）:
 *       どちらかが NULL なら null（Math.abs(null - 0.12) = 0.12 を混ぜない）
 *   (b) computeRacerStStats（racer_aggregated_stats の total_races・flying_rate）: 欠場を出走に数えない。L は数える
 *   (c) aggregateTopStarts（top_start_stats）: 欠場を参加数に入れない。ST が NULL の行があっても、そのレースの
 *       トップスタートを消さない（Math.min が null を 0 とみなしていた）
 *   (d) 分析・検証のスクリプト（得点率の配点の検証）: 行の有無だけで出走を判定せず、「欠」を除く
 *
 * 実行: node scripts/maintenance/verify-absent-start-rows.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stDeviation } from "../../src/utils/stDeviation.js";
import { computeRacerStStats } from "../lib/racerStStats.js";
import { aggregateTopStarts } from "../daily/update-top-start-stats.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

// (a) 展示STと本番STのズレ
check(
  "(a) stDeviation: 両方あれば |本番 − 展示|。どちらかが NULL・undefined なら null（欠場艇の行・展示STの無い走）",
  Math.abs(stDeviation(0.15, 0.1) - 0.05) < 1e-9 &&
    Math.abs(stDeviation("0.12", "0.20") - 0.08) < 1e-9 &&
    stDeviation(null, 0.12) === null &&
    stDeviation(0.12, null) === null &&
    stDeviation(undefined, 0.12) === null &&
    stDeviation(null, null) === null,
  show([stDeviation(null, 0.12), stDeviation(null, null)]),
);

// (b) 選手のST統計
{
  const entries = [1, 2, 3, 4].map((d) => ({
    race_id: `2026-06-0${d}-12-01`,
    boat_number: 1,
  }));
  const timings = [
    {
      race_id: "2026-06-01-12-01",
      boat_number: 1,
      start_timing: "0.15",
      is_flying: false,
      finish_mark: "2",
    },
    {
      race_id: "2026-06-02-12-01",
      boat_number: 1,
      start_timing: "0.03",
      is_flying: true,
      finish_mark: "F",
    },
    // 欠場: 出走に数えない
    {
      race_id: "2026-06-03-12-01",
      boat_number: 1,
      start_timing: null,
      is_flying: false,
      finish_mark: "欠",
    },
    // 出遅れ: 出走には数える（ST は NULL なので平均には入らない）
    {
      race_id: "2026-06-04-12-01",
      boat_number: 1,
      start_timing: null,
      is_flying: false,
      finish_mark: "L",
    },
  ];
  const s = computeRacerStStats(entries, timings);
  check(
    "(b) computeRacerStStats: 欠場を除いた3走（F・L は含む）。F率の分母も3。平均STは F・L・欠場を除いた 0.15",
    s.total_races === 3 && s.flying_rate === 0.3333 && s.avg_st === 0.15,
    show(s),
  );
  const onlyAbsent = computeRacerStStats(entries.slice(2, 3), timings);
  check(
    "(b) 欠場だけの選手は、統計なし（null。出走0）",
    onlyAbsent === null,
    show(onlyAbsent),
  );
}

// (c) トップスタート
{
  const rid = "2026-07-01-04-05"; // 平和島
  const rows = [
    {
      race_id: rid,
      boat_number: 1,
      start_timing: 0.12,
      is_flying: false,
      finish_mark: "1",
    },
    {
      race_id: rid,
      boat_number: 2,
      start_timing: 0.08,
      is_flying: false,
      finish_mark: "3",
    },
    {
      race_id: rid,
      boat_number: 3,
      start_timing: null,
      is_flying: false,
      finish_mark: "欠",
    },
    {
      race_id: rid,
      boat_number: 4,
      start_timing: null,
      is_flying: false,
      finish_mark: "L",
    },
    {
      race_id: rid,
      boat_number: 5,
      start_timing: 0.02,
      is_flying: true,
      finish_mark: "F",
    },
    {
      race_id: rid,
      boat_number: 6,
      start_timing: 0.15,
      is_flying: false,
      finish_mark: "2",
    },
  ];
  const recs = aggregateTopStarts(rows, [{ race_id: rid, rank1: 2 }]);
  const byBoat = new Map(recs.map((r) => [r.boat_number, r]));
  check(
    "(c) aggregateTopStarts: ST が NULL の行（出遅れ）があっても、最速の2号艇（0.08）をトップスタートにする。2号艇は1着",
    byBoat.get(2)?.top_start_count === 1 &&
      byBoat.get(2)?.win_count_when_top_start === 1,
    show(byBoat.get(2)),
  );
  check(
    "(c) 欠場（3号艇）は参加数に入れない。出遅れ（4号艇）とF（5号艇）は参加数に入れる",
    !byBoat.has(3) &&
      byBoat.get(4)?.race_count === 1 &&
      byBoat.get(5)?.race_count === 1,
    show(recs.map((r) => [r.boat_number, r.race_count])),
  );
}

// (d) 分析・検証のスクリプト
{
  const files = [
    "scripts/analysis/series-points-scoring-hypotheses.mjs",
    "scripts/verification/verify-series-points-border.mjs",
    "scripts/verification/verify-series-points-needed.mjs",
  ];
  const bad = files.filter((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    return !(
      /race_id, boat_number, finish_mark/.test(src) &&
      /\.filter\(\(r\) => r\.finish_mark !== "欠"\)[\s\S]{0,80}startedKeys|startedKeys = new Set\([\s\S]{0,80}\.filter\(\(r\) => r\.finish_mark !== "欠"\)/.test(
        src,
      )
    );
  });
  check(
    "(d) 得点率の配点の検証スクリプト3本が、finish_mark を読み、「欠」を出走（startedKeys）から除く",
    bad.length === 0,
    bad.join(", "),
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
