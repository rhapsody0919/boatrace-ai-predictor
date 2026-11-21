/**
 * verify-race-result-parser.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-race-result-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces, buildRaceResultRow } from "../../daily/scrape-results.js";
import * as realRows from "../../lib/raceResultRows.js";
import { detectResultSchema, clearResultSchemaCache } from "../../lib/raceResultSchema.js";
import { computeResultDigest } from "../../lib/scrapeJobs/resultDigest.js";
import { payoutRowSatisfiesDdl } from "./race-result-parser-cases.js";
import { createSchemaAwareDb } from "./race-result-parser-db.js";
import { LEGACY_TIMING_COLUMNS, runLive, RACE_F4, RACE_ABSENT, NEW_TIMING_COLUMNS, NEW_RESULT_COLUMNS } from "./race-result-parser-scenes-2.js";
import { CASES } from "./race-result-parser-scenes-1.js";

let check, show, same, readFixture, full, LEGACY_RESULT_COLUMNS, RACES, fetchHtmlFor, seedRaces, fullColumns;

async function scene1() {
  // 未適用（077〜079いずれも無い）
  {
    const db = createSchemaAwareDb(
      { races: seedRaces },
      {
        columns: {
          race_results: LEGACY_RESULT_COLUMNS.concat(["created_at"]),
          race_start_timings: LEGACY_TIMING_COLUMNS,
        },
        tableMissing: ["race_payouts"],
      },
    );
    const outcomes = await runLive(db);
    const timings = db.tables.race_start_timings ?? [];
    const results = db.tables.race_results ?? [];
    check(
      "未適用のDB（077〜079なし）: 結果取得が成功（error なし）",
      outcomes.every((o) => o.outcome === "partial" || o.outcome === "ok") &&
        outcomes.every((o) => !o.error),
      show(outcomes.map((o) => [o.race_id, o.outcome, o.error])),
    );
    check(
      "未適用のDB: 書き込みの失敗（列が無いエラー）が1件も無い（旧実装と同じ列だけを書いた）",
      db.writes.every((w) => !w.failed),
      show(db.writes.filter((w) => w.failed)),
    );
    check(
      "未適用のDB: race_start_timings は、STを読めた艇の行だけ（戸田9R=6行、唐津12R=5行。欠場艇の行は作らない）、新しい列を含まない",
      timings.filter((r) => r.race_id === RACE_F4).length === 6 &&
        timings.filter((r) => r.race_id === RACE_ABSENT).length === 5 &&
        timings.every((r) => NEW_TIMING_COLUMNS.every((c) => !(c in r))),
    );
    check(
      "未適用のDB: race_results は新しい列（race_status・refund_boats・remark）を含まない。払戻の¥100は入らず、欠場艇は rank に入らない",
      results.length === 2 &&
        results.every((r) => NEW_RESULT_COLUMNS.every((c) => !(c in r))) &&
        results.find((r) => r.race_id === RACE_F4).payout_trifecta === null &&
        results.find((r) => r.race_id === RACE_ABSENT).rank6 === null,
    );
    check(
      "未適用のDB: race_payouts へ書かない（テーブルが無い）",
      !db.writes.some((w) => w.table === "race_payouts"),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・readFixture・full・LEGACY_RESULT_COLUMNS・RACES・fetchHtmlFor・seedRaces） */
export async function runRaceResultParserScenes5(env) {
  ({ check, show, same, readFixture, full, LEGACY_RESULT_COLUMNS, RACES, fetchHtmlFor, seedRaces } = env);
  await scene1();
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene2() {
  const db = createSchemaAwareDb(
    { races: seedRaces },
    { columns: fullColumns },
  );
  const outcomes = await runLive(db);
  const timings = db.tables.race_start_timings ?? [];
  const results = db.tables.race_results ?? [];
  const payouts = db.tables.race_payouts ?? [];
  check(
    "適用済みのDB（077〜079）: 結果取得が成功し、書き込みの失敗が無い",
    outcomes.every((o) => !o.error) && db.writes.every((w) => !w.failed),
    show(db.writes.filter((w) => w.failed)),
  );
  check(
    "適用済みのDB: race_start_timings は全艇の行（戸田9R・唐津12Rとも6行。欠場艇を含む）。欠場艇は着欄「欠」・進入NULL・STなし",
    timings.filter((r) => r.race_id === RACE_F4).length === 6 &&
      timings.filter((r) => r.race_id === RACE_ABSENT).length === 6 &&
      (() => {
        const absent = timings.find(
          (r) => r.race_id === RACE_ABSENT && r.boat_number === 1,
        );
        return (
          absent.finish_mark === "欠" &&
          absent.entry_course === null &&
          absent.start_timing === null &&
          absent.finish_rank === null
        );
      })() &&
      timings.every(
        (r) =>
          r.updated_at === "2026-09-19T08:00:00.000Z" ||
          typeof r.updated_at === "string",
      ),
  );
  check(
    "適用済みのDB: race_results に race_status・refund_boats・remark が入る（戸田9R=partial_refund・[3,4,5,6]、唐津12R=partial_refund・[1]）",
    results.find((r) => r.race_id === RACE_F4).race_status ===
      "partial_refund" &&
      same(
        results.find((r) => r.race_id === RACE_F4).refund_boats,
        [3, 4, 5, 6],
      ) &&
      results.find((r) => r.race_id === RACE_ABSENT).race_status ===
        "partial_refund" &&
      same(results.find((r) => r.race_id === RACE_ABSENT).refund_boats, [1]) &&
      results.find((r) => r.race_id === RACE_ABSENT).remark ===
        "【返還艇あり】",
  );
  check(
    "適用済みのDB: race_payouts に払戻明細（戸田9R=単勝1・複勝1・2連単1・他の不成立の行を含む。唐津12R=拡連複3口・複勝2口を含む）",
    payouts.filter((r) => r.race_id === RACE_F4).length === 7 &&
      payouts.filter((r) => r.race_id === RACE_ABSENT).length === 10 &&
      payouts.filter((r) => r.race_id === RACE_ABSENT && r.bet_type === "wide")
        .length === 3 &&
      payouts.filter((r) => r.race_id === RACE_F4).every(payoutRowSatisfiesDdl),
  );
  // 再実行: 完了済みのレースは取得しない（skipped_have_data）。ここでは、変更の無い行を書かないことを、行の書き込み側で確認する
  const before = db.writes.length;
  const finished = new Set();
   // 何も追加しない
  void finished;
  const again = await runForRaces(
    RACES.filter((r) => r.race_id === RACE_F4),
    {
      date: "2026-09-19",
      mode: "live",
      fetchHtml: fetchHtmlFor,
      client: db,
      now: () => new Date("2026-09-19T09:00:00Z"),
    },
  );
  return { db, before, again };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene3({ db, before, again }) {
  check(
    "適用済みのDB: 完了済みのレースを再実行しても、取得も書き込みもしない（skipped_have_data）",
    again[0].outcome === "skipped_have_data" && db.writes.length === before,
  );
}

async function scene4() {
  {
    const s1 = await scene2();
    scene3(s1);
  }
  // 077だけ適用（078・079は未適用）
  {
    const db = createSchemaAwareDb(
      { races: seedRaces },
      {
        columns: {
          race_results: LEGACY_RESULT_COLUMNS.concat(["created_at"]),
          race_start_timings: LEGACY_TIMING_COLUMNS.concat(NEW_TIMING_COLUMNS),
        },
        tableMissing: ["race_payouts"],
      },
    );
    const outcomes = await runLive(db);
    check(
      "部分適用（077のみ）: 艇別の行は全艇分を書き、race_results は新しい列を含まず、race_payouts へは書かない。失敗なし",
      outcomes.every((o) => !o.error) &&
        db.writes.every((w) => !w.failed) &&
        (db.tables.race_start_timings ?? []).filter(
          (r) => r.race_id === RACE_ABSENT,
        ).length === 6 &&
        (db.tables.race_results ?? []).every((r) =>
          NEW_RESULT_COLUMNS.every((c) => !(c in r)),
        ) &&
        !db.writes.some((w) => w.table === "race_payouts"),
    );
  }
  // 確認の通信エラー
  {
    const db = createSchemaAwareDb(
      { races: seedRaces },
      { columns: fullColumns, probeError: "network down" },
    );
    const outcomes = await runLive(db);
    check(
      "適用状況の確認が通信エラー: 旧形式で書く（STを読めた艇の行だけ・新しい列なし）。結果取得は失敗にしない",
      outcomes.every((o) => !o.error) &&
        (db.tables.race_start_timings ?? []).filter(
          (r) => r.race_id === RACE_ABSENT,
        ).length === 5 &&
        (db.tables.race_results ?? []).every((r) =>
          NEW_RESULT_COLUMNS.every((c) => !(c in r)),
        ) &&
        !db.writes.some((w) => w.table === "race_payouts"),
    );
  }
}

async function scene5() {
  // 119（official_row）の適用前後（BOA-667）
  {
    const before = createSchemaAwareDb(
      { races: seedRaces },
      { columns: fullColumns },
    );
    await runLive(before);
    const after = createSchemaAwareDb(
      { races: seedRaces },
      {
        columns: {
          ...fullColumns,
          race_start_timings: fullColumns.race_start_timings.concat([
            "official_row",
          ]),
        },
      },
    );
    const outcomes = await runLive(after);
    const timings = after.tables.race_start_timings ?? [];
    // 唐津12R の公式の着順表は 4→6→5→3→2→1（1号艇が欠場で最後の行）、戸田9R は 2→1→3→4→5→6（Fが4艇）
    const rowsOf = (raceId) =>
      timings
        .filter((r) => r.race_id === raceId)
        .sort((a, b) => a.official_row - b.official_row)
        .map((r) => r.boat_number);
    check(
      "119未適用のDB: race_start_timings に official_row を書かない（書き込みの失敗も無い）",
      (before.tables.race_start_timings ?? []).every(
        (r) => !("official_row" in r),
      ) && before.writes.every((w) => !w.failed),
    );
    check(
      "119適用済みのDB: race_start_timings の全艇に official_row（公式の着順表の行の順）が入る",
      outcomes.every((o) => !o.error) &&
        after.writes.every((w) => !w.failed) &&
        timings.length === 12 &&
        same(
          rowsOf(RACE_ABSENT),
          CASES.find((c) => c.file.includes("2026-09-16-23-12")).boats,
        ) &&
        same(
          rowsOf(RACE_F4),
          CASES.find((c) => c.file.includes("2026-09-19-02-09")).boats,
        ),
      show(timings.map((r) => [r.race_id, r.boat_number, r.official_row])),
    );
  }
  // 判定のキャッシュ
  {
    const db = createSchemaAwareDb({}, { columns: fullColumns });
    let clock = 0;
    const first = await detectResultSchema(db, { now: () => clock, ttlMs: 1000 });
    const readsAfterFirst = db.reads.length;
    await detectResultSchema(db, { now: () => clock + 500, ttlMs: 1000 });
    const cachedNoRead = db.reads.length === readsAfterFirst;
    await detectResultSchema(db, { now: () => clock + 1500, ttlMs: 1000 });
    check(
      "適用状況の判定: 3つとも適用済みと判定し、TTL内はキャッシュ（再確認しない）、TTL後に再確認する",
      first.timings &&
        first.results &&
        first.payouts &&
        cachedNoRead &&
        db.reads.length === readsAfterFirst * 2,
    );
  }
}

async function scene6() {
  // 不成立のレースは、決まり手が出なくても完了（毎分再取得し続けない）
  {
    const raceId = "2026-08-07-24-01";
    const html = readFixture("raceresult-2026-08-07-24-01-no-race-6f.html");
    const db = createSchemaAwareDb(
      { races: [{ race_id: raceId, start_time: "10:00" }] },
      { columns: fullColumns },
    );
    clearResultSchemaCache(db);
    const [outcome] = await runForRaces(
      [
        {
          race_id: raceId,
          venue_code: 24,
          race_number: 1,
          start_time: new Date("2026-08-07T01:00:00Z"),
        },
      ],
      {
        date: "2026-08-07",
        mode: "live",
        fetchHtml: async () => html,
        client: db,
        now: () => new Date("2026-08-07T02:00:00Z"),
      },
    );
    check(
      "不成立（全勝式が不成立）のレースは、決まり手が無くても完了（ok）。旧実装は決まり手が未公開として再取得し続けた",
      outcome.outcome === "ok" && !outcome.error,
      show(outcome),
    );
  }
  // result_digest の互換: 拡張の艇別の行（STなし）が混ざっても、解析側とDB側で同じダイジェスト
  {
    const parsed = realRows.toLegacyResult(
      full("raceresult-2026-09-16-23-12-absent.html"),
    );
    const row = buildRaceResultRow(RACE_ABSENT, parsed);
    const parsedSide = computeResultDigest(
      row,
      parsed.startTimings.map((st) => ({ race_id: RACE_ABSENT, ...st })),
    );
    const dbSide = computeResultDigest(
      row,
      realRows.buildTimingRows(RACE_ABSENT, parsed, { extended: true }),
    );
    const legacyDbSide = computeResultDigest(
      row,
      realRows.buildTimingRows(RACE_ABSENT, parsed, { extended: false }),
    );
    check(
      "result_digest: 077適用後のDB（STなしの艇の行を含む6行）でも、旧形式（5行）・解析側と同じダイジェスト",
      parsedSide === dbSide && parsedSide === legacyDbSide,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・readFixture・full・LEGACY_RESULT_COLUMNS・RACES・fetchHtmlFor・seedRaces・fullColumns） */
export async function runRaceResultParserScenes6(env) {
  ({ check, show, same, readFixture, full, LEGACY_RESULT_COLUMNS, RACES, fetchHtmlFor, seedRaces, fullColumns } = env);
  await scene4();
  await scene5();
  await scene6();
}
