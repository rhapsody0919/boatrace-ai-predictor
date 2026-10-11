/**
 * index.html の構造化データ（JSON-LD）に、実在しない評価や受け口の無い機能を書いていないことを確かめる。
 *
 * - aggregateRating / review: Google の構造化データ方針では、評価・レビューは実在するものに限る。
 *   2025-12-20 に架空の評価（4.5・100件）が入り、AIクローラー向けスナップショットにも出ていた
 *   （docs/proposal/ai-agent-era-strategy.md Phase 0）
 * - SearchAction: サイト内検索の受け口（?q=）が無いのに宣言していた
 * - 各ブロックが JSON として読めること
 *
 * 実在する評価の仕組みを作ったら、このチェックを見直す。
 */

import { readFileSync } from "node:fs";

const html = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf-8",
);
const blocks = [
  ...html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  ),
].map((m) => m[1]);

const failures = [];
const check = (label, ok) => {
  console.log(`  ${ok ? "OK" : "NG"}  ${label}`);
  if (!ok) failures.push(label);
};

check("JSON-LD のブロックがある", blocks.length > 0);

const collectTypesAndKeys = (node, out) => {
  if (Array.isArray(node)) {
    node.forEach((n) => collectTypesAndKeys(n, out));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      out.keys.add(key);
      if (key === "@type") out.types.add(value);
      collectTypesAndKeys(value, out);
    }
  }
  return out;
};

blocks.forEach((raw, i) => {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    check(`ブロック${i + 1} が JSON として読める（${err.message}）`, false);
    return;
  }
  check(`ブロック${i + 1} が JSON として読める`, true);
  const { keys, types } = collectTypesAndKeys(parsed, {
    keys: new Set(),
    types: new Set(),
  });
  check(
    `ブロック${i + 1} に aggregateRating・review が無い`,
    !keys.has("aggregateRating") && !keys.has("review"),
  );
  check(`ブロック${i + 1} に SearchAction が無い`, !types.has("SearchAction"));
});

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nOK: index.html の JSON-LD に架空の評価・受け口の無い機能は無い");
