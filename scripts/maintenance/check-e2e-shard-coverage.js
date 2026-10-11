#!/usr/bin/env node
/**
 * E2E を spec 単位で分けて並行に走らせたとき（e2e-smoke-test.yml の e2e-shard）、
 * 全テストがちょうど1回ずつ走ったかを確かめる（BOA-769）。
 *
 * 分け方はワークフローの matrix に spec 名で書いてあり、最後の組は「それ以外すべて」を
 * --grep-invert で拾う。正規表現を書き違えると、テストが黙ってどの組にも入らない
 * （緑のまま検証されない）か、2つの組で二重に走る。skip の検査（check-e2e-skips.js）は
 * プロジェクト単位で見るので、spec が1本丸ごと抜けても気づかない。
 *
 * 入力:
 *   e2e-list.json     `playwright test --list --reporter=json` の出力（走るべき全テスト）
 *   e2e-results.json  merge-reports で集約したレポート（実際に走ったテスト）
 *
 * 使い方:
 *   node scripts/maintenance/check-e2e-shard-coverage.js [e2e-list.json] [e2e-results.json]
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flattenTests } from "./check-e2e-skips.js";

/** テストの識別子。Playwright は同じファイル内の同名テストを許さないので、プロジェクト＋タイトル（ファイル名を含む）で一意 */
const keyOf = (t) => `[${t.project}] ${t.title}`;

/** 走るべきテストと走ったテストを比べる（純関数） */
export function compareCoverage(listed, ran) {
  const counts = new Map();
  for (const t of ran) counts.set(keyOf(t), (counts.get(keyOf(t)) ?? 0) + 1);
  const expected = new Set(listed.map(keyOf));
  return {
    missing: [...expected].filter((k) => !counts.has(k)),
    duplicated: [...counts].filter(([, n]) => n > 1).map(([k]) => k),
    unexpected: [...counts.keys()].filter((k) => !expected.has(k)),
  };
}

function readReport(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} を読めません: ${error.message}`);
  }
}

function main() {
  const [listFile = "e2e-list.json", resultFile = "e2e-results.json"] =
    process.argv.slice(2);
  // readReport は読めない・壊れている場合に例外を投げる。ここで捕まえずに
  // 投げっぱなしだと、CIログがNode.jsの生スタックトレースになる（実測:
  // 最初のCI実行で --list のJSON出力がdotenvバナーで壊れたとき、まさに
  // これが起きた）。姉妹スクリプト check-e2e-skips.js と同じく
  // 「NG: ...」の一文に揃える
  let listed, ran;
  try {
    listed = flattenTests(readReport(listFile));
    ran = flattenTests(readReport(resultFile));
  } catch (error) {
    console.error(`NG: ${error.message}`);
    process.exit(1);
  }
  if (listed.length === 0) {
    console.error(`NG: ${listFile} にテストが1件もありません`);
    process.exit(1);
  }
  const { missing, duplicated, unexpected } = compareCoverage(listed, ran);
  const show = (label, keys) => {
    if (keys.length === 0) return;
    console.error(`${label}（${keys.length}件）:`);
    for (const k of keys.slice(0, 50)) console.error(`  ${k}`);
    if (keys.length > 50) console.error(`  ほか${keys.length - 50}件`);
  };
  show("どの組でも走っていないテスト", missing);
  show("2つ以上の組で走ったテスト", duplicated);
  show("一覧に無いのに走ったテスト", unexpected);
  if (missing.length + duplicated.length + unexpected.length > 0) {
    console.error(
      "NG: E2E の分割（e2e-smoke-test.yml の matrix）が全テストを1回ずつに分けていません",
    );
    process.exit(1);
  }
  console.log(`OK: ${listed.length}件のテストがちょうど1回ずつ走った`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
