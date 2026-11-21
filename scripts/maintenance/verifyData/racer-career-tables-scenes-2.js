/**
 * verify-racer-career-tables.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-racer-career-tables.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNT_COLUMNS, runKbEra, RULE_VERSION, writeCareerRows } from "../../lib/racerCareerJob.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { rowsOf, fakeClient } from "./racer-career-tables-scenes-1.js";

let db, quiet;

/** test("kb 層: 着のコード・期・優勝戦・グレードの補正・境目を数え、もう一度走らせても書かない", async () => { の中身を割った 1/2 */
async function careerKbLayer1() {
  const client = await fakeClient();
  const { meta } = await runKbEra({ client, dryRun: false, log: quiet });

  // 着のコード（NULL は数えない、ZZ は other_code）
  const v1 = rowsOf(client, "racer_venue_stats", (r) => r.venue_code === 1);
  const sum = (racer, col) =>
    v1.filter((r) => r.racer_id === racer).reduce((a, r) => a + r[col], 0);
  assert.deepEqual(
    [
      sum(301, "f"),
      sum(301, "s1"),
      sum(302, "l0"),
      sum(302, "other_code"),
      sum(303, "k0"),
      sum(303, "k1"),
    ],
    [1, 1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    [
      sum(304, "s0"),
      sum(304, "l1"),
      sum(305, "code00"),
      sum(305, "s2"),
      sum(306, "p1"),
    ],
    [1, 1, 1, 1, 1],
  );
  assert.equal(
    v1
      .filter((r) => r.racer_id === 306)
      .reduce((a, r) => a + COUNT_COLUMNS.reduce((s, c) => s + r[c], 0), 0),
    1,
    "NULL の着は数えない",
  );

  // 期: 2019-04 は 2018-11 の期、5/1・11/1 はその月の期
  const terms301 = rowsOf(client, "racer_term_stats", (r) => r.racer_id === 301)
    .map((r) => r.term_start)
    .sort();
  assert.deepEqual(
    [...new Set(terms301)],
    ["2018-11-01", "2019-05-01", "2019-11-01"],
  );
  // 進入コース別: K0（進入なし）は数えない。301 の1コースは F・S1（2019-04）と 01（5月・11月）
  const c301 = rowsOf(
    client,
    "racer_course_stats",
    (r) => r.racer_id === 301 && r.course === 1,
  );
  assert.deepEqual(c301.map((r) => [r.term_start, r.f, r.s1, r.p1]).sort(), [
    ["2018-11-01", 1, 1, 0],
    ["2019-05-01", 0, 0, 1],
    ["2019-11-01", 0, 0, 1],
  ]);
  assert.equal(
    rowsOf(client, "racer_course_stats", (r) => r.racer_id === 303 && r.k0 > 0)
      .length,
    0,
  );

  // 優勝戦の出走: GP優勝戦（stage_kind=other）は SG。QC は賞金女王決定が G1・シリーズの優勝戦が G3。CC は12Rの組が SG・11R が G2
  const champ = (race, racer) =>
    rowsOf(
      client,
      "racer_championships",
      (r) => r.race_id === race && r.racer_id === racer,
    )[0];
  assert.equal(champ("2019-12-22-04-12", 101).race_grade, "SG");
  assert.equal(champ("2019-12-22-04-12", 101).finish_code, "01");
  assert.equal(champ("2024-12-31-07-12", 101).race_grade, "G1");
  assert.equal(champ("2024-12-31-07-11", 201).race_grade, "G3");
  assert.equal(champ("2024-11-24-19-12", 501).race_grade, "SG");
  assert.equal(champ("2024-11-24-19-11", 601).race_grade, "G2");
  assert.equal(rowsOf(client, "racer_championships").length, 6 * 5);
  // 優勝戦でないレースの補正: QC のトライアル G1・シリーズの一般戦 G3、CC 初日の 501 の組 SG・601 の組 G2、唐津 2024 は G1・2022 は ippan
  const grades = (racer, venue) => [
    ...new Set(
      rowsOf(
        client,
        "racer_venue_stats",
        (r) => r.racer_id === racer && r.venue_code === venue && !r.is_final,
      ).map((r) => r.race_grade),
    ),
  ];
  assert.deepEqual(
    [grades(101, 7), grades(201, 7), grades(501, 19), grades(601, 19)],
    [["G1"], ["G3"], ["SG"], ["G2"]],
  );
  return { client, meta, grades };
}

/** test("kb 層: 着のコード・期・優勝戦・グレードの補正・境目を数え、もう一度走らせても書かない", async () => { の中身を割った 2/2 */
async function careerKbLayer2({ client, grades, meta }) {
  assert.deepEqual(grades(701, 23).sort(), ["G1", "ippan"]);
  // 境目: kb の 2025-12-02 は数え、2025-12-03 は数えない
  const v5 = rowsOf(
    client,
    "racer_venue_stats",
    (r) => r.racer_id === 801 && r.venue_code === 5,
  );
  assert.deepEqual(
    v5.map((r) => [r.era, r.p1]),
    [["kb", 1]],
  );

  // 記録
  const m = rowsOf(client, "racer_career_meta")[0];
  assert.equal(m.era, "kb");
  assert.equal(m.rule_version, RULE_VERSION);
  assert.equal(m.source_to, "2025-12-02");
  assert.deepEqual(
    [
      m.fingerprint.venue_days,
      m.fingerprint.races,
      m.fingerprint.max_race_date,
    ],
    [12, 17, "2025-12-03"],
  );
  assert.equal(
    meta.source_rows,
    Object.values(m.fingerprint.boats_by_year).reduce((a, b) => a + b, 0),
  );

  // もう一度走らせても、件数の表は書かない（変更の無い行は書かない）・消さない
  const before = client.writes.length;
  await runKbEra({ client, dryRun: false, log: quiet });
  const again = client.writes
    .slice(before)
    .filter((w) => w.table !== "racer_career_meta" && w.count > 0);
  assert.deepEqual(again, []);

  // 元の艇が消えたら、件数が0になったセルを消す（2022 の唐津の節を消す）
  await db.exec(
    "DELETE FROM kb_archive_boats WHERE race_id LIKE '2022-01-08-23-%'",
  );
  await runKbEra({ client, dryRun: false, log: quiet });
  assert.deepEqual(grades(701, 23), ["G1"]);
  await db.exec(`INSERT INTO kb_archive_boats(race_id, boat_number, racer_id, course, finish_raw)
    SELECT '2022-01-08-23-01', n, 700 + n, n, lpad(n::text, 2, '0') FROM generate_series(1, 6) n`);
}

function scene1() {
  test("kb 層: 着のコード・期・優勝戦・グレードの補正・境目を数え、もう一度走らせても書かない", async () => {
    const { client, meta, grades } = await careerKbLayer1();
    await careerKbLayer2({ client, grades, meta });
  });
  test("消えるセルが多すぎれば何も書かずに止める", async () => {
    const zero = Object.fromEntries(COUNT_COLUMNS.map((c) => [c, 0]));
    const existing = Array.from({ length: 100 }, (_, i) => ({
      racer_id: i,
      venue_code: 1,
      era: "kb",
      race_grade: "ippan",
      is_final: false,
      ...zero,
      p1: 1,
    }));
    const client = createFakeSupabaseClient({
      tables: { racer_venue_stats: existing },
    });
    const acc = new Map([
      ["venue", new Map()],
      ["term", new Map()],
      ["course", new Map()],
      ["finals", new Map()],
    ]);
    await assert.rejects(
      writeCareerRows(client, { era: "kb", acc, dryRun: false }),
      /消えるセルが 100\/100 件で多すぎる/,
    );
    assert.equal(client.data.racer_venue_stats.length, 100);

    // 後の表（進入コース別）で止まるときも、前の表（場別）に書かない（4表とも判定してから書く）
    const course = existing.map(
      ({ venue_code: _v, race_grade: _g, is_final: _f, ...r }) => ({
        ...r,
        course: 1,
        term_start: "2019-05-01",
      }),
    );
    const client2 = createFakeSupabaseClient({
      tables: { racer_course_stats: course },
    });
    const acc2 = new Map([
      ["venue", new Map([["x", { ...existing[0], racer_id: 999 }]])],
      ["term", new Map()],
      ["course", new Map()],
      ["finals", new Map()],
    ]);
    await assert.rejects(
      writeCareerRows(client2, { era: "kb", acc: acc2, dryRun: false }),
      /racer_course_stats（kb）: 消えるセル/,
    );
    assert.equal((client2.data.racer_venue_stats ?? []).length, 0);
  });
  test("既存行の読みがちょうど1000行で返ったら、書かずに止める（上限で切れた既存行で比べない）", async () => {
    const { upsertChangedRows } = await import("../../lib/unchangedRows.js");
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      racer_id: 1,
      venue_code: i,
      p1: 1,
    }));
    const client = createFakeSupabaseClient({
      tables: { racer_venue_stats: rows },
    });
    const res = await upsertChangedRows(
      client,
      "racer_venue_stats",
      [{ racer_id: 1, venue_code: 0, p1: 2 }],
      {
        onConflict: "racer_id,venue_code",
        keyColumns: ["racer_id", "venue_code"],
        chunkColumn: "racer_id",
        fullPageRows: 1000,
        failOnFetchError: true,
      },
    );
    assert.match(res.error.message, /1000 行で返った/);
    assert.equal(res.written, 0);
    assert.equal(client.data.racer_venue_stats[0].p1, 1);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・quiet） */
export function runRacerCareerTablesScenes2(env) {
  ({ db, quiet } = env);
  scene1();
}
