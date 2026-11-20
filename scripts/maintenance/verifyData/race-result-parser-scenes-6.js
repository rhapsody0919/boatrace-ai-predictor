/**
 * verify-race-result-parser.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-race-result-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { buildRaceResultRow } from "../../daily/scrape-results.js";
import * as realRows from "../../lib/raceResultRows.js";
import { buildFixPlan } from "../../lib/raceResultFix.js";
import { createSchemaAwareDb } from "./race-result-parser-db.js";
import { RACE_F4, LEGACY_TIMING_COLUMNS, RACE_ABSENT } from "./race-result-parser-scenes-2.js";
import { evaluate, realModules } from "./race-result-parser-scenes-1.js";

let printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant;

const PARSER = "raceResultParser.js";

const ROWS = "raceResultRows.js";

const mutants = [
  [
    "進入コースを行順でなく艇番にする（旧実装の誤り）",
    PARSER,
    [["entryCourse: index + 1,", "entryCourse: boatNumber,"]],
    "parser",
  ],
  [
    "公式の行の順を艇番にする（行の順を持たない）",
    PARSER,
    [["official_row: boats.length + 1,", "official_row: boatNumber,"]],
    "parser",
  ],
  [
    "進入コースを0始まりにする",
    PARSER,
    [["entryCourse: index + 1,", "entryCourse: index,"]],
    "parser",
  ],
  [
    "不成立を払戻として扱う（¥100を払戻にする）",
    PARSER,
    [['if (comboText.startsWith("不成立")) {', "if (false) {"]],
    "parser",
  ],
  [
    "特払を払戻なしにする",
    PARSER,
    [['} else if (comboText.startsWith("特払")) {', "} else if (false) {"]],
    "parser",
  ],
  [
    "着欄を読まない（先頭6行を着順とみなす）",
    PARSER,
    [
      [
        "finish_rank: /^[1-6]$/.test(mark) ? Number(mark) : null,",
        "finish_rank: 1,",
      ],
    ],
    "parser",
  ],
  [
    "返還艇を読まない",
    PARSER,
    [
      [
        "if (n >= 1 && n <= 6 && !refundBoats.includes(n)) refundBoats.push(n);",
        "",
      ],
    ],
    "parser",
  ],
  [
    "レースの状態を、返還艇があっても normal にする",
    PARSER,
    [
      [
        'if (noRace > 0 || refundBoats.length > 0) return "partial_refund";',
        'if (noRace > 0) return "partial_refund";',
      ],
    ],
    "parser",
  ],
  [
    "全勝式が不成立でも partial_refund にする",
    PARSER,
    [['if (noRace === payoutRows.length) return "no_race";', ""]],
    "parser",
  ],
  [
    "同着の複数口を捨てる（seq を常に1にする）",
    PARSER,
    [["const seq = (seqByType.get(betType) ?? 0) + 1;", "const seq = 1;"]],
    "parser",
  ],
  [
    "出遅れ（L）を読まない",
    PARSER,
    [['isLateStart: m[1] === "L",', "isLateStart: false,"]],
    "parser",
  ],
  [
    "レースタイムを秒にしない",
    PARSER,
    [["Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10", "Number(m[2])"]],
    "parser",
  ],
  [
    "rank4〜6 に非完走艇を入れる（旧実装の誤り）",
    ROWS,
    [
      [
        "rank456 = [3, 4, 5].map((i) => finishers[i]?.boat_number ?? null);",
        "rank456 = [3, 4, 5].map((i) => rowOrder[i] ?? null);",
      ],
    ],
    "rows",
  ],
  [
    "119適用済みでも艇別の行に公式の行の順を入れない",
    ROWS,
    [["...(officialRow ? { official_row: b.official_row } : {}),", ""]],
    "rows",
  ],
  [
    "旧形式の払戻から特払を落とす",
    ROWS,
    [
      [
        'if (row.payout_status !== "paid" && row.payout_status !== "special") {',
        'if (row.payout_status !== "paid") {',
      ],
    ],
    "rows",
  ],
  [
    "拡張の艇別の行に進入コースを入れない",
    ROWS,
    [["    entry_course: b.entry_course,\n", ""]],
    "rows",
  ],
  [
    "拡張の艇別の行から欠場艇を落とす",
    ROWS,
    [[".filter((b) => b.entry_course === null)", ".filter(() => false)"]],
    "rows",
  ],
];

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  // 修正計画: 変更のある列だけ書く。再取得した結果ページ（戸田9R）から
  const parsed = realRows.toLegacyResult(
    full("raceresult-2026-09-19-02-09-refund-f4.html"),
  );
  const newRow = buildRaceResultRow(RACE_F4, parsed);
  const existing = {
    ...newRow,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_trifecta: 100,
    payout_trio: 100,
    payout_quinella: 100,
    payout_place_1: 100,
    payout_wide_1: 100,
    race_status: null,
    refund_boats: null,
    remark: null,
  };
  const plan = buildFixPlan(existing, newRow, parsed, {
    results: true,
    timings: true,
    payouts: true,
  });
  check(
    "修正計画: 汚れた行から、変更のある列だけを更新（rank4〜6・不成立の払戻をNULL・race_status・refund_boats・remark）。rank1〜3・単勝・2連単は触れない",
    same(
      Object.keys(plan.resultUpdate).sort(),
      [
        "payout_place_1",
        "payout_quinella",
        "payout_trifecta",
        "payout_trio",
        "payout_wide_1",
        "race_status",
        "rank4",
        "rank5",
        "rank6",
        "refund_boats",
        "remark",
      ].sort(),
    ) &&
      plan.resultUpdate.rank4 === null &&
      plan.resultUpdate.payout_trifecta === null &&
      plan.resultUpdate.race_status === "partial_refund" &&
      !("rank1" in plan.resultUpdate) &&
      !("payout_win" in plan.resultUpdate),
    show(plan.resultUpdate),
  );
  const planNoExt = buildFixPlan(existing, newRow, parsed, {
    results: false,
    timings: false,
    payouts: false,
  });
  check(
    "修正計画: 078未適用なら race_status・refund_boats・remark を含めない。077・079未適用なら艇別・払戻明細を書かない",
    !("race_status" in planNoExt.resultUpdate) &&
      planNoExt.timingRows.length === 0 &&
      planNoExt.payoutRows.length === 0,
  );
  const fixed = buildFixPlan(
    {
      ...newRow,
      race_status: "partial_refund",
      refund_boats: [3, 4, 5, 6],
      remark: "【返還艇あり】",
    },
    newRow,
    parsed,
    { results: true, timings: false, payouts: false },
  );
  check(
    "修正計画: 既に正しい行は、race_results を書かない（変更の無い行を書かない）",
    Object.keys(fixed.resultUpdate).length === 0,
  );
  return { parsed, newRow };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ parsed, newRow }) {
  // 決まり手は、空のときだけ埋める（BOA-749。2026-09-16 住之江7R が NULL のまま残っていた）
  const techniquePlan = (
    existingTechnique,
    newTechnique,
    { omit = false } = {},
  ) => {
    const base = {
      ...newRow,
      race_status: "partial_refund",
      refund_boats: [3, 4, 5, 6],
      remark: "【返還艇あり】",
    };
    const existingRow = { ...base, winning_technique: existingTechnique };
    if (omit) delete existingRow.winning_technique;
    return buildFixPlan(
      existingRow,
      { ...newRow, winning_technique: newTechnique },
      parsed,
      { results: true, timings: false, payouts: false },
    ).resultUpdate;
  };
  check(
    "修正計画: 決まり手が空なら、再取得した値で埋める",
    same(techniquePlan(null, "まくり"), { winning_technique: "まくり" }),
    show(techniquePlan(null, "まくり")),
  );
  check(
    "修正計画: 決まり手に値があれば、再取得した値が違っても上書きしない",
    !("winning_technique" in techniquePlan("逃げ", "まくり")),
  );
  check(
    "修正計画: 再取得したページから決まり手を読めなくても（null）、既存の値を消さない",
    !("winning_technique" in techniquePlan("逃げ", null)),
  );
  check(
    "修正計画: 既存の行に決まり手の列が無い（読み出していない）ときは書かない",
    !("winning_technique" in techniquePlan(null, "まくり", { omit: true })),
  );
}

function scene3() {
  {
    const s1 = scene1();
    scene2(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・full・LEGACY_RESULT_COLUMNS・seedRaces・withMutant） */
export function runRaceResultParserScenes9(env) {
  ({ printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant } = env);
  scene3();
}

async function scene4() {
  for (const [label, file, replacements, kind] of mutants) {
    const failed = await withMutant(file, replacements, (mod) =>
      evaluate(
        kind === "parser"
          ? { ...realModules, parseRaceResultPage: mod.parseRaceResultPage }
          : {
              ...realModules,
              toLegacyResult: mod.toLegacyResult,
              buildTimingRows: mod.buildTimingRows,
              buildPayoutRows: mod.buildPayoutRows,
            },
      ),
    );
    check(
      `変異検証: 「${label}」で検証が失敗する（${failed.length}項目が失敗）`,
      failed.length > 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・full・LEGACY_RESULT_COLUMNS・seedRaces・withMutant） */
export async function runRaceResultParserScenes10(env) {
  ({ printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant } = env);
  await scene4();
}

async function scene5() {
  {
    // 未適用のDBに拡張の行を書く版（確認をしない）は、失敗する: 077の列が無いDBで、新しい列を含む書き込みがエラーになることの確認
    const db = createSchemaAwareDb(
      { races: seedRaces },
      {
        columns: {
          race_start_timings: LEGACY_TIMING_COLUMNS,
          race_results: LEGACY_RESULT_COLUMNS.concat(["created_at"]),
        },
      },
    );
    const parsed = realRows.toLegacyResult(
      full("raceresult-2026-09-16-23-12-absent.html"),
    );
    const { error } = await db
      .from("race_start_timings")
      .upsert(realRows.buildTimingRows(RACE_ABSENT, parsed, { extended: true }), {
        onConflict: "race_id,boat_number",
      });
    check(
      "変異検証: 適用状況を確認せず拡張の行を書くと、未適用のDBでは書き込みが失敗する（確認が必要な理由）",
      Boolean(error) && error.code === "PGRST204",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・full・LEGACY_RESULT_COLUMNS・seedRaces・withMutant） */
export async function runRaceResultParserScenes11(env) {
  ({ printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant } = env);
  await scene5();
}

function scene6() {
  printOut("\nALL PASS");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・full・LEGACY_RESULT_COLUMNS・seedRaces・withMutant） */
export function runRaceResultParserScenes12(env) {
  ({ printOut, check, show, same, full, LEGACY_RESULT_COLUMNS, seedRaces, withMutant } = env);
  scene6();
}
