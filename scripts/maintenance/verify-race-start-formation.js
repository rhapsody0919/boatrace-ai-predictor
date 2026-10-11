/**
 * verify-race-start-formation.js - レース結果のスタート隊形の並び（BOA-811、src/components/race/startFormation.js）
 *
 * 守るもの（例は本番 DB の実際のレース。race_start_timings・race_results の actual_course）:
 *   - 進入コースの順（上が1コース）に並ぶ。進入が1艇も分からなければ絵を出さない（null）
 *   - 前付け: 枠なりの順より内側に入った艇だけ（戸田 2026-09-11 3R の6号艇）。欠場で繰り上がっただけの艇には
 *     付けない（江戸川 2026-09-26 11R: 5号艇が欠場、6号艇が5コース）
 *   - 欠場は一番下に並べ、行を消さない
 *   - 最速は F を除いて2艇以上あるときだけ（津 2026-09-25 6R: 3号艇 F.04、最速は1号艇 .03）
 *   - 出遅れ（若松 2026-09-27 10R の4号艇）は ST なしで、最速の判定に入らない
 *   - ST の表示は結果の表と同じ形（0.15、F は「F.04」）
 *
 * 実行: node scripts/maintenance/verify-race-start-formation.js
 */
import {
  formationStText,
  startFormationRows,
} from "../../src/components/race/startFormation.js";

let failures = 0;
const check = (label, pass, detail = "") => {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};
const row = (boatNumber, entryCourse, startTiming, extra = {}) => ({
  boatNumber,
  entryCourse,
  startTiming,
  isFlying: false,
  isLateStart: false,
  finishMark: null,
  ...extra,
});
const brief = (rows) =>
  rows
    .map(
      (r) =>
        `${r.course ?? "-"}:${r.boat}${r.mae ? "前" : ""}${r.absent ? "欠" : ""}${r.fastest ? "速" : ""}`,
    )
    .join(" ");

// 戸田 2026-09-11 3R（前付け: 6号艇が5コース、5号艇が6コース）
const toda = startFormationRows([
  row(1, 1, 0.18),
  row(2, 2, 0.22),
  row(3, 3, 0.11),
  row(4, 4, 0.1),
  row(5, 6, 0.11),
  row(6, 5, 0.14),
]);
check(
  "コース順に並び、内側に入った6号艇だけ前付け。最速は4号艇 .10",
  brief(toda) === "1:1 2:2 3:3 4:4速 5:6前 6:5",
  brief(toda),
);

// 江戸川 2026-09-26 11R（5号艇が欠場。6号艇は5コースに繰り上がっただけ）
const edogawa = startFormationRows([
  row(1, 1, 0.2),
  row(2, 2, 0.25),
  row(3, 3, 0.21),
  row(4, 4, 0.28),
  row(6, 5, 0.26),
  row(5, null, null, { finishMark: "欠" }),
]);
check(
  "欠場は一番下に残し、繰り上がった6号艇は前付けにしない",
  brief(edogawa) === "1:1速 2:2 3:3 4:4 5:6 -:5欠",
  brief(edogawa),
);

// 津 2026-09-25 6R（3号艇 F.04）
const tsu = startFormationRows([
  row(1, 1, 0.03),
  row(2, 2, 0.08),
  row(3, 3, 0.04, { isFlying: true, finishMark: "F" }),
  row(4, 4, 0.08),
  row(5, 5, 0.11),
  row(6, 6, 0.14),
]);
check(
  "F は最速から外す（最速は1号艇 .03）。F の艇は flying",
  brief(tsu) === "1:1速 2:2 3:3 4:4 5:5 6:6" && tsu[2].flying === true,
  brief(tsu),
);

// 若松 2026-09-27 10R（4号艇 出遅れ、ST なし）
const wakamatsu = startFormationRows([
  row(1, 1, 0.23),
  row(2, 2, 0.17),
  row(3, 3, 0.19),
  row(4, 4, null, { isLateStart: true, finishMark: "L" }),
  row(5, 5, 0.27),
  row(6, 6, 0.21),
]);
check(
  "出遅れは欠場にせずコースの行に残し、ST なし。最速は2号艇 .17",
  brief(wakamatsu) === "1:1 2:2速 3:3 4:4 5:5 6:6" &&
    wakamatsu[3].late === true &&
    wakamatsu[3].st === null,
  brief(wakamatsu),
);

check(
  "進入が1艇も分からない・取得前は絵を出さない（null）",
  startFormationRows([row(1, null, 0.15), row(2, null, 0.16)]) === null &&
    startFormationRows(null) === null,
);
check(
  "最速は比べる相手（F を除く ST）が2艇以上のときだけ（BOA-586 と同じ）",
  startFormationRows([
    row(1, 1, 0.12),
    row(2, 2, 0.01, { isFlying: true }),
  ]).every((r) => !r.fastest),
);
check(
  "ST の表示は結果の表と同じ形（0.15、F.04）",
  formationStText(0.15, false) === "0.15" &&
    formationStText(0.04, true) === "F.04",
);

if (failures > 0) {
  console.error(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
