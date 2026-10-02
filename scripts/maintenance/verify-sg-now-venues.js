#!/usr/bin/env node
/**
 * src/utils/sgNowVenues.js（トップの「SG開催中」帯に出す会場の判定）を固定の入力で検証する。
 *
 * 崩れると、SG の日に帯が出ない（開催場への導線を失う）か、G1・一般戦の日に帯が出る（誤った案内）。
 */
import { getSgNowVenues } from "../../src/utils/sgNowVenues.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}
const venue = (placeCd, raceGrade, raceTitle) => ({
  placeCd,
  races: [{ raceGrade, raceTitle }, { raceGrade, raceTitle }],
});

check(
  "SGの会場だけを出し、節タイトルの全角数字を半角にする",
  getSgNowVenues([
    venue(2, "ippan", "一般戦"),
    venue(13, "SG", "第７３回ボートレースダービー"),
    venue(16, "G1", "児島キングカップ"),
  ]),
  [{ venueCode: 13, seriesTitle: "第73回ボートレースダービー" }],
);
check("G1だけの日は出さない", getSgNowVenues([venue(16, "G1", "G1名")]), []);
check("SGが無い日は空", getSgNowVenues([venue(2, "ippan", "x")]), []);
check(
  "節タイトルが無いSGは seriesTitle が null",
  getSgNowVenues([venue(1, "SG", null)]),
  [{ venueCode: 1, seriesTitle: null }],
);
check(
  "会場コード順に並べる",
  getSgNowVenues([venue(24, "SG", "B"), venue(3, "SG", "A")]).map(
    (v) => v.venueCode,
  ),
  [3, 24],
);
check(
  "代表値は先頭レース（2レース目がSGでも出さない）",
  getSgNowVenues([
    { placeCd: 5, races: [{ raceGrade: "ippan" }, { raceGrade: "SG" }] },
  ]),
  [],
);
check("レースが無い会場は出さない", getSgNowVenues([{ placeCd: 7, races: [] }]), []);
check("undefined は空", getSgNowVenues(undefined), []);

if (failures.length > 0) {
  console.error(`❌ verify-sg-now-venues: ${failures.length}/${checked} 件失敗`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-sg-now-venues: ${checked} 件すべて通過`);
