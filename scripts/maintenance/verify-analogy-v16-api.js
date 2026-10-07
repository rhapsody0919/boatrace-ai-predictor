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
 */
import {
  cacheControl,
  isRaceId,
  resolveStatus,
} from "../../api/_lib/analogyV16.js";
import { layerStatus } from "../../api/analogy/layer/[raceId].js";
import { withoutSeriesScoreOnFinal } from "../../api/analogy/facts/[raceId].js";
import { mergeExhibition } from "../../api/analogy/similar/[raceId].js";
import { CLEANUP, datesToClean, summarizeDay } from "./verify-analogy-v16.js";
import {
  runAnalogyV16Exhibition,
  exhibitionNeighbors,
  selectExhibitionTargets,
  todayExhibition,
} from "../../scripts/lib/analogyV16Exhibition.js";

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
  selectExhibitionTargets(snaps, races, exhRows, [], now),
  [
    { race_id: "f", absent: false },
    { race_id: "a", absent: false },
    { race_id: "e", absent: true },
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
  ),
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
check("展示で決まる項目（曇りと晴は近い）", nb[1].items.weather, 1);
check("結果を付ける", nb[0].finish, [4, 1, 5]);
check("表示用の値は無ければ付けない", "display" in nb[0], false);
const nbd = exhibitionNeighbors(
  file,
  { neighbors: [{ race_id: "y", d2: 0.25 }] },
  { race: { wind_speed: 1 }, exh_time: [6.8, 6.8, 6.8, 6.8, 6.8, 6.8] },
  {
    columns: {
      nat: [
        [1, 1, 1, 1, 1, 1],
        [2, 2, 2, 2, 2, 2],
      ],
      rn: [3, 7],
    },
  },
);
check("表示用の値は候補の位置で付ける", nbd[0].display, {
  nat: [2, 2, 2, 2, 2, 2],
  rn: 7,
});
check(
  "今日の展示に風の成分と展示タイムの差",
  Object.keys(te).filter((k) =>
    ["weather_code", "wind_x", "wind_y", "exh_time_diff"].includes(k),
  ),
  ["exh_time_diff", "weather_code", "wind_x", "wind_y"],
);
// 展示後の類似レースは、層の情報を出走表の段のファイルから合わせる
check(
  "展示後の類似レースに層の情報を合わせる",
  mergeExhibition(
    {
      conditions: { round: "yusho" },
      n_layer: 15,
      pool_rate: { venue: 0.04, weather: 0 },
      neighbors: [1],
    },
    { neighbors: [2], exact: true },
  ),
  {
    conditions: { round: "yusho" },
    n_layer: 15,
    pool_rate: { venue: 0.04, weather: 0 },
    neighbors: [2],
    pool_rate_exhibition: false,
    exact: true,
  },
);
// 展示で決まる項目の「全レースで同じ割合」は、展示後の段が今日の展示の値で数え直した値にする
check(
  "展示後の pool_rate は展示後の段の値で上書きする",
  mergeExhibition(
    { pool_rate: { venue: 0.04, weather: 0, wind_bin: 0 }, neighbors: [1] },
    {
      neighbors: [2],
      exact: true,
      pool_rate: { weather: 0.61, wind_bin: 0.497 },
    },
  ),
  {
    pool_rate: { venue: 0.04, weather: 0.61, wind_bin: 0.497 },
    neighbors: [2],
    pool_rate_exhibition: true,
    exact: true,
  },
);
check(
  "展示後のファイルが無ければ null",
  mergeExhibition({ n_layer: 1 }, null),
  null,
);

// ---- 4. 状態とキャッシュ ----------------------------------------------------
const st = (o, passed) =>
  resolveStatus(
    { racecard: null, exhibition: null, sixExhibition: false, ...o },
    passed,
  );
const rc = { status: "ok" };
check("racecard が無い", st({}, false), "not_saved");
check("展示前", st({ racecard: rc }, false), "before_exhibition");
check(
  "展示タイムがそろい並べ直し待ち",
  st({ racecard: rc, sixExhibition: true }, false),
  "exhibition_reflecting",
);
check(
  "展示後の段あり",
  st({ racecard: rc, exhibition: { status: "ok" } }, false),
  "exhibition_ready",
);
check(
  "締切後も展示後の段が無い",
  st({ racecard: rc, sixExhibition: true }, true),
  "exhibition_missing",
);
check(
  "欠場",
  st({ racecard: rc, exhibition: { status: "absent" } }, false),
  "absent",
);
check(
  "layer: 層が0件",
  layerStatus({ racecard: { status: "empty_layer" }, exhibition: null }),
  "empty_layer",
);
check(
  "layer: 欠場は racecard があっても absent",
  layerStatus({ racecard: rc, exhibition: { status: "absent" } }),
  "absent",
);
check(
  "キャッシュ: not_saved はしない",
  cacheControl("not_saved", false),
  "no-store",
);
check(
  "キャッシュ: 締切前は60秒",
  cacheControl("before_exhibition", false).includes("s-maxage=60"),
  true,
);
check(
  "キャッシュ: 締切後は1日",
  cacheControl("exhibition_ready", true).includes("s-maxage=86400"),
  true,
);
check(
  "race_id の形",
  [
    isRaceId("2026-10-05-20-12"),
    isRaceId("2026-10-05-20-12x"),
    isRaceId("../x"),
  ],
  [true, false, false],
);

// ---- 5. NCR が優勝戦のときは今節の平均着順点を外す ----------------------------
const facts = { n: 1, by: { 1: { series_score: {}, nat_win: {} } } };
check(
  "NCR 優勝戦",
  Object.keys(withoutSeriesScoreOnFinal("NCR:6-0-0-0:1A1:yusho", facts).by[1]),
  ["nat_win"],
);
check(
  "NCR 準優勝戦はそのまま",
  Object.keys(withoutSeriesScoreOnFinal("NCR:6-0-0-0:1A1:junyu", facts).by[1]),
  ["series_score", "nat_win"],
);
check(
  "VC はそのまま",
  Object.keys(withoutSeriesScoreOnFinal("VC:20:6-0-0-0:1A1", facts).by[1]),
  ["series_score", "nat_win"],
);

// ---- 6. 夜の確認の数え方 ----------------------------------------------------
{
  const r = (id, start, cancel = null) => ({
    race_id: id,
    race_date: "2026-10-05",
    start_time: start,
    cancellation_status: cancel,
  });
  const at = (hhmm) => `2026-10-05T${hhmm}:00+09:00`;
  const races = [
    r("p", "10:00:00"),
    r("q", "11:00:00"),
    r("x", "12:00:00", "confirmed"),
    r("y", "13:00:00"),
  ];
  const snaps = [
    { race_id: "p", stage: "racecard", computed_at: at("07:20"), exact: null },
    {
      race_id: "p",
      stage: "exhibition",
      computed_at: at("09:55"),
      exact: true,
    },
    { race_id: "q", stage: "racecard", computed_at: at("11:05"), exact: null }, // 締切後
  ];
  const six = (id) =>
    [1, 2, 3, 4, 5, 6].map((b) => ({
      race_id: id,
      boat_number: b,
      exhibition_time: 6.8,
      is_absent: false,
    }));
  const s = summarizeDay(
    races,
    snaps,
    [...six("p"), ...six("q")],
    [{ race_id: "y", is_absent: true }],
  );
  check("夜の確認: 中止・欠場を分母から除く", s.eligible, 2);
  check("夜の確認: 出走表の段", [s.racecard, s.racecardOnTime], [2, 1]);
  check(
    "夜の確認: 展示後の段",
    [s.exhEligible, s.exhibition, s.exhibitionOnTime, s.exact],
    [2, 1, 1, 1],
  );
  check(
    "夜の確認: 欠け",
    [s.missingRacecard, s.missingExhibition],
    [[], ["q"]],
  );
  check(
    "similar/ を消す日付（7日より前）",
    datesToClean(["2026-09-27", "2026-09-28", "2026-10-04", "x"], "2026-10-05"),
    ["2026-09-27"],
  );
  const displayKeep = CLEANUP.find(([k]) => k === "similar-display")[1];
  check(
    "similar-display/ を消す日付（前日より前）",
    datesToClean(
      ["2026-10-03", "2026-10-04", "2026-10-05"],
      "2026-10-05",
      displayKeep,
    ),
    ["2026-10-03"],
  );
  check(
    "pool/（母集団の展示の値）も前日より前を消す",
    CLEANUP.find(([k]) => k === "pool")?.[1],
    1,
  );
}

// ---- 7. 展示後の段は、関数の上限の手前（shouldStop）で止まる -----------------------------
{
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_KEY = "test";
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const body = u.includes("analogy_v16_snapshots")
      ? [
          {
            race_id: "2026-10-05-20-01",
            stage: "racecard",
            status: "ok",
            run_id: "r",
            n_layer: 5,
            pool_cutoff: "2026-10-04",
          },
        ]
      : u.includes("/races?")
        ? [
            {
              race_id: "2026-10-05-20-01",
              race_date: "2026-10-05",
              start_time: "23:00:00",
            },
          ]
        : u.includes("exhibition_data")
          ? [1, 2, 3, 4, 5, 6].map((b) => ({
              race_id: "2026-10-05-20-01",
              boat_number: b,
              exhibition_time: 6.8,
              is_absent: false,
            }))
          : [];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const r = await runAnalogyV16Exhibition({
      mode: "live",
      now: () => new Date("2026-10-05T10:00:00+09:00"),
      shouldStop: () => true,
    });
    check(
      "展示後の段: shouldStop なら1レースも処理せず止まる",
      [r.report.targets, r.report.written, r.report.stopped],
      [1, 0, true],
    );
    check(
      "展示後の段: 止まったら Storage を読まない",
      calls.some((c) => c.includes("/storage/")),
      false,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の不一致`);
  process.exit(1);
}
console.log("✅ v16 の展示後の段と読み出しの API の純粋関数がすべて期待どおり");
