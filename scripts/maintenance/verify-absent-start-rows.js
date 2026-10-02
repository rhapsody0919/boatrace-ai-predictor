/**
 * verify-absent-start-rows.js - race_start_timings の欠場艇の行（finish_mark='欠'、start_timing は NULL）を、
 * 読み手が出走・ST として数えないことの検証。DBにも取得先にも接続しない。
 *
 * 欠場艇にも行がある（2026-09-21 以降の結果ページの取得。過去分は K からの補完で足す予定）。行の有無や ST の
 * NULL をそのまま扱う読み手が、欠場を出走に数えたり、NULL を 0 として計算に混ぜたりしていた。
 *
 *   (a) stDeviation（展示STと本番STのズレ。supabaseDataService の getStDeviationTrend・getRaceStPredictabilityBreakdown）:
 *       どちらかが NULL なら null（Math.abs(null - 0.12) = 0.12 を混ぜない）
 *   (b) computeRacerStStats（racer_aggregated_stats の total_races・flying_rate）: 出走回数は公式の定義（成績コードの
 *       01〜06・F・L1・K1・S1・S2）。成績コードが NULL の行は着欄で判定し、欠場だけを除く
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
import { computeRacerStStats, countsAsStart } from "../lib/racerStStats.js";
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

// (b) 選手のST統計: 出走回数は公式の定義（成績コードの 01〜06・F・L1・K1・S1・S2。S0・L0・K0 と 00 は数えない）。
//     成績コードが NULL の行は着欄で判定し、欠場だけを除く
{
  const t = (d, code, mark, st, fly = false) => ({
    race_id: `2026-06-${String(d).padStart(2, "0")}-12-01`,
    boat_number: 1,
    start_timing: st,
    is_flying: fly,
    finish_mark: mark,
    official_finish_code: code,
  });
  const timings = [
    t(1, "02", "2", "0.15"),
    t(2, "F", "F", "0.03", true),
    t(3, "K1", "欠", null), // 選手責任の欠場: 数える
    t(4, "K0", "欠", null), // 責任外の欠場: 数えない
    t(5, "L1", "L", null), // 選手責任の出遅れ: 数える
    t(6, "L0", "L", null), // 責任外の出遅れ: 数えない
    t(7, "S1", "転", "0.20"), // 選手責任の失格: 数える
    t(8, "S0", "落", "0.10"), // 責任外の失格: 数えない
    t(9, null, "欠", null), // 成績コードが未同期: 着欄で判定（欠場は数えない）
    t(10, null, "3", "0.12"), // 成績コードが未同期: 着欄で判定（数える）
  ];
  const entries = timings.map(({ race_id, boat_number }) => ({
    race_id,
    boat_number,
  }));
  const s = computeRacerStStats(entries, timings);
  check(
    "(b) computeRacerStStats: 出走は 02・F・K1・L1・S1・（未同期の3着）の6走。K0・L0・S0・（未同期の欠場）は数えない。F率は 1/6",
    s.total_races === 6 && s.flying_rate === 0.1667,
    show(s),
  );
  check(
    "(b) countsAsStart: 公式の出走の成績コード（01〜06・F・L1・K1・S1・S2）だけ true。00・S0・L0・K0 は false。NULL は着欄で「欠」だけ false",
    ["01", "06", "F", "L1", "K1", "S1", "S2"].every((c) =>
      countsAsStart({ official_finish_code: c }),
    ) &&
      ["00", "S0", "L0", "K0"].every(
        (c) => !countsAsStart({ official_finish_code: c }),
      ) &&
      !countsAsStart({ official_finish_code: null, finish_mark: "欠" }) &&
      countsAsStart({ official_finish_code: null, finish_mark: null }),
  );
  const onlyK0 = computeRacerStStats(entries.slice(3, 4), timings);
  check(
    "(b) 責任外の欠場だけの選手は、統計なし（null。出走0）",
    onlyK0 === null,
    show(onlyK0),
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
