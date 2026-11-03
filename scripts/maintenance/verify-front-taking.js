/**
 * verify-front-taking.js - 前付けの割合と「イン屋」の札の判定（src/utils/frontTaking.js）の検証。DB に接続しない。
 *
 *   (a) 数えるのは4〜6号艇の走だけ。1〜3コースに入った走が k
 *   (b) 期間は today を含む365日。期間の外・today より後・beforeRaceId 以後の走は数えない
 *   (c) 4〜6号艇の走が30未満は insufficient（割合を出さない）
 *   (d) 札の境目は Wilson 95% 下限0.30（30走中13走は札なし、30走中14走は札あり）
 *   (e) 進入の無い走（null・0・7）は数えない
 *   (f) from はデータのある最初の日（RACE_PAGE_FROM）より前にしない
 *
 * 実行: node scripts/maintenance/verify-front-taking.js
 */
import { computeFrontTaking } from "../../src/utils/frontTaking.js";
import { wilsonLowerBound } from "../../src/utils/wilson.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

// date の日に、艇番 boat・進入 course の走を count 本
const runs = (date, boat, course, count) =>
  Array.from({ length: count }, (_, i) => ({
    raceId: `${date}-18-${String(i + 1).padStart(2, "0")}`,
    boatNumber: boat,
    entryCourse: course,
  }));

const TODAY = "2026-11-03";

{
  const r = computeFrontTaking(
    [
      ...runs("2026-10-01", 4, 2, 20),
      ...runs("2026-10-02", 6, 6, 20),
      ...runs("2026-10-03", 1, 1, 50),
      ...runs("2026-10-04", 3, 2, 10),
    ],
    { today: TODAY },
  );
  check(
    "(a) 4〜6号艇の走だけを数え、1〜3コースが k",
    r.n === 40 && r.k === 20 && r.rate === 0.5,
    show(r),
  );
}

{
  const r = computeFrontTaking(
    [
      ...runs("2026-10-01", 5, 1, 30),
      ...runs("2025-11-03", 5, 1, 5), // 期間の外（today を含む365日は 2025-11-04 から）
      ...runs("2026-11-04", 5, 1, 5), // today より後
    ],
    { today: TODAY },
  );
  check(
    "(b) 期間は today を含む365日。外と未来は数えない",
    r.n === 30 && r.k === 30,
    show(r),
  );
  const before = computeFrontTaking(
    [...runs("2026-10-01", 5, 1, 30), ...runs("2026-11-03", 5, 1, 12)],
    { today: TODAY, beforeRaceId: "2026-11-03-18-01" },
  );
  check(
    "(b) beforeRaceId のレースと後は数えない",
    before.n === 30,
    show(before),
  );
}

{
  const r = computeFrontTaking(runs("2026-10-01", 6, 1, 29), { today: TODAY });
  check(
    "(c) 29走は insufficient で rate は null",
    r.status === "insufficient" && r.rate === null && r.n === 29 && r.k === 29,
    show(r),
  );
  const empty = computeFrontTaking(null, { today: TODAY });
  check(
    "(c) 行が無ければ n=0 の insufficient",
    empty.status === "insufficient" && empty.n === 0,
    show(empty),
  );
}

{
  const lo13 = wilsonLowerBound(13, 30);
  const lo14 = wilsonLowerBound(14, 30);
  const no = computeFrontTaking(
    [...runs("2026-10-01", 4, 3, 13), ...runs("2026-10-02", 4, 4, 17)],
    { today: TODAY },
  );
  const yes = computeFrontTaking(
    [...runs("2026-10-01", 4, 3, 14), ...runs("2026-10-02", 4, 4, 16)],
    { today: TODAY },
  );
  check(
    "(d) 30走中13走は rate、14走は inya（Wilson 下限が0.30を挟む）",
    lo13 < 0.3 && lo14 >= 0.3 && no.status === "rate" && yes.status === "inya",
    `${lo13} ${lo14} ${no.status} ${yes.status}`,
  );
  const zero = computeFrontTaking(runs("2026-10-01", 6, 6, 87), {
    today: TODAY,
  });
  check(
    "(d) 0走でも30走以上なら rate（k=0）",
    zero.status === "rate" && zero.k === 0 && zero.rate === 0,
    show(zero),
  );
}

{
  const r = computeFrontTaking(
    [
      ...runs("2026-10-01", 4, 1, 30),
      ...runs("2026-10-02", 4, null, 3),
      ...runs("2026-10-03", 4, 0, 3),
      ...runs("2026-10-04", 4, 7, 3),
    ],
    { today: TODAY },
  );
  check("(e) 進入の無い走は数えない", r.n === 30, show(r));
}

{
  check(
    "(f) from はデータの最初の日より前にしない。そのときは fullYear が偽（画面で「直近1年」と言わない）",
    computeFrontTaking([], { today: TODAY }).from === "2025-12-03" &&
      computeFrontTaking([], { today: TODAY }).fullYear === false,
  );
  check(
    "(f) 1年後は today を含む365日の初日",
    computeFrontTaking([], { today: "2027-06-30" }).from === "2026-07-01" &&
      computeFrontTaking([], { today: "2027-06-30" }).fullYear === true,
  );
  let threw = false;
  try {
    computeFrontTaking([], { today: "2026/11/03" });
  } catch {
    threw = true;
  }
  check("(f) today の形が違えば止める", threw);
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて通過");
