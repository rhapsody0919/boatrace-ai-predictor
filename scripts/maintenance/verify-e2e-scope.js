#!/usr/bin/env node
/**
 * e2e-scope.js（PR ゲートの e2e をどこまで流すか）の判定を固定の入力で検査する（BOA-929）。
 * 外部ネットワーク・実DBには触らない。
 *
 * 守るもの: 記事だけの PR は軽い組、docs だけは0件、src・scripts・e2e・.github・package*.json・設定を
 * 触る PR は必ず全部。PR の側で一覧を書き換えても、master の一覧で判定すれば全部に戻る。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyE2eScope } from "./e2e-scope.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const config = JSON.parse(
  readFileSync(
    path.join(repoRoot, "scripts/content/content-pr-gate.json"),
    "utf8",
  ),
);
const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
}
const scopeOf = (files, cfg = config) => classifyE2eScope(files, cfg).scope;

// --- 軽い組（記事の中身だけ） ---
check(
  "記事の .md と JSON だけは軽い組",
  scopeOf([
    "public/blog/foo.md",
    "src/data/blog-posts/foo.json",
    "public/images/blog/foo.jpg",
  ]),
  "light",
);
check(
  "翻訳の記事 JSON も軽い組",
  scopeOf(["src/data/blog-posts/en/foo.json"]),
  "light",
);
check(
  "図の JSON・content-manifests も軽い組",
  scopeOf(["public/blog-charts/a.json", "docs/content-manifests/a.json"]),
  "light",
);
check(
  "記事と docs の混在は軽い組",
  scopeOf(["public/blog/foo.md", "docs/knowledge/x.md"]),
  "light",
);

// --- 0件（docs だけ） ---
check(
  "docs だけは0件",
  scopeOf(["docs/adr/0100-e2e-scope-by-diff.md", "docs/knowledge/a.md"]),
  "none",
);
check(
  "docs/content-manifests だけは0件にしない（記事の一部）",
  scopeOf(["docs/content-manifests/a.json"]),
  "light",
);

// --- 全部 ---
for (const file of [
  "src/App.jsx",
  "src/data/blogPosts.js",
  "src/data/blog-posts/sub/dir/x.json",
  "scripts/maintenance/e2e-scope.js",
  "scripts/content/content-pr-gate.json",
  "e2e/smoke.spec.js",
  ".github/workflows/e2e-smoke-test.yml",
  "package.json",
  "package-lock.json",
  "vite.config.js",
  "playwright.config.js",
  "public/blog/nested/x.md",
  "public/images/blog/x.png",
  "README.md",
]) {
  check(
    `${file} を触る PR は全部`,
    scopeOf(["public/blog/foo.md", "docs/a.md", file]),
    "full",
  );
}
check(
  "src から記事へ改名した PR は元のパスも見て全部",
  scopeOf(["src/components/Old.jsx", "public/blog/new.md"]),
  "full",
);
check("空の差分は全部に倒す", scopeOf([]), "full");
check(
  "一覧の外のパスを理由に出す",
  classifyE2eScope(["public/blog/a.md", "src/b.js"], config).outside,
  ["src/b.js"],
);

// --- 一覧の改ざん ---
// PR の側で一覧に src を足しても、master の一覧（ここでは今のファイル）で判定すれば全部に戻る
const tampered = {
  ...config,
  allowedPathPatterns: [...config.allowedPathPatterns, "^src/", "^scripts/"],
};
const tamperedDiff = [
  "scripts/content/content-pr-gate.json",
  "src/App.jsx",
  "public/blog/a.md",
];
check(
  "改ざんした一覧では軽い組に見える（前提の確認）",
  scopeOf(tamperedDiff, tampered),
  "light",
);
check("master の一覧で判定すれば全部", scopeOf(tamperedDiff, config), "full");

// --- 設定が無い・壊れているときは例外（CLI は full に倒す） ---
let threw = false;
try {
  classifyE2eScope(["public/blog/a.md"], { allowedPathPatterns: ["^x"] });
} catch {
  threw = true;
}
check("e2eSkipPathPatterns が無い設定は例外", threw, true);

if (failures.length > 0) {
  console.error("NG: e2e-scope の検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: e2e-scope の判定${checked}件を検証`);
