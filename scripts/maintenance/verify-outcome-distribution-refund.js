/**
 * verify-outcome-distribution-refund.js - 出目分布が返還艇を3着に数えないことの検証（BOA-579 の積み残し）
 *
 * 完走が3艇未満のレース（一部返還）は、取り込みが返還艇を rank1〜3 に入れている（data-catalog E9）。
 * 2026-10-04 まで、出目分布・逃げ成功時分布の日次集計（scripts/lib/outcomeDistribution.js）が rank1〜3 をそのまま使い、
 * 返還艇を3着として数えていた。2026-07-04〜10-01 の5レースが該当し、会場特徴カードの3連率が最大0.2pt 過大だった。
 *
 * DBにも取得先にも接続しない（実データの5レースと、純粋関数だけ）。
 *
 * 確認すること:
 *   (a) 返還艇を飛ばすと1〜3着がそろわないレースは、パターンにも total_races にも入れない（3連単が不成立で出目が無い）
 *   (b) 返還艇が4着以下にしかいないレース（欠場等）は、今までどおり数える
 *   (c) 件数の合計が total_races と一致する（会場特徴カードの合算 src/utils/venuePlaceRates.js の前提）
 *   (d) 日次の2本が refund_boats を select する（渡さないと飛ばせない）
 *   (e) 変異検証: refund_boats を読まない版（2026-10-04 までの実装）では (a)(c) が失敗する
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateOutcomeDistribution,
  hasThreePlaced,
} from "../lib/outcomeDistribution.js";

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
const TODAY = "2026-10-04";

// 実データ（2026-10-04 に本番の race_results から取得）: 一部返還で、返還艇が rank1〜3 に入っている全レース
// （2026-07-04 以降。race_status='partial_refund'。3連単の配当はすべて NULL）
const REFUND_IN_TOP3 = [
  {
    race_id: "2026-07-18-09-10",
    rank1: 2,
    rank2: 1,
    rank3: 3,
    refund_boats: [3, 4, 5, 6],
    payout_trio: null,
  },
  {
    race_id: "2026-07-22-09-10",
    rank1: 3,
    rank2: 2,
    rank3: 1,
    refund_boats: [1, 4, 5, 6],
    payout_trio: null,
  },
  {
    race_id: "2026-08-08-02-08",
    rank1: 5,
    rank2: 6,
    rank3: 1,
    refund_boats: [1, 2, 3, 4],
    payout_trio: null,
  },
  {
    race_id: "2026-09-04-11-09",
    rank1: 4,
    rank2: 5,
    rank3: 1,
    refund_boats: [1, 2, 3, 6],
    payout_trio: null,
  },
  {
    race_id: "2026-09-19-02-09",
    rank1: 1,
    rank2: 2,
    rank3: 3,
    refund_boats: [3, 4, 5, 6],
    payout_trio: null,
  },
];
// 合成: 戸田（02）の通常のレースと、返還艇が4着以下にしかいないレース（欠場で一部返還）
const TODA_NORMAL = [
  {
    race_id: "2026-09-01-02-01",
    rank1: 1,
    rank2: 2,
    rank3: 3,
    refund_boats: null,
    payout_trio: 1000,
  },
  {
    race_id: "2026-09-01-02-02",
    rank1: 1,
    rank2: 3,
    rank3: 2,
    refund_boats: [],
    payout_trio: 1500,
  },
  {
    race_id: "2026-09-01-02-03",
    rank1: 2,
    rank2: 1,
    rank3: 4,
    refund_boats: [6],
    payout_trio: 3000,
  },
];

const find = (records, a, b, c) =>
  (records ?? []).find(
    (r) => r.first_boat === a && r.second_boat === b && r.third_boat === c,
  );
/** 艇の3連対の回数（会場特徴カードと同じく、件数を1〜3着の艇ごとに足す） */
const top3Count = (records, boat) =>
  (records ?? [])
    .filter((r) => [r.first_boat, r.second_boat, r.third_boat].includes(boat))
    .reduce((s, r) => s + r.count_90days, 0);
const sumMatchesTotal = (aggregated) =>
  Object.values(aggregated).every(
    (records) =>
      records.reduce((s, r) => s + r.count_90days, 0) ===
      records[0].total_races,
  );

/** 観測 (a): 返還艇で3着が欠けるレースは、どこにも数えない */
function incompleteExcluded(aggregate = aggregateOutcomeDistribution) {
  const agg = aggregate([...REFUND_IN_TOP3, ...TODA_NORMAL], { today: TODAY });
  const toda = agg[2];
  return (
    toda?.[0]?.total_races === 3 &&
    !find(toda, 5, 6, 1) && // 2026-08-08-02-08（1号艇はF。完走は5・6号艇だけ）
    find(toda, 1, 2, 3)?.count_90days === 1 && // 2026-09-19-02-09 を足していない
    top3Count(toda, 1) === 3 &&
    agg[9] === undefined && // 津の2レースはどちらも3着が欠ける
    agg[11] === undefined
  );
}
/** 観測 (c): 件数の合計が total_races と一致する */
function countsSumToTotal(aggregate = aggregateOutcomeDistribution) {
  return sumMatchesTotal(
    aggregate([...REFUND_IN_TOP3, ...TODA_NORMAL], { today: TODAY }),
  );
}

{
  check(
    "前提: 実データの5レースは、どれも返還艇を飛ばすと1〜3着がそろわない",
    REFUND_IN_TOP3.every((r) => !hasThreePlaced(r)),
  );
  check(
    "(a) 返還艇で3着が欠けるレース（戸田 2026-08-08-02-08・2026-09-19-02-09、津・びわこ）は、パターンにも total_races にも入れない",
    incompleteExcluded(),
    show(
      aggregateOutcomeDistribution([...REFUND_IN_TOP3, ...TODA_NORMAL], {
        today: TODAY,
      }),
    ),
  );
  const toda = aggregateOutcomeDistribution(TODA_NORMAL, { today: TODAY })[2];
  check(
    "(b) 返還艇が4着以下にしかいないレース（6号艇欠場で 2-1-4）は今までどおり数え、配当も平均に入れる",
    hasThreePlaced(TODA_NORMAL[2]) &&
      find(toda, 2, 1, 4)?.count_90days === 1 &&
      find(toda, 2, 1, 4)?.avg_payout === 3000 &&
      toda[0].total_races === 3,
  );
  check(
    "(c) 件数の合計が total_races と一致する（会場特徴カードの合算の前提）",
    countsSumToTotal(),
  );
}

{
  for (const file of [
    "scripts/daily/update-outcome-distribution.js",
    "scripts/daily/update-nige-outcome-distribution.js",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    check(
      `(d) ${file}: refund_boats を select し、共通の集計（aggregateOutcomeDistribution）に渡す`,
      /\.select\(\s*`[^`]*\brefund_boats\b[^`]*`/.test(src) &&
        src.includes("aggregateOutcomeDistribution("),
    );
  }
}

{
  // (e) 変異検証: refund_boats を読まない（2026-10-04 までの実装と同じ結果になる）
  const ignoreRefunds = (results, options) =>
    aggregateOutcomeDistribution(
      results.map((r) => ({ ...r, refund_boats: null })),
      options,
    );
  check(
    "変異検証の前提: 正しい実装は (a)(c) に合格する",
    incompleteExcluded() && countsSumToTotal(),
  );
  check(
    "変異検証: refund_boats を読まない版（2026-10-04 までの実装）では (a) が失敗する（戸田1号艇の3連対が5回に増える）",
    !incompleteExcluded(ignoreRefunds) &&
      top3Count(
        ignoreRefunds([...REFUND_IN_TOP3, ...TODA_NORMAL], { today: TODAY })[2],
        1,
      ) === 5,
  );
  // パターンだけ外して total_races に残す版: 件数の合計が total_races と合わなくなる
  const keepInTotal = (results, options) => {
    const agg = aggregateOutcomeDistribution(results, options);
    for (const [venue, records] of Object.entries(agg)) {
      const total = results.filter(
        (r) => parseInt(r.race_id.split("-")[3], 10) === Number(venue),
      ).length;
      records.forEach((r) => (r.total_races = total));
    }
    return agg;
  };
  check(
    "変異検証: パターンだけ外して total_races に残す版では (c) が失敗する",
    !countsSumToTotal(keepInTotal),
  );
}

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} 件の検証に失敗しました`);
  process.exit(1);
}
console.log("✅ すべての検証に成功しました");
