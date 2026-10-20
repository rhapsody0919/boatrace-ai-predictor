/**
 * facts.json（/api/analogy/facts の応答）→ 場面2の材料 JSON。
 * 使い方: node scripts/full-picture/build-scene2.mjs <facts.json> <出力.json>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildScene2 } from "./scene2-data.mjs";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("使い方: node build-scene2.mjs <facts.json> <出力.json>");
  process.exit(2);
}
const scene = buildScene2(JSON.parse(readFileSync(input, "utf8")));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(scene, null, 2)}\n`);
for (const o of scene.omitted) console.warn(`[省いた要素] ${JSON.stringify(o)}`);
console.log(`${output}: 軸${scene.radar.axes.length}・カード${scene.cards.items.length}枚・省いた要素${scene.omitted.length}件`);
