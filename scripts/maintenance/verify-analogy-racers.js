/**
 * BOA-855 /api/analogy/facts/{raceId}?include=racers の検査（ci）。DB・Storage には接続しない
 * （fetch を差し替え、PostgREST の絞り込みを手元の行に当てて返す）。
 *
 * 1. 今節の展示の順位: 節の初日（前の節の最終日の翌開催日）から、このレースより前の走だけ。
 *    このレース自身・同じ日の後のレース・前の節・別の会場は入らない。同着は同順位、展示の無い艇は母数から外す
 * 2. 進入傾向: venue_code=0 の行の全会場の分と、このレースの会場の分（キーは "1" のようにゼロ埋めなし）。
 *    集計の行が無い選手は null
 * 3. include を渡さないとき（画面）は racers を返さず、追加の読み出しもしない（負荷が変わらない）
 * 4. snapshot が無いレース（status=not_saved）でも racers は返す
 * 5. 中止で日目が振り直された節（10/10 が丸一日中止で、10/11 も「2日目」）でも節の初日は変わらず、
 *    中止が確定したレースは走に入らない（実例: 2026-09-21〜22 の戸田・津）
 * 6. 応答は include の有無で混ざらない（include ありの後に include なしを呼んでも racers が無い、
 *    racers 以外は同じ、Cache-Control も同じ規則）。CDN のキャッシュは URL（クエリ込み）で分かれる
 */
import { buildRacers } from "../../api/_lib/racerEntryExhibition.js";

process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "test-key";
const { default: handler } =
  await import("../../api/analogy/facts/[raceId].js");

let failures = 0;
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  failures += 1;
  console.error(
    `❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const RACE = "2026-10-12-01-05";
const TODAY_RACERS = [4528, 5234, 4550, 4950, 4051, 3612];
const entry = (race_id, boat_number, racer_id) => ({
  race_id,
  boat_number,
  racer_id,
});
const exh = (race_id, times) =>
  times.map((t, i) => ({
    race_id,
    boat_number: i + 1,
    exhibition_time: t,
    is_absent: t === null,
  }));

const tables = {
  analogy_v16_snapshots: [],
  races: [
    { race_id: RACE, race_date: "2026-10-12", start_time: "13:00:00" },
    // 10/10 は丸一日中止（出走表は残る）
    { race_id: "2026-10-10-01-08", cancellation_status: "confirmed" },
  ],
  race_entries: [
    ...TODAY_RACERS.map((id, i) => entry(RACE, i + 1, id)),
    // 前の節（10/7 が最終日）→ 入らない
    entry("2026-10-06-01-04", 1, 4528),
    // 今節
    entry("2026-10-09-01-03", 2, 4528),
    entry("2026-10-10-01-08", 4, 4528),
    // 展示の行がまだ無い走（中止ではない）→ 入る
    entry("2026-10-11-01-06", 3, 4528),
    entry("2026-10-12-01-02", 1, 4528),
    entry("2026-10-12-01-02", 2, 5234),
    entry("2026-10-12-01-02", 3, 4550),
    entry("2026-10-12-01-02", 4, 4950),
    entry("2026-10-12-01-02", 5, 4051),
    entry("2026-10-12-01-02", 6, 9999),
    // 同じ日の後のレース → 入らない
    entry("2026-10-12-01-09", 3, 4528),
    // 別の会場 → 入らない
    entry("2026-10-11-02-01", 1, 4528),
  ],
  race_conditions: [
    { race_id: "2026-10-05-01-01", series_day: 1, is_final_day: false },
    { race_id: "2026-10-06-01-01", series_day: 2, is_final_day: false },
    { race_id: "2026-10-07-01-01", series_day: 3, is_final_day: true },
    { race_id: "2026-10-09-01-01", series_day: 1, is_final_day: false },
    // 10/10 が中止になり、10/11 にもう一度「2日目」
    { race_id: "2026-10-10-01-01", series_day: 2, is_final_day: false },
    { race_id: "2026-10-11-01-01", series_day: 2, is_final_day: false },
    { race_id: "2026-10-12-01-01", series_day: 3, is_final_day: false },
  ],
  exhibition_data: [
    ...exh("2026-10-06-01-04", [6.6, 6.7, 6.7, 6.7, 6.7, 6.7]),
    ...exh("2026-10-09-01-03", [6.75, 6.7, 6.75, 6.8, 6.8, 6.8]),
    // 10-10-01-08（中止）と 10-11-01-06 は展示の行が無い
    // 同着（6.80 が2艇）と欠場（5号艇）
    ...exh("2026-10-12-01-02", [6.8, 6.75, 6.8, 6.9, null, 6.85]),
    ...exh(RACE, [6.5, 6.5, 6.5, 6.5, 6.5, 6.5]),
    ...exh("2026-10-12-01-09", [6.9, 6.9, 6.5, 6.9, 6.9, 6.9]),
    ...exh("2026-10-11-02-01", [6.5, 6.9, 6.9, 6.9, 6.9, 6.9]),
  ],
  racer_aggregated_stats: [
    {
      racer_id: 4528,
      venue_code: 0,
      course_entry_tendency: {
        since: "2025-10-11",
        all: { 1: { n: 30, courses: { 1: 29, 2: 1 } } },
        venues: { 1: { 1: { n: 4, courses: { 1: 4 } } } },
      },
    },
    // 会場別の行（venue_code=1）は読まない
    {
      racer_id: 4528,
      venue_code: 1,
      course_entry_tendency: { since: "x", all: {}, venues: {} },
    },
    ...[5234, 4550, 4950, 4051].map((racer_id) => ({
      racer_id,
      venue_code: 0,
      course_entry_tendency: {
        since: "2025-10-11",
        all: { 2: { n: 10, courses: { 2: 10 } } },
        venues: {},
      },
    })),
    // 3612 は集計の行が無い
  ],
};

// ---- PostgREST の絞り込みを手元の行に当てる ----
const requests = [];
function matches(row, column, filter) {
  const dot = filter.indexOf(".");
  const op = filter.slice(0, dot);
  const value = filter.slice(dot + 1);
  const v = String(row[column]);
  switch (op) {
    case "eq":
      return v === decodeURIComponent(value);
    case "gte":
      return v >= decodeURIComponent(value);
    case "lte":
      return v <= decodeURIComponent(value);
    case "lt":
      return v < decodeURIComponent(value);
    case "in":
      return value.slice(1, -1).split(",").includes(v);
    case "not":
      if (value !== "is.null") throw new Error(`未対応の not.${value}`);
      return row[column] !== null && row[column] !== undefined;
    case "like":
      return new RegExp(
        `^${value.replaceAll("_", ".").replaceAll("*", ".*")}$`,
      ).test(v);
    default:
      throw new Error(`未対応の演算子 ${op}`);
  }
}
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const table = url.pathname.replace("/rest/v1/", "");
  requests.push(table);
  const rows = (tables[table] ?? []).filter((row) =>
    [...url.searchParams.entries()]
      .filter(([k]) => k !== "select")
      .every(([k, f]) => matches(row, k, f)),
  );
  return new Response(JSON.stringify(rows), { status: 200 });
};

const call = async (query) => {
  requests.length = 0;
  const res = await handler(
    new Request(`http://localhost/api/analogy/facts/${RACE}${query}`),
  );
  return {
    status: res.status,
    cache: res.headers.get("Cache-Control"),
    body: await res.json(),
  };
};

// ---- 3. include なし: racers を返さず、追加の読み出しもしない ----
{
  const { status, body } = await call("");
  check("include なし: HTTP 200", status, 200);
  check("include なし: racers を返さない", "racers" in body, false);
  check("include なし: 読み出しは状態の4本だけ", [...requests].sort(), [
    "analogy_v16_snapshots",
    "exhibition_data",
    "race_entries",
    "races",
  ]);
}

// ---- 1・2・4. include=racers ----
{
  const { status, body } = await call("?include=racers");
  check("include=racers: HTTP 200", status, 200);
  check("snapshot が無くても返す（not_saved）", body.status, "not_saved");
  const racers = body.racers;
  check(
    "節の初日（前の節の最終日の翌開催日。中止で日目が振り直されても変わらない）",
    racers?.meet_start,
    "2026-10-09",
  );
  check(
    "6艇を艇番の順に",
    racers?.boats.map((b) => [b.boat_number, b.racer_id]),
    TODAY_RACERS.map((id, i) => [i + 1, id]),
  );
  const [b1, b2, , , b5, b6] = racers?.boats ?? [];
  check(
    "1号艇の今節の走（このレースより前・同じ会場・今節だけ・中止は外す）",
    b1?.meet_runs,
    [
      {
        race_id: "2026-10-09-01-03",
        boat_number: 2,
        exhibition_time: 6.7,
        exhibition_rank: 1,
        exhibition_field: 6,
      },
      {
        race_id: "2026-10-11-01-06",
        boat_number: 3,
        exhibition_time: null,
        exhibition_rank: null,
        exhibition_field: 0,
      },
      {
        race_id: "2026-10-12-01-02",
        boat_number: 1,
        exhibition_time: 6.8,
        exhibition_rank: 2,
        exhibition_field: 5,
      },
    ],
  );
  check(
    "同着は同順位（6.75 が1位、6.80 の2艇がともに2位）",
    b2?.meet_runs.map((r) => r.exhibition_rank),
    [1],
  );
  check(
    "展示の無い艇（欠場）は順位 null",
    b5?.meet_runs.map((r) => [r.exhibition_time, r.exhibition_rank]),
    [[null, null]],
  );
  check("1号艇の進入傾向（全会場と、このレースの会場）", b1?.course_entry, {
    since: "2025-10-11",
    all: { 1: { n: 30, courses: { 1: 29, 2: 1 } } },
    venue: { 1: { n: 4, courses: { 1: 4 } } },
  });
  check("会場の分が無い選手は venue が null", b2?.course_entry?.venue, null);
  check("集計の行が無い選手は course_entry が null", b6?.course_entry, null);
  check("今節に走っていない選手は meet_runs が空", b6?.meet_runs, []);
}

// ---- 6. include の有無で応答が混ざらない ----
{
  const withRacers = await call("?include=racers");
  const plain = await call("");
  check(
    "include ありの後の include なしに racers が混ざらない",
    "racers" in plain.body,
    false,
  );
  const { racers: _r, ...rest } = withRacers.body;
  check("racers 以外は include の有無で同じ", rest, plain.body);
  check(
    "Cache-Control は include の有無で同じ規則",
    withRacers.cache,
    plain.cache,
  );
}

// ---- racer_id が NULL の艇は、他の NULL の行の走を拾わない ----
{
  const racers = buildRacers({
    raceId: RACE,
    windowEntries: [
      entry(RACE, 1, null),
      entry("2026-10-12-01-02", 3, null),
      entry("2026-10-12-01-03", 5, null),
    ],
    windowConditions: [],
    stats: [],
    exhibitionRows: exh("2026-10-12-01-02", [6.8, 6.8, 6.7, 6.8, 6.8, 6.8]),
  });
  check(
    "racer_id が NULL の艇は meet_runs が空",
    racers?.boats[0].meet_runs,
    [],
  );
}

// ---- 出走表が無いレース ----
check(
  "このレースの出走表が無ければ null",
  buildRacers({
    raceId: RACE,
    windowEntries: [],
    windowConditions: [],
    stats: [],
    exhibitionRows: [],
  }),
  null,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の不一致`);
  process.exit(1);
}
console.log(
  "✅ facts の include=racers（進入傾向・今節の展示順位）が期待どおり",
);
