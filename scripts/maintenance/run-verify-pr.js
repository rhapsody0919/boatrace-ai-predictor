#!/usr/bin/env node
/**
 * run-verify-pr.js - push の前に、CI の Quality Gates が回す verify（tier=ci）のうち速い物を手元で回す（hq の台帳 CI03 の案 C）。
 *
 * 背景: 11/15〜11/22 の claude/・hq-session/ の PR の Quality Gates の赤 42 run のうち、verify の赤 35 run は
 * 手元で回していない verify（legacy-prediction-readers・race-cancellation-usage・query-errors 等）だった。
 * 赤になった verify は CI で 1.6 秒以下。全件（ci 395本・CI で計約730秒）は手元で重いので、CI で遅い物
 * （verify-pr-skip.json、CI の実測で2秒を越えた物）を除いた残りを回す。除いた物は CI が回す。
 * verify-no-undef は遅いが赤の最大の型なので除かない。
 *
 * master の赤: 赤になった verify は origin/master の作業ツリーで同じ版を回し、master でも赤なら警告にして通す
 * （差分の誤りでない赤で全ての push を止めないため）。
 *
 * 負荷: 赤・打ち切りは直列で1回だけ回し直してから判定する。回し直しても打ち切りの物は赤に数えず WARN（CI が回す）。
 * 最初に run-verify-registry.js --check（未登録の verify-*.js 等、CI の verify:ci と同じ突き合わせ）。
 *
 * 最後に1行 `verify-pr-result: {...}`（red・masterRed・timedOut・baseChecked・ran・skipped・sec）を出す。赤を verify の名で数えるため。
 *
 * 使い方:
 *   node scripts/maintenance/run-verify-pr.js              # 速い物を並列2で回す
 *   node scripts/maintenance/run-verify-pr.js --jobs=4     # 並列度
 *   node scripts/maintenance/run-verify-pr.js --base=REF   # master の赤を見る基準（既定 origin/master）
 *   node scripts/maintenance/run-verify-pr.js --no-base    # 基準で回し直さない（赤は全部赤）
 *   node scripts/maintenance/run-verify-pr.js --list       # 回す物と除く物の数だけ出す
 */
import { promises as fs, existsSync, mkdtempSync, readdirSync, readFileSync as readTextSync, rmSync, symlinkSync } from "node:fs";
import { withDefaultEntries } from "../lib/verifyRegistryDefaults.js";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
// CI の最遅は 2 秒以下の物だけなので、手元の負荷が高くても 120 秒あれば足りる（目安・根拠なし）。
// registry の timeoutSec がある物はそちら
const TIMEOUT_MS = 120_000;
const SLOW_WARN_MS = 20_000; // 手元でこれを越えた物は除く一覧の候補として WARN（目安・根拠なし）
const { NODE_USE_SYSTEM_CA: _systemCa, ...childEnv } = process.env; // run-verify-registry.js と同じ（BOA-657）

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const jobs = Number(flag("jobs") ?? 2);
const base = flag("base") ?? "origin/master";
if (!Number.isInteger(jobs) || jobs < 1) {
  console.error(`NG: --jobs には1以上の整数（受け取った値: ${flag("jobs")}）`);
  process.exit(2);
}

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

/** 回す物と除く物。除く一覧の名が ci 層に無ければ警告（消した verify の残り） */
/** 台帳に、行の無い verify を既定の ci の項目として足す（頭の注釈の無い物は registryCheck が赤にする） */
function withDefaultEntriesOf(registry) {
  const files = readdirSync(HERE).filter((f) => /^verify-.*\.(js|mjs|cjs|sh)$/.test(f));
  const read = (f) => readTextSync(path.join(HERE, f), "utf8");
  return { ...registry, entries: withDefaultEntries(registry.entries, files, read).entries };
}

function pickEntries(registry, skip) {
  const ci = registry.entries.filter((e) => e.tier === "ci");
  const names = new Set(ci.map((e) => e.script));
  const skipNames = new Set(skip.entries.map((e) => e.script));
  const stale = [...skipNames].filter((s) => !names.has(s));
  return {
    run: ci.filter((e) => !skipNames.has(e.script)),
    skipped: [...skipNames].filter((s) => names.has(s)).length,
    stale,
  };
}

function runScript(entry, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      entry.runner ?? "node",
      [path.join(cwd, "scripts/maintenance", entry.script), ...(entry.args ?? [])],
      { cwd, env: childEnv, detached: true },
    );
    let out = "";
    const keep = (d) => (out = (out + d).slice(-8000));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const ms = entry.timeoutSec ? entry.timeoutSec * 1000 : TIMEOUT_MS;
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, ms);
    const done = (ok, extra = "") => {
      clearTimeout(timer);
      resolve({ entry, ok, timedOut: extra.includes("打ち切り"), ms: Date.now() - started, out: out + extra });
    };
    child.on("close", (code, signal) =>
      done(signal !== "SIGKILL" && code === 0, signal === "SIGKILL" ? `\n（打ち切り: 上限${ms / 1000}秒）` : ""),
    );
    child.on("error", (err) => done(false, `\n起動に失敗: ${err.message}`));
  });
}

async function runAll(entries, cwd, quiet = false, width = jobs) {
  const queue = [...entries];
  const results = [];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const r = await runScript(e, cwd);
      results.push(r);
      if (!quiet) console.log(`${r.ok ? "OK  " : "FAIL"} ${e.script} (${(r.ms / 1000).toFixed(1)}s)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, worker));
  return results;
}

const git = (argv, cwd = ROOT) => spawnSync("git", argv, { cwd, encoding: "utf8" });

// 親が殺されたとき（呼び手の打ち切り）に base の作業ツリーを残さない
const cleanups = new Set();
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    for (const f of cleanups) f();
    process.exit(sig === "SIGTERM" ? 143 : 130);
  });
}

/** 作業ツリーを作る。並列の作り手と git の錠が競るので1回だけ待って試し直す */
function addWorktree(dir) {
  let add = git(["worktree", "add", "--detach", "-q", dir, base]);
  if (add.status !== 0) {
    spawnSync("sleep", ["3"]);
    add = git(["worktree", "add", "--detach", "-q", dir, base]);
  }
  return add;
}

/** 赤の verify を base の作業ツリーで回し、base でも赤の名の集合を返す。作れなければ null と理由 */
async function baseRed(failed) {
  const parent = mkdtempSync(path.join(tmpdir(), "verify-pr-base-"));
  const dir = path.join(parent, "wt");
  const cleanup = () => {
    git(["worktree", "remove", "--force", dir]);
    rmSync(parent, { recursive: true, force: true });
  };
  cleanups.add(cleanup);
  const add = addWorktree(dir);
  if (add.status !== 0) {
    cleanup();
    return { red: null, why: `基準 ${base} の作業ツリーを作れない: ${add.stderr.trim()}` };
  }
  try {
    if (existsSync(path.join(ROOT, "node_modules"))) symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
    const onBase = failed.filter((e) => existsSync(path.join(dir, "scripts/maintenance", e.script)));
    const res = await runAll(onBase, dir, true);
    return { red: new Set(res.filter((r) => !r.ok).map((r) => r.entry.script)), why: "" };
  } finally {
    cleanup();
    cleanups.delete(cleanup);
  }
}

/** CI の verify:ci と同じ registry の突き合わせ（未登録の verify-*.js 等）。赤なら出力を出して終える */
function registryCheck() {
  const r = spawnSync("node", [path.join(HERE, "run-verify-registry.js"), "--check"], { cwd: ROOT, env: childEnv, encoding: "utf8" });
  if (r.status === 0) return;
  console.error(`${r.stdout}${r.stderr}`.trimEnd());
  console.log(`\nverify-pr-result: ${JSON.stringify({ red: ["run-verify-registry.js --check"], masterRed: [], timedOut: [], baseChecked: false })}`);
  process.exit(1);
}

const started = Date.now();
// 台帳に行の無い verify は既定で ci（run-verify-registry.js と同じ、scripts/lib/verifyRegistryDefaults.js）
const registry = withDefaultEntriesOf(await readJson(path.join(HERE, "verify-registry.json")));
const skip = await readJson(path.join(HERE, "verify-pr-skip.json"));
const { run, skipped, stale } = pickEntries(registry, skip);
for (const s of stale) console.log(`WARN: verify-pr-skip.json の ${s} が registry の ci 層に無い（一覧から消す）`);
if (args.includes("--list")) {
  console.log(`回す ${run.length}本 / 除く ${skipped}本（CI が回す）`);
  process.exit(0);
}
if (run.length === 0) {
  console.error("NG: 回す verify が1本も無い（関門の空振り）");
  process.exit(1);
}
registryCheck();
console.log(`tier=ci の ${run.length}本を並列度${jobs}で回す（遅い ${skipped}本は CI に任せる）\n`);
const first = await runAll(run, ROOT);
const keep = new Set(skip.alwaysRun ?? []);
for (const r of first.filter((x) => x.ok && x.ms > SLOW_WARN_MS && !keep.has(x.entry.script))) {
  console.log(`WARN: ${r.entry.script} が手元で ${(r.ms / 1000).toFixed(1)}秒（遅い物は verify-pr-skip.json へ）`);
}
// 負荷による赤・打ち切りを差分の赤と数えないため、赤は直列で1回だけ回し直す
const retried = await runAll(first.filter((r) => !r.ok).map((r) => r.entry), ROOT, true, 1);
const timedOut = retried.filter((r) => r.timedOut);
const failed = retried.filter((r) => !r.ok && !r.timedOut);
let masterRed = new Set();
let baseChecked = failed.length === 0;
if (failed.length > 0 && !args.includes("--no-base")) {
  const b = await baseRed(failed.map((r) => r.entry));
  if (b.red) [masterRed, baseChecked] = [b.red, true];
  else console.log(`WARN: ${b.why}。赤は全部この差分の赤として扱う`);
}
const red = failed.filter((r) => !masterRed.has(r.entry.script));
for (const r of timedOut) console.log(`WARN: ${r.entry.script} は回し直しても打ち切り（赤に数えない。CI が回す）`);
for (const r of failed) {
  const head = masterRed.has(r.entry.script) ? `WARN: ${base} でも赤（この差分の赤でない）` : "NG";
  console.error(`\n--- ${head}: ${r.entry.script}\n    守っているもの: ${r.entry.guards.slice(0, 200)}`);
  console.error(r.out.trimEnd().split("\n").slice(-30).map((l) => `    ${l}`).join("\n"));
  console.error(`    単独で再実行: ${r.entry.runner ?? "node"} scripts/maintenance/${r.entry.script} ${(r.entry.args ?? []).join(" ")}`);
}
const sec = Math.round((Date.now() - started) / 100) / 10;
const names = (xs) => xs.map((r) => r.entry.script);
const result = { red: names(red), masterRed: [...masterRed], timedOut: names(timedOut), baseChecked, ran: run.length, skipped, sec };
console.log(`\nverify-pr-result: ${JSON.stringify(result)}`);
console.log(red.length ? `NG: ${red.length}本が赤（${sec}秒）` : `OK: ${run.length}本（${base} でも赤の ${masterRed.size}本は警告、${sec}秒）`);
process.exit(red.length ? 1 : 0);
