#!/usr/bin/env node
/**
 * verify-pr-lane-size.js - pr-lane の大きさの規則（H10、config/pr-path-rules.json の size、BOA-1718）を固定する。
 * 外部接続なし・git に触れない（tier=ci）。数え方そのものは verify-pr-size*.js が見る。ここは pr-lane の classify が
 * 数えた結果（prSizeGit.js の measureCommits の戻り）で lane を決めることだけを見る。
 *
 * - 線を超えたら、数えたファイルごとに H10 で heavy。human に size の理由が付く
 * - 線の中は light。数えられなければ（{ error }）差分の最初のファイルに H10 で heavy（安全側）
 * - size を渡さなければ H10 を当てない（classify の既定）。規則の表に size の規則と human の size がある
 * 試験の入力のパスは木に無い名（zz/）にする（ほかの規則に当てず H10 だけを見る）
 */
import assert from "node:assert/strict";
import { classify, loadRules, loadHuman } from "./pr-lane.js";

const A = "zz/a.md";
const B = "zz/b.md";
const changes = [
  { status: "A", path: A },
  { status: "M", path: B },
];
const run = (size) => classify({ changes, size });
const counted = (lines) => [
  { path: A, lines },
  { path: B, lines: 1 },
];

const over = run({ over: true, lines: 301, files: 2, counted: counted(300) });
assert.equal(over.lane, "heavy", "線を超えたら heavy");
assert.deepEqual(
  over.hits.map((h) => `${h.rule} ${h.file}`),
  [`H10 ${A}`, `H10 ${B}`],
  "数えたファイルごとに H10",
);
assert.match(over.hits[0].reason, /301行・2ファイル/);
assert.deepEqual(
  over.human.map((h) => `${h.kind} ${h.file}`),
  [`size ${A}`, `size ${B}`],
  "human に size（人が見る理由）",
);

const inside = run({ over: false, lines: 300, files: 2, counted: counted(299) });
assert.equal(inside.lane, "light", "線の中は light");
assert.deepEqual(inside.hits, []);

const error = run({ error: "git が落ちた" });
assert.equal(error.lane, "heavy", "数えられなければ heavy");
assert.deepEqual(
  error.hits.map((h) => `${h.rule} ${h.file}`),
  [`H10 ${A}`],
  "差分の最初のファイルに当てる",
);
assert.match(error.hits[0].reason, /数えられない.*git が落ちた/);

assert.equal(run(null).lane, "light", "size を渡さなければ当てない");

const sizeRules = loadRules().filter((r) => r.size);
assert.deepEqual(
  sizeRules.map((r) => r.id),
  ["H10"],
  "規則の表に size の規則が1つ",
);
assert.equal(loadHuman().size?.fromRule, "H10", "human の size は H10 から");

console.log("verify-pr-lane-size: OK");
