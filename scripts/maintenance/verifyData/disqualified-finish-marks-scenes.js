/**
 * verify-disqualified-finish-marks.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-disqualified-finish-marks.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let check, show, fixture, PAGES, TAMA, t, evaluateRows, evaluatePlan, evaluateFetchWindow, fakeClient, evaluateApply, withMutant;
let lib, parser, cli, r, p, a, o, w;

/**
 * (e) BOA-667: 公式の行の順（official_row）を、取り直した結果ページから既存の行へ写す。
 * 着欄（失格）と同じ1回の取得で、両方の行を計画に入れる。書き込みは official_row が NULL の行だけ
 */
async function evaluateOfficialRow(lib, parser, cli) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  // 多摩川12R の着順表は 2→3→1→4(落)→5(転)→6(F)
  const tama = parser.parseRaceResultPage(
    fixture("raceresult-2026-09-10-05-12-fall-capsize-f.html"),
  ).boats;
  const built = lib.buildOfficialRowRows(TAMA, tama, [
    { boat_number: 1 },
    { boat_number: 6 },
    { boat_number: 7 },
  ]);
  expect(
    "(e) 行の順を着順表の上からの順で書く（1号艇=3、6号艇=6）。着順表に無い艇は異常",
    JSON.stringify(built.rows) ===
      JSON.stringify([
        { race_id: TAMA, boat_number: 1, official_row: 3 },
        { race_id: TAMA, boat_number: 6, official_row: 6 },
      ]) && built.anomalies.length === 1,
    show(built),
  );
  const fetched = [];
  const plan = await cli.buildPlan(
    [
      { ...t(TAMA, 4, "S1"), kind: "mark" },
      ...[1, 2, 3, 4, 5, 6].map((b) => ({
        race_id: TAMA,
        boat_number: b,
        kind: "row",
      })),
    ],
    {
      fetchHtml: async (url) => (fetched.push(url), fixture(PAGES[url])),
      wait: async () => {},
      log: () => {},
    },
  );
  expect(
    "(e) 計画: 1レース1回の取得で、着欄（4号艇=落）と行の順（6艇）の両方を作る",
    fetched.length === 1 &&
      plan.rows.length === 1 &&
      plan.rows[0].finish_mark === "落" &&
      JSON.stringify(
        plan.officialRows.map((r) => [r.boat_number, r.official_row]),
      ) ===
        JSON.stringify([
          [1, 3],
          [2, 1],
          [3, 2],
          [4, 4],
          [5, 5],
          [6, 6],
        ]),
    show(plan),
  );
  const table = [
    { race_id: TAMA, boat_number: 1, finish_mark: "3", official_row: null },
    { race_id: TAMA, boat_number: 2, finish_mark: "1", official_row: 9 },
  ];
  const client = fakeClient(table);
  const result = await cli.applyPlan([], {
    client,
    now: () => new Date("2026-10-04T00:00:00Z"),
    officialRows: [
      { race_id: TAMA, boat_number: 1, official_row: 3 },
      { race_id: TAMA, boat_number: 2, official_row: 1 },
    ],
  });
  expect(
    "(e) 書き込み: official_row が NULL の行だけ（既存の値は上書きしない）。列は official_row・updated_at",
    JSON.stringify(result) === JSON.stringify({ written: 1, skipped: 1 }) &&
      table[0].official_row === 3 &&
      table[1].official_row === 9 &&
      client.calls.every(
        (c) =>
          Object.keys(c.values).sort().join() === "official_row,updated_at" &&
          c.filters.some(([op, col]) => op === "is" && col === "official_row"),
      ),
    show({ result, table }),
  );
  return failed;
}

const LIB = "scripts/lib/disqualifiedFinishMark.js";

const CLI = "scripts/maintenance/backfill-disqualified-finish-marks.js";

async function scene1() {
  lib = await import("../../lib/disqualifiedFinishMark.js");
  parser = await import("../../lib/raceResultParser.js");
  cli = await import("../backfill-disqualified-finish-marks.js");
  r = evaluateRows(lib, parser);
  check("(a) 行の組み立て", r.length === 0, r.join(" / "));
  p = await evaluatePlan(cli);
  check("(b) 計画（取得）", p.length === 0, p.join(" / "));
  a = await evaluateApply(cli);
  check("(c) 書き込み", a.length === 0, a.join(" / "));
  o = await evaluateOfficialRow(lib, parser, cli);
  check("(e) 公式の行の順（BOA-667）", o.length === 0, o.join(" / "));
  w = await evaluateFetchWindow(cli);
  check("(f) JST取得窓（BOA-779）", w.length === 0, w.join(" / "));
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・fixture・PAGES・TAMA・t・evaluateRows・evaluatePlan・evaluateFetchWindow・fakeClient・evaluateApply・withMutant） */
export async function runDisqualifiedFinishMarksScenes1(env) {
  ({ check, show, fixture, PAGES, TAMA, t, evaluateRows, evaluatePlan, evaluateFetchWindow, fakeClient, evaluateApply, withMutant } = env);
  await scene1();
}

async function scene2() {
  for (const [label, rel, from, to, run] of [
    [
      "失格でない表記も書く",
      LIB,
      "if (!DISQUALIFIED_MARKS.has(boat.finish_mark)) {",
      "if (false) {",
      (m) => evaluateRows(m, parser),
    ],
    [
      "既存の着欄を上書きする（NULL の条件を外す）",
      CLI,
      '.is(column, null)\n      .select("race_id");',
      '.select("race_id");',
      (m) => evaluateApply(m),
    ],
    [
      "429で中止しない",
      CLI,
      "if (error.status === 429 || error.status === 503) {",
      "if (false) {",
      (m) => evaluatePlan(m),
    ],
    [
      "間隔を空けない",
      CLI,
      "if (index > 0) await wait(intervalMs + Math.floor(Math.random() * 1000));",
      "",
      (m) => evaluatePlan(m),
    ],
  ]) {
    const failed = await withMutant(rel, from, to, run);
    check(
      `(d) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・fixture・PAGES・TAMA・t・evaluateRows・evaluatePlan・evaluateFetchWindow・fakeClient・evaluateApply・withMutant） */
export async function runDisqualifiedFinishMarksScenes2(env) {
  ({ check, show, fixture, PAGES, TAMA, t, evaluateRows, evaluatePlan, evaluateFetchWindow, fakeClient, evaluateApply, withMutant } = env);
  await scene2();
}
