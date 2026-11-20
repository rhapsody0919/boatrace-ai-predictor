/**
 * verify-full-picture-scene2.js の後半の場面（5/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { has } from "./full-picture-scene2-a-1.js";
import { MATERIALS_VERSION } from "./full-picture-scene2-a-4.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let validate, readFileSync, gunzipSync, FX, fixtures;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const { raceRowOf } = await import(
    `${R}/scripts/full-picture/fetch-materials.mjs`
  );
  const RID = "2026-11-04-24-12";
  const tables = {
    races: [
      {
        race_id: "2026-11-04-24-01",
        race_number: 1,
        start_time: "10:40:00",
        race_grade: "SG",
        cancellation_status: null,
      },
      {
        race_id: RID,
        race_number: 12,
        start_time: "16:44:00",
        race_grade: "SG",
        cancellation_status: null,
      },
    ],
    race_conditions: [
      {
        race_id: "2026-11-04-24-01",
        series_day: 6,
        is_final_day: true,
        race_title: "第６８回　ボートレースダービー",
      },
      { race_id: RID, series_day: null, is_final_day: null, race_title: null },
    ],
    race_series: [],
  };
  const get =
    (over = {}) =>
    async (table, query) => {
      if (over[table]) return over[table](query);
      // 締切の読み（race_id=eq.）は対象のレースの行だけ
      if (table === "races" && query.includes("race_id=eq."))
        return tables.races.filter((r) => r.race_id === RID);
      return tables[table];
    };
  const miss = [];
  assert.deepEqual(await raceRowOf(RID, get(), miss), {
    startTime: "16:44:00",
    grade: "SG",
    seriesDayText: "最終日",
    raceTitle: "第68回 ボートレースダービー",
  });
  assert.deepEqual(miss, []);
  const m2 = [];
  const noStart = await raceRowOf(
    RID,
    get({
      races: (q) =>
        q.includes("race_id=eq.")
          ? [{ start_time: null, race_grade: "SG" }]
          : tables.races,
    }),
    m2,
  );
  assert.equal(noStart.startTime, null);
  assert.ok(
    m2.some((x) => x.source === "race.startTime"),
    "締切が無ければ race.startTime を残す",
  );
  const m3 = [];
  const failed = await raceRowOf(
    RID,
    get({ race_conditions: () => Promise.reject(new Error("HTTP 500")) }),
    m3,
  );
  assert.deepEqual([failed.seriesDayText, failed.raceTitle], [null, null]);
  return { raceRowOf, RID, tables, get, m3 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ raceRowOf, RID, tables, get, m3 }) {
  assert.ok(
    m3.some(
      (x) =>
        x.source === "race.labels" &&
        /race_conditions を読めない（HTTP 500）/.test(x.reason),
    ),
    JSON.stringify(m3),
  );
  // SG・G1（races の race_grade が無く、節の grade で SG）なのに大会名が無いときは missing に残す（使う側が止める）
  const m5 = [];
  const noTitle = await raceRowOf(
    RID,
    get({
      races: (q) =>
        q.includes("race_id=eq.")
          ? [{ start_time: "16:44:00", race_grade: null }]
          : tables.races.map((r) => ({ ...r, race_grade: null })),
      race_conditions: () =>
        tables.race_conditions.map((c) => ({ ...c, race_title: null })),
      race_series: () => [
        {
          venue_code: 24,
          start_date: "2026-10-30",
          end_date: "2026-11-04",
          title: null,
          grade: "SG",
        },
      ],
    }),
    m5,
  );
  assert.deepEqual([noTitle.grade, noTitle.raceTitle], [null, null]);
  assert.ok(
    m5.some(
      (x) =>
        x.source === "race.raceTitle" && /SG なのに大会名が無い/.test(x.reason),
    ),
    JSON.stringify(m5),
  );
  const m4 = [];
  assert.equal(
    await raceRowOf(
      RID,
      get({ races: () => Promise.reject(new Error("HTTP 503")) }),
      m4,
    ),
    null,
  );
  assert.ok(m4.some((x) => x.source === "race" && /HTTP 503/.test(x.reason)));
}

async function scene3() {
  // 契約: 形が変わったら落ちる
  {
    const m = JSON.parse(
      gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"),
    );
    has(
      validate({ ...m, schemaVersion: "full-picture-materials/0" }),
      "full-picture-materials/1|full-picture-materials/2",
    );
    // BOA-1310: /1 の固定材料はそのまま通り、/2 は race の何日目・大会名を型で検査する
    assert.equal(
      m.schemaVersion,
      "full-picture-materials/1",
      "固定の材料は /1 のまま",
    );
    const v2 = (race) => ({
      ...m,
      schemaVersion: "full-picture-materials/2",
      race,
    });
    assert.deepEqual(
      validate(
        v2({
          startTime: "16:44:00",
          grade: "G1",
          seriesDayText: "3日目",
          raceTitle: "第68回 ボートレースダービー",
        }),
      ),
      [],
    );
    assert.deepEqual(
      validate(
        v2({
          startTime: "16:44:00",
          grade: "ippan",
          seriesDayText: "3日目",
          raceTitle: null,
        }),
      ),
      [],
    );
    has(
      validate(
        v2({
          startTime: "16:44:00",
          grade: "G1",
          seriesDayText: 3,
          raceTitle: null,
        }),
      ),
      "$.race.seriesDayText: 型が string|null でない",
    );
    has(
      validate(
        v2({
          startTime: "16:44:00",
          grade: "G1",
          seriesDayText: "3日目",
          raceTitle: 1,
        }),
      ),
      "$.race.raceTitle: 型が string|null でない",
    );
    has(
      validate({
        ...m,
        api: { ...m.api, facts: { ...m.api.facts, today: undefined } },
      }),
      "today",
    );
    has(
      validate({
        ...m,
        api: {
          ...m.api,
          races: [{ raceId: "x", raceNumber: "10", entries: [] }],
        },
      }),
      "型が integer でない",
    );
    has(validate({ ...m, db: { motor: null } }), "racer1 が無い");
  }
  {
    const s1 = await scene1();
    await scene2(s1);
  }
}

async function scene4() {
  // 取得（fetch-materials.mjs）の出力も契約に合う（API・Supabase は偽物。固定の材料を返す）
  {
    const m = JSON.parse(
      gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"),
    );
    const keys = m.api.facts.today.scope_keys["1"];
    const scopeOf = {
      [keys.NC]: "scenarioNC",
      [keys.NCR]: "scenarioNCR",
      [keys.NA]: "scenarioNA",
      [keys.VA]: "scenarioVA",
    };
    const realFetch = globalThis.fetch;
    // 読み込んだ後に匿名キーを入れても効く（daily.mjs がそうする。読み込むときに読んでいて、場面3・6の材料が黙って欠けた）
    const { fetchMaterials: fm0 } = await import(
      `${R}/scripts/full-picture/fetch-materials.mjs`
    );
    void fm0;
    process.env.VITE_SUPABASE_URL = "https://sb.invalid";
    process.env.VITE_SUPABASE_ANON_KEY = "x";
    const json = (v) => ({ ok: true, status: 200, json: async () => v });
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.hostname === "sb.invalid") {
        const table = u.pathname.split("/").pop();
        const map = {
          race_entries: m.db.racer1?.entries ?? [],
          races: m.db.racer1?.races ?? [],
          race_results: m.db.racer1?.results ?? [],
          race_start_timings: m.db.racer1?.st ?? [],
          motor_pretest_stats: m.db.motor?.pretest ?? [],
          venue_motor_stats: m.db.motor?.stats ?? [],
          exhibition_data: m.db.motor?.exhibition ?? [],
        };
        return json(map[table] ?? []);
      }
      const p = u.pathname;
      if (p.startsWith("/api/analogy/facts/")) return json(m.api.facts);
      if (p.startsWith("/api/analogy/similar/")) return json(m.api.similar);
      if (p.startsWith("/api/analogy/scenario/"))
        return json(m.api[scopeOf[u.searchParams.get("scope")] ?? "scenario"]);
      if (p.startsWith("/api/predictions/")) return json({ races: m.api.races });
      if (p === "/api/outcome-distribution")
        return json(m.api.outcome[u.searchParams.get("venue_code")]);
      return { ok: false, status: 404, json: async () => ({}) };
    };
    try {
      const { fetchMaterials } = await import(
        `${R}/scripts/full-picture/fetch-materials.mjs`
      );
      const got = await fetchMaterials(m.raceId);
      assert.deepEqual(validate(got), [], "取得の出力が材料の契約に合う");
      // 固定の材料は選手の ID を写していないので db.racer1 は「選手が無い」で欠ける。匿名キーの欠けで落ちないこと・モーターが取れることを見る
      assert.deepEqual(
        got.missing.filter((x) => /匿名キー/.test(x.reason)),
        [],
        "匿名キーを読み込みの後に入れても Supabase を読める",
      );
      assert.ok(got.db.motor, "モーターの材料が取れる");
      assert.equal(got.schemaVersion, MATERIALS_VERSION);
      assert.ok(
        !("exhibition" in got.db),
        "展示の前（racecard）の出力に展示の後の材料は足さない（既存の出力は変えない）",
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（validate・readFileSync・gunzipSync・FX・fixtures） */
export async function runFullPictureScene2A12(env) {
  ({ validate, readFileSync, gunzipSync, FX, fixtures } = env);
  await scene3();
  await scene4();
}
