/**
 * verify-full-picture-scene2.js の後半の場面（4/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { scoped, scoped3, stBaseline } from "./full-picture-scene2-b-2.js";
import { inIds, seenQueries, sbAnswerNext, listParam, finalsResponse, sbAnswer1, sbAnswer2 } from "./full-picture-scene2-b-3.js";
import { startRows, live, techAll, technique, racerTables, date } from "./full-picture-scene2-b-1.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let validate, m, realFetch, exRows;
export let pre, got, boats, conditions, tq;

const sbAnswer3 = ({ table, q, json }) => {
  if (
    table === "race_start_timings" &&
    /start_timing/.test(q.get("select") ?? "")
  )
    return json(
      [...scoped.st, ...scoped3.st].filter((r) =>
        inIds(q).includes(r.race_id),
      ),
    );
  if (table === "race_start_timings") return json(startRows);
  if (table === "race_entries" && q.get("racer_id")) {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    if (
      q.get("racer_id") === live.failRacer &&
      /grade/.test(q.get("select") ?? "")
    )
      return { ok: false, status: 503, json: async () => ({}) };
    if (/grade/.test(q.get("select") ?? ""))
      return json(
        q.get("racer_id") === "eq.4002"
          ? scoped.entries
          : q.get("racer_id") === "eq.4003"
            ? scoped3.entries
            : [],
      );
  }
  return sbAnswerNext;
};

const sbAnswer4 = ({ table, q, json, startTime, grade }) => {
  if (table === "races" && /race_date/.test(q.get("select") ?? ""))
    return json(
      [...scoped.races, ...scoped3.races].filter((r) =>
        inIds(q).includes(r.race_id),
      ),
    );
  if (
    table === "race_results" &&
    /actual_course_1/.test(q.get("select") ?? "")
  )
    return json(
      [...scoped.results, ...scoped3.results].filter((r) =>
        inIds(q).includes(r.race_id),
      ),
    );
  if (table === "predictions") {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    return json(live.predictionRows);
  }
  if (table === "st_course_baseline") return json(stBaseline);
  if (table === "races" && q.get("race_id") === `eq.${m.raceId}`)
    return json([{ start_time: startTime, race_grade: grade }]);
  // 全会場の集計表（会場で絞らない問い合わせ）は全国×枠の元
  if (table === "winning_technique_stats" && !q.get("venue_code")) {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    return json(techAll);
  }
  if (technique[table]) return json(technique[table]);
  return sbAnswerNext;
};

const sbAnswer5 = ({ table, q, json }) => {
  if (racerTables[table]) {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    const ids = listParam(q.get("racer_id")).map(Number);
    const [, lt, gte] =
      q
        .get("and")
        ?.match(/^\(calc_to\.lt\.([\d-]+),calc_to\.gte\.([\d-]+)\)$/) ??
      [];
    // PostgREST の絞り込みと並べ替えの代わり（and=(calc_to.lt.,calc_to.gte.)・order=calc_to.desc）
    const rows = racerTables[table].filter(
      (r) =>
        ids.includes(r.racer_id) &&
        (!lt || (r.calc_to < lt && r.calc_to >= gte)),
    );
    return json(
      table === "racer_period_stats"
        ? [...rows].sort((a, b) => b.calc_to.localeCompare(a.calc_to))
        : rows,
    );
  }
  if (table === "venue_course_technique_baseline") {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    return json(
      live.baseline.filter((r) =>
        listParam(q.get("race_grade")).includes(r.race_grade),
      ),
    );
  }
  return sbAnswerNext;
};

const sbAnswer = ({ table, q, init, json, ex, conditions, startTime, grade }) => {
  const fr = finalsResponse(table, q);
  const r1 = sbAnswer1({ table, q, init, json, ex, fr });
  if (r1 !== sbAnswerNext) return r1;
  const r8 = sbAnswer2({ table, q, json, ex, conditions });
  if (r8 !== sbAnswerNext) return r8;
  // ST考察の元（選手の730日の走）。select に start_timing を含む問い合わせだけ
  const r12 = sbAnswer3({ table, q, json });
  if (r12 !== sbAnswerNext) return r12;
  const r15 = sbAnswer4({ table, q, json, startTime, grade });
  if (r15 !== sbAnswerNext) return r15;
  const r22 = sbAnswer5({ table, q, json });
  if (r22 !== sbAnswerNext) return r22;
  const map = {
    race_entries: m.db.racer1?.entries ?? [],
    races: m.db.racer1?.races ?? [],
    motor_pretest_stats: m.db.motor?.pretest ?? [],
    venue_motor_stats: m.db.motor?.stats ?? [],
  };
  return json(map[table] ?? []);
};

export const run = async ({
  conditions,
  startTime = "16:06:00",
  ex = exRows,
  stage = "exhibition",
  racers = m.api.facts.racers,
  grade = "G1",
}) => {
  const facts = { ...m.api.facts, racers };
  const json = (v) => ({ ok: true, status: 200, json: async () => v });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "sb.invalid") {
      const table = u.pathname.split("/").pop();
      const q = u.searchParams;
      return sbAnswer({ table, q, init, json, ex, conditions, startTime, grade });
    }
    const p = u.pathname;
    if (p.startsWith("/api/analogy/facts/")) return json(facts);
    if (p.startsWith("/api/analogy/similar/")) return json(m.api.similar);
    if (p.startsWith("/api/analogy/scenario/")) return json(m.api.scenario);
    if (p.startsWith("/api/predictions/"))
      return json({ races: m.api.races });
    if (p === "/api/outcome-distribution")
      return json(m.api.outcome[u.searchParams.get("venue_code")]);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const { fetchMaterials } = await import(
      `${R}/scripts/full-picture/fetch-materials.mjs`
    );
    return await fetchMaterials(m.raceId, { stage });
  } finally {
    globalThis.fetch = realFetch;
  }
};

async function scene1() {
  pre = {
    weather: "曇り",
    wind_direction: "北",
    wind_speed: 1,
    wave_height: 2,
    weather_observed_at: `${date}T05:51:00+00:00`,
  };
  got = await run({ conditions: pre });
  assert.deepEqual(validate(got), [], "展示の後の材料も契約に合う");
  ({ boats, conditions, technique: tq } = got.db.exhibition);
  assert.deepEqual(
    boats.map((b) => b.boat_number),
    [1, 2, 3, 4, 5, 6],
    "1〜6号艇を必ず並べる",
  );
  assert.deepEqual(
    {
      course: boats[0].exhibition_course,
      st: boats[0].start_timing,
      flag: boats[0].start_flag,
      time: boats[0].exhibition_time,
      tilt: boats[0].tilt,
      parts: boats[0].parts_changed,
      prop: boats[0].propeller_change,
    },
    {
      course: 1,
      st: 0.01,
      flag: "F",
      time: 6.7,
      tilt: 0,
      parts: ["リング", "ピストン"],
      prop: null,
    },
    "進入・展示 ST と F 表記・展示タイム・チルト・部品交換を出す",
  );
  assert.equal(boats[1].propeller_change, "新", "プロペラ交換を出す");
  // 追加の依頼（hq 10/25）: F 数（出走表の期の F 数）と今節の着順の並び
  assert.deepEqual(
    boats.map((b) => b.f_count),
    [1, 0, 0, 0, null, null],
    "F 数は出走表の f_count、欠けは null",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.5.f_count" && x.reason === "値が無い",
    ),
    "F 数の欠けを記録",
  );
  assert.deepEqual(
    boats[0].meet_finishes,
    [
      { race_id: "2026-10-10-01-05", finish_mark: "1", finish_rank: 1 },
      { race_id: "2026-10-11-01-03", finish_mark: "F", finish_rank: null },
      { race_id: "2026-10-12-01-02", finish_mark: null, finish_rank: null },
    ],
    "今節の着順は時系列（race_id の順）で、着の無い表記（F 等）は finish_mark に残す",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.meet_finishes" &&
        /着順の無い走が1件/.test(x.reason),
    ),
    "結果の無い走を記録",
  );
  assert.deepEqual(
    boats[1].meet_finishes,
    [],
    "今節の走が無い艇は空の並び（初走）",
  );
  assert.equal(boats[2].meet_finishes, null, "racers に無い艇は null");
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.3.meet_finishes"),
    "racers に無い艇を記録",
  );
  assert.deepEqual(
    [boats[2].exhibition_course, boats[3].exhibition_course],
    [4, 3],
    "進入は展示の並び（枠番と違ってよい）",
  );
  assert.equal(boats[4].tilt, null, "欠けたチルトは null");
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.5.tilt"),
    "欠けた欄を missing に記録",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（validate・m・realFetch・exRows） */
export async function runFullPictureScene2B5(env) {
  ({ validate, m, realFetch, exRows } = env);
  await scene1();
}
