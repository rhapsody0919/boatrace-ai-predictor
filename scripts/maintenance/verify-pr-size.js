#!/usr/bin/env node
/**
 * verify-pr-size.js - PR の大きさ（300行・5ファイル）の数え方（scripts/maintenance/prSize.js、BOA-1718）の試験と、この PR の数。
 *
 * 作り手が自分で数えて置き場の決まりを曲げた（#3304 とその前の #3303 で、src/pure に置かない・訳のキーを流用・注釈を削る）ので、
 * 数え方を機械に移した。数えない物は prSize.js の頭の注釈。超えたときは落とさず pr-lane で重い道（人が見る）に回す
 * （オーナー 2026-11-24 の (ii)）。この verify は数え方の試験が落ちたときだけ落ち、この PR の数は表示するだけ。
 *
 * 確かめること:
 *   1. 純関数: 数えない物（新しい試験・台帳の行の追加・ja と同じキーの他の locale・注釈と空行・消した行）と、数える物
 *      （既存の試験の変更・md の * の行・キーが合わない locale・行の無い差分）、線の境（300行・5ファイル）
 *   2. 試験のファイルに本体を置いた変異（ほかの変更が新しい verify・spec を import する）は数える
 *   3. 一時の git の木: 移すだけ（moveOnly）の大きい PR と記事の PR（check-content-pr.js が通す形）は線の外、
 *      どちらも1ファイルを足すと数える
 *   4. 実の差分: #3304（3fa222c70）と #3303（1069770b5）が線の中
 *   5. この PR（merge-base から HEAD）の数を出す
 *
 * 使い方: node scripts/maintenance/verify-pr-size.js --base=origin/master
 *   base や 4 のコミットを解決できない場合、CI（環境変数 CI）では失敗、手元ではスキップする。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIZE_LIMIT, measureCommits } from "./prSize.js";
import { runPrSizeScenes } from "./verifyData/pr-size-scenes.js";
import { makePr } from "./verifyData/content-pr-gate-make-pr.js";
import { baseMd } from "./verifyData/content-pr-gate-fixtures.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const n = (k, f = (i) => `const v${i} = ${i};`) =>
  Array.from({ length: k }, (_, i) => f(i));

// ---- 1・2（純関数と、試験のファイルに本体を置いた変異）は verifyData/pr-size-scenes.js ----
runPrSizeScenes({ check });

// ---- 3. 一時の git の木 ----
const tmpGit = (fn) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-pr-size-"));
  const g = (...args) =>
    execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
  const write = (p, body) => {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), body);
  };
  const commit = (m) => {
    g("add", "-A");
    g("commit", "-q", "-m", m);
    return g("rev-parse", "HEAD").trim();
  };
  try {
    g("init", "-q", "-b", "main");
    g("config", "user.name", "verify");
    g("config", "user.email", "verify@example.invalid");
    fn({ dir, write, commit, g });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// 移すだけ: supabaseDataService.js の 120 個のメソッドを scheduleQueries.js へ字のまま移す（pr-lane の試験の場面と同じ形）
tmpGit(({ dir, write, commit }) => {
  const SVC = "src/services/supabaseDataService.js";
  const SQ = "src/services/scheduleQueries.js";
  const names = Array.from({ length: 120 }, (_, i) => `getM${i}`);
  const method = (m) => [`  ${m}(v) {`, `    return b(v) + "${m}";`, "  },"];
  write(
    "src/utils/a.js",
    "export const b = (v) => v;\nexport const c = (v) => v;\n",
  );
  write(
    SVC,
    [
      'import { b } from "../utils/a.js";',
      'import { c } from "../utils/a.js";',
      "",
      "export const supabaseDataService = {",
      ...names.flatMap(method),
      "  getZ(v) {",
      "    return c(v);",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  const base = commit("base");
  write(
    SVC,
    [
      'import { c } from "../utils/a.js";',
      `import { ${names.join(", ")} } from "./scheduleQueries.js";`,
      "",
      "export const supabaseDataService = {",
      ...names.map((m) => `  ${m},`),
      "  getZ(v) {",
      "    return c(v);",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  write(
    SQ,
    [
      "// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: schedule）。",
      "// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい",
      "",
      'import { b } from "../utils/a.js";',
      "",
      ...names.flatMap((m) => [
        `export function ${m}(v) {`,
        `    return b(v) + "${m}";`,
        "  }",
      ]),
      "",
    ].join("\n"),
  );
  const head = commit("move");
  const r = measureCommits(dir, base, head);
  check(
    "一時の木: 移すだけの PR（360行を超える移し）は線の外",
    r.exempt !== null && !r.over,
    JSON.stringify({ ...r, skipped: r.skipped.length }),
  );
  write("src/pages/Extra.jsx", "export const x = 1;\n");
  const head2 = commit("extra");
  const r2 = measureCommits(dir, base, head2);
  check(
    "一時の木: 移すだけに1ファイルを足すと全部数えて超える",
    r2.exempt === null && r2.over,
    JSON.stringify({ lines: r2.lines, files: r2.files }),
  );
});

// 記事の PR: verify-content-pr-gate.js の正しい新規記事（makePr）を木に置き、check-content-pr.js に判定させる
tmpGit(({ dir, write, commit, g }) => {
  const pr = makePr({
    md: `${baseMd}\n${n(400, (i) => `段落 ${i}。`).join("\n\n")}\n`,
  });
  for (const p of pr.basePaths)
    write(p, p.endsWith(".json") ? "{}\n" : "# 既存\n");
  const base = commit("base");
  for (const [p, bytes] of Object.entries(pr.head)) write(p, bytes);
  const head = commit("article");
  const r = measureCommits(dir, base, head);
  check(
    "一時の木: 記事の PR（400行を超える本文）は線の外",
    r.exempt !== null && !r.over,
    JSON.stringify({ exempt: r.exempt, lines: r.lines }),
  );
  write("src/pages/Extra.jsx", "export const x = 1;\n");
  const head2 = commit("extra");
  const r2 = measureCommits(dir, base, head2);
  check(
    "一時の木: 記事の PR に src を足すと記事の PR でなくなり数える",
    r2.exempt === null && r2.lines > SIZE_LIMIT.lines,
    JSON.stringify({ exempt: r2.exempt, lines: r2.lines }),
  );
  g("checkout", "-q", base);
  const r3 = measureCommits(dir, base, head);
  check(
    "一時の木: head が HEAD でなくても記事の PR と判定する（一時の作業ツリーに出す）",
    r3.exempt !== null,
    JSON.stringify({ exempt: r3.exempt }),
  );
  check(
    "一時の木: 一時の作業ツリーを残さない",
    g("worktree", "list").trim().split("\n").length === 1,
    g("worktree", "list"),
  );
});

// ---- 4. 実の差分（#3304 と #3303。作り手が線に合わせて置き場を曲げた PR） ----
const resolvable = (ref) => {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { cwd: ROOT, stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
};
const skipOrFail = (message) => {
  if (process.env.CI) {
    failures += 1;
    console.error(`❌ ${message}`);
  } else console.log(`スキップ: ${message}（手元のため。CIでは失敗扱い）`);
};
for (const [pr, sha, spec] of [
  ["#3304", "3fa222c70", "e2e/venue-race-block.spec.js"],
  ["#3303", "1069770b5", "e2e/venue-meet-heading.spec.js"],
]) {
  if (!resolvable(sha)) {
    skipOrFail(`${pr}（${sha}）を解決できない`);
    continue;
  }
  const r = measureCommits(ROOT, `${sha}^`, sha);
  check(
    `実の差分: ${pr} は線の中で、新しい spec を数えない`,
    !r.over &&
      r.exempt === null &&
      r.skipped.some((s) => s.path === spec) &&
      r.lines < SIZE_LIMIT.lines,
    JSON.stringify({ lines: r.lines, files: r.files, counted: r.counted }),
  );
}

if (failures > 0) {
  console.error(`NG: PR の大きさの数え方の試験が ${failures} 件失敗`);
  process.exit(1);
}

// ---- 5. この PR ----
const base =
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--base="))
    .map((a) => a.slice("--base=".length))
    .pop() || "origin/master";
if (!resolvable(base)) {
  skipOrFail(`base（${base}）を解決できない`);
  process.exit(failures > 0 ? 1 : 0);
}
const mine = measureCommits(ROOT, base, "HEAD");
if (mine.exempt) console.log(`OK: この PR は線の外（${mine.exempt}）`);
else {
  console.log(
    `${mine.over ? "超える" : "OK"}: この PR は ${mine.lines}行・${mine.files}ファイル（線は ${SIZE_LIMIT.lines}行・${SIZE_LIMIT.files}ファイル、数え方は scripts/maintenance/prSize.js）`,
  );
  for (const c of mine.counted) console.log(`  数える ${c.lines}行 ${c.path}`);
  for (const s of mine.skipped) console.log(`  数えない ${s.path}（${s.why}）`);
  if (mine.over)
    console.log(
      "  超えた PR は pr-lane で重い道（人が見る）に回る。落とさない",
    );
}
