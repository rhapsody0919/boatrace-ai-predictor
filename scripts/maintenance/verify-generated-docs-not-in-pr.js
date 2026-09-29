#!/usr/bin/env node
/**
 * verify-generated-docs-not-in-pr.js — PRが機械生成の文書を変更していないことを検査する（ADR-0078）。
 *
 * 生成物（generated-docs.js の GENERATED_DOCS）は、masterへのマージ後に
 * regenerate-generated-docs.yml が作り直してコミットする。PRに含めると、生成物は
 * ほぼ全PRで変わるため、並行するPRが同じファイルでコンフリクトする。GitHubのマージ
 * （mergeable判定・Mergeボタン・gh pr merge）は .gitattributes のマージドライバを
 * 使わないので、属性では解消できない。そこで「PRに含めない」を機械的に守らせる。
 *
 * 見るのは `git diff --name-only <base>...HEAD`（merge-base からの差分＝PRが持ち込む変更）。
 * master上（push時のCI）では差分が空になるので通る。
 *
 * 使い方: node scripts/maintenance/verify-generated-docs-not-in-pr.js --base=origin/master
 *   base を解決できない場合、CI（環境変数 CI が立っている）では失敗、手元ではスキップする。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_DOCS } from "./generated-docs.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * 変更されたファイルのうち、生成物に当たるものを返す。
 * @param {string[]} changedFiles
 * @param {string[]} outputs
 * @returns {string[]}
 */
export function findTouchedGeneratedDocs(changedFiles, outputs) {
  const set = new Set(outputs);
  return changedFiles.filter((f) => set.has(f));
}

// --- 判定ロジックの固定入力での検証 ---
const failures = [];
function check(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}
const OUTS = ["docs/reference/a.md", "docs/reference/b.md"];
check(
  "生成物に当たるものだけを返す",
  findTouchedGeneratedDocs(["src/x.js", "docs/reference/b.md"], OUTS),
  ["docs/reference/b.md"],
);
check("変更が無ければ空", findTouchedGeneratedDocs([], OUTS), []);
check(
  "前方一致では当てない（別ファイル）",
  findTouchedGeneratedDocs(["docs/reference/a.md.bak"], OUTS),
  [],
);
check(
  "一覧が空でないこと（generated-docs.js の読み込み）",
  GENERATED_DOCS.length > 0,
  true,
);
if (failures.length > 0) {
  console.error("NG: 生成物の検査ロジックが期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// --- PRの差分を見る ---
const baseArg = process.argv
  .slice(2)
  .filter((a) => a.startsWith("--base="))
  .map((a) => a.slice("--base=".length))
  .pop();
const base = baseArg || "origin/master";

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

let changed;
try {
  git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  changed = git(["diff", "--name-only", "--no-renames", `${base}...HEAD`])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
} catch (err) {
  const message = `base（${base}）との差分を取れませんでした: ${err.message.split("\n")[0]}`;
  if (process.env.CI) {
    console.error(`NG: ${message}`);
    process.exit(1);
  }
  console.log(`スキップ: ${message}（手元のため。CIでは失敗扱い）`);
  process.exit(0);
}

const touched = findTouchedGeneratedDocs(
  changed,
  GENERATED_DOCS.map((d) => d.output),
);
if (touched.length > 0) {
  console.error(
    "NG: 機械生成の文書をPRで変更しています。生成物はmasterへのマージ後にCIが作り直すので、PRには含めません（ADR-0078）。",
  );
  for (const f of touched) console.error(`  - ${f}`);
  console.error("\n次で base の内容に戻してコミットしてください:");
  console.error(`  git checkout ${base} -- ${touched.join(" ")}`);
  process.exit(1);
}

console.log(
  `OK: PR（${base}...HEAD、${changed.length}ファイル）は生成物${GENERATED_DOCS.length}件を変更していない`,
);
