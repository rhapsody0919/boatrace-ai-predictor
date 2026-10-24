#!/usr/bin/env node
/**
 * BOA-1042: parserUtils の変換と入れ子テーブルの除外を直接検証する。
 * 仕様の値: task-103-boa-1042 の期待値と parserUtils.js のコメント。
 * 今の実装の値: 指定 base 65bf85925 で照合した固定値。
 * 一致する入力だけを assert し、不一致は KNOWN_GAPS に記録する。
 * ネットワーク・DB・実時刻・鍵は使わない。
 */
import assert from "node:assert/strict";
import { load } from "cheerio";
import * as utils from "../lib/venueMotorStats/parserUtils.js";

const KNOWN_GAPS = [];
// [試験名, 関数, 入力, 仕様の値, 今の実装の値]
const CASES = [
  ["normalizeText: 全角数字・括弧と空白", "normalizeText", " ２連対率（％） ", "2連対率(％)", "2連対率(％)"],
  ["toIntOrNull: 全角数字", "toIntOrNull", "１２", 12, 12],
  ["toIntOrNull: 空文字", "toIntOrNull", "", null, null],
  ["toIntOrNull: null", "toIntOrNull", null, null, null],
  ["toIntOrNull: 非数値", "toIntOrNull", "abc", null, null],
  ["toFloatOrNull: 全角数字", "toFloatOrNull", "３４.５", 34.5, 34.5],
  ["toStrictIntOrNull: 着順は拒否", "toStrictIntOrNull", "4着", null, null],
  ["toStrictIntOrNull: 津の改行付き機番", "toStrictIntOrNull", "44\n\n44番モーター", 44, 44],
  ["toStrictIntOrNull: 全角機番", "toStrictIntOrNull", "４４", 44, 44],
  ["parseBestTime: 半角", "parseBestTime", "1'48\"5", 108.5, 108.5],
  ["parseBestTime: 全角数字", "parseBestTime", "１'４８\"５", 108.5, 108.5],
  ["parseBestTime: 不正文字", "parseBestTime", "x", null, null],
  ["parseBestTime: 空文字", "parseBestTime", "", null, null],
  ["toIsoDate: 月日のゼロ埋め", "toIsoDate", "2026/1/5", "2026-01-05", "2026-01-05"],
  ["toIsoDate: null", "toIsoDate", null, null, null],
  ["parseStatsPeriod: 空文字", "parseStatsPeriod", "", { start: null, end: null }, { start: null, end: null }],
];
for (const separator of ["～", "〜", "~"]) {
  CASES.push([
    `parseStatsPeriod: 区切り ${separator}`,
    "parseStatsPeriod",
    `2026/1/5${separator}2026/10/24`,
    { start: "2026-01-05", end: "2026-10-24" },
    { start: "2026-01-05", end: "2026-10-24" },
  ]);
}

let passed = 0;
let failed = 0;
function check(name, actual, specification, current) {
  try {
    assert.deepStrictEqual(current, specification, "仕様と現在値の不一致は KNOWN_GAPS に移す");
    assert.deepStrictEqual(actual, specification);
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}\n${error.message}`);
  }
}
for (const [name, fn, input, specification, current] of CASES) {
  check(name, utils[fn](input), specification, current);
}

// HTML パーサーの tbody 自動挿入と、tr が実際に直下にある構造を別々に検証。
for (const [name, html, options] of [
  ["thead・tbody", '<table id="outer"><thead><tr id="heading"><th>機番</th><th>値</th></tr></thead><tbody><tr id="data"><td>44<table><tr><td>inner</td></tr></table></td><td> x </td></tr></tbody></table>', {}],
  ["theadなしのHTML", '<table id="outer"><tr id="heading"><th>機番</th><th>値</th></tr><tr id="data"><td>44<table><tr><td>inner</td></tr></table></td><td> x </td></tr></table>', {}],
  ["trが直接の子", '<table id="outer"><tr id="heading"><th>機番</th><th>値</th></tr><tr id="data"><td>44<table><tr><td>inner</td></tr></table></td><td> x </td></tr></table>', { xmlMode: true }],
]) {
  const $ = load(html, options);
  const table = $("#outer");
  const before = table.html();
  const rows = utils.directRows($, table);
  check(`directRows: ${name}・入れ子を除外`, rows.map((_, row) => $(row).attr("id")).get(), ["heading", "data"], ["heading", "data"]);
  check(`directCells: ${name}・th`, utils.directCells($, rows[0]), ["機番", "値"], ["機番", "値"]);
  check(`directCells: ${name}・入れ子と空白を除去`, utils.directCells($, rows[1]), ["44", "x"], ["44", "x"]);
  check(`cellText: ${name}・元DOMを保持`, table.html(), before, before);
}
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
console.log(`parserUtils: ${passed}件通過 / ${failed}件失敗`);
if (failed > 0) process.exitCode = 1;
