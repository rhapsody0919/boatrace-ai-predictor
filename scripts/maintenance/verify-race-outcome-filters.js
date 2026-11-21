/**
 * verify-race-outcome-filters.js - 不成立のレースを集計から外す判定を race_status に統一したこと（BOA-545）の検証。
 * DBにも取得先にも接続しない。
 *
 *   (a) isNoRaceResult: race_status='no_race' だけが不成立。NULL（078以前・未判定）・normal・partial_refund は不成立でない
 *   (b) NOT_NO_RACE_FILTER: PostgREST の条件が「race_status が NULL、または no_race 以外」（078 の IS DISTINCT FROM）
 *   (c) 再発防止: scripts/daily・scripts/lib と、日次で動く aggregate-racer-stats.js・保守用の update-venue-stats.js のコードが、旧フラグ is_no_race（全行 false で機能していない）を条件に使わない
 *       （コメントでの言及と、過去分の取り込みの書き込み kbResultsBackfillRows.js は除く）
 *   (d) 置き換えた集計（6本のクエリ）が、共通の条件 NOT_NO_RACE_FILTER を使う
 *   (e) placedRanks: 返還艇（refund_boats）の位置は着順の艇なし（null）。完走した艇の着順は詰めない（BOA-579）
 *   (f) 選手のコース別2連対率・3連対率（aggregate-racer-stats.js）と会場×枠番の2連対率・3連対率
 *       （calculate-venue-grade-stats.js）が、refund_boats を読み、placedRanks を通して数える（BOA-579）。
 *       本文の字は読まず、偽の DB（verifyData/aggregate-racer-stats-fake-db.js）で集計を回し、書いた値と問い合わせた列で見る
 *
 * 実行: node scripts/maintenance/verify-race-outcome-filters.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOT_NO_RACE_FILTER,
  isNoRaceResult,
  placedRanks,
} from "../lib/raceOutcomeFilters.js";
import { getDateDaysAgo } from "../lib/dateUtils.js";
import {
  fakeDb,
  loadAggregateRacerStats,
  loadVenueGradeStats,
  chainsOf,
  quietly,
} from "./verifyData/aggregate-racer-stats-fake-db.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

check(
  "(a) race_status='no_race' だけが不成立（NULL・normal・partial_refund・行なしは不成立でない）",
  isNoRaceResult({ race_status: "no_race" }) &&
    !isNoRaceResult({ race_status: null }) &&
    !isNoRaceResult({ race_status: "normal" }) &&
    !isNoRaceResult({ race_status: "partial_refund" }) &&
    !isNoRaceResult({ is_no_race: true }) &&
    !isNoRaceResult(null),
);
check(
  "(b) PostgREST の条件は「race_status が NULL、または no_race 以外」",
  NOT_NO_RACE_FILTER === "race_status.is.null,race_status.neq.no_race",
  NOT_NO_RACE_FILTER,
);

// (c) コード（コメントを除く）に is_no_race が残っていないか
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ALLOWED = new Set(["scripts/lib/kbResultsBackfillRows.js"]); // 過去分の取り込みで false を書くだけ（読まない）
const offenders = [];
// scripts/analysis 配下でも、日次の本番ジョブが実行するもの（aggregate-stats.yml）と、保守用の集計は対象に含める
for (const rel of [
  "scripts/analysis/aggregate-racer-stats.js",
  "scripts/maintenance/update-venue-stats.js",
]) {
  if (
    /is_no_race/.test(
      stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8")),
    )
  )
    offenders.push(rel);
}
for (const dir of ["scripts/daily", "scripts/lib"]) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    if (!name.endsWith(".js")) continue;
    // 他の検証が変異検証のために一時的に書くファイル（*.__mutant*.js）は対象外。並行して実行すると、読む前に
    // 消えて ENOENT になる（CI の verify:ci で実際に起きた）
    if (name.includes(".__mutant")) continue;
    const rel = `${dir}/${name}`;
    if (ALLOWED.has(rel)) continue;
    const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    if (/is_no_race/.test(code)) offenders.push(rel);
  }
}
check(
  "(c) scripts/daily・scripts/lib のコードが is_no_race を使わない",
  offenders.length === 0,
  offenders.join(", "),
);

// (d) 置き換えた6本が共通の条件を使う
const QUERY_FILES = [
  "update-exhibition-time-top-stats",
  "update-losing-technique-stats",
  "update-nige-outcome-distribution",
  "update-outcome-distribution",
  "update-top-start-stats",
  "update-winning-technique-stats",
];
const missing = QUERY_FILES.filter(
  (f) =>
    !fs
      .readFileSync(path.join(ROOT, `scripts/daily/${f}.js`), "utf8")
      .includes(".or(NOT_NO_RACE_FILTER)"),
);
check(
  "(d) 置き換えた6本の集計が .or(NOT_NO_RACE_FILTER) で不成立を外す",
  missing.length === 0,
  missing.join(", "),
);

// (e) 2026-09-04-11-09: 完走は4・5号艇だけ。DB は 4-5-1 で、1号艇は F（返還）
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
check(
  "(e) 返還艇の位置は null（4-5-1・1号艇F → 4-5-なし）。返還なし・refund_boats が NULL なら元のまま",
  same(placedRanks({ rank1: 4, rank2: 5, rank3: 1, refund_boats: [1] }), {
    rank1: 4,
    rank2: 5,
    rank3: null,
  }) &&
    same(placedRanks({ rank1: 1, rank2: 4, rank3: 2, refund_boats: [6] }), {
      rank1: 1,
      rank2: 4,
      rank3: 2,
    }) &&
    same(placedRanks({ rank1: 3, rank2: 1, rank3: 2, refund_boats: null }), {
      rank1: 3,
      rank2: 1,
      rank3: 2,
    }) &&
    same(placedRanks({ rank1: 2, rank2: 6, rank3: 3, refund_boats: [6, 3] }), {
      rank1: 2,
      rank2: null,
      rank3: null,
    }),
);

// (f) 2連対率・3連対率の集計を偽の DB で回す（本文の字は読まない）。返還艇が表の行順で2着・3着に入ったレースで、
//     返還艇を2連対・3連対に数えない（placedRanks を通す）こと、結果の取得が refund_boats を読むことを見る
const RECENT = getDateDaysAgo(10);
const refunded = (race_id, ranks, refund_boats) => ({
  race_id,
  ...ranks,
  is_cancelled: false,
  race_status: "partial_refund",
  refund_boats,
  winning_technique: "逃げ",
  payout_trio: 1000,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].flatMap((n) => [
      [`course_${n}`, n],
      [`actual_course_${n}`, n],
    ]),
  ),
});
// 1レース目: 1号艇F（返還）が3着の位置（4-5-1）。2レース目: 2号艇F（返還）が2着の位置（1-2-3）
const RACE_A = `${RECENT}-11-09`;
const RACE_B = `${RECENT}-11-10`;
const selectsOf = (scene, table) =>
  chainsOf(scene, table).flatMap((c) =>
    c.filter((q) => q.method === "select").map((q) => String(q.args[0])),
  );
{
  const RACER = 4203;
  const db = fakeDb({
    tables: {
      race_entries: [
        { race_id: RACE_A, boat_number: 1, racer_id: RACER },
        { race_id: RACE_B, boat_number: 2, racer_id: RACER },
      ],
      race_results: [
        refunded(RACE_A, { rank1: 4, rank2: 5, rank3: 1 }, [1]),
        refunded(RACE_B, { rank1: 1, rank2: 2, rank3: 3 }, [2]),
      ],
      race_start_timings: [],
      racer_aggregated_stats: [],
    },
  });
  const { runSingleRacer } = await loadAggregateRacerStats();
  await quietly(() => runSingleRacer(RACER, null, false));
  const counts = db.writes.find((w) => w.table === "racer_aggregated_stats")
    ?.rows?.[0]?.course_race_counts;
  check(
    "(f) 選手のコース別2連対率・3連対率（aggregate-racer-stats.js）: 返還艇は2着・3着の位置にいても2連対・3連対に数えない。結果の取得が refund_boats を読む",
    same(counts, {
      1: { total: 1, wins: 0, top2: 0, top3: 0 },
      2: { total: 1, wins: 0, top2: 0, top3: 0 },
    }) && selectsOf(db, "race_results").some((s) => /\brefund_boats\b/.test(s)),
    JSON.stringify(counts),
  );
}
{
  const race = (race_id, ranks, refund_boats) => ({
    race_id,
    race_date: race_id.slice(0, 10),
    venue_code: 11,
    race_grade: "SG",
    race_results: [refunded(race_id, ranks, refund_boats)],
  });
  const db = fakeDb({
    tables: {
      races: [
        race(RACE_A, { rank1: 4, rank2: 5, rank3: 1 }, [1]),
        race(RACE_B, { rank1: 1, rank2: 2, rank3: 3 }, [2]),
      ],
      venue_grade_boat_stats: [],
    },
  });
  const { calculateVenueGradeStats } = await loadVenueGradeStats();
  await quietly(() => calculateVenueGradeStats());
  const rows = db.writes
    .filter((w) => w.table === "venue_grade_boat_stats")
    .flatMap((w) => w.rows);
  const cell = (boat) => {
    const r = rows.find((x) => x.boat_number === boat);
    return r && [r.race_count, r.wins, r.top2, r.top3];
  };
  check(
    "(f) 会場×枠番の2連対率・3連対率（calculate-venue-grade-stats.js）: 返還艇（A の1号艇・B の2号艇）は2連対・3連対に数えない。完走した艇は数える。結果の取得が refund_boats を読む",
    same([1, 2, 3, 4, 5].map(cell), [
      [2, 1, 1, 1],
      [2, 0, 0, 0],
      [2, 0, 0, 1],
      [2, 1, 1, 1],
      [2, 0, 1, 1],
    ]) && selectsOf(db, "races").some((s) => /\brefund_boats\b/.test(s)),
    JSON.stringify([1, 2, 3, 4, 5].map(cell)),
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
