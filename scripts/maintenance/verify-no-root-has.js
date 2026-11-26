// html:has()・body:has() を外した全てのページに効く CSS に、それが戻らないことを守る（recharts が文字を測るたびの再計算が重くなる。2026-11-26）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 代わりに、部品が useRootClass（src/hooks）で html・body に *-shown 等のクラスを付ける
const FILES = [
  "src/components/racer/RacerPageToc.css",
  "src/components/Header.css",
  "src/components/Footer.css",
  "src/components/siteFeedback/SiteFeedback.css",
];

/** 注釈を除いた CSS の中の html:has( と body:has( の数 */
export function countRootHas(css) {
  return (
    css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\b(?:html|body)\s*:has\(/g) ??
    []
  ).length;
}

assert.equal(countRootHas("body:has(> .a) .b{} html:has(.c){}"), 2);
assert.equal(countRootHas("body :has(.c){}"), 1);
assert.equal(
  countRootHas("/* body:has( */ body.a-shown .b{} .x:has(> .y){}"),
  0,
);

for (const file of FILES) {
  assert.equal(
    countRootHas(readFileSync(file, "utf-8")),
    0,
    `${file} に html:has()・body:has() がある`,
  );
}

console.log("verify-no-root-has: OK");
