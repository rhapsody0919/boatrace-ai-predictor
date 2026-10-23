#!/usr/bin/env node
/**
 * E2E の組の分け方（e2e/shards.json）を読み、検査し、Playwright の引数に直す（BOA-929・BOA-769、ADR-0100）。
 *
 * 以前は e2e-smoke-test.yml・e2e-rerecord.yml の matrix に同じ分け方を2回書き、最後の組は
 * --grep-invert の正規表現も手で書いていた。分け方を1つの JSON にし、両方のワークフローと
 * check-e2e-shard-coverage.js がここを通して読む。
 *
 * 使い方（CI）:
 *   node scripts/maintenance/e2e-shards.js --matrix   → matrix={"include":[{"shard":1,"args":"..."}...]} を1行出す
 *
 * 検証: scripts/maintenance/verify-e2e-shards.js
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const SHARDS_PATH = path.join(repoRoot, "e2e/shards.json");

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** e2e/ 以下の spec のパス（e2e/ からの相対、/ 区切り）。 */
export function listSpecFiles(dir = path.join(repoRoot, "e2e")) {
  return readdirSync(dir, { recursive: true })
    .map((f) => String(f).split(path.sep).join("/"))
    .filter((f) => f.endsWith(".spec.js"));
}

/**
 * 分け方の誤りを文で返す（純関数。空なら問題なし）。
 * 見るもの: 最後だけが rest、spec が実在する、projects の形。
 * 同じ spec を2つの組に書いてよいのは、projects で当たるテストが分かれるとき（layout の幅を分ける等）。
 * どのプロジェクトがどの spec に当たるかは playwright.config.js の testMatch・testIgnore で決まり、ここでは
 * 分からないので、二重・漏れは実行の後に check-e2e-shard-coverage.js が全テストで見る。
 */
export function validateShards(config, specFiles) {
  const problems = [];
  const shards = config?.shards;
  if (!Array.isArray(shards) || shards.length < 2) {
    return ["shards が2組以上の配列ではありません"];
  }
  shards.forEach((s, i) => {
    const last = i === shards.length - 1;
    if (Boolean(s.rest) !== last) {
      problems.push(
        `${i + 1}組目: rest: true は最後の組だけに1つ置きます（残り全部を拾う組）`,
      );
    }
    if (last) return;
    if (!Array.isArray(s.specs) || s.specs.length === 0) {
      problems.push(`${i + 1}組目: specs が空です`);
      return;
    }
    for (const spec of s.specs) {
      if (!specFiles.includes(spec))
        problems.push(`${i + 1}組目: ${spec} が e2e/ にありません`);
    }
    if (
      s.projects !== undefined &&
      !(Array.isArray(s.projects) && s.projects.length > 0)
    ) {
      problems.push(`${i + 1}組目: projects は1つ以上の配列で書きます`);
    }
  });
  return problems;
}

/** 各組の Playwright の引数（シェルに埋める文字列）。最後の組は上に書いた spec を除く残り全部（純関数）。 */
export function shardArgs(config) {
  const named = [
    ...new Set(config.shards.flatMap((s) => (s.rest ? [] : s.specs))),
  ];
  return config.shards.map((s, i) => {
    if (s.rest) {
      const names = named.map((f) =>
        escapeRegExp(f.replace(/\.spec\.js$/, "")),
      );
      return {
        shard: i + 1,
        args: `--grep-invert "(^|[ /])(${names.join("|")})\\.spec\\.js( |$)"`,
      };
    }
    const projects = (s.projects ?? []).map((p) => `--project=${p}`);
    return {
      shard: i + 1,
      args: [...projects, ...s.specs.map((f) => `e2e/${f}`)].join(" "),
    };
  });
}

/** 読んで検査する。誤りがあれば例外。 */
export function loadShards(file = SHARDS_PATH) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  const problems = validateShards(config, listSpecFiles());
  if (problems.length > 0) {
    throw new Error(`e2e/shards.json の誤り:\n  ${problems.join("\n  ")}`);
  }
  return config;
}

function main() {
  if (!process.argv.includes("--matrix")) {
    console.error("使い方: node scripts/maintenance/e2e-shards.js --matrix");
    process.exit(1);
  }
  let config;
  try {
    config = loadShards();
  } catch (error) {
    console.error(`NG: ${error.message}`);
    process.exit(1);
  }
  console.log(`matrix=${JSON.stringify({ include: shardArgs(config) })}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
