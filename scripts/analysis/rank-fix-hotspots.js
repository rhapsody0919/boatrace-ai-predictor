// 実行: node scripts/analysis/rank-fix-hotspots.js --since YYYY-MM-DD [--top N] [--out path]
// 自己試験: node scripts/analysis/rank-fix-hotspots.js --self-test
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "../lib/isDirectRun.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MARKER = "@@FIX-HOTSPOT@@";
const FIX = /^fix(\([^)]*\))?!?:/;
const isCode = (path) =>
  path === "middleware.js" || /^(src|scripts|api)\/.*\.(js|jsx|mjs)$/.test(path);
const comparePaths = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 純粋な集計。totals は top で切る前、対象コードを変更したコミットの件数。 */
export function aggregateNumstat(input) {
  const entries = new Map();
  const commits = new Set();
  const fixes = new Set();
  let current = null;
  for (const line of input.split("\n")) {
    if (line.startsWith(MARKER)) {
      const tab = line.indexOf("\t");
      const subject = line.slice(tab + 1);
      current = subject.includes("[automated]")
        ? null
        : { hash: line.slice(MARKER.length, tab), fix: FIX.test(subject), seen: new Set() };
      continue;
    }
    if (!current || !line) continue;
    const match = /^(\d+)\t(\d+)\t(.+)$/.exec(line);
    if (!match) continue; // バイナリの numstat（-）も除外する。
    let path = match[3];
    // Git の core.quotePath は日本語・制御文字を C 形式のバイト列にする。
    if (path.startsWith('"')) {
      const bytes = [];
      const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
      for (let i = 1; i < path.length - 1; i++) {
        if (path[i] !== "\\") bytes.push(...Buffer.from(path[i]));
        else {
          const octal = /^[0-7]{3}/.exec(path.slice(i + 1));
          if (octal) { bytes.push(parseInt(octal[0], 8)); i += 3; }
          else { i++; bytes.push(escapes[path[i]] ?? path.charCodeAt(i)); }
        }
      }
      path = Buffer.from(bytes).toString("utf8");
    }
    if (!isCode(path)) continue;
    const entry = entries.get(path) ?? { path, commits: 0, lines: 0, fixCommits: 0 };
    entry.lines += Number(match[1]) + Number(match[2]);
    if (!current.seen.has(path)) {
      entry.commits++;
      if (current.fix) entry.fixCommits++;
      current.seen.add(path);
    }
    entries.set(path, entry);
    commits.add(current.hash);
    if (current.fix) fixes.add(current.hash);
  }
  const files = [...entries.values()].map((entry) => ({
    ...entry,
    score: entry.commits * entry.lines * entry.fixCommits,
    planScore: entry.lines * entry.fixCommits,
  })).sort((a, b) => b.score - a.score || comparePaths(a.path, b.path));
  return { totals: { commits: commits.size, fixCommits: fixes.size, files: files.length }, files };
}

function parseArgs(args) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 90);
  const options = { since: date.toISOString().slice(0, 10), out: "data/analysis/dev-efficiency/fix-hotspots.json", top: 50 };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--self-test") { options.selfTest = true; continue; }
    if (!["--since", "--out", "--top"].includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error(`引数が不正です: ${key}`);
    }
    options[key.slice(2)] = args[++i];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.since) ||
      !Number.isFinite(Date.parse(options.since)) ||
      new Date(options.since).toISOString().slice(0, 10) !== options.since) {
    throw new Error("--since は有効な YYYY-MM-DD を指定してください");
  }
  if (!/^\d+$/.test(String(options.top)) || !Number.isSafeInteger(Number(options.top)) || Number(options.top) < 1) {
    throw new Error("--top は正の整数を指定してください");
  }
  options.top = Number(options.top);
  return options;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function selfTest() {
  const fixture = `${MARKER}1\tfix(race): x
10\t2\tsrc/a.js
1\t1\tsrc/b.js
8\t2\tdocs/x.md
-\t-\timg.png
-\t-\tsrc/image.js
${MARKER}2\tfeat: y
5\t0\tsrc/a.js
${MARKER}3\tchore: update sitemap [automated]
100\t100\tsrc/a.js
`;
  assert.deepEqual(aggregateNumstat(fixture), {
    totals: { commits: 2, fixCommits: 1, files: 2 },
    files: [
      { path: "src/a.js", commits: 2, lines: 17, fixCommits: 1, score: 34, planScore: 17 },
      { path: "src/b.js", commits: 1, lines: 2, fixCommits: 1, score: 2, planScore: 2 },
    ],
  });
  const extra = aggregateNumstat(`${MARKER}4\tcodex: fix: x
1\t0\tscripts/z.mjs
1\t0\tscripts/a.jsx
1\t0\tpublic/x.js
1\t0\tdata/x.js
1\t0\tpackage-lock.json
${MARKER}5\tfix!: breaking
2\t0\tmiddleware.js
${MARKER}6\tfix(api)!: breaking
3\t0\tapi/x.js
${MARKER}7\tfix: quoted
1\t0\t"src/space name.js"
1\t0\t"src/\\346\\227\\245.js"
`);
  assert.deepEqual(extra.files.map((f) => f.path), ["api/x.js", "middleware.js", "src/space name.js", "src/日.js", "scripts/a.jsx", "scripts/z.mjs"]);
  assert.equal(extra.files.at(-1).fixCommits, 0);
  assert.deepEqual(aggregateNumstat(""), { totals: { commits: 0, fixCommits: 0, files: 0 }, files: [] });
  assert.throws(() => parseArgs(["--since", "2026-02-30"]));
  assert.throws(() => parseArgs(["--top", "0"]));
  console.log("自己試験: OK");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) { selfTest(); return; }
  if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    throw new Error("浅い複製では数が欠けるため集計できません。完全な履歴の複製で実行してください。");
  }
  const head = git(["rev-parse", "HEAD"]).trim();
  const input = git(["log", head, "--first-parent", "--no-merges", "--no-renames", "--numstat",
    `--format=${MARKER}%H%x09%s`, `--since=${options.since}T00:00:00Z`, "--"]);
  const result = aggregateNumstat(input);
  // 作業ツリーの有無ではなく、集計した HEAD の追跡ファイルで判定する。
  const pathsNow = new Set(git(["ls-tree", "-r", "--name-only", "-z", head]).split("\0"));
  const output = {
    generatedAt: new Date().toISOString(), head, since: options.since, shallow: false,
    totals: result.totals,
    files: result.files.slice(0, options.top).map((entry) => ({ ...entry, existsNow: pathsNow.has(entry.path) })),
  };
  const destination = resolve(ROOT, options.out);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`保存しました: ${destination}`);
}

if (isDirectRun(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
