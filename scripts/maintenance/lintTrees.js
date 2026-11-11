/**
 * lintTrees.js - lint-changed --ci の大きさの関所（BOA-1434、BOA-1425 を割った 1/2）。
 * 指定の SHA の木の JS の字を git だけで（worktree・node_modules を使わず）メモリへ読み、
 * 関数の単位の AST hash の基準（sizeBaselines.js）と比べる。
 *
 * 赤にするもの: FREEZE_SHA が base の祖先でない・木が読めない・部品のファイルが無い。
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  buildBaseline,
  checkAgainstBaseline,
  unitsOfSource,
} from "./sizeBaselines.js";

export const FREEZE_SHA = "3e65af4f3e4b2a07d87b5a58b6cbde5fbddbe7b3";

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

// 読めない（parse できない）字は外す。eslint が別に見る
function parsable(files) {
  const ok = {};
  const skipped = [];
  for (const [p, src] of Object.entries(files)) {
    try {
      unitsOfSource(src);
      ok[p] = src;
    } catch {
      skipped.push(p);
    }
  }
  return { ok, skipped };
}

function baselineOf(cwd, sha) {
  const { ok, skipped } = parsable(readTreeSources(cwd, sha));
  return { baseline: buildBaseline(ok), files: ok, skipped };
}

function assertAncestor(cwd, base) {
  const r = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", FREEZE_SHA, base],
    { cwd },
  );
  if (r.status !== 0) {
    throw new Error(`FREEZE_SHA ${FREEZE_SHA} が base ${base} の祖先でない`);
  }
}

/**
 * 大きさの判定。changed: [{file, added}]（HEAD の木にあるものだけ見る）。
 * 戻り: { errors, warnings, log }。部品や木が読めなければ errors に入れる（緑にしない）
 */
export function runSizeGate({ cwd, base, changed }) {
  const out = { errors: [], warnings: [], log: [] };
  try {
    assertAncestor(cwd, base);
    const freeze = baselineOf(cwd, FREEZE_SHA).baseline;
    const baseB = baselineOf(cwd, base).baseline;
    const head = baselineOf(cwd, "HEAD");
    const initial = freeze.initial_count;
    const strictExisting = head.baseline.initial_count <= initial / 2;
    const files = changed
      .filter((c) => head.files[c.file] !== undefined)
      .map((c) => ({
        file: c.file,
        source: head.files[c.file],
        isNew: c.added,
      }));
    const r = checkAgainstBaseline({
      baseline: baseB,
      files,
      strictExisting,
    });
    out.errors.push(...r.errors.map((e) => `大きさ ${e}`));
    out.warnings.push(...r.warnings.map((w) => `大きさ ${w}`));
    out.log.push(
      `size-gate: base=${base} FREEZE_SHA=${FREEZE_SHA} initial_count=${initial} ` +
        `base の越えの単位=${baseB.initial_count} 今の越えの単位=${head.baseline.initial_count} ` +
        `半分の旗=${strictExisting} 見たファイル=${files.length} parse できず外した=${head.skipped.length}`,
      `size-gate: 赤 ${r.errors.length} 件・警告 ${r.warnings.length} 件`,
    );
  } catch (e) {
    out.errors.push(`大きさの関所が動かない（赤にする）: ${e.message}`);
  }
  return out;
}
