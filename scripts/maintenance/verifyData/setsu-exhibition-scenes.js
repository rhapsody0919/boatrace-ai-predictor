/**
 * verify-setsu-exhibition.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-setsu-exhibition.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { setsuExhibitionOf, readSetsuExhibition } from "../../sns/setsu-exhibition.js";

let date, series, races, conditions, entries, exhibitions, motors, rows, result;
let daily, noExhibition, tables, second, overlap;

const calls = [];

const fakeFetchAll = async (table, select, build) => {
  const filters = [];
  const orders = [];
  const q = {};
  for (const op of ["eq", "in", "gte", "lte"])
    q[op] = (key, value) => {
      filters.push([op, key, value]);
      return q;
    };
  q.order = (key) => {
    orders.push(key);
    return q;
  };
  build(q);
  assert.ok(orders.length, `${table} のページ順序`);
  calls.push({ table, select, filters, orders });
  return tables[table].filter((row) =>
    filters.every(([op, key, value]) =>
      op === "eq"
        ? row[key] === value
        : op === "in"
          ? value.includes(row[key])
          : op === "gte"
            ? row[key] >= value
            : row[key] <= value,
    ),
  );
};

function scene1() {
  // 日ごとの秒数が逆転しても、そのレースの中だけで順位を付ける。
  daily = structuredClone(rows);
  daily.exhibitions.find(
    (e) => e.race_id === "202610300101" && e.boat_number === 1,
  ).exhibition_time = 7.5;
  assert.deepEqual(
    setsuExhibitionOf(date, daily).meets[0].racers[5].runs.map(
      (r) => r.exhibition_rank,
    ),
    [4, 1],
  );
  noExhibition = setsuExhibitionOf(date, { ...rows, exhibitions: [] });
  assert.ok(
    noExhibition.meets[0].racers.every((r) =>
      r.runs.every(
        (run) => run.exhibition_rank === null && run.exhibition_time === null,
      ),
    ),
  );
}

function scene2() {
  // 連続開催: 前の節が 11/01 に終わり、新しい節が 11/02 に始まる。新しい節だけを出し、前の節の走を混ぜない（#2101 P1-1）。
  {
    const prev = {
      venue_code: 15,
      start_date: "2026-10-27",
      end_date: "2026-11-01",
      title: "前の節",
      grade: "ippan",
    };
    const next = {
      venue_code: 15,
      start_date: "2026-11-02",
      end_date: "2026-11-06",
      title: "新しい節",
      grade: "ippan",
    };
    const r = (id, d, n) => ({
      race_id: id,
      race_date: d,
      venue_code: 15,
      race_number: n,
      start_time: "15:20:00",
    });
    const cRaces = [
      r("p1", "2026-10-27", 1),
      r("p2", "2026-11-01", 12),
      r("n1", date, 1),
      r("n2", date, 2),
    ];
    const cEntries = cRaces.flatMap((race) =>
      [1, 2].map((b) => ({
        race_id: race.race_id,
        boat_number: b,
        racer_id: race.race_id.startsWith("p") ? 5000 + b : 6000 + b,
        player_name: "x",
        grade: "A1",
        motor_number: b,
      })),
    );
    const cMotors = [
      {
        race_date: "2026-11-02",
        venue_code: 15,
        racer_id: 6001,
        motor_number: 1,
        motor_2rate: 40.5,
      },
    ];
    const out = setsuExhibitionOf(date, {
      series: [prev, next],
      races: cRaces,
      entries: cEntries,
      motors: cMotors,
    });
    assert.equal(out.meets.length, 1, "同じ会場の節は1つだけ");
    assert.equal(out.meets[0].meet_id, "15-2026-11-02");
    assert.deepEqual(
      out.meets[0].racers.map((x) => x.racer_id),
      [6001, 6002],
      "前の節の選手を混ぜない",
    );
    assert.deepEqual(
      out.meets[0].racers.flatMap((x) => x.runs.map((run) => run.race_id)),
      ["n1", "n2", "n1", "n2"],
    );
    assert.equal(
      out.meets[0].racers[0].motor_2rate_at_start,
      40.5,
      "新しい節の初日でモーターを引く",
    );
    // 前の節が順延の許容（3日）の中でも、後に始まった節があれば前の節は出さない。
    assert.equal(
      setsuExhibitionOf("2026-11-03", {
        series: [prev, next],
        races: [...cRaces, r("n3", "2026-11-03", 1)],
        entries: cEntries,
      }).meets[0].meet_id,
      "15-2026-11-02",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（date・series・races・conditions・entries・exhibitions・motors・rows・result） */
export function runSetsuExhibitionScenes1(env) {
  ({ date, series, races, conditions, entries, exhibitions, motors, rows, result } = env);
  scene1();
  scene2();
}

async function scene3() {
  tables = {
    races,
    race_series: series,
    race_conditions: conditions,
    race_entries: entries,
    exhibition_data: exhibitions,
    motor_pretest_stats: motors,
    race_results: [],
  };
  assert.deepEqual(await readSetsuExhibition(date, fakeFetchAll), result);
  // 同じ会場で後に始まった節があれば、そちらだけを読む（meets の数と meet_id も見る）。
  second = { ...series[0], start_date: "2026-11-01" };
  tables.race_series = [...series, second];
  calls.length = 0;
  overlap = await readSetsuExhibition(date, fakeFetchAll);
  assert.equal(overlap.meets.length, 1, "会場ごとに節は1つ");
  assert.equal(overlap.meets[0].meet_id, "1-2026-11-01");
  assert.deepEqual(
    overlap.meets[0].racers[5].runs.map((r) => r.race_id),
    ["202611020101"],
    "前の節の走を混ぜない",
  );
  assert.equal(
    calls.filter((c) => c.table === "motor_pretest_stats").length,
    1,
    "前の節は読まない",
  );
  tables.race_series = series;
  calls.length = 0;
  await readSetsuExhibition(date, fakeFetchAll);
  assert.deepEqual(calls.find((c) => c.table === "motor_pretest_stats").filters, [
    ["eq", "venue_code", 1],
    ["eq", "race_date", "2026-10-30"],
  ]);
  assert.deepEqual(
    calls.filter((c) => c.table === "races")[1].filters,
    [
      ["eq", "venue_code", 1],
      ["gte", "race_date", "2026-10-30"],
      ["lte", "race_date", "2026-11-03"],
    ],
    "翌日の優勝戦の出走表まで読む",
  );
  assert.ok(
    calls
      .find((c) => c.table === "race_entries")
      .select.split(",")
      .includes("grade"),
  );
  assert.ok(
    calls
      .find((c) => c.table === "races")
      .select.split(",")
      .includes("start_time"),
  );
  assert.deepEqual(await readSetsuExhibition(date, async () => []), {
    date,
    meets: [],
  });
  await assert.rejects(
    readSetsuExhibition(date, async () => {
      throw new Error("read failed");
    }),
    /read failed/,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（date・series・races・conditions・entries・exhibitions・motors・rows・result） */
export async function runSetsuExhibitionScenes2(env) {
  ({ date, series, races, conditions, entries, exhibitions, motors, rows, result } = env);
  await scene3();
}
