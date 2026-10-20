/**
 * 記事の中身だけの PR の関門（CLI）。
 * 使い方: node scripts/content/check-content-pr.js [--base origin/master]
 * git から差分・HEAD の中身・base のファイル一覧を集め、scripts/lib/contentPrGate.js に渡す。
 * 結果の JSON を標準出力に出す。errors があれば終了コード1、無ければ0、git 等の失敗は2。
 * 契約: docs/operation/content-pr-contract.md
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  evaluateContentPr,
  referencedImagePaths,
} from "../lib/contentPrGate.js";

const CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "content-pr-gate.json",
);
const MAX_BUFFER = 64 * 1024 * 1024;

const git = (args, encoding = "utf8") =>
  execFileSync("git", args, {
    encoding,
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** rev:path の中身。無ければ undefined */
function showBlob(rev, path) {
  try {
    return new Uint8Array(git(["show", `${rev}:${path}`], "buffer"));
  } catch {
    return undefined;
  }
}

function parseBase(argv) {
  const i = argv.indexOf("--base");
  if (i >= 0) {
    if (!argv[i + 1]) throw new Error("--base の値が無い");
    return argv[i + 1];
  }
  const eq = argv.find((a) => a.startsWith("--base="));
  return eq ? eq.slice("--base=".length) : "origin/master";
}

function main() {
  const baseRef = parseBase(process.argv.slice(2));
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();

  const diff = git([
    "diff",
    "--name-status",
    "--no-renames",
    `${baseRef}...HEAD`,
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      return { status: status[0], path };
    });

  const head = {};
  for (const d of diff.filter((x) => x.status !== "D")) {
    const blob = showBlob("HEAD", d.path);
    if (blob !== undefined) head[d.path] = blob;
  }

  // 変えた .md・JSON が参照する画像を HEAD から読む
  const texts = diff
    .filter(
      (d) => d.status !== "D" && /\.(md|json)$/.test(d.path) && head[d.path],
    )
    .map((d) => new TextDecoder("utf-8").decode(head[d.path]));
  for (const p of referencedImagePaths(texts)) {
    if (head[p] !== undefined) continue;
    const blob = showBlob("HEAD", p);
    if (blob !== undefined) head[p] = blob;
  }

  // 変えた JSON の base（分岐元）の中身。featured の比較に使う
  const base = {};
  for (const d of diff.filter(
    (x) => x.status !== "A" && x.status !== "D" && x.path.endsWith(".json"),
  )) {
    const blob = showBlob(mergeBase, d.path);
    if (blob !== undefined)
      base[d.path] = new TextDecoder("utf-8").decode(blob);
  }

  // slug の衝突は base の先端で見る（分岐後に master へ入った記事とも衝突させない）
  const basePaths = git([
    "ls-tree",
    "-r",
    "--name-only",
    baseRef,
    "--",
    "public/blog",
    "src/data/blog-posts",
  ])
    .split("\n")
    .filter(Boolean);

  const result = evaluateContentPr({ diff, head, base, basePaths, config });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

try {
  main();
} catch (err) {
  const detail = err.stderr ? String(err.stderr).trim() : "";
  console.error(
    `check-content-pr: 判定できない: ${err.message}${detail ? `\n${detail}` : ""}`,
  );
  process.exitCode = 2;
}
