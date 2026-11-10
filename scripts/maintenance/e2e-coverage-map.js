#!/usr/bin/env node
/**
 * e2e-coverage-map.js - 毎晩の全件（.github/workflows/e2e-nightly.yml）で、spec ごとの「動いた src のファイル」の表を作る
 * （docs/design/ci-minutes-reduction/design.md 12章、ADR-0100）。
 *
 *   node scripts/maintenance/e2e-coverage-map.js --coverage-dir=<dir> --list=<list.json> --out=<map.json>
 *
 *   --coverage-dir  e2e/fixtures.js（E2E_COVERAGE=1）が書いた *.jsonl を、下のディレクトリまで全部読む（組ごとに別の場所でよい）
 *   --list          `playwright test --list --reporter=json` の結果（全 spec の一覧。coverage の行が無い spec を見つけるため）
 *   --out           書く先。{ generatedAt, sha, specs: { "<spec>": ["src/..."] }, always: ["<spec>"] }
 *
 * always は選別で常に流す spec（自分で browser.newContext() を作る・coverage の行が無い）。組み立ては scripts/lib/e2eCoverageMap.js。
 * 検証: scripts/maintenance/verify-e2e-coverage-map.js
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCoverageMap,
  parseCoverageRows,
  specsInList,
} from "../lib/e2eCoverageMap.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) throw new Error(`--${name}=... が要る`);
  return hit.slice(name.length + 3);
}

function jsonlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p));
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function main() {
  const dir = arg("coverage-dir");
  const files = jsonlFiles(dir);
  if (files.length === 0)
    throw new Error(`${dir} に coverage の jsonl が1つも無い`);
  const rows = parseCoverageRows(files.map((f) => readFileSync(f, "utf8")));
  // list は Vite の env 読み込みがバナーを標準出力に出すことがあるので、レポーターに書かせたファイルを読む
  const list = JSON.parse(readFileSync(arg("list"), "utf8"));
  const specs = specsInList(list);
  const specTexts = Object.fromEntries(
    specs.map((s) => [s, readFileSync(path.join(ROOT, "e2e", s), "utf8")]),
  );
  const sha =
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  const map = buildCoverageMap({
    rows,
    specs,
    specTexts,
    generatedAt: new Date().toISOString(),
    sha,
  });
  writeFileSync(arg("out"), `${JSON.stringify(map, null, 2)}\n`);
  console.log(
    `表を書いた: spec ${specs.length} 本のうち src が取れたもの ${Object.keys(map.specs).length}・常に流すもの ${map.always.length}（行 ${rows.length} 件）`,
  );
}

try {
  main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
