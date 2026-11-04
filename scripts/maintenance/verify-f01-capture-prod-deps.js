/**
 * 完全版 f01 の撮影（f01-capture.mjs）が起こす道具が、本番の周の入れ方（root を npm ci）で入ることを固定する（BOA-1317）。
 * 撮影は root の node_modules/vite/bin/vite.js を起こし、vite-capture.config.mjs が vite.config.js を介して
 * @vitejs/plugin-react を読む。どちらかが devDependencies だと、hq の周が devDependencies を入れない設定のとき撮影が落ちる。
 * package.json の dependencies と package-lock.json（dev フラグが付いていない）の両方を見る。ネットも node_modules も要らない。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const lock = read("package-lock.json");

/** 撮影の頁のビルドに実際に要る物（vite.config.js の import と f01-capture.mjs の起動） */
const NEEDED = ["vite", "@vitejs/plugin-react"];

for (const name of NEEDED) {
  assert.ok(pkg.dependencies?.[name], `${name} が package.json の dependencies に無い（devDependencies だと npm ci --omit=dev で入らず、f01 の撮影が落ちる）`);
  assert.equal(pkg.devDependencies?.[name], undefined, `${name} が devDependencies にも重複している`);
  assert.ok(lock.packages[""].dependencies?.[name], `${name} が package-lock.json の root の dependencies に無い（npm install --package-lock-only で直す）`);
  const entry = lock.packages[`node_modules/${name}`];
  assert.ok(entry, `package-lock.json に node_modules/${name} が無い`);
  assert.notEqual(entry.dev, true, `package-lock.json で ${name} が dev 扱い（--omit=dev で入らない）`);
}

// vite と plugin-react が実行時に辿る依存も dev 扱いでないこと（dev のままだと --omit=dev で欠ける）
const seen = new Set();
const walk = (name) => {
  if (seen.has(name)) return;
  seen.add(name);
  const entry = lock.packages[`node_modules/${name}`];
  if (!entry) return; // optional で別の platform 用のものは lock に無いことがある
  assert.notEqual(entry.dev, true, `${name}（vite か plugin-react の依存）が dev 扱い`);
  for (const dep of Object.keys({ ...entry.dependencies })) walk(dep);
};
NEEDED.forEach(walk);

console.log(`OK: ${NEEDED.join(" ・ ")} は本番の入れ方（--omit=dev）で入る（依存 ${seen.size} 件を確認）`);
process.exit(0);
