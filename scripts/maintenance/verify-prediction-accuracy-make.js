#!/usr/bin/env node
/**
 * predictionQueries3.js の getAccuracy（的中率のページ、Edge API が取れないときの直の問い合わせ）が predictions の行を
 * makePrediction（src/pure/predictionModel.js）に通すことの振る舞いの試験（DM1x prediction のつなぎ）。偽の supabase
 * （verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す・1000行の上限）の上でサービス層を直に呼ぶ。
 * Edge API の fetch は失敗させて直の問い合わせへ落とす。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 破れの行（race_id の形が違う・model_id が無い・払戻が整数でない）は makePrediction の RangeError で reject する
 *     （呼び手 AccuracyHistory.jsx の catch で取得失敗の画面）。失敗はキャッシュに残らない
 *   - 正の行は今までどおり集計される（1000行のページを越えても全件、モデルごとの件数・的中・会場別）
 */
import assert from "node:assert/strict";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";

registerFakeServiceSupabase();
installLocalStorage();
// Edge API（/api/accuracy）は取れない扱いにし、predictions を直に読む道へ落とす
globalThis.fetch = async () => {
  throw new Error("verify: Edge API は使わない");
};

const { getAccuracy } = await import("../../src/services/predictionQueries3.js");

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const prediction = (i, extra = {}) => ({
  race_id: `${today}-${String((i % 24) + 1).padStart(2, "0")}-${String((i % 12) + 1).padStart(2, "0")}`,
  model_id: "standard",
  is_hit_win: i % 4 === 0,
  is_hit_place: i % 2 === 0,
  is_hit_trifecta: false,
  is_hit_trio: false,
  payout_win: i % 4 === 0 ? 250 : null,
  payout_place: i % 2 === 0 ? 120 : null,
  payout_trifecta: null,
  payout_trio: null,
  ...extra,
});

// 偽のクライアントに .not が無いので、今の本体が使う .not(col, "is", null) だけを neq(col, null) に読み替える
function use(predictions) {
  const fake = createFakeSupabase({ predictions, models: [], accuracy_cache: [] }, { project: true, maxRows: 1000 });
  const from = fake.from.bind(fake);
  fake.from = (table) => {
    const chain = from(table);
    chain.not = (col, op, val) => {
      assert.equal(op, "is", `偽が扱わない not の演算: ${op}`);
      assert.equal(val, null);
      return chain.neq(col, null);
    };
    return chain;
  };
  return setFakeSupabase(fake);
}

// Edge API の失敗は console.log に1行を出す。試験の出力を汚さないよう黙らせる
async function quiet(fn) {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

const BROKEN = [
  ["race_id が YYYY-MM-DD-VV-RR の形でない", { race_id: `${today}-4-1` }, /prediction の race_id が YYYY-MM-DD-VV-RR の形でない/],
  ["model_id が文字列でない", { model_id: null }, /prediction の model_id/],
  ["payout_win が整数でない", { payout_win: 250.5 }, /prediction の payout_win/],
];

for (const [label, extra, message] of BROKEN) {
  await test(`${label}行は RangeError で reject する`, async () => {
    use([prediction(0), prediction(1, extra)]);
    await quiet(() =>
      assert.rejects(getAccuracy(), (err) => {
        assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
        assert.match(err.message, message);
        return true;
      }),
    );
  });
}

await test("正の行は 1000 行のページを越えても全件が今までどおり集計される（直前の破れはキャッシュに残らない）", async () => {
  const rows = [
    ...Array.from({ length: 1200 }, (_, i) => prediction(i)),
    ...Array.from({ length: 30 }, (_, i) => prediction(i, { model_id: "safeBet" })),
  ];
  use(rows);
  const out = await quiet(() => getAccuracy());
  const standard = out.models.standard;
  assert.equal(standard.thisMonth.totalRaces, 1200);
  assert.equal(out.models.safeBet.thisMonth.totalRaces, 30);
  assert.equal(out.models.upsetFocus.thisMonth.totalRaces, 0);
  assert.equal(standard.dailyHistory.length, 1);
  assert.equal(standard.dailyHistory[0].date, today);
  assert.equal(standard.dailyHistory[0].totalRaces, 1200);
  assert.equal(Object.keys(standard.byVenue).length, 24);
  const venueTotal = Object.values(standard.byVenue).reduce((n, v) => n + v.overall.totalRaces, 0);
  assert.equal(venueTotal, 1200);
});

console.log(`verify-prediction-accuracy-make: ${count} 件 OK`);
