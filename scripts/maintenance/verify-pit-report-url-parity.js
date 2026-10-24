/**
 * BOA-1035: 画面側と取得側のURL・候補判定の規則を照合する。
 * 仕様: docs/design/pit-comments/screens.md §3.4・§9 と対象モジュールのコメント。
 * DBクライアントを作らず、取得・ジョブ処理も呼ばない（通信・鍵・実時刻は不要）。
 */
import assert from "node:assert/strict";
import * as screen from "../../src/utils/pitReportUrl.js";
import { buildPitReportUrl as jobUrl } from "../lib/pitReportJob.js";
import * as rows from "../lib/pitReportRows.js";

// 仕様の値と今の実装の値が異なる入力だけを、確認済みの固定値として記録する。
// 新しい不一致を実行時にここへ自動登録すると回帰を隠すため、自動登録しない。
// 要素の形: { input, specification, current }。文書どおりの画面/取得の差はgapではない。
const KNOWN_GAPS = [];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}`, KNOWN_GAPS);

let checks = 0;
function check(name, run) {
  try {
    run();
    checks++;
    console.log(`OK: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

// 仕様の値（実装の定数・関数から期待値を作らない）。
const SPECIFICATION = {
  grades: ["SG", "G1", "G2"],
  minimumNonSg: 7,
  urls: [
    ["2026-10-24-06-09", "https://www.boatrace.jp/owpc/pc/race/pitreport?rno=9&jcd=06&hd=20261024"],
    ["2026-01-05-24-12", "https://www.boatrace.jp/owpc/pc/race/pitreport?rno=12&jcd=24&hd=20260105"],
  ],
  invalidIds: ["bad", null, "2026-10-24-6-9"],
};

check("定数: 仕様の値と画面・取得の値が一致", () => {
  for (const implementation of [screen, rows]) {
    assert.deepEqual(implementation.PIT_REPORT_GRADES, SPECIFICATION.grades);
    assert.equal(implementation.PIT_REPORT_MIN_RACE_NUMBER_NON_SG, SPECIFICATION.minimumNonSg);
  }
  assert.deepEqual(screen.PIT_REPORT_GRADES, rows.PIT_REPORT_GRADES);
  assert.equal(screen.PIT_REPORT_MIN_RACE_NUMBER_NON_SG, rows.PIT_REPORT_MIN_RACE_NUMBER_NON_SG);
});

for (const [input, specification] of SPECIFICATION.urls) {
  check(`URL: ${input}`, () => {
    // 今の実装の値。
    const current = { screen: screen.buildPitReportUrl(input), job: jobUrl(input) };
    assert.equal(current.screen, specification);
    assert.equal(current.job, specification);
    assert.equal(current.screen, current.job);
  });
}

for (const input of SPECIFICATION.invalidIds) {
  check(`不正URL: ${String(input)} は画面null・取得例外`, () => {
    assert.equal(screen.buildPitReportUrl(input), null);
    assert.throws(() => jobUrl(input), /race_id の形式が不正/);
  });
}

// 仕様の値: SGは1〜12R、G1/G2は7〜12R。画面のみ不明グレードも候補。
function specificationFor({ raceGrade, raceNumber }) {
  const valid = Number.isInteger(raceNumber) && raceNumber >= 1 && raceNumber <= 12;
  const job = valid && (raceGrade === "SG" ||
    (["G1", "G2"].includes(raceGrade) && raceNumber >= 7));
  return { screen: valid && (raceGrade == null || job), job };
}

let documentedDifferences = 0;
for (const raceGrade of ["SG", "G1", "G2", "G3", "一般", null, undefined]) {
  for (const raceNumber of [0, 1, 6, 7, 12, 13, 7.5]) {
    const input = { raceGrade, raceNumber };
    check(`候補: grade=${String(raceGrade)} race=${raceNumber}`, () => {
      const specification = specificationFor(input);
      const current = {
        screen: screen.isPitReportCandidate(input),
        job: rows.isPitReportCandidate(input),
      };
      assert.deepEqual(current, specification);
      if (specification.screen !== specification.job) {
        assert.deepEqual(current, { screen: true, job: false });
        documentedDifferences++;
      } else {
        assert.equal(current.screen, current.job);
      }
    });
  }
}
assert.equal(documentedDifferences, 8, "不明グレード2種×有効番号4種だけが文書上の差");

for (const [raceGrade, raceNumber, specification] of [
  ["SG", 1, true], ["G1", 6, false], ["G1", 7, true], ["G3", 12, false],
]) {
  check(`代表値: ${raceGrade} ${raceNumber}R → ${specification}`, () => {
    const input = { raceGrade, raceNumber };
    assert.equal(screen.isPitReportCandidate(input), specification);
    assert.equal(rows.isPitReportCandidate(input), specification);
  });
}
console.log(`成功: ${checks}試験、文書上の差 ${documentedDifferences}組`);
