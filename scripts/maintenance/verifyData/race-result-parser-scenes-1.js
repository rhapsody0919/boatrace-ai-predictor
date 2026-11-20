/**
 * verify-race-result-parser.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-race-result-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realParser from "../../lib/raceResultParser.js";
import * as realRows from "../../lib/raceResultRows.js";
import { evaluateCaseParse, evaluateCaseLegacy, evaluateCaseRows } from "./race-result-parser-cases.js";

let printOut, check, readFixture;
let realFailures;

// ---------------------------------------------------------------------------
// フィクスチャの期待値（公式ページの表示・本番DBの actual_course から、2026-09-20に手で確認したもの）
// ---------------------------------------------------------------------------
/**
 * marks: 着順表の行順の着欄。boats: 着順表の行順の枠番。course: 本番DBの actual_course_1〜6（艇Nの進入コース。Kファイル由来）。
 * refund: 返還艇。status: レースの状態。remark: 備考。noRace: 不成立の勝式。
 */
export const CASES = [
  {
    file: "raceresult-2026-09-19-02-09-refund-f4.html",
    boats: [1, 2, 3, 4, 5, 6],
    marks: ["1", "2", "F", "F", "F", "F"],
    course: [1, 2, 3, 4, 6, 5],
    refund: [3, 4, 5, 6],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: ["place", "2fuku", "wide", "3tan", "3fuku"],
    legacyDiff: ["rank4", "rank5", "rank6", "payouts"],
  },
  {
    file: "raceresult-2026-09-16-23-12-absent.html",
    boats: [2, 3, 5, 6, 4, 1],
    marks: ["1", "2", "3", "4", "5", "欠"],
    course: [null, 1, 2, 3, 4, 5],
    refund: [1],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: [],
    legacyDiff: ["rank6"],
  },
  {
    file: "raceresult-2026-08-07-24-01-no-race-6f.html",
    boats: [1, 2, 3, 4, 5, 6],
    marks: ["F", "F", "F", "F", "F", "F"],
    course: [1, 4, 2, 3, 6, 5],
    refund: [1, 2, 3, 4, 5, 6],
    status: "no_race",
    remark: "【返還艇あり】",
    noRace: ["win", "place", "2tan", "2fuku", "wide", "3tan", "3fuku"],
    legacyDiff: ["rank4", "rank5", "rank6", "payouts"],
  },
  {
    file: "raceresult-2026-09-14-06-06-no-race-underscore.html",
    boats: [4, 1, 2, 3, 5, 6],
    marks: ["_", "F", "F", "F", "F", "F"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [1, 2, 3, 5, 6],
    status: "no_race",
    remark: "【返還艇あり】",
    noRace: ["win", "place", "2tan", "2fuku", "wide", "3tan", "3fuku"],
    legacyDiff: ["rank4", "rank5", "rank6", "payouts"],
  },
  {
    file: "raceresult-2026-09-17-13-11-tokubarai.html",
    boats: [2, 1, 3, 4, 5, 6],
    marks: ["1", "2", "3", "4", "5", "6"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: [],
  },
  {
    file: "raceresult-2025-12-11-17-01-dead-heat-1st.html",
    boats: [1, 2, 5, 4, 6, 3],
    marks: ["1", "1", "3", "4", "5", "6"],
    course: [1, 2, 3, 4, 6, 5],
    refund: [],
    status: "normal",
    remark: "【同着あり】",
    noRace: [],
    legacyDiff: [],
  },
  {
    file: "raceresult-2026-03-15-18-06-dead-heat-3rd.html",
    boats: [1, 2, 3, 5, 4, 6],
    marks: ["1", "2", "3", "3", "5", "6"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [],
    status: "normal",
    remark: "【同着あり】",
    noRace: [],
    legacyDiff: [],
  },
  {
    file: "raceresult-2026-09-11-20-01-fall-obstruct.html",
    boats: [4, 1, 3, 2, 5, 6],
    marks: ["1", "2", "3", "4", "落", "妨"],
    course: [1, 2, 4, 3, 5, 6],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: ["rank5", "rank6"],
  },
  {
    file: "raceresult-2026-04-03-21-10-engine-sink-absent.html",
    boats: [6, 2, 3, 1, 4, 5],
    marks: ["1", "2", "3", "エ", "沈", "欠"],
    course: [1, 2, 3, 4, null, 5],
    refund: [5],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: [],
    legacyDiff: ["rank4", "rank5", "rank6"],
  },
  {
    file: "raceresult-2026-06-01-05-05-late-start.html",
    boats: [4, 5, 6, 1, 2, 3],
    marks: ["1", "2", "3", "4", "L", "L"],
    course: [1, 5, 6, 2, 3, 4],
    refund: [2, 3],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: [],
    legacyDiff: ["rank5", "rank6"],
  },
  {
    file: "raceresult-2026-09-10-05-12-fall-capsize-f.html",
    boats: [2, 3, 1, 4, 5, 6],
    marks: ["1", "2", "3", "落", "転", "F"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [6],
    status: "partial_refund",
    remark: "【返還艇あり】",
    noRace: [],
    legacyDiff: ["rank4", "rank5", "rank6"],
  },
  {
    file: "raceresult-2019-04-15-05-03-capsize-2019.html",
    boats: [1, 2, 3, 4, 6, 5],
    marks: ["1", "2", "3", "4", "5", "転"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: ["rank6"],
  },
  {
    file: "raceresult-2026-09-19-05-01.html",
    boats: [1, 6, 2, 3, 5, 4],
    marks: ["1", "2", "3", "4", "5", "6"],
    course: [1, 2, 4, 5, 6, 3],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: [],
  },
  {
    file: "raceresult-2026-09-19-17-12.html",
    boats: [2, 1, 3, 5, 6, 4],
    marks: ["1", "2", "3", "4", "5", "6"],
    course: [1, 2, 3, 4, 5, 6],
    refund: [],
    status: "normal",
    remark: null,
    noRace: [],
    legacyDiff: [],
  },
];

// ---------------------------------------------------------------------------
// (a)(b)(c)(d) を、差し替え可能なモジュールに対して評価する（変異検証で、壊した版にも同じ評価をかける）
// ---------------------------------------------------------------------------
/**
 * @param {{parseRaceResultPage: Function, toLegacyResult: Function, buildTimingRows: Function, buildPayoutRows: Function}} m
 * @returns {string[]} 失敗した項目のラベル
 */
export function evaluate(m) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  for (const c of CASES) {
    const html = readFixture(c.file);
    const full = m.parseRaceResultPage(html);
    const name = c.file.replace("raceresult-", "").replace(".html", "");

    evaluateCaseParse(m, c, expect, { full, name });
    const { oldR, newR } = evaluateCaseLegacy(m, c, expect, { full, name, html });
    evaluateCaseRows(m, c, expect, { full, name, newR, oldR });
  }
  return failed;
}

export const realModules = {
  parseRaceResultPage: realParser.parseRaceResultPage,
  toLegacyResult: realRows.toLegacyResult,
  buildTimingRows: realRows.buildTimingRows,
  buildPayoutRows: realRows.buildPayoutRows,
};

function scene1() {
  realFailures = evaluate(realModules);
  check(
    `(a)(b)(c)(d) 全フィクスチャ${CASES.length}件（着欄・進入・返還・払戻明細・状態・旧解析との互換・行の組み立て）の検証が全て成功`,
    realFailures.length === 0,
    realFailures.slice(0, 5).join(" / "),
  );
  printOut(`   （評価した項目数: ${CASES.length}件 × 約19項目）`);
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・readFixture） */
export function runRaceResultParserScenes1(env) {
  ({ printOut, check, readFixture } = env);
  scene1();
}
