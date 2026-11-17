#!/usr/bin/env node
/**
 * sherlockService.js の getSherlockPredictions が races の行を makeRace（src/pure/raceModel.js）に通すことの振る舞いの試験（DM02、BOA-1678）。
 * scripts/lib/renderJsx.js の module hooks で src を読み、src/services/supabaseClient.js を偽のクライアント（globalThis[FAKE_KEY]）へ
 * 差し替える（verify-bot-race-function.js と同じ形）。data/sherlock/model.json は import の属性なしで読まれるので、.json は既定の物として読む。
 * DB・ネットワークは使わない。戻りはモデルで勝率を計算した新しい形なので凍結は見られず、確率の値はこの試験では見ない。make を通ったことは、破れの行で
 * RangeError の道（空の一覧＋console.error）に入ることで見る。
 */
import assert from "node:assert/strict";
import { register } from "node:module";

const FAKE_KEY = "__verifySherlockRaceSupabase";
const HOOKS = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith("/src/services/supabaseClient.js")) {
    return { url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${FAKE_KEY};"), shortCircuit: true };
  }
  return resolved;
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    return { format: "module", source: "export default " + (await readFile(fileURLToPath(url), "utf8")) + ";", shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

/** 表ごとの行（tables.current）を返す偽の supabase。service は import の時に1度だけ受け取るので、表は後から差し替える。
 *  from(表) の後の select・eq・like・order はどれも同じ物を返し、await で { data } になる */
const tables = { current: {} };
globalThis[FAKE_KEY] = {
  from(table) {
    const q = {
      then: (ok, ng) => Promise.resolve({ data: tables.current[table] ?? null, error: null }).then(ok, ng),
    };
    for (const m of ["select", "eq", "like", "order"]) q[m] = () => q;
    return q;
  },
};
const { getSherlockPredictions } = await import("../../src/services/sherlockService.js");

const race = (extra = {}) => ({ race_id: "2026-11-01-02-12", venue_code: 2, race_number: 12, start_time: "20:40:00", ...extra });
const entries = [1, 2, 3, 4, 5, 6].map((b) => ({
  race_id: "2026-11-01-02-12",
  boat_number: b,
  player_name: `選手${b}`,
  grade: "B1",
  win_rate: 5,
  local_win_rate: 5,
  motor_2rate: 30,
  boat_2rate: 30,
}));

/** console.error を差し替えて呼び、戻りと出た引数を返す */
async function call(rows) {
  tables.current = rows;
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  try {
    return { out: await getSherlockPredictions("2026-11-01"), errors };
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

await test("正の行はレースの4列を変えずに予想の形にして返す（出走6艇）", async () => {
  const { out, errors } = await call({ races: [race()], race_entries: entries });
  assert.deepEqual(errors, []);
  assert.equal(out.length, 1);
  const { raceId, venueCode, venueName, raceNumber, startTime, boats } = out[0];
  assert.deepEqual(
    { raceId, venueCode, venueName, raceNumber, startTime },
    { raceId: "2026-11-01-02-12", venueCode: 2, venueName: "戸田", raceNumber: 12, startTime: "20:40:00" },
  );
  assert.deepEqual(boats.map((b) => b.playerName), ["選手1", "選手2", "選手3", "選手4", "選手5", "選手6"]);
});

await test("race_id とレース番号が食い違う行は makeRace の RangeError で取得失敗と同じ道（空の一覧＋console.error）", async () => {
  const { out, errors } = await call({ races: [race(), race({ race_id: "2026-11-01-02-11" })], race_entries: entries });
  assert.deepEqual(out, []);
  assert.equal(errors.length, 1);
  assert.ok(errors[0][1] instanceof RangeError, `RangeError でない: ${errors[0][1]}`);
  assert.match(errors[0][1].message, /race_id とレース番号が食い違う: 12（race_id=2026-11-01-02-11）/);
});

await test("races が0件なら空の一覧（console.error なし）", async () => {
  const { out, errors } = await call({ races: [] });
  assert.deepEqual(out, []);
  assert.deepEqual(errors, []);
});

console.log(`verify-sherlock-race-make: ${count} 件 OK`);
