/**
 * verify-pre-race-parsers.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-pre-race-parsers.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { detectPreRaceSchema, clearPreRaceSchemaCache } from "../../lib/preRaceSchema.js";
import { scrapeAndUpsertRaces } from "../../daily/scrape-exhibition-data.js";
import { createDb, withFetch } from "./pre-race-parsers-fakes.js";
import { jstDate, NEW_EXHIBITION_KEYS, NEW_ENTRY_KEYS } from "./pre-race-parsers-scenes-2.js";
import { BEFORE_FILES } from "./pre-race-parsers-scenes-1.js";

let check, show, same, readFixture;

export const LIST = "raceListParser.js";

export const BEFORE = "beforeInfoParser.js";

export const ROWS = "preRaceRows.js";

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const RACE_ID = "2026-09-16-23-12";
  const target = [
    {
      race_id: RACE_ID,
      venue_code: 23,
      race_no: 12,
      start_time: jstDate("14:21"),
    },
  ];
  const beforeFor = (file) => readFixture("beforeinfo", file);
  const runA2 = (db, file) =>
    withFetch(
      (url) => (url.includes("/beforeinfo?") ? beforeFor(file) : null),
      () => scrapeAndUpsertRaces(target, "2026-09-16", { client: db }),
    );
  const exhibitionRows = (db) =>
    db.state.upserts
      .filter((u) => u.table === "exhibition_data")
      .flatMap((u) => u.rows);
  const LEGACY_EXH_KEYS = [
    "race_id",
    "boat_number",
    "exhibition_time",
    "start_timing",
    "tilt",
    "propeller_change",
    "parts_changed",
    "adjustment_weight",
    "today_weight",
    "prev_race_no",
    "prev_entry_course",
    "prev_start_timing",
    "prev_finish_rank",
    "updated_at",
  ];
  {
    const db = createDb({ missing: { exhibition_data: NEW_EXHIBITION_KEYS } });
    const result = await runA2(db, BEFORE_FILES.absent);
    const rows = exhibitionRows(db);
    check(
      "A2（082未適用）: 旧実装と同じ列だけを書く（展示タイム・STのある5艇。欠場艇の行は書かない）",
      result.updated === true &&
        rows.length === 5 &&
        rows.every((r) =>
          Object.keys(r).every((k) => LEGACY_EXH_KEYS.includes(k)),
        ),
      show(rows[0]),
    );
    const before = db.state.upserts.length;
    await runA2(db, BEFORE_FILES.absent);
    check(
      "A2（082未適用）: 再実行は書き込み0件",
      db.state.upserts.length === before,
    );
  }
  return { runA2, exhibitionRows, LEGACY_EXH_KEYS };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ runA2, exhibitionRows, LEGACY_EXH_KEYS }) {
  {
    const db = createDb();
    await runA2(db, BEFORE_FILES.absent);
    const rows = exhibitionRows(db);
    check(
      "A2（082適用済み）: 展示進入・展示STのF・前走の着順の生表記・欠場を書く（欠場艇の行も書く）",
      rows.length === 6 &&
        NEW_EXHIBITION_KEYS.every((k) => rows.every((r) => k in r)) &&
        same(
          rows.map((r) => [
            r.boat_number,
            r.exhibition_course,
            r.start_flag,
            r.is_absent,
          ]),
          [
            [1, null, null, true],
            [2, 1, "F", false],
            [3, 2, null, false],
            [4, 3, null, false],
            [5, 4, null, false],
            [6, 5, null, false],
          ],
        ) &&
        rows[0].exhibition_time === null &&
        rows[0].today_weight === 55.2 &&
        rows[0].prev_finish_mark === "4",
      show(rows[0]),
    );
    const before = db.state.upserts.length;
    await runA2(db, BEFORE_FILES.absent);
    check(
      "A2（082適用済み）: 再実行は書き込み0件",
      db.state.upserts.length === before,
    );
  }
  {
    const db = createDb();
    const result = await runA2(db, BEFORE_FILES.pre);
    check(
      "A2（082適用済み）: 展示航走前のページは、旧実装と同じく書き込まない（欠場でない艇の行は作らない）",
      result.updated === false && exhibitionRows(db).length === 0,
    );
  }
  {
    const db = createDb({ throwOnProbe: true });
    await runA2(db, BEFORE_FILES.absent);
    const rows = exhibitionRows(db);
    check(
      "A2: 適用状況の確認が失敗したときは、旧形式で書く（安全側）",
      rows.length === 5 &&
        rows.every((r) =>
          Object.keys(r).every((k) => LEGACY_EXH_KEYS.includes(k)),
        ),
    );
  }
}

async function scene3() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  // --- 適用状況の判定 ---
  {
    const db = createDb({
      missing: { race_entries: NEW_ENTRY_KEYS, exhibition_data: ["is_absent"] },
    });
    const detected = await detectPreRaceSchema(db, { warn: () => {} });
    check(
      "適用状況の判定: 列が無いテーブルは false、揃っているテーブルは true（1列でも欠ければ false）",
      same(detected, {
        raceEntries: false,
        raceConditions: true,
        exhibition: false,
      }),
      show(detected),
    );
    clearPreRaceSchemaCache(db);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・readFixture） */
export async function runPreRaceParsersScenes4(env) {
  ({ check, show, same, readFixture } = env);
  await scene3();
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・readFixture） */
export function runPreRaceParsersScenes5(env) {
  ({ check, show, same, readFixture } = env);

}
