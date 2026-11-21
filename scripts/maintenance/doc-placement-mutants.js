/**
 * doc-placement-mutants.js - verify-doc-placement.js の変異検査（HR74 6節 d、hq の docs/decisions/ryujin-boundary.md 11/9）。verify ではなく手元の道具
 * （一時の場所に書き子プロセスを起こすので verify の静的な守り guard_weakening の外に置く）。verify-doc-placement.js を変える PR は
 * `node scripts/maintenance/doc-placement-mutants.js --old=origin/master` を手元で回し、結果を PR 本文に貼る。
 * verify-doc-placement.js は製品のファイルを読まず置き場（パスの一覧）だけを見るので、変異は「木と表を壊す」形で作る。
 * 一時の場所に今の木と同じパスの空のファイル（.gitignore・verify・表・共通の試験・package.json だけは本物）で git の木を作り、
 * 変異ごとに verify を回して、期待（red＝失敗・warn＝成功だが placement-shadow か placement-loosen-warn を出す・green）と合うかを見る。
 * --old=<ref> を付けると <ref> の版の verify-doc-placement.js も同じ変異で回し、「旧で落ちた変異 ⊆ 新で落ちた変異」を確かめる
 * （verify を変える PR の手元の確かめ。ref に verify が無ければ止める）。ネットワーク・DB には触れない。書くのは一時の場所だけ。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listRepoPaths } from "../lib/repoPaths.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "../..");
const VERIFY = "scripts/maintenance/verify-doc-placement.js";
const TABLE = "scripts/maintenance/file-placement.json";
const CASES = "scripts/maintenance/file-placement.cases.json";
const REAL = [".gitignore", VERIFY, TABLE, CASES, "scripts/lib/repoPaths.js"];

const editJson = (rel, fn) => (dir) => {
  const p = path.join(dir, rel);
  fs.writeFileSync(p, `${JSON.stringify(fn(JSON.parse(fs.readFileSync(p, "utf8"))), null, 2)}\n`);
};
const touch = (...rels) => (dir) =>
  rels.forEach((rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), "");
  });
const both = (...fns) => (dir) => fns.forEach((f) => f(dir));
const rootRow = (glob) => editJson(TABLE, (t) => ({ ...t, rows: [{ glob, kind: "k", owner: "o", ext: ["md"], git: "track", frozen: 0 }, ...t.rows] }));

// [名前, 木を壊す関数, 新の verify の期待, 環境変数, 決まりの変異か]。決まりの変異（表・共通の試験を書き換える）は旧の verify に同じ物が無い
// （旧は ROOT_FROZEN を verify の中で直す）ので --old の ⊆ の比べから外し、新の期待だけを見る
export const MUTANTS = [
  ["変異なし", () => {}, "green"],
  ["根に新しいファイル", touch("plan.md"), "red"],
  ["根に新しいディレクトリ", touch("newdir/a.js"), "red"],
  ["docs に kebab-case でない名前を1件足す（凍結を越える）", touch("docs/x/New_File.md"), "red"],
  ["docs の下にコード（docs/design の凍結を越える）", touch("docs/design/x.py"), "warn"],
  ["表に無い拡張子（src の下の py）", touch("src/a.py"), "warn"],
  ["scripts 直下に新しい入口（凍結を越える）", touch("scripts/new-entry.js"), "warn"],
  ["ignore の置き場の物を追跡する（根の x.log を git add -f）", (dir) => {
    touch("x.log")(dir);
    execFileSync("git", ["-C", dir, "add", "-f", "x.log"]);
  }, "warn"],
  ["表に根の行を足し、理由の行なし", both(touch("plan.md"), rootRow("plan.md")), "red", {}, true],
  ["表に根の行を足し、理由の行あり", both(touch("plan.md"), rootRow("plan.md")), "green", { PLACEMENT_REASON: "試す" }, true],
  ["表の mode を壊す", editJson(TABLE, (t) => ({ ...t, mode: "loud" })), "red", {}, true],
  ["表の ** の行の ext を外す（粗さの線）", editJson(TABLE, (t) => ({ ...t, rows: t.rows.map((r) => (r.glob === "src/**" ? { ...r, ext: "*" } : r)) })), "red", {}, true],
  ["表の frozen を上げる（理由の行なし、shadow の間は警告）", editJson(TABLE, (t) => ({ ...t, rows: t.rows.map((r) => (r.glob === "scripts/*" ? { ...r, frozen: r.frozen + 1 } : r)) })), "warn", {}, true],
  ["表を消す", (dir) => fs.rmSync(path.join(dir, TABLE)), "red", {}, true],
  ["共通の試験の期待を壊す", editJson(CASES, (c) => ({ ...c, classify: [{ path: "README.md", row: 1, problem: null }, ...c.classify] })), "red", {}, true],
];

const listPaths = () => listRepoPaths(ROOT);

const g = (dir, args) =>
  execFileSync("git", ["-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "user.name=mutants", "-c", "user.email=mutants@example.invalid", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });

const skeleton = (paths, verifyText) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-placement-mutants-"));
  paths.forEach((rel) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // node が型を読む package.json も本物（空だと起動で落ちる）
    const real = REAL.includes(rel) || path.posix.basename(rel) === "package.json";
    fs.writeFileSync(p, real ? fs.readFileSync(path.join(ROOT, rel)) : "");
  });
  fs.writeFileSync(path.join(dir, VERIFY), verifyText);
  g(dir, ["init", "-q"]);
  const list = path.join(os.tmpdir(), `${path.basename(dir)}.list`);
  fs.writeFileSync(list, paths.join("\0"));
  g(dir, ["add", "-f", `--pathspec-from-file=${list}`, "--pathspec-file-nul"]);
  fs.rmSync(list);
  g(dir, ["commit", "-q", "-m", "skeleton"]);
  return dir;
};

const run = (dir, env) => {
  const { GITHUB_EVENT_PATH: _ev, PLACEMENT_REASON: _r, ...rest } = process.env;
  const r = spawnSync(process.execPath, [path.join(dir, VERIFY)], { encoding: "utf8", env: { ...rest, DOC_PLACEMENT_BASE: "HEAD", ...env } });
  const out = `${r.stdout}${r.stderr}`;
  if (r.status !== 0) return "red";
  return /^placement-(shadow|loosen-warn):/m.test(out) ? "warn" : "green";
};

// 1つの verify の版で全ての変異を回し、結果の配列を返す
const outcomes = (paths, verifyText) => {
  const dir = skeleton(paths, verifyText);
  try {
    return MUTANTS.map(([, mutate, , env]) => {
      mutate(dir);
      const got = run(dir, env ?? {});
      g(dir, ["reset", "-q", "--hard", "HEAD"]);
      g(dir, ["clean", "-qfdx"]);
      return got;
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const main = () => {
  const oldRef = process.argv.find((a) => a.startsWith("--old="))?.slice(6);
  const paths = listPaths();
  const now = outcomes(paths, fs.readFileSync(path.join(ROOT, VERIFY), "utf8"));
  const wrong = MUTANTS.flatMap(([name, , want], i) => (now[i] === want ? [] : [`${name}: 期待 ${want}、実際 ${now[i]}`]));
  const lines = [];
  if (oldRef) {
    const oldText = execFileSync("git", ["-C", ROOT, "show", `${oldRef}:${VERIFY}`], { encoding: "utf8" });
    const old = outcomes(paths, oldText);
    const lost = MUTANTS.flatMap(([name, , , , rule], i) => (!rule && old[i] === "red" && now[i] !== "red" ? [name] : []));
    const oldRed = old.filter((o) => o === "red").length;
    const newRed = now.filter((o) => o === "red").length;
    lines.push(`旧（${oldRef}）で落ちた変異 ${oldRed}・新で落ちた変異 ${newRed}。旧で落ちて新で落ちない物 ${lost.length}${lost.length ? `: ${lost.join("・")}` : "（旧 ⊆ 新）"}`);
    MUTANTS.forEach(([name, , , , rule], i) => lines.push(`  ${name}: 旧 ${old[i]}・新 ${now[i]}${rule ? "（決まりの変異、比べない）" : ""}`));
    if (lost.length) wrong.push(`旧で落ちて新で落ちない変異 ${lost.join("・")}`);
  }
  if (wrong.length > 0) {
    console.error(["doc-placement-mutants: NG", ...wrong.map((w) => `  - ${w}`), ...lines].join("\n"));
    process.exit(1);
  }
  console.log([`doc-placement-mutants: OK（変異 ${MUTANTS.length} 個が期待どおり、うち赤 ${now.filter((o) => o === "red").length}）`, ...lines].join("\n"));
};

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
