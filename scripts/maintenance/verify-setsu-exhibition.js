/** BOA-1221: 固定行・偽の fetchAll・手元の偽の PostgREST のみ。本番接続なし。 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { setsuExhibitionOf } from "../sns/setsu-exhibition.js";
import { runSetsuExhibitionScenes1, runSetsuExhibitionScenes2 } from "./verifyData/setsu-exhibition-scenes.js";

const date = "2026-11-02";
const series = [
  {
    venue_code: 1,
    start_date: "2026-10-30",
    end_date: "2026-11-02",
    title: "節A",
    grade: "G1",
  },
];
const races = [
  {
    race_id: "202611020101",
    race_date: date,
    venue_code: 1,
    race_number: 1,
    start_time: "10:45:00",
    cancellation_status: "tentative",
  },
  {
    race_id: "202610300101",
    race_date: "2026-10-30",
    venue_code: 1,
    race_number: 1,
    start_time: "10:30:00",
  },
  {
    race_id: "202611020102",
    race_date: date,
    venue_code: 1,
    race_number: 2,
    start_time: "11:12:00",
    cancellation_status: "confirmed",
  },
];
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
const motors = [
  {
    race_date: "2026-10-30",
    venue_code: 1,
    racer_id: 4006,
    motor_number: 10,
    motor_2rate: 0,
  },
  {
    race_date: date,
    venue_code: 1,
    racer_id: 4005,
    motor_number: 11,
    motor_2rate: 99,
  },
];
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

// ---- 後半の場面（verifyData/setsu-exhibition-scenes.js） ----
runSetsuExhibitionScenes1({ date, series, races, conditions, entries, exhibitions, motors, rows, result });

// final_entries の3つの場合（優勝戦の出走表あり / 無いが準優の結果あり / どちらも無い）。
{
  const fSeries = [
    {
      venue_code: 2,
      start_date: "2026-10-28",
      end_date: "2026-11-02",
      title: "節F",
      grade: "SG",
    },
  ];
  const race = (id, d, n, stage, extra = {}) => ({
    race: {
      race_id: id,
      race_date: d,
      venue_code: 2,
      race_number: n,
      start_time: "15:00:00",
      ...extra,
    },
    cond: {
      race_id: id,
      series_day: 1,
      is_final_day: false,
      race_stage: stage,
    },
  });
  const semis = [
    race("s10", "2026-11-01", 10, "準優勝戦"),
    race("s11", "2026-11-01", 11, "準優勝戦"),
    race("s12", "2026-11-01", 12, "準優勝戦"),
  ];
  const prelim = race("q1", "2026-11-01", 1, "予選");
  const finalRace = race("f12", date, 12, "優勝戦");
  const entriesFor = (id, base) =>
    [1, 2, 3, 4, 5, 6].map((b) => ({
      race_id: id,
      boat_number: b,
      racer_id: base + b,
      player_name: "x",
      grade: "A1",
      motor_number: b,
    }));
  const semiEntries = [
    ...entriesFor("s10", 100),
    ...entriesFor("s11", 200),
    ...entriesFor("s12", 300),
    ...entriesFor("q1", 900),
  ];
  const results = [
    { race_id: "s10", rank1: 3, rank2: 1, is_cancelled: false },
    { race_id: "s11", rank1: 2, rank2: null, is_cancelled: false }, // 2着が欠けた（失格等）: そろった人数だけ
    { race_id: "q1", rank1: 1, rank2: 2, is_cancelled: false }, // 予選は使わない
  ];
  // s12 は中止（結果なし）
  semis[2].race.cancellation_status = "confirmed";
  const base = {
    series: fSeries,
    races: [...semis, prelim].map((x) => x.race),
    conditions: [...semis, prelim].map((x) => x.cond),
    entries: semiEntries,
    results,
  };
  const day = "2026-11-01";
  assert.deepEqual(
    setsuExhibitionOf(day, base).meets[0].final_entries,
    [
      { boat_number: null, racer_id: 103, source: "semifinal_top2" },
      { boat_number: null, racer_id: 101, source: "semifinal_top2" },
      { boat_number: null, racer_id: 202, source: "semifinal_top2" },
    ],
    "準優の1・2着（中止・欠けた着は除く）",
  );
  // 前夜に翌日の優勝戦の出走表が入っていれば、出走表を使う。
  const withFinal = {
    ...base,
    races: [...base.races, finalRace.race],
    conditions: [...base.conditions, finalRace.cond],
    entries: [
      ...semiEntries,
      ...[6, 5, 4, 3, 2, 1].map((b) => ({
        race_id: "f12",
        boat_number: b,
        racer_id: 700 + b,
        player_name: "x",
        grade: "A1",
        motor_number: b,
      })),
    ],
  };
  const expectedEntries = [1, 2, 3, 4, 5, 6].map((b) => ({
    boat_number: b,
    racer_id: 700 + b,
    source: "entries",
  }));
  assert.deepEqual(
    setsuExhibitionOf(day, withFinal).meets[0].final_entries,
    expectedEntries,
    "前夜でも出走表があれば entries",
  );
  // 優勝戦の欠場者は出場者に入れない。
  const scratched = structuredClone(withFinal);
  scratched.entries.find(
    (e) => e.race_id === "f12" && e.boat_number === 4,
  ).is_absent = true;
  assert.deepEqual(
    setsuExhibitionOf(day, scratched).meets[0].final_entries.map(
      (e) => e.boat_number,
    ),
    [1, 2, 3, 5, 6],
  );
  assert.deepEqual(
    setsuExhibitionOf(date, {
      ...withFinal,
      races: [
        ...withFinal.races,
        { ...finalRace.race, race_id: "f01", race_number: 1 },
      ],
    }).meets[0].final_entries,
    expectedEntries,
    "優勝戦の日は出走表",
  );
  // 優勝戦のレースはあるが出走表がまだ無い: 準優の結果で補う。
  assert.equal(
    setsuExhibitionOf(day, { ...withFinal, entries: semiEntries }).meets[0]
      .final_entries[0].source,
    "semifinal_top2",
  );
  // どちらも無い。
  assert.deepEqual(
    setsuExhibitionOf(day, { ...base, results: [] }).meets[0].final_entries,
    [],
  );
  // 2日先の優勝戦は使わない（節の最終日より前の日）。
  assert.deepEqual(
    setsuExhibitionOf("2026-10-31", {
      ...withFinal,
      races: [...withFinal.races, race("q0", "2026-10-31", 1, "予選").race],
      results: [],
    }).meets[0].final_entries,
    [],
  );
}

// ---- 後半の場面（verifyData/setsu-exhibition-scenes.js） ----
await runSetsuExhibitionScenes2({ date, series, races, conditions, entries, exhibitions, motors, rows, result });
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
