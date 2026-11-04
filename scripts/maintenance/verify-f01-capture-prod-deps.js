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

// vite と plugin-react が辿る依存（dependencies・optionalDependencies）も dev 扱いでないこと（dev のままだと --omit=dev で欠ける）。
// 親の node_modules から上へ向けて探す（npm の解決と同じ。入れ子の node_modules/a/node_modules/b も見る）
const seen = new Set();
const resolve = (from, name) => {
  for (let base = from; ; base = base.slice(0, base.lastIndexOf("/node_modules/"))) {
    const key = `${base ? `${base}/` : ""}node_modules/${name}`;
    if (lock.packages[key]) return key;
    if (!base) return null;
  }
};
const walk = (key) => {
  if (seen.has(key)) return;
  seen.add(key);
  const entry = lock.packages[key];
  assert.notEqual(entry.dev, true, `${key}（vite か plugin-react の依存）が dev 扱い`);
  for (const dep of Object.keys(entry.dependencies ?? {})) {
    const k = resolve(key, dep);
    assert.ok(k, `${key} の依存 ${dep} が package-lock.json に無い`);
    walk(k);
  }
  // 別の OS 用の実行ファイル等は lock に無いことがある（無ければ飛ばす）。あれば dev 扱いでないこと
  for (const dep of Object.keys(entry.optionalDependencies ?? {})) {
    const k = resolve(key, dep);
    if (k) walk(k);
  }
};
NEEDED.forEach((n) => walk(`node_modules/${n}`));

console.log(`OK: ${NEEDED.join(" ・ ")} は本番の入れ方（--omit=dev）で入る（依存 ${seen.size} 件を確認）`);
process.exit(0);
