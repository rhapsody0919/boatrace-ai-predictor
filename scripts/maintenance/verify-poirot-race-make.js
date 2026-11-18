#!/usr/bin/env node
/**
 * poirotService.js の getPoirotPredictions が races の行を makeRace（src/pure/raceModel.js）に通すことの振る舞いの試験（DM02、BOA-1676）。
 * scripts/lib/renderJsx.js の module hooks で src を読み、src/services/supabaseClient.js を偽のクライアント（globalThis[FAKE_KEY]）へ
 * 差し替える（verify-bot-race-function.js と同じ形）。DB・ネットワークは使わない。
 * 戻りは {...r, venue_name, models} の写しなので凍結は見られない。make を通ったことは、破れの行で RangeError の道
 * （空の一覧＋console.error）に入ることで見る。
 */
import assert from "node:assert/strict";
import { register } from "node:module";

const FAKE_KEY = "__verifyPoirotRaceSupabase";
const HOOKS = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith("/src/services/supabaseClient.js")) {
    return { url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${FAKE_KEY};"), shortCircuit: true };
  }
  return resolved;
}
`;
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

/** 表ごとの行（tables.current）を返す偽の supabase。service は import の時に1度だけ受け取るので、表は後から差し替える。
 *  from(表) の後の select・eq・order・in はどれも同じ物を返し、await で { data } になる */
const tables = { current: {} };
globalThis[FAKE_KEY] = {
  from(table) {
    const q = {
      then: (ok, ng) => Promise.resolve({ data: tables.current[table] ?? null, error: null }).then(ok, ng),
    };
    for (const m of ["select", "eq", "order", "in"]) q[m] = () => q;
    return q;
  },
};
const { getPoirotPredictions } = await import("../../src/services/poirotService.js");

const race = (extra = {}) => ({ race_id: "2026-11-01-02-12", venue_code: 2, race_number: 12, start_time: "20:40:00", ...extra });
const pred = (model_version) => ({ race_id: "2026-11-01-02-12", model_version, top_pick: 1 });

/** console.error を差し替えて呼び、戻りと出た引数を返す */
async function call(rows) {
  tables.current = rows;
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  try {
    return { out: await getPoirotPredictions(), errors };
  } finally {
    console.error = orig;
  }
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

await test("正の行は値を変えずに会場名とモデルを足して返す", async () => {
  const { out, errors } = await call({ races: [race()], poirot_predictions: [pred("rf-v1"), pred("lgbm-v2")] });
  assert.deepEqual(errors, []);
  assert.deepEqual(out.races, [{ ...race(), venue_name: "戸田", models: { "rf-v1": pred("rf-v1"), "lgbm-v2": pred("lgbm-v2") } }]);
});

await test("race_id とレース番号が食い違う行は makeRace の RangeError で取得失敗と同じ道（空の一覧＋console.error）", async () => {
  const { out, errors } = await call({ races: [race(), race({ race_id: "2026-11-01-02-11" })], poirot_predictions: [pred("rf-v1")] });
  assert.deepEqual(out.races, []);
  assert.equal(errors.length, 1);
  assert.ok(errors[0][1] instanceof RangeError, `RangeError でない: ${errors[0][1]}`);
  assert.match(errors[0][1].message, /race_id とレース番号が食い違う: 12（race_id=2026-11-01-02-11）/);
});

await test("races が0件なら予想を引かずに空の一覧（console.error なし）", async () => {
  const { out, errors } = await call({ races: [] });
  assert.deepEqual(out.races, []);
  assert.deepEqual(errors, []);
});

await test("races が null（取れなかった）なら空の一覧（console.error なし）", async () => {
  const { out, errors } = await call({});
  assert.deepEqual(out.races, []);
  assert.deepEqual(errors, []);
});

console.log(`verify-poirot-race-make: ${count} 件 OK`);
