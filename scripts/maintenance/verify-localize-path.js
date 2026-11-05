#!/usr/bin/env node
import assert from "node:assert/strict";

const localizeCases = [
  ["/guide", "en", "/en/guide"],
  ["/en/guide", "ja", "/guide"],
  ["/", "en", "/en/"],
  ["/", "ja", "/"],
  ["/en", "ko", "/ko/"],
  ["/zh-TW/race/2026-11-05-01-01", "en", "/en/race/2026-11-05-01-01"],
  ["/ko/venues/region", "zh-TW", "/zh-TW/venues/region"],
  ["/guide", undefined, "/guide"],
  ["/guide", "", "/guide"],
  ["/en/", "ja", "/"],
  ["/english", "en", "/en/english"],
  ["", "en", "/en/"],
];
const parseCases = [
  ["/en", { lng: "en", basePath: "/" }],
  ["/en/", { lng: "en", basePath: "/" }],
  ["/zh-TW/guide", { lng: "zh-TW", basePath: "/guide" }],
  ["/ko", { lng: "ko", basePath: "/" }],
  ["/english", { lng: "ja", basePath: "/english" }],
  ["", { lng: "ja", basePath: "/" }],
  ["/", { lng: "ja", basePath: "/" }],
  ["/ja/guide", { lng: "ja", basePath: "/ja/guide" }],
];

function verifyTable(module, cases = localizeCases) {
  for (const [path, lang, expected] of cases) {
    assert.equal(module.localizePath(path, lang), expected);
  }
  for (const [path, expected] of parseCases) {
    assert.deepEqual(module.parseLangFromPath(path), expected);
  }
  assert.deepEqual(module.SUPPORTED_LANGUAGES.map((l) => l.code), [
    "ja", "en", "zh-TW", "ko",
  ]);
  assert.equal(module.DEFAULT_LANGUAGE, "ja");
}

// 先に従来の入口を検査し、移動前にも出力の表を固定する。
const config = await import("../../src/config/languages.js");
verifyTable(config);
const changedCases = localizeCases.map((row, index) =>
  index === 0 ? [row[0], row[1], "/wrong"] : row,
);
assert.throws(() => verifyTable(config, changedCases), assert.AssertionError);
console.log("PASS: languages.js の出力表・期待値変更の自己確認");

const pure = await import("../../src/pure/localizePath.js");
verifyTable(pure);
for (const name of [
  "SUPPORTED_LANGUAGES", "DEFAULT_LANGUAGE", "parseLangFromPath", "localizePath",
]) {
  assert.equal(config[name], pure[name], `${name} は同じ値・参照`);
}
console.log("PASS: pure の出力表・再 export の同一性");
