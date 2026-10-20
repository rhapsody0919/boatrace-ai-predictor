/**
 * 材料 JSON → 全場面（型の並び: 1 条件 → 2 6艇の重ね図 → 2b 類似レース → 3 軸 → 4 展開 → 5 相手 → 6 機力と調子 → 8 展示後に見るところ）。
 * 純粋（材料だけから決まる）。run-full.mjs と検査（verify-full-picture-scene2.js）が使う。
 */
import { buildScene2 } from "./scene2-data.mjs";
import { buildScene1 } from "./scenes/scene1.mjs";
import { buildScene2b } from "./scenes/scene2b.mjs";
import { buildScene3 } from "./scenes/scene3.mjs";
import { buildScene4 } from "./scenes/scene4.mjs";
import { buildScene5 } from "./scenes/scene5.mjs";
import { buildScene6 } from "./scenes/scene6.mjs";
import { buildScene8 } from "./scenes/scene8.mjs";

/** @param {object} m 材料 JSON（fetch-materials.mjs、materials.schema.json） */
export function buildAll(m) {
  const s2 = m.api.facts ? buildScene2(m.api.facts) : null;
  return [
    { id: "scene1", kind: "step", data: buildScene1(m) },
    { id: "scene2", kind: "scene2", data: s2 },
    { id: "scene2b", kind: "step", data: buildScene2b(m) },
    { id: "scene3", kind: "step", data: buildScene3(m) },
    { id: "scene4", kind: "step", data: buildScene4(m) },
    { id: "scene5", kind: "step", data: buildScene5(m) },
    { id: "scene6", kind: "step", data: buildScene6(m) },
    { id: "scene8", kind: "step", data: buildScene8(m) },
  ];
}
