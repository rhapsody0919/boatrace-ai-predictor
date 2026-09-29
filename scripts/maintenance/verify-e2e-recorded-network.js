#!/usr/bin/env node
/**
 * E2E の spec が、録画の再生（e2e/fixtures.js、ADR-0077）を素通りして本番へ出る書き方を
 * していないかを検査する。
 *
 * PRゲートのE2Eは、/rest/v1/*・/api/* を録画から返し、録画に無いものは abort する。
 * 次の書き方はこの仕組みを通らず、再生時に本番へ出ようとして落ちる（または、録画時に
 * 取りこぼす）。導入初日に master 側で5箇所入り、実際に落ちた。
 *
 *   1. `@playwright/test` から直接 `test` を import する（fixture が掛からない）
 *   2. page.route の中の `route.continue()`（後ろの context のルート＝録画を飛ばす）
 *      → `route.fallback()` を使う
 *   3. page.route の中の `route.fetch()`（ブラウザの経路を通らず直接ネットワークへ出る）
 *      → `fetchRecorded(route)` を使う
 *
 * 1 は、ブラウザを使わない spec（page / context / browser を受け取らない）なら許す。
 *
 * 使い方: node scripts/maintenance/verify-e2e-recorded-network.js
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const E2E_DIR = path.join(repoRoot, "e2e");

/** コメントを落とした行ごとに、違反を返す（純関数） */
export function findViolations(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""));
  const text = code.join("\n");

  const violations = [];
  const usesBrowser = /async\s*\(\s*\{[^}]*\b(page|context|browser)\b/.test(
    text,
  );
  if (
    usesBrowser &&
    /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*["']@playwright\/test["']/.test(
      text,
    )
  ) {
    violations.push({
      line: code.findIndex((l) => l.includes("@playwright/test")) + 1,
      message:
        '`test` を "@playwright/test" から import している。"./fixtures.js" から import する',
    });
  }
  code.forEach((line, i) => {
    if (/\broute\.continue\s*\(/.test(line)) {
      violations.push({
        line: i + 1,
        message: "route.continue() は録画を飛ばす。route.fallback() を使う",
      });
    }
    if (/\broute\.fetch\s*\(/.test(line)) {
      violations.push({
        line: i + 1,
        message:
          "route.fetch() は録画を通らない。fixtures.js の fetchRecorded(route) を使う",
      });
    }
  });
  return violations;
}

function selfTest() {
  const cases = [
    [
      'import { test } from "@playwright/test";\ntest("a", async ({ page }) => {});',
      1,
    ],
    ['import { test } from "@playwright/test";\ntest("a", async () => {});', 0],
    [
      'import { test } from "./fixtures.js";\ntest("a", async ({ page }) => {});',
      0,
    ],
    ["await page.route('x', (route) => route.continue());", 1],
    ["const r = await route.fetch();", 1],
    ["// route.fetch() は使わない\nroute.fallback();", 0],
    ["/* route.continue() */ route.fallback();", 0],
  ];
  return cases
    .map(([src, expected]) => ({
      src,
      expected,
      got: findViolations(src).length,
    }))
    .filter((c) => c.got !== c.expected);
}

const selfFailures = selfTest();
if (selfFailures.length > 0) {
  console.error("検出ロジック自体が壊れています:");
  for (const f of selfFailures) {
    console.error(
      `  期待 ${f.expected} / 実際 ${f.got}: ${JSON.stringify(f.src)}`,
    );
  }
  process.exit(1);
}

const specs = readdirSync(E2E_DIR).filter((f) => f.endsWith(".spec.js"));
const problems = specs.flatMap((file) =>
  findViolations(readFileSync(path.join(E2E_DIR, file), "utf8")).map(
    (v) => `e2e/${file}:${v.line}  ${v.message}`,
  ),
);

if (problems.length > 0) {
  console.error(
    `E2E の spec が録画の再生を素通りする書き方をしています（ADR-0077）:\n${problems
      .map((p) => `  ${p}`)
      .join("\n")}`,
  );
  process.exit(1);
}
console.log(`OK: e2e/*.spec.js ${specs.length}件は録画の再生を通る`);
