#!/usr/bin/env node
/**
 * nodejs の関数が JSON を import して読み込みで落ちないこと（ci、2026-10-13）。
 *
 * edge の関数は esbuild が束ねるので `import x from "...json"` が通るが、nodejs の関数は束ねずに Node の ESM で
 * 動くため、import 属性の無い JSON の import は ERR_IMPORT_ATTRIBUTE_MISSING で読み込みから落ち、関数が毎回
 * 500 になる。/api/admin/sns-hub/mobile-approval（twitter-text のため nodejs）がこれで「今日のレースを
 * 取得できません」になった。当時の verify-sns-mobile-api.js（撤去済み）は JSON の import を差し替えてから読むので、
 * この失敗を見ていなかった。
 *
 * 1. api/ の中で `.json` を import してよいのは、自分の config で runtime: "edge" を宣言した関数だけ
 *    （api/_lib/ は nodejs の関数からも読まれるので、JSON の import を置かない）
 * 2. send-probe.js（nodejs の関数。mobile-approval.js は 2026-10-18 に撤去）を実際に Node で import でき、GET・POST を書き出し、既定の書き出しが無いこと
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
      new URL("../../api/admin/sns-hub/send-probe.js", import.meta.url)
    );
    // nodejs の関数の既定の書き出しは Node の (req, res) で呼ばれる。Web の Request を受ける形は GET・POST で書き出す（2026-10-18）
    if (mod.default !== undefined)
      throw new Error(
        "既定の書き出しがある（nodejs では (req, res) で呼ばれる）",
      );
    if (typeof mod.GET !== "function" || mod.POST !== mod.GET)
      throw new Error("GET・POST の書き出しが無い");
    // Web の Request で呼べる（本番の 500 は req.headers.get が無いことで起きた）。認証が無ければ 401
    const res = await mod.GET(
      new Request("https://www.boat-ai.jp/api/admin/sns-hub/send-probe"),
    );
    if (res.status !== 401)
      throw new Error(`認証の無い GET が 401 でない（${res.status}）`);
    console.log(
      "[OK] send-probe.js を Node で読み込め、GET が Request を受けて 401 を返す",
    );
  } catch (e) {
    failed += 1;
    console.error(
      `[NG] send-probe.js を Node で読み込めない: ${e.code ?? ""} ${e.message}`,
    );
  }
}

if (failed > 0) process.exit(1);
console.log("\nすべて通りました");
