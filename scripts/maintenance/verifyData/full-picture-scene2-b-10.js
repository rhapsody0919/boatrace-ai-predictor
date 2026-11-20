/**
 * verify-full-picture-scene2.js の後半の場面（10/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { fin } from "./full-picture-scene2-b-9.js";
import { got, run, pre } from "./full-picture-scene2-b-4.js";
import { seenQueries } from "./full-picture-scene2-b-3.js";
import { date, live } from "./full-picture-scene2-b-1.js";

let validate, m;
let withKb, kb1;
export let noStage, noPeriods;

// 優出・優勝回数（racer_period_stats の finals・wins）
const pf = (n) => got.db.exhibition.boats[n - 1].period_finals;

function scene1() {
  assert.deepEqual(
    [fin(2).runs, fin(2).absent_runs, fin(2).win_rate],
    [0, 1, null],
    "欠場は走数に入れない（走0なら率は null）",
  );
  assert.deepEqual(
    [
      fin(3).runs,
      fin(3).wins,
      fin(3).fl_runs,
      fin(3).boat1_runs,
      fin(3).boat1_win_rate,
    ],
    [2, 1, 1, 0, null],
    "F は走数に入れ1着にしない、着の表記が無い走は rank1 で1着を決める",
  );
  assert.deepEqual(
    [
      fin(4).runs,
      fin(4).boat1_runs,
      fin(4).boat1_wins,
      fin(4).boat1_win_rate,
      fin(4).fl_runs,
    ],
    [1, 1, 0, 0, 1],
    "1号艇の L は1号艇の走で1着でない",
  );
  assert.deepEqual(
    [fin(5).runs, fin(5).absent_runs],
    [0, 1],
    "race_entries.is_absent の走は欠場",
  );
  assert.equal(fin(6), null, "選手が分からない艇は null");
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.final_race_record.kb_archive" &&
        /本体の窓（2025-12-03〜）だけ/.test(x.reason),
    ),
    "kb_archive が読めないことをレースの単位で記録",
  );
  assert.equal(
    got.missing.filter((x) => x.source.includes("kb_archive")).length,
    1,
    "kb_archive の欠けは1件だけ（艇ごとに増やさない）",
  );
  assert.ok(
    got.missing.some(
      (x) => x.source === "db.exhibition.boats.6.final_race_record",
    ),
    "選手の分からない艇を記録",
  );
  // /code-review（2026-10-26）#1: 優勝戦の一覧は1000行を超えうるので、ページを並べ替えて読む（並べ替えないとページの境で行が抜け・重なる）
  assert.ok(
    seenQueries.some(
      (x) =>
        x ===
        `race_conditions?select=race_id&race_stage=eq.優勝戦&and=(race_id.gte.2025-12-03,race_id.lt.${m.raceId})&order=race_id`,
    ),
    "優勝戦は race_stage の完全一致、このレースより前、race_id の順で読む",
  );
  // #2: アーカイブもこのレースより前に限る（2025-12-02 より前のレースで取り直したとき、後の優勝戦を数えない）
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("kb_archive_races?") &&
        /stage=eq\.優勝戦/.test(x) &&
        /race_date=lte\.2025-12-02/.test(x) &&
        x.includes(`race_id=lt.${m.raceId}`) &&
        /order=race_id/.test(x),
    ),
    "アーカイブは stage の完全一致、2025-12-02 まで、このレースより前",
  );
}

async function scene2() {
  assert.deepEqual(
    pf(1),
    {
      latest: {
        period_year: 2026,
        period_no: 2,
        calc_from: "2025-11-01",
        calc_to: "2026-04-30",
        starts: 100,
        finals: 3,
        wins: 1,
      },
      last4: {
        periods_count: 4,
        from: "2024-05-01",
        to: "2026-04-30",
        finals: 10,
        wins: 4,
        periods: [
          { period_year: 2026, period_no: 2 },
          { period_year: 2026, period_no: 1 },
          { period_year: 2025, period_no: 2 },
          { period_year: 2025, period_no: 1 },
        ],
      },
    },
    "前期はレースの日より前に締めた最新の期、直近4期の合計（5期目は入れない）",
  );
  // #9: 4期だけ要るので、締めが900日より前の期は読まない
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("racer_period_stats?") &&
        /finals,wins/.test(x) &&
        x.includes(`and=(calc_to.lt.${date},calc_to.gte.2024-04-25)`),
    ),
    "calc_to < レースの日 で、900日より前の期は読まない",
  );
  assert.deepEqual(
    [pf(3).last4.periods_count, pf(3).last4.finals],
    [2, 1],
    "期が4期そろわなければある分だけ",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.period_finals.last4" &&
        /2期だけ/.test(x.reason),
    ),
    "4期そろわないことを記録",
  );
  assert.deepEqual(
    [pf(4).latest.finals, pf(4).last4.finals],
    [null, null],
    "finals の無い期があれば合計は null",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.2.period_finals" &&
        /期が無い/.test(x.reason),
    ),
    "期の無い選手を記録",
  );
  assert.deepEqual(
    [pf(2).latest, pf(2).last4.finals, pf(5).last4.finals, pf(5).last4.wins],
    [null, null, 3, 1],
    "期の無い選手は latest が null",
  );
  // アーカイブが読めるとき（権限が付いたら）は窓を合わせる
  live.kbReadable = true;
  withKb = await run({ conditions: pre });
  live.kbReadable = false;
  assert.deepEqual(
    validate(withKb),
    [],
    "アーカイブを合わせた材料も契約に合う",
  );
  kb1 = withKb.db.exhibition.boats[0].final_race_record;
}

async function scene3() {
  assert.deepEqual(
    [
      kb1.complete,
      kb1.runs,
      kb1.wins,
      kb1.boat1_runs,
      kb1.boat1_wins,
      kb1.excluded_races.no_result,
      kb1.rides[0],
    ],
    [
      true,
      3,
      2,
      2,
      2,
      2,
      {
        race_id: "2024-05-05-06-12",
        boat_number: 1,
        kind: "win",
        source: "kb_archive",
      },
    ],
    "アーカイブの 01 は1着、結果なしは除く",
  );
  assert.deepEqual(
    [
      withKb.db.exhibition.boats[1].final_race_record.runs,
      withKb.db.exhibition.boats[1].final_race_record.wins,
      withKb.db.exhibition.boats[2].final_race_record.absent_runs,
    ],
    [1, 0, 1],
    "失格（S1）は走で1着でない、K0 は欠場",
  );
  assert.ok(
    !withKb.missing.some((x) => x.source.includes("kb_archive")),
    "読めれば記録しない",
  );
  // 読めないとき: 本体の優勝戦・期の表が読めなければその欄だけ null
  live.failFinals = "stage";
  noStage = await run({ conditions: pre });
  live.failFinals = "periods";
  noPeriods = await run({ conditions: pre });
  live.failFinals = null;
  assert.deepEqual(validate(noStage), [], "優勝戦が読めない材料も契約に合う");
  assert.ok(
    noStage.db.exhibition.boats.every((b) => b.final_race_record === null) &&
      noStage.db.exhibition.boats[0].period_finals?.latest?.finals === 3,
    "優勝戦が読めなければ成績だけ null",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（validate・m） */
export async function runFullPictureScene2B11(env) {
  ({ validate, m } = env);
  scene1();
  await scene2();
  await scene3();
}
