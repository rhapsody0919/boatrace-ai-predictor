/**
 * lintTrees.js - lint-changed --ci の大きさの関所（BOA-1434、BOA-1425 を割った 1/2）。
 * 指定の SHA の木の JS の字を git だけで（worktree・node_modules を使わず）メモリへ読み、
 * 線を越える関数が1つも無く、実質400行を越えるファイルが例外の表 size-exceptions.json の上限の内かを見る。
 * 2026-11-25 に FREEZE_SHA・base の木の基準との比べ（関数の単位の AST hash）から全体で0＋例外の表へ（ADR-0110）。
 *
 * 赤にするもの: 線の越え・表の外・表の増え・木や表が読めない。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { judgeTreeSize, sizeExceptionsGrowth } from "./sizeBaselines.js";

const TREE_DIRS = ["src/", "scripts/", "api/"];
const SKIP_SEGMENTS = new Set(["node_modules", "dist", "sns-video-studio"]);
const JS_EXT = /\.(js|jsx|mjs|cjs)$/;

const isTreeFile = (p) =>
  JS_EXT.test(p) &&
  TREE_DIRS.some((d) => p.startsWith(d)) &&
  !p.split("/").some((s) => SKIP_SEGMENTS.has(s));

const gitOut = (cwd, ...a) =>
  execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });

// `git cat-file --batch` の出力（"<oid> blob <size>\n<中身>\n" の並び）を読む
function parseBatch(buf, paths) {
  const files = {};
  let pos = 0;
  for (const p of paths) {
    const nl = buf.indexOf(10, pos);
    const [, type, size] = buf.toString("utf8", pos, nl).split(" ");
    if (type !== "blob") throw new Error(`${p} が blob で読めない`);
    const start = nl + 1;
    files[p] = buf.toString("utf8", start, start + Number(size));
    pos = start + Number(size) + 1;
  }
  return files;
}

/** sha の木の JS の字 → {path: source} */
export function readTreeSources(cwd, sha) {
  const paths = gitOut(cwd, "ls-tree", "-r", "--name-only", sha)
    .split("\n")
    .filter(isTreeFile);
  const res = spawnSync("git", ["cat-file", "--batch"], {
    cwd,
    input: paths.map((p) => `${sha}:${p}\n`).join(""),
    maxBuffer: 1 << 30,
  });
  if (res.status !== 0) throw new Error(`${sha} の木が読めない`);
  return parseBatch(res.stdout, paths);
}

export const SIZE_EXCEPTIONS_PATH = "scripts/maintenance/size-exceptions.json";
const isFixture = (p) => p.split("/").includes("__fixtures__");

/** sha の木の file を JSON で読む。木に無いときだけ null（表を足す PR）。ほかの失敗は throw して赤にする */
function readJsonAt(cwd, sha, file) {
  const has = spawnSync("git", ["cat-file", "-e", `${sha}:${file}`], { cwd }).status === 0;
  if (!has) {
    gitOut(cwd, "rev-parse", "--verify", `${sha}^{commit}`); // sha そのものが読めないなら throw
    return null;
  }
  return JSON.parse(gitOut(cwd, "show", `${sha}:${file}`));
}

/**
 * 大きさの判定（全体で0＋例外の表、2026-11-25・ADR-0110）。HEAD の木の全部の JS を見る（changed は使わない）。
 * 戻り: { errors, warnings, log }。木や表が読めなければ errors に入れる（緑にしない）
 */
export function runSizeGate({ cwd, base }) {
  const out = { errors: [], warnings: [], log: [] };
  try {
    const all = readTreeSources(cwd, "HEAD");
    const files = Object.fromEntries(Object.entries(all).filter(([p]) => !isFixture(p)));
    const exceptions = JSON.parse(fs.readFileSync(path.join(cwd, SIZE_EXCEPTIONS_PATH), "utf8"));
    const r = judgeTreeSize({ files, exceptions });
    out.errors.push(...r.errors.map((e) => `大きさ ${e}`));
    out.warnings.push(...r.warnings.map((w) => `大きさ ${w}`));
    const baseExceptions = readJsonAt(cwd, base, SIZE_EXCEPTIONS_PATH);
    if (baseExceptions === null) {
      out.log.push(`size-gate: base ${base} に例外の表が無い（表を足す PR）。表の増えは見ない`);
    } else {
      out.errors.push(...sizeExceptionsGrowth(baseExceptions, exceptions).map((e) => `大きさ ${e}`));
    }
    out.log.push(
      `size-gate: HEAD の JS ${Object.keys(files).length} 本（__fixtures__ を除く）・例外の表 ${Object.keys(exceptions.files ?? {}).length} 本・parse できず外した ${r.skipped.length} 本`,
      `size-gate: 赤 ${out.errors.length} 件・警告 ${out.warnings.length} 件`,
    );
  } catch (e) {
    out.errors.push(`大きさの関所が動かない（赤にする）: ${e.message}`);
  }
  return out;
}
