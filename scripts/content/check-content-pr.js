/**
 * 記事の中身だけの PR の関門（CLI）。
 * 使い方: node scripts/content/check-content-pr.js [--base origin/master]
 * git から差分（git diff --raw -z --no-renames <base>...HEAD。変更後の mode つき）・HEAD の中身・
 * base と HEAD のファイル一覧を集め、scripts/lib/contentPrGate.js に渡す。
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
import { isDirectRun } from "../lib/isDirectRun.js";

const CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "content-pr-gate.json",
);
const MAX_BUFFER = 64 * 1024 * 1024;
// 在るかを見るディレクトリ（slug の衝突・.md と JSON の対応・図の JSON・画像）
const TRACKED_DIRS = [
  "public/blog",
  "src/data/blog-posts",
  "public/blog-charts",
  "public/images/blog",
];

const runGit = (args, encoding = "utf8") =>
  execFileSync("git", args, {
    encoding,
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** rev:path の中身。在るかは呼ぶ側が一覧で確かめる。読めなければ例外（終了コード2） */
const showBlob = (rev, path) =>
  new Uint8Array(runGit(["show", `${rev}:${path}`], "buffer"));

/** rev のファイル一覧（-z なので ASCII 以外のパスも引用符なし） */
const lsTree = (rev) =>
  runGit(["ls-tree", "-r", "-z", "--name-only", rev, "--", ...TRACKED_DIRS])
    .split("\0")
    .filter(Boolean);

/** git diff --raw -z の出力を { status, path, mode（変更後） } にする */
export function parseRawDiff(out) {
  const tokens = out
    .split("\0")
    .filter((t, i, a) => t !== "" || i < a.length - 1);
  const rows = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const meta = tokens[i];
    const path = tokens[i + 1];
    if (!meta.startsWith(":") || path === undefined) {
      throw new Error(`git diff --raw の行を読めない: ${JSON.stringify(meta)}`);
    }
    const [, newMode, , , status] = meta.slice(1).split(" ");
    rows.push({ status: status[0], path, mode: newMode });
  }
  return rows;
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
  const mergeBase = runGit(["merge-base", baseRef, "HEAD"]).trim();

  const diff = parseRawDiff(
    runGit(["diff", "--raw", "-z", "--no-renames", `${baseRef}...HEAD`]),
  );
  const headPaths = lsTree("HEAD");
  const headPathSet = new Set(headPaths);

  // 追加・変更したファイルの HEAD の中身（git の失敗は握りつぶさず終了コード2）
  const head = {};
  for (const d of diff.filter((x) => x.status !== "D")) {
    head[d.path] = showBlob("HEAD", d.path);
  }

  // 変えた .md・JSON が参照する画像を HEAD から読む。HEAD に無いものは関門が「HEAD に無い」と出す
  const texts = diff
    .filter((d) => d.status !== "D" && /\.(md|json)$/.test(d.path))
    .map((d) => new TextDecoder("utf-8").decode(head[d.path]));
  for (const p of referencedImagePaths(texts)) {
    if (head[p] === undefined && headPathSet.has(p))
      head[p] = showBlob("HEAD", p);
  }

  // 変えた .md・JSON の base（分岐元）の中身。判断が要る句を変えた行・値だけで見る・featured の比較に使う
  const mergeBasePaths = new Set(lsTree(mergeBase));
  const base = {};
  for (const d of diff.filter(
    (x) => x.status === "M" && /\.(json|md)$/.test(x.path),
  )) {
    if (mergeBasePaths.has(d.path))
      base[d.path] = new TextDecoder("utf-8").decode(
        showBlob(mergeBase, d.path),
      );
  }

  // slug の衝突・図の JSON の実在は base の先端で見る（分岐後に master へ入ったものも含める）
  const basePaths = lsTree(baseRef);

  const result = evaluateContentPr({
    diff,
    head,
    base,
    basePaths,
    headPaths,
    config,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (isDirectRun(import.meta.url)) {
  try {
    main();
  } catch (err) {
    // execFileSync の失敗は err.message に stderr が既に入っているので、message だけを出す
    console.error(`check-content-pr: 判定できない: ${err.message.trim()}`);
    process.exitCode = 2;
  }
}
