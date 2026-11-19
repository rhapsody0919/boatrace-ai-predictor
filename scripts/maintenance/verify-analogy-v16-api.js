/**
 * BOA-271 アナロジー・ファインダー v16 の展示後の段と読み出しの API の純粋関数の検査（ci、tasks T4-2・T4-3・T5-1）。
 * DB・Storage には接続しない。
 *
 * 1. 展示後の段の対象（selectExhibitionTargets）: racecard の snapshot があり exhibition の snapshot が無く、締切前で、
 *    6艇の展示タイムがそろったか欠場が分かったレースだけ。締切の早い順
 * 2. 今日の展示の値（todayExhibition）: 展示の進入の型、展示 ST の形（F は負）、風速区分
 * 3. 並べ直した上位の33項目（exhibitionNeighbors）: 出走表の時点の28項目は候補ファイルのまま、展示で決まる5項目は
 *    今日の展示で判定し直す。結果を付ける
 * 4. 画面の状態（resolveStatus）と layer の状態（layerStatus）、キャッシュ（cacheControl）
 * 5. NCR が優勝戦のときは facts から今節の平均着順点を外す（withoutSeriesScoreOnFinal、spec A-4）
 * 6. 夜の確認（verify-analogy-v16.js）の数え方と、similar/ を消す日付の選び方
 * 7. 展開シナリオの艇ごとの範囲（boatScopes、BOA-806）: 種類は1号艇の確定した範囲に追従、VA・VG・NA は null、ファイルの無い艇は null
 */

import fs from "fs";

import zlib from "zlib";






import {
  runAnalogyV16Exhibition,
  exhibitionNeighbors,
  selectExhibitionTargets,
  todayExhibition,
} from "../../scripts/lib/analogyV16Exhibition.js";
import { runAnalogyV16ApiScenes1 } from "./verifyData/analogy-v16-api-scenes-1.js";
import { runAnalogyV16ApiScenes2 } from "./verifyData/analogy-v16-api-scenes-2.js";
import {
  runAnalogyV16ApiScenes3,
  runAnalogyV16ApiScenes4,
  runAnalogyV16ApiScenes5,
} from "./verifyData/analogy-v16-api-scenes-3.js";

let failures = 0;
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  failures += 1;
  console.error(
    `❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// ---- 1. 展示後の段の対象 ----------------------------------------------------
const now = new Date("2026-10-05T10:00:00+09:00");
const race = (id, start) => ({
  race_id: id,
  race_date: "2026-10-05",
  start_time: start,
});
const exh = (id, n, absent = false) =>
  [1, 2, 3, 4, 5, 6].map((b) => ({
    race_id: id,
    boat_number: b,
    exhibition_time: b <= n ? 6.8 : null,
    is_absent: absent && b === 6,
  }));
const snaps = [
  { race_id: "a", stage: "racecard", status: "ok" },
  { race_id: "b", stage: "racecard", status: "ok" },
  { race_id: "c", stage: "racecard", status: "ok" },
  { race_id: "c", stage: "exhibition", status: "ok" },
  { race_id: "d", stage: "racecard", status: "ok" },
  { race_id: "e", stage: "racecard", status: "ok" },
  { race_id: "f", stage: "racecard", status: "empty_layer" },
];
const races = [
  race("a", "10:40:00"), // 対象
  race("b", "10:20:00"), // 展示が5艇 → 対象外
  race("c", "10:30:00"), // 作成済み → 対象外
  race("d", "09:50:00"), // 締切後 → 対象外
  race("e", "10:50:00"), // 欠場 → 対象（absent）
  race("f", "10:10:00"), // 層が0件でも対象（empty_layer の exhibition を書く）
  race("g", "10:45:00"), // racecard の snapshot が無い → 対象外
];
const exhRows = [
  ...exh("a", 6),
  ...exh("b", 5),
  ...exh("c", 6),
  ...exh("d", 6),
  ...exh("e", 5, true),
  ...exh("f", 6),
  ...exh("g", 6),
];
check(
  "展示後の段の対象（締切の早い順）",
  selectExhibitionTargets(snaps, races, exhRows, [], now).map(
    ({ race_id, absent, deadline }) => ({
      race_id,
      absent,
      deadline: deadline.toISOString(),
    }),
  ),
  [
    { race_id: "f", absent: false, deadline: "2026-10-05T01:10:00.000Z" },
    { race_id: "a", absent: false, deadline: "2026-10-05T01:40:00.000Z" },
    { race_id: "e", absent: true, deadline: "2026-10-05T01:50:00.000Z" },
  ],
);
check(
  "出走表の欠場も対象（absent）",
  selectExhibitionTargets(
    snaps,
    [race("b", "10:20:00")],
    exh("b", 5),
    [{ race_id: "b", is_absent: true }],
    now,
  ).map(({ race_id, absent }) => ({ race_id, absent })),
  [{ race_id: "b", absent: true }],
);

// ---- 2. 今日の展示の値 ------------------------------------------------------
const rows = [1, 2, 3, 4, 5, 6].map((b) => ({
  boat_number: b,
  exhibition_course: b === 6 ? 2 : b === 1 ? 1 : b + 1,
  start_timing: b === 3 ? 0.05 : 0.15,
  start_flag: b === 3 ? "F" : null,
}));
const live = [1, 2, 3, 4, 5, 6].map((b) => ({
  exh_time: 6.8,
  exh_time_rank: b,
}));
const te = todayExhibition(rows, live, { wind_speed: 3, wave_height: 2 });
check("展示の進入", te.course_by_boat, [1, 3, 4, 5, 6, 2]);
check("展示の進入の型（6号艇の前付け）", te.entry_type, "mae6");
check(
  "展示 ST はコース順・F は負",
  te.st_by_course,
  [0.15, 0.15, 0.15, -0.05, 0.15, 0.15],
);
check("風速区分", te.wind_band, "2-3");
// 3コースは4コース（−5）より遅いが2コースとは同じなので、カド受け凹み（d3）には当たらない（凹みは両隣より
// 0.05秒以上遅いとき。2026-10-06 ユーザー決定 Q-F4、BOA-777。以前は早い方の隣だけと比べていたので当たっていた）
check("展示 ST の形（4コースの3号艇が F で前に出る）", te.forms, [
  "wall",
  "kado",
  "dash",
]);

check("浅い F だけなら形を判定する", te.forms_excluded, false);
// Q-F6: 展示の F.05 までは .00 として判定（上の4コース F.05 は .00 → カド一撃・ダッシュ勢先行）。
// F.06 以上か出遅れの艇がいれば形を判定しない
const exhOf = (st, flag) =>
  todayExhibition(
    [1, 2, 3, 4, 5, 6].map((b) => ({
      boat_number: b,
      exhibition_course: b,
      start_timing: st[b - 1],
      start_flag: flag[b - 1],
    })),
    live,
    { wind_speed: 3, wave_height: 2 },
  );
const ex1 = exhOf(
  [0.07, 0.01, 0.09, 0.12, 0.12, 0.12],
  [null, null, "F", null, null, null],
);
check(
  "例のレース（3号艇 F.09）は形を判定しない",
  [ex1.forms, ex1.forms_excluded],
  [[], true],
);
check("F は負のまま表示用に残す", ex1.st_by_course[2], -0.09);
const ex2 = exhOf(
  [0.15, 0.15, 0.15, 0.15, 0.15, 0.15],
  [null, null, null, null, null, "L"],
);
check(
  "出遅れの艇がいれば形を判定しない",
  [ex2.forms, ex2.forms_excluded],
  [[], true],
);
const ex3 = exhOf(
  [0.05, 0.05, 0.0, 0.1, 0.1, 0.1],
  ["F", null, null, null, null, null],
);
// 1コース F.05 → .00、2コース .05 は両隣（.00・.00）より .05 遅い（Python の test_exhibition_agreement_flying_rule と同じ）
check("F.05 は .00 として判定する", ex3.forms.includes("d2"), true);
check("F.05 は .00 として判定する（判定した）", ex3.forms_excluded, false);

// ---- 3. 並べ直した上位の33項目 ----------------------------------------------
const file = {
  candidates: ["x", "y"],
  items_racecard: { venue: [2, 0], race_number: [1, 2] },
  exhibition_raw: {
    race: {
      weather_code: [1, 2],
      wind_x: [0, 3],
      wind_y: [0, 0],
      wind_speed: [1, 5],
      wave_height: [1, 8],
    },
    boats: {
      exh_time: [
        [6.8, 6.8, 6.8, 6.8, 6.8, 6.8],
        [6.7, 6.9, 6.8, 6.8, 6.8, 6.8],
      ],
    },
  },
  results: [{ finish: [1, 2, 3] }, { finish: [4, 1, 5] }],
};
const nb = exhibitionNeighbors(
  file,
  {
    neighbors: [
      { race_id: "y", d2: 0.25 },
      { race_id: "x", d2: 0.36 },
    ],
  },
  {
    race: {
      weather_code: 0,
      wind_x: 0,
      wind_y: 0,
      wind_speed: 1,
      wave_height: 1,
    },
    exh_time: [6.8, 6.8, 6.8, 6.8, 6.8, 6.8],
  },
);
check(
  "並べ直した順と距離",
  nb.map((n) => [n.race_id, n.distance]),
  [
    ["y", 0.5],
    ["x", 0.6],
  ],
);
check("出走表の時点の項目は候補ファイルのまま", nb[0].items.venue, 0);
check("展示で決まる項目は判定し直す（晴と雨は違う）", nb[0].items.weather, 0);

// ---- 後半の場面（verifyData/analogy-v16-api-scenes-1.js・analogy-v16-api-scenes-2.js・analogy-v16-api-scenes-3.js） ----
runAnalogyV16ApiScenes1({ check, te, file, nb });
await runAnalogyV16ApiScenes2({ check });
await runAnalogyV16ApiScenes3({ check });

// ---- 9. F02 の通常経路: 並べ直して Storage に書いた後でも、締切を越えていれば snapshot を書かない --------------
// （候補ファイルは並べ直しの固定データ testdata/v16-rerank.json。Storage の読み書きと DB を作り物で返す）
{
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_KEY = "test";
  const RACE = "2026-10-05-20-01";
  const fixture = JSON.parse(
    fs.readFileSync(
      new URL("../ml/analogy/testdata/v16-rerank.json", import.meta.url),
      "utf8",
    ),
  );
  const file = {
    ...fixture.candidates,
    items_racecard: {},
    results: fixture.candidates.candidates.map(() => ({})),
  };
  const gz = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
  const runAt = async (times) => {
    const storageWrites = [];
    const snapshotPosts = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      const post = init?.method === "POST";
      if (u.includes("/storage/v1/object/")) {
        if (post) {
          storageWrites.push(u.split("/analogy-v16/")[1]);
          return new Response("{}", { status: 200 });
        }
        if (u.includes("/similar/"))
          return new Response(gz(file), { status: 200 });
        if (u.includes("/today/"))
          return new Response(gz({ wind_offset_deg: 0 }), { status: 200 });
        return new Response("not found", { status: 404 });
      }
      if (post) {
        snapshotPosts.push(JSON.parse(init.body)[0]);
        return new Response("", { status: 201 });
      }
      const body = u.includes("analogy_v16_snapshots")
        ? [
            {
              race_id: RACE,
              stage: "racecard",
              status: "ok",
              run_id: "r",
              n_layer: fixture.candidates.n_layer,
              pool_cutoff: "2026-10-04",
            },
          ]
        : u.includes("/races?")
          ? [{ race_id: RACE, race_date: "2026-10-05", start_time: "10:00:00" }]
          : u.includes("exhibition_data")
            ? [1, 2, 3, 4, 5, 6].map((b) => ({
                race_id: RACE,
                boat_number: b,
                exhibition_time: 6.7 + b / 100,
                exhibition_course: b,
                start_timing: 0.15,
                start_flag: null,
                is_absent: false,
              }))
            : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const queue = times.map((t) => new Date(`2026-10-05T${t}+09:00`));
    try {
      const r = await runAnalogyV16Exhibition({
        mode: "live",
        now: () => queue.shift(),
      });
      return { report: r.report, storageWrites, snapshotPosts };
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  const late = await runAt(["09:59:30", "10:00:30"]);
  check(
    "展示後の段（通常経路）: Storage に書いた後に締切を越えたら snapshot を書かない",
    [
      late.report.failed,
      late.report.late,
      late.storageWrites.map((p) => p.split("/")[2]).sort(),
      late.snapshotPosts.length,
    ],
    [[], [RACE], ["similar-exhibition", "today-exhibition"], 0],
  );
  const onTime = await runAt(["09:59:30", "09:59:50"]);
  check(
    "展示後の段（通常経路）: 締切前なら snapshot を ok で書く",
    [
      onTime.report.failed,
      onTime.snapshotPosts.map((p) => [p.status, p.computed_at]),
    ],
    [[], [["ok", "2026-10-05T00:59:50.000Z"]]],
  );
}

// ---- 後半の場面（verifyData/analogy-v16-api-scenes-3.js） ----
await runAnalogyV16ApiScenes4({ check });

// ---- BOA-788: 古い気象は待ち、取得障害中も締切4分前からは作る（実通信なし） ----
{
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_KEY = "test";
  const RACE = "2026-10-05-20-06";
  const fixture = JSON.parse(fs.readFileSync(
    new URL("../ml/analogy/testdata/v16-rerank.json", import.meta.url), "utf8",
  ));
  const file = { ...fixture.candidates, items_racecard: {},
    results: fixture.candidates.candidates.map(() => ({})) };
  const gz = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
  const runWeather = async (observed, time, options = {}) => {
    const posts = [], writes = [], reads = [];
    const raceId = options.first ? "2026-10-05-20-01" : RACE;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = new URL(url);
      if (u.hostname !== "example.invalid") throw new Error("実通信は禁止");
      const post = init?.method === "POST";
      if (u.pathname.includes("/storage/")) {
        reads.push(u.pathname);
        if (post) {
          writes.push(JSON.parse(zlib.gunzipSync(Buffer.from(init.body))));
          return new Response("{}", { status: 200 });
        }
        if (u.pathname.includes("/similar/")) return new Response(gz(file));
        if (u.pathname.includes("/today/")) return new Response(gz({ wind_offset_deg: 0 }));
        return new Response("not found", { status: 404 });
      }
      if (post) {
        posts.push(...JSON.parse(init.body));
        return new Response("", { status: 201 });
      }
      let body;
      if (u.pathname.endsWith("/analogy_v16_snapshots")) body = [{
        race_id: raceId, stage: "racecard", status: options.status ?? "ok",
        run_id: "r", n_layer: file.n_layer, pool_cutoff: "2026-10-04",
      }];
      else if (u.pathname.endsWith("/races")) body = [
        ...(!options.first ? [{ race_id: "2026-10-05-20-05",
          race_date: "2026-10-05", start_time: "13:00:00" }] : []),
        { race_id: raceId, race_date: "2026-10-05", start_time: "13:30:00" },
        // 別会場の直前のレースを基準にしない。
        { race_id: "2026-10-05-19-05", race_date: "2026-10-05", start_time: "13:20:00" },
      ];
      else if (u.pathname.endsWith("/exhibition_data")) body = [1, 2, 3, 4, 5, 6].map((b) => ({
        race_id: raceId, boat_number: b, exhibition_time: 6.7 + b / 100,
        exhibition_course: b, start_timing: 0.15, start_flag: null,
        is_absent: options.absent === true && b === 6,
      }));
      else if (u.pathname.endsWith("/race_conditions")) {
        check("観測時刻を気象と一緒に読む", u.searchParams.get("select").includes("weather_observed_at"), true);
        body = [{ weather_observed_at: observed, wind_speed: 3, wave_height: 2 }];
      } else if (u.pathname.endsWith("/race_entries")) body = [];
      else throw new Error(`想定外のREST: ${u.pathname}`);
      return new Response(JSON.stringify(body));
    };
    try {
      const result = await runAnalogyV16Exhibition({ mode: "live",
        now: () => new Date(`2026-10-05T${time}+09:00`) });
      return { ...result, posts, writes, reads };
    } finally { globalThis.fetch = realFetch; }
  };
  const old = "2026-10-05T12:40:00+09:00";
  const waiting = await runWeather(old, "13:10:00");
  check("朝の気象ではStorageもsnapshotも書かない",
    [waiting.posts.length, waiting.writes.length, waiting.reads.length, waiting.report.failed], [0, 0, 0, []]);
  check("待機理由をreportに残す", waiting.report.waiting_weather?.map((r) => [r.race_id, r.reason]),
    [[RACE, "before_previous_race"]]);
  for (const observed of ["2026-10-05T13:05:00+09:00", "2026-10-05T04:00:00Z"] ) {
    const fresh = await runWeather(observed, "13:10:00");
    check("前のレース以降の観測（境界・UTC含む）は作る", fresh.posts.map((p) => p.status), ["ok"]);
    check("確認した気象で作る", fresh.writes.find((w) => w.wind_speed !== undefined)?.wind_speed, 3);
  }
  check("4分前の直前は待つ", (await runWeather(old, "13:25:59")).posts.length, 0);
  for (const time of ["13:26:00", "13:28:00", "13:29:59"]) {
    const fallback = await runWeather(old, time);
    check("403等で観測が更新されなくても締切4分前以降は作る", fallback.posts.map((p) => p.status), ["ok"]);
  }
  check("締切以降には作らない", (await runWeather(old, "13:30:00")).posts.length, 0);
  for (const options of [{ first: true }, { absent: true }]) {
    check("1R・欠場は待機しない", (await runWeather(old, "13:10:00", options)).posts.length, 1);
  }
  check("層0件も古い気象なら待つ", (await runWeather(old, "13:10:00", { status: "empty_layer" })).posts.length, 0);
  check("層0件も4分前以降は作る", (await runWeather(old, "13:26:00", { status: "empty_layer" })).posts.map((p) => p.status), ["empty_layer"]);
  check("観測時刻なしは従来どおり作る", (await runWeather(null, "13:10:00")).posts.length, 1);
}

// ---- 後半の場面（verifyData/analogy-v16-api-scenes-3.js） ----
await runAnalogyV16ApiScenes5({ check });

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の不一致`);
  process.exit(1);
}
console.log("✅ v16 の展示後の段と読み出しの API の純粋関数がすべて期待どおり");
