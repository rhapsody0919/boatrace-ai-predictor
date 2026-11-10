#!/usr/bin/env node
/**
 * verify-size-baseline.js - 大きさの関所の部品（sizeBaselines.js、BOA-1429）を固定の入力で試す。
 * 基準・単位の hash・判定の純関数だけを見る（lint-changed.js への接続は後の票）。
 */
import {
  buildBaseline,
  checkAgainstBaseline,
  checkBaselineShrink,
  unitsOfSource,
} from "./sizeBaselines.js";

let failed = 0;
const ok = (cond, label) => {
  if (!cond) failed += 1;
  console.log(`${cond ? "OK" : "NG"}: ${label}`);
};

// total 行の関数（先頭と末尾の行を含む）
const fn = (name, total) =>
  [
    `export function ${name}() {`,
    ...Array.from({ length: total - 2 }, (_, i) => `  const a${i} = ${i};`),
    "}",
    "",
  ].join("\n");
const filler = (n) =>
  Array.from({ length: n }, (_, i) => `export const k${i} = ${i};`).join("\n");
const hashes = (src) => unitsOfSource(src).map((u) => u.hash).sort();
const check = (baseline, files, strictExisting = false) =>
  checkAgainstBaseline({ baseline, files, strictExisting });
const verdict = (r) => `${r.errors.length}赤/${r.warnings.length}警告`;

const BIG = fn("big", 120);
const baseline = buildBaseline({ "src/a.js": BIG });
const same = [{ file: "src/a.js", source: BIG, isNew: false }];

ok(
  baseline.initial_count === 1 && Object.keys(baseline.units).length === 1,
  "基準は線を越える単位だけを載せる",
);
ok(
  !Object.keys(buildBaseline({ "x.js": fn("small", 50) }).units).length,
  "線の内の単位は載せない",
);

let r = check(baseline, same);
ok(r.errors.length === 0 && r.warnings.length === 0, `基準の単位だけ→緑（${verdict(r)}）`);

const edited = BIG.replace("const a5 = 5;", "const a5 = 50;");
r = check(baseline, [{ file: "src/a.js", source: edited, isNew: false }]);
ok(r.errors.length === 0 && r.warnings.length === 1, `同じ場所で1行直す→警告（${verdict(r)}）`);

r = check(baseline, [{ file: "src/a.js", source: edited, isNew: false }], true);
ok(r.errors.length === 1, `旗が立つと同じ直しも赤（${verdict(r)}）`);

const grown = BIG.replace("const a5 = 5;", "const a5 = 5;\n  const extra = 1;");
r = check(baseline, [{ file: "src/a.js", source: grown, isNew: false }]);
ok(
  r.errors.length === 0 && r.warnings.length === 1,
  `同じ場所で行を増やす→半分の線までは警告（${verdict(r)}）`,
);

r = check(baseline, [{ file: "src/a.js", source: grown, isNew: false }], true);
ok(r.errors.length === 1, `旗が立つと行を増やす直しは赤（${verdict(r)}）`);

const branchy = BIG.replace(
  "const a5 = 5;",
  Array.from({ length: 16 }, (_, i) => `if (a${i}) a${i};`).join(" "),
);
r = check(baseline, [{ file: "src/a.js", source: branchy, isNew: false }]);
ok(
  r.errors.length === 0 && r.warnings.length === 1,
  `複雑さを増やす→半分の線までは警告（${verdict(r)}）`,
);

r = check(baseline, [{ file: "src/a.js", source: branchy, isNew: false }], true);
ok(r.errors.length === 1, `旗が立つと複雑さを増やす直しは赤（${verdict(r)}）`);

r = check(baseline, [
  { file: "src/a.js", source: grown.replace("function big(", "function big2("), isNew: false },
]);
ok(r.errors.length === 1, `同じファイルで名前を変えて伸ばす→赤（${verdict(r)}）`);

r = check(baseline, [{ file: "src/other.js", source: grown, isNew: false }]);
ok(r.errors.length === 1, `別のファイルの同じ名前は既にある単位と見なさない→赤（${verdict(r)}）`);

r = check(baseline, [{ file: "src/new.js", source: fn("fresh", 101), isNew: true }]);
ok(r.errors.length === 1, `線を越える新しい関数（101行）→赤（${verdict(r)}）`);

r = check(baseline, [{ file: "src/new.js", source: fn("edge", 100), isNew: true }]);
ok(r.errors.length === 0, `100行ちょうど→緑（${verdict(r)}）`);

const cx = `export function cx(a) {\n${Array.from({ length: 15 }, () => "  if (a) a();").join("\n")}\n}\n`;
r = check(baseline, [{ file: "src/cx.js", source: cx, isNew: true }]);
ok(r.errors.length === 1, `複雑さ 16 の新しい関数→赤（${verdict(r)}）`);

const moved = [{ file: "src/b.js", source: BIG, isNew: true }];
r = check(baseline, moved);
ok(r.errors.length === 0, `基準の関数を字のまま別ファイルへ移す→緑（${verdict(r)}）`);

r = check(baseline, [
  { file: "src/b.js", source: BIG.replace("a5 = 5", "a5 = 6"), isNew: true },
]);
ok(r.errors.length === 1, `移して1字変える→赤（${verdict(r)}）`);

r = check(baseline, [
  { file: "src/b.js", source: `${BIG}${filler(350)}\n`, isNew: true },
]);
ok(r.errors.length === 0, "新しいファイルの max-lines は基準の単位の行を除く（緑）");
r = check(baseline, [
  { file: "src/b.js", source: `${BIG}${filler(401)}\n`, isNew: true },
]);
ok(r.errors.length === 1, "基準の単位の行を除いても 400 を越える新しいファイル→赤");

const spaced = BIG.replace(/\n {2}/g, "\n\n    /* コメント */\n      ");
ok(
  hashes(spaced).join() === hashes(BIG).join() && spaced !== BIG,
  "コメント・空白だけ変える→同じ hash",
);
ok(hashes(BIG.replace("big", "bigger")).join() !== hashes(BIG).join(), "名前が変われば hash も変わる");

const cls = `class S {\n  async getX() {\n    return (await this.getY()) + this.other(1);\n  }\n  async getY() {\n    return 2;\n  }\n}\n`;
const fns = `export async function getX() {\n  return (await getY()) + this.other(1);\n}\nexport async function getY() {\n  return 2;\n}\n`;
const clsX = unitsOfSource(cls).find((u) => u.name === "getX").hash;
ok(
  clsX === unitsOfSource(fns).find((u) => u.name === "getX").hash,
  "class のメソッドを export async function へ移し this.getY( を getY( にする→同じ hash（領域外の this.other( は別）",
);
const fnsAll = fns.replace("this.other(1)", "other(1)");
ok(
  clsX !== unitsOfSource(fnsAll).find((u) => u.name === "getX").hash,
  "領域の外の this.other( を other( にすると hash が変わる",
);
const obj = `export default {\n  async getY() {\n    return 2;\n  },\n};\nconst h = async () => 1;\n`;
ok(
  unitsOfSource(obj).map((u) => u.name).join() === "getY,h",
  "object のメソッド・変数に入れた関数も単位",
);

const more = {
  initial_count: 1,
  units: { ...baseline.units, deadbeef: { lines: 101, complexity: 1, file: "x.js", name: "x" } },
};
let s = checkBaselineShrink({ base: baseline, current: more });
ok(s.errors.length === 1, `基準の units を足す→赤（${s.errors.length}件）`);
s = checkBaselineShrink({ base: baseline, current: { ...baseline, initial_count: 2 } });
ok(s.errors.length === 1, `initial_count を変える→赤（${s.errors.length}件）`);
s = checkBaselineShrink({ base: baseline, current: baseline });
ok(s.errors.length === 0 && s.strictExisting === false, "基準が同じ→緑で旗は立たない");

const four = { initial_count: 4, units: { a: baseline.units[Object.keys(baseline.units)[0]], b: {}, c: {} } };
s = checkBaselineShrink({ base: { ...four, units: { ...four.units } }, current: four });
ok(s.errors.length === 0 && s.strictExisting === false, "4件のうち3件→旗は立たない");
const half = { initial_count: 4, units: { a: four.units.a, b: {} } };
s = checkBaselineShrink({ base: four, current: half });
ok(s.errors.length === 0 && s.strictExisting === true, "件数が initial_count の半分以下→旗が立つ");

if (failed > 0) {
  console.error(`verify-size-baseline: NG（${failed} 件）`);
  process.exit(1);
}
console.log("verify-size-baseline: OK");
