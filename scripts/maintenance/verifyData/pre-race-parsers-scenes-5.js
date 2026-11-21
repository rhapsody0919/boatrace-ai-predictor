/**
 * verify-pre-race-parsers.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-pre-race-parsers.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realBeforeParser from "../../lib/beforeInfoParser.js";
import * as realRows from "../../lib/preRaceRows.js";
import { createDb } from "./pre-race-parsers-fakes.js";
import { ROWS, LIST, BEFORE } from "./pre-race-parsers-scenes-4.js";
import { evaluate, realModules, BEFORE_FILES } from "./pre-race-parsers-scenes-1.js";
import { NEW_EXHIBITION_KEYS } from "./pre-race-parsers-scenes-2.js";

let printOut, check, readFixture, withMutant;

const mutants = [
  [
    "180分ちょうどの更新を拒否する",
    ROWS,
    [["> maxShiftMin", ">= maxShiftMin"]],
    "rows",
  ],
  [
    "出走表に無いレースも no_time にする",
    ROWS,
    [["if (byRaceNo.has(race.race_no))", "if (true)"]],
    "rows",
  ],
  [
    "欠場の表示（is-miss）を読まない（出走表）",
    LIST,
    [['is_absent: $tbody.hasClass("is-miss"),', "is_absent: false,"]],
    "list",
  ],
  [
    "F数を、L数の欄から読む",
    LIST,
    [
      [
        "f_count: f ? parseInt(f[1], 10) : null,",
        "f_count: l ? parseInt(l[1], 10) : null,",
      ],
    ],
    "list",
  ],
  [
    "登録体重を読まない",
    LIST,
    [
      [
        "weight_kg: weightMatch ? parseFloat(weightMatch[1]) : null,",
        "weight_kg: null,",
      ],
    ],
    "list",
  ],
  [
    "支部と出身地を逆にする",
    LIST,
    [
      [
        "branch: areaMatch ? areaMatch[1].trim() : null,",
        "branch: areaMatch ? areaMatch[2].trim() : null,",
      ],
    ],
    "list",
  ],
  [
    "締切予定時刻を1レースずらす",
    LIST,
    [["time: times[i] ?? null,", "time: times[i + 1] ?? null,"]],
    "list",
  ],
  [
    "レースラベルを読まない",
    LIST,
    [
      [
        '.title16_titleLabels__add2020 .label2")',
        '.title16_titleLabels__add2020 .nolabel")',
      ],
    ],
    "list",
  ],
  [
    "距離を常に1800mにする",
    LIST,
    [
      [
        "distanceM: distance ? parseInt(distance[1], 10) : null,",
        "distanceM: 1800,",
      ],
    ],
    "list",
  ],
  [
    "「-」（データなし）を0にする（平均STが0.00になる）",
    LIST,
    [
      [
        "  return Number.isNaN(v) ? null : v;",
        "  return Number.isNaN(v) ? 0 : v;",
      ],
    ],
    "list",
  ],
  [
    "未知のモーター・ボートの赤表示を記録しない",
    LIST,
    [["if (/^is-fColor/.test(c)) {", "if (false) {"]],
    "list",
  ],
  [
    "展示進入を、艇番にする（行順を読まない）",
    BEFORE,
    [["course: index + 1,", "course: boatNumber,"]],
    "before",
  ],
  [
    "展示STのF/L表記を読まない",
    BEFORE,
    [
      [
        'const flag = t.startsWith("F") ? "F" : t.startsWith("L") ? "L" : null;',
        "const flag = null;",
      ],
    ],
    "before",
  ],
  [
    "欠場の表示（is-miss）を読まない（直前情報）",
    BEFORE,
    [['is_absent: $tbody.hasClass("is-miss"),', "is_absent: false,"]],
    "before",
  ],
  [
    "前走の着順の生表記を捨てる",
    BEFORE,
    [["prev_finish_mark: prevFinishText || null,", "prev_finish_mark: null,"]],
    "before",
  ],
  [
    "前走の着順の全角を半角にしない",
    BEFORE,
    [['    .normalize("NFKC")\n', ""]],
    "before",
  ],
  [
    "拡張の直前情報の行から、欠場艇を落とす",
    ROWS,
    [["(extended && b.is_absent) ||", "false ||"]],
    "rows",
  ],
  [
    // BOA-500: 展示前（当日体重・調整重量だけ）の艇の行を書かない版
    "拡張の直前情報の行から、展示前（体重だけ）の艇を落とす",
    ROWS,
    [
      [
        "(extended && (b.weight_kg != null || b.adjustment_weight != null)),",
        "false,",
      ],
    ],
    "rows",
  ],
  [
    "拡張の直前情報の行に、展示進入を入れない",
    ROWS,
    [["            exhibition_course: b.exhibition_course,\n", ""]],
    "rows",
  ],
  [
    "拡張の race_conditions の行に、ラベルを入れない",
    ROWS,
    [["race_labels: meta.labels.map((label) => label.text),", ""]],
    "rows",
  ],
  [
    "旧形式の出走表の行に、常に新しい列を入れる",
    ROWS,
    [
      [
        "...(extended\n      ? {\n          weight_kg: e.weight_kg,",
        "...(true\n      ? {\n          weight_kg: e.weight_kg,",
      ],
    ],
    "rows",
  ],
  [
    "締切予定時刻の更新の上限（大きく動く値）を無くす",
    ROWS,
    [
      [
        "if (Math.abs(h * 60 + m - (ch * 60 + cm)) > maxShiftMin) {",
        "if (false) {",
      ],
    ],
    "rows",
  ],
  [
    "締切予定時刻が同じでも更新する",
    ROWS,
    [["if (time === current) continue;", ""]],
    "rows",
  ],
];

async function scene1() {
  for (const [label, file, replacements, kind] of mutants) {
    const failed = await withMutant(file, replacements, (mod) =>
      evaluate(
        kind === "list"
          ? { ...realModules, parseRaceListPage: mod.parseRaceListPage }
          : kind === "before"
            ? { ...realModules, parseBeforeInfoPage: mod.parseBeforeInfoPage }
            : {
                ...realModules,
                buildRaceEntryRows: mod.buildRaceEntryRows,
                buildRaceConditionRow: mod.buildRaceConditionRow,
                buildExhibitionRows: mod.buildExhibitionRows,
                planDeadlineUpdates: mod.planDeadlineUpdates,
              },
      ),
    );
    check(
      `変異検証: 「${label}」で検証が失敗する（${failed.length}項目が失敗）`,
      failed.length > 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・readFixture・withMutant） */
export async function runPreRaceParsersScenes6(env) {
  ({ printOut, check, readFixture, withMutant } = env);
  await scene1();
}

async function scene2() {
  // 書き込み経路の変異: 適用状況を確認せず、常に新しい列を書く版は、未適用のDBで失敗する
  {
    const db = createDb({ missing: { exhibition_data: NEW_EXHIBITION_KEYS } });
    const page = realBeforeParser.parseBeforeInfoPage(
      readFixture("beforeinfo", BEFORE_FILES.absent),
    );
    const rows = realRows.buildExhibitionRows("R", page.boats, {
      extended: true,
    });
    const { error } = await db.from("exhibition_data").upsert(rows, {
      onConflict: "race_id,boat_number",
    });
    check(
      "変異検証: 未適用のDBに拡張の行を確認なしで書くと、書き込みがエラーになる（適用状況の確認が必要な理由）",
      Boolean(error),
    );
  }
  // ---------------------------------------------------------------------------
  console.log = printOut;
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・readFixture・withMutant） */
export async function runPreRaceParsersScenes7(env) {
  ({ printOut, check, readFixture, withMutant } = env);
  await scene2();
}

function scene3() {
  printOut("\n✅ 全て合格");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・readFixture・withMutant） */
export function runPreRaceParsersScenes8(env) {
  ({ printOut, check, readFixture, withMutant } = env);
  scene3();
}
