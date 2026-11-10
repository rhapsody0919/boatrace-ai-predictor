#!/usr/bin/env node
/**
 * lint-changed.js - 差分のファイルだけに eslint（と大きさ・複雑さの線）を掛け、CI では循環の import と重複のコードも見る。
 * `npm run verify`（＝verify:ci＋これ）と、Quality Gates の verify の job から呼ぶ。
 * 設計: hq の drafts/harness-redesign-20261107.md の T3（verify＝verify:ci＋差分の eslint。編集ごとの hook の代わり）・
 *       T5（max-lines・complexity は差分のファイルだけ、no-cycle は CI の madge、jscpd も差分だけ、試験の差分の警告）
 *
 * 差分: --base（既定 origin/master）と HEAD の merge-base から、作業ツリーまで（コミット前の変更と未追跡のファイルを含む）。
 *       master への push（GITHUB_EVENT_NAME=push）は HEAD^1 から。
 * --ci の大きさ（max-lines・complexity）は eslint でなく lintTrees.js の判定（関数の単位の AST hash を base と比べる）。
 *
 * 失敗にするもの:
 *   - 差分の JS（.js・.jsx・.mjs・.cjs）の eslint のエラー（eslint.config.js の設定のまま）
 *   - 新しいファイルが max-lines・complexity の線を越える
 *   - 既にあるファイルが、この差分で max-lines の線を越えた（base で線の内だった）
 *   - --ci: src・scripts・api に循環の import がある（madge。2026-11-07 時点で0件なので、全体で0件を保つ）
 *   - --ci: 新しいファイルが、ほかのコードと15行以上重なる（jscpd）
 * 警告だけ（失敗にしない）:
 *   - 既にあるファイルの complexity の越え・既に線を越えていたファイルの max-lines
 *   - --ci: 既にあるファイルの重なり
 *   - src の差分があるのに、試験の差分（e2e/・verify-*・*.test.*・*.spec.*）が無い
 *
 * 使い方:
 *   node scripts/maintenance/lint-changed.js                       # 手元（eslint と試験の差分の警告）
 *   node scripts/maintenance/lint-changed.js --ci                  # CI（加えて madge・jscpd。npx で取るのでネットワークが要る）
 *   node scripts/maintenance/lint-changed.js --base=origin/master
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { runSizeGate } from "./lintTrees.js";
import { runDepTreeGate } from "./lintDepTree.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// 線の値は目安（根拠なし）。よく使われる値から取った。実測で合わなければ直す
const MAX_LINES = 400;
const MAX_COMPLEXITY = 15;
const DUP_MIN_LINES = 15; // jscpd の重なりの最小の行数（目安・根拠なし）
// npx で取る版を固定する（devDependency に無いため）
const MADGE = "madge@8.0.0";
const JSCPD = "jscpd@4.3.0";
const GRAPH_DIRS = ["src", "scripts", "api"];

const args = process.argv.slice(2);
const ci = args.includes("--ci");
const baseRef =
  args.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "origin/master";

const git = (...a) =>
  execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trimEnd();
const lines = (text) => text.split("\n").filter(Boolean);
const isJs = (f) => /\.(js|jsx|mjs|cjs)$/.test(f);
const lineCount = (text) =>
  text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

const mergeBase = (() => {
  try {
    // master への push は squash だけなので親が base（merge-base だと HEAD になり差分が空）
    if (process.env.GITHUB_EVENT_NAME === "push") return git("rev-parse", "HEAD^1");
    return git("merge-base", baseRef, "HEAD");
  } catch (e) {
    console.error(
      `lint-changed: NG（${baseRef} との merge-base が取れない。git fetch origin master をしてから回す）: ${e.message}`,
    );
    process.exit(2);
  }
})();

// [{ file, oldFile, added }]（消したファイルは除く）
const changed = [
  ...lines(git("diff", "--name-status", "-M", mergeBase)).flatMap((row) => {
    const [status, a, b] = row.split("\t");
    if (status.startsWith("D")) return [];
    if (status.startsWith("R")) return [{ file: b, oldFile: a, added: false }];
    return [{ file: a, oldFile: a, added: status.startsWith("A") }];
  }),
  ...lines(git("ls-files", "--others", "--exclude-standard")).map((f) => ({
    file: f,
    oldFile: null,
    added: true,
  })),
].filter(({ file }) => fs.existsSync(path.join(ROOT, file)));

const byFile = new Map(changed.map((c) => [c.file, c]));
const baseLineCount = ({ oldFile, added }) =>
  added ? null : lineCount(git("show", `${mergeBase}:${oldFile}`));

const errors = [];
const warnings = [];

// --- eslint（差分の JS だけ）
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: {
    rules: {
      "max-lines": ["warn", { max: MAX_LINES }],
      complexity: ["warn", MAX_COMPLEXITY],
    },
  },
});
const jsFiles = [];
for (const { file } of changed.filter((c) => isJs(c.file))) {
  if (!(await eslint.isPathIgnored(path.join(ROOT, file)))) jsFiles.push(file);
}
const results = jsFiles.length
  ? await eslint.lintFiles(jsFiles.map((f) => path.join(ROOT, f)))
  : [];

const SIZE_RULES = new Set(["max-lines", "complexity"]);
for (const r of results) {
  const rel = path.relative(ROOT, r.filePath);
  const info = byFile.get(rel);
  for (const m of r.messages) {
    const where = `${rel}:${m.line ?? 0}`;
    const text = `${where} ${m.message}${m.ruleId ? ` (${m.ruleId})` : ""}`;
    if (!SIZE_RULES.has(m.ruleId)) {
      (m.severity === 2 ? errors : warnings).push(`eslint ${text}`);
      continue;
    }
    if (ci) continue; // --ci の大きさは lintTrees.js の判定に任せる
    const crossed =
      m.ruleId === "max-lines" &&
      !info.added &&
      baseLineCount(info) <= MAX_LINES;
    if (info.added || crossed) {
      errors.push(
        `線 ${text}${crossed ? "（この差分で線を越えた）" : "（新しいファイル）"}`,
      );
    } else {
      warnings.push(`線 ${text}（既にあるファイル。分けられるなら分ける）`);
    }
  }
}

// --- src の差分に試験の差分が伴うか（警告だけ）
const isTest = (f) =>
  f.startsWith("e2e/") ||
  /(^|\/)verify-[^/]+\.(js|mjs|cjs|sh)$/.test(f) ||
  /\.(test|spec)\.[cm]?jsx?$/.test(f) ||
  f.includes("/__tests__/");
const srcChanged = changed.filter(
  (c) => c.file.startsWith("src/") && !isTest(c.file),
);
if (srcChanged.length > 0 && !changed.some((c) => isTest(c.file))) {
  warnings.push(
    `試験の差分が無い: src を ${srcChanged.length} ファイル変えたが、e2e/・verify-*・*.test.*・*.spec.* の変更が無い（要らないなら PR 本文に理由を書く）`,
  );
}

// npx の出力を一時のファイルへ書かせる（パイプだと madge の --json が 64KB で切れることがあった）
const runToFile = (cmd, cmdArgs) => {
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "lint-changed-")),
    "out.json",
  );
  const fd = fs.openSync(out, "w");
  const res = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: ["ignore", fd, "inherit"],
  });
  fs.closeSync(fd);
  return { status: res.status, out };
};

if (ci) {
  // --- 大きさ（関数の単位の AST hash を base と比べる）
  const size = runSizeGate({ cwd: ROOT, base: mergeBase, changed });
  size.log.forEach((l) => console.log(l));
  errors.push(...size.errors);
  warnings.push(...size.warnings);

  // --- 依存の向き（dependency-cruiser を base と HEAD に回して差分を見る）・src/utils の新しいファイル
  const dep = runDepTreeGate({ cwd: ROOT, base: mergeBase, changed });
  dep.log.forEach((l) => console.log(l));
  errors.push(...dep.errors);
  warnings.push(...dep.warnings);

  // --- 循環の import（madge）
  const madge = runToFile("npx", [
    "--yes",
    MADGE,
    "--circular",
    "--extensions",
    "js,jsx,mjs",
    "--json",
    ...GRAPH_DIRS,
  ]);
  const cycles = (() => {
    try {
      return JSON.parse(fs.readFileSync(madge.out, "utf8"));
    } catch (e) {
      errors.push(
        `madge の結果が読めない（終了コード ${madge.status}）: ${e.message}`,
      );
      return [];
    }
  })();
  cycles.forEach((c) => errors.push(`循環の import: ${c.join(" → ")}`));

  // --- 重複のコード（jscpd。全体を見て、差分のファイルが片側にある重なりだけを出す）
  if (changed.some((c) => isJs(c.file))) {
    const outDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "lint-changed-jscpd-"),
    );
    const res = spawnSync(
      "npx",
      [
        "--yes",
        JSCPD,
        ...GRAPH_DIRS,
        "--format",
        "javascript,jsx",
        "--min-lines",
        String(DUP_MIN_LINES),
        "--ignore",
        "**/__fixtures__/**,**/node_modules/**",
        "--reporters",
        "json",
        "--output",
        outDir,
        "--silent",
      ],
      { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
    );
    const report = path.join(outDir, "jscpd-report.json");
    if (!fs.existsSync(report)) {
      errors.push(`jscpd の結果が無い（終了コード ${res.status}）`);
    } else {
      const { duplicates } = JSON.parse(fs.readFileSync(report, "utf8"));
      for (const d of duplicates) {
        const sides = [d.firstFile, d.secondFile];
        const hit = sides.filter((s) => byFile.has(s.name));
        if (hit.length === 0) continue;
        const text = `重なり ${d.lines} 行: ${sides.map((s) => `${s.name}:${s.start}-${s.end}`).join(" と ")}`;
        (hit.some((s) => byFile.get(s.name).added) ? errors : warnings).push(
          text,
        );
      }
    }
  }
}

const inActions = process.env.GITHUB_ACTIONS === "true";
warnings.forEach((w) =>
  console.warn(inActions ? `::warning::${w}` : `警告: ${w}`),
);
if (errors.length > 0) {
  console.error(`lint-changed: NG（${errors.length} 件）`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(
  `lint-changed: OK（差分 ${changed.length} ファイル・eslint ${jsFiles.length} ファイル・警告 ${warnings.length} 件${ci ? "・madge と jscpd も見た" : ""}）`,
);
