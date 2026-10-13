#!/usr/bin/env node
/**
 * nodejs の関数が JSON を import して読み込みで落ちないこと（ci、2026-10-13）。
 *
 * edge の関数は esbuild が束ねるので `import x from "...json"` が通るが、nodejs の関数は束ねずに Node の ESM で
 * 動くため、import 属性の無い JSON の import は ERR_IMPORT_ATTRIBUTE_MISSING で読み込みから落ち、関数が毎回
 * 500 になる。/api/admin/sns-hub/mobile-approval（twitter-text のため nodejs）がこれで「今日のレースを
 * 取得できません」になった。既存の verify-sns-mobile-api.js は JSON の import を差し替えてから読むので、
 * この失敗を見ていなかった。
 *
 * 1. api/ の中で `.json` を import してよいのは、自分の config で runtime: "edge" を宣言した関数だけ
 *    （api/_lib/ は nodejs の関数からも読まれるので、JSON の import を置かない）
 * 2. mobile-approval.js を実際に Node で import でき、既定の書き出しが関数であること
 *
 *   node scripts/maintenance/verify-node-function-json-imports.js
 *   node scripts/maintenance/verify-node-function-json-imports.js --baseline=origin/master  # 修正前に落ちることの確認（1だけ）
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseline = process.argv
  .find((a) => a.startsWith("--baseline="))
  ?.slice("--baseline=".length);

function apiFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory()
      ? apiFiles(p)
      : p.endsWith(".js")
        ? [relative(root, p)]
        : [];
  });
}

const read = (file) =>
  baseline
    ? execFileSync("git", ["show", `${baseline}:${file}`], {
        cwd: root,
        encoding: "utf8",
      })
    : readFileSync(join(root, file), "utf8");

const JSON_IMPORT = /^\s*import\s[^;]*?from\s+["'][^"']+\.json["']/m;
const EDGE = /runtime\s*:\s*["']edge["']/;
const files = baseline
  ? execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "api/"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f.endsWith(".js"))
  : apiFiles(join(root, "api"));

const bad = files.filter((file) => {
  const text = read(file);
  if (!JSON_IMPORT.test(text)) return false;
  return file.startsWith("api/_lib/") || !EDGE.test(text);
});

let failed = 0;
if (bad.length > 0) {
  failed += 1;
  console.error(
    `[NG] nodejs の関数（または api/_lib）が JSON を import している: ${bad.join(", ")}`,
  );
} else {
  console.log(
    `[OK] JSON の import は edge の関数だけ（${files.length}ファイルを確認）`,
  );
}

if (!baseline) {
  try {
    const mod = await import(
      new URL("../../api/admin/sns-hub/mobile-approval.js", import.meta.url)
    );
    if (typeof mod.default !== "function")
      throw new Error("既定の書き出しが関数でない");
    console.log("[OK] mobile-approval.js を Node で読み込める");
  } catch (e) {
    failed += 1;
    console.error(
      `[NG] mobile-approval.js を Node で読み込めない: ${e.code ?? ""} ${e.message}`,
    );
  }
}

if (failed > 0) process.exit(1);
console.log("\nすべて通りました");
