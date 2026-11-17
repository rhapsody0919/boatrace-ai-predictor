#!/usr/bin/env node
/**
 * mycroftService.js の getMycroftPredictions が races の行を makeRace（src/pure/raceModel.js）に通すことの振る舞いの試験（DM02、BOA-1677）。
 * scripts/lib/renderJsx.js の module hooks で src を読み、src/services/supabaseClient.js を偽のクライアント（globalThis[FAKE_KEY]）へ
 * 差し替える（verify-bot-race-function.js と同じ形）。data/mycroft/model.json は import の属性なしで読まれるので、.json は既定の物として読む。
 * DB・ネットワークは使わない。戻りは画面向けに組んだ新しい形なので凍結は見られない。make を通ったことは、破れの行で
 * RangeError の道（空の一覧＋console.error）に入ることで見る。
 */
import assert from "node:assert/strict";
import { register } from "node:module";

const FAKE_KEY = "__verifyMycroftRaceSupabase";
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
 *  from(表) の後の select・eq・gte・lt・in はどれも同じ物を返し、await で { data } になる */
const tables = { current: {} };
globalThis[FAKE_KEY] = {
  from(table) {
    const q = {
      then: (ok, ng) => Promise.resolve({ data: tables.current[table] ?? null, error: null }).then(ok, ng),
    };
    for (const m of ["select", "eq", "gte", "lt", "in"]) q[m] = () => q;
    return q;
  },
};
const { getMycroftPredictions } = await import("../../src/services/mycroftService.js");

const race = (extra = {}) => ({ race_id: "2026-11-01-02-12", venue_code: 2, race_number: 12, start_time: "20:40:00", ...extra });
const pred = {
  race_id: "2026-11-01-02-12",
  rank_order: [1, 3, 2, 4, 5, 6],
  win_probs: [0.5, 0.1, 0.2, 0.1, 0.05, 0.05],
  attention_evidence: null,
  model_trained_at: "2026-10-31",
  predicted_at: "2026-11-01T01:00:00+00:00",
};
const entry = { race_id: "2026-11-01-02-12", boat_number: 1, player_name: "選手" };

/** console.error を差し替えて呼び、戻りと出た引数を返す */
async function call(rows) {
  tables.current = rows;
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  try {
    return { out: await getMycroftPredictions("2026-11-01"), errors };
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

await test("正の行は値を変えずに画面向けの形にして返す", async () => {
  const { out, errors } = await call({ races: [race()], race_entries: [entry], mycroft_predictions: [pred] });
  assert.deepEqual(errors, []);
  assert.deepEqual(out, [
    {
      raceId: "2026-11-01-02-12",
      venueCode: 2,
      venueName: "戸田",
      raceNumber: 12,
      startTime: "20:40:00",
      rankOrder: pred.rank_order,
      winProbs: pred.win_probs,
      attentionEvidence: null,
      playerNames: { 1: "選手" },
      modelTrainedAt: "2026-10-31",
      predictedAt: "2026-11-01T01:00:00+00:00",
    },
  ]);
});

await test("race_id とレース番号が食い違う行は makeRace の RangeError で取得失敗と同じ道（空の一覧＋console.error）", async () => {
  const { out, errors } = await call({ races: [race(), race({ race_id: "2026-11-01-02-11" })], race_entries: [entry], mycroft_predictions: [pred] });
  assert.deepEqual(out, []);
  assert.equal(errors.length, 1);
  assert.ok(errors[0][1] instanceof RangeError, `RangeError でない: ${errors[0][1]}`);
  assert.match(errors[0][1].message, /race_id とレース番号が食い違う: 12（race_id=2026-11-01-02-11）/);
});

await test("races が0件なら予想を引かずに空の一覧（console.error なし）", async () => {
  const { out, errors } = await call({ races: [] });
  assert.deepEqual(out, []);
  assert.deepEqual(errors, []);
});

console.log(`verify-mycroft-race-make: ${count} 件 OK`);
