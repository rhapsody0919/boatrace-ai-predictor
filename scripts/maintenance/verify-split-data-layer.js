/**
 * verify-split-data-layer.js - split-data-layer.mjs（BOA-1432、RA02a。中身は scripts/maintenance/splitDataLayer/）の変換の純関数を小さな固定の入力で試す。
 * メソッド→関数・this.X の置換・上の単位の領域（1つの領域だけ→その領域、ほか→core）・import の付け替え・
 * 影の名前・殻（短い形・再 export・使わない import を外す）・何回かに分けて回す・詰め方と循環なし・止める場合。
 * ファイルを読み書きしない（child_process・ネットワークも使わない）。
 * fixture の import は裸の名前（"lib-a" 等）にする。相対の字を行の頭に書くと verify-relative-imports が参照先を探す
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSplit } from "./split-data-layer.mjs";
import { astHash, parseModule } from "./splitDataLayer/ast.js";
import { freeNames } from "./splitDataLayer/freeNames.js";
import { findCycle } from "./splitDataLayer/build.js";
import { checkImports, mappingOf } from "./splitDataLayer/plan.js";
import { fileNameOf, areaOfFile } from "./splitDataLayer/table.js";

const src = (lines) => lines.join("\n") + "\n";

const BASE = src([
  "/** 頭の注釈 */",
  'import { a, b } from "lib-a";',
  'import { c } from "lib-c";',
  "",
  "function helperS(x) {",
  "  return a(x);",
  "}",
  "const SHARED = 1;",
  "export function clearCache() {",
  "  return SHARED;",
  "}",
  "",
  "/** 殻 */",
  "export const supabaseDataService = {",
  "  /** S の注釈 */",
  "  async getS(x) {",
  "    return helperS(x) + SHARED + this.getS2(x);",
  "  },",
  "  getS2(x) {",
  "    const c = 2; // import の c を影にする",
  "    return c + x;",
  "  },",
  "  async getR(x) {",
  "    return SHARED + b(x) + c;",
  "  },",
  "};",
]);
const TABLE = { core: [], schedule: ["getS", "getS2"], race: ["getR"] };

test("core と schedule を移す: メソッド→関数・this の置換・領域の導き・import", () => {
  const plan = planSplit(BASE, ["core", "schedule"], { table: TABLE });
  assert.deepEqual(Object.keys(plan.files).sort(), ["core.js", "scheduleQueries.js"]);
  const core = plan.files["core.js"];
  assert.match(core, /^export const SHARED = 1;$/m, "2つの領域が使う定数は core、別のファイルから読むので export");
  assert.match(core, /^export function clearCache\(\) \{$/m);
  const s = plan.files["scheduleQueries.js"];
  assert.match(s, /^export async function getS\(x\) \{$/m);
  assert.match(s, /^ {4}return helperS\(x\) \+ SHARED \+ getS2\(x\);$/m, "本体の字下げはそのまま、this.getS2 は getS2");
  assert.match(s, /^export function getS2\(x\) \{$/m);
  assert.match(s, /^function helperS\(x\) \{$/m, "schedule だけが使う関数は schedule、export は足さない");
  assert.match(s, /^\/\*\* S の注釈 \*\/$/m, "前の注釈は字下げを外して付いてくる");
  assert.match(s, /import \{ a \} from "lib-a";/);
  assert.match(s, /import \{ SHARED \} from "\.\/core\.js";/);
  assert.doesNotMatch(s, /from "lib-c"/, "影にした c は import しない");
  assert.doesNotMatch(s, /\},\n/, "メソッドの後ろの , を外す");
  assert.doesNotMatch(s, /this\./);
});

test("殻: 短い形・再 export・使わない import を外す・残るメソッドは字のまま", () => {
  const { facade } = planSplit(BASE, ["core", "schedule"], { table: TABLE });
  assert.match(facade, /^\/\*\* 頭の注釈 \*\/$/m);
  assert.match(facade, /^ {2}getS,\n {2}getS2,\n {2}async getR\(x\) \{$/m);
  assert.match(facade, /import \{ getS, getS2 \} from "\.\/scheduleQueries\.js";/);
  assert.match(facade, /import \{ SHARED \} from "\.\/core\.js";/);
  assert.match(facade, /export \{ clearCache \} from "\.\/core\.js";/);
  assert.match(facade, /import \{ b \} from "lib-a";/, "使わなくなった a を外し b は残す");
  assert.match(facade, /import \{ c \} from "lib-c";/);
  assert.doesNotMatch(facade, /function helperS/);
});

test("何回かに分けて回す: 2回目は殻を読み、移した名前は殻の import の先から読む", () => {
  const first = planSplit(BASE, ["core", "schedule"], { table: TABLE });
  const second = planSplit(first.facade, ["race"], { table: TABLE });
  const r = second.files["raceQueries.js"];
  assert.match(r, /^export async function getR\(x\) \{$/m);
  assert.match(r, /import \{ b \} from "lib-a";/);
  assert.match(r, /import \{ c \} from "lib-c";/);
  assert.match(r, /import \{ SHARED \} from "\.\/core\.js";/);
  assert.match(second.facade, /^ {2}getS,\n {2}getS2,\n {2}getR,\n\};$/m);
  assert.doesNotMatch(second.facade, /from "lib-/, "殻はもう外の import を使わない");
  assert.match(second.facade, /export \{ clearCache \} from "\.\/core\.js";/);
  assert.equal(second.mapping.length, 1);
  assert.throws(() => planSplit(second.facade, ["schedule"], { table: TABLE }), /既に移した/);
});

test("対応表: 移した単位の AST hash が元と同じ", () => {
  const plan = planSplit(BASE, ["core", "schedule"], { table: TABLE });
  const names = plan.mapping.map((m) => m.name).sort();
  assert.deepEqual(names, ["SHARED", "clearCache", "getS", "getS2", "helperS"]);
  for (const m of plan.mapping) assert.match(m.hash, /^[0-9a-f]{16}$/);
});

test("止める: core を最初に入れない・表に無い・表にあって元に無い・既にあるファイル・知らない領域", () => {
  assert.throws(() => planSplit(BASE, ["schedule"], { table: TABLE }), /core/);
  assert.throws(
    () => planSplit(BASE, ["core"], { table: { core: [], schedule: ["getS", "getS2"] } }),
    /表に無いメソッド: getR/,
  );
  assert.throws(
    () => planSplit(BASE, ["core"], { table: { ...TABLE, race: ["getR", "getGone"] } }),
    /表にあって元に無いメソッド: getGone/,
  );
  assert.throws(
    () => planSplit(BASE, ["core", "schedule"], { table: TABLE, existingFiles: ["scheduleQueries.js"] }),
    /既にある/,
  );
  assert.throws(() => planSplit(BASE, ["core", "nope"], { table: TABLE }), /知らない領域/);
});

const CROSS = src([
  "const K = 1;",
  "export const supabaseDataService = {",
  "  getS() {",
  "    return K;",
  "  },",
  "  getR() {",
  "    return K + this.getS();",
  "  },",
  "  getM() {",
  "    return this.getS();",
  "  },",
  "};",
]);

test("領域の間: まだ移していない領域は止める・別の領域の Queries は止める・prediction・meet は許す", () => {
  const table = { core: [], schedule: ["getS"], race: ["getR"], meet: ["getM"] };
  assert.throws(() => planSplit(CROSS, ["core", "race"], { table }), /まだ移していない this\.getS.*先に移す/);
  const t1 = planSplit(CROSS, ["core", "schedule"], { table });
  assert.throws(() => planSplit(t1.facade, ["race"], { table }), /domain-direct/);
  const shared = { core: [], meet: ["getS"], race: ["getR"], schedule: ["getM"] };
  const t2 = planSplit(CROSS, ["core", "meet"], { table: shared });
  const r = planSplit(t2.facade, ["race"], { table: shared }).files["raceQueries.js"];
  assert.match(r, /import \{ getS \} from "\.\/meetQueries\.js";/);
  assert.match(r, /return K \+ getS\(\);/);
});

test("this のほかの使い方・影の判定・委ねのメソッド", () => {
  const bad = src(["export const supabaseDataService = {", "  getS() {", "    const self = this;", "    return self;", "  },", "};"]);
  assert.throws(() => planSplit(bad, ["schedule"], { table: { core: [], schedule: ["getS"] } }), /this/);
  // 入れ子の function の this は数えない（矢の関数の this は数える）
  const nested = src([
    "export const supabaseDataService = {",
    "  getS() {",
    "    const f = function () { return this; };",
    "    return [1].map(() => this.getT()).concat(f);",
    "  },",
    "  getT() {",
    "    return 1;",
    "  },",
    "};",
  ]);
  const p = planSplit(nested, ["schedule"], { table: { core: [], schedule: ["getS", "getT"] } });
  assert.match(p.files["scheduleQueries.js"], /map\(\(\) => getT\(\)\)/);
  assert.match(p.files["scheduleQueries.js"], /function \(\) \{ return this; \}/);
  // メソッドが同じ名前の上の関数を呼ぶだけなら、メソッドを消して上の関数を export
  const del = src([
    "async function getG(v) {",
    "  return v;",
    "}",
    "export const supabaseDataService = {",
    "  getG(v) {",
    "    return getG(v);",
    "  },",
    "};",
  ]);
  const d = planSplit(del, ["motor"], { table: { core: [], motor: ["getG"] } });
  assert.match(d.files["motorQueries.js"], /^export async function getG\(v\) \{$/m);
  assert.equal((d.files["motorQueries.js"].match(/function getG/g) ?? []).length, 1);
  assert.match(d.facade, /^ {2}getG,$/m);
  assert.match(d.facade, /import \{ getG \} from "\.\/motorQueries\.js";/);
});

test("委ねのメソッド: 上の関数を先の回で core へ移した後でも短い形になる", () => {
  const del = src([
    "async function getG(v) {",
    "  return v;",
    "}",
    "export const supabaseDataService = {",
    "  getG(v) {",
    "    return getG(v);",
    "  },",
    "  async getS(v) {",
    "    return getG(v);",
    "  },",
    "};",
  ]);
  const table = { core: [], schedule: ["getS"], motor: ["getG"] };
  const first = planSplit(del, ["core", "schedule"], { table });
  assert.match(first.files["core.js"], /^export async function getG\(v\) \{$/m, "2つの領域が使うので core");
  assert.match(first.facade, /^ {2}getG\(v\) \{$/m, "motor はまだ移していないのでメソッドのまま");
  const second = planSplit(first.facade, ["motor"], { table });
  assert.deepEqual(Object.keys(second.files), [], "委ねるだけのメソッドは新しいファイルを作らない");
  assert.match(second.facade, /^ {2}getG,\n {2}getS,\n\};$/m);
  assert.match(second.facade, /import \{ getG \} from "\.\/core\.js";/);
});

test("詰め方: 線を越える手前で次のファイルへ・使う先を先に置いて import は後ろ→前だけ", () => {
  const body = (n) => Array.from({ length: n }, (_, i) => `    const v${i} = ${i};`);
  const big = src([
    "export const supabaseDataService = {",
    "  getA() {",
    ...body(6),
    "    return this.getB();",
    "  },",
    "  getB() {",
    ...body(6),
    "    return 2;",
    "  },",
    "  getC() {",
    ...body(6),
    "    return this.getA();",
    "  },",
    "};",
  ]);
  const plan = planSplit(big, ["schedule"], { table: { core: [], schedule: ["getA", "getB", "getC"] }, maxLines: 22 });
  const names = Object.keys(plan.files).sort();
  assert.ok(names.length >= 2, `分かれる: ${names.join(",")}`);
  // getB は getA より先（getA が使う）
  const first = plan.files["scheduleQueries.js"];
  assert.match(first, /export function getB\(\)/);
  for (const [f, text] of Object.entries(plan.files)) {
    const items = (text.match(/^export function/gm) ?? []).length;
    if (items > 1) assert.ok(text.split("\n").length - 1 <= 22, `${f} が線の内`);
    assert.doesNotMatch(f === "scheduleQueries.js" ? text : "", /from "\.\/scheduleQueries[0-9]+\.js"/, "最初のファイルは後ろを読まない");
  }
  assert.equal(fileNameOf("schedule", 1), "scheduleQueries2.js");
  assert.equal(fileNameOf("core", 0), "core.js");
  assert.equal(areaOfFile("./motorQueries3.js"), "motor");
  assert.equal(areaOfFile("./core2.js"), "core");
  assert.equal(areaOfFile("./supabaseClient"), null);
});

test("自由な名前・AST hash・循環の検出", () => {
  const ast = parseModule(
    src([
      "function f(p, { q = R }) {",
      "  const L = 1;",
      "  for (const i of X) { try { Y(i); } catch (e) { Z(e); } }",
      "  V = 1;",
      "  ({ a: U } = L);",
      "  return L + p + q + o.prop + { k: W }.k;",
      "}",
    ]),
  );
  assert.deepEqual([...freeNames(ast.program.body[0])].sort(), ["R", "U", "V", "W", "X", "Y", "Z", "o"]);
  const m = parseModule("const o = { async g(a) { return this.h(a); } };").program.body[0].declarations[0].init.properties[0];
  const fn = parseModule("export async function g(a) {\n    return h(a);\n}").program.body[0];
  assert.equal(astHash(m), astHash(fn), "メソッドと export の関数・this.h と h は同じ hash");
  const fn2 = parseModule("export async function g(a) { return h(a) + 1; }").program.body[0];
  assert.notEqual(astHash(fn), astHash(fn2), "1字でも変えれば違う hash");
  assert.deepEqual(findCycle(new Map([["a", new Set(["b"])], ["b", new Set(["a"])]])), ["a", "b", "a"]);
  assert.equal(findCycle(new Map([["a", new Set(["b"])], ["b", new Set()]])), null);
});

test("審査の指摘: this.X を X にすると局所の名前に隠れる・class の this・外からの let の代入は止める／残す", () => {
  const hidden = src(["export const supabaseDataService = {", "  getA(getB) {", "    return this.getB(getB);", "  },", "  getB(v) {", "    return v;", "  },", "};"]);
  assert.throws(() => planSplit(hidden, ["schedule"], { table: { core: [], schedule: ["getA", "getB"] } }), /隠れる/);
  const cls = src(["export const supabaseDataService = {", "  getA() {", "    class C { v = this.getB(); }", "    return C;", "  },", "  getB() {", "    return 1;", "  },", "};"]);
  const p = planSplit(cls, ["schedule"], { table: { core: [], schedule: ["getA", "getB"] } });
  assert.match(p.files["scheduleQueries.js"], /v = this\.getB\(\);/, "class の中の this は置き換えない");
  const re = src(["let counter = 0;", "export const supabaseDataService = {", "  getA() {", "    counter += 1;", "    return counter;", "  },", "};"]);
  assert.throws(() => planSplit(re, ["core", "schedule"], { table: { core: [], schedule: ["getA"] } }), /代入/);
  assert.throws(() => planSplit(BASE, ["core"], { table: { core: [], schedule: ["getS", "fooS2"], race: ["getR"] } }), /get で始める/);
});

test("審査の指摘: core は領域を読まない・ファイルを跨ぐ循環は止める・1単位で線を越える物は1ファイル・渡す順で同じ出力", () => {
  const coreReads = src([
    "function helperS() {",
    "  return 1;",
    "}",
    "export function clearX() {",
    "  return helperS();",
    "}",
    "export const supabaseDataService = {",
    "  getS() {",
    "    return helperS();",
    "  },",
    "};",
  ]);
  assert.throws(() => planSplit(coreReads, ["core", "schedule"], { table: { core: [], schedule: ["getS"] } }), /core は領域を読まない/);
  const body = (n) => Array.from({ length: n }, (_, i) => `    const v${i} = ${i};`);
  const mutual = src([
    "export const supabaseDataService = {",
    "  getA() {",
    ...body(8),
    "    return this.getB();",
    "  },",
    "  getB() {",
    ...body(8),
    "    return this.getA();",
    "  },",
    "};",
  ]);
  assert.throws(() => planSplit(mutual, ["schedule"], { table: { core: [], schedule: ["getA", "getB"] }, maxLines: 14 }), /循環/);
  const big = src(["export const supabaseDataService = {", "  getA() {", ...body(30), "    return 1;", "  },", "  getB() {", "    return 2;", "  },", "};"]);
  const t = { core: [], schedule: ["getA", "getB"] };
  const pb = planSplit(big, ["schedule"], { table: t, maxLines: 20 });
  assert.deepEqual(Object.keys(pb.files).sort(), ["scheduleQueries.js", "scheduleQueries2.js"]);
  assert.ok(pb.files["scheduleQueries.js"].split("\n").length > 20, "1単位で越える物はそのまま1ファイル");
  const x = planSplit(BASE, ["schedule", "core"], { table: TABLE });
  const y = planSplit(BASE, ["core", "schedule"], { table: TABLE });
  assert.deepEqual(x.files, y.files);
  assert.equal(x.facade, y.facade);
});

test("審査の指摘: 書いた後の確かめ（import の取りこぼし・余り・AST hash の食い違い）と switch のスコープ", () => {
  assert.throws(() => checkImports({ "a.js": "export const z = K;\n" }, new Set(["K"])), /import も宣言もせずに使う/);
  assert.throws(() => checkImports({ "a.js": 'import { q } from "lib-q";\nexport const z = 1;\n' }, new Set()), /使わない import: q/);
  checkImports({ "a.js": 'import { q } from "lib-q";\nexport const z = q;\n' }, new Set(["q"]));
  const node = parseModule("const K = 1;").program.body[0];
  const moving = new Map([["core", [{ kind: "unit", item: { names: ["K"], node } }]]]);
  assert.throws(() => mappingOf(moving, { "core.js": "export const K = 2;\n" }), /AST hash が元と違う/);
  assert.equal(mappingOf(moving, { "core.js": "export const K = 1;\n" })[0].file, "src/services/core.js");
  const sw = parseModule("function f(x) { switch (x) { case 1: const y = 2; return y; default: return Z; } }").program.body[0];
  assert.deepEqual([...freeNames(sw)].sort(), ["Z"]);
});
