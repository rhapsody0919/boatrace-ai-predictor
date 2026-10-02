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
 * 検出するもの・除くもの（BOA-663、scripts/lib/stripNonCode.js を verify-e2e-no-unroute.js
 * と共有）:
 *   - route.continue() / route.fetch() の検出は、コメント・文字列・テンプレート・
 *     正規表現リテラルの中身を空白にした上で行う。以前は行コメントを `//` で単純に
 *     切っていたため、文字列中の `//`（URL 等）より後ろを誤って落としていた
 *   - `@playwright/test` からの import 検出は、元のソースに対して行う（import元の
 *     モジュール名そのものが検査対象のため）。ただし、一致した位置がコメントの中で
 *     ないこと（stripNonCode で空白にされていないこと）を確認する
 *
 * 対象は e2e/**\/*.js（e2e/recordings/ を除く）。e2e/fixtures.js 自身は、録画の再生の
 * 実装として `test as base` の import・route.fetch() を正当に使うため、
 * verify-e2e-recorded-network-allowlist.json に理由つきで載せて除外する
 * （verify-e2e-no-unroute.js の許可リストの流儀に揃える。1エントリ=1箇所、
 * reason が無い・短い／解消済みのエントリは失敗にする）。
 *
 * 使い方: node scripts/maintenance/verify-e2e-recorded-network.js
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripNonCode } from "../lib/stripNonCode.js";
import { compareWithAllowlist } from "../lib/compareWithAllowlist.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(HERE, "../..");
const E2E_DIR = path.join(repoRoot, "e2e");
const ALLOWLIST_PATH = path.join(
  HERE,
  "verify-e2e-recorded-network-allowlist.json",
);
const MIN_REASON_LENGTH = 10;

const IMPORT_RE =
  /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*["']@playwright\/test["']/g;

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/** コメント・文字列を除いた行ごとに、違反を返す（純関数） */
export function findViolations(source) {
  const code = stripNonCode(source);

  const violations = [];
  const usesBrowser = /async\s*\(\s*\{[^}]*\b(page|context|browser)\b/.test(
    code,
  );
  if (usesBrowser) {
    for (const m of source.matchAll(IMPORT_RE)) {
      // コメント・文字列の中の一致は無視する（stripNonCode がその位置を空白にしている）
      if (code[m.index] !== source[m.index]) continue;
      violations.push({
        line: lineOf(source, m.index),
        message:
          '`test` を "@playwright/test" から import している。"./fixtures.js" から import する',
      });
    }
  }

  for (const m of code.matchAll(/\broute\.continue\s*\(/g)) {
    violations.push({
      line: lineOf(code, m.index),
      message: "route.continue() は録画を飛ばす。route.fallback() を使う",
    });
  }
  for (const m of code.matchAll(/\broute\.fetch\s*\(/g)) {
    violations.push({
      line: lineOf(code, m.index),
      message:
        "route.fetch() は録画を通らない。fixtures.js の fetchRecorded(route) を使う",
    });
  }
  return violations.sort((a, b) => a.line - b.line);
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
    // #663: 文字列中の `//`（URL等）をコメントの開始と誤らない
    ['const url = "https://example.com/a"; await route.fetch();', 1],
    [
      'const url = "https://example.com/a";\n// route.fetch() は使わない\nroute.fallback();',
      0,
    ],
    // #663: コメントの中の import は検出しない
    [
      '// import { test } from "@playwright/test";\ntest("a", async ({ page }) => {});',
      0,
    ],
  ];
  return cases
    .map(([src, expected]) => ({
      src,
      expected,
      got: findViolations(src).length,
    }))
    .filter((c) => c.got !== c.expected);
}

function e2eFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "recordings" ? [] : e2eFiles(full);
    return d.name.endsWith(".js") ? [full] : [];
  });
}

function main() {
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

  const files = e2eFiles(E2E_DIR);
  const found = files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const rel = `e2e/${path.relative(E2E_DIR, file).split(path.sep).join("/")}`;
    const lines = source.split("\n");
    return findViolations(source).map((v) => ({
      file: rel,
      line: v.line,
      message: v.message,
      code: lines[v.line - 1].trim(),
    }));
  });

  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const { unallowed, stale, invalid } = compareWithAllowlist(
    found,
    allowlist.entries ?? [],
    { minReasonLength: MIN_REASON_LENGTH },
  );
  const allowlistRel = path.relative(repoRoot, ALLOWLIST_PATH);
  let ng = false;

  if (invalid.length > 0) {
    ng = true;
    console.error(
      `\nNG: ${allowlistRel} に理由（reason、${MIN_REASON_LENGTH}文字以上）の無いエントリがあります:`,
    );
    for (const e of invalid) console.error(`  ${e.file}: ${e.code}`);
  }
  if (unallowed.length > 0) {
    ng = true;
    console.error(
      `E2E の spec が録画の再生を素通りする書き方をしています（ADR-0077）:\n${unallowed
        .map((p) => `  ${p.file}:${p.line}  ${p.message}\n      ${p.code}`)
        .join("\n")}`,
    );
  }
  if (stale.length > 0) {
    ng = true;
    console.error(
      `\nNG: ${allowlistRel} に解消済みのエントリがあります（${stale.length} 件）。消してください:`,
    );
    for (const e of stale) console.error(`  ${e.file}: ${e.code}`);
  }
  if (ng) process.exit(1);
  console.log(
    `OK: e2e/**/*.js ${files.length}件は録画の再生を通る（許可リストで通した箇所 ${found.length} 件）`,
  );
}

main();
