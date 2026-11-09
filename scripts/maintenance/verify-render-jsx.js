/**
 * scripts/lib/renderJsx.js の検査。実際の部品を描いて文字が出ること、
 * 部品を1か所壊すと同じ確かめが落ちることを見る（描かずに通る偽の緑を防ぐ）。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderJsx } from "../lib/renderJsx.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const componentPath = path.join(repoRoot, "src/components/MotorStatBadgeRow.jsx");
const props = {
  icon: "⚙",
  label: "鮮度",
  badges: [
    { key: "a", text: "3節" },
    { key: "b", text: "18走" },
  ],
};

/** 描いた結果が期待どおりかを見る。壊した部品では落ちることも、この関数で確かめる。 */
function checkBadgeRow(container) {
  const row = container.querySelector(".motor-stat-badge-row");
  assert.ok(row, "行の要素が描かれていない");
  assert.equal(row.querySelector(".motor-stat-badge-row-label").textContent, "⚙ 鮮度");
  assert.deepEqual(
    [...row.querySelectorAll(".motor-stat-badge-row-badge")].map((el) => el.textContent),
    ["3節", "18走"],
  );
}

// 1. 実物を描く（CSS の import は無視される）
const view = await renderJsx(componentPath, props);
checkBadgeRow(view.container);

// 2. props を変えて描き直すと DOM が変わる（空なら何も描かない、が部品の約束）
await view.rerender({ ...props, badges: [] });
assert.equal(view.container.innerHTML, "");
await view.unmount();

// 3. 1か所壊した写し（バッジの文字を key に）では同じ確かめが落ちる。
//    写しは react を解けるようリポジトリの node_modules/.cache の下に置く（OS の tmp からは解けない）
const cacheDir = path.join(repoRoot, "node_modules/.cache");
mkdirSync(cacheDir, { recursive: true });
const brokenDir = mkdtempSync(path.join(cacheDir, "render-jsx-"));
const brokenPath = path.join(brokenDir, "MotorStatBadgeRow.jsx");
const source = readFileSync(componentPath, "utf8");
assert.ok(source.includes("{badge.text}"), "壊す場所が見つからない（部品が変わったら壊し方を直す）");
writeFileSync(brokenPath, source.replace("{badge.text}", "{badge.key}"));
const broken = await renderJsx(brokenPath, props);
assert.throws(() => checkBadgeRow(broken.container), assert.AssertionError);
await broken.unmount();
rmSync(brokenDir, { recursive: true, force: true });

// 4. 無い export は意味のある文で落ちる
await assert.rejects(renderJsx(componentPath, props, { exportName: "Nope" }), /export "Nope"/);

console.log("verify-render-jsx: OK");
