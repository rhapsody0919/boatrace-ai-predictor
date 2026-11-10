#!/usr/bin/env node
/**
 * 「イン屋」の判定 summarizeFrontTaking（src/utils/frontTaking.js、BOA-1422）の検証。DB 不要。
 * 母数（2〜6号艇・進入コースあり）・前付け（枠番より内）・beforeRaceId・札の下限を代表の入力で確かめる。
 */
import assert from "node:assert/strict";
import {
  summarizeFrontTaking,
  FRONT_TAKING_MIN_RUNS,
  FRONT_TAKING_MIN_RATE,
} from "../../src/utils/frontTaking.js";

const run = (raceId, boatNumber, actualCourse) => ({
  raceId,
  boatNumber,
  actualCourse,
});

const cases = [
  [
    "空・null・undefined は母数0で rate=null",
    () => {
      for (const input of [[], null, undefined]) {
        assert.deepEqual(summarizeFrontTaking(input), {
          runs: 0,
          taken: 0,
          rate: null,
          byCourse: [0, 0, 0, 0, 0],
          isInya: false,
        });
      }
    },
  ],
  [
    "1号艇・進入コースなし・範囲外のコース・壊れた行は母数に入れない",
    () => {
      const r = summarizeFrontTaking([
        run("a", 1, 1),
        run("a", 3, null),
        run("a", 3, 0),
        run("a", 3, 7),
        run("a", 3, 2.5),
        run("a", "3", 2),
        null,
        run("a", 4, 2),
      ]);
      assert.equal(r.runs, 1);
      assert.equal(r.taken, 1);
      assert.deepEqual(r.byCourse, [0, 1, 0, 0, 0]);
      assert.equal(r.rate, 100);
    },
  ],
  [
    "前付けは枠番より内だけ（同じ・外は数えない）",
    () => {
      const r = summarizeFrontTaking([
        run("a", 6, 1),
        run("a", 5, 3),
        run("a", 4, 4),
        run("a", 2, 3),
      ]);
      assert.equal(r.runs, 4);
      assert.equal(r.taken, 2);
      assert.equal(r.rate, 50);
      assert.deepEqual(r.byCourse, [1, 0, 1, 0, 0]);
    },
  ],
  [
    "beforeRaceId より前のレースだけ使う（そのレース自身は入れない）",
    () => {
      const recs = [run("r1", 3, 1), run("r2", 3, 1), run("r3", 3, 3)];
      assert.equal(summarizeFrontTaking(recs, { beforeRaceId: "r2" }).runs, 1);
      assert.equal(summarizeFrontTaking(recs, { beforeRaceId: null }).runs, 3);
      assert.equal(summarizeFrontTaking(recs).taken, 2);
    },
  ],
  [
    "札は走数の下限と割合の下限の両方で付く",
    () => {
      const make = (n, takenN) =>
        Array.from({ length: n }, (_, i) =>
          run(`r${i}`, 4, i < takenN ? 2 : 4),
        );
      const minTaken = Math.ceil(
        (FRONT_TAKING_MIN_RUNS * FRONT_TAKING_MIN_RATE) / 100,
      );
      assert.equal(
        summarizeFrontTaking(make(FRONT_TAKING_MIN_RUNS, minTaken)).isInya,
        true,
      );
      assert.equal(
        summarizeFrontTaking(make(FRONT_TAKING_MIN_RUNS, minTaken - 1)).isInya,
        false,
      );
      assert.equal(
        summarizeFrontTaking(make(FRONT_TAKING_MIN_RUNS - 1, minTaken + 5))
          .isInya,
        false,
      );
    },
  ],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`NG  ${name}\n    ${e.message}`);
  }
}
if (failed > 0) {
  console.error(`verify-front-taking: NG（${failed} 件）`);
  process.exit(1);
}
console.log(`verify-front-taking: OK（${cases.length} 件）`);
