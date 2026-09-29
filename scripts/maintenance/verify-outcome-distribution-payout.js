/**
 * verify-outcome-distribution-payout.js - 3連単・3連複の配当の列の取り違えの検証（BOA-535）
 *
 * race_results の列名は中身と逆（payout_trio = 3連単、payout_trifecta = 3連複。
 * docs/db-migration/079_race_payouts.sql:29）。2026-09-29 まで、出目分布・逃げ成功時分布の日次集計が
 * 3連単のパターンの平均配当に payout_trifecta（3連複）を足していて、画面の「3連単」の平均配当に3連複の値が出ていた。
 * ルールの追跡（daily-rule-tracking.js）は、3連複（順不同）の判定に payout_trio（3連単）の配当を使っていた。
 *
 * DBにも取得先にも接続しない（実データのフィクスチャと、純粋関数だけ）。
 *
 * 確認すること:
 *   (a) 出目分布の集計（scripts/lib/outcomeDistribution.js）が、実データ（江戸川 2026-07-01〜09-28 の456レース）で、
 *       本番の SQL で独立に出した3連単の平均配当と一致する（3連複の平均ではない）
 *   (b) 逃げで決まったレースだけに絞っても同じ（update-nige-outcome-distribution.js の対象）
 *   (c) 配当の無いレース（不成立等）は、平均の分母に入れない
 *   (d) 日次の2本が、3連単の列（TRIFECTA_PAYOUT_COLUMN）を select している
 *   (e) ルールの追跡: 3連複（betType 'trio'）の的中の払戻は payout_trifecta（3連複）
 *   (f) 変異検証: 3連複の列で集計する版・分母に配当の無いレースを入れる版で、上の検証が失敗する
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRIFECTA_PAYOUT_COLUMN,
  aggregateOutcomeDistribution,
} from "../lib/outcomeDistribution.js";
import { calculatePayout } from "../daily-rule-tracking.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

// 実データ: [race_id, rank1, rank2, rank3, payout_trifecta(=3連複), payout_trio(=3連単), winning_technique]
const rows = JSON.parse(
  fs.readFileSync(
    path.join(
      ROOT,
      "scripts/lib/__fixtures__/outcomeDistribution/edogawa-2026-07-01_09-28.json",
    ),
  ),
).map(
  ([
    race_id,
    rank1,
    rank2,
    rank3,
    payout_trifecta,
    payout_trio,
    winning_technique,
  ]) => ({
    race_id,
    rank1,
    rank2,
    rank3,
    payout_trifecta,
    payout_trio,
    winning_technique,
  }),
);

// 期待値: 本番の SQL で独立に出した値（2026-09-29、同じ期間・会場）
//   select rank1||'-'||rank2||'-'||rank3, count(*), round(avg(payout_trio)), round(avg(payout_trifecta))
//   from race_results where race_id >= '2026-07-01' and race_id < '2026-09-29' and split_part(race_id,'-',4)='03' group by 1
const EXPECTED = {
  all: {
    "1-2-3": { count: 22, trifecta3tan: 1181, trio3fuku: 397 },
    "1-3-2": { count: 26, trifecta3tan: 1805, trio3fuku: 475 },
    "2-1-3": { count: 12, trifecta3tan: 2445, trio3fuku: 432 },
  },
  nige: {
    "1-2-3": { count: 19, trifecta3tan: 1213 },
    "1-3-2": { count: 24, trifecta3tan: 1894 },
  },
};
const TODAY = "2026-09-29";
const find = (records, key) => {
  const [a, b, c] = key.split("-").map(Number);
  return records.find(
    (r) => r.first_boat === a && r.second_boat === b && r.third_boat === c,
  );
};

/** 観測: 全レースの集計が、3連単の平均配当・件数と一致する */
function allMatchesTrifecta(aggregate = aggregateOutcomeDistribution) {
  const records = aggregate(rows, { today: TODAY })[3] ?? [];
  return Object.entries(EXPECTED.all).every(([key, e]) => {
    const r = find(records, key);
    return r && r.count_90days === e.count && r.avg_payout === e.trifecta3tan;
  });
}
/** 観測: 逃げだけに絞った集計が、3連単の平均配当・件数と一致する */
function nigeMatchesTrifecta(aggregate = aggregateOutcomeDistribution) {
  const nige = rows.filter((r) => r.winning_technique === "逃げ");
  const records = aggregate(nige, { today: TODAY })[3] ?? [];
  return Object.entries(EXPECTED.nige).every(([key, e]) => {
    const r = find(records, key);
    return r && r.count_90days === e.count && r.avg_payout === e.trifecta3tan;
  });
}
/** 観測: 配当の無いレースは平均の分母に入れない（件数・出現率には数える） */
function missingPayoutExcluded(aggregate = aggregateOutcomeDistribution) {
  const synthetic = [
    {
      race_id: "2026-09-01-03-01",
      rank1: 1,
      rank2: 2,
      rank3: 3,
      payout_trio: 1000,
    },
    {
      race_id: "2026-09-01-03-02",
      rank1: 1,
      rank2: 2,
      rank3: 3,
      payout_trio: 2000,
    },
    {
      race_id: "2026-09-01-03-03",
      rank1: 1,
      rank2: 2,
      rank3: 3,
      payout_trio: null,
    },
    {
      race_id: "2026-09-01-03-04",
      rank1: 4,
      rank2: 5,
      rank3: 6,
      payout_trio: null,
    },
  ];
  const records = aggregate(synthetic, { today: TODAY })[3] ?? [];
  const a = find(records, "1-2-3");
  const b = find(records, "4-5-6");
  return (
    a?.count_90days === 3 &&
    a?.avg_payout === 1500 &&
    a?.probability === 75 &&
    b?.avg_payout === 0 &&
    a?.total_races === 4
  );
}

{
  // 前提: フィクスチャの2列は、名前と中身が逆（3連単 > 3連複 のレースがほぼ全て）
  const both = rows.filter(
    (r) => r.payout_trio != null && r.payout_trifecta != null,
  );
  const trioLarger = both.filter(
    (r) => r.payout_trio > r.payout_trifecta,
  ).length;
  check(
    "前提: 実データ（江戸川 456レース）の payout_trio（3連単）は、ほぼ全てのレースで payout_trifecta（3連複）より大きい",
    rows.length === 456 && trioLarger / both.length > 0.99,
    show({ rows: rows.length, both: both.length, trioLarger }),
  );
  check(
    "集計に使う列は payout_trio（3連単）",
    TRIFECTA_PAYOUT_COLUMN === "payout_trio",
  );
  check(
    "(a) 出目分布: 江戸川の 1-2-3・1-3-2・2-1-3 の件数と平均配当が、本番の SQL で出した3連単の平均（1,181・1,805・2,445円）と一致する",
    allMatchesTrifecta(),
    show(
      ["1-2-3", "1-3-2", "2-1-3"].map((k) =>
        find(aggregateOutcomeDistribution(rows, { today: TODAY })[3], k),
      ),
    ),
  );
  check(
    "(b) 逃げ成功時分布: 逃げに絞った 1-2-3・1-3-2 の平均配当が、3連単の平均（1,213・1,894円）と一致する",
    nigeMatchesTrifecta(),
  );
  check(
    "(c) 配当の無いレースは平均の分母に入れない（1,000円と2,000円と無し → 1,500円。件数・出現率には数える）",
    missingPayoutExcluded(),
  );
  const records = aggregateOutcomeDistribution(rows, { today: TODAY })[3];
  check(
    "集計の行: 出現率の合計が100%前後、last_updated は渡した日付、total_races は456",
    Math.abs(records.reduce((s, r) => s + r.probability, 0) - 100) < 1 &&
      records.every((r) => r.last_updated === TODAY && r.total_races === 456),
  );
}

{
  // (d) 日次の2本が、3連単の列を select し、共通の集計を使う
  for (const file of [
    "scripts/daily/update-outcome-distribution.js",
    "scripts/daily/update-nige-outcome-distribution.js",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    check(
      `(d) ${file}: 3連単の列（TRIFECTA_PAYOUT_COLUMN）を select し、共通の集計（aggregateOutcomeDistribution）を使う。payout_trifecta を読まない`,
      src.includes("${TRIFECTA_PAYOUT_COLUMN}") &&
        src.includes("aggregateOutcomeDistribution(") &&
        !src.includes("payout_trifecta"),
    );
  }
}

{
  // (e) ルールの追跡: 3連複（順不同）の的中の払戻は payout_trifecta（3連複）
  const pred = { top_pick: 2, top_2nd: 1, top_3rd: 3 };
  const result = {
    rank1: 1,
    rank2: 2,
    rank3: 3,
    payout_trifecta: 380,
    payout_trio: 1010,
  };
  const hit = calculatePayout(pred, result, "trio");
  const miss = calculatePayout(
    { top_pick: 4, top_2nd: 5, top_3rd: 6 },
    result,
    "trio",
  );
  check(
    "(e) ルールの追跡: 3連複（betType 'trio'。順不同）の的中の払戻は payout_trifecta（3連複 380円）。外れは0",
    hit.hit === true &&
      hit.payout === 380 &&
      miss.hit === false &&
      miss.payout === 0,
    show({ hit, miss }),
  );
}

{
  // (f) 変異検証
  const withColumn = (column) => (results, options) =>
    aggregateOutcomeDistribution(
      results.map((r) => ({ ...r, payout_trio: r[column] })),
      options,
    );
  const countMissingAsZero = (results, options) =>
    aggregateOutcomeDistribution(
      results.map((r) => ({ ...r, payout_trio: r.payout_trio ?? 0 })),
      options,
    );
  check(
    "変異検証の前提: 正しい実装は (a)(b)(c) に合格する",
    allMatchesTrifecta() && nigeMatchesTrifecta() && missingPayoutExcluded(),
  );
  check(
    "変異検証: 「3連複の列（payout_trifecta）で集計する」版（2026-09-29 までの実装）では、(a)(b) が失敗する",
    !allMatchesTrifecta(withColumn("payout_trifecta")) &&
      !nigeMatchesTrifecta(withColumn("payout_trifecta")),
  );
  check(
    "変異検証: 「配当の無いレースを0円として平均に入れる」版（2026-09-29 までの実装）では、(c) が失敗する",
    !missingPayoutExcluded(countMissingAsZero),
  );
  const oldTrio = (prediction, result) => {
    const r = calculatePayout(
      prediction,
      { ...result, payout_trifecta: result.payout_trio },
      "trio",
    );
    return r;
  };
  check(
    "変異検証: 「3連複の払戻に payout_trio（3連単）を使う」版では、(e) の払戻が 1,010円になり失敗する",
    oldTrio(
      { top_pick: 2, top_2nd: 1, top_3rd: 3 },
      { rank1: 1, rank2: 2, rank3: 3, payout_trifecta: 380, payout_trio: 1010 },
    ).payout === 1010,
  );
}

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} 件の検証に失敗しました`);
  process.exit(1);
}
console.log("✅ すべての検証に成功しました");
