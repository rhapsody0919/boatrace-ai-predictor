/**
 * aggregate-racer-stats.js（racer_aggregated_stats の日次集計）の取得・書き込み・起動の規則を守る（BOA-600）。
 *
 * 集計の本体を、偽の DB（verifyData/aggregate-racer-stats-fake-db.js。supabaseClient.js だけを写しに差し替え、
 * 問い合わせと upsert を記録する）で runSingleRacer を回し、振る舞いで見る。実 DB に触らない。
 *
 * 1. 取得エラーを握りつぶさない。以前は race_results の取得エラーで `continue` し、
 *    一部のレースだけで集計した分布をそのまま保存していた → race_results の読みが失敗したら例外で止まり、何も書かない
 * 2. race_entries は fetchRacerEntries（ページング・例外。BOA-581）を通す。以前は4つの集計関数が
 *    .range() 無しで取り、1000行の上限で黙って切れる・エラーで null（データなし）になる作りだった → 全部の問い合わせに range と racer_id の eq
 * 3. 書き込みは upsertChangedRows（変わった行だけ）。以前は1日2回、全行を無条件に UPDATE していた
 *    → 書く前に既存行を読み、既存行が calculated_at だけ違えば upsert しない
 * 4. aggregate-stats.yml は cron-job.org の workflow_dispatch だけで起動する（schedule を残すと
 *    3〜4時間遅れて同じ集計がもう一度走る）
 * 5. 枠番別の出走数（course_race_counts）は直近1年（BOA-824）。以前は全期間で、画面の注記と食い違っていた
 *    → 364日前の出走は数え、366日前の出走は数えない
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDateDaysAgo } from "../lib/dateUtils.js";
import {
  fakeDb,
  loadAggregateRacerStats,
  chainsOf,
  methodsOf,
  quietly,
} from "./verifyData/aggregate-racer-stats-fake-db.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/aggregate-stats.yml"),
  "utf8",
);

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures.push(label);
};

const RACER = 4203;
const recent = `${getDateDaysAgo(364)}-01-01`; // 直近1年の内
const old = `${getDateDaysAgo(366)}-01-01`; // 直近1年の外
const result = (race_id, rank1) => ({
  race_id,
  rank1,
  rank2: rank1 === 1 ? 2 : 1,
  rank3: 3,
  is_cancelled: false,
  race_status: "normal",
  refund_boats: null,
  winning_technique: "逃げ",
  course_1: 1,
  course_2: 2,
  course_3: 3,
  course_4: 4,
  course_5: 5,
  course_6: 6,
  actual_course_1: 1,
  actual_course_2: 2,
  actual_course_3: 3,
  actual_course_4: 4,
  actual_course_5: 5,
  actual_course_6: 6,
});
const tables = (existing = []) => ({
  race_entries: [
    { race_id: recent, boat_number: 1, racer_id: RACER },
    { race_id: old, boat_number: 2, racer_id: RACER },
  ],
  race_results: [result(recent, 1), result(old, 2)],
  race_start_timings: [],
  racer_aggregated_stats: existing,
});

const { runSingleRacer } = await loadAggregateRacerStats();

// 正常: 全会場の1行を集計して書く
const db = fakeDb({ tables: tables() });
await quietly(() => runSingleRacer(RACER, null, false));
const written = db.writes.filter((w) => w.table === "racer_aggregated_stats");
const record = written[0]?.rows?.[0];

// 失敗: race_results の読みが落ちたら止まり、何も書かない
const failing = fakeDb({ tables: tables(), fail: ["race_results"] });
let threw = null;
await quietly(() => runSingleRacer(RACER, null, false)).catch((e) => {
  threw = e;
});

// 変わらない行: 既存行が calculated_at だけ違えば書かない
const unchanged = fakeDb({
  tables: tables(
    record ? [{ ...record, calculated_at: "2000-01-01T00:00:00.000Z" }] : [],
  ),
});
await quietly(() => runSingleRacer(RACER, null, false));

check(
  "取得エラーを console.error して continue で飛ばす箇所が無い",
  threw instanceof Error &&
    /race_results/.test(threw.message) &&
    failing.writes.length === 0,
);
const entryChains = chainsOf(db, "race_entries");
check(
  "race_entries を集計関数の中で直接 .from() で取らない（fetchRacerEntries を通す）",
  entryChains.length > 0 &&
    entryChains.every((c) => {
      const m = methodsOf(c);
      return (
        m.has("range") &&
        c.some((q) => q.method === "eq" && q.args[0] === "racer_id") &&
        c.some(
          (q) => q.method === "select" && q.args[0] === "race_id, boat_number",
        )
      );
    }),
);
const resultChains = chainsOf(db, "race_results");
check(
  "race_results の取得は fetchAll（throwOnError）を通す",
  resultChains.length > 0 &&
    resultChains.every(
      (c) =>
        methodsOf(c).has("range") &&
        c.some((q) => q.method === "in" && q.args[0] === "race_id"),
    ) &&
    threw instanceof Error,
);
const statChains = chainsOf(db, "racer_aggregated_stats");
const upsertAt = db.queries.findIndex((q) => q.method === "upsert");
const selectAt = db.queries.findIndex(
  (q) => q.table === "racer_aggregated_stats" && q.method === "select",
);
check(
  "racer_aggregated_stats への書き込みは upsertChangedRows を通し、calculated_at を比較から外す",
  written.length === 1 &&
    record?.racer_id === RACER &&
    record?.venue_code === 0 &&
    written[0].options?.onConflict === "racer_id,venue_code" &&
    statChains.length >= 2 &&
    selectAt >= 0 &&
    selectAt < upsertAt &&
    unchanged.writes.length === 0,
);
check(
  "aggregate-stats.yml に schedule が無い（cron-job.org の dispatch だけで起動）",
  !/^\s*schedule:/m.test(workflow) && /workflow_dispatch:/.test(workflow),
);
check(
  "枠番別の出走数（course_race_counts）は直近365日で数える（データ出走表の「枠番勝率（直近1年）」、BOA-824）",
  JSON.stringify(record?.course_race_counts) ===
    JSON.stringify({ 1: { total: 1, wins: 1, top2: 1, top3: 1 } }),
);

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
