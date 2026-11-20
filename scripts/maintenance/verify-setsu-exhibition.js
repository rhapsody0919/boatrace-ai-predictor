/** BOA-1221: 固定行・偽の fetchAll・手元の偽の PostgREST のみ。本番接続なし。 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { setsuExhibitionOf } from "../sns/setsu-exhibition.js";
import {
  date,
  series,
  races,
  motors,
  runSetsuExhibitionScenes1,
  runSetsuExhibitionScenes2,
  runSetsuExhibitionScenes3,
} from "./verifyData/setsu-exhibition-scenes-1.js";
import { runSetsuExhibitionScenes4 } from "./verifyData/setsu-exhibition-scenes-2.js";

// ---- 後半の場面（verifyData/setsu-exhibition-scenes-1.js） ----
runSetsuExhibitionScenes1();
const conditions = races.map((r) => ({
  race_id: r.race_id,
  series_day: r.race_date === date ? 4 : 1,
  is_final_day: r.race_date === date,
  race_stage: "予選",
}));
const entries = races.flatMap((r) =>
  Array.from({ length: 6 }, (_, i) => ({
    race_id: r.race_id,
    boat_number: i + 1,
    racer_id: 4006 - i,
    player_name: `選手${i}`,
    grade: i < 2 ? "A1" : "B1",
    motor_number: i + 10,
    is_absent: i === 4,
  })),
);
const exhibitions = entries.map((e) => ({
  race_id: e.race_id,
  boat_number: e.boat_number,
  exhibition_time: [6.7, 6.71, "6.71", 6.72, 6.5, null][e.boat_number - 1],
  exhibition_course: 7 - e.boat_number,
}));

// ---- 後半の場面（verifyData/setsu-exhibition-scenes-1.js） ----
runSetsuExhibitionScenes2({ conditions, entries, exhibitions });
const rows = { series, races, conditions, entries, exhibitions, motors };
const snapshot = JSON.stringify(rows);
const result = setsuExhibitionOf(date, rows);
const meet = result.meets[0];
assert.equal(result.date, date);
assert.deepEqual(
  { ...meet, racers: [] },
  {
    meet_id: "1-2026-10-30",
    ...series[0],
    series_day: 4,
    is_final_day: true,
    first_race_deadline: "2026-11-02T10:45:00+09:00",
    final_entries: [],
    racers: [],
  },
);
assert.deepEqual(
  meet.racers.map((r) => r.racer_id),
  [4001, 4002, 4003, 4004, 4005, 4006],
);
assert.deepEqual(
  meet.racers.map((r) => r.class),
  ["B1", "B1", "B1", "B1", "A1", "A1"],
  "選手ごとに級（race_entries.grade）を出す",
);
assert.deepEqual(
  meet.racers.map((r) => r.runs[0].exhibition_rank),
  [null, null, 4, 2, 2, 1],
);
assert.equal(meet.racers[5].motor_2rate_at_start, 0);
assert.equal(meet.racers[4].motor_2rate_at_start, null);
assert.deepEqual(meet.racers[5].runs, [
  {
    race_id: "202610300101",
    date: "2026-10-30",
    race_number: 1,
    race_stage: "予選",
    boat_number: 1,
    exhibition_time: 6.7,
    exhibition_rank: 1,
    exhibition_course: 6,
  },
  {
    race_id: "202611020101",
    date,
    race_number: 1,
    race_stage: "予選",
    boat_number: 1,
    exhibition_time: 6.7,
    exhibition_rank: 1,
    exhibition_course: 6,
  },
]);
assert.equal(JSON.stringify(rows), snapshot, "入力を変更しない");
assert.deepEqual(setsuExhibitionOf(date), { date, meets: [] });
const postponed = { ...series[0], end_date: "2026-10-30" };
assert.equal(
  setsuExhibitionOf(date, { ...rows, series: [postponed] }).meets.length,
  1,
);
assert.equal(
  setsuExhibitionOf(date, {
    ...rows,
    series: [{ ...postponed, end_date: "2026-10-29" }],
  }).meets.length,
  0,
);
assert.equal(
  setsuExhibitionOf(date, {
    ...rows,
    series: [{ ...postponed, start_date: "2026-11-03" }],
  }).meets.length,
  0,
);
assert.equal(
  setsuExhibitionOf(date, {
    ...rows,
    races: races.filter((r) => r.race_date !== date),
  }).meets.length,
  0,
);
const changed = structuredClone(rows);
changed.exhibitions[0].is_absent = true;
assert.equal(
  setsuExhibitionOf(date, changed).meets[0].racers[5].runs[1].exhibition_rank,
  null,
);
changed.conditions[0].series_day = 3;
assert.equal(setsuExhibitionOf(date, changed).meets[0].series_day, 3);
changed.conditions = [];
assert.equal(setsuExhibitionOf(date, changed).meets[0].series_day, null);

// 級は節の中でいちばん新しい走の値（期の替わり目に備える）。null の走では上書きしない。
const regraded = structuredClone(rows);
regraded.entries.find(
  (e) => e.race_id === "202611020101" && e.boat_number === 1,
).grade = "A2";
assert.equal(setsuExhibitionOf(date, regraded).meets[0].racers[5].class, "A2");
regraded.entries.find(
  (e) => e.race_id === "202611020101" && e.boat_number === 1,
).grade = null;
assert.equal(setsuExhibitionOf(date, regraded).meets[0].racers[5].class, "A1");

// 1R の締切: 秒の無い時刻も ISO にそろえる。1R が無ければ null。
assert.equal(
  setsuExhibitionOf(date, {
    ...rows,
    races: races.map((r) =>
      r.race_id === "202611020101" ? { ...r, start_time: "10:45" } : r,
    ),
  }).meets[0].first_race_deadline,
  "2026-11-02T10:45:00+09:00",
);
assert.equal(
  setsuExhibitionOf(date, {
    ...rows,
    races: races.filter((r) => r.race_id !== "202611020101"),
  }).meets[0].first_race_deadline,
  null,
);

// 中止の判定は結果も見る（confirmed でも結果があれば行われたレース。BOA-512 の型）。
const withResult = setsuExhibitionOf(date, {
  ...rows,
  results: [
    { race_id: "202611020102", rank1: 1, rank2: 2, is_cancelled: false },
  ],
});
assert.deepEqual(
  withResult.meets[0].racers[5].runs.map((r) => r.race_id),
  ["202610300101", "202611020101", "202611020102"],
);

// 日ごとの秒数が逆転しても、そのレースの中だけで順位を付ける。
const daily = structuredClone(rows);
daily.exhibitions.find(
  (e) => e.race_id === "202610300101" && e.boat_number === 1,
).exhibition_time = 7.5;
assert.deepEqual(
  setsuExhibitionOf(date, daily).meets[0].racers[5].runs.map(
    (r) => r.exhibition_rank,
  ),
  [4, 1],
);
const noExhibition = setsuExhibitionOf(date, { ...rows, exhibitions: [] });
assert.ok(
  noExhibition.meets[0].racers.every((r) =>
    r.runs.every(
      (run) => run.exhibition_rank === null && run.exhibition_time === null,
    ),
  ),
);

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

// ---- 後半の場面（verifyData/setsu-exhibition-scenes-1.js・setsu-exhibition-scenes-2.js） ----
await runSetsuExhibitionScenes3({ conditions, entries, exhibitions, result });
await runSetsuExhibitionScenes4();
for (const invalid of ["2026/11/02", "2026-02-30", "bad"]) {
  const child = spawnSync(
    process.execPath,
    ["scripts/sns/setsu-exhibition.js", invalid],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 2);
  assert.match(child.stderr, /使い方/);
}

// CLI の成功経路: 手元の偽の PostgREST（どの表も空）につなぎ、stdout 全体が JSON として読めることを固定する（#2101 P1-2、dotenv のログ）。
{
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
    SUPABASE_SERVICE_KEY: "test-key",
  };
  delete env.DOTENV_CONFIG_QUIET;
  const child = spawn(
    process.execPath,
    ["scripts/sns/setsu-exhibition.js", date],
    { env },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d;
  });
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  const status = await new Promise((resolve) => child.on("close", resolve));
  server.close();
  assert.equal(status, 0, stderr);
  assert.deepEqual(
    JSON.parse(stdout),
    { date, meets: [] },
    `stdout は JSON だけ: ${stdout.slice(0, 200)}`,
  );
}
console.log(
  "OK: 節（会場ごとに最新の1つ・連続開催）・順位（同タイム/0.01秒差/欠場/欠損）・級・中止（結果あり）・初日2連率・1R締切・優勝戦の出場者（出走表/準優1・2着/空）・順序・取得範囲・CLI（日付・stdout は JSON だけ）",
);
