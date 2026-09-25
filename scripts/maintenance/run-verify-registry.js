#!/usr/bin/env node
/**
 * run-verify-registry.js - scripts/maintenance/verify-*.js の集約ランナー。
 *
 * 背景: 2026-09-25時点で verify-*.js は57本あったが、CIワークフローから実行されて
 * いたのは1本だけだった（verify-query-errors.js）。「PRのたびに検証スクリプトを書き、
 * 手元で1回走らせて以後誰も実行しない」状態が積み上がり、実際に
 * マイグレーション番号063の重複がmasterに入ったまま誰にも検知されなかった。
 * 設計: docs/design/quality-gate-ci/spec.md
 *
 * やること:
 *   1. verify-registry.json と実ファイルを突き合わせる
 *      - 未登録の verify-*.js があれば失敗（新規スクリプトの分類漏れを止める）
 *      - 登録されているがファイルが無ければ失敗（削除時の台帳更新漏れを止める）
 *      - tier=manual に reason / command が無ければ失敗
 *   2. tier=ci のスクリプトを並列実行し、1本でも失敗したら非ゼロで終了する
 *
 * 使い方:
 *   node scripts/maintenance/run-verify-registry.js            # 突き合わせ + ci層の実行
 *   node scripts/maintenance/run-verify-registry.js --list     # 実行せず一覧だけ出す
 *   node scripts/maintenance/run-verify-registry.js --check    # 突き合わせだけ（実行しない）
 *   node scripts/maintenance/run-verify-registry.js --jobs=2   # 並列度を指定（既定: CPU数と4の小さい方）
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const REGISTRY_PATH = path.join(HERE, "verify-registry.json");
const TIMEOUT_MS = 180_000;

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const checkOnly = args.includes("--check");
const jobsArg = args.find((a) => a.startsWith("--jobs="));
let jobs = Math.min(4, Math.max(1, cpus().length));
if (jobsArg) {
  const parsed = Number(jobsArg.split("=")[1]);
  // 不正な値を黙って受けると並列度がNaNになり、1本も実行しないまま
  // 「全て成功」と報告してしまう（ゲートの空振り）。必ず明示的に落とす。
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(
      `NG: --jobs には1以上の整数を指定してください（受け取った値: "${jobsArg.split("=")[1]}"）`,
    );
    process.exit(2);
  }
  jobs = parsed;
}

/** レジストリと実ファイルを突き合わせ、問題の一覧を返す */
async function checkRegistry(entries) {
  const problems = [];
  const files = (await fs.readdir(HERE))
    .filter((f) => f.startsWith("verify-") && f.endsWith(".js"))
    .sort();
  const registered = new Set(entries.map((e) => e.script));

  for (const f of files) {
    if (!registered.has(f)) {
      problems.push(
        `未登録: ${f} が verify-registry.json にありません。tier（ci / manual）と guards を追記してください`,
      );
    }
  }
  for (const e of entries) {
    if (!files.includes(e.script)) {
      problems.push(
        `ファイルなし: verify-registry.json の ${e.script} が存在しません。削除したならレジストリからも消してください`,
      );
    }
    if (!["ci", "manual"].includes(e.tier)) {
      problems.push(
        `tierが不正: ${e.script} の tier="${e.tier}"（ci / manual）`,
      );
    }
    if (!e.guards) {
      problems.push(
        `guardsなし: ${e.script} に「何を守るか」の1行がありません`,
      );
    }
    if (e.tier === "manual" && (!e.reason || !e.command)) {
      problems.push(
        `manualの説明不足: ${e.script} には reason（なぜCIに載せないか）と command（実行方法）が要ります`,
      );
    }
  }
  const dup = entries
    .map((e) => e.script)
    .filter((s, i, a) => a.indexOf(s) !== i);
  for (const s of new Set(dup)) {
    problems.push(`重複エントリ: ${s} がレジストリに複数あります`);
  }
  return problems;
}

function runScript(entry) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      "node",
      [path.join(HERE, entry.script), ...(entry.args ?? [])],
      {
        cwd: ROOT,
      },
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        entry,
        timedOut: signal === "SIGKILL",
        ok: signal !== "SIGKILL" && code === 0,
        ms: Date.now() - started,
        output,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        entry,
        timedOut: false,
        ok: false,
        ms: Date.now() - started,
        output: `起動に失敗しました: ${err.message}`,
      });
    });
  });
}

/** 同時実行数を jobs に抑えて全件走らせる */
async function runAll(entries) {
  const queue = [...entries];
  const results = [];
  const workers = Array.from(
    { length: Math.min(jobs, queue.length) },
    async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const r = await runScript(e);
        results.push(r);
        const mark = r.ok ? "OK  " : r.timedOut ? "TIME" : "FAIL";
        console.log(`${mark} ${r.entry.script} (${(r.ms / 1000).toFixed(1)}s)`);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

let registry;
try {
  registry = JSON.parse(await fs.readFile(REGISTRY_PATH, "utf8"));
} catch (err) {
  console.error(
    `NG: ${REGISTRY_PATH} を読めません（JSONの構文エラーか、ファイルがありません）: ${err.message}`,
  );
  process.exit(2);
}
const entries = Array.isArray(registry.entries) ? registry.entries : null;
if (!entries) {
  console.error(`NG: ${REGISTRY_PATH} に entries 配列がありません`);
  process.exit(2);
}
const ciEntries = entries.filter((e) => e.tier === "ci");
const manualEntries = entries.filter((e) => e.tier === "manual");

if (listOnly) {
  console.log(`# tier=ci（PRごとに自動実行、${ciEntries.length}本）\n`);
  for (const e of ciEntries) console.log(`- ${e.script}\n  ${e.guards}`);
  console.log(`\n# tier=manual（自動実行しない、${manualEntries.length}本）\n`);
  for (const e of manualEntries) {
    console.log(
      `- ${e.script}\n  ${e.guards}\n  除外理由: ${e.reason}\n  実行: ${e.command}`,
    );
  }
  process.exit(0);
}

const problems = await checkRegistry(entries);
if (problems.length > 0) {
  console.error("NG: verify-registry.json と実ファイルが食い違っています\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\n詳細: docs/design/quality-gate-ci/spec.md / scripts/maintenance/verify-registry.json の $comment",
  );
  process.exit(1);
}
console.log(
  `OK: レジストリと実ファイルが一致（ci ${ciEntries.length}本 / manual ${manualEntries.length}本）\n`,
);

if (checkOnly) process.exit(0);

// tier=ci が空 = ゲートが何も守っていない。全てを manual に移して
// CIを黙らせる抜け道を塞ぐ
if (ciEntries.length === 0) {
  console.error(
    "NG: tier=ci のスクリプトが1本もありません。このままではCIが何も検証しません",
  );
  process.exit(1);
}

console.log(`tier=ci の ${ciEntries.length}本を並列度${jobs}で実行します\n`);
const started = Date.now();
const results = await runAll(ciEntries);
const totalSec = ((Date.now() - started) / 1000).toFixed(1);

// 実行件数が台帳と食い違う = ランナー自身の不具合で取りこぼしている。
// 「1本も実行していないのに全て成功」と報告する事故を防ぐ
if (results.length !== ciEntries.length) {
  console.error(
    `NG: tier=ci は ${ciEntries.length}本ですが ${results.length}本しか実行されていません（ランナーの不具合）`,
  );
  process.exit(1);
}

const failed = results.filter((r) => !r.ok);

if (failed.length > 0) {
  console.error(
    `\n=== 失敗 ${failed.length}/${results.length}（実時間 ${totalSec}秒）===\n`,
  );
  for (const r of failed) {
    console.error(
      `--- ${r.entry.script}${r.timedOut ? "（タイムアウト）" : ""}`,
    );
    console.error(`    守っているもの: ${r.entry.guards}`);
    console.error(
      r.output
        .trimEnd()
        .split("\n")
        .slice(-15)
        .map((l) => `    ${l}`)
        .join("\n"),
    );
    console.error("");
  }
  process.exit(1);
}

const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3);
console.log(
  `\nOK: ${results.length}本すべて成功（実時間 ${totalSec}秒、並列度${jobs}）`,
);
console.log(
  `最も遅い3本: ${slowest.map((r) => `${r.entry.script} ${(r.ms / 1000).toFixed(1)}s`).join(" / ")}`,
);
