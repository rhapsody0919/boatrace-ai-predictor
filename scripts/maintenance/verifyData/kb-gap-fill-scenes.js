/**
 * verify-kb-gap-fill.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-kb-gap-fill.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { DATE, show } from "./kb-gap-fill-fixtures.js";

let check, g, withMutant, LIB, MB_R1;

const MB_DAY = {
  date: DATE,
  k: {
    venues: [
      {
        venue_code: 1,
        races: [
          {
            race_number: 1,
            rows: [
              {
                boat_number: 1,
                finish_raw: "01",
                course: 1,
                start_timing: 0.12,
              },
              {
                boat_number: 2,
                finish_raw: "K1",
                course: null,
                start_timing: null,
              },
              {
                boat_number: 3,
                finish_raw: "K0",
                course: null,
                start_timing: null,
              },
              {
                boat_number: 4,
                finish_raw: "F",
                course: 4,
                start_timing: -0.02,
                is_flying: true,
              },
              {
                boat_number: 5,
                finish_raw: "L0",
                course: null,
                start_timing: null,
                is_late_start: true,
              },
              {
                boat_number: 6,
                finish_raw: "S1",
                course: 6,
                start_timing: 0.15,
              },
            ],
          },
          // races に無いレース（作らない）
          {
            race_number: 2,
            rows: [{ boat_number: 1, finish_raw: "K0", course: null }],
          },
        ],
      },
    ],
  },
};

function evaluateMissingBoats(gm) {
  const rows = gm.buildMissingBoatRows(MB_DAY, {
    raceIds: new Set([MB_R1]),
    existingKeys: new Set([`${MB_R1}|1`]),
  });
  const row = (b, st, fly, late, course, mark, rank, code) => ({
    race_id: MB_R1,
    boat_number: b,
    start_timing: st,
    is_flying: fly,
    is_late_start: late,
    entry_course: course,
    finish_mark: mark,
    finish_rank: rank,
    official_finish_code: code,
    created_at: null,
  });
  const want = [
    row(2, null, false, false, null, "欠", null, "K1"),
    row(3, null, false, false, null, "欠", null, "K0"),
    row(4, 0.02, true, false, 4, "F", null, "F"),
    row(5, null, false, true, null, "L", null, "L0"),
    row(6, 0.15, false, false, 6, null, null, "S1"),
  ];
  return show(rows) === show(want) &&
    Object.keys(rows[0]).sort().join() ===
      [...gm.GAP_FILL_ITEMS.missing_boats.columns].sort().join()
    ? []
    : [`(i) 行 ${show(rows)}`];
}

async function scene1() {
  {
    const mb = evaluateMissingBoats(g);
    check(
      "(i) 欠場艇等の行: 行の無い艇だけ（既存の1号艇は作らない）、races にあるレースだけ。欠場は「欠」・ST と進入は NULL、F は ST の絶対値、L は is_late_start、失格は着欄 NULL。成績コードは K のまま、created_at は NULL。列は GAP_FILL_ITEMS と同じ",
      mb.length === 0,
      mb.join(" / "),
    );
    for (const [label, from, to] of [
      [
        "既存の行のある艇も作る",
        "if (existingKeys.has(`${raceId}|${r.boat_number}`)) continue;",
        "",
      ],
      [
        "races に無いレースも作る",
        "    if (!raceIds.has(raceId)) continue;\n    for (const r of race.rows ?? []) {\n      if (!Number.isInteger(r.boat_number)) continue;\n      if (existingKeys",
        "    for (const r of race.rows ?? []) {\n      if (!Number.isInteger(r.boat_number)) continue;\n      if (existingKeys",
      ],
      [
        "created_at に取得時刻を入れる",
        "        created_at: null,\n      });\n    }\n  }\n  return rows;\n}\n\n/**\n * 項目6",
        "        created_at: new Date().toISOString(),\n      });\n    }\n  }\n  return rows;\n}\n\n/**\n * 項目6",
      ],
    ]) {
      const failed = await withMutant(LIB, from, to, (m) =>
        evaluateMissingBoats(m),
      );
      check(
        `(i) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
        failed.length > 0,
      );
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・g・withMutant・LIB・MB_R1） */
export async function runKbGapFillScenes1(env) {
  ({ check, g, withMutant, LIB, MB_R1 } = env);
  await scene1();
}
