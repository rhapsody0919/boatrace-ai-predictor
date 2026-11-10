/**
 * split-data-layer.mjs（supabaseDataService.js の振り分け、BOA-1432）の変換の純関数の検査。
 * 小さな固定の入力で、メソッド→関数・this の置換・詰め方・表に無いメソッドで止まること・
 * 領域の間の import・facade を確かめる。child_process・ネットワークは使わない
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  methodToFunction,
  replaceThis,
  packItems,
  planSplit,
  fileNameOf,
  findCycle,
} from "./split-data-layer.mjs";

const SOURCE = `/** 入口 */

import { x } from "../x.js";
import { y } from "../y.js";

/** 件数 */
const LIMIT = 10;

function pageSize() {
  return LIMIT;
}

function both() {
  return y;
}

export function exportedHelper() {
  return 3;
}

function getZ(v) {
  return v;
}

export const supabaseDataService = {
  /** 一覧 */
  async getAlpha(a) {
    return this.getBeta(a) + pageSize() + both();
  },

  getBeta(b) {
    return x(b);
  },

  getGamma() {
    return this.getAlpha(1) + both();
  },

  getZ(v) {
    return getZ(v);
  },
};
`;
const TABLE = {
  core: [],
  schedule: ["getAlpha", "getBeta"],
  race: ["getGamma", "getZ"],
};

test("メソッドは export function になり、字下げと本体は変わらない", () => {
  assert.equal(
    methodToFunction("async getX(a) {\n    return 1;\n  }", "getX"),
    "export async function getX(a) {\n    return 1;\n  }",
  );
  assert.equal(methodToFunction("getY() {}", "getY"), "export function getY() {}");
  assert.throws(() => methodToFunction("getY() {}", "getX"));
});

test("this.メソッド( は名前だけになり、メソッドでない this は止まる", () => {
  const names = new Set(["getA", "getB"]);
  assert.equal(replaceThis("this.getA(1) + this.getB()", names), "getA(1) + getB()");
  assert.throws(() => replaceThis("this.memory.get(1)", names), /this\.memory/);
});

test("詰め方は元の並び順のまま、上限を越える手前で次へ", () => {
  const items = [5, 5, 5, 20, 1].map((lines, i) => ({ lines, i }));
  assert.deepEqual(
    packItems(items, 10).map((g) => g.map((x) => x.i)),
    [[0, 1], [2], [3], [4]],
  );
  assert.deepEqual(packItems([], 10), []);
  assert.deepEqual(
    [0, 1, 2].map((i) => fileNameOf("core", i)).concat(fileNameOf("racer", 0), fileNameOf("racer", 1)),
    ["coreCache", "coreFetch", "coreFetch3", "racerQueries", "racerQueries2"],
  );
});

test("表に無いメソッドがあれば止まる", () => {
  assert.throws(
    () => planSplit(SOURCE, { table: { core: [], schedule: ["getAlpha", "getBeta"], race: ["getGamma"] }, unitArea: {} }),
    /表に無いメソッド: getZ/,
  );
});

test("領域ごとのファイル・領域の間の import・facade", () => {
  const plan = planSplit(SOURCE, { table: TABLE, unitArea: {} });
  const file = (n) => plan.files.find((f) => f.name === n).content;

  // 2 つの領域が使う both は core へ。1 つの領域だけが使う pageSize・LIMIT は付いていく
  const schedule = file("scheduleQueries");
  assert.match(schedule, /export async function getAlpha\(a\) \{/);
  assert.match(schedule, /return getBeta\(a\) \+ pageSize\(\) \+ both\(\);/);
  assert.doesNotMatch(schedule, /this\./);
  assert.match(schedule, /const LIMIT = 10;/);
  assert.doesNotMatch(schedule, /export (const LIMIT|function pageSize)/);
  assert.match(schedule, /import \{ both \} from "\.\/coreCache\.js";/);
  assert.match(schedule, /import \{ x \} from "\.\.\/x\.js";/);
  assert.doesNotMatch(schedule, /\.\.\/y\.js/);

  const core = file("coreCache");
  assert.match(core, /export function both\(\)/);
  assert.match(core, /import \{ y \} from "\.\.\/y\.js";/);
  assert.match(core, /export function exportedHelper\(\)/);

  const race = file("raceQueries");
  assert.match(race, /import \{ getAlpha \} from "\.\/scheduleQueries\.js";/);
  assert.match(race, /return getAlpha\(1\) \+ both\(\);/);

  // 同じ名前の上の単位を呼ぶだけのメソッドは、facade が上の単位を直に指す
  assert.doesNotMatch(race, /getZ/);
  assert.match(core, /export function getZ\(v\) \{\n {2}return v;/);
  assert.equal(plan.mapping.find((m) => m.name === "getZ").kind, "委譲");
  assert.match(plan.facade, /import \{ getZ \} from "\.\/coreCache\.js";/);

  assert.match(plan.facade, /^\/\*\* 入口 \*\//);
  assert.match(plan.facade, /import \{ getAlpha, getBeta \} from "\.\/scheduleQueries\.js";/);
  assert.match(plan.facade, /export \{ exportedHelper \} from "\.\/coreCache\.js";/);
  assert.match(
    plan.facade,
    /export const supabaseDataService = \{\n {2}getAlpha,\n {2}getBeta,\n {2}getGamma,\n {2}getZ,\n\};/,
  );
  assert.equal(plan.cycle, null);
});

test("詰め方が上限で次のファイルに分かれ、対応表に単位・先・hash が出る", () => {
  const plan = planSplit(SOURCE, { table: TABLE, unitArea: {}, maxLines: 3 });
  const names = plan.files.map((f) => f.name);
  assert.ok(names.includes("scheduleQueries2"));
  const row = plan.mapping.find((m) => m.name === "pageSize");
  assert.equal(row.kind, "単位");
  assert.match(row.file, /^scheduleQueries/);
  assert.match(row.hash, /^[0-9a-f]{12}$/);
});

test("import の循環を見つける", () => {
  const edges = new Map([
    ["a", new Set(["b"])],
    ["b", new Set(["a"])],
  ]);
  assert.deepEqual(findCycle(edges), ["a", "b", "a"]);
  assert.equal(findCycle(new Map([["a", new Set(["b"])], ["b", new Set()]])), null);
});
