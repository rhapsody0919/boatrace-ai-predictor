#!/usr/bin/env node
/** 会場名の写しを正準と照合する。DB・通信・対象コードの実行は不要。 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VENUE_NAMES } from "../lib/venueNames.js";
import { STADIUM_NAMES } from "../../src/constants/index.js";
import { VENUE_NAMES as RULE_NAMES } from "../../src/config/venueRules.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const expectedCodes = Array.from({ length: 24 }, (_, i) => i + 1);
const normalize = (pairs) => pairs.map(([code, name]) => [Number(code), name])
  .sort((a, b) => a[0] - b[0]);
const canonical = normalize(Object.entries(VENUE_NAMES));
assert.deepEqual(canonical.map(([code]) => code), expectedCodes, "正準は1〜24の24会場");

function compare(pairs, location) {
  const actual = normalize(pairs);
  assert.equal(actual.length, 24, `${location}: 24組が必要（実際 ${actual.length}）`);
  assert.deepEqual(actual.map(([code]) => code), expectedCodes, `${location}: コードの欠落・重複`);
  for (let i = 0; i < canonical.length; i++) {
    assert.equal(actual[i][1], canonical[i][1], `${location}: コード${canonical[i][0]}の会場名`);
  }
}

// 式を評価せず、既存の数値キーの表・code/name配列だけを読む。
// 未対応の構文は残余の検査と24組の検査で失敗させる。
function readTables(source, filename) {
  const declarations = /\b(?:(VENUE_NAMES|STADIUM_NAMES)\s*=\s*(\{)|(VENUES)\s*=\s*(\[))/g;
  const tables = [];
  for (const declaration of source.matchAll(declarations)) {
    const array = declaration[3] === "VENUES";
    const line = source.slice(0, declaration.index).split("\n").length;
    const location = `${filename}:${line} ${declaration[1] ?? declaration[3]}`;
    const tail = source.slice(declaration.index + declaration[0].length);
    const end = (array ? /\]\s*;/ : /\}\s*;/).exec(tail);
    assert.ok(end, `${location}: 表の終端を読めない`);
    const body = tail.slice(0, end.index);
    const entry = array
      ? /\{\s*code\s*:\s*["'](\d+)["']\s*,\s*name\s*:\s*["']([^"'\n]+)["']\s*,?\s*\}/g
      : /(?:["'](\d+)["']|(\d+))\s*:\s*["']([^"'\n]+)["']/g;
    const pairs = [...body.matchAll(entry)].map((match) => array
      ? [match[1], match[2]]
      : [match[1] ?? match[2], match[3]]);
    assert.match(body.replace(entry, ""), /^[\s,]*$/, `${location}: 未読の構文がある`);
    compare(pairs, location);
    tables.push({ location, pairs });
  }
  return tables;
}

compare(Object.entries(STADIUM_NAMES), "src/constants/index.js import");
compare(Object.entries(RULE_NAMES), "src/config/venueRules.js import");

// 同じ抽出・比較経路へメモリ上の変異を渡す（作業ツリーは変更しない）。
for (const [name, opening, entries, closing] of [
  ["VENUE_NAMES", "{", canonical.map(([c, n]) => `${c}: "${n}"`), "}"],
  ["STADIUM_NAMES", "{", canonical.map(([c, n]) => `"${String(c).padStart(2, "0")}": '${n}'`), "}"],
  ["VENUES", "[", canonical.map(([c, n]) => `{ code: "${c}", name: "${n}" }`), "]"],
]) {
  const source = `const ${name} = ${opening}${entries.join(",")}${closing};`;
  assert.equal(readTables(source, "self-test").length, 1);
  assert.throws(() => readTables(source.replace("桐生", "変更した名前"), "self-test"), /コード1の会場名/);
  assert.throws(() => readTables(`const ${name} = ${opening}${entries.slice(1).join(",")}${closing};`, "self-test"), /24組が必要/);
  assert.throws(() => readTables(`const ${name} = ${opening}${[...entries, entries[0]].join(",")}${closing};`, "self-test"), /24組が必要/);
}
assert.throws(() => compare([...canonical.slice(1), canonical[1]], "self-test"), /コードの欠落・重複/);
assert.throws(() => readTables("const VENUE_NAMES = { ...other };", "self-test"), /未読の構文/);
assert.throws(() => readTables("const VENUES = [", "self-test"), /終端を読めない/);

const files = execFileSync("git", ["ls-files", "-z", "src", "api", "scripts/lib"], {
  cwd: root, encoding: "utf8",
}).split("\0").filter(Boolean);
let count = 0;
let fileCount = 0;
for (const file of files) {
  const tables = readTables(readFileSync(new URL(file, new URL("../../", import.meta.url)), "utf8"), file);
  if (tables.length) fileCount++;
  for (const { location } of tables) console.log(`OK: ${location}（24組）`);
  count += tables.length;
}
assert.ok(count > 0, "走査対象の表がない");
console.log(`PASS: ${fileCount}ファイル・${count}表が正準と一致、自己確認も成功`);
